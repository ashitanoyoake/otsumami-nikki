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

  const api = {
    parseClassifications,
    isClassifiedPost,
    selectClassifiedPosts,
    resolveDirectPost,
  };

  root.InstagramClassifications = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
