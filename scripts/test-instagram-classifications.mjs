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
  ARCHIVE_PAGE_SIZE,
  parseClassifications,
  isClassifiedPost,
  selectClassifiedPosts,
  visibleCategories,
  selectPostsForCategory,
  resolveDirectPost,
  sliceVisiblePosts,
  nextVisibleCount,
  shouldShowLoadMore,
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

  const withHidden = parseClassifications({
    categories: [
      { id: "c1", name: "日常" },
      { id: "c9", name: "未分類" },
      { id: "c2", name: "食べ物" },
    ],
    assignments: {
      [firstId]: "c1",
      [thirdId]: "c2",
    },
  });
  const navCategories = visibleCategories(withHidden);
  assert(navCategories.map((item) => item.id).join(",") === "c1,c2", "ナビは categories 配列順で未分類を除く");
  assert(
    selectPostsForCategory(selected, parsed, "all").length === 2,
    "すべて は分類済み全件",
  );
  assert(
    selectPostsForCategory(selected, parsed, "c1").map((post) => String(post.id)).join(",") === firstId,
    "選択カテゴリーの投稿だけ残す",
  );
  assert(selectPostsForCategory(selected, parsed, "c2").length === 1, "別カテゴリーも絞り込める");
  assert(selectPostsForCategory(selected, parsed, "empty").length === 0, "投稿0件のカテゴリーは空配列");
  assert(
    selectPostsForCategory(selected, parsed, "all").every((post) => isClassifiedPost(post, parsed)),
    "すべて にも未分類は混入しない",
  );

  const listed = sliceVisiblePosts(selected, ARCHIVE_PAGE_SIZE);
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

  assert(ARCHIVE_PAGE_SIZE === 12, "Instagramページの初期表示は12件");
  assert(sliceVisiblePosts(null, 12).length === 0, "不正配列の slice は空");
  assert(sliceVisiblePosts([{ id: "a" }], 0).length === 0, "visibleCount 0 は0件");

  const ids = (posts) => posts.map((post) => String(post.id)).join(",");
  const makePosts = (count) => Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}` }));

  const zero = makePosts(0);
  assert(sliceVisiblePosts(zero, ARCHIVE_PAGE_SIZE).length === 0, "0件は0件表示");
  assert(shouldShowLoadMore(ARCHIVE_PAGE_SIZE, 0) === false, "0件はもっと見るなし");

  const one = makePosts(1);
  assert(sliceVisiblePosts(one, ARCHIVE_PAGE_SIZE).length === 1, "1件は1件表示");
  assert(shouldShowLoadMore(ARCHIVE_PAGE_SIZE, 1) === false, "1件はもっと見るなし");

  const twelve = makePosts(12);
  assert(sliceVisiblePosts(twelve, ARCHIVE_PAGE_SIZE).length === 12, "12件は12件表示");
  assert(shouldShowLoadMore(ARCHIVE_PAGE_SIZE, 12) === false, "12件はもっと見るなし");

  const thirteen = makePosts(13);
  const thirteenFirst = sliceVisiblePosts(thirteen, ARCHIVE_PAGE_SIZE);
  assert(thirteenFirst.length === 12, "13件は初期12件");
  assert(ids(thirteenFirst) === ids(thirteen.slice(0, 12)), "13件の初期表示は新しい順の先頭12件");
  assert(shouldShowLoadMore(ARCHIVE_PAGE_SIZE, 13) === true, "13件はもっと見るあり");
  const thirteenAfter = sliceVisiblePosts(thirteen, nextVisibleCount(ARCHIVE_PAGE_SIZE));
  assert(thirteenAfter.length === 13, "もっと見る後は13件");
  assert(shouldShowLoadMore(nextVisibleCount(ARCHIVE_PAGE_SIZE), 13) === false, "13件表示後はボタンなし");
  assert(thirteenAfter[12].id === "p13", "追加表示後の13件目の index は12");

  const twentyFour = makePosts(24);
  assert(sliceVisiblePosts(twentyFour, ARCHIVE_PAGE_SIZE).length === 12, "24件は初期12件");
  const twentyFourAfter = sliceVisiblePosts(twentyFour, nextVisibleCount(ARCHIVE_PAGE_SIZE));
  assert(twentyFourAfter.length === 24, "24件は1回でもっと見る後24件");
  assert(shouldShowLoadMore(24, 24) === false, "24件表示後はボタンなし");
  assert(ids(twentyFourAfter) === ids(twentyFour), "もっと見る後も JSON 順を崩さない");

  const twentyFive = makePosts(25);
  let visible = ARCHIVE_PAGE_SIZE;
  assert(sliceVisiblePosts(twentyFive, visible).length === 12, "25件は初期12件");
  assert(shouldShowLoadMore(visible, 25) === true, "25件の初期はもっと見るあり");
  visible = nextVisibleCount(visible);
  assert(sliceVisiblePosts(twentyFive, visible).length === 24, "25件は2ページ目で24件");
  assert(shouldShowLoadMore(visible, 25) === true, "25件の24件表示ではもっと見るあり");
  visible = nextVisibleCount(visible);
  const twentyFiveAll = sliceVisiblePosts(twentyFive, visible);
  assert(twentyFiveAll.length === 25, "25件は3ページ目で全件");
  assert(shouldShowLoadMore(visible, 25) === false, "25件表示後はボタンなし");
  assert(twentyFiveAll[24].id === "p25", "追加後の25件目の index は24");

  const daily = makePosts(20).map((post, index) => ({
    ...post,
    category: index < 5 ? "c1" : "c2",
  }));
  const afterAllExpanded = sliceVisiblePosts(daily, 24);
  assert(afterAllExpanded.length === 20, "すべてで24件まで進めても総数は20");
  const dailyOnly = daily.filter((post) => post.category === "c1");
  const resetVisible = ARCHIVE_PAGE_SIZE;
  const dailyVisible = sliceVisiblePosts(dailyOnly, resetVisible);
  assert(dailyVisible.length === 5, "カテゴリー切替後は先頭から再表示");
  assert(dailyVisible[0].id === "p1", "切替後も配列先頭から出す");
  assert(shouldShowLoadMore(resetVisible, dailyOnly.length) === false, "切替後に残りがなければボタンなし");
  const allAgain = sliceVisiblePosts(daily, resetVisible);
  assert(allAgain.length === 12, "すべてへ戻しても先頭12件から");
  assert(allAgain[0].id === "p1" && allAgain[11].id === "p12", "戻したあとも新しい順の先頭12件");

  const mixed = selectClassifiedPosts(
    [...thirteen, { id: secondId }],
    parseClassifications({
      categories: [{ id: "c1", name: "日常" }],
      assignments: Object.fromEntries(thirteen.map((post) => [post.id, "c1"])),
    }),
  );
  assert(mixed.every((post) => String(post.id) !== secondId), "ページング対象に未分類は混入しない");
  assert(sliceVisiblePosts(mixed, 24).every((post) => String(post.id) !== secondId), "もっと見る後も未分類は混入しない");

  const beyondListed = resolveDirectPost("p13", thirteenFirst, thirteen);
  assert(beyondListed.listedIndex === -1, "未表示の分類済みは listedIndex にしない");
  assert(String(beyondListed.directPost && beyondListed.directPost.id) === "p13", "?post= は未表示でもモーダル用に返す");

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
  assert(!indexHtml.includes("instagram-load-more"), "ホームにサイト内もっと見るを置かない");
  assert(instagramHtml.includes('data-instagram-limit="12"'), "Instagramページの初期表示は12件");
  assert(instagramHtml.includes("instagram-load-more"), "Instagramページにサイト内もっと見るがある");
  assert(instagramHtml.includes("Instagram アカウントを見る"), "既存のアカウントCTAは残す");
  assert(instagramHtml.includes("instagram-classifications.js"), "Instagramページだけ分類ヘルパーを読む");
  assert(instagramHtml.includes("instagram-categories"), "Instagramページにカテゴリーナビがある");
  assert(!indexHtml.includes("instagram-categories"), "ホームにカテゴリーナビを置かない");
  assert(galleryJs.includes("ALL_CATEGORY_FILTER"), "すべて は公開側で先頭に足す");
  assert(galleryJs.includes("applyCategoryFilter"), "同じページ内で絞り込む");
  assert(galleryJs.includes("visibleCount = ARCHIVE_PAGE_SIZE"), "カテゴリー切替で12件へ戻す");
  assert(galleryJs.includes("renderVisiblePosts"), "表示中の件数だけ描画する");
  assert(galleryJs.includes('img.loading = "lazy"'), "lazy loading を維持する");
  assert(
    galleryJs.includes("if (isHomeGallery)") && galleryJs.includes("validPosts.slice(0, displayLimit)"),
    "ホームは従来どおり displayLimit 件だけ出す",
  );

  console.log(`Instagram classification tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main();
