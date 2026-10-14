(() => {
  const MENU_API = "/rest/get/menu";
  const MQ_MOBILE = window.matchMedia("(max-width: 768px)");

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function menuHref(folder) {
    if (!folder) return "#";
    const cleaned = String(folder).replace(/^\/+|\/+$/g, "");
    if (!cleaned) return "#";
    // web 루트 기준 경로 (하위 페이지에서도 동일하게 동작)
    return `/${cleaned}/`;
  }

  function renderChild(child) {
    const href = menuHref(child.folder);
    const title = escapeHtml(child.title || "");
    const label = child.folder
      ? `<span class="panel-label">${escapeHtml(String(child.folder).split("/").pop())}</span>`
      : "";
    return `<div>${label}<a href="${href}">${title}</a></div>`;
  }

  function childCountBadge(count) {
    if (!count) return "";
    return `<span class="nav-count" aria-label="활성 하위 메뉴 ${count}개">${count}</span>`;
  }

  function renderParent(menu) {
    // /rest/get/menu 는 활성(WM_IsActive=1) 메뉴만 반환하므로 children 수가 활성 하위 개수다.
    const children = Array.isArray(menu.children) ? menu.children : [];
    const title = escapeHtml(menu.title || "");
    const topHref = menuHref(menu.folder);
    const count = children.length;
    const panelBody = count
      ? children.map(renderChild).join("")
      : `<p class="panel-empty">기록 예정이에요</p>`;

    return `
      <div class="nav-item nav-link-desktop" data-nav-item>
        <a class="nav-link" href="${topHref}">
          <span class="nav-link-label">${title}</span>
          ${childCountBadge(count)}
        </a>
        <div class="nav-panel" role="region" aria-label="${title} 하위메뉴">
          <div class="nav-panel-inner${count ? "" : " is-empty"}">
            ${panelBody}
          </div>
        </div>
      </div>
    `;
  }

  function renderMobileChild(child) {
    const href = menuHref(child.folder);
    const title = escapeHtml(child.title || "");
    return `<a class="nav-drawer-link" href="${href}">${title}</a>`;
  }

  function renderMobileParent(menu, index) {
    const children = Array.isArray(menu.children) ? menu.children : [];
    const title = escapeHtml(menu.title || "");
    const topHref = menuHref(menu.folder);
    const count = children.length;
    const id = `nav-drawer-section-${index}`;
    const titleWithCount = `
      <span class="nav-drawer-title">
        <span>${title}</span>
        ${childCountBadge(count)}
      </span>
    `;

    if (!count) {
      return `
        <div class="nav-drawer-item">
          <a class="nav-drawer-parent" href="${topHref}">${titleWithCount}</a>
        </div>
      `;
    }

    return `
      <div class="nav-drawer-item" data-drawer-item>
        <button
          type="button"
          class="nav-drawer-parent is-toggle"
          aria-expanded="false"
          aria-controls="${id}"
          data-drawer-toggle
        >
          ${titleWithCount}
          <span class="nav-drawer-chevron" aria-hidden="true"></span>
        </button>
        <div class="nav-drawer-children" id="${id}" hidden>
          ${children.map(renderMobileChild).join("")}
        </div>
      </div>
    `;
  }

  function bindNavKeyboard(root) {
    root.querySelectorAll("[data-nav-item]").forEach((item) => {
      const link = item.querySelector(".nav-link");
      if (!link) return;
      link.addEventListener("keydown", (event) => {
        if (event.key === "Escape") link.blur();
      });
    });
  }

  function setNavOpen(open) {
    const nav = document.querySelector(".site-nav");
    const toggle = document.querySelector("[data-nav-toggle]");
    const drawer = document.querySelector("[data-nav-drawer]");
    if (!nav || !toggle || !drawer) return;

    nav.classList.toggle("is-nav-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
    drawer.hidden = !open;
    document.body.classList.toggle("is-nav-locked", open);

    if (!open) {
      drawer.querySelectorAll("[data-drawer-toggle]").forEach((btn) => {
        btn.setAttribute("aria-expanded", "false");
        const panel = drawer.querySelector(`#${btn.getAttribute("aria-controls")}`);
        if (panel) panel.hidden = true;
      });
    }
  }

  function ensureMobileShell(navInner) {
    let toggle = navInner.querySelector("[data-nav-toggle]");
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "nav-toggle";
      toggle.setAttribute("data-nav-toggle", "");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-controls", "nav-drawer");
      toggle.setAttribute("aria-label", "메뉴 열기");
      toggle.innerHTML = `
        <span class="nav-toggle-bars" aria-hidden="true">
          <span></span><span></span><span></span>
        </span>
      `;
      navInner.appendChild(toggle);
    }

    let drawer = document.querySelector("[data-nav-drawer]");
    if (!drawer) {
      drawer = document.createElement("div");
      drawer.className = "nav-drawer";
      drawer.id = "nav-drawer";
      drawer.setAttribute("data-nav-drawer", "");
      drawer.setAttribute("role", "navigation");
      drawer.setAttribute("aria-label", "모바일 메뉴");
      drawer.hidden = true;
      // site-nav의 backdrop-filter 스택 밖에 두어 히어로 위에 그린다
      document.body.appendChild(drawer);
    }

    return { toggle, drawer };
  }

  function bindMobileNav({ toggle, drawer }) {
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      setNavOpen(open);
    });

    drawer.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-drawer-toggle]");
      if (!btn || !drawer.contains(btn)) return;
      const panelId = btn.getAttribute("aria-controls");
      const panel = panelId ? drawer.querySelector(`#${panelId}`) : null;
      if (!panel) return;
      const next = btn.getAttribute("aria-expanded") !== "true";
      btn.setAttribute("aria-expanded", next ? "true" : "false");
      panel.hidden = !next;
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setNavOpen(false);
    });

    const onViewportChange = () => {
      if (!MQ_MOBILE.matches) setNavOpen(false);
    };
    if (typeof MQ_MOBILE.addEventListener === "function") {
      MQ_MOBILE.addEventListener("change", onViewportChange);
    } else if (typeof MQ_MOBILE.addListener === "function") {
      MQ_MOBILE.addListener(onViewportChange);
    }
  }

  async function loadMenus() {
    const mount = document.querySelector("[data-dynamic-menu]");
    const navInner = document.querySelector(".nav-inner");
    if (!mount || !navInner) return;

    const shell = ensureMobileShell(navInner);
    bindMobileNav(shell);

    try {
      const res = await fetch(MENU_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        throw new Error(`menu api ${res.status}`);
      }
      const data = await res.json();
      const menus = Array.isArray(data.menus) ? data.menus : [];
      mount.innerHTML = menus.map(renderParent).join("");
      shell.drawer.innerHTML = `
        <div class="nav-drawer-inner">
          ${menus.map(renderMobileParent).join("")}
        </div>
      `;
      bindNavKeyboard(mount);
    } catch (err) {
      console.error("Failed to load WebMenu:", err);
      mount.innerHTML = "";
      shell.drawer.innerHTML = `
        <div class="nav-drawer-inner">
          <p class="nav-drawer-empty">메뉴를 불러오지 못했습니다</p>
        </div>
      `;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadMenus);
  } else {
    loadMenus();
  }
})();
