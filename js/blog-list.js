/**
 * ブログ一覧
 * data/posts/posts-index.json を読み込んで表示する。
 */
(function () {
  const pageRoot = document.querySelector("[data-blog-list-root]");
  const homeRoot = document.querySelector("[data-home-blog-root]");

  if ((!pageRoot && !homeRoot) || !window.CmsLists) {
    return;
  }

  const EMPTY_MESSAGE = "現在公開中の記事はありません。";
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
   * @param {NonNullable<ReturnType<typeof window.CmsLists.parsePostsIndex>>[number]} post
   * @param {{ titleTag: "h2" | "h3", classPrefix: "blog-entry" | "home-blog-entry" }} options
   * @returns {HTMLElement}
   */
  function createPostArticle(post, options) {
    const article = document.createElement("article");
    article.className = options.classPrefix;

    if (post.slug) {
      article.dataset.slug = post.slug;
    }

    if (post.category) {
      article.dataset.category = post.category;
    }

    const link = document.createElement("a");
    link.className = `${options.classPrefix}-link`;
    link.href = post.href;

    const info = document.createElement("div");
    info.className = `${options.classPrefix}-info`;

    const meta = document.createElement("div");
    meta.className = `${options.classPrefix}-meta`;

    const time = document.createElement("time");
    time.className = `${options.classPrefix}-date`;
    time.dateTime = post.publishDate;
    time.textContent = post.dateLabel;
    meta.appendChild(time);

    if (post.category) {
      const category = document.createElement("span");
      category.className = `${options.classPrefix}-category`;
      category.textContent = post.category;
      meta.appendChild(category);
    }

    info.appendChild(meta);

    const title = document.createElement(options.titleTag);
    title.className = `${options.classPrefix}-title`;
    title.textContent = post.title;
    info.appendChild(title);

    if (post.excerpt) {
      const excerpt = document.createElement("p");
      excerpt.className = `${options.classPrefix}-summary`;
      excerpt.textContent = post.excerpt;
      info.appendChild(excerpt);
    }

    link.appendChild(info);

    if (post.imageSrc) {
      const figure = document.createElement("figure");
      figure.className = `${options.classPrefix}-eyecatch`;

      const img = document.createElement("img");
      img.className = `${options.classPrefix}-image`;
      img.src = post.imageSrc;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      figure.appendChild(img);
      link.appendChild(figure);
    }

    const arrow = document.createElement("span");
    arrow.className = `${options.classPrefix}-arrow`;
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "→";
    link.appendChild(arrow);

    article.appendChild(link);
    return article;
  }

  /**
   * @param {HTMLElement} listEl
   * @param {NonNullable<ReturnType<typeof window.CmsLists.parsePostsIndex>>} posts
   * @param {{ titleTag: "h2" | "h3", classPrefix: "blog-entry" | "home-blog-entry" }} options
   */
  function renderPosts(listEl, posts, options) {
    listEl.innerHTML = "";

    posts.forEach((post) => {
      listEl.appendChild(createPostArticle(post, options));
    });
  }

  /**
   * @param {HTMLElement} categoryListEl
   * @param {HTMLElement} listEl
   * @param {string[]} categories
   */
  function renderCategoryNav(categoryListEl, listEl, categories) {
    categoryListEl.innerHTML = "";

    const allItem = document.createElement("li");
    const allButton = document.createElement("button");
    allButton.type = "button";
    allButton.className = "blog-category-link is-current";
    allButton.dataset.filter = "all";
    allButton.textContent = "すべて";
    allItem.appendChild(allButton);
    categoryListEl.appendChild(allItem);

    categories.forEach((category) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "blog-category-link";
      button.dataset.filter = category;
      button.textContent = category;
      item.appendChild(button);
      categoryListEl.appendChild(item);
    });

    categoryListEl.querySelectorAll(".blog-category-link").forEach((button) => {
      button.addEventListener("click", () => {
        const filter = button.getAttribute("data-filter") || "all";

        categoryListEl.querySelectorAll(".blog-category-link").forEach((item) => {
          item.classList.toggle("is-current", item === button);
        });

        listEl.querySelectorAll(".blog-entry").forEach((article) => {
          const category = article instanceof HTMLElement ? article.dataset.category || "" : "";
          const visible = filter === "all" || category === filter;
          article.hidden = !visible;
        });
      });
    });
  }

  /**
   * @param {NonNullable<ReturnType<typeof window.CmsLists.parsePostsIndex>>} posts
   * @returns {string[]}
   */
  function uniqueCategories(posts) {
    const seen = new Set();
    /** @type {string[]} */
    const categories = [];

    posts.forEach((post) => {
      if (!post.category || seen.has(post.category)) {
        return;
      }

      seen.add(post.category);
      categories.push(post.category);
    });

    return categories;
  }

  async function initPage() {
    if (!pageRoot) {
      return;
    }

    const listEl = pageRoot.querySelector(".blog-entries");
    const messageEl = pageRoot.querySelector(".blog-list-message");
    const categoryListEl = document.querySelector(".blog-category-list");

    if (!(listEl instanceof HTMLElement) || !(messageEl instanceof HTMLElement)) {
      return;
    }

    showMessage(messageEl, listEl, LOADING_MESSAGE);

    const fetched = await window.CmsLists.fetchPostsIndex("blog-list");

    if (!fetched.ok) {
      showMessage(messageEl, listEl, EMPTY_MESSAGE);
      return;
    }

    const posts = window.CmsLists.parsePostsIndex(fetched.data);

    if (!posts) {
      showMessage(messageEl, listEl, EMPTY_MESSAGE);
      return;
    }

    if (posts.length === 0) {
      showMessage(messageEl, listEl, EMPTY_MESSAGE);

      if (categoryListEl instanceof HTMLElement) {
        renderCategoryNav(categoryListEl, listEl, []);
      }

      return;
    }

    renderPosts(listEl, posts, { titleTag: "h2", classPrefix: "blog-entry" });
    showList(messageEl, listEl);

    if (categoryListEl instanceof HTMLElement) {
      renderCategoryNav(categoryListEl, listEl, uniqueCategories(posts));
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

    const fetched = await window.CmsLists.fetchPostsIndex("home-blog");

    if (!fetched.ok) {
      showMessage(messageEl, null, EMPTY_MESSAGE);
      return;
    }

    const posts = window.CmsLists.parsePostsIndex(fetched.data);

    if (!posts || posts.length === 0) {
      showMessage(messageEl, null, EMPTY_MESSAGE);
      return;
    }

    messageEl.hidden = true;
    messageEl.textContent = "";

    posts.slice(0, 3).forEach((post) => {
      homeRoot.appendChild(
        createPostArticle(post, { titleTag: "h3", classPrefix: "home-blog-entry" }),
      );
    });
  }

  initPage();
  initHome();
})();
