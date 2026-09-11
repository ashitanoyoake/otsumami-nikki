/**
 * お仕事実績一覧
 * data/works/works-index.json を読み込んで表示する。
 */
(function () {
  const pageRoot = document.querySelector("[data-works-list-root]");
  const homeRoot = document.querySelector("[data-home-works-root]");

  if ((!pageRoot && !homeRoot) || !window.CmsLists) {
    return;
  }

  const EMPTY_MESSAGE = "お仕事実績はまだありません。";
  const LOADING_MESSAGE = "読み込み中...";

  /**
   * @param {HTMLElement} messageEl
   * @param {HTMLElement | null} listEl
   * @param {string} text
   */
  function showMessage(messageEl, listEl, text) {
    if (listEl) {
      listEl.innerHTML = "";
      listEl.hidden = true;
    }

    messageEl.textContent = text;
    messageEl.hidden = false;
  }

  /**
   * @param {HTMLElement} messageEl
   * @param {HTMLElement} listEl
   */
  function showList(messageEl, listEl) {
    messageEl.hidden = true;
    messageEl.textContent = "";
    listEl.hidden = false;
  }

  /**
   * @param {NonNullable<ReturnType<typeof window.CmsLists.parseWorksIndex>>[number]} work
   * @returns {HTMLElement}
   */
  function createWorkArticle(work) {
    const article = document.createElement("article");
    article.className = "works-entry";

    if (work.slug) {
      article.dataset.slug = work.slug;
    }

    const link = document.createElement("a");
    link.className = "works-entry-link";
    link.href = work.href;

    if (work.imageSrc) {
      const figure = document.createElement("figure");
      figure.className = "works-entry-thumb";

      const img = document.createElement("img");
      img.className = "works-entry-image";
      img.src = work.imageSrc;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      figure.appendChild(img);
      link.appendChild(figure);
    }

    const info = document.createElement("div");
    info.className = "works-entry-info";

    if (work.category) {
      const category = document.createElement("span");
      category.className = "works-entry-category";
      category.textContent = work.category;
      info.appendChild(category);
    }

    const title = document.createElement("h2");
    title.className = "works-entry-title";
    title.textContent = work.title;
    info.appendChild(title);

    if (work.productionFields.length > 0) {
      const production = document.createElement("ul");
      production.className = "works-entry-production";

      work.productionFields.forEach((field) => {
        const item = document.createElement("li");
        const label = document.createElement("span");
        label.className = "works-entry-production-label";
        label.textContent = field.label;
        const value = document.createElement("span");
        value.textContent = field.text;
        item.appendChild(label);
        item.appendChild(value);
        production.appendChild(item);
      });

      info.appendChild(production);
    }

    if (work.summary) {
      const summary = document.createElement("p");
      summary.className = "works-entry-summary";
      summary.textContent = work.summary;
      info.appendChild(summary);
    }

    link.appendChild(info);

    const arrow = document.createElement("span");
    arrow.className = "works-entry-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "→";
    link.appendChild(arrow);

    article.appendChild(link);
    return article;
  }

  /**
   * @param {NonNullable<ReturnType<typeof window.CmsLists.parseWorksIndex>>[number]} work
   * @returns {HTMLElement}
   */
  function createHomeWorkItem(work) {
    const link = document.createElement("a");
    link.className = "home-works-item";
    link.href = work.href;

    if (work.imageSrc) {
      const img = document.createElement("img");
      img.src = work.imageSrc;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      link.appendChild(img);
    }

    const title = document.createElement("h3");
    title.textContent = work.title;
    link.appendChild(title);

    if (work.summary) {
      const summary = document.createElement("p");
      summary.textContent = work.summary;
      link.appendChild(summary);
    }

    return link;
  }

  async function initPage() {
    if (!pageRoot) {
      return;
    }

    const listEl = pageRoot.querySelector(".works-entries");
    const messageEl = pageRoot.querySelector(".works-list-message");

    if (!(listEl instanceof HTMLElement) || !(messageEl instanceof HTMLElement)) {
      return;
    }

    showMessage(messageEl, listEl, LOADING_MESSAGE);

    const fetched = await window.CmsLists.fetchWorksIndex("works-list");

    if (!fetched.ok) {
      showMessage(messageEl, listEl, EMPTY_MESSAGE);
      return;
    }

    const works = window.CmsLists.parseWorksIndex(fetched.data);

    if (!works || works.length === 0) {
      showMessage(messageEl, listEl, EMPTY_MESSAGE);
      return;
    }

    listEl.innerHTML = "";
    works.forEach((work) => {
      listEl.appendChild(createWorkArticle(work));
    });
    showList(messageEl, listEl);
  }

  async function initHome() {
    if (!homeRoot) {
      return;
    }

    const messageEl = homeRoot.querySelector(".home-list-message");

    if (!(messageEl instanceof HTMLElement)) {
      return;
    }

    showMessage(messageEl, null, LOADING_MESSAGE);

    const fetched = await window.CmsLists.fetchWorksIndex("home-works");

    if (!fetched.ok) {
      showMessage(messageEl, null, EMPTY_MESSAGE);
      return;
    }

    const works = window.CmsLists.parseWorksIndex(fetched.data);

    if (!works || works.length === 0) {
      showMessage(messageEl, null, EMPTY_MESSAGE);
      return;
    }

    messageEl.hidden = true;
    messageEl.textContent = "";

    works.slice(0, 3).forEach((work) => {
      homeRoot.appendChild(createHomeWorkItem(work));
    });
  }

  initPage();
  initHome();
})();
