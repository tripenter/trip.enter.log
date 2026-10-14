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

  function cleanFolder(folder) {
    return String(folder || "")
      .replace(/^\/+|\/+$/g, "")
      .trim();
  }

  function placeHref(folder) {
    const cleaned = cleanFolder(folder);
    return cleaned ? `/${cleaned}/` : "#";
  }

  function coverCandidates(folder) {
    const cleaned = cleanFolder(folder);
    if (!cleaned) return [];
    const base = `/${cleaned}`;
    return [`${base}/cover.jpg`, `${base}/cover.webp`, `${base}/cover.png`];
  }

  function bindCoverFallback(img, candidates) {
    let index = 0;
    img.addEventListener("error", () => {
      index += 1;
      if (index < candidates.length) {
        img.src = candidates[index];
        return;
      }
      img.removeAttribute("src");
      img.hidden = true;
      const figure = img.closest(".place-card-visual");
      if (figure) figure.classList.add("is-fallback");
    });
  }

  function renderPlace(child) {
    const title = escapeHtml(child.title || "장소");
    const folder = cleanFolder(child.folder);
    const href = placeHref(folder);
    const candidates = coverCandidates(folder);
    const cover = candidates[0] || "";
    const slug = escapeHtml(folder.split("/").pop() || folder || "place");

    return `
      <a class="place-card" href="${href}" data-place-folder="${escapeHtml(folder)}">
        <figure class="place-card-visual${cover ? "" : " is-fallback"}">
          ${
            cover
              ? `<img src="${escapeHtml(cover)}" alt="" width="800" height="500" loading="lazy" data-cover-img />`
              : ""
          }
          <span class="place-card-fallback font-mono" aria-hidden="true">${slug}</span>
        </figure>
        <div class="place-card-body">
          <p class="place-card-path font-mono">${escapeHtml(folder || "—")}</p>
          <h3 class="font-display">${title}</h3>
        </div>
      </a>
    `;
  }

  function renderEmpty() {
    return `<p class="place-empty font-mono">기록 예정이에요</p>`;
  }

  async function loadRegionPlaces() {
    const mount = document.querySelector("[data-region-places]");
    const regionFolder = cleanFolder(document.body.dataset.regionFolder || "");
    if (!mount || !regionFolder) return;

    mount.innerHTML = `<p class="place-empty font-mono">불러오는 중…</p>`;

    try {
      const res = await fetch(MENU_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error(`menu api ${res.status}`);

      const data = await res.json();
      const menus = Array.isArray(data.menus) ? data.menus : [];
      const parent = menus.find((menu) => cleanFolder(menu.folder) === regionFolder);
      const children = Array.isArray(parent?.children) ? parent.children : [];

      if (!children.length) {
        mount.innerHTML = renderEmpty();
        return;
      }

      mount.innerHTML = children.map(renderPlace).join("");
      mount.querySelectorAll("[data-cover-img]").forEach((img) => {
        const card = img.closest("[data-place-folder]");
        const folder = card?.getAttribute("data-place-folder") || "";
        bindCoverFallback(img, coverCandidates(folder));
      });
    } catch (err) {
      console.error("Failed to load region places:", err);
      mount.innerHTML = `<p class="place-empty font-mono">장소를 불러오지 못했습니다</p>`;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadRegionPlaces);
  } else {
    loadRegionPlaces();
  }
})();
