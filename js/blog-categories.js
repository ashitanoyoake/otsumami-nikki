/**
 * 公開ブログのカテゴリー正本（data/blog-categories.json）。
 * 並びは categories 配列順。0件カテゴリーはナビに出さない。
 */
(function (global) {
  const BLOG_CATEGORIES_URL = "data/blog-categories.json";

  /**
   * @param {unknown} data
   * @returns {string[] | null}
   */
  function parseBlogCategoriesDocument(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return null;
    }

    const raw = /** @type {Record<string, unknown>} */ (data);

    if (raw.schemaVersion !== 1 || !Array.isArray(raw.categories)) {
      return null;
    }

    /** @type {string[]} */
    const names = [];
    const seenIds = new Set();
    const seenNames = new Set();

    for (const item of raw.categories) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }

      const category = /** @type {Record<string, unknown>} */ (item);
      const id = category.id;
      const name = typeof category.name === "string" ? category.name.trim() : "";

      if (typeof id !== "number" || !Number.isInteger(id) || id <= 0 || !name) {
        return null;
      }

      if (seenIds.has(id) || seenNames.has(name)) {
        return null;
      }

      seenIds.add(id);
      seenNames.add(name);
      names.push(name);
    }

    return names;
  }

  /**
   * @param {string[]} usedNames
   * @returns {string[]}
   */
  function firstSeenCategoryNames(usedNames) {
    const seen = new Set();
    /** @type {string[]} */
    const names = [];

    usedNames.forEach((name) => {
      if (!name || seen.has(name)) {
        return;
      }

      seen.add(name);
      names.push(name);
    });

    return names;
  }

  /**
   * @param {string[] | null} canonicalNames
   * @param {string[]} usedNames
   * @returns {string[]}
   */
  function resolveVisibleBlogCategories(canonicalNames, usedNames) {
    const firstSeen = firstSeenCategoryNames(usedNames);

    if (canonicalNames === null) {
      return firstSeen;
    }

    const used = new Set(firstSeen);
    const fromCanonical = canonicalNames.filter((name) => used.has(name));
    const fromUnknown = firstSeen.filter((name) => !canonicalNames.includes(name));

    return fromCanonical.concat(fromUnknown);
  }

  /**
   * @param {typeof fetch} fetchImpl
   * @param {string} baseHref
   * @returns {Promise<string[] | null>}
   */
  async function loadCanonicalCategoryNames(fetchImpl, baseHref) {
    const url = new URL(BLOG_CATEGORIES_URL, baseHref).href;

    try {
      const response = await fetchImpl(url, { cache: "no-cache" });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return parseBlogCategoriesDocument(data);
    } catch {
      return null;
    }
  }

  const api = {
    BLOG_CATEGORIES_URL,
    parseBlogCategoriesDocument,
    firstSeenCategoryNames,
    resolveVisibleBlogCategories,
    loadCanonicalCategoryNames,
  };

  global.BlogCategories = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
