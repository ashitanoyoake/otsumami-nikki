/**
 * Instagram API with Instagram Login から最新投稿を取得し、既存アーカイブへ Media ID 単位で蓄積する。
 * 新規画像は Cloudflare R2（otsumami-instagram）へ保存し、
 * 公開サイトは https://instagram-media.otsumaminikki.com を参照する。
 *
 * - API の取得件数は最新9件のまま（ページネーション／バックフィルはしない）
 * - 既存投稿は最新9件から外れても削除しない
 * - 既存の R2 オブジェクト／移行元ローカル画像は Media ID 単位で再取得しない
 * - 取得失敗時は既存 JSON / 保存済み画像を壊さない
 *
 * ホストは graph.instagram.com（Instagram User access token 用）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createR2MediaStore, isR2PublicUrl, readR2ConfigFromEnv } from "./r2.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
export const OUTPUT_PATH = path.join(REPO_ROOT, "data", "instagram.json");
export const MEDIA_DIR = path.join(REPO_ROOT, "images", "instagram", "posts");
export const MEDIA_PUBLIC_PREFIX = "images/instagram/posts";
const TEMP_JSON_PATH = `${OUTPUT_PATH}.tmp`;
const API_HOST = "https://graph.instagram.com";
const API_VERSION = "v21.0";
export const POST_LIMIT = 9;
const EXIT_FAILURE = 1;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MIN_IMAGE_BYTES = 8;
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif"]);

const FIELDS = [
  "id",
  "media_type",
  "media_url",
  "permalink",
  "thumbnail_url",
  "timestamp",
  "children{media_type,media_url,thumbnail_url}",
].join(",");

const CONTENT_TYPE_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/pjpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/**
 * @param {number | null} status
 * @param {string} bodyText
 * @returns {string}
 */
function formatSafeApiError(status, bodyText) {
  const parts = [];

  if (typeof status === "number") {
    parts.push(`HTTP ${status}`);
  }

  try {
    const parsed = JSON.parse(bodyText);
    const error = parsed && typeof parsed === "object" ? parsed.error : null;

    if (error && typeof error === "object") {
      if (typeof error.type === "string" && error.type) {
        parts.push(`type=${error.type}`);
      }
      if (typeof error.code === "number" || typeof error.code === "string") {
        parts.push(`code=${error.code}`);
      }
      if (
        typeof error.error_subcode === "number" ||
        typeof error.error_subcode === "string"
      ) {
        parts.push(`subcode=${error.error_subcode}`);
      }
    }
  } catch {
    // 生bodyはログしない
  }

  if (parts.length === 0) {
    return "Instagram API error (details omitted)";
  }

  return `Instagram API error (${parts.join(", ")})`;
}

/**
 * @param {unknown} id
 * @returns {boolean}
 */
