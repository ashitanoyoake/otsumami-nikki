/**
 * 公開イラストのカテゴリー正本（data/works-categories.json）。
 * 並びは categories 配列順。0件カテゴリーは残さない。
 * JSON がない／壊れているときは公開Worksの初出順へ戻す。
 */
(function (global) {
  const WORKS_CATEGORIES_URL = "data/works-categories.json";

  /**
   * @param {unknown} data
   * @returns {string[] | null}
   */
  function parseWorksCategoriesDocument(data) {
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
   * @param {unknown[]} usedNames
   * @returns {string[]}
   */
  function firstSeenCategoryNames(usedNames) {
    const seen = new Set();
    /** @type {string[]} */
    const names = [];

    usedNames.forEach((value) => {
      const name = typeof value === "string" ? value.trim() : "";

      if (!name || seen.has(name)) {
        return;
      }

      seen.add(name);
      names.push(name);
    });

    return names;
  }

  /**
   * @param {unknown} works
   * @returns {string[]}
   */
  function collectUsedWorkCategoryNames(works) {
    if (!Array.isArray(works)) {
      return [];
    }

    /** @type {unknown[]} */
    const used = [];

    works.forEach((work) => {
      if (typeof work === "string") {
        used.push(work);
        return;
      }

      if (work && typeof work === "object" && !Array.isArray(work)) {
        used.push(/** @type {{ category?: unknown }} */ (work).category);
      }
    });

    return firstSeenCategoryNames(used);
  }

  /**
   * @param {string[] | null} canonicalNames
   * @param {unknown[]} usedNames
   * @returns {string[]}
   */
  function resolveVisibleWorksCategories(canonicalNames, usedNames) {
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
  async function loadCanonicalWorksCategoryNames(fetchImpl, baseHref) {
    const url = new URL(WORKS_CATEGORIES_URL, baseHref).href;

    try {
      const response = await fetchImpl(url, { cache: "no-cache" });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return parseWorksCategoriesDocument(data);
    } catch {
      return null;
    }
  }

  const ALL_WORKS_FILTER = "all";

  /**
   * @param {string} search
   * @returns {string | null}
   */
  function readWorksListCategoryFilter(search) {
    const query = search.startsWith("?") ? search.slice(1) : search;
    const value = new URLSearchParams(query).get("category");

    if (!value || !value.trim()) {
      return null;
    }

    return value.trim();
  }

  /**
   * @param {string[]} visibleCategories
   * @param {string | null} requested
   * @returns {string}
   */
  function resolveActiveWorksListFilter(visibleCategories, requested) {
    if (!requested) {
      return ALL_WORKS_FILTER;
    }

    return visibleCategories.includes(requested) ? requested : ALL_WORKS_FILTER;
  }

  /**
   * @param {string} pathname
   * @param {string} filter
   * @returns {string}
   */
  function buildWorksListUrl(pathname, filter) {
    const path = pathname || "/works.html";

    if (!filter || filter === ALL_WORKS_FILTER) {
      return path;
    }

    const params = new URLSearchParams();
    params.set("category", filter);
    return `${path}?${params.toString()}`;
  }

  /**
   * @param {string[]} visibleCategories
   * @returns {string[]}
   */
  function worksCategoryNavLabels(visibleCategories) {
    return ["すべて", ...visibleCategories];
  }

  /**
   * @param {string[]} visibleCategories
   * @returns {boolean}
   */
  function shouldShowWorksCategoryNav(_visibleCategories) {
    return true;
  }

  /**
   * @param {Array<{ category?: string }>} works
   * @param {string} filter
   * @returns {Array<{ category?: string }>}
   */
  function filterWorksForCategory(works, filter) {
    if (filter === ALL_WORKS_FILTER) {
      return works;
    }

    return works.filter((work) => (work.category || "") === filter);
  }

  const api = {
    WORKS_CATEGORIES_URL,
    ALL_WORKS_FILTER,
    parseWorksCategoriesDocument,
    firstSeenCategoryNames,
    collectUsedWorkCategoryNames,
    resolveVisibleWorksCategories,
    loadCanonicalWorksCategoryNames,
    readWorksListCategoryFilter,
    resolveActiveWorksListFilter,
    buildWorksListUrl,
    worksCategoryNavLabels,
    shouldShowWorksCategoryNav,
    filterWorksForCategory,
  };

  global.WorksCategories = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
