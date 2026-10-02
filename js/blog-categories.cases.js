const {
  parseBlogCategoriesDocument,
  resolveVisibleBlogCategories,
  loadCanonicalCategoryNames,
} = require("./blog-categories.js");

function assert(condition, name) {
  if (!condition) {
    throw new Error(`FAIL ${name}`);
  }

  console.log(`PASS ${name}`);
}

const CANONICAL = {
  schemaVersion: 1,
  categories: [
    { id: 1, name: "日々のこと" },
    { id: 3, name: "お仕事" },
    { id: 2, name: "イラスト" },
  ],
};

function namesFrom(document) {
  return parseBlogCategoriesDocument(document);
}

function filterPosts(posts, filter) {
  if (filter === "all") {
    return posts;
  }

  return posts.filter((post) => post.category === filter);
}

async function runOtsumamiBlogCategoryCases() {
  const parsed = namesFrom(CANONICAL);
  assert(parsed !== null && parsed.join("/") === "日々のこと/お仕事/イラスト", "K parse keeps JSON array order");
  assert(!("order" in CANONICAL.categories[0]), "document categories do not require order");

  const allUsed = ["日々のこと", "お仕事", "イラスト"];
  assert(
    resolveVisibleBlogCategories(parsed, allUsed).join("/") === "日々のこと/お仕事/イラスト",
    "A all used categories follow JSON order",
  );

  assert(
    resolveVisibleBlogCategories(parsed, ["日々のこと", "イラスト", "日々のこと"]).join("/") ===
      "日々のこと/イラスト",
    "B unused お仕事 is hidden",
  );

  assert(
    resolveVisibleBlogCategories(parsed, ["旧カテゴリー", "イラスト", "日々のこと"]).join("/") ===
      "日々のこと/イラスト/旧カテゴリー",
    "C unknown category is appended in first-seen order",
  );

  assert(
    resolveVisibleBlogCategories(null, ["旧カテゴリー", "イラスト", "日々のこと"]).join("/") ===
      "旧カテゴリー/イラスト/日々のこと",
    "D 404 fallback uses posts-index first-seen order",
  );

  assert(parseBlogCategoriesDocument({ schemaVersion: 2, categories: [] }) === null, "E invalid schema is rejected");
  assert(parseBlogCategoriesDocument({ schemaVersion: 1, categories: "nope" }) === null, "E invalid categories is rejected");
  assert(
    resolveVisibleBlogCategories(parseBlogCategoriesDocument("{not json"), ["イラスト"]).join("/") === "イラスト",
    "E invalid document falls back to first-seen",
  );

  assert(resolveVisibleBlogCategories(parsed, []).join("/") === "", "F no published posts means no category tabs");
  assert(resolveVisibleBlogCategories(parsed, ["", ""]).join("/") === "", "I empty category does not create 未分類");

  const posts = [
    { title: "a", category: "日々のこと" },
    { title: "b", category: "イラスト" },
    { title: "c", category: "日々のこと" },
  ];
  assert(filterPosts(posts, "イラスト").map((post) => post.title).join("/") === "b", "G filter shows matching posts");
  assert(filterPosts(posts, "all").length === 3, "H すべて shows every post");

  const reordered = namesFrom({
    schemaVersion: 1,
    categories: [
      { id: 2, name: "イラスト" },
      { id: 1, name: "日々のこと" },
      { id: 3, name: "お仕事" },
    ],
  });
  assert(
    resolveVisibleBlogCategories(reordered, ["日々のこと", "お仕事", "イラスト"]).join("/") ===
      "イラスト/日々のこと/お仕事",
    "K reordered JSON changes the public nav order",
  );

  const fetches = [];
  const missing = await loadCanonicalCategoryNames(async (url, init) => {
    fetches.push({ url: String(url), cache: init && init.cache });
    return { ok: false, status: 404, json: async () => ({}) };
  }, "https://otsumaminikki.com/blog.html");
  assert(missing === null, "D loader treats 404 as missing canonical list");
  assert(fetches[0].cache === "no-cache", "loader uses cache: no-cache");
  assert(fetches[0].url.includes("data/blog-categories.json"), "loader reads blog-categories.json");

  const loaded = await loadCanonicalCategoryNames(async () => {
    return { ok: true, status: 200, json: async () => CANONICAL };
  }, "https://otsumaminikki.com/blog.html");
  assert(loaded && loaded.join("/") === "日々のこと/お仕事/イラスト", "loader returns canonical names");

  console.log("otsumami blog category cases: all passed");
}

runOtsumamiBlogCategoryCases().catch((error) => {
  console.error(error);
  process.exit(1);
});
