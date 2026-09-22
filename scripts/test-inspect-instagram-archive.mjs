/**
 * Instagram ページネーション調査スクリプトのローカル検証。
 * Secrets / 実API / 本番JSON・画像は使わない。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregatePosts,
  estimateCapacity,
  formatSafeApiError,
  hasNextPage,
  inspectInstagramArchive,
  MEASURED_IMAGE_BYTES,
  MEASURED_IMAGE_COUNT,
  nextRequestUrl,
  pagingKey,
  saveableImageCount,
} from "./inspect-instagram-archive.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const JSON_PATH = path.join(REPO_ROOT, "data", "instagram.json");
const MEDIA_DIR = path.join(REPO_ROOT, "images", "instagram", "posts");

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

function snapshotPath(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, mtime: 0, size: 0, hash: "" };
  }
  const stat = fs.statSync(filePath);
  return {
    exists: true,
    mtime: stat.mtimeMs,
    size: stat.size,
    hash: `${stat.size}:${stat.mtimeMs}`,
  };
}

function createPagedFetch(pages) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const index = calls.length - 1;
    const page = pages[index];
    if (!page) {
      return new Response(JSON.stringify({ error: { type: "OAuthException", code: 1 } }), { status: 400 });
    }
    if (page.errorStatus) {
      return new Response(JSON.stringify(page.body), { status: page.errorStatus });
    }
    return new Response(JSON.stringify(page.body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetchImpl, calls };
}

async function main() {
  assert(pagingKey(null) === null, "pagingなしは null");
  assert(pagingKey({}) === null, "空pagingは null");
  assert(pagingKey({ cursors: { after: "abc" } }) === "after:abc", "after cursor をキーにする");
  assert(hasNextPage({ cursors: { after: "abc" } }) === true, "after があれば次ページあり");
  assert(hasNextPage({}) === false, "paging.next も after もなければ次ページなし");

  const nextKey = pagingKey({ next: "https://graph.instagram.com/v21.0/1/media?access_token=SECRET&after=xyz" });
  assert(typeof nextKey === "string" && nextKey.startsWith("next:"), "next URL はハッシュだけ残す");
  assert(!String(nextKey).includes("SECRET"), "pagingキーにトークンを含めない");
  assert(!String(nextKey).includes("access_token"), "pagingキーに access_token を含めない");

  const params = new URLSearchParams({
    fields: "id",
    limit: "25",
    access_token: "SECRET_TOKEN",
  });
  const built = nextRequestUrl({ cursors: { after: "CUR1" } }, params, "USER1");
  assert(built.includes("after=CUR1"), "次URLは after cursor から組み立てる");
  assert(built.includes("access_token=SECRET_TOKEN"), "組み立てURLは内部でのみトークンを持つ");

  const carousel = {
    media_type: "CAROUSEL_ALBUM",
    children: { data: [{ id: "1" }, { id: "2" }, { id: "3" }] },
  };
  assert(saveableImageCount(carousel) === 3, "カルーセルは children 枚数を保存対象にする");
  assert(saveableImageCount({ media_type: "IMAGE" }) === 1, "IMAGE は1枚");
  assert(saveableImageCount({ media_type: "VIDEO" }) === 1, "VIDEO はサムネイル1枚");
  assert(
    saveableImageCount({ media_type: "CAROUSEL_ALBUM", children: { data: [] } }) === 1,
    "children 0 のカルーセルは代表1枚",
  );

  const stats = aggregatePosts([
    {
      id: "a",
      media_type: "IMAGE",
      timestamp: "2026-09-01T00:00:00+0000",
    },
    {
      id: "b",
      media_type: "CAROUSEL_ALBUM",
      timestamp: "2026-01-01T00:00:00+0000",
      children: { data: [{ id: "b1" }, { id: "b2" }] },
    },
    {
      id: "c",
      media_type: "VIDEO",
      timestamp: "2026-06-01T00:00:00+0000",
    },
  ]);
  assert(stats.totalPosts === 3, "集計: 総投稿数");
  assert(stats.imagePosts === 1 && stats.carouselPosts === 1 && stats.videoPosts === 1, "集計: タイプ別件数");
  assert(stats.childrenTotal === 2, "集計: children合計");
  assert(stats.saveableImages === 4, "集計: 保存対象 1+2+1");
  assert(stats.newestTimestamp === "2026-09-01T00:00:00+0000", "集計: 最新日時");
  assert(stats.oldestTimestamp === "2026-01-01T00:00:00+0000", "集計: 最古日時");

  const capacity = estimateCapacity(36 + 36);
  assert(capacity.additionalImages === 36, "追加枚数は既存36を除く");
  assert(Math.round(capacity.additionalBytes) === MEASURED_IMAGE_BYTES, "追加容量は実測36枚分");
  assert(capacity.pagesAssessment === "ok", "72枚規模は ok");
  assert(estimateCapacity(2000).pagesAssessment === "too_large" || estimateCapacity(2000).totalMiB > 1000, "過大枚数は注意判定");
  assert(formatSafeApiError(400, '{"error":{"type":"OAuthException","code":190}}').includes("code=190"), "APIエラーは安全に要約する");
  assert(!formatSafeApiError(400, '{"error":{"message":"token abc"}}').includes("abc"), "エラー要約にtokenを出さない");

  const logs = [];
  const { fetchImpl, calls } = createPagedFetch([
    {
      body: {
        data: [
          {
            id: "111",
            media_type: "IMAGE",
            timestamp: "2026-09-19T00:00:00+0000",
          },
          {
            id: "222",
            media_type: "CAROUSEL_ALBUM",
            timestamp: "2026-08-01T00:00:00+0000",
            children: { data: [{ id: "c1" }, { id: "c2" }] },
          },
        ],
        paging: { cursors: { after: "PAGE2" } },
      },
    },
    {
      body: {
        data: [
          {
            id: "222",
            media_type: "CAROUSEL_ALBUM",
            timestamp: "2026-08-01T00:00:00+0000",
            children: { data: [{ id: "c1" }, { id: "c2" }] },
          },
          {
            id: "333",
            media_type: "VIDEO",
            timestamp: "2024-01-15T00:00:00+0000",
          },
        ],
      },
    },
  ]);

  const jsonBefore = snapshotPath(JSON_PATH);
  const mediaBefore = fs.existsSync(MEDIA_DIR)
    ? fs.readdirSync(MEDIA_DIR).filter((name) => !name.startsWith(".")).sort().join(",")
    : "";

  const result = await inspectInstagramArchive({
    accessToken: "SECRET_TOKEN_VALUE",
    userId: "SECRET_USER_ID",
    fetchImpl,
    log: (...args) => logs.push(args.map(String).join(" ")),
  });

  assert(result.pagesFetched === 2, "2ページ辿る");
  assert(result.stoppedReason === "end", "次ページなしで終了");
  assert(result.posts.length === 3, "重複IDは除外して3件");
  assert(result.stats.saveableImages === 4, "保存対象は IMAGE1 + children2 + VIDEO1");
  assert(result.stats.oldestTimestamp.startsWith("2024-01-15"), "最古は2ページ目の投稿");
  assert(calls.length === 2, "API GETは2回");
  assert(logs.some((line) => line.includes("page=1") && line.includes("has_next=yes")), "1ページ目に paging/next あり");
  assert(logs.some((line) => line.includes("page=2") && line.includes("has_next=no")), "2ページ目に次ページなし");
  assert(logs.some((line) => line.includes("id=111") && line.includes("type=IMAGE")), "投稿IDとtypeをログする");
  assert(
    logs.every((line) => !line.includes("SECRET_TOKEN_VALUE") && !line.includes("access_token")),
    "ログにトークンを出さない",
  );
  assert(
    logs.every((line) => !line.includes("graph.instagram.com") && !line.includes("SECRET_USER_ID")),
    "ログに認証付きURLやuser idを出さない",
  );

  const jsonAfter = snapshotPath(JSON_PATH);
  const mediaAfter = fs.existsSync(MEDIA_DIR)
    ? fs.readdirSync(MEDIA_DIR).filter((name) => !name.startsWith(".")).sort().join(",")
    : "";
  assert(jsonBefore.hash === jsonAfter.hash, "data/instagram.json を変更しない");
  assert(mediaBefore === mediaAfter, "images/instagram/posts を変更しない");

  const repeatLogs = [];
  const repeat = createPagedFetch([
    {
      body: {
        data: [{ id: "1", media_type: "IMAGE", timestamp: "2026-01-01T00:00:00+0000" }],
        paging: { cursors: { after: "SAME" } },
      },
    },
    {
      body: {
        data: [{ id: "2", media_type: "IMAGE", timestamp: "2025-01-01T00:00:00+0000" }],
        paging: { cursors: { after: "SAME" } },
      },
    },
    {
      body: {
        data: [{ id: "3", media_type: "IMAGE", timestamp: "2024-01-01T00:00:00+0000" }],
        paging: { cursors: { after: "SAME" } },
      },
    },
  ]);
  const repeatResult = await inspectInstagramArchive({
    accessToken: "SECRET_TOKEN_VALUE",
    userId: "USER",
    fetchImpl: repeat.fetchImpl,
    log: (...args) => repeatLogs.push(args.map(String).join(" ")),
  });
  assert(repeatResult.pagesFetched === 2, "同じcursor再訪前までで止める");
  assert(repeatResult.stoppedReason === "repeat_cursor", "停止理由は repeat_cursor");
  assert(repeat.calls.length === 2, "同じcursorでは3ページ目に進まない");

  const capped = createPagedFetch([
    { body: { data: [{ id: "p1", media_type: "IMAGE", timestamp: "2026-01-03T00:00:00+0000" }], paging: { cursors: { after: "A" } } } },
    { body: { data: [{ id: "p2", media_type: "IMAGE", timestamp: "2026-01-02T00:00:00+0000" }], paging: { cursors: { after: "B" } } } },
    { body: { data: [{ id: "p3", media_type: "IMAGE", timestamp: "2026-01-01T00:00:00+0000" }] } },
  ]);
  const cappedResult = await inspectInstagramArchive({
    accessToken: "SECRET",
    userId: "USER",
    fetchImpl: capped.fetchImpl,
    maxPages: 2,
    log: () => {},
  });
  assert(cappedResult.pagesFetched === 2, "最大ページ数で打ち切る");
  assert(cappedResult.stoppedReason === "max_pages", "停止理由は max_pages");
  assert(cappedResult.posts.length === 2, "上限以降の投稿は取得しない");

  let threw = false;
  try {
    await inspectInstagramArchive({
      accessToken: "SECRET",
      userId: "USER",
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { type: "OAuthException", code: 190 } }), { status: 400 }),
      log: () => {},
    });
  } catch (error) {
    threw = true;
    assert(String(error.message).includes("code=190"), "APIエラーで停止する");
    assert(!String(error.message).includes("SECRET"), "エラーメッセージにトークンを含めない");
  }
  assert(threw, "APIエラー時は例外で停止する");

  const measured = estimateCapacity(MEASURED_IMAGE_COUNT, MEASURED_IMAGE_COUNT, MEASURED_IMAGE_BYTES);
  assert(measured.additionalImages === 0, "既存36枚ちょうどなら追加0");
  assert(Math.abs(measured.totalBytes - MEASURED_IMAGE_BYTES) < 1, "既存実測と総容量が一致");

  console.log(`Instagram inspect tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
