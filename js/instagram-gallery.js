/**
 * Instagram ギャラリー表示・モーダル
 * data/instagram.json を読み、instagram.html（最大9件）とホーム（最大3件）で共用する。
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
  const isHomeGallery = Boolean(galleryRoot.closest(".home-instagram"));
  const NEW_BADGE_SRC = new URL("images/ui/new-badge.png", window.location.href).href;

  if (!gridEl || !messageEl) return;

  const DATA_URL = new URL("data/instagram.json", window.location.href).href;
  const LOADING_MESSAGE = "読み込み中...";
  const EMPTY_MESSAGE = "現在投稿を読み込めません。";
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
   * ローカル保存画像があればそれを使い、未移行の既存投稿は CDN URL にフォールバックする。
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
  let posts = [];
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

  /**
   * @param {string} text
   */
  function showMessage(text) {
    gridEl.innerHTML = "";
    gridEl.setAttribute("hidden", "");
    messageEl.textContent = text || EMPTY_MESSAGE;
    messageEl.removeAttribute("hidden");
  }

  function showGallery() {
    messageEl.setAttribute("hidden", "");
    gridEl.removeAttribute("hidden");
  }

  /**
   * @param {InstagramPost[]} items
   */
  function renderGallery(items) {
    const existingCta = gridEl.querySelector(".instagram-cta-card");

    gridEl.querySelectorAll(".instagram-gallery-item:not(.instagram-cta-card)").forEach((item) => {
      item.remove();
    });

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
      const isLatest = index === 0;
      const labelParts = [dateLabel];
      if (isLatest) {
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

      if (isLatest) {
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

      if (existingCta) {
        gridEl.insertBefore(item, existingCta);
      } else {
        gridEl.appendChild(item);
      }
    });

    if (!isHomeGallery && !gridEl.querySelector(".instagram-cta-card")) {
      appendListingCtaCard();
    }

    showGallery();
  }

  function appendListingCtaCard() {
    if (isHomeGallery) {
      return;
    }

    const accountLink = document.querySelector(".page-main .section-link a[href]");

    if (!(accountLink instanceof HTMLAnchorElement) || !accountLink.getAttribute("href")) {
      return;
    }

    const card = document.createElement("a");
    card.className = "instagram-gallery-item instagram-cta-card";
    card.href = accountLink.href;
    card.target = accountLink.target || "_blank";
    card.rel = accountLink.rel || "noopener noreferrer";
    card.setAttribute("aria-label", "Instagramでもっと見る");

    const icon = document.createElement("img");
    icon.className = "instagram-cta-icon";
    icon.src = new URL("images/instagram.png", window.location.href).href;
    icon.alt = "";
    icon.width = 72;
    icon.height = 72;
    card.appendChild(icon);

    const line = document.createElement("span");
    line.className = "instagram-cta-text";
    line.textContent = "Instagramで";
    card.appendChild(line);

    const more = document.createElement("span");
    more.className = "instagram-cta-more";
    more.textContent = "もっと見る →";
    card.appendChild(more);

    gridEl.appendChild(card);
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

  function closeModal() {
    if (!modalEl) return;

    modalEl.hidden = true;
    modalEl.classList.remove("is-open");
    document.body.classList.remove("instagram-modal-open");

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
      modalParts.closeBtn.addEventListener("click", closeModal);
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

  function openPostFromQuery() {
    if (isHomeGallery) return;

    const postId = new URLSearchParams(window.location.search).get("post");
    if (!postId) return;

    const index = posts.findIndex((post) => String(post.id) === postId);
    if (index < 0) return;

    openModal(index);
  }

  function bindGalleryEvents() {
    if (isHomeGallery) return;

    gridEl.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const button = target.closest(".instagram-gallery-item");
      if (!button || !button.dataset.index) return;

      openModal(Number(button.dataset.index));
    });
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

      posts = data.posts
        .filter((post) => post && post.permalink && resolveMediaUrl(post))
        .slice(0, displayLimit);

      if (posts.length === 0) {
        showMessage(EMPTY_MESSAGE);
        return;
      }

      renderGallery(posts);
      openPostFromQuery();
    } catch {
      showMessage(EMPTY_MESSAGE);
    }
  }

  init();
})();
