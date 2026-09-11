/**
 * CMS一覧用の共通処理
 * posts-index.json / works-index.json を安全に読む。
 */
(function (global) {
  const POSTS_INDEX_URL = "data/posts/posts-index.json";
  const WORKS_INDEX_URL = "data/works/works-index.json";
  const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
  const PRODUCTION_FIELDS = [
    { key: "year", label: "制作年" },
    { key: "client", label: "クライアント" },
    { key: "medium", label: "媒体" },
    { key: "role", label: "担当" },
    { key: "materials", label: "使用画材・ソフト" },
  ];

  /**
   * @param {string} value
   * @returns {string}
   */
  function formatPublishDate(value) {
    const trimmed = value.trim();
    const match = DATE_PATTERN.exec(trimmed);

    if (!match) {
      return trimmed;
    }

    return `${match[1]}.${match[2]}.${match[3]}`;
  }

  /**
   * @param {string} slug
   * @returns {boolean}
   */
  function isSafeSlug(slug) {
    const trimmed = slug.trim();

    if (!trimmed) {
      return false;
    }

    if (
      trimmed.includes("..") ||
      trimmed.includes("/") ||
      trimmed.includes("\\") ||
      trimmed.includes(":") ||
      trimmed.includes("?") ||
      trimmed.includes("#")
    ) {
      return false;
    }

    return true;
  }

  /**
   * @param {string} slug
   * @param {"blog" | "works"} kind
   * @returns {string | null}
   */
  function buildEntryHref(slug, kind) {
    if (!isSafeSlug(slug)) {
      return null;
    }

    return `/${kind}/${encodeURIComponent(slug.trim())}.html`;
  }

  /**
   * @param {unknown} imageValue
   * @returns {string | null}
   */
  function resolveSiteImageSrc(imageValue) {
    if (typeof imageValue !== "string") {
      return null;
    }

    const trimmed = imageValue.trim();

    if (!trimmed) {
      return null;
    }

    const lower = trimmed.toLowerCase();

    if (
      lower.startsWith("data:") ||
      lower.startsWith("blob:") ||
      lower.startsWith("javascript:") ||
      lower.startsWith("http:") ||
      lower.startsWith("https:") ||
      lower.startsWith("//")
    ) {
      return null;
    }

    if (trimmed.includes("..") || trimmed.includes("\\") || trimmed.includes(":")) {
      return null;
    }

    if (trimmed.startsWith("/images/") || trimmed.startsWith("images/")) {
      return trimmed;
    }

    return null;
  }

  /**
   * @param {unknown} value
   * @returns {string}
   */
  function readTextValue(value) {
    if (typeof value === "string") {
      return value.trim();
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .join("、");
    }

    return "";
  }

  /**
   * @param {Record<string, unknown>} raw
   * @returns {{ label: string, text: string }[]}
   */
  function readProductionFields(raw) {
    const source =
      raw.productionInfo && typeof raw.productionInfo === "object" && !Array.isArray(raw.productionInfo)
        ? /** @type {Record<string, unknown>} */ (raw.productionInfo)
        : raw;

    /** @type {{ label: string, text: string }[]} */
    const fields = [];

    PRODUCTION_FIELDS.forEach((field) => {
      const text = readTextValue(source[field.key]);

      if (text) {
        fields.push({ label: field.label, text });
      }
    });

    return fields;
  }

  /**
   * @param {unknown} entry
   * @returns {{
   *   title: string,
   *   href: string,
   *   publishDate: string,
   *   dateLabel: string,
   *   category: string,
   *   excerpt: string,
   *   imageSrc: string | null,
   *   slug: string
   * } | null}
   */
  function normalizePostEntry(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const raw = /** @type {Record<string, unknown>} */ (entry);
    const title = readTextValue(raw.title);
    const slug = typeof raw.slug === "string" ? raw.slug : "";
    const href = buildEntryHref(slug, "blog");
    const publishDate = typeof raw.publishDate === "string" ? raw.publishDate.trim() : "";

    if (!title || !href || !publishDate) {
      return null;
    }

    return {
      title,
      href,
      publishDate,
      dateLabel: formatPublishDate(publishDate),
      category: readTextValue(raw.category),
      excerpt: readTextValue(raw.excerpt),
      imageSrc: resolveSiteImageSrc(raw.thumbnail),
      slug: slug.trim(),
    };
  }

  /**
   * @param {unknown} entry
   * @returns {{
   *   title: string,
   *   href: string,
   *   category: string,
   *   summary: string,
   *   imageSrc: string | null,
   *   productionFields: { label: string, text: string }[],
   *   slug: string
   * } | null}
   */
  function normalizeWorkEntry(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const raw = /** @type {Record<string, unknown>} */ (entry);
    const title = readTextValue(raw.title);
    const slug = typeof raw.slug === "string" ? raw.slug : "";
    const href = buildEntryHref(slug, "works");

    if (!title || !href) {
      return null;
    }

    return {
      title,
      href,
      category: readTextValue(raw.category),
      summary: readTextValue(raw.summary),
      imageSrc: resolveSiteImageSrc(raw.featuredImage),
      productionFields: readProductionFields(raw),
      slug: slug.trim(),
    };
  }

  /**
   * @param {unknown} data
   * @param {string} label
   * @param {(entry: unknown, index: number) => unknown} normalize
   * @returns {unknown[] | null}
   */
  function parseIndexArray(data, label, normalize) {
    if (!Array.isArray(data)) {
      console.error(`[${label}] index JSON is not an array`, data);
      return null;
    }

    /** @type {unknown[]} */
    const items = [];

    data.forEach((entry, index) => {
      const normalized = normalize(entry, index);

      if (normalized) {
        items.push(normalized);
        return;
      }

      console.warn(`[${label}] skipped invalid index entry`, index, entry);
    });

    return items;
  }

  /**
   * @param {unknown} data
   * @returns {ReturnType<typeof normalizePostEntry>[] | null}
   */
  function parsePostsIndex(data) {
    return /** @type {ReturnType<typeof normalizePostEntry>[] | null} */ (
      parseIndexArray(data, "blog-list", normalizePostEntry)
    );
  }

  /**
   * @param {unknown} data
   * @returns {ReturnType<typeof normalizeWorkEntry>[] | null}
   */
  function parseWorksIndex(data) {
    return /** @type {ReturnType<typeof normalizeWorkEntry>[] | null} */ (
      parseIndexArray(data, "works-list", normalizeWorkEntry)
    );
  }

  /**
   * @param {string} relativePath
   * @param {string} label
   * @returns {Promise<{ ok: true, data: unknown, missing: boolean } | { ok: false }>}
   */
  async function fetchIndexJson(relativePath, label) {
    const url = new URL(relativePath, global.location.href).href;

    try {
      const response = await fetch(url, { cache: "no-cache" });

      if (response.status === 404) {
        console.warn(`[${label}] ${relativePath} is not present yet`);
        return { ok: true, data: [], missing: true };
      }

      if (!response.ok) {
        console.error(`[${label}] failed to fetch ${relativePath}`, response.status);
        return { ok: false };
      }

      try {
        const data = await response.json();
        return { ok: true, data, missing: false };
      } catch (error) {
        console.error(`[${label}] failed to parse ${relativePath}`, error);
        return { ok: false };
      }
    } catch (error) {
      console.error(`[${label}] failed to load ${relativePath}`, error);
      return { ok: false };
    }
  }

  /**
   * @param {string} label
   * @returns {Promise<{ ok: true, data: unknown, missing: boolean } | { ok: false }>}
   */
  function fetchPostsIndex(label) {
    return fetchIndexJson(POSTS_INDEX_URL, label);
  }

  /**
   * @param {string} label
   * @returns {Promise<{ ok: true, data: unknown, missing: boolean } | { ok: false }>}
   */
  function fetchWorksIndex(label) {
    return fetchIndexJson(WORKS_INDEX_URL, label);
  }

  global.CmsLists = {
    fetchPostsIndex,
    fetchWorksIndex,
    parsePostsIndex,
    parseWorksIndex,
  };
})(window);
