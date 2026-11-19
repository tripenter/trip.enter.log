/**
 * 인트로 페이지용: 시·군·구 지도 + WebMenu 연동.
 * 지도 코어는 korea-sig-map.js (TripEnterSigMap)를 사용한다.
 */
(() => {
  const MENU_API = "/rest/get/menu";

  function cleanFolder(folder) {
    return String(folder || "")
      .replace(/^\/+|\/+$/g, "")
      .trim();
  }

  function menuHref(folder) {
    const cleaned = cleanFolder(folder);
    if (!cleaned) return "#";
    return `/${cleaned
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/")}/`;
  }

  function coverCandidates(folder) {
    const cleaned = cleanFolder(folder);
    if (!cleaned) return [];
    const base = `/${cleaned}`;
    return [`${base}/cover.jpg`, `${base}/cover.webp`, `${base}/cover.png`];
  }

  function isRegionLanding(folder) {
    const cleaned = cleanFolder(folder);
    return (
      Boolean(cleaned) &&
      !cleaned.includes("/") &&
      Object.prototype.hasOwnProperty.call(window.TripEnterSigMap.FOLDER_REGIONS, cleaned)
    );
  }

  async function loadMenus() {
    const response = await fetch(MENU_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok) throw new Error(`menu api ${response.status}`);
    const data = await response.json();
    return Array.isArray(data.menus) ? data.menus : [];
  }

  function menusToMapItems(menus, districts) {
    const { matchDistrictByRegion, prefixesFromContext } = window.TripEnterSigMap;
    const items = [];

    const walk = (nodes, ancestors) => {
      (nodes || []).forEach((node) => {
        const folder = cleanFolder(node.folder);
        const children = Array.isArray(node.children) ? node.children : [];
        // 지도 표시는 WM_Region(시·군·구명)과 GeoJSON name이 같을 때만 한다.
        const region = String(node.region || "").trim();
        if (folder && region && !isRegionLanding(folder)) {
          const hit = matchDistrictByRegion(
            region,
            districts,
            prefixesFromContext(ancestors.concat(node))
          );
          if (hit) {
            items.push({
              id: node.id,
              title: node.title || hit.label,
              region,
              folder,
              href: menuHref(folder),
              covers: coverCandidates(folder),
              districtLabel: hit.label,
              codes: hit.codes,
              lat: hit.lat,
              lng: hit.lng,
            });
          }
        }
        if (children.length) walk(children, ancestors.concat(node));
      });
    };

    walk(menus, []);
    return items;
  }

  function bindCoverFallback(img, covers) {
    let index = 0;
    img.addEventListener("error", () => {
      index += 1;
      if (index < covers.length) {
        img.src = covers[index];
        return;
      }
      img.remove();
      const card = img.closest(".korea-choice-cover");
      if (card) card.classList.add("is-fallback");
    });
  }

  function renderMenuPopup(items, ctx) {
    const { escapeHtml } = window.TripEnterSigMap;
    return `
      <div class="korea-choice">
        <p class="korea-choice-heading">${escapeHtml(ctx.name)}</p>
        <p class="korea-choice-sub font-mono">메뉴 ${items.length}개 · 선택하세요</p>
        <div class="korea-choice-list">
          ${items
            .map((item) => {
              const src = (item.covers && item.covers[0]) || "";
              const slug = cleanFolder(item.folder).split("/").pop() || "place";
              return `
                <a class="korea-choice-item" href="${escapeHtml(item.href || "#")}">
                  <span class="korea-choice-cover${src ? "" : " is-fallback"}">
                    ${
                      src
                        ? `<img src="${escapeHtml(src)}" alt="" data-choice-cover />`
                        : `<span class="font-mono">${escapeHtml(slug)}</span>`
                    }
                  </span>
                  <span class="korea-choice-body">
                    <strong>${escapeHtml(item.title || "")}</strong>
                    <em>${escapeHtml(item.districtLabel || ctx.name)}</em>
                  </span>
                </a>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  function boot() {
    if (!window.TripEnterSigMap) {
      console.error("TripEnterSigMap is missing. Load korea-sig-map.js first.");
      return;
    }

    const instance = window.TripEnterSigMap.create({
      el: "#korea-map",
      statusEl: "[data-korea-status]",
      geoUrl: "./data/korea-sig.geojson",
      zoomOffset: 1,
      messages: {
        idle: "시·군·구에 올리면 메뉴가 보이고, 없으면 클릭 시 안내가 보입니다.",
        withItems: "메뉴가 있는 지역에 올리면 목록에서 선택할 수 있습니다.",
        emptyClick: "언젠가 한번 꼭 가볼게요",
      },
      loadItems: async ({ districts }) => {
        try {
          const menus = await loadMenus();
          return menusToMapItems(menus, districts);
        } catch (err) {
          console.error("Failed to load menu items for map:", err);
          return [];
        }
      },
      renderHoverPopup: renderMenuPopup,
      renderEmptyClick: () => `<p class="korea-soon-text">언젠가 한번 꼭 가볼게요</p>`,
      onPopupReady: (root, items) => {
        root.querySelectorAll("[data-choice-cover]").forEach((img, index) => {
          const item = items[Math.min(index, items.length - 1)];
          bindCoverFallback(img, item.covers || []);
        });
      },
    });

    instance.ready.catch((err) => {
      console.error("Korea menu map failed:", err);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