export function isSafeMediaId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id);
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isLocalMediaPath(value) {
  return typeof value === "string" && value.startsWith(`${MEDIA_PUBLIC_PREFIX}/`);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isStoredMediaUrl(value) {
  return isLocalMediaPath(value) || isR2PublicUrl(value);
}

/**
 * @param {string | null | undefined} contentType
 * @returns {string | null}
 */
export function extensionFromContentType(contentType) {
  if (!contentType) {
    return null;
  }

  const mime = contentType.split(";")[0].trim().toLowerCase();
  return CONTENT_TYPE_EXTENSIONS[mime] || null;
}

/**
 * @param {Buffer} buffer
 * @returns {string | null}
 */
export function extensionFromMagic(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "png";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  if (buffer.length >= 6 && buffer.toString("ascii", 0, 6).startsWith("GIF8")) {
    return "gif";
  }
  return null;
}

/**
 * @param {string} mediaId
 * @param {string} [mediaDir]
 * @returns {string | null} repo-relative path
 */
export function findExistingMediaFile(mediaId, mediaDir = MEDIA_DIR) {
  if (!isSafeMediaId(mediaId) || !fs.existsSync(mediaDir)) {
    return null;
  }

  const names = fs.readdirSync(mediaDir);
  const match = names.find((name) => {
    if (name.endsWith(".tmp") || name.endsWith(".part")) {
      return false;
    }
    const ext = path.extname(name).slice(1).toLowerCase();
    return name.slice(0, -path.extname(name).length) === mediaId && ALLOWED_EXTENSIONS.has(ext);
  });

  return match ? `${MEDIA_PUBLIC_PREFIX}/${match}` : null;
}

/**
 * @param {Record<string, unknown>} item
 * @returns {string | null}
 */
function getItemRemoteUrl(item) {
  if (item.media_type === "VIDEO") {
    if (isHttpUrl(item.thumbnail_url) && !isR2PublicUrl(item.thumbnail_url)) {
      return item.thumbnail_url;
    }
    return null;
  }

  if (isHttpUrl(item.media_url) && !isR2PublicUrl(item.media_url) && !isLocalMediaPath(item.media_url)) {
    return item.media_url;
  }
  if (isHttpUrl(item.thumbnail_url) && !isR2PublicUrl(item.thumbnail_url)) {
    return item.thumbnail_url;
  }
  return null;
}

/**
 * @param {Record<string, unknown>} item
 * @returns {unknown[]}
 */
function readChildrenList(item) {
  if (Array.isArray(item.children)) {
    return item.children;
  }

  if (item.children && typeof item.children === "object") {
    const data = /** @type {{ data?: unknown }} */ (item.children).data;
    if (Array.isArray(data)) {
      return data;
    }
  }

  return [];
}

/**
 * @param {Record<string, unknown>} item
 * @returns {Record<string, unknown>[]}
 */
export function normalizeChildren(item) {
  const children = [];

  readChildrenList(item).forEach((raw) => {
    if (!raw || typeof raw !== "object") {
      return;
    }

    const child = /** @type {Record<string, unknown>} */ (raw);
    const remoteUrl = getItemRemoteUrl(child);
    const localPath =
      typeof child.local_media_path === "string" && child.local_media_path
        ? child.local_media_path
        : isStoredMediaUrl(child.media_url)
          ? child.media_url
          : isStoredMediaUrl(child.thumbnail_url)
            ? child.thumbnail_url
            : null;

    if (!remoteUrl && !localPath) {
      return;
    }

    children.push({
      id: child.id || null,
      media_type: child.media_type || null,
      media_url: localPath || remoteUrl,
      thumbnail_url:
        child.media_type === "VIDEO"
          ? localPath || (typeof child.thumbnail_url === "string" ? child.thumbnail_url : null)
          : typeof child.thumbnail_url === "string"
            ? child.thumbnail_url
            : null,
      ...(localPath ? { local_media_path: localPath } : {}),
    });
  });

  return children;
}

/**
 * @param {Record<string, unknown>} item
 * @param {Record<string, unknown>[]} children
 * @returns {string | null}
 */
function getDisplayMediaUrl(item, children) {
  if (children.length > 0) {
    const first = children[0];
    return typeof first.local_media_path === "string" && first.local_media_path
      ? first.local_media_path
      : typeof first.media_url === "string"
        ? first.media_url
        : null;
  }

  if (typeof item.local_media_path === "string" && item.local_media_path) {
    return item.local_media_path;
  }

  if (item.media_type === "VIDEO") {
    return typeof item.thumbnail_url === "string" ? item.thumbnail_url : null;
  }

  return typeof item.media_url === "string"
    ? item.media_url
    : typeof item.thumbnail_url === "string"
      ? item.thumbnail_url
      : null;
}

/**
 * @param {Record<string, unknown>} item
 * @returns {Record<string, unknown> | null}
 */
export function normalizePost(item) {
  const children = normalizeChildren(item);
  const mediaUrl = getDisplayMediaUrl(item, children);
  if (!mediaUrl || typeof item.permalink !== "string" || !item.permalink) {
    return null;
  }

  const localPath =
    typeof item.local_media_path === "string" && item.local_media_path
      ? item.local_media_path
      : isStoredMediaUrl(mediaUrl)
        ? mediaUrl
        : null;

  return {
    id: item.id,
    media_url: mediaUrl,
    permalink: item.permalink,
    media_type: item.media_type,
    thumbnail_url: typeof item.thumbnail_url === "string" ? item.thumbnail_url : null,
    timestamp: item.timestamp,
    children,
    ...(localPath ? { local_media_path: localPath } : {}),
  };
}

/**
 * @param {string} outputPath
 * @returns {{ updated_at?: string, posts: Record<string, unknown>[] }}
 */
export function readExistingArchive(outputPath = OUTPUT_PATH) {
  if (!fs.existsSync(outputPath)) {
    return { posts: [] };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  } catch {
    throw new Error("既存の data/instagram.json が読み込めないため中断しました。");
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.posts)) {
    throw new Error("既存の data/instagram.json の形式が不正なため中断しました。");
  }

  return {
    updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : undefined,
    posts: parsed.posts.filter((post) => post && typeof post === "object"),
  };
}

