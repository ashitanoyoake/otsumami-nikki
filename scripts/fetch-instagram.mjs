/**
 * Instagram API with Instagram Login から最新投稿を取得し data/instagram.json に保存する。
 * GitHub Actions から実行する想定。取得失敗時は既存ファイルを上書きしない。
 *
 * ホストは graph.instagram.com（Instagram User access token 用）。
 * Facebook Login 用の graph.facebook.com は使わない。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "..", "data", "instagram.json");
const TEMP_PATH = `${OUTPUT_PATH}.tmp`;
const API_HOST = "https://graph.instagram.com";
const API_VERSION = "v21.0";
const POST_LIMIT = 9;
const EXIT_FAILURE = 1;

const FIELDS = [
  "id",
  "media_type",
  "media_url",
  "permalink",
  "thumbnail_url",
  "timestamp",
  "children{media_type,media_url,thumbnail_url}",
].join(",");

/**
 * ログ用に安全なエラー要約を作る（token / URL / 生bodyは出さない）。
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
 * 子メディア1件の表示用URLを決める（動画はサムネイル優先）。
 * @param {Record<string, unknown>} item
 * @returns {string | null}
 */
function getItemMediaUrl(item) {
  if (item.media_type === "VIDEO") {
    return typeof item.thumbnail_url === "string"
      ? item.thumbnail_url
      : typeof item.media_url === "string"
        ? item.media_url
        : null;
  }

  return typeof item.media_url === "string"
    ? item.media_url
    : typeof item.thumbnail_url === "string"
      ? item.thumbnail_url
      : null;
}

/**
 * APIの children を配列として取り出す。
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
 * カルーセル子要素をサイト表示用に正規化する。
 * @param {Record<string, unknown>} item
 * @returns {{ id: unknown, media_type: unknown, media_url: string, thumbnail_url: string | null }[]}
 */
function normalizeChildren(item) {
  const children = [];

  readChildrenList(item).forEach((raw) => {
    if (!raw || typeof raw !== "object") {
      return;
    }

    const child = /** @type {Record<string, unknown>} */ (raw);
    const mediaUrl = getItemMediaUrl(child);

    if (!mediaUrl) {
      return;
    }

    children.push({
      id: child.id || null,
      media_type: child.media_type || null,
      media_url: mediaUrl,
      thumbnail_url: typeof child.thumbnail_url === "string" ? child.thumbnail_url : null,
    });
  });

  return children;
}

/**
 * 一覧表示用の代表画像URLを決定する。
 * @param {Record<string, unknown>} item
 * @param {{ media_url: string }[]} children
 * @returns {string | null}
 */
function getDisplayMediaUrl(item, children) {
  if (children.length > 0) {
    return children[0].media_url;
  }

  return getItemMediaUrl(item);
}

/**
 * APIレスポンスをサイト表示用に正規化する。
 * @param {Record<string, unknown>} item
 * @returns {Record<string, unknown> | null}
 */
function normalizePost(item) {
  const children = normalizeChildren(item);
  const mediaUrl = getDisplayMediaUrl(item, children);
  if (!mediaUrl || typeof item.permalink !== "string" || !item.permalink) {
    return null;
  }

  return {
    id: item.id,
    media_url: mediaUrl,
    permalink: item.permalink,
    media_type: item.media_type,
    thumbnail_url: typeof item.thumbnail_url === "string" ? item.thumbnail_url : null,
    timestamp: item.timestamp,
    children,
  };
}

/**
 * Instagram API with Instagram Login から投稿一覧を取得する。
 * @param {string} accessToken Instagram User access token
 * @param {string} userId Instagram professional account user ID
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

async function main() {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const userId = process.env.INSTAGRAM_USER_ID;

  if (!accessToken || !userId) {
    console.error("INSTAGRAM_ACCESS_TOKEN または INSTAGRAM_USER_ID が未設定です。");
    process.exit(EXIT_FAILURE);
  }

  try {
    const posts = await fetchInstagramPosts(accessToken, userId);
    const output = {
      updated_at: new Date().toISOString(),
      posts,
    };

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(TEMP_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    fs.renameSync(TEMP_PATH, OUTPUT_PATH);

    console.log(`Instagram投稿を ${posts.length} 件保存しました。`);
  } catch (error) {
    if (fs.existsSync(TEMP_PATH)) {
      fs.unlinkSync(TEMP_PATH);
    }

    const message =
      error instanceof Error ? error.message : "Instagram API error (unknown)";
    console.error("Instagram投稿の取得に失敗しました:", message);
    console.error("既存の data/instagram.json は保持されます。");
    process.exit(EXIT_FAILURE);
  }
}

main();
