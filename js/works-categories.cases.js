const {
  parseWorksCategoriesDocument,
  collectUsedWorkCategoryNames,
  resolveVisibleWorksCategories,
  loadCanonicalWorksCategoryNames,
} = require("./works-categories.js");

function assert(condition, name) {
  if (!condition) {
    throw new Error(`FAIL ${name}`);
  }

  console.log(`PASS ${name}`);
}

const CANONICAL = {
  schemaVersion: 1,
  categories: [
    { id: 2, name: "B" },
    { id: 1, name: "A" },
    { id: 3, name: "C" },
  ],
};

async function runOtsumamiWorksCategoryCases() {
  const parsed = parseWorksCategoriesDocument(CANONICAL);
  assert(parsed !== null && parsed.join("/") === "B/A/C", "A valid document parses in array order");

  assert(parseWorksCategoriesDocument({ schemaVersion: 2, categories: [] }) === null, "B invalid schemaVersion");
  assert(parseWorksCategoriesDocument({ schemaVersion: 1, categories: "nope" }) === null, "C categories must be an array");
  assert(
    parseWorksCategoriesDocument({
      schemaVersion: 1,
      categories: [{ id: 0, name: "A" }],
    }) === null,
    "D zero id is rejected",
  );
  assert(
    parseWorksCategoriesDocument({
      schemaVersion: 1,
      categories: [{ id: "1", name: "A" }],
    }) === null,
    "D string id is rejected",
  );
  assert(
    parseWorksCategoriesDocument({
      schemaVersion: 1,
      categories: [
        { id: 1, name: "A" },
        { id: 1, name: "B" },
      ],
    }) === null,
    "E duplicate id is rejected",
  );
  assert(
    parseWorksCategoriesDocument({
      schemaVersion: 1,
      categories: [{ id: 1, name: "   " }],
    }) === null,
    "F empty name is rejected",
  );
  assert(
    parseWorksCategoriesDocument({
      schemaVersion: 1,
      categories: [
        { id: 1, name: "A" },
        { id: 2, name: "A" },
      ],
    }) === null,
    "G duplicate name is rejected",
  );

  const used = ["A", "X", "B", "X", ""];
  assert(resolveVisibleWorksCategories(parsed, used).join("/") === "B/A/X", "H canonical order is kept");
  assert(resolveVisibleWorksCategories(parsed, used).includes("C") === false, "I unused canonical category is hidden");
  assert(resolveVisibleWorksCategories(parsed, used).join("/") === "B/A/X", "J unknown is appended");
  assert(
    resolveVisibleWorksCategories(parsed, ["X", "Y", "A"]).join("/") === "A/X/Y",
    "K unknown names keep first-seen order",
  );
  assert(resolveVisibleWorksCategories(parsed, ["A", "", "  ", "B"]).join("/") === "B/A", "L empty category is excluded");
  assert(resolveVisibleWorksCategories(parsed, ["A", "A", "B", "B"]).join("/") === "B/A", "M duplicates are removed");

  const works = [
    { category: "A" },
    { category: "X" },
    { category: "B" },
    { category: "X" },
    { category: "" },
  ];
  assert(collectUsedWorkCategoryNames(works).join("/") === "A/X/B", "works-index first-seen skips empty names");

  assert(
    resolveVisibleWorksCategories(null, used).join("/") === "A/X/B",
    "N missing canonical falls back to first-seen",
  );
  assert(
    resolveVisibleWorksCategories(parseWorksCategoriesDocument("{not json"), used).join("/") === "A/X/B",
    "O invalid canonical falls back to first-seen",
  );

  const emptyCanonical = parseWorksCategoriesDocument({ schemaVersion: 1, categories: [] });
  assert(emptyCanonical !== null && emptyCanonical.length === 0, "P empty document parses");
  assert(resolveVisibleWorksCategories(emptyCanonical, []).join("/") === "", "P empty canonical and no works");
  assert(
    resolveVisibleWorksCategories(emptyCanonical, ["旧カテゴリー", ""]).join("/") === "旧カテゴリー",
    "Q empty canonical keeps unknown works",
  );

  const missing = await loadCanonicalWorksCategoryNames(async (_url, init) => {
    assert(init.cache === "no-cache", "loader uses cache: no-cache");
    return { ok: false, status: 404, json: async () => ({}) };
  }, "https://otsumaminikki.com/works.html");
  assert(missing === null, "N loader treats 404 as missing");

  const loaded = await loadCanonicalWorksCategoryNames(async () => {
    return { ok: true, status: 200, json: async () => CANONICAL };
  }, "https://otsumaminikki.com/works.html");
  assert(loaded && loaded.join("/") === "B/A/C", "loader returns canonical names");

  console.log("otsumami works category cases: all passed");
}

runOtsumamiWorksCategoryCases().catch((error) => {
  console.error(error);
  process.exit(1);
});
