/**
 * Instagram バックフィルのローカル検証。
 * 本番 JSON / 実API / 実R2 / Secrets は使わない。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BACKFILL_MAX_UPLOADS,
  BACKFILL_PAGE_SIZE,
  POST_LIMIT,
  countPendingMedia,
  fetchInstagramPosts,
  fetchInstagramPostsPaged,
  mergeArchives,
  readAfterCursor,
  readExistingArchive,
  savePostsMedia,
  selectHourlyMediaPosts,
} from "./fetch-instagram.mjs";
import { readBackfillMaxUploads, runInstagramBackfill } from "./backfill-instagram-archive.mjs";
import { createMemoryMediaStore, R2_PUBLIC_BASE } from "./r2.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const REPO_JSON = path.join(REPO_ROOT, "data", "instagram.json");
const TEST_ROOT = path.join(REPO_ROOT, ".tmp-instagram-archive");
const MINIMAL_JPEG = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`FAIL: ${message}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeTempDir(label) {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TEST_ROOT, `${label}-`));
}

function padId(prefix, index) {
  return `${prefix}${String(index).padStart(10, "0")}`;
}

function isoTimestamp(index) {
  const date = new Date(Date.UTC(2021, 10, 2, 22, 34, 21) + index * 86_400_000);
  return date.toISOString().replace(".000Z", "+0000");
}

/**
 * @param {number} index
 * @param {{ existing?: Record<string, unknown> | null, carousel?: boolean }} [options]
 */
function makeApiPost(index, options = {}) {
  if (options.existing) {
    const post = clone(options.existing);
    const strip = (item) => {
      if (!item) return;
      delete item.local_media_path;
      item.media_url = `https://example.invalid/${item.id}.jpg`;
    };
    strip(post);
    (post.children || []).forEach(strip);
    return post;
  }

  const id = padId("9", index);
  if (options.carousel === false) {
    return {
      id,
      media_type: "IMAGE",
      media_url: `https://example.invalid/${id}.jpg`,
      permalink: `https://www.instagram.com/p/p${index}/`,
      thumbnail_url: null,
      timestamp: isoTimestamp(index),
      children: [],
    };
  }

  const childA = padId("8", index);
  const childB = padId("7", index);
  return {
    id,
    media_type: "CAROUSEL_ALBUM",
    media_url: `https://example.invalid/${childA}.jpg`,
    permalink: `https://www.instagram.com/p/p${index}/`,
    thumbnail_url: null,
    timestamp: isoTimestamp(index),
    children: {
      data: [
        {
          id: childA,
          media_type: "IMAGE",
          media_url: `https://example.invalid/${childA}.jpg`,
        },
        {
          id: childB,
          media_type: "IMAGE",
          media_url: `https://example.invalid/${childB}.jpg`,
        },
      ],
    },
  };
}

function makeApiPages(posts, pageSize) {
  const pages = [];
  for (let offset = 0; offset < posts.length; offset += pageSize) {
    const slice = posts.slice(offset, offset + pageSize);
    const hasMore = offset + pageSize < posts.length;
    pages.push({
      data: slice,
      paging: hasMore ? { cursors: { after: `CURSOR_${offset + pageSize}` } } : {},
    });
  }
  return pages;
}

