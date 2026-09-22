/**
 * Instagram /media のページネーション調査（読み取り専用）。
 * data/instagram.json と images/ は変更しない。API GET のみ。
 *
 * ログに access_token / Secret / paging.next などの認証付きURLは出さない。
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_HOST = "https://graph.instagram.com";
const API_VERSION = "v21.0";
const EXIT_FAILURE = 1;
export const PAGE_SIZE = 25;
export const MAX_PAGES = 50;
const REQUEST_TIMEOUT_MS = 30_000;

/** 135A 実測: 36画像 = 41,867,334 bytes */
export const MEASURED_IMAGE_COUNT = 36;
export const MEASURED_IMAGE_BYTES = 41_867_334;

const FIELDS = ["id", "media_type", "timestamp", "children{id,media_type}"].join(",");

/**
 * @param {number | null} status
 * @param {string} bodyText
 * @returns {string}
 */
export function formatSafeApiError(status, bodyText) {
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
 * paging.next をログせずに識別するためのキー。
 * @param {unknown} paging
 * @returns {string | null}
 */
export function pagingKey(paging) {
  if (!paging || typeof paging !== "object") {
    return null;
  }

  const record = /** @type {{ cursors?: { after?: unknown }, next?: unknown }} */ (paging);
  const after = record.cursors && typeof record.cursors.after === "string" ? record.cursors.after : "";
  if (after) {
    return `after:${after}`;
  }

  if (typeof record.next === "string" && record.next) {
    const digest = createHash("sha256").update(record.next).digest("hex").slice(0, 16);
    return `next:${digest}`;
  }

  return null;
}

/**
 * @param {unknown} paging
 * @returns {boolean}
 */
export function hasNextPage(paging) {
  return pagingKey(paging) !== null;
}

/**
 * @param {unknown} item
 * @returns {unknown[]}
 */
export function readChildrenList(item) {
  if (!item || typeof item !== "object") {
    return [];
  }

  const record = /** @type {{ children?: unknown }} */ (item);
  if (Array.isArray(record.children)) {
    return record.children;
  }

  if (record.children && typeof record.children === "object") {
    const data = /** @type {{ data?: unknown }} */ (record.children).data;
    if (Array.isArray(data)) {
      return data;
    }
  }

  return [];
}

/**
 * 135Aの保存方針に合わせた保存対象枚数。
 * IMAGE: 1 / VIDEO: サムネイル1 / CAROUSEL_ALBUM: children枚数（0なら代表1）
 * @param {Record<string, unknown>} post
 * @returns {number}
 */
export function saveableImageCount(post) {
  const mediaType = String(post.media_type || "");
  const children = readChildrenList(post).filter((child) => child && typeof child === "object");

  if (mediaType === "CAROUSEL_ALBUM" || children.length > 0) {
    return Math.max(children.length, 1);
  }

  return 1;
}

/**
 * @param {Array<Record<string, unknown>>} posts
 */
export function aggregatePosts(posts) {
  const types = {
    IMAGE: 0,
    CAROUSEL_ALBUM: 0,
    VIDEO: 0,
    OTHER: 0,
  };
  let childrenTotal = 0;
  let saveable = 0;
  let newest = null;
  let oldest = null;

  posts.forEach((post) => {
    const mediaType = String(post.media_type || "");
    if (mediaType === "IMAGE" || mediaType === "CAROUSEL_ALBUM" || mediaType === "VIDEO") {
      types[mediaType] += 1;
    } else {
      types.OTHER += 1;
    }

    const childCount = readChildrenList(post).length;
    childrenTotal += childCount;
    saveable += saveableImageCount(post);

    const timestamp = typeof post.timestamp === "string" ? post.timestamp : "";
    if (!timestamp) {
      return;
    }
    if (!newest || timestamp > newest) {
      newest = timestamp;
    }
    if (!oldest || timestamp < oldest) {
      oldest = timestamp;
    }
  });

  return {
    totalPosts: posts.length,
    imagePosts: types.IMAGE,
    carouselPosts: types.CAROUSEL_ALBUM,
    videoPosts: types.VIDEO,
    otherPosts: types.OTHER,
    childrenTotal,
    saveableImages: saveable,
    newestTimestamp: newest,
    oldestTimestamp: oldest,
  };
}

/**
 * @param {number} saveableImages
 * @param {number} [measuredCount]
 * @param {number} [measuredBytes]
 */
export function estimateCapacity(
  saveableImages,
  measuredCount = MEASURED_IMAGE_COUNT,
  measuredBytes = MEASURED_IMAGE_BYTES,
) {
  const averageBytes = measuredCount > 0 ? measuredBytes / measuredCount : 0;
  const additionalImages = Math.max(saveableImages - measuredCount, 0);
  const additionalBytes = additionalImages * averageBytes;
  const totalBytes = saveableImages * averageBytes;
  const gibLimit = 1024 * 1024 * 1024;

  let pagesAssessment = "unknown";
  if (totalBytes < 200 * 1024 * 1024) {
    pagesAssessment = "ok";
  } else if (totalBytes < gibLimit) {
    pagesAssessment = "caution";
  } else {
    pagesAssessment = "too_large";
  }

  return {
    averageBytes,
    additionalImages,
    additionalBytes,
    totalBytes,
    additionalMiB: additionalBytes / (1024 * 1024),
    totalMiB: totalBytes / (1024 * 1024),
    pagesAssessment,
  };
}

/**
 * @param {unknown} paging
 * @param {URLSearchParams} baseParams
 * @param {string} userId
 * @returns {string | null}
 */
export function nextRequestUrl(paging, baseParams, userId) {
  if (!paging || typeof paging !== "object") {
    return null;
  }

  const record = /** @type {{ cursors?: { after?: unknown }, next?: unknown }} */ (paging);
  const after = record.cursors && typeof record.cursors.after === "string" ? record.cursors.after : "";
  if (after) {
    const params = new URLSearchParams(baseParams);
    params.set("after", after);
    return `${API_HOST}/${API_VERSION}/${userId}/media?${params}`;
  }

  if (typeof record.next === "string" && record.next) {
    return record.next;
  }

  return null;
}

/**
 * @param {{
 *   accessToken: string,
 *   userId: string,
 *   fetchImpl?: typeof fetch,
 *   pageSize?: number,
 *   maxPages?: number,
 *   log?: (...args: unknown[]) => void,
 * }} options
 */
export async function inspectInstagramArchive(options) {
  const fetchImpl = options.fetchImpl || fetch;
  const pageSize = options.pageSize || PAGE_SIZE;
  const maxPages = options.maxPages || MAX_PAGES;
  const log = options.log || console.log;
  const seenIds = new Set();
  const seenPagingKeys = new Set();
  const posts = [];
  let pagesFetched = 0;
  let stoppedReason = "end";

  const baseParams = new URLSearchParams({
    fields: FIELDS,
    limit: String(pageSize),
    access_token: options.accessToken,
  });

  let url = `${API_HOST}/${API_VERSION}/${options.userId}/media?${baseParams}`;

  while (url) {
    if (pagesFetched >= maxPages) {
      stoppedReason = "max_pages";
      break;
    }

    const response = await fetchImpl(url, {
      method: "GET",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    const bodyText = await response.text();
    let data;

    try {
      data = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      throw new Error(formatSafeApiError(response.status, ""));
    }

    if (!response.ok || (data && typeof data === "object" && data.error)) {
      throw new Error(formatSafeApiError(response.status, bodyText));
    }

    const pageItems = data && Array.isArray(data.data) ? data.data : [];
    const paging = data && typeof data === "object" ? data.paging : null;
    const pageNumber = pagesFetched + 1;
    let pageAccepted = 0;

    pageItems.forEach((raw) => {
      if (!raw || typeof raw !== "object") {
        return;
      }
      const item = /** @type {Record<string, unknown>} */ (raw);
      const id = item.id != null ? String(item.id) : "";
      if (!id || seenIds.has(id)) {
        return;
      }
      seenIds.add(id);
      posts.push(item);
      pageAccepted += 1;
    });

    pagesFetched += 1;
    log(
      `page=${pageNumber} count=${pageItems.length} unique=${pageAccepted} total=${posts.length} paging=${
        paging ? "yes" : "no"
      } has_next=${hasNextPage(paging) ? "yes" : "no"}`,
    );

    pageItems.forEach((raw) => {
      if (!raw || typeof raw !== "object") {
        return;
      }
      const item = /** @type {Record<string, unknown>} */ (raw);
      log(
        `  id=${item.id ?? "?"} type=${item.media_type ?? "?"} timestamp=${item.timestamp ?? "?"} children=${readChildrenList(item).length}`,
      );
    });

    const key = pagingKey(paging);
    if (!key) {
      stoppedReason = "end";
      url = null;
      break;
    }
    if (seenPagingKeys.has(key)) {
      stoppedReason = "repeat_cursor";
      url = null;
      break;
    }
    seenPagingKeys.add(key);
    url = nextRequestUrl(paging, baseParams, options.userId);
  }

  const stats = aggregatePosts(posts);
  const capacity = estimateCapacity(stats.saveableImages);

  return {
    pagesFetched,
    stoppedReason,
    posts,
    stats,
    capacity,
  };
}

function formatMiB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)}MiB`;
}

function assessmentLabel(code) {
  if (code === "ok") {
    return "現状方式（GitHubリポジトリ内保存）を継続しても、容量面では問題なさそう";
  }
  if (code === "caution") {
    return "1GB未満だが容量が増えるため、継続は可能でも運用上の注意が必要";
  }
  if (code === "too_large") {
    return "推定総容量が1GBを超えるため、現状方式の全件保存は推奨しない";
  }
  return "判定不能";
}

async function main() {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const userId = process.env.INSTAGRAM_USER_ID;

  if (!accessToken || !userId) {
    console.error("INSTAGRAM_ACCESS_TOKEN または INSTAGRAM_USER_ID が未設定です。");
    process.exit(EXIT_FAILURE);
  }

  try {
    const result = await inspectInstagramArchive({ accessToken, userId });
    const { stats, capacity } = result;

    console.log("--- summary ---");
    console.log(`pages=${result.pagesFetched}`);
    console.log(`stopped=${result.stoppedReason}`);
    console.log(`posts=${stats.totalPosts}`);
    console.log(`IMAGE=${stats.imagePosts}`);
    console.log(`CAROUSEL_ALBUM=${stats.carouselPosts}`);
    console.log(`VIDEO=${stats.videoPosts}`);
    console.log(`children_total=${stats.childrenTotal}`);
    console.log(`saveable_images=${stats.saveableImages}`);
    console.log(`newest=${stats.newestTimestamp || "?"}`);
    console.log(`oldest=${stats.oldestTimestamp || "?"}`);
    console.log(
      `capacity_estimate additional=${capacity.additionalImages} images (${formatMiB(capacity.additionalBytes)}), total=${stats.saveableImages} images (${formatMiB(capacity.totalBytes)})`,
    );
    console.log(`pages_assessment=${capacity.pagesAssessment} ${assessmentLabel(capacity.pagesAssessment)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Instagram API error (unknown)";
    console.error("Instagramページネーション調査に失敗しました:", message);
    process.exit(EXIT_FAILURE);
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  main();
}
