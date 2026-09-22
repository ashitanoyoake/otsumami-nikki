/**
 * Instagram ギャラリー表示・モーダル
 * data/instagram.json を読み、instagram.html（最大9件）とホーム（最大3件）で共用する。
 */
(function () {
  const galleryRoot = document.querySelector("[data-instagram-gallery]");
  if (!galleryRoot) return;

  const gridEl = galleryRoot.querySelector(".instagram-gallery");
  const messageEl = galleryRoot.querySelector(".instagram-gallery-message");
  const modalEl = document.querySelector(".instagram-modal");
  const parsedLimit = Number.parseInt(galleryRoot.getAttribute("data-instagram-limit") || "9", 10);
  const displayLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 9;

  if (!gridEl || !messageEl) return;

  const DATA_URL = new URL("data/instagram.json", window.location.href).href;
  const LOADING_MESSAGE = "読み込み中...";
  const EMPTY_MESSAGE = "現在投稿を読み込めません。";

  /** @type {Array<{id: string, media_url: string, permalink: string, media_type: string, thumbnail_url: string | null, timestamp: string}>} */
  let posts = [];
  let currentIndex = 0;
  /** @type {HTMLElement | null} */
  let lastFocusedElement = null;

  const modalParts = modalEl
    ? {
        closeBtn: modalEl.querySelector(".instagram-modal-close"),
        prevBtn: modalEl.querySelector(".instagram-modal-prev"),
        nextBtn: modalEl.querySelector(".instagram-modal-next"),
        image: modalEl.querySelector(".instagram-modal-image"),
        link: modalEl.querySelector(".instagram-modal-link"),
        focusable: () =>
          /** @type {HTMLElement[]} */ (
            Array.from(
              modalEl.querySelectorAll(
                'button, a[href], [tabindex]:not([tabindex="-1"])',
              ),
            )
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
   * @param {typeof posts} items
   */
  function renderGallery(items) {
    gridEl.innerHTML = "";

    items.forEach((post, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "instagram-gallery-item";
      button.dataset.index = String(index);
      button.setAttribute("aria-label", `${formatDateForAlt(post.timestamp)}を拡大表示`);

      const img = document.createElement("img");
      img.src = post.media_url;
      img.alt = formatDateForAlt(post.timestamp);
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.width = 400;
      img.height = 400;

      button.appendChild(img);
      gridEl.appendChild(button);
    });

    showGallery();
  }

  /**
   * @param {number} index
   */
  function updateModal(index) {
    if (!modalParts || !posts[index]) return;

    currentIndex = index;
    const post = posts[index];

    modalParts.image.src = post.media_url;
    modalParts.image.alt = formatDateForAlt(post.timestamp);
    modalParts.link.href = post.permalink;

    const hasPrev = index > 0;
    const hasNext = index < posts.length - 1;

    if (modalParts.prevBtn instanceof HTMLButtonElement) {
      modalParts.prevBtn.disabled = !hasPrev;
      modalParts.prevBtn.hidden = posts.length <= 1;
    }

    if (modalParts.nextBtn instanceof HTMLButtonElement) {
      modalParts.nextBtn.disabled = !hasNext;
      modalParts.nextBtn.hidden = posts.length <= 1;
    }
  }

  /**
   * @param {number} index
   */
  function openModal(index) {
    if (!modalEl || !modalParts || !posts[index]) return;

    lastFocusedElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    updateModal(index);
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
  function moveModal(delta) {
    const nextIndex = currentIndex + delta;
    if (nextIndex < 0 || nextIndex >= posts.length) return;
    updateModal(nextIndex);
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
      modalParts.prevBtn.addEventListener("click", () => moveModal(-1));
    }
    if (modalParts.nextBtn) {
      modalParts.nextBtn.addEventListener("click", () => moveModal(1));
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
        moveModal(-1);
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveModal(1);
        return;
      }

      trapFocus(event);
    });
  }

  function bindGalleryEvents() {
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
        .filter((post) => post && post.media_url && post.permalink)
        .slice(0, displayLimit);

      if (posts.length === 0) {
        showMessage(EMPTY_MESSAGE);
        return;
      }

      renderGallery(posts);
    } catch {
      showMessage(EMPTY_MESSAGE);
    }
  }

  init();
})();
