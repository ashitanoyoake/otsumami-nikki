/**
 * Cloudflare R2（S3互換）への画像保存。
 * 認証情報は環境変数からのみ読む。値はログに出さない。
 *
 * 確定済み:
 * - バケット: otsumami-instagram
 * - 公開URL: https://instagram-media.otsumaminikki.com
 */
import { createHash, createHmac } from "node:crypto";

export const R2_BUCKET_NAME = "otsumami-instagram";
export const R2_PUBLIC_BASE = "https://instagram-media.otsumaminikki.com";
export const R2_OBJECT_PREFIX = "posts";
const R2_REGION = "auto";
const EMPTY_PAYLOAD_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "avif"];

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isR2PublicUrl(value) {
  return typeof value === "string" && value.startsWith(`${R2_PUBLIC_BASE}/`);
}

/**
 * @param {string} mediaId
 * @param {string} extension
 * @returns {string}
 */
export function r2ObjectKey(mediaId, extension) {
  return `${R2_OBJECT_PREFIX}/${mediaId}.${extension}`;
}

/**
 * @param {string} mediaId
 * @param {string} extension
 * @returns {string}
 */
export function r2PublicUrl(mediaId, extension) {
  return `${R2_PUBLIC_BASE}/${r2ObjectKey(mediaId, extension)}`;
}

/**
 * @returns {{
 *   accountId: string,
 *   accessKeyId: string,
 *   secretAccessKey: string,
 *   bucket: string,
 *   publicBase: string,
 * }}
 */
export function readR2ConfigFromEnv() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY が未設定です。",
    );
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket: R2_BUCKET_NAME,
    publicBase: R2_PUBLIC_BASE,
  };
}

function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key, data) {
  return createHmac("sha256", key).update(data).digest();
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function amzDateNow() {
  return new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
}

/**
 * @param {{
 *   config: ReturnType<typeof readR2ConfigFromEnv>,
 *   method: string,
 *   key: string,
 *   body?: Buffer,
 *   contentType?: string,
 *   fetchImpl?: typeof fetch,
 * }} options
 */
export async function r2Request(options) {
  const { config, method, key, body, contentType, fetchImpl } = options;
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${config.bucket}/${key.split("/").map(encodeRfc3986).join("/")}`;
  const url = `https://${host}${canonicalUri}`;
  const amzDate = amzDateNow();
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = body ? sha256Hex(body) : EMPTY_PAYLOAD_HASH;

  /** @type {Record<string, string>} */
  const unsigned = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType && body) {
    unsigned["content-type"] = contentType;
  }

  const signedHeaderNames = Object.keys(unsigned).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${unsigned[name]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${R2_REGION}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, R2_REGION);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  /** @type {Record<string, string>} */
  const headers = {
    "X-Amz-Content-Sha256": payloadHash,
    "X-Amz-Date": amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (contentType && body) {
    headers["Content-Type"] = contentType;
  }

  const response = await (fetchImpl || fetch)(url, {
    method,
    headers,
    body: body || undefined,
  });

  return response;
}

/**
 * @param {ReturnType<typeof readR2ConfigFromEnv>} config
 * @param {{ fetchImpl?: typeof fetch }} [options]
 */
export function createR2MediaStore(config, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;

  return {
    /**
     * @param {string} mediaId
     * @returns {Promise<string | null>}
     */
    async has(mediaId) {
      for (const extension of ALLOWED_EXTENSIONS) {
        const key = r2ObjectKey(mediaId, extension);
        const response = await r2Request({
          config,
          method: "HEAD",
          key,
          fetchImpl,
        });
        if (response.ok) {
          return r2PublicUrl(mediaId, extension);
        }
        if (response.status !== 404) {
          throw new Error(`R2 HEAD failed (${response.status})`);
        }
      }
      return null;
    },

    /**
     * @param {string} mediaId
     * @param {Buffer} buffer
     * @param {string} contentType
     * @param {string} extension
     * @returns {Promise<string>}
     */
    async put(mediaId, buffer, contentType, extension) {
      const key = r2ObjectKey(mediaId, extension);
      const response = await r2Request({
        config,
        method: "PUT",
        key,
        body: buffer,
        contentType,
        fetchImpl,
      });
      if (!response.ok) {
        throw new Error(`R2 PUT failed (${response.status})`);
      }
      return r2PublicUrl(mediaId, extension);
    },
  };
}

/**
 * テスト用のメモリ保存。R2と同じ公開URL形式を返す。
 * @param {string} [publicBase]
 */
export function createMemoryMediaStore(publicBase = R2_PUBLIC_BASE) {
  /** @type {Map<string, { buffer: Buffer, contentType: string }>} */
  const objects = new Map();

  function urlFor(mediaId, extension) {
    return `${publicBase}/${R2_OBJECT_PREFIX}/${mediaId}.${extension}`;
  }

  return {
    objects,
    async has(mediaId) {
      for (const extension of ALLOWED_EXTENSIONS) {
        const key = r2ObjectKey(mediaId, extension);
        if (objects.has(key)) {
          return urlFor(mediaId, extension);
        }
      }
      return null;
    },
    async put(mediaId, buffer, contentType, extension) {
      const key = r2ObjectKey(mediaId, extension);
      objects.set(key, { buffer, contentType });
      return urlFor(mediaId, extension);
    },
  };
}
