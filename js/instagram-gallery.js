/**
 * Instagram ギャラリー表示・モーダル
 * data/instagram.json を読み、instagram.html（12件ページネーション）とホーム（最大3件）で共用する。
 * ホームは分類JSONを使わず最新N件。Instagramページは分類済み投稿だけを一覧表示する。
 * 左右操作は投稿間ではなく、1投稿内の画像送りに使う。
 */
(function () {
  const galleryRoot = document.querySelector("[data-instagram-gallery]");
  if (!galleryRoot) return;

  const gridEl = galleryRoot.querySelector(".instagram-gallery");
  const messageEl = galleryRoot.querySelector(".instagram-gallery-message");
  const modalEl = document.querySelector(".instagram-modal");
  const parsedLimit = Number.parseInt(galleryRoot.getAttribute("data-instagram-limit") || "9", 10);
  const displayLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 9;
  const ARCHIVE_PAGE_SIZE = (window.InstagramClassifications && window.InstagramClassifications.ARCHIVE_PAGE_SIZE) || 12;
  const ALL_CATEGORY_FILTER =
    (window.InstagramClassifications && window.InstagramClassifications.ALL_CATEGORY_FILTER) || "all";
  const isHomeGallery = Boolean(galleryRoot.closest(".home-instagram"));
  const NEW_BADGE_SRC = new URL("images/ui/new-badge.png", window.location.href).href;

  if (!gridEl || !messageEl) return;

  const DATA_URL = new URL("data/instagram.json", window.location.href).href;
  const CLASSIFICATIONS_URL = new URL("data/instagram-classifications.json", window.location.href).href;
  const LOADING_MESSAGE = "読み込み中...";
  const EMPTY_MESSAGE = "現在投稿を読み込めません。";
  const ARCHIVE_EMPTY_MESSAGE = "現在公開中の投稿はありません。";
  const SWIPE_MIN_DISTANCE = 48;
  const SWIPE_HORIZONTAL_RATIO = 1.2;

  /**
   * @typedef {{
   *   id: string,
   *   media_url: string,
   *   permalink: string,
   *   media_type: string,
   *   thumbnail_url: string | null,
   *   timestamp: string,
   *   local_media_path?: string | null,
   *   children?: Array<{
   *     media_url?: string,
   *     thumbnail_url?: string | null,
   *     media_type?: string,
   *     local_media_path?: string | null
   *   }>
   * }} InstagramPost
   */

  /**
   * 保存済みURL（リポジトリ相対パスまたは R2 カスタムドメイン）があればそれを使い、
   * 未移行の既存投稿は CDN URL にフォールバックする。
   * @param {{ media_type?: string, media_url?: string, thumbnail_url?: string | null, local_media_path?: string | null } | null | undefined} item
   * @returns {string}
   */
  function resolveMediaUrl(item) {
    if (!item) {
      return "";
    }
    if (typeof item.local_media_path === "string" && item.local_media_path) {
      return item.local_media_path;
    }
    if (item.media_type === "VIDEO") {
      return item.thumbnail_url || item.media_url || "";
    }
    return item.media_url || item.thumbnail_url || "";
  }

  /** @type {InstagramPost[]} */
  let classifiedPosts = [];
  /** @type {InstagramPost[]} */
  let filteredPosts = [];
  /** @type {InstagramPost[]} */
  let listedPosts = [];
  /** @type {InstagramPost[]} */
  let posts = [];
  /** @type {InstagramPost[]} */
  let validPosts = [];
  /** @type {{ categories: Array<{ id: string, name: string }>, assignments: Record<string, string> } | null} */
  let classificationsData = null;
  let currentCategoryFilter = ALL_CATEGORY_FILTER;
  let currentPage = 1;
  let currentIndex = 0;
  let currentSlide = 0;
  /** @type {HTMLElement | null} */
  let lastFocusedElement = null;

  const modalParts = modalEl
    ? {
        closeBtn: modalEl.querySelector(".instagram-modal-close"),
        prevBtn: modalEl.querySelector(".instagram-modal-prev"),
        nextBtn: modalEl.querySelector(".instagram-modal-next"),
        image: modalEl.querySelector(".instagram-modal-image"),
        link: modalEl.querySelector(".instagram-modal-link"),
        counter: modalEl.querySelector(".instagram-modal-counter"),
        stage: modalEl.querySelector(".instagram-modal-stage") || modalEl.querySelector(".instagram-modal-figure"),
        focusable: () =>
          /** @type {HTMLElement[]} */ (
            Array.from(
              modalEl.querySelectorAll(
                'button:not([hidden]):not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
              ),
            ).filter((el) => !el.closest("[hidden]"))
          ),
      }
    : null;

  /**
   * @param {string} timestamp
   * @returns {string}
   */
  function formatDateForAlt(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return "Instagram投稿";
    }
    return `Instagram投稿（${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日）`;
  }

  /**
   * @param {InstagramPost} post
   * @returns {string[]}
   */
  function getPostSlides(post) {
    const slides = [];

    if (Array.isArray(post.children)) {
      post.children.forEach((child) => {
        if (!child) return;
        const url = resolveMediaUrl(child);
        if (typeof url === "string" && url) {
          slides.push(url);
        }
      });
    }

    if (slides.length > 0) {
      return slides;
    }

    const fallback = resolveMediaUrl(post);
    return fallback ? [fallback] : [];
  }

  /**
   * @param {InstagramPost} post
   * @returns {boolean}
   */
  function isCarouselPost(post) {
    return getPostSlides(post).length > 1 || post.media_type === "CAROUSEL_ALBUM";
  }

  function hidePagination() {
    const navEl = galleryRoot.querySelector(".instagram-pagination");
    const listEl = galleryRoot.querySelector(".instagram-pagination-list");
    if (navEl instanceof HTMLElement) {
      navEl.hidden = true;
    }
    if (listEl instanceof HTMLElement) {
      listEl.innerHTML = "";
    }
  }

  function getValidCategoryIds() {
    const Classifications = window.InstagramClassifications;
    if (!Classifications || !classificationsData) {
      return [];
    }
    return Classifications.visibleCategories(classificationsData).map((category) => category.id);
  }

  function readUrlState() {
    const Classifications = window.InstagramClassifications;
    if (!Classifications) {
      return { category: ALL_CATEGORY_FILTER, page: 1, post: null };
    }
    return Classifications.parseArchiveSearch(window.location.search, {
      validCategoryIds: getValidCategoryIds(),
    });
  }

  /**
   * @param {{ replace?: boolean, postId?: string | null }} [options]
   */
  function syncUrl(options) {
    if (isHomeGallery) {
      return;
    }

    const Classifications = window.InstagramClassifications;
    if (!Classifications) {
      return;
    }

    const postId = options && Object.prototype.hasOwnProperty.call(options, "postId")
      ? options.postId
      : new URLSearchParams(window.location.search).get("post");
    const search = Classifications.buildArchiveSearch({
      category: currentCategoryFilter,
      page: currentPage,
      post: postId || null,
    });
    const nextUrl = `${window.location.pathname}${search}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl === currentUrl) {
      return;
    }

    if (options && options.replace) {
      history.replaceState({ instagramArchive: true }, "", nextUrl);
      return;
    }

    history.pushState({ instagramArchive: true }, "", nextUrl);
  }

  function updatePagination() {
    const navEl = galleryRoot.querySelector(".instagram-pagination");
    const listEl = galleryRoot.querySelector(".instagram-pagination-list");
    const Classifications = window.InstagramClassifications;
    if (!(navEl instanceof HTMLElement) || !(listEl instanceof HTMLElement) || isHomeGallery || !Classifications) {
      return;
    }

    if (!Classifications.shouldShowPagination(filteredPosts.length, ARCHIVE_PAGE_SIZE)) {
      hidePagination();
      return;
    }

    const totalPages = Classifications.pageCount(filteredPosts.length, ARCHIVE_PAGE_SIZE);
    const items = Classifications.paginationItems(currentPage, totalPages);
    listEl.innerHTML = "";

    /**
     * @param {{ page?: number, label: string, current?: boolean, disabled?: boolean, ariaLabel?: string }} spec
     */
    function appendButton(spec) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "instagram-pagination-button";
      button.textContent = spec.label;
      if (spec.page) {
        button.dataset.page = String(spec.page);
      }
      if (spec.current) {
        button.classList.add("is-current");
        button.setAttribute("aria-current", "page");
      }
      if (spec.disabled) {
        button.disabled = true;
      }
      if (spec.ariaLabel) {
        button.setAttribute("aria-label", spec.ariaLabel);
      }
      item.appendChild(button);
      listEl.appendChild(item);
    }

    appendButton({
      page: currentPage - 1,
      label: "前へ",
      disabled: currentPage <= 1,
      ariaLabel: "前のページ",
    });

    items.forEach((entry) => {
      if (entry === "ellipsis") {
        const item = document.createElement("li");
        item.className = "instagram-pagination-ellipsis";
        item.setAttribute("aria-hidden", "true");
        item.textContent = "…";
        listEl.appendChild(item);
        return;
      }

      appendButton({
        page: entry,
        label: String(entry),
        current: entry === currentPage,
        ariaLabel: `${entry}ページ目`,
      });
    });

    appendButton({
      page: currentPage + 1,
      label: "次へ",
      disabled: currentPage >= totalPages,
      ariaLabel: "次のページ",
    });

    navEl.hidden = false;
  }

  /**
   * @param {string} text
   */
  function showMessage(text) {
    gridEl.innerHTML = "";
    gridEl.setAttribute("hidden", "");
    messageEl.textContent = text || EMPTY_MESSAGE;
    messageEl.removeAttribute("hidden");
    hidePagination();
  }

  function showGallery() {
    messageEl.setAttribute("hidden", "");
    gridEl.removeAttribute("hidden");
  }

  function hideCategoryNav() {
    const navEl = galleryRoot.querySelector(".instagram-categories");
    if (navEl instanceof HTMLElement) {
      navEl.hidden = true;
    }
  }

  function updateCategoryCurrent() {
    const listEl = galleryRoot.querySelector(".instagram-category-list");
    if (!listEl) {
      return;
    }
    listEl.querySelectorAll(".instagram-category-link").forEach((item) => {
      item.classList.toggle("is-current", item instanceof HTMLButtonElement && item.dataset.filter === currentCategoryFilter);
    });
  }

  /**
   * @param {{ categories: Array<{ id: string, name: string }>, assignments: Record<string, string> }} classifications
   */
  function renderCategoryNav(classifications) {
    if (isHomeGallery) {
      return;
    }

    const navEl = galleryRoot.querySelector(".instagram-categories");
    const listEl = galleryRoot.querySelector(".instagram-category-list");
    const Classifications = window.InstagramClassifications;
    if (!(navEl instanceof HTMLElement) || !(listEl instanceof HTMLElement) || !Classifications) {
      return;
    }

    const categories = Classifications.visibleCategories(classifications);
    listEl.innerHTML = "";

    /**
     * @param {string} filter
     * @param {string} label
     */
    function appendLink(filter, label) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "instagram-category-link";
      if (filter === currentCategoryFilter) {
        button.classList.add("is-current");
      }
      button.dataset.filter = filter;
      button.textContent = label;
      item.appendChild(button);
      listEl.appendChild(item);
    }

    appendLink(ALL_CATEGORY_FILTER, "すべて");
    categories.forEach((category) => {
      appendLink(category.id, category.name || category.id);
    });

    navEl.hidden = false;
  }

  /**
   * @param {{ skipUrl?: boolean, replaceUrl?: boolean, postId?: string | null }} [options]
   */
  function renderVisiblePosts(options) {
    const Classifications = window.InstagramClassifications;
    filteredPosts = Classifications
      ? Classifications.selectPostsForCategory(classifiedPosts, classificationsData, currentCategoryFilter)
      : [];
    currentPage = Classifications
      ? Classifications.clampPage(currentPage, filteredPosts.length, ARCHIVE_PAGE_SIZE)
      : 1;
    listedPosts = Classifications
      ? Classifications.slicePage(filteredPosts, currentPage, ARCHIVE_PAGE_SIZE)
      : filteredPosts.slice(0, ARCHIVE_PAGE_SIZE);
    posts = listedPosts;

    if (listedPosts.length === 0) {
      showMessage(ARCHIVE_EMPTY_MESSAGE);
    } else {
      renderGallery(listedPosts);
      updatePagination();
    }

    updateCategoryCurrent();

    if (!(options && options.skipUrl)) {
      syncUrl({
        replace: Boolean(options && options.replaceUrl),
        postId: options && Object.prototype.hasOwnProperty.call(options, "postId") ? options.postId : undefined,
      });
    }
  }

  /**
   * @param {InstagramPost[]} items
   */
  function renderGallery(items) {
    gridEl.innerHTML = "";

    items.forEach((post, index) => {
      const item = isHomeGallery ? document.createElement("a") : document.createElement("button");
      item.className = "instagram-gallery-item";

      if (isHomeGallery) {
        item.href = post.id
          ? `instagram.html?post=${encodeURIComponent(String(post.id))}`
          : "instagram.html";
      } else {
        item.type = "button";
        item.dataset.index = String(index);
      }

      const slideCount = getPostSlides(post).length;
      const dateLabel = formatDateForAlt(post.timestamp);
      const showNewBadge = isHomeGallery && index === 0;
      const labelParts = [dateLabel];
      if (showNewBadge) {
        labelParts.push("最新");
      }
      if (slideCount > 1) {
        labelParts.push(`全${slideCount}枚`);
      }
      item.setAttribute(
        "aria-label",
        isHomeGallery ? `${labelParts.join("、")}を見る` : `${labelParts.join("、")}を拡大表示`,
      );

      const thumb = document.createElement("span");
      thumb.className = "instagram-gallery-thumb";

      const img = document.createElement("img");
      img.src = resolveMediaUrl(post);
      img.alt = dateLabel;
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.width = 400;
      img.height = 400;
      thumb.appendChild(img);
      item.appendChild(thumb);

      if (showNewBadge) {
        const newBadge = document.createElement("img");
        newBadge.className = "instagram-new-badge";
        newBadge.src = NEW_BADGE_SRC;
        newBadge.alt = "";
        newBadge.setAttribute("aria-hidden", "true");
        item.appendChild(newBadge);
      }

      if (isCarouselPost(post)) {
        const badge = document.createElement("span");
        badge.className = "instagram-carousel-badge";
        badge.setAttribute("aria-hidden", "true");
        item.appendChild(badge);
      }

      gridEl.appendChild(item);
    });

    showGallery();
  }

  function scrollListingIntoView() {
    const target = galleryRoot.querySelector(".instagram-categories") || galleryRoot;
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: "start" });
    }
  }

  /**
   * @param {number} postIndex
   * @param {number} slideIndex
   */
  function updateModal(postIndex, slideIndex) {
    if (!modalParts || !posts[postIndex]) return;

    const post = posts[postIndex];
    const slides = getPostSlides(post);
    if (slides.length === 0) return;

    currentIndex = postIndex;
    currentSlide = Math.max(0, Math.min(slideIndex, slides.length - 1));

    const dateLabel = formatDateForAlt(post.timestamp);
    modalParts.image.src = slides[currentSlide];
    modalParts.image.alt =
      slides.length > 1
        ? `${dateLabel} ${currentSlide + 1}枚目`
        : dateLabel;
    modalParts.link.href = post.permalink;

    const isCarousel = slides.length > 1;

    if (modalParts.prevBtn instanceof HTMLButtonElement) {
      modalParts.prevBtn.hidden = !isCarousel;
      modalParts.prevBtn.disabled = currentSlide <= 0;
    }

    if (modalParts.nextBtn instanceof HTMLButtonElement) {
      modalParts.nextBtn.hidden = !isCarousel;
      modalParts.nextBtn.disabled = currentSlide >= slides.length - 1;
    }

    if (modalParts.counter instanceof HTMLElement) {
      if (isCarousel) {
        modalParts.counter.hidden = false;
        modalParts.counter.textContent = `${currentSlide + 1} / ${slides.length}`;
      } else {
        modalParts.counter.hidden = true;
        modalParts.counter.textContent = "";
      }
    }
  }

  /**
   * @param {number} postIndex
   */
  function openModal(postIndex) {
    if (!modalEl || !modalParts || !posts[postIndex]) return;

    lastFocusedElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    updateModal(postIndex, 0);
    modalEl.hidden = false;
    modalEl.classList.add("is-open");
    document.body.classList.add("instagram-modal-open");

    if (modalParts.closeBtn instanceof HTMLElement) {
      modalParts.closeBtn.focus();
    }
  }

  /**
   * @param {{ skipUrl?: boolean }} [options]
   */
  function closeModal(options) {
    if (!modalEl) return;

    modalEl.hidden = true;
    modalEl.classList.remove("is-open");
    document.body.classList.remove("instagram-modal-open");
    posts = listedPosts;
    currentIndex = 0;
    currentSlide = 0;

    if (!(options && options.skipUrl) && new URLSearchParams(window.location.search).has("post")) {
      syncUrl({ postId: null });
    }

    if (lastFocusedElement) {
      lastFocusedElement.focus();
      lastFocusedElement = null;
    }
  }

  /**
   * @param {number} delta
   */
  function moveSlide(delta) {
    const post = posts[currentIndex];
    if (!post) return;

    const slides = getPostSlides(post);
    const nextSlide = currentSlide + delta;
    if (nextSlide < 0 || nextSlide >= slides.length) return;
    updateModal(currentIndex, nextSlide);
  }

  /**
   * @param {KeyboardEvent} event
   */
  function trapFocus(event) {
    if (!modalEl || modalEl.hidden || !modalParts) return;

    const focusable = modalParts.focusable();
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.key === "Tab") {
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  function bindSwipeEvents() {
    if (!modalEl || !modalParts || !modalParts.stage) return;

    const stage = modalParts.stage;
    /** @type {{ x: number, y: number } | null} */
    let start = null;

    stage.addEventListener("pointerdown", (event) => {
      if (!(event instanceof PointerEvent)) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY };
    });

    stage.addEventListener("pointerup", (event) => {
      if (!(event instanceof PointerEvent) || !start) {
        start = null;
        return;
      }

      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      start = null;

      if (Math.abs(dx) < SWIPE_MIN_DISTANCE) return;
      if (Math.abs(dx) < Math.abs(dy) * SWIPE_HORIZONTAL_RATIO) return;

      if (dx < 0) {
        moveSlide(1);
      } else {
        moveSlide(-1);
      }
    });

    stage.addEventListener("pointercancel", () => {
      start = null;
    });
  }

  function bindModalEvents() {
    if (!modalEl || !modalParts) return;

    modalEl.addEventListener("click", (event) => {
      if (event.target === modalEl) {
        closeModal();
      }
    });

    if (modalParts.closeBtn) {
      modalParts.closeBtn.addEventListener("click", () => closeModal());
    }
    if (modalParts.prevBtn) {
      modalParts.prevBtn.addEventListener("click", () => moveSlide(-1));
    }
    if (modalParts.nextBtn) {
      modalParts.nextBtn.addEventListener("click", () => moveSlide(1));
    }

    document.addEventListener("keydown", (event) => {
      if (modalEl.hidden) return;

      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveSlide(-1);
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveSlide(1);
        return;
      }

      trapFocus(event);
    });

    bindSwipeEvents();
  }

  /**
   * @param {number} index
   * @param {{ syncUrl?: boolean }} [options]
   */
  function openListedModal(index, options) {
    posts = listedPosts;
    const post = listedPosts[index];
    if (post && post.id && !(options && options.syncUrl === false)) {
      syncUrl({ postId: String(post.id) });
    }
    openModal(index);
  }

  /**
   * @param {string | null} [postId]
   */
  function openPostFromQuery(postId) {
    if (isHomeGallery) return;

    const targetId = postId || new URLSearchParams(window.location.search).get("post");
    if (!targetId) return;

    const Classifications = window.InstagramClassifications;
    if (Classifications) {
      const page = Classifications.pageOfPost(filteredPosts, targetId, ARCHIVE_PAGE_SIZE);
      if (page && page !== currentPage) {
        currentPage = page;
        renderVisiblePosts({ skipUrl: true });
      }
    }

    const resolved = Classifications
      ? Classifications.resolveDirectPost(targetId, listedPosts, validPosts)
      : {
          listedIndex: listedPosts.findIndex((post) => String(post.id) === targetId),
          directPost: validPosts.find((post) => String(post.id) === targetId) || null,
        };

    if (resolved.listedIndex >= 0) {
      openListedModal(resolved.listedIndex, { syncUrl: false });
      return;
    }

    if (resolved.directPost) {
      posts = [resolved.directPost];
      openModal(0);
    }
  }

  /**
   * @param {{ replaceUrl?: boolean }} [options]
   */
  function applyUrlState(options) {
    const urlState = readUrlState();
    currentCategoryFilter = urlState.category;
    currentPage = urlState.page;
    renderVisiblePosts({
      skipUrl: !(options && options.replaceUrl),
      replaceUrl: Boolean(options && options.replaceUrl),
      postId: urlState.post,
    });

    if (urlState.post) {
      openPostFromQuery(urlState.post);
    } else if (modalEl && !modalEl.hidden) {
      closeModal({ skipUrl: true });
    }
  }

  function bindGalleryEvents() {
    if (isHomeGallery) return;

    gridEl.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const button = target.closest(".instagram-gallery-item");
      if (!button || !button.dataset.index) return;

      openListedModal(Number(button.dataset.index));
    });

    const categoryListEl = galleryRoot.querySelector(".instagram-category-list");
    if (categoryListEl) {
      categoryListEl.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const button = target.closest(".instagram-category-link");
        if (!(button instanceof HTMLButtonElement) || !button.dataset.filter) return;

        const nextFilter = button.dataset.filter;
        if (nextFilter === currentCategoryFilter) return;

        currentCategoryFilter = nextFilter;
        currentPage = 1;
        if (modalEl && !modalEl.hidden) {
          closeModal({ skipUrl: true });
        }
        renderVisiblePosts({ postId: null });
        scrollListingIntoView();
      });
    }

    const paginationEl = galleryRoot.querySelector(".instagram-pagination");
    if (paginationEl) {
      paginationEl.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const button = target.closest("[data-page]");
        if (!(button instanceof HTMLButtonElement) || button.disabled || !button.dataset.page) return;

        const nextPage = Number.parseInt(button.dataset.page, 10);
        if (!Number.isFinite(nextPage) || nextPage === currentPage) return;

        currentPage = nextPage;
        if (modalEl && !modalEl.hidden) {
          closeModal({ skipUrl: true });
        }
        renderVisiblePosts({ postId: null });
        scrollListingIntoView();
      });
    }

    window.addEventListener("popstate", () => {
      applyUrlState();
    });
  }

  /**
   * Instagramページ専用。ホームでは呼ばない。
   * @returns {Promise<{ categories: Array<{ id: string, name: string }>, assignments: Record<string, string> } | null>}
   */
  async function loadClassifications() {
    const Classifications = window.InstagramClassifications;
    if (!Classifications) {
      return null;
    }

    try {
      const response = await fetch(CLASSIFICATIONS_URL, { cache: "no-cache" });
      if (!response.ok) {
        return null;
      }
      return Classifications.parseClassifications(await response.json());
    } catch {
      return null;
    }
  }

  async function init() {
    bindGalleryEvents();
    bindModalEvents();
    showMessage(LOADING_MESSAGE);

    try {
      const response = await fetch(DATA_URL, { cache: "no-cache" });
      if (!response.ok) {
        showMessage(EMPTY_MESSAGE);
        return;
      }

      const data = await response.json();
      if (!Array.isArray(data.posts) || data.posts.length === 0) {
        showMessage(EMPTY_MESSAGE);
        return;
      }

      validPosts = data.posts.filter((post) => post && post.permalink && resolveMediaUrl(post));

      if (isHomeGallery) {
        listedPosts = validPosts.slice(0, displayLimit);
        posts = listedPosts;
        if (listedPosts.length === 0) {
          showMessage(EMPTY_MESSAGE);
          return;
        }
        renderGallery(listedPosts);
        return;
      }

      const classifications = await loadClassifications();
      if (!classifications) {
        classifiedPosts = [];
        filteredPosts = [];
        listedPosts = [];
        posts = [];
        classificationsData = null;
        currentPage = 1;
        hideCategoryNav();
        showMessage(EMPTY_MESSAGE);
        openPostFromQuery();
        return;
      }

      const Classifications = window.InstagramClassifications;
      classificationsData = classifications;
      classifiedPosts = Classifications
        ? Classifications.selectClassifiedPosts(validPosts, classifications)
        : [];
      const urlState = readUrlState();
      currentCategoryFilter = urlState.category;
      currentPage = urlState.page;
      renderCategoryNav(classifications);
      renderVisiblePosts({ skipUrl: true });
      if (urlState.post) {
        openPostFromQuery(urlState.post);
      }
      syncUrl({ replace: true, postId: urlState.post });
    } catch {
      filteredPosts = [];
      listedPosts = [];
      posts = [];
      currentPage = 1;
      showMessage(EMPTY_MESSAGE);
    }
  }

  init();
})();
