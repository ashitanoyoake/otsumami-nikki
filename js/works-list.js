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
  const ALL_FILTER =
    window.WorksCategories && window.WorksCategories.ALL_WORKS_FILTER
      ? window.WorksCategories.ALL_WORKS_FILTER
      : "all";

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
   * @param {string[] | null} canonicalNames
   * @returns {string[]}
   */
  function visibleCategories(works, canonicalNames) {
    const usedNames = works.map((work) => work.category);

    if (window.WorksCategories) {
      return window.WorksCategories.resolveVisibleWorksCategories(canonicalNames, usedNames);
    }

    const seen = new Set();
    /** @type {string[]} */
    const categories = [];

    usedNames.forEach((name) => {
      if (!name || seen.has(name)) {
        return;
      }

      seen.add(name);
      categories.push(name);
    });

    return categories;
  }

  /**
   * @param {string} search
   * @param {string[]} categories
   * @returns {string}
   */
  function filterFromSearch(search, categories) {
    if (window.WorksCategories) {
      return window.WorksCategories.resolveActiveWorksListFilter(
        categories,
        window.WorksCategories.readWorksListCategoryFilter(search),
      );
    }

    return ALL_FILTER;
  }

  /**
   * @param {string} filter
   * @returns {string}
   */
  function urlForFilter(filter) {
    const pathname = window.location.pathname || "/works.html";

    if (window.WorksCategories) {
      return window.WorksCategories.buildWorksListUrl(pathname, filter);
    }

    return pathname;
  }

  /**
   * @param {HTMLElement} listEl
   * @param {string} filter
   */
  function applyListFilter(listEl, filter) {
    listEl.querySelectorAll(".works-entry").forEach((article) => {
      const category = article instanceof HTMLElement ? article.dataset.category || "" : "";
      article.hidden = !(filter === ALL_FILTER || category === filter);
    });
  }

  /**
   * @param {HTMLElement} categoryListEl
   * @param {string} filter
   */
  function syncCategoryButtons(categoryListEl, filter) {
    categoryListEl.querySelectorAll(".works-category-link").forEach((button) => {
      const isCurrent = button.getAttribute("data-filter") === filter;
      button.classList.toggle("is-current", isCurrent);
      button.setAttribute("aria-pressed", isCurrent ? "true" : "false");
    });
  }

  /**
   * @param {HTMLElement} navEl
   * @param {HTMLElement} listEl
   * @param {HTMLElement} categoryListEl
   * @param {string[]} categories
   */
  function renderCategoryNav(navEl, listEl, categoryListEl, categories) {
    const showNav = window.WorksCategories
      ? window.WorksCategories.shouldShowWorksCategoryNav(categories)
      : true;

    if (!showNav) {
      navEl.hidden = true;
      categoryListEl.innerHTML = "";
      return;
    }

    categoryListEl.innerHTML = "";

    const allItem = document.createElement("li");
    const allButton = document.createElement("button");
    allButton.type = "button";
    allButton.className = "works-category-link";
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

    /**
     * @param {string} filter
     * @param {{ updateHistory?: boolean, replace?: boolean }} [options]
     */
    function applyFilter(filter, options) {
      const nextOptions = options || {};
      syncCategoryButtons(categoryListEl, filter);
      applyListFilter(listEl, filter);

      if (nextOptions.updateHistory) {
        const nextUrl = urlForFilter(filter);
        const currentUrl = `${window.location.pathname}${window.location.search}`;

        if (nextOptions.replace) {
          window.history.replaceState({ category: filter }, "", nextUrl);
        } else if (nextUrl !== currentUrl) {
          window.history.pushState({ category: filter }, "", nextUrl);
        }
      }
    }

    categoryListEl.querySelectorAll(".works-category-link").forEach((button) => {
      button.addEventListener("click", () => {
        const filter = button.getAttribute("data-filter") || ALL_FILTER;
        applyFilter(filter, { updateHistory: true });
      });
    });

    window.addEventListener("popstate", () => {
      applyFilter(filterFromSearch(window.location.search, categories));
    });

    applyFilter(filterFromSearch(window.location.search, categories), {
      updateHistory: true,
      replace: true,
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

    const [fetched, canonicalNames] = await Promise.all([
      window.CmsLists.fetchWorksIndex("works-list"),
      window.WorksCategories
        ? window.WorksCategories.loadCanonicalWorksCategoryNames(fetch, window.location.href)
        : Promise.resolve(null),
    ]);

    if (!fetched.ok) {
      showMessage(messageEl, listEl, EMPTY_MESSAGE);
      return;
    }

    const works = window.CmsLists.parseWorksIndex(fetched.data);

    if (!works) {
      showMessage(messageEl, listEl, EMPTY_MESSAGE);
      return;
    }

    if (works.length === 0) {
      showMessage(messageEl, listEl, EMPTY_MESSAGE);

      if (categoryNavEl instanceof HTMLElement && categoryListEl instanceof HTMLElement) {
        renderCategoryNav(categoryNavEl, listEl, categoryListEl, visibleCategories([], canonicalNames));
      }

      return;
    }

    listEl.innerHTML = "";
    works.forEach((work) => {
      listEl.appendChild(createWorkArticle(work));
    });
    showList(messageEl, listEl);

    if (categoryNavEl instanceof HTMLElement && categoryListEl instanceof HTMLElement) {
      renderCategoryNav(categoryNavEl, listEl, categoryListEl, visibleCategories(works, canonicalNames));
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