/**
 * @param {Record<string, unknown>[]} posts
 * @returns {Record<string, unknown>[]}
 */
export function dedupePostsById(posts) {
  const seen = new Set();
  const result = [];

  posts.forEach((post) => {
    const id = post && post.id != null ? String(post.id) : "";
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    result.push(post);
  });

  return result;
}

/**
 * @param {Record<string, unknown>[]} posts
 * @returns {Record<string, unknown>[]}
 */
export function sortPostsByTimestampDesc(posts) {
  return [...posts].sort((a, b) => {
    const aTime = Date.parse(String(a.timestamp || ""));
    const bTime = Date.parse(String(b.timestamp || ""));
    const aValid = Number.isFinite(aTime);
    const bValid = Number.isFinite(bTime);
    if (aValid && bValid && bTime !== aTime) {
      return bTime - aTime;
    }
    if (aValid !== bValid) {
      return aValid ? -1 : 1;
    }
    return String(b.id || "").localeCompare(String(a.id || ""));
  });
}

/**
 * @param {unknown} item
 * @returns {Record<string, unknown>}
 */
function serializeChild(item) {
  const child = item && typeof item === "object" ? /** @type {Record<string, unknown>} */ (item) : {};
  return {
    id: child.id ?? null,
    media_type: child.media_type ?? null,
    media_url: child.media_url ?? null,
    thumbnail_url: child.thumbnail_url ?? null,
    local_media_path: child.local_media_path ?? null,
  };
}

/**
 * @param {unknown} item
 * @returns {Record<string, unknown>}
 */
function serializePost(item) {
  const post = item && typeof item === "object" ? /** @type {Record<string, unknown>} */ (item) : {};
  return {
    id: post.id ?? null,
    permalink: post.permalink ?? null,
    media_type: post.media_type ?? null,
    timestamp: post.timestamp ?? null,
    media_url: post.media_url ?? null,
    thumbnail_url: post.thumbnail_url ?? null,
    local_media_path: post.local_media_path ?? null,
    children: Array.isArray(post.children) ? post.children.map(serializeChild) : [],
  };
}

/**
 * @param {Record<string, unknown>[]} a
 * @param {Record<string, unknown>[]} b
 * @returns {boolean}
 */
export function postsAreEqual(a, b) {
  return JSON.stringify(a.map(serializePost)) === JSON.stringify(b.map(serializePost));
}

/**
 * @param {Record<string, unknown> | null | undefined} existing
 * @param {Record<string, unknown>} incoming
 * @returns {Record<string, unknown>}
 */
function mergeChildRecord(existing, incoming) {
  return {
    ...(existing || {}),
    id: incoming.id || existing?.id || null,
    media_type: incoming.media_type || existing?.media_type || null,
    media_url: incoming.media_url || existing?.media_url || null,
    thumbnail_url: incoming.thumbnail_url ?? existing?.thumbnail_url ?? null,
  };
}

/**
 * @param {unknown[]} existingChildren
 * @param {unknown[]} incomingChildren
 * @returns {Record<string, unknown>[]}
 */
