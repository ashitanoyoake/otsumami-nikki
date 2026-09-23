/**
 * Instagram 公開一覧の分類判定。実API / CMS は使わない。
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readExistingArchive } from "./fetch-instagram.mjs";

const require = createRequire(import.meta.url);
const {
  parseClassifications,
  isClassifiedPost,
  selectClassifiedPosts,
  resolveDirectPost,
} = require("../js/instagram-classifications.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

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

function main() {
  const archive = readExistingArchive(path.join(REPO_ROOT, "data", "instagram.json"));
  const existingPosts = archive.posts;
  assert(existingPosts.length >= 3, "本番JSONから投稿を読める");

  const firstId = String(existingPosts[0].id);
  const secondId = String(existingPosts[1].id);
  const thirdId = String(existingPosts[2].id);

  assert(parseClassifications(null) === null, "null は不正");
  assert(parseClassifications([]) === null, "配列は不正");
  assert(parseClassifications({ categories: [] }) === null, "assignments 欠落は不正");
  assert(parseClassifications({ assignments: {} }) === null, "categories 欠落は不正");
  assert(parseClassifications({ categories: [], assignments: [] }) === null, "assignments が配列なら不正");

  const parsed = parseClassifications({
    schemaVersion: 1,
    updatedAt: "2026-09-23T00:00:00.000Z",
    categories: [
      { id: "c1", name: "日常" },
      { id: "c2", name: "食べ物" },
      { id: "  ", name: "空ID" },
    ],
    assignments: {
      [firstId]: "c1",
      [secondId]: "missing-category",
      [thirdId]: "  c2  ",
      "unknown-post": "c1",
      "blank": "   ",
    },
  });

  assert(parsed !== null, "正式な分類JSONは受け入れる");
  assert(parsed.categories.length === 2, "空IDカテゴリーは捨てる");
  assert(parsed.categories[0].id === "c1" && parsed.categories[1].id === "c2", "categories の配列順を維持する");
  assert(parsed.assignments[firstId] === "c1", "有効な assignment を残す");
  assert(parsed.assignments[thirdId] === "c2", "category ID の前後空白は整える");
  assert(!parsed.assignments.blank, "空の assignment は捨てる");

  assert(isClassifiedPost(existingPosts[0], parsed) === true, "実在カテゴリーへの assignment は分類済み");
  assert(isClassifiedPost(existingPosts[1], parsed) === false, "存在しない category ID は未分類");
  assert(isClassifiedPost(existingPosts[2], parsed) === true, "空白付き category ID も実在すれば分類済み");
  assert(isClassifiedPost({ id: "no-assignment" }, parsed) === false, "assignment が無い投稿は未分類");
  assert(isClassifiedPost({ id: firstId }, null) === false, "分類データなしは未分類");

  const selected = selectClassifiedPosts(existingPosts, parsed);
  assert(selected.length === 2, "分類済みだけ残る");
  assert(String(selected[0].id) === firstId, "先頭の分類済みは JSON 順のまま");
  assert(String(selected[1].id) === thirdId, "未分類を除いても JSON 順を維持する");
  assert(
    selected.every((post) => String(post.id) !== secondId),
    "存在しない category ID の投稿は一覧から除外する",
  );
  assert(selectClassifiedPosts(existingPosts, null).length === 0, "分類失敗時は0件（全件フォールバックしない）");

  const listed = selected.slice(0, 9);
  const classifiedDirect = resolveDirectPost(firstId, listed, existingPosts);
  assert(classifiedDirect.listedIndex === 0, "分類済みの ?post= は一覧インデックスで開く");
  assert(classifiedDirect.directPost === null, "一覧にある投稿は directPost にしない");

  const unclassifiedDirect = resolveDirectPost(secondId, listed, existingPosts);
  assert(unclassifiedDirect.listedIndex === -1, "未分類の ?post= は一覧に載せない");
  assert(String(unclassifiedDirect.directPost.id) === secondId, "未分類でも JSON にあればモーダル用に返す");

  const missingDirect = resolveDirectPost("does-not-exist", listed, existingPosts);
  assert(missingDirect.listedIndex === -1 && missingDirect.directPost === null, "存在しない ID は開かない");

  const afterClose = listed;
  assert(
    afterClose.every((post) => isClassifiedPost(post, parsed)),
    "モーダル用の未分類投稿を一覧へ戻さない",
  );

  const galleryJs = fs.readFileSync(path.join(REPO_ROOT, "js", "instagram-gallery.js"), "utf8");
  const instagramHtml = fs.readFileSync(path.join(REPO_ROOT, "instagram.html"), "utf8");
  const indexHtml = fs.readFileSync(path.join(REPO_ROOT, "index.html"), "utf8");

  assert(galleryJs.includes("if (isHomeGallery)"), "ホーム分岐を維持している");
  assert(galleryJs.includes("isHomeGallery && index === 0"), "NEWバッジはホーム先頭だけ");
  assert(galleryJs.includes("CLASSIFICATIONS_URL"), "Instagramページは分類JSONを読む");
  assert(
    galleryJs.includes("if (isHomeGallery)") && galleryJs.includes("return;") && galleryJs.includes("loadClassifications"),
    "ホーム経路と分類取得がある",
  );
  assert(!indexHtml.includes("instagram-classifications.js"), "ホームは分類JSを読み込まない");
  assert(indexHtml.includes('data-instagram-limit="3"'), "ホームの件数は3のまま");
  assert(instagramHtml.includes('data-instagram-limit="9"'), "Instagramページの件数は9のまま");
  assert(instagramHtml.includes("instagram-classifications.js"), "Instagramページだけ分類ヘルパーを読む");
  assert(galleryJs.includes('img.loading = "lazy"'), "lazy loading を維持する");

  console.log(`Instagram classification tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main();
