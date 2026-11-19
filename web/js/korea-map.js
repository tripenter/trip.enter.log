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

  /**
   * 기록율 구간별 성취 문구.
   * 0: 0% / 1: 1~4% / 5~90: 5% 단위 / 95: 95~99% / 100: 100%
   */
  const COVERAGE_LINES = {
    0 : "아직 비어 있는 대한민국 지도. 첫 번째 기록이 찍힐 곳을 기다리고 있습니다.",
    1 : "설레는 첫 기록이 시작되었습니다. 무채색 지도 위에 작은 발자국이 피어났습니다.",
    5 : "여백 위에 조심스레 번지기 시작한 계절의 색채. 작지만 선명한 발자국들이 차곡차곡 모여들고 있어요.",
    10: "대한민국에 조금씩 온기가 스며들고 있습니다. 여정은 이제 막 시작입니다.",
    15: "낯설던 지명들이 하나둘 우리만의 추억이 되어 지도 위에 선명하게 자리 잡습니다.",
    20: "점으로 남던 발자국들이 모여, 어느새 우리만의 근사한 여행 궤적을 그립니다.",
    25: "계절이 바뀔 때마다 지도의 색도 깊어집니다. 차곡차곡 쌓여가는 로컬 아카이브.",
    30: "지도 위에 찍힌 색깔만큼, 우리가 마주한 바람과 풍경의 이야기도 두터워졌습니다.",
    35: "어느 방향으로 떠나든 반가운 기억이 겹쳐지는 깊이. 기록이 풍경이 되는 순간입니다.",
    40: "회색빛 여백이 옅어지는 만큼, 우리가 함께 걸어온 시간의 밀도는 더욱 짙어집니다.",
    45: "지도를 펼칠 때마다 그날의 공기와 온도가 되살아납니다. 근사하게 채워지는 중!",
    50: "반환점을 목전에 둔 여정. 우리의 발길이 닿은 자리마다 고유한 이야기가 머뭅니다.",
    55: "대한민국의 절반을 우리의 색으로 기록했습니다. 남은 여백마저 설렘으로 가득합니다.",
    60: "비어 있는 곳보다 채워진 곳이 더 많아진 지도. 발자취가 든든한 뿌리를 내립니다.",
    65: "전국 어디를 가리켜도 '그때 그곳!' 하고 웃으며 꺼내 볼 이야기가 피어나는 풍요로움.",
    70: "지도의 빈칸을 채워가는 기쁨이 무르익었습니다. 다음은 어떤 풍경이 기록될까요?",
    75: "대한민국 구석구석이 든든한 아지트가 되었습니다. 깊이 있게 쌓인 시간들.",
    80: "단순한 여행 지도를 넘어, 우리가 함께 써 내려간 한 권의 거대한 연대기가 되었습니다.",
    85: "회색으로 남은 땅을 찾기가 더 어려워졌어요. 길 위에서 보낸 모든 계절이 빛을 발합니다.",
    90: "거대한 퍼즐의 마지막 조각들을 맞추는 시간. 아직 만나지 못한 숨은 보석들을 향해 나아갑니다.",
    95: "이 땅의 수많은 골목과 바다, 산맥과 인사를 나눈 시간들. 완성이 눈앞에 다가왔습니다.",
    100: "대한민국 모든 시군구 기록 완료! 우리가 걸어온 모든 길이 하나의 작품이 되었습니다.",
  };

  function coverageBand(percent, covered) {
    if (covered <= 0 || percent <= 0) return 0;
    if (percent >= 100) return 100;
    if (percent < 5) return 1; // 1~4%
    // 5~99 → 5단위 (95~99는 95)
    return Math.min(95, Math.floor(percent / 5) * 5);
  }

  function formatCoverageCopy(covered, total) {
    if (!total) {
      return {
        rate: "대한민국 기록율을 아직 계산하지 못했습니다.",
        line: "",
      };
    }
    const percent = (covered / total) * 100;
    const shown = covered <= 0 ? 0 : Math.min(100, Math.max(1, Math.round(percent)));
    const line = COVERAGE_LINES[coverageBand(percent, covered)] || COVERAGE_LINES[0];
    return {
      rate: `대한민국 기록율 ${shown}%`,
      line,
    };
  }

  function updateCoverageCopy(items, districts) {
    const el = document.querySelector("[data-map-coverage]");
    if (!el) return;
    const total = Array.isArray(districts) ? districts.length : 0;
    const codes = new Set();
    (items || []).forEach((item) => {
      (item.codes || []).forEach((code) => codes.add(String(code)));
    });
    const { rate, line } = formatCoverageCopy(codes.size, total);
    const escapeHtml =
      (window.TripEnterSigMap && window.TripEnterSigMap.escapeHtml) ||
      ((value) =>
        String(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;"));
    el.innerHTML = line
      ? `${escapeHtml(rate)}<br /><span class="map-coverage-line">${escapeHtml(line)}</span>`
      : escapeHtml(rate);
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

    let mappedItems = [];
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
          mappedItems = menusToMapItems(menus, districts);
          return mappedItems;
        } catch (err) {
          console.error("Failed to load menu items for map:", err);
          mappedItems = [];
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

    instance.ready
      .then(({ districts }) => {
        updateCoverageCopy(mappedItems, districts);
      })
      .catch((err) => {
        console.error("Korea menu map failed:", err);
        updateCoverageCopy([], []);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
