const {
  parseWorksCategoriesDocument,
  collectUsedWorkCategoryNames,
  resolveVisibleWorksCategories,
  readWorksListCategoryFilter,
  resolveActiveWorksListFilter,
  buildWorksListUrl,
  worksCategoryNavLabels,
  shouldShowWorksCategoryNav,
  filterWorksForCategory,
  ALL_WORKS_FILTER,
} = require("./works-categories.js");

function assert(condition, name) {
  if (!condition) {
    throw new Error(`FAIL ${name}`);
  }

  console.log(`PASS ${name}`);
}

function runOtsumamiWorksListCases() {
  const canonical = parseWorksCategoriesDocument({
    schemaVersion: 1,
    categories: [
      { id: 1, name: "ご飯" },
      { id: 2, name: "イラスト" },
      { id: 3, name: "日常" },
    ],
  });
  const works = [
    { title: "a", category: "イラスト" },
    { title: "b", category: "旧カテゴリー" },
    { title: "c", category: "ご飯" },
    { title: "d", category: "" },
  ];
  const used = collectUsedWorkCategoryNames(works);
  const visible = resolveVisibleWorksCategories(canonical, used);
  const labels = worksCategoryNavLabels(visible);

  assert(visible.join("/") === "ご飯/イラスト/旧カテゴリー", "A buttons follow canonical then unknown");
  assert(labels[0] === "すべて", "B すべて is first");
  assert(labels.join("/") === "すべて/ご飯/イラスト/旧カテゴリー", "B nav labels");
  assert(visible.includes("日常") === false, "C unused canonical category is hidden");
  assert(visible[visible.length - 1] === "旧カテゴリー", "D unknown is last");
  assert(
    resolveVisibleWorksCategories(canonical, ["旧B", "旧A", "ご飯"]).join("/") === "ご飯/旧B/旧A",
    "E unknown keeps first-seen order",
  );

  const allVisible = filterWorksForCategory(works, ALL_WORKS_FILTER);
  assert(allVisible.some((work) => work.title === "d"), "F uncategorized work stays in すべて");
  assert(labels.includes("未分類") === false && labels.includes("カテゴリーなし") === false, "G no empty-category button");
  assert(filterWorksForCategory(works, "ご飯").every((work) => work.category === "ご飯"), "K filter shows the selected category");

  assert(resolveActiveWorksListFilter(visible, readWorksListCategoryFilter("")) === "all", "H missing query is すべて");
  assert(resolveActiveWorksListFilter(visible, readWorksListCategoryFilter("?category=")) === "all", "H empty query is すべて");
  assert(
    resolveActiveWorksListFilter(visible, readWorksListCategoryFilter("?category=" + encodeURIComponent("イラスト"))) ===
      "イラスト",
    "I valid query selects the category",
  );
  assert(
    resolveActiveWorksListFilter(visible, readWorksListCategoryFilter("?category=" + encodeURIComponent("日常"))) ===
      "all",
    "J unused/invalid query falls back to すべて",
  );

  assert(buildWorksListUrl("/works.html", "イラスト").includes("category="), "L selected category updates the URL");
  assert(
    decodeURIComponent(buildWorksListUrl("/works.html", "イラスト")) === "/works.html?category=イラスト",
    "L URLSearchParams encodes the category",
  );
  assert(buildWorksListUrl("/works.html", "all") === "/works.html", "M すべて removes the category query");
  assert(
    resolveActiveWorksListFilter(visible, readWorksListCategoryFilter("?category=" + encodeURIComponent("ご飯"))) ===
      "ご飯",
    "N popstate can restore a filter from the URL",
  );
  assert(
    resolveActiveWorksListFilter(visible, readWorksListCategoryFilter("")) === "all",
    "N popstate without query returns すべて",
  );

  const emptyVisible = resolveVisibleWorksCategories(
    parseWorksCategoriesDocument({ schemaVersion: 1, categories: [] }),
    [],
  );
  assert(shouldShowWorksCategoryNav(emptyVisible) === false, "O empty works hide the nav");
  assert(emptyVisible.length === 0, "P empty works keep no category buttons");

  const emptyMessage = "現在公開中のイラストはありません。";
  assert(emptyMessage === "現在公開中のイラストはありません。", "P empty message stays the same");

  const fallback = resolveVisibleWorksCategories(null, ["旧カテゴリー", "ご飯"]);
  assert(fallback.join("/") === "旧カテゴリー/ご飯", "Q missing canonical falls back to first-seen");
  assert(filterWorksForCategory(works, "all").length === 4, "Q fallback still lists every work");

  console.log("otsumami works list cases: all passed");
}

runOtsumamiWorksListCases();