export function mergeChildren(existingChildren, incomingChildren) {
  const existingList = Array.isArray(existingChildren) ? existingChildren : [];
  const incomingList = Array.isArray(incomingChildren) ? incomingChildren : [];
  const existingById = new Map();

  existingList.forEach((raw) => {
    if (!raw || typeof raw !== "object") {
      return;
    }
    const child = /** @type {Record<string, unknown>} */ (raw);
    if (child.id != null && child.id !== "") {
      existingById.set(String(child.id), child);
    }
  });

  if (incomingList.length === 0) {
    return existingList
      .filter((raw) => raw && typeof raw === "object")
      .map((raw) => /** @type {Record<string, unknown>} */ (raw));
  }

  const seen = new Set();
  const merged = [];

  incomingList.forEach((raw) => {
    if (!raw || typeof raw !== "object") {
      return;
    }
    const incoming = /** @type {Record<string, unknown>} */ (raw);
    const id = incoming.id != null ? String(incoming.id) : "";
    if (id) {
      seen.add(id);
    }
    merged.push(mergeChildRecord(id ? existingById.get(id) : undefined, incoming));
  });

  existingList.forEach((raw) => {
    if (!raw || typeof raw !== "object") {
      return;
    }
    const existing = /** @type {Record<string, unknown>} */ (raw);
    const id = existing.id != null ? String(existing.id) : "";
    if (!id || seen.has(id)) {
      return;
    }
    merged.push(existing);
  });

  return merged;
}

/**
 * @param {Record<string, unknown>} existing
 * @param {Record<string, unknown>} incoming
 * @returns {Record<string, unknown>}
 */
function mergePostRecord(existing, incoming) {
  return {
    ...existing,
    id: incoming.id || existing.id,
    permalink: incoming.permalink || existing.permalink,
    media_type: incoming.media_type || existing.media_type,
    timestamp: incoming.timestamp || existing.timestamp,
    media_url: incoming.media_url || existing.media_url,
    thumbnail_url: incoming.thumbnail_url ?? existing.thumbnail_url ?? null,
    children: mergeChildren(
      Array.isArray(existing.children) ? existing.children : [],
      Array.isArray(incoming.children) ? incoming.children : [],
    ),
  };
}

/**
 * 最新取得分を既存アーカイブへ Media ID でマージする。未取得の既存投稿は残す。
 * @param {Record<string, unknown>[]} existingPosts
 * @param {Record<string, unknown>[]} incomingPosts
 * @returns {{ posts: Record<string, unknown>[], added: number, updated: number, kept: number }}
 */
export function mergeArchives(existingPosts, incomingPosts) {
  const existingById = new Map();
  existingPosts.forEach((post) => {
    if (post && post.id != null && post.id !== "") {
      existingById.set(String(post.id), post);
    }
  });

  const seen = new Set();
  const merged = [];
  let added = 0;
  let updated = 0;

  incomingPosts.forEach((incoming) => {
    if (!incoming || incoming.id == null || incoming.id === "") {
      return;
    }
    const id = String(incoming.id);
    seen.add(id);
    const existing = existingById.get(id);
    if (existing) {
      merged.push(mergePostRecord(existing, incoming));
      updated += 1;
    } else {
      merged.push(incoming);
      added += 1;
    }
  });

  let kept = 0;
  existingPosts.forEach((existing) => {
    if (!existing || existing.id == null || existing.id === "") {
      return;
    }
    const id = String(existing.id);
    if (seen.has(id)) {
      return;
    }
    merged.push(existing);
    kept += 1;
  });

  return {
    posts: sortPostsByTimestampDesc(dedupePostsById(merged)),
    added,
    updated,
    kept,
  };
}

/**
 * @param {Record<string, unknown>} item
 * @param {string} localPath
 */
function applyLocalPath(item, localPath) {
  item.local_media_path = localPath;
  if (item.media_type === "VIDEO") {
    item.thumbnail_url = localPath;
    if (!item.media_url || isHttpUrl(item.media_url)) {
      item.media_url = localPath;
    }
  } else {
    item.media_url = localPath;
  }
}

function clearLocalPath(item) {
  if (item && "local_media_path" in item) {
    delete item.local_media_path;
  }
}

/**
 * @param {Buffer} buffer
 * @param {string | null} contentType
 * @returns {string}
 */
function resolveExtension(buffer, contentType) {
  const fromType = extensionFromContentType(contentType);
  const fromMagic = extensionFromMagic(buffer);

  if (fromType && fromMagic && fromType !== fromMagic && !(fromType === "jpg" && fromMagic === "jpg")) {
    return fromMagic;
  }
  if (fromType) {
    return fromType;
  }
  if (fromMagic) {
    return fromMagic;
  }
  throw new Error("unsupported image type");
}

