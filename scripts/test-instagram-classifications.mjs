/**
 * Instagram 公開一覧の分類判定とページネーション。実API / CMS は使わない。
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readExistingArchive } from "./fetch-instagram.mjs";

const require = createRequire(import.meta.url);
const {
  ALL_CATEGORY_FILTER,
  ARCHIVE_PAGE_SIZE,
  parseClassifications,
  isClassifiedPost,
  selectClassifiedPosts,
  visibleCategories,
  selectPostsForCategory,
  resolveDirectPost,
  normalizePage,
  pageCount,
  clampPage,
  slicePage,
  shouldShowPagination,
  pageOfPost,
  paginationItems,
  parseArchiveSearch,
  buildArchiveSearch,
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

  const listed = slicePage(selected, 1);
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

  assert(ARCHIVE_PAGE_SIZE === 12, "1ページは12件");
  assert(ALL_CATEGORY_FILTER === "all", "すべて の内部値は all");
  assert(normalizePage("foo") === 1, "不正pageは1へ補正");
  assert(normalizePage(0) === 1, "page=0 は1へ補正");
  assert(normalizePage(-3) === 1, "負のpageは1へ補正");
  assert(slicePage(null, 1).length === 0, "不正配列の slice は空");

  const ids = (posts) => posts.map((post) => String(post.id)).join(",");
  const makePosts = (count) => Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}` }));

  const zero = makePosts(0);
  assert(slicePage(zero, 1).length === 0, "0件は0件表示");
  assert(pageCount(0) === 0, "0件のページ数は0");
  assert(shouldShowPagination(0) === false, "0件はページネーションなし");

  const one = makePosts(1);
  assert(slicePage(one, 1).length === 1, "1件は1件表示");
  assert(pageCount(1) === 1, "1件は1ページ");
  assert(shouldShowPagination(1) === false, "1件はページネーションなし");

  const twelve = makePosts(12);
  assert(slicePage(twelve, 1).length === 12, "12件は12件表示");
  assert(pageCount(12) === 1, "12件は1ページ");
  assert(shouldShowPagination(12) === false, "12件はページネーションなし");

  const thirteen = makePosts(13);
  const thirteenFirst = slicePage(thirteen, 1);
  assert(thirteenFirst.length === 12, "13件の1ページ目は12件");
  assert(ids(thirteenFirst) === ids(thirteen.slice(0, 12)), "1ページ目は新しい順の先頭12件");
  assert(shouldShowPagination(13) === true, "13件はページネーションあり");
  assert(pageCount(13) === 2, "13件は2ページ");
  const thirteenSecond = slicePage(thirteen, 2);
  assert(thirteenSecond.length === 1, "13件の2ページ目は1件");
  assert(thirteenSecond[0].id === "p13", "2ページ目の index 0 は13件目");
  assert(pageOfPost(thirteen, "p13") === 2, "13件目は2ページ");

  const twentyFour = makePosts(24);
  assert(pageCount(24) === 2, "24件は2ページ");
  assert(slicePage(twentyFour, 1).length === 12, "24件の1ページ目は12件");
  assert(slicePage(twentyFour, 2).length === 12, "24件の2ページ目は12件");
  assert(ids(slicePage(twentyFour, 2)) === ids(twentyFour.slice(12, 24)), "2ページ目も JSON 順を崩さない");
  assert(shouldShowPagination(24) === true, "24件はページネーションあり");

  const twentyFive = makePosts(25);
  assert(pageCount(25) === 3, "25件は3ページ");
  assert(slicePage(twentyFive, 1).length === 12, "25件の1ページ目は12件");
  assert(slicePage(twentyFive, 2).length === 12, "25件の2ページ目は12件");
  assert(slicePage(twentyFive, 3).length === 1, "25件の最終ページは1件");
  assert(slicePage(twentyFive, 3)[0].id === "p25", "最終ページの index 0 は25件目");

  const oneFortyFive = makePosts(145);
  assert(pageCount(145) === 13, "145件は13ページ");
  assert(slicePage(oneFortyFive, 13).length === 1, "145件の最終ページは1件");
  assert(clampPage(99, 145) === 13, "範囲外pageは最終ページへ補正");
  assert(clampPage("abc", 145) === 1, "不正pageは1ページへ補正");
  assert(pageOfPost(oneFortyFive, "p13") === 2, "13件目は2ページ");
  assert(pageOfPost(oneFortyFive, "p145") === 13, "145件目は13ページ");

  const daily = makePosts(20).map((post, index) => ({
    ...post,
    category: index < 5 ? "c1" : "c2",
  }));
  assert(clampPage(2, 5) === 1, "カテゴリー切替後に件数不足なら1ページへ戻す");
  const dailyOnly = daily.filter((post) => post.category === "c1");
  assert(slicePage(dailyOnly, 1).length === 5, "カテゴリー切替後は先頭ページから再表示");
  assert(shouldShowPagination(dailyOnly.length) === false, "1ページしかないカテゴリーはページネーションなし");
  assert(slicePage(daily, 1)[0].id === "p1" && slicePage(daily, 1)[11].id === "p12", "すべてへ戻しても先頭12件から");

  const mixed = selectClassifiedPosts(
    [...thirteen, { id: secondId }],
    parseClassifications({
      categories: [{ id: "c1", name: "日常" }],
      assignments: Object.fromEntries(thirteen.map((post) => [post.id, "c1"])),
    }),
  );
  assert(mixed.every((post) => String(post.id) !== secondId), "ページング対象に未分類は混入しない");
  assert(slicePage(mixed, 2).every((post) => String(post.id) !== secondId), "2ページ目にも未分類は混入しない");

  const beyondListed = resolveDirectPost("p13", thirteenFirst, thirteen);
  assert(beyondListed.listedIndex === -1, "他ページの分類済みは listedIndex にしない");
  assert(String(beyondListed.directPost && beyondListed.directPost.id) === "p13", "?post= は他ページでもモーダル用に返す");

  assert(buildArchiveSearch({ category: "all", page: 1, post: null }) === "", "page=1 とすべて はURLから省略");
  assert(buildArchiveSearch({ category: "c6", page: 2, post: "x" }) === "?category=c6&page=2&post=x", "category + page + post を共存できる");
  assert(buildArchiveSearch({ category: "all", page: 2 }) === "?page=2", "すべて の2ページ目は page だけ");
  assert(buildArchiveSearch({ category: "c6", page: 1 }) === "?category=c6", "カテゴリー1ページ目は page を省略");

  const parsedSearch = parseArchiveSearch("?category=c6&page=3&post=abc", { validCategoryIds: ["c6"] });
  assert(parsedSearch.category === "c6" && parsedSearch.page === 3 && parsedSearch.post === "abc", "URLから category / page / post を読む");
  const invalidSearch = parseArchiveSearch("?category=missing&page=nope", { validCategoryIds: ["c6"] });
  assert(invalidSearch.category === "all" && invalidSearch.page === 1, "不正な category / page は安全に戻す");

  assert(paginationItems(1, 13).join(",") === "1,2,3,4,ellipsis,13", "13ページの先頭は省略表示");
  assert(paginationItems(7, 13).join(",") === "1,ellipsis,6,7,8,ellipsis,13", "13ページの中間は省略表示");
  assert(paginationItems(13, 13).join(",") === "1,ellipsis,10,11,12,13", "13ページの最終は省略表示");
  assert(paginationItems(1, 1).join(",") === "1", "1ページの数字は1だけ");

  const liveClassifications = parseClassifications(
    JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "instagram-classifications.json"), "utf8")),
  );
  const liveClassified = selectClassifiedPosts(existingPosts, liveClassifications);
  const liveCounts = Object.fromEntries(
    (liveClassifications ? visibleCategories(liveClassifications) : []).map((category) => [
      category.id,
      selectPostsForCategory(liveClassified, liveClassifications, category.id).length,
    ]),
  );
  assert(pageCount(liveClassified.length) === Math.ceil(liveClassified.length / 12), "本番のすべて のページ数は件数から計算できる");
  Object.values(liveCounts).forEach((count) => {
    assert(
      shouldShowPagination(count) === count > 12,
      "本番カテゴリーのページネーション表示は12件超だけ",
    );
  });

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
  assert(!indexHtml.includes("instagram-pagination"), "ホームにページネーションを置かない");
  assert(!indexHtml.includes("instagram-load-more"), "ホームにサイト内もっと見るを置かない");
  assert(instagramHtml.includes('data-instagram-limit="12"'), "Instagramページは12件ページ");
  assert(instagramHtml.includes("instagram-pagination"), "Instagramページにページネーションがある");
  assert(!instagramHtml.includes("instagram-load-more"), "旧もっと見るは削除する");
  assert(!instagramHtml.includes("instagram-cta-card"), "SP専用CTAカードは削除する");
  assert(instagramHtml.includes("instagram-account-link"), "アカウントリンクは上部へ移す");
  assert(instagramHtml.includes("Instagram アカウントを見る"), "既存のアカウントCTA文言は残す");
  assert(instagramHtml.includes("instagram-classifications.js"), "Instagramページだけ分類ヘルパーを読む");
  assert(instagramHtml.includes("instagram-categories"), "Instagramページにカテゴリーナビがある");
  assert(!indexHtml.includes("instagram-categories"), "ホームにカテゴリーナビを置かない");
  assert(galleryJs.includes("ALL_CATEGORY_FILTER"), "すべて は公開側で先頭に足す");
  assert(galleryJs.includes("currentPage = 1"), "カテゴリー切替で1ページへ戻す");
  assert(galleryJs.includes("slicePage"), "表示中の1ページだけ描画する");
  assert(galleryJs.includes("popstate"), "戻る/進むに対応する");
  assert(galleryJs.includes("buildArchiveSearch"), "category / page / post をURLに持つ");
  assert(galleryJs.includes('img.loading = "lazy"'), "lazy loading を維持する");
  assert(
    galleryJs.includes("if (isHomeGallery)") && galleryJs.includes("validPosts.slice(0, displayLimit)"),
    "ホームは従来どおり displayLimit 件だけ出す",
  );
  assert(!galleryJs.includes("appendListingCtaCard"), "CTAカード生成は使わない");

  console.log(`Instagram classification tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main();
