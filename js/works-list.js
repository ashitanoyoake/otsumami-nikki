/**
 * お仕事実績一覧（ユーザー向け表示名は「イラスト」）
 * data/works/works-index.json を読み込んで表示する。
 */
(function () {
  const pageRoot = document.querySelector("[data-works-list-root]");
  const homeRoot = document.querySelector("[data-home-works-root]");

  if ((!pageRoot && !homeRoot) || !window.CmsLists) {
    return;
  }

  const EMPTY_MESSAGE = "現在公開中のイラストはありません。";
  const LOADING_MESSAGE = "読み込み中...";
  const ALL_FILTER = "all";

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

    if (work.category) {
      article.dataset.category = work.category;
    }

    const link = document.createElement("a");
    link.className = "works-entry-link";
    link.href = work.href;

    const figure = document.createElement("figure");
    figure.className = "works-entry-thumb";

    if (work.imageSrc) {
      const img = document.createElement("img");
      img.className = "works-entry-image";
      img.src = work.imageSrc;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      figure.appendChild(img);
    }

    link.appendChild(figure);

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

    link.appendChild(info);
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

    const figure = document.createElement("figure");
    figure.className = "home-works-thumb";

    if (work.imageSrc) {
      const img = document.createElement("img");
      img.src = work.imageSrc;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      figure.appendChild(img);
    }

    link.appendChild(figure);

    if (work.category) {
      const category = document.createElement("span");
      category.className = "home-works-category";
      category.textContent = work.category;
      link.appendChild(category);
    }

    const title = document.createElement("h3");
    title.textContent = work.title;
    link.appendChild(title);

    return link;
  }

  /**
   * @param {NonNullable<ReturnType<typeof window.CmsLists.parseWorksIndex>>} works
   * @returns {string[]}
   */
  function uniqueCategories(works) {
    const seen = new Set();
    /** @type {string[]} */
    const categories = [];

    works.forEach((work) => {
      if (!work.category || seen.has(work.category)) {
        return;
      }

      seen.add(work.category);
      categories.push(work.category);
    });

    return categories;
  }

  /**
   * @param {HTMLElement} navEl
   * @param {HTMLElement} listEl
   * @param {HTMLElement} categoryListEl
   * @param {string[]} categories
   */
  function renderCategoryNav(navEl, listEl, categoryListEl, categories) {
    if (categories.length === 0) {
      navEl.hidden = true;
      categoryListEl.innerHTML = "";
      return;
    }

    categoryListEl.innerHTML = "";

    const allItem = document.createElement("li");
    const allButton = document.createElement("button");
    allButton.type = "button";
    allButton.className = "works-category-link is-current";
    allButton.dataset.filter = ALL_FILTER;
    allButton.textContent = "すべて";
    allItem.appendChild(allButton);
    categoryListEl.appendChild(allItem);

    categories.forEach((category) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "works-category-link";
      button.dataset.filter = category;
      button.textContent = category;
      item.appendChild(button);
      categoryListEl.appendChild(item);
    });

    categoryListEl.querySelectorAll(".works-category-link").forEach((button) => {
      button.addEventListener("click", () => {
        const filter = button.getAttribute("data-filter") || ALL_FILTER;

        categoryListEl.querySelectorAll(".works-category-link").forEach((item) => {
          item.classList.toggle("is-current", item === button);
        });

        listEl.querySelectorAll(".works-entry").forEach((article) => {
          const category = article instanceof HTMLElement ? article.dataset.category || "" : "";
          article.hidden = !(filter === ALL_FILTER || category === filter);
        });
      });
    });

    navEl.hidden = false;
  }

  async function initPage() {
    if (!pageRoot) {
      return;
    }

    const listEl = pageRoot.querySelector(".works-entries");
    const messageEl = pageRoot.querySelector(".works-list-message");
    const categoryNavEl = pageRoot.querySelector(".works-categories");
    const categoryListEl = pageRoot.querySelector(".works-category-list");

    if (!(listEl instanceof HTMLElement) || !(messageEl instanceof HTMLElement)) {
      return;
    }

    showMessage(messageEl, listEl, LOADING_MESSAGE);

    if (categoryNavEl instanceof HTMLElement) {
      categoryNavEl.hidden = true;
    }

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

    if (categoryNavEl instanceof HTMLElement && categoryListEl instanceof HTMLElement) {
      renderCategoryNav(categoryNavEl, listEl, categoryListEl, uniqueCategories(works));
    }
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