function createSequentialPagedFetch(pages, tracker) {
  let calls = 0;
  return async function mockFetch(url) {
    const parsed = new URL(url);
    tracker.urls.push(url);
    tracker.limits.push(parsed.searchParams.get("limit"));
    tracker.afters.push(parsed.searchParams.get("after"));
    const page = pages[calls] || { data: [] };
    calls += 1;
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

function createMockImageFetch(counter, failIds = new Set()) {
  return async function mockFetch(url) {
    if (String(url).includes("/media?")) {
      throw new Error("image fetch should not call Graph API");
    }
    counter.calls += 1;
    const idMatch = /\/([A-Za-z0-9_-]+)\.jpg/.exec(String(url));
    const id = idMatch ? idMatch[1] : "";
    if (failIds.has(id)) {
      return new Response("nope", { status: 500 });
    }
    return new Response(MINIMAL_JPEG, {
      status: 200,
      headers: { "Content-Type": "image/jpeg" },
    });
  };
}

function trackingStore() {
  const inner = createMemoryMediaStore();
  const hasIds = [];
  const putIds = [];
  return {
    objects: inner.objects,
    hasIds,
    putIds,
    async has(mediaId) {
      hasIds.push(mediaId);
      return inner.has(mediaId);
    },
    async put(mediaId, buffer, contentType, extension) {
      putIds.push(mediaId);
      return inner.put(mediaId, buffer, contentType, extension);
    },
  };
}

function selectPublicPosts(posts, limit) {
  return posts
    .filter((post) => post && post.permalink && (post.local_media_path || post.media_url))
    .slice(0, limit);
}

async function main() {
  const archive = readExistingArchive(REPO_JSON);
  const existingPosts = archive.posts;
  assert(existingPosts.length === 9, "既存アーカイブは9投稿");
  assert(POST_LIMIT === 9, "毎時取得の上限は9のまま");
  assert(BACKFILL_PAGE_SIZE === 25, "バックフィルのページサイズは調査済みの25");
  assert(BACKFILL_MAX_UPLOADS === 80, "1回の新規アップロード上限は80");

  assert(readAfterCursor({ cursors: { after: "abc" } }) === "abc", "after cursor を読む");
  assert(
    readAfterCursor({
      next: "https://graph.instagram.com/v21.0/1/media?access_token=SECRET&after=xyz",
    }) === "xyz",
    "paging.next からは after だけ取り出す",
  );

  const existingIds = existingPosts.map((post) => String(post.id));
  const apiPosts = [];
  existingPosts.forEach((post, index) => {
    apiPosts.push(makeApiPost(index, { existing: post }));
  });
  for (let index = 9; index < 145; index += 1) {
    apiPosts.push(makeApiPost(index, { carousel: index % 3 !== 0 }));
  }
  assert(apiPosts.length === 145, "145投稿相当のモックを作る");
  assert(new Set(apiPosts.map((post) => post.id)).size === 145, "モック投稿IDは重複しない");

  const pageLogs = [];
  const pages = makeApiPages(apiPosts, 25);
  pages[pages.length - 1].paging = { cursors: { after: "EMPTY_NEXT" } };
  pages.push({
    data: [],
    paging: { cursors: { after: "EMPTY_NEXT" } },
  });
  const tracker = { urls: [], limits: [], afters: [] };
  const paged = await fetchInstagramPostsPaged("token-value", "user-value", {
    fetchImpl: createSequentialPagedFetch(pages, tracker),
    pageSize: 25,
    maxPages: 50,
    log: (message) => pageLogs.push(message),
  });

  assert(paged.posts.length === 145, "ページネーションで145件取得する");
  assert(paged.stoppedReason === "end", "空ページで終端停止する");
  assert(paged.pagesFetched === 7, "6データページ＋空ページで停止する");
  assert(tracker.limits.every((limit) => limit === "25"), "バックフィルは limit=25");
  assert(tracker.afters[0] === null, "1ページ目は after なし");
  assert(tracker.afters[1] === "CURSOR_25", "2ページ目は after cursor を使う");
  assert(
    pageLogs.every((line) => !line.includes("token-value") && !line.includes("SECRET")),
    "ページログにトークンを出さない",
  );
  assert(
    tracker.urls.every((url) => url.includes("access_token=token-value")),
    "リクエストには access_token を付ける（ログには出さない）",
  );

  const cappedTracker = { urls: [], limits: [], afters: [] };
  const capped = await fetchInstagramPostsPaged("token-value", "user-value", {
    fetchImpl: createSequentialPagedFetch(makeApiPages(apiPosts, 25), cappedTracker),
    pageSize: 25,
    maxPages: 2,
    log: () => {},
  });
  assert(capped.pagesFetched === 2, "maxPages で打ち切る");
  assert(capped.stoppedReason === "max_pages", "停止理由は max_pages");
  assert(capped.posts.length === 50, "2ページ分だけ取得する");

  const hourlyTracker = { urls: [], limits: [], afters: [] };
  const hourlyIncoming = await fetchInstagramPosts("token-value", "user-value", {
    fetchImpl: createSequentialPagedFetch(
      [{ data: apiPosts.slice(0, 20), paging: { cursors: { after: "IGNORED" } } }],
      hourlyTracker,
    ),
  });
  assert(hourlyIncoming.length === 9, "毎時取得は最新9件だけ返す");
  assert(hourlyTracker.limits[0] === "9", "毎時APIは limit=9");
  assert(hourlyTracker.afters[0] === null, "毎時取得は after を付けない");
  assert(hourlyTracker.urls.length === 1, "毎時取得は1リクエストだけ");

  const merged = mergeArchives(existingPosts, paged.posts);
  assert(merged.posts.length === 145, "既存9件を含む145件にマージする");
  assert(merged.added === 136, "新規は136件");
  assert(merged.updated === 9, "既存9件は更新扱い");
  assert(merged.kept === 0, "既存9件は取得結果に含まれるので保持0");
  assert(new Set(merged.posts.map((post) => String(post.id))).size === 145, "マージ後も投稿IDは重複しない");
  existingIds.forEach((id) => {
    assert(
      merged.posts.some((post) => String(post.id) === id),
      `既存投稿 ${id} が消えない`,
    );
  });
  const timestamps = merged.posts.map((post) => Date.parse(String(post.timestamp)));
  const sorted = [...timestamps].sort((a, b) => b - a);
  assert(
    timestamps.every((time, index) => time === sorted[index]),
    "マージ後は timestamp 降順",
  );

  const publicNine = selectPublicPosts(merged.posts, 9);
  const publicThree = selectPublicPosts(merged.posts, 3);
  assert(publicNine.length === 9, "公開Instagramページ相当は最新9件");
  assert(publicThree.length === 3, "ホーム相当は最新3件");

  const instagramHtml = fs.readFileSync(path.join(REPO_ROOT, "instagram.html"), "utf8");
  const indexHtml = fs.readFileSync(path.join(REPO_ROOT, "index.html"), "utf8");
  const galleryJs = fs.readFileSync(path.join(REPO_ROOT, "js", "instagram-gallery.js"), "utf8");
  assert(instagramHtml.includes('data-instagram-limit="9"'), "instagram.html の表示件数は9のまま");
  assert(indexHtml.includes('data-instagram-limit="3"'), "index.html の表示件数は3のまま");
  assert(galleryJs.includes("images/ui/new-badge.png"), "NEWバッジ画像参照は維持");
  assert(galleryJs.includes("instagram-cta-card"), "SPのCTAカード処理は維持");

  const hourlyTargets = selectHourlyMediaPosts(merged.posts, hourlyIncoming);
  assert(hourlyTargets.length === 9, "毎時の画像処理対象は最新9投稿だけ");
  assert(
    hourlyTargets.every((post, index) => String(post.id) === String(hourlyIncoming[index].id)),
    "毎時対象は取得9件の Media ID と一致する",
  );

  const seeded = trackingStore();
  const firstExistingChild = String(existingPosts[0].children[0].id);
  await seeded.put(firstExistingChild, MINIMAL_JPEG, "image/jpeg", "jpg");
  const skipPosts = [
    {
      id: existingPosts[0].id,
      media_type: "IMAGE",
      media_url: `https://example.invalid/${firstExistingChild}.jpg`,
      permalink: existingPosts[0].permalink,
      timestamp: existingPosts[0].timestamp,
      children: [
        {
          id: firstExistingChild,
          media_type: "IMAGE",
          media_url: `https://example.invalid/${firstExistingChild}.jpg`,
        },
      ],
    },
  ];
  const skipStats = await savePostsMedia(skipPosts, {
    store: seeded,
    fetchImpl: createMockImageFetch({ calls: 0 }),
    trustStoredUrl: true,
  });
  assert(skipStats.downloaded === 0, "R2既存画像は再PUTしない");
  assert(skipStats.skipped === 1, "R2既存画像はスキップする");
  assert(seeded.putIds.length === 1, "事前seed以外のPUTをしない");

  const trusted = [
    {
      id: "trusted-post",
      media_type: "IMAGE",
      media_url: `${R2_PUBLIC_BASE}/posts/trusted1.jpg`,
      local_media_path: `${R2_PUBLIC_BASE}/posts/trusted1.jpg`,
      permalink: "https://www.instagram.com/p/trusted/",
      timestamp: "2026-01-01T00:00:00+0000",
      children: [],
    },
  ];
  const trustedStore = trackingStore();
  const trustedStats = await savePostsMedia(trusted, {
    store: trustedStore,
    fetchImpl: createMockImageFetch({ calls: 0 }),
    trustStoredUrl: true,
  });
  assert(trustedStats.skipped === 1, "JSON上のR2 URLは確認PUTしない");
  assert(trustedStore.hasIds.length === 0, "R2 URLがある画像はHEADしない");
  assert(trustedStore.putIds.length === 0, "R2 URLがある画像はPUTしない");

  const resumeStore = trackingStore();
  const resumeCounter = { calls: 0 };
  const resumePosts = clone(paged.posts).slice(0, 20);
  const firstResume = await savePostsMedia(resumePosts, {
    store: resumeStore,
    fetchImpl: createMockImageFetch(resumeCounter),
    maxUploads: 10,
    trustStoredUrl: true,
  });
  assert(firstResume.downloaded === 10, "1回目は上限10枚だけ保存する");
  assert(firstResume.deferred > 0, "残りは見送りにする");
  assert(firstResume.remaining > 0, "未保存が残る");
  const afterFirst = resumeStore.putIds.length;

  const secondResume = await savePostsMedia(resumePosts, {
    store: resumeStore,
    fetchImpl: createMockImageFetch(resumeCounter),
    maxUploads: 10,
    trustStoredUrl: true,
  });
  assert(secondResume.downloaded === 10, "再実行は次の10枚を保存する");
  assert(resumeStore.putIds.length === afterFirst + 10, "既存10枚は再PUTしない");

  const failId = padId("8", 20);
  const failStore = createMemoryMediaStore();
  const failPosts = [
    {
      id: padId("9", 20),
      media_type: "CAROUSEL_ALBUM",
      media_url: `https://example.invalid/${failId}.jpg`,
      permalink: "https://www.instagram.com/p/p20/",
      timestamp: isoTimestamp(20),
      children: [
        {
          id: failId,
          media_type: "IMAGE",
          media_url: `https://example.invalid/${failId}.jpg`,
        },
        {
          id: padId("7", 20),
          media_type: "IMAGE",
          media_url: `https://example.invalid/${padId("7", 20)}.jpg`,
        },
      ],
    },
  ];
  const failStats = await savePostsMedia(clone(failPosts), {
    store: failStore,
    fetchImpl: createMockImageFetch({ calls: 0 }, new Set([failId])),
    trustStoredUrl: true,
  });
  assert(failStats.failed === 1, "一部失敗を記録する");
  assert(failStats.downloaded === 1, "成功分は保存する");
  assert(failStats.remaining === 1, "失敗分は残り1枚として残る");

  const retryPosts = [
    {
      id: padId("9", 20),
      media_type: "CAROUSEL_ALBUM",
      media_url: `https://example.invalid/${failId}.jpg`,
      permalink: "https://www.instagram.com/p/p20/",
      timestamp: isoTimestamp(20),
      children: [
        {
          id: failId,
          media_type: "IMAGE",
          media_url: `https://example.invalid/${failId}.jpg`,
        },
        {
          id: padId("7", 20),
          media_type: "IMAGE",
          media_url: `https://example.invalid/${padId("7", 20)}.jpg`,
          local_media_path: `${R2_PUBLIC_BASE}/posts/${padId("7", 20)}.jpg`,
        },
      ],
    },
  ];
  const retryStore = trackingStore();
  await retryStore.put(padId("7", 20), MINIMAL_JPEG, "image/jpeg", "jpg");
  const retryStats = await savePostsMedia(retryPosts, {
    store: retryStore,
    fetchImpl: createMockImageFetch({ calls: 0 }),
    trustStoredUrl: true,
  });
  assert(retryStats.downloaded === 1, "再実行は失敗していた1枚だけ保存する");
  assert(retryStats.skipped === 1, "成功済み子画像は再PUTしない");
  assert(retryPosts[0].children[0].local_media_path === `${R2_PUBLIC_BASE}/posts/${failId}.jpg`, "補完後はR2 URLになる");

  const jsonDir = makeTempDir("backfill-json");
  const jsonPath = path.join(jsonDir, "instagram.json");
  fs.writeFileSync(jsonPath, `${JSON.stringify({ updated_at: "2026-01-01T00:00:00.000Z", posts: existingPosts }, null, 2)}\n`);
  const backfillTracker = { urls: [], limits: [], afters: [] };
  const backfillStore = trackingStore();
  const backfillLogs = [];
  const backfillPageFetch = createSequentialPagedFetch(pages, backfillTracker);
  const backfillResult = await runInstagramBackfill({
    accessToken: "token-value",
    userId: "user-value",
    store: backfillStore,
    outputPath: jsonPath,
    mediaDir: jsonDir,
    fetchImpl: async (url, init) => {
      if (String(url).includes("/media?")) {
        return backfillPageFetch(url, init);
      }
      return createMockImageFetch({ calls: 0 })(url, init);
    },
    maxUploads: 12,
    pageSize: 25,
    maxPages: 50,
    log: (message) => backfillLogs.push(message),
  });
  assert(backfillResult.merged.posts.length === 145, "バックフィル実行でも145件に累積する");
  assert(backfillResult.mediaStats.downloaded === 12, "1回のバックフィルは上限枚数だけアップロードする");
  assert(backfillResult.remaining > 0, "未完了なら残り枚数を返す");
  assert(backfillResult.complete === false, "残りがあるときは complete=false");
  assert(backfillResult.wroteJson === true, "途中結果をJSONに残す");
  const written = readExistingArchive(jsonPath);
  assert(written.posts.length === 145, "再実行用に145件がJSONへ残る");
  assert(written.posts.some((post) => String(post.id) === existingIds[8]), "既存の最古1件もJSONに残る");
  assert(
    backfillLogs.every((line) => !line.includes("token-value")),
    "バックフィルログにトークンを出さない",
  );

  const previousUploads = process.env.BACKFILL_MAX_UPLOADS;
  delete process.env.BACKFILL_MAX_UPLOADS;
  assert(readBackfillMaxUploads() === 80, "未設定時のアップロード上限は80");
  process.env.BACKFILL_MAX_UPLOADS = "40";
  assert(readBackfillMaxUploads() === 40, "環境変数で上限を上書きできる");
  if (previousUploads === undefined) {
    delete process.env.BACKFILL_MAX_UPLOADS;
  } else {
    process.env.BACKFILL_MAX_UPLOADS = previousUploads;
  }

  const repoAfter = readExistingArchive(REPO_JSON);
  assert(repoAfter.posts.length === 9, "テストは本番 data/instagram.json を書き換えない");

  console.log(`Instagram backfill tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