const MIME_BY_EXTENSION = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

/**
 * @param {string} extension
 * @returns {string}
 */
function mimeFromExtension(extension) {
  return MIME_BY_EXTENSION[extension] || "application/octet-stream";
}

/**
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{ buffer: Buffer, contentType: string | null, extension: string } | null>}
 */
export async function fetchImageBytes(url, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;

  if (!isHttpUrl(url)) {
    return null;
  }

  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      redirect: "follow",
      headers: {
        Accept: "image/*,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type");
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_IMAGE_BYTES || arrayBuffer.byteLength < MIN_IMAGE_BYTES) {
      throw new Error("unexpected image size");
    }

    const buffer = Buffer.from(arrayBuffer);
    const extension = resolveExtension(buffer, contentType);
    return { buffer, contentType, extension };
  } catch {
    return null;
  }
}

/**
 * @param {string} mediaId
 * @param {{
 *   store: { has: Function, put: Function },
 *   fetchImpl?: typeof fetch,
 *   mediaDir?: string,
 *   sourceUrl?: string | null,
 * }} options
 */
async function persistMedia(mediaId, options) {
  const existingRemote = await options.store.has(mediaId);
  if (existingRemote) {
    return { url: existingRemote, skipped: true, uploaded: false, failed: false };
  }

  const mediaDir = options.mediaDir || MEDIA_DIR;
  const localRel = findExistingMediaFile(mediaId, mediaDir);
  if (localRel) {
    const localAbs = path.join(mediaDir, path.basename(localRel));
    const extension = path.extname(localRel).slice(1).toLowerCase();
    const buffer = fs.readFileSync(localAbs);
    try {
      const url = await options.store.put(mediaId, buffer, mimeFromExtension(extension), extension);
      return { url, skipped: false, uploaded: true, failed: false };
    } catch {
      return { url: null, skipped: false, uploaded: false, failed: true };
    }
  }

  if (!options.sourceUrl) {
    return { url: null, skipped: false, uploaded: false, failed: true };
  }

  const fetched = await fetchImageBytes(options.sourceUrl, { fetchImpl: options.fetchImpl });
  if (!fetched) {
    return { url: null, skipped: false, uploaded: false, failed: true };
  }

  try {
    const url = await options.store.put(
      mediaId,
      fetched.buffer,
      fetched.contentType || mimeFromExtension(fetched.extension),
      fetched.extension,
    );
    return { url, skipped: false, uploaded: true, failed: false };
  } catch {
    return { url: null, skipped: false, uploaded: false, failed: true };
  }
}

/**
 * @param {Record<string, unknown>} item
 * @returns {{ id: string, url: string } | null}
 */
function getDownloadTarget(item) {
  const id = item && item.id != null ? String(item.id) : "";
  if (!isSafeMediaId(id)) {
    return null;
  }
  const url = getItemRemoteUrl(item);
  if (!url) {
    return null;
  }
  return { id, url };
}

/**
 * @param {Record<string, unknown>[]} posts
 * @param {{
 *   store: { has: Function, put: Function },
 *   mediaDir?: string,
 *   fetchImpl?: typeof fetch,
 * }} options
 */
export async function savePostsMedia(posts, options) {
  if (!options || !options.store) {
    throw new Error("media store is required");
  }

  const stats = {
    downloaded: 0,
    skipped: 0,
    failed: 0,
  };

  /**
   * @param {Record<string, unknown>} item
   */
  async function persistItem(item) {
    const id = item.id != null ? String(item.id) : "";
    if (!isSafeMediaId(id)) {
      return;
    }

    const target = getDownloadTarget(item);
    const result = await persistMedia(id, {
      store: options.store,
      fetchImpl: options.fetchImpl,
      mediaDir: options.mediaDir,
      sourceUrl: target ? target.url : null,
    });

    if (result.url) {
      applyLocalPath(item, result.url);
    } else {
      clearLocalPath(item);
    }

    if (result.uploaded) {
      stats.downloaded += 1;
    } else if (result.skipped) {
      stats.skipped += 1;
    } else if (result.failed) {
      stats.failed += 1;
    }
  }

  for (const post of posts) {
    if (!post || typeof post !== "object") {
      continue;
    }

    const children = Array.isArray(post.children) ? post.children : [];
    if (children.length > 0) {
      for (const child of children) {
        if (!child || typeof child !== "object") {
          continue;
        }
        await persistItem(child);
      }

      const firstLocal =
        children.find((child) => child && typeof child.local_media_path === "string")?.local_media_path ||
        null;
      if (typeof firstLocal === "string" && firstLocal) {
        applyLocalPath(post, firstLocal);
      } else {
        clearLocalPath(post);
      }
      continue;
    }

    await persistItem(post);
  }

  return stats;
}

