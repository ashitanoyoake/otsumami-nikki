/**
 * Instagram 公開一覧用の分類判定。
 * assignments[post.id] があり、その category ID が categories に実在する投稿だけを分類済みとする。
 */
(function (root) {
  /**
   * @param {unknown} data
   * @returns {{
   *   categories: Array<{ id: string, name: string }>,
   *   assignments: Record<string, string>,
   * } | null}
   */
  function parseClassifications(data) {
    if (!data || typeof data !== "object") {
      return null;
    }

    const rawCategories = /** @type {{ categories?: unknown }} */ (data).categories;
    const rawAssignments = /** @type {{ assignments?: unknown }} */ (data).assignments;

    if (!Array.isArray(rawCategories) || !rawAssignments || typeof rawAssignments !== "object" || Array.isArray(rawAssignments)) {
      return null;
    }

    /** @type {Array<{ id: string, name: string }>} */
    const categories = [];
    rawCategories.forEach((item) => {
      if (!item || typeof item !== "object") {
        return;
      }
      const id = typeof item.id === "string" ? item.id.trim() : "";
      const name = typeof item.name === "string" ? item.name.trim() : "";
      if (!id) {
        return;
      }
      categories.push({ id, name });
    });

    /** @type {Record<string, string>} */
    const assignments = {};
    Object.keys(rawAssignments).forEach((postId) => {
      const categoryId = rawAssignments[postId];
      if (typeof categoryId !== "string" || !categoryId.trim()) {
        return;
      }
      assignments[postId] = categoryId.trim();
    });

    return { categories, assignments };
  }

  /**
   * @param {{ id?: unknown } | null | undefined} post
   * @param {{ categories: Array<{ id: string }>, assignments: Record<string, string> } | null | undefined} classifications
   * @returns {boolean}
   */
  function isClassifiedPost(post, classifications) {
    if (!post || post.id == null || post.id === "" || !classifications) {
      return false;
    }

    const categoryId = classifications.assignments[String(post.id)];
    if (typeof categoryId !== "string" || !categoryId) {
      return false;
    }

    return classifications.categories.some((category) => category.id === categoryId);
  }

  /**
   * instagram.json の順序を維持したまま、分類済み投稿だけを残す。
   * @param {unknown[]} posts
   * @param {{ categories: Array<{ id: string }>, assignments: Record<string, string> } | null | undefined} classifications
   * @returns {unknown[]}
   */
  function selectClassifiedPosts(posts, classifications) {
    if (!Array.isArray(posts) || !classifications) {
      return [];
    }

    return posts.filter((post) => isClassifiedPost(post, classifications));
  }

  /**
   * 公開ナビに出すカテゴリー。配列順を維持し、「未分類」は出さない。
   * @param {{ categories: Array<{ id: string, name: string }> } | null | undefined} classifications
   * @returns {Array<{ id: string, name: string }>}
   */
  function visibleCategories(classifications) {
    if (!classifications || !Array.isArray(classifications.categories)) {
      return [];
    }

    return classifications.categories.filter((category) => category && category.name !== "未分類");
  }

  /**
   * @param {unknown[]} classifiedPosts
   * @param {{ assignments: Record<string, string> } | null | undefined} classifications
   * @param {string} categoryId
   * @returns {unknown[]}
   */
  function selectPostsForCategory(classifiedPosts, classifications, categoryId) {
    if (!Array.isArray(classifiedPosts)) {
      return [];
    }

    if (!categoryId || categoryId === "all") {
      return classifiedPosts;
    }

    if (!classifications || !classifications.assignments) {
      return [];
    }

    return classifiedPosts.filter((post) => {
      if (!post || post.id == null) {
        return false;
      }
      return classifications.assignments[String(post.id)] === categoryId;
    });
  }

  /**
   * 一覧用の分類済み投稿と、?post= で直接開く投稿を分ける。
   * 未分類の直接指定は listedPosts には入れない。
   * @param {string | null} postId
   * @param {Array<{ id?: unknown }>} listedPosts
   * @param {Array<{ id?: unknown }>} validPosts
   * @returns {{ listedIndex: number, directPost: { id?: unknown } | null }}
   */
  function resolveDirectPost(postId, listedPosts, validPosts) {
    if (!postId) {
      return { listedIndex: -1, directPost: null };
    }

    const listedIndex = listedPosts.findIndex((post) => post && String(post.id) === postId);
    if (listedIndex >= 0) {
      return { listedIndex, directPost: null };
    }

    const directPost = validPosts.find((post) => post && String(post.id) === postId) || null;
    return { listedIndex: -1, directPost };
  }

  const ARCHIVE_PAGE_SIZE = 12;
  const ALL_CATEGORY_FILTER = "all";

  /**
   * @param {unknown} page
   * @returns {number}
   */
  function normalizePage(page) {
    const parsed = typeof page === "number" ? page : Number.parseInt(String(page), 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return 1;
    }
    return Math.floor(parsed);
  }

  /**
   * @param {number} total
   * @param {number} [pageSize]
   * @returns {number}
   */
  function pageCount(total, pageSize) {
    const size = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : ARCHIVE_PAGE_SIZE;
    if (!Number.isFinite(total) || total <= 0) {
      return 0;
    }
    return Math.ceil(total / size);
  }

  /**
   * @param {unknown} page
   * @param {number} total
   * @param {number} [pageSize]
   * @returns {number}
   */
  function clampPage(page, total, pageSize) {
    const pages = pageCount(total, pageSize);
    const current = normalizePage(page);
    if (pages <= 0) {
      return 1;
    }
    return Math.min(current, pages);
  }

  /**
   * 指定ページの12件だけを返す。instagram.json の順序は維持する。
   * @param {unknown[]} posts
   * @param {unknown} page
   * @param {number} [pageSize]
   * @returns {unknown[]}
   */
  function slicePage(posts, page, pageSize) {
    if (!Array.isArray(posts)) {
      return [];
    }

    const size = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : ARCHIVE_PAGE_SIZE;
    const current = clampPage(page, posts.length, size);
    const start = (current - 1) * size;
    return posts.slice(start, start + size);
  }

  /**
   * @param {number} total
   * @param {number} [pageSize]
   * @returns {boolean}
   */
  function shouldShowPagination(total, pageSize) {
    return pageCount(total, pageSize) > 1;
  }

  /**
   * @param {unknown[]} posts
   * @param {unknown} postId
   * @param {number} [pageSize]
   * @returns {number | null}
   */
  function pageOfPost(posts, postId, pageSize) {
    if (!Array.isArray(posts) || postId == null || postId === "") {
      return null;
    }

    const index = posts.findIndex((post) => post && String(post.id) === String(postId));
    if (index < 0) {
      return null;
    }

    const size = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : ARCHIVE_PAGE_SIZE;
    return Math.floor(index / size) + 1;
  }

  /**
   * @param {unknown} currentPage
   * @param {unknown} totalPages
   * @returns {Array<number | "ellipsis">}
   */
  function paginationItems(currentPage, totalPages) {
    const total = Number.isFinite(Number(totalPages)) ? Math.floor(Number(totalPages)) : 0;
    if (total <= 0) {
      return [];
    }

    const current = Math.min(normalizePage(currentPage), total);
    if (total <= 7) {
      return Array.from({ length: total }, (_, index) => index + 1);
    }

    const pages = new Set([1, total, current, current - 1, current + 1]);
    if (current <= 3) {
      pages.add(2);
      pages.add(3);
      pages.add(4);
    }
    if (current >= total - 2) {
      pages.add(total - 3);
      pages.add(total - 2);
      pages.add(total - 1);
    }

    const sorted = [...pages].filter((page) => page >= 1 && page <= total).sort((left, right) => left - right);
    /** @type {Array<number | "ellipsis">} */
    const items = [];
    sorted.forEach((page, index) => {
      if (index > 0 && page - sorted[index - 1] > 1) {
        items.push("ellipsis");
      }
      items.push(page);
    });
    return items;
  }

  /**
   * @param {string | URLSearchParams | null | undefined} search
   * @param {{ validCategoryIds?: string[] }} [options]
   * @returns {{ category: string, page: number, post: string | null }}
   */
  function parseArchiveSearch(search, options) {
    const params = search instanceof URLSearchParams
      ? search
      : new URLSearchParams(String(search || "").replace(/^\?/, ""));
    const validCategoryIds = options && Array.isArray(options.validCategoryIds) ? options.validCategoryIds : [];
    const rawCategory = params.get("category");
    const category = rawCategory && validCategoryIds.includes(rawCategory) ? rawCategory : ALL_CATEGORY_FILTER;
    const page = normalizePage(params.get("page"));
    const post = params.get("post");
    return {
      category,
      page,
      post: post || null,
    };
  }

  /**
   * page=1 と category=all は URL から省略する。
   * @param {{ category?: string | null, page?: unknown, post?: string | null }} [state]
   * @returns {string}
   */
  function buildArchiveSearch(state) {
    const params = new URLSearchParams();
    const category = state && state.category;
    const post = state && state.post;
    if (category && category !== ALL_CATEGORY_FILTER) {
      params.set("category", String(category));
    }
    const page = normalizePage(state && state.page);
    if (page > 1) {
      params.set("page", String(page));
    }
    if (post) {
      params.set("post", String(post));
    }
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  const api = {
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
  };

  root.InstagramClassifications = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
