/**
 * Instagram アーカイブ基盤のローカル検証。
 * 本番の data/instagram.json は書き換えず、API / CDN へもアクセスしない。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  dedupePostsById,
  downloadMediaFile,
  extensionFromContentType,
  extensionFromMagic,
  findExistingMediaFile,
  isSafeMediaId,
  mergeArchives,
  MEDIA_PUBLIC_PREFIX,
  postsAreEqual,
  readExistingArchive,
  savePostsMedia,
  sortPostsByTimestampDesc,
  writeArchiveIfChanged,
} from "./fetch-instagram.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_JSON = path.join(__dirname, "..", "data", "instagram.json");
const TEST_ROOT = path.join(__dirname, "..", ".tmp-instagram-archive");
const MINIMAL_JPEG = Buffer.from(
  "ffd8ffe000104a46494600010100000100010000ffd9",
  "hex",
);

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

function makeTempDir(label) {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TEST_ROOT, `${label}-`));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function collectMediaIds(posts) {
  const ids = [];
  posts.forEach((post) => {
    if (Array.isArray(post.children) && post.children.length > 0) {
      post.children.forEach((child) => {
        if (child && child.id) {
          ids.push(String(child.id));
        }
      });
      return;
    }
    if (post && post.id) {
      ids.push(String(post.id));
    }
  });
  return ids;
}

function selectPublicPosts(posts, limit) {
  return posts
    .filter((post) => post && post.permalink && (post.local_media_path || post.media_url))
    .slice(0, limit);
}

function createMockFetch(counter) {
  return async function mockFetch() {
    counter.calls += 1;
    return new Response(MINIMAL_JPEG, {
      status: 200,
      headers: { "Content-Type": "image/jpeg" },
    });
  };
}

async function main() {
  const archive = readExistingArchive(REPO_JSON);
  const existingPosts = archive.posts;
  const existingIds = existingPosts.map((post) => String(post.id));

  assert(existingPosts.length === 9, "既存 data/instagram.json は9件");
  assert(new Set(existingIds).size === 9, "既存投稿IDは重複しない");
  assert(
    existingIds.every((id) => isSafeMediaId(id)),
    "既存投稿IDはファイル名に使える",
  );

  const timestamps = existingPosts.map((post) => Date.parse(String(post.timestamp)));
  const sorted = [...timestamps].sort((a, b) => b - a);
  assert(
    timestamps.every((time, index) => time === sorted[index]),
    "既存JSONは timestamp 降順",
  );

  const childIds = collectMediaIds(existingPosts);
  assert(childIds.length > 9, "カルーセル子画像の Media ID を収集できる");
  assert(new Set(childIds).size === childIds.length, "子 Media ID は衝突しない");
  assert(
    childIds.every((id) => isSafeMediaId(id)),
    "子 Media ID はファイル名に使える",
  );
  assert(
    childIds.every((id) => findExistingMediaFile(id) === null),
    "本番 images/instagram/posts にはまだ実ファイルがない（移行前）",
  );

  const mergedSame = mergeArchives(existingPosts, clone(existingPosts));
  assert(mergedSame.posts.length === 9, "同じ9件をマージしても件数は9のまま");
  assert(mergedSame.added === 0, "同一IDは追加しない");
  assert(mergedSame.updated === 9, "同一IDは更新扱い");
  assert(mergedSame.kept === 0, "同一集合では保持0");
  assert(
    new Set(mergedSame.posts.map((post) => String(post.id))).size === 9,
    "マージ後も投稿IDは重複しない",
  );

  const incomingWithoutOldest = clone(existingPosts).slice(0, 8);
  incomingWithoutOldest.push({
    id: "99900000000000001",
    media_url: "https://example.invalid/new.jpg",
    permalink: "https://www.instagram.com/p/newpost/",
    media_type: "IMAGE",
    thumbnail_url: null,
    timestamp: "2026-09-22T00:00:00+0000",
    children: [],
  });
  const droppedId = String(existingPosts[8].id);
  const mergedKeep = mergeArchives(existingPosts, incomingWithoutOldest);
  const mergedIds = mergedKeep.posts.map((post) => String(post.id));
  assert(mergedKeep.posts.length === 10, "最新9件から外れた既存投稿は削除せず10件になる");
  assert(mergedKeep.added === 1, "新規IDは1件追加");
  assert(mergedKeep.kept === 1, "最新9件外の既存1件を保持");
  assert(mergedIds.includes(droppedId), "外れた既存投稿IDが残る");
  assert(mergedIds.includes("99900000000000001"), "新規投稿IDが追加される");
  assert(new Set(mergedIds).size === 10, "10件でも投稿IDは重複しない");
  assert(String(mergedKeep.posts[0].id) === "99900000000000001", "timestamp 降順で新規が先頭");
  assert(
    Date.parse(String(mergedKeep.posts[0].timestamp)) >=
      Date.parse(String(mergedKeep.posts[1].timestamp)),
    "先頭2件も timestamp 降順",
  );

  const shuffled = sortPostsByTimestampDesc(clone(existingPosts).reverse());
  assert(
    shuffled.map((post) => String(post.id)).join(",") === existingIds.join(","),
    "timestamp 降順ソートが安定している",
  );
  assert(
    dedupePostsById([...existingPosts, existingPosts[0]]).length === 9,
    "同一IDは先勝ちで重複排除",
  );

  assert(extensionFromContentType("image/jpeg; charset=binary") === "jpg", "Content-Type から jpg");
  assert(extensionFromContentType("image/png") === "png", "Content-Type から png");
  assert(extensionFromContentType("text/html") === null, "非画像 Content-Type は使わない");
  assert(extensionFromMagic(MINIMAL_JPEG) === "jpg", "マジックバイトから jpg");
  assert(extensionFromMagic(Buffer.from("not-an-image-file-at-all")) === null, "不正データは拡張子不明");

  const mediaDir = makeTempDir("media");
  const jsonPath = path.join(mediaDir, "instagram.json");
  const counter = { calls: 0 };
  const fetchImpl = createMockFetch(counter);
  const samplePosts = clone(existingPosts);

  const firstSave = await savePostsMedia(samplePosts, { mediaDir, fetchImpl });
  assert(firstSave.downloaded === childIds.length, `1回目は全${childIds.length}枚を保存する`);
  assert(firstSave.skipped === 0, "1回目はスキップしない");
  assert(firstSave.failed === 0, "モック保存は失敗しない");

  const savedNames = fs.readdirSync(mediaDir).filter((name) => name.endsWith(".jpg"));
  assert(savedNames.length === childIds.length, "保存ファイル数は Media ID 数と一致");
  assert(
    childIds.every((id) => fs.existsSync(path.join(mediaDir, `${id}.jpg`))),
    "ファイル名は images/instagram/posts/{Media ID}.jpg で安定",
  );
  assert(
    childIds.every((id) => findExistingMediaFile(id, mediaDir) === `${MEDIA_PUBLIC_PREFIX}/${id}.jpg`),
    "ローカル参照パスが Media ID 基準で安定している",
  );
  assert(
    samplePosts.every(
      (post) =>
        typeof post.local_media_path === "string" &&
        post.local_media_path.startsWith(`${MEDIA_PUBLIC_PREFIX}/`),
    ),
    "各投稿に local_media_path が入る",
  );
  assert(
    samplePosts.every(
      (post) =>
        !Array.isArray(post.children) ||
        post.children.every(
          (child) =>
            !child ||
            (typeof child.local_media_path === "string" &&
              child.local_media_path === `${MEDIA_PUBLIC_PREFIX}/${child.id}.jpg`),
        ),
    ),
    "カルーセル children もローカル画像を参照する",
  );

  const secondSave = await savePostsMedia(samplePosts, { mediaDir, fetchImpl });
  assert(secondSave.downloaded === 0, "2回目は再ダウンロードしない");
  assert(secondSave.skipped === childIds.length, "2回目は既存 Media ID をスキップする");
  assert(counter.calls === childIds.length, "CDN相当の取得は1回目の枚数だけで止まる");

  const sentinel = "do-not-overwrite";
  const sentinelId = childIds[0];
  fs.writeFileSync(path.join(mediaDir, `${sentinelId}.jpg`), sentinel);
  await downloadMediaFile("https://example.invalid/changed.jpg?query=1", sentinelId, {
    mediaDir,
    fetchImpl,
  });
  assert(
    fs.readFileSync(path.join(mediaDir, `${sentinelId}.jpg`), "utf8") === sentinel,
    "クエリ違いのCDN URLでも既存 Media ID は上書きしない",
  );

  const videoDir = makeTempDir("video");
  const videoCounter = { calls: 0 };
  const videoPost = [
    {
      id: "88800000000000001",
      media_type: "VIDEO",
      media_url: "https://example.invalid/video.mp4",
      thumbnail_url: "https://example.invalid/thumb.jpg",
      permalink: "https://www.instagram.com/p/video/",
      timestamp: "2026-09-01T00:00:00+0000",
      children: [],
    },
  ];
  const videoStats = await savePostsMedia(videoPost, {
    mediaDir: videoDir,
    fetchImpl: createMockFetch(videoCounter),
  });
  assert(videoStats.downloaded === 1, "VIDEO はサムネイルだけ保存する");
  assert(videoCounter.calls === 1, "VIDEO 本体 URL では fetch しない");
  assert(
    fs.existsSync(path.join(videoDir, "88800000000000001.jpg")),
    "VIDEO サムネイルは投稿 Media ID で保存する",
  );
  assert(!fs.existsSync(path.join(videoDir, "88800000000000001.mp4")), "動画本体は保存しない");

  const failedDir = makeTempDir("fail");
  const beforeFail = clone(existingPosts);
  const failStats = await savePostsMedia(beforeFail, {
    mediaDir: failedDir,
    fetchImpl: async () => new Response("nope", { status: 500 }),
  });
  assert(failStats.failed === childIds.length, "保存失敗を記録する");
  assert(fs.readdirSync(failedDir).filter((name) => name.endsWith(".tmp")).length === 0, "失敗時に tmp を残さない");
  assert(
    beforeFail.every((post) => !post.local_media_path && String(post.media_url).startsWith("https://")),
    "保存失敗しても既存CDN参照を壊さない",
  );

  fs.writeFileSync(
    jsonPath,
    `${JSON.stringify({ updated_at: "2026-01-01T00:00:00.000Z", posts: samplePosts }, null, 2)}\n`,
    "utf8",
  );
  const existingWritten = readExistingArchive(jsonPath);
  const wroteSame = writeArchiveIfChanged(jsonPath, existingWritten, existingWritten.posts);
  assert(wroteSame === false, "実データが同じなら JSON を書き換えない");
  assert(
    JSON.parse(fs.readFileSync(jsonPath, "utf8")).updated_at === "2026-01-01T00:00:00.000Z",
    "変更なしでは updated_at も動かない",
  );

  const changedPosts = clone(existingWritten.posts);
  changedPosts[0] = {
    ...changedPosts[0],
    permalink: "https://www.instagram.com/p/changed/",
  };
  const wroteChanged = writeArchiveIfChanged(jsonPath, existingWritten, changedPosts);
  assert(wroteChanged === true, "permalink など実データ変更時だけ JSON を書く");
  assert(
    JSON.parse(fs.readFileSync(jsonPath, "utf8")).updated_at !== "2026-01-01T00:00:00.000Z",
    "実データ変更時は updated_at を更新する",
  );

  const publicNine = selectPublicPosts(mergedKeep.posts, 9);
  const publicThree = selectPublicPosts(mergedKeep.posts, 3);
  assert(publicNine.length === 9, "公開Instagramページ相当は最新9件");
  assert(publicThree.length === 3, "ホーム相当は最新3件");
  assert(
    publicNine.every((post, index) => post.id === mergedKeep.posts[index].id),
    "公開9件は timestamp 降順の先頭9件",
  );
  assert(
    !publicNine.some((post) => String(post.id) === droppedId),
    "最新9件から外れた保持投稿は公開一覧に出さない",
  );

  const remoteOnly = {
    media_url: "https://scontent.cdninstagram.com/v/t.jpg?oe=old",
    permalink: "https://www.instagram.com/p/x/",
  };
  const localReady = {
    media_url: "https://scontent.cdninstagram.com/v/t.jpg?oe=old",
    local_media_path: "images/instagram/posts/1.jpg",
    permalink: "https://www.instagram.com/p/x/",
  };
  assert(selectPublicPosts([remoteOnly], 9).length === 1, "ローカル未保存の既存投稿は CDN のまま表示できる");
  assert(selectPublicPosts([localReady], 9)[0].local_media_path.endsWith(".jpg"), "ローカルがあればそれを使う");

  assert(postsAreEqual(samplePosts, samplePosts), "同一投稿配列は equal");
  assert(!postsAreEqual(samplePosts, changedPosts), "permalink 変更は equal ではない");

  console.log(`Instagram archive tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