/**
 * @param {string} outputPath
 * @param {{ updated_at?: string, posts: Record<string, unknown>[] }} existing
 * @param {Record<string, unknown>[]} posts
 * @returns {boolean} wrote
 */
export function writeArchiveIfChanged(outputPath, existing, posts) {
  if (postsAreEqual(existing.posts, posts)) {
    return false;
  }

  const output = {
    updated_at: new Date().toISOString(),
    posts,
  };
  const tempPath = `${outputPath}.tmp`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(tempPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, outputPath);
  return true;
}

/**
 * @param {string} accessToken
 * @param {string} userId
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function fetchInstagramPosts(accessToken, userId) {
  const params = new URLSearchParams({
    fields: FIELDS,
    limit: String(POST_LIMIT),
    access_token: accessToken,
  });

  const url = `${API_HOST}/${API_VERSION}/${userId}/media?${params}`;
  const response = await fetch(url);
  const bodyText = await response.text();

  let data;

  try {
    data = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    throw new Error(formatSafeApiError(response.status, ""));
  }

  if (!response.ok) {
    throw new Error(formatSafeApiError(response.status, bodyText));
  }

  if (data && typeof data === "object" && data.error) {
    throw new Error(formatSafeApiError(response.status, bodyText));
  }

  const items = data && Array.isArray(data.data) ? data.data : [];
  return items.map(normalizePost).filter(Boolean).slice(0, POST_LIMIT);
}

function cleanupTmpFiles() {
  [TEMP_JSON_PATH].forEach((filePath) => {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });

  if (!fs.existsSync(MEDIA_DIR)) {
    return;
  }

  fs.readdirSync(MEDIA_DIR).forEach((name) => {
    if (name.endsWith(".tmp") || name.endsWith(".part")) {
      fs.unlinkSync(path.join(MEDIA_DIR, name));
    }
  });
}

async function main() {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const userId = process.env.INSTAGRAM_USER_ID;

  if (!accessToken || !userId) {
    console.error("INSTAGRAM_ACCESS_TOKEN または INSTAGRAM_USER_ID が未設定です。");
    process.exit(EXIT_FAILURE);
  }

  try {
    const r2Config = readR2ConfigFromEnv();
    cleanupTmpFiles();
    const incoming = await fetchInstagramPosts(accessToken, userId);
    const existing = readExistingArchive(OUTPUT_PATH);
    const merged = mergeArchives(existing.posts, incoming);
    const store = createR2MediaStore(r2Config);
    const mediaStats = await savePostsMedia(merged.posts, {
      store,
      mediaDir: MEDIA_DIR,
    });
    const wroteJson = writeArchiveIfChanged(OUTPUT_PATH, existing, merged.posts);

    console.log(
      `Instagramアーカイブ: 取得${incoming.length}件 / 追加${merged.added} / 更新${merged.updated} / 保持${merged.kept} / 合計${merged.posts.length}件`,
    );
    console.log(
      `画像: 保存${mediaStats.downloaded} / スキップ${mediaStats.skipped} / 失敗${mediaStats.failed}`,
    );
    console.log(wroteJson ? "data/instagram.json を更新しました。" : "投稿データに実質変更がないため JSON は更新しません。");
  } catch (error) {
    cleanupTmpFiles();

    const message =
      error instanceof Error ? error.message : "Instagram API error (unknown)";
    console.error("Instagram投稿の取得に失敗しました:", message);
    console.error("既存の data/instagram.json と保存済み画像は保持されます。");
    process.exit(EXIT_FAILURE);
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  main();
}
