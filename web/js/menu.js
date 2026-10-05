(() => {
  const MENU_API = "/rest/get/menu";

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

  function renderParent(menu) {
    const children = Array.isArray(menu.children) ? menu.children : [];
    const title = escapeHtml(menu.title || "");
    const topHref = menuHref(menu.folder);
    const panelBody = children.length
      ? children.map(renderChild).join("")
      : `<p class="panel-empty">기록 예정이에요</p>`;

    return `
      <div class="nav-item nav-link-desktop" data-nav-item>
        <a class="nav-link" href="${topHref}">${title}</a>
        <div class="nav-panel" role="region" aria-label="${title} 하위메뉴">
          <div class="nav-panel-inner${children.length ? "" : " is-empty"}">
            ${panelBody}
          </div>
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

  async function loadMenus() {
    const mount = document.querySelector("[data-dynamic-menu]");
    if (!mount) return;

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
      bindNavKeyboard(mount);
    } catch (err) {
      console.error("Failed to load WebMenu:", err);
      mount.innerHTML = "";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadMenus);
  } else {
    loadMenus();
  }
})();
