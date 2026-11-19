/**
 * 시·군·구 Leaflet 지도 코어.
 * - 배율 고정, 확대/축소·드래그 없음
 * - 지역 하이라이트 / 데이터 연결 지역 표시
 * - hover·click 콜백으로 페이지별 데이터(메뉴·텍스트·사진 등) 연동
 *
 * 사용:
 *   const map = TripEnterSigMap.create({
 *     el: "#korea-map",
 *     loadItems: async ({ districts }) => [...], // 각 item.codes 필수
 *     renderHoverPopup: (items, ctx) => html,
 *     renderEmptyClick: () => `<p>...</p>`,
 *   });
 */
(() => {
  const DEFAULT_GEO_URL = "/data/korea-sig.geojson";
  const DEFAULT_NK_OUTLINE_URL = "/data/korea-nk-outline.geojson";
  const DEFAULT_DOKDO_URL = "/data/korea-dokdo.geojson";
  // 독도(동도·서도) 표기용 — 전국 배율에서도 보이도록 약간 확대한 도형 + 라벨
  const DOKDO_LABEL_LATLNG = [37.242, 131.868];

  const NK_OUTLINE = {
    stroke: true,
    color: "rgba(26, 43, 51, 0.45)",
    weight: 1.1,
    opacity: 1,
    fill: false,
    fillOpacity: 0,
    lineJoin: "round",
    lineCap: "round",
    className: "korea-nk-outline",
  };
  const DOKDO_FILL = {
    stroke: true,
    color: "rgba(255, 255, 255, 0.95)",
    weight: 0.9,
    opacity: 1,
    fillColor: "#1a2b33",
    fillOpacity: 0.22,
    lineJoin: "round",
    lineCap: "round",
    className: "korea-dokdo-land",
  };

  const REGION_BY_PREFIX = {
    "11": { kind: "metro", label: "서울" },
    "21": { kind: "metro", label: "부산" },
    "22": { kind: "metro", label: "대구" },
    "23": { kind: "metro", label: "인천" },
    "24": { kind: "metro", label: "광주" },
    "25": { kind: "metro", label: "대전" },
    "26": { kind: "metro", label: "울산" },
    "29": { kind: "metro", label: "세종" },
    "31": { kind: "province", label: "경기도" },
    "32": { kind: "province", label: "강원도" },
    "33": { kind: "province", label: "충청북도" },
    "34": { kind: "province", label: "충청남도" },
    "35": { kind: "province", label: "전라북도" },
    "36": { kind: "province", label: "전라남도" },
    "37": { kind: "province", label: "경상북도" },
    "38": { kind: "province", label: "경상남도" },
    "39": { kind: "province", label: "제주도" },
  };

  const METROS = [
    { text: "서울", prefix: "11" },
    { text: "부산", prefix: "21" },
    { text: "대구", prefix: "22" },
    { text: "인천", prefix: "23" },
    { text: "대전", prefix: "25" },
    { text: "울산", prefix: "26" },
    { text: "광주광역시", prefix: "24", rank: 8 },
  ];

  const FOLDER_REGIONS = {
    seoul: ["11"],
    busan: ["21"],
    daegu: ["22"],
    incheon: ["23"],
    gwangju: ["24"],
    daejeon: ["25"],
    ulsan: ["26"],
    sejong: ["29"],
    gyeonggi: ["31"],
    gangwon: ["32"],
    chungbuk: ["33"],
    chungnam: ["34"],
    chungcheong: ["33", "34"],
    jeonbuk: ["35"],
    jeonnam: ["36"],
    jeolla: ["35", "36"],
    gyeongbuk: ["37"],
    gyeongnam: ["38"],
    gyeongsang: ["37", "38"],
    jeju: ["39"],
  };

  const TITLE_RULES = [
    { text: "광주광역시", prefixes: ["24"] },
    { text: "세종", prefixes: ["29"] },
    { text: "서울", prefixes: ["11"] },
    { text: "부산", prefixes: ["21"] },
    { text: "대구", prefixes: ["22"] },
    { text: "인천", prefixes: ["23"] },
    { text: "대전", prefixes: ["25"] },
    { text: "울산", prefixes: ["26"] },
    { text: "제주", prefixes: ["39"] },
    { text: "강원", prefixes: ["32"] },
    { text: "경기", prefixes: ["31"] },
    { text: "경상남", prefixes: ["38"] },
    { text: "경남", prefixes: ["38"] },
    { text: "경상북", prefixes: ["37"] },
    { text: "경북", prefixes: ["37"] },
    { text: "경상", prefixes: ["37", "38"] },
    { text: "전라남", prefixes: ["36"] },
    { text: "전남", prefixes: ["36"] },
    { text: "전라북", prefixes: ["35"] },
    { text: "전북", prefixes: ["35"] },
    { text: "전라", prefixes: ["35", "36"] },
    { text: "충청남", prefixes: ["34"] },
    { text: "충남", prefixes: ["34"] },
    { text: "충청북", prefixes: ["33"] },
    { text: "충북", prefixes: ["33"] },
    { text: "충청", prefixes: ["33", "34"] },
    { text: "광주", prefixes: ["24", "31"] },
  ];

  const VEIL = {
    stroke: true,
    color: "rgba(255, 255, 255, 0.95)",
    weight: 0.8,
    opacity: 1,
    fillColor: "#1a2b33",
    fillOpacity: 0.16,
    lineJoin: "round",
  };
  const OPEN_HIT = {
    stroke: false,
    weight: 0,
    opacity: 0,
    fillColor: "#e8913a",
    fillOpacity: 0,
  };
  const HOVER = {
    stroke: true,
    color: "rgba(255, 255, 255, 0.95)",
    weight: 0.8,
    opacity: 1,
    fillColor: "#f2b84b",
    fillOpacity: 0.55,
    lineJoin: "round",
  };
  const ACTIVE_FILL = {
    stroke: false,
    weight: 0,
    opacity: 0,
    fillColor: "#e8913a",
    fillOpacity: 0.42,
  };
  const ACTIVE_FILL_HOVER = {
    stroke: false,
    weight: 0,
    opacity: 0,
    fillColor: "#f2b84b",
    fillOpacity: 0.55,
  };
  const ACTIVE_STROKE = {
    stroke: true,
    color: "#b8611f",
    weight: 1,
    opacity: 1,
    fill: false,
    fillOpacity: 0,
    lineJoin: "round",
    lineCap: "round",
    className: "korea-menu-outline",
  };
  const ACTIVE_STROKE_HOVER = {
    stroke: true,
    color: "#1a2b33",
    weight: 1,
    opacity: 1,
    fill: false,
    fillOpacity: 0,
    lineJoin: "round",
    lineCap: "round",
    className: "korea-menu-outline",
  };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function resolveEl(target) {
    if (!target) return null;
    if (typeof target === "string") return document.querySelector(target);
    return target;
  }

  function formatName(name) {
    const compound = String(name).match(/^(.+시)(.+구)$/);
    return compound ? `${compound[1]} ${compound[2]}` : name;
  }

  function displayDistrictName(name, code) {
    const raw = String(name || "");
    const formatted = formatName(raw);
    const region = REGION_BY_PREFIX[String(code || "").slice(0, 2)];
    if (!region) return formatted;
    if (/^(.+시)(.+구)$/.test(raw)) return formatted;
    if (region.kind === "metro") {
      if (raw === "세종시" || raw === "세종") return "세종";
      return `${region.label} ${formatted}`;
    }
    return `${region.label} ${formatted}`;
  }

  function ringStat(ring) {
    let twice = 0;
    let x = 0;
    let y = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const x0 = ring[j][0];
      const y0 = ring[j][1];
      const x1 = ring[i][0];
      const y1 = ring[i][1];
      const cross = x0 * y1 - x1 * y0;
      twice += cross;
      x += (x0 + x1) * cross;
      y += (y0 + y1) * cross;
    }
    if (Math.abs(twice) < 1e-12) {
      let sx = 0;
      let sy = 0;
      ring.forEach((point) => {
        sx += point[0];
        sy += point[1];
      });
      const n = ring.length || 1;
      return { lng: sx / n, lat: sy / n, area: 0 };
    }
    return { lng: x / (3 * twice), lat: y / (3 * twice), area: Math.abs(twice) / 2 };
  }

  function featureCentroid(geometry) {
    const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates || [];
    let best = null;
    polys.forEach((poly) => {
      const ring = poly && poly[0];
      if (!ring || ring.length < 3) return;
      const stat = ringStat(ring);
      if (!best || stat.area > best.area) best = stat;
    });
    return best;
  }

  function aliasesFor(name) {
    const aliases = [{ text: name, rank: 10, kind: "exact" }];
    const compound = name.match(/^(.+시)(.+구)$/);
    if (compound) {
      const guStem = compound[2].replace(/구$/, "");
      aliases.push({ text: compound[2], rank: 6, kind: "gu" });
      if (guStem.length >= 2) aliases.push({ text: guStem, rank: 5, kind: "gu" });
      aliases.push({ text: compound[1], rank: 3, kind: "city" });
      const cityStem = compound[1].replace(/시$/, "");
      if (cityStem.length >= 2) aliases.push({ text: cityStem, rank: 4, kind: "city" });
      return aliases;
    }
    const stem = name.replace(/(특별자치시|특별시|광역시|시|군|구)$/, "");
    if (stem.length >= 2 && stem !== name) aliases.push({ text: stem, rank: 4, kind: "stem" });
    return aliases;
  }

  function buildDistricts(collection) {
    return (collection.features || [])
      .map((feature) => {
        const name = feature.properties && feature.properties.name;
        const code = String((feature.properties && feature.properties.code) || "");
        const center = featureCentroid(feature.geometry || {});
        if (!name || !code || !center) return null;
        const compound = name.match(/^(.+시)(.+구)$/);
        const district = {
          name,
          code,
          prefix: code.slice(0, 2),
          city: compound ? compound[1] : "",
          lat: center.lat,
          lng: center.lng,
          aliases: aliasesFor(name),
        };
        METROS.forEach((metro) => {
          if (metro.prefix === district.prefix) {
            district.aliases.push({ text: metro.text, rank: metro.rank || 1, kind: "metro" });
          }
        });
        return district;
      })
      .filter(Boolean);
  }

  function prefixesFromContext(nodes) {
    const scope = new Set();
    (nodes || []).forEach((node) => {
      if (!node) return;
      String(node.folder || "")
        .replace(/^\/+|\/+$/g, "")
        .split("/")
        .forEach((segment) => {
          const prefixes = FOLDER_REGIONS[segment];
          if (prefixes) prefixes.forEach((prefix) => scope.add(prefix));
        });
      const title = String(node.title || "").replace(/\s+/g, "");
      TITLE_RULES.forEach((rule) => {
        if (title.includes(rule.text)) rule.prefixes.forEach((prefix) => scope.add(prefix));
      });
    });
    return scope;
  }

  function bestAlias(district, text) {
    let best = null;
    let score = 0;
    district.aliases.forEach((alias) => {
      if (!text.includes(alias.text)) return;
      const next = alias.rank * 100 + alias.text.length;
      if (!best || next > score) {
        best = alias;
        score = next;
      }
    });
    return best ? { alias: best, score } : null;
  }

  function tieGroup(district, alias) {
    if (alias.kind === "metro") return `metro:${district.prefix}:${alias.text}`;
    if (alias.kind === "city") return `city:${district.prefix}:${district.city}`;
    return `one:${district.code}`;
  }

  /**
   * WM_Region 등 GeoJSON properties.name 과 동일한 시·군·구명으로 매칭한다.
   * scope(광역 prefix Set)가 있으면 그 안에서만 찾고, 동명(중구 등)을 좁힌다.
   */
  function matchDistrictByRegion(region, districts, scope) {
    const name = String(region || "").replace(/\s+/g, "").trim();
    if (!name) return null;
    const scopeSet = scope instanceof Set ? scope : new Set(scope || []);
    const pool = scopeSet.size
      ? districts.filter((district) => scopeSet.has(district.prefix))
      : districts;
    const hits = pool.filter((district) => String(district.name || "").replace(/\s+/g, "") === name);
    if (!hits.length) return null;

    // 동명이 여러 개면 scope 밖 전국 검색은 거부(잘못된 지역 하이라이트 방지)
    if (hits.length > 1 && !scopeSet.size) return null;

    let lat = 0;
    let lng = 0;
    hits.forEach((district) => {
      lat += district.lat;
      lng += district.lng;
    });
    return {
      lat: lat / hits.length,
      lng: lng / hits.length,
      label: hits.length === 1 ? formatName(hits[0].name) : formatName(name),
      anchorKey: hits.length === 1 ? `one:${hits[0].code}` : `region:${name}`,
      codes: hits.map((district) => district.code),
      districts: hits,
    };
  }

  function matchDistrictByTitle(title, districts, scope) {
    const text = String(title || "").replace(/\s+/g, "");
    if (!text) return null;
    const scopeSet = scope instanceof Set ? scope : new Set(scope || []);
    const pool = scopeSet.size ? districts.filter((district) => scopeSet.has(district.prefix)) : districts;
    let bestScore = 0;
    const hits = [];
    pool.forEach((district) => {
      const found = bestAlias(district, text);
      if (!found) return;
      if (found.score > bestScore) {
        bestScore = found.score;
        hits.length = 0;
        hits.push({ district, alias: found.alias });
      } else if (found.score === bestScore) {
        hits.push({ district, alias: found.alias });
      }
    });
    if (!hits.length) return null;

    const grouped = new Map();
    hits.forEach((hit) => {
      const key = tieGroup(hit.district, hit.alias);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(hit);
    });

    let chosenKey = null;
    if (grouped.size === 1) {
      chosenKey = grouped.keys().next().value;
    } else {
      const entries = Array.from(grouped.entries());
      const cityEntries = entries.filter((entry) => entry[1][0].alias.kind === "city");
      const otherEntries = entries.filter((entry) => entry[1][0].alias.kind !== "city");
      if (cityEntries.length === 1 && otherEntries.length) {
        const cityIndex = Math.min(...cityEntries[0][1].map((member) => text.indexOf(member.alias.text)));
        const cityLeads = otherEntries.every((entry) => {
          const index = Math.min(...entry[1].map((member) => text.indexOf(member.alias.text)));
          return index > cityIndex;
        });
        if (cityLeads) chosenKey = cityEntries[0][0];
      }
    }
    if (!chosenKey) return null;

    const members = grouped.get(chosenKey);
    const alias = members[0].alias;
    let lat = 0;
    let lng = 0;
    members.forEach((member) => {
      lat += member.district.lat;
      lng += member.district.lng;
    });
    const label =
      members.length === 1
        ? formatName(members[0].district.name)
        : alias.kind === "metro"
          ? alias.text
          : members[0].district.city || formatName(members[0].district.name);

    return {
      lat: lat / members.length,
      lng: lng / members.length,
      label,
      anchorKey: chosenKey,
      codes: members.map((member) => member.district.code),
      districts: members.map((member) => member.district),
    };
  }

  function indexItemsByCode(items) {
    const byCode = new Map();
    (items || []).forEach((item) => {
      const codes = Array.isArray(item.codes) ? item.codes.map(String) : [];
      codes.forEach((code) => {
        if (!byCode.has(code)) byCode.set(code, []);
        byCode.get(code).push(item);
      });
    });
    return byCode;
  }

  function create(options = {}) {
    const mapEl = resolveEl(options.el);
    const statusEl = resolveEl(options.statusEl);
    if (!mapEl) throw new Error("TripEnterSigMap: el is required");
    if (!window.L) {
      mapEl.textContent = "지도를 불러오지 못했습니다.";
      throw new Error("TripEnterSigMap: Leaflet (window.L) is required");
    }

    const geoUrl = options.geoUrl || DEFAULT_GEO_URL;
    const nkOutlineUrl =
      options.nkOutlineUrl === null || options.nkOutlineUrl === false
        ? ""
        : options.nkOutlineUrl || DEFAULT_NK_OUTLINE_URL;
    const dokdoUrl =
      options.dokdoUrl === null || options.dokdoUrl === false
        ? ""
        : options.dokdoUrl || DEFAULT_DOKDO_URL;
    // fitBounds 이후 추가 확대/축소 단계. 기본 1단계 확대.
    const zoomOffset = Number.isFinite(options.zoomOffset) ? options.zoomOffset : 1;
    // 다른 지역에 마우스를 올리면 기본적으로 0.5초 후 호버 팝업을 닫는다.
    const popupHideDelay = Number.isFinite(options.popupHideDelay) ? options.popupHideDelay : 500;
    const emptyClickDuration = Number.isFinite(options.emptyClickDuration) ? options.emptyClickDuration : 3000;
    const messages = options.messages || {};
    const idleStatus = messages.idle || "시·군·구에 올리면 연결된 항목을 볼 수 있습니다.";
    const withItemsStatus = messages.withItems || "데이터가 있는 지역에 올리면 목록에서 선택할 수 있습니다.";
    const emptyClickStatus = messages.emptyClick || "";

    const setStatus = (text) => {
      if (statusEl) statusEl.textContent = text;
    };

    const map = window.L.map(mapEl, {
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      boxZoom: false,
      keyboard: false,
      attributionControl: false,
      zoomControl: false,
      minZoom: 6,
      zoomSnap: 0,
      zoomDelta: 0.5,
    });

    map.createPane("korea-menu-fill");
    map.createPane("korea-menu-stroke");
    const fillPane = map.getPane("korea-menu-fill");
    const strokePane = map.getPane("korea-menu-stroke");
    if (fillPane) {
      fillPane.style.zIndex = "610";
      fillPane.style.pointerEvents = "none";
    }
    if (strokePane) {
      strokePane.style.zIndex = "620";
      strokePane.style.pointerEvents = "none";
    }
    const fillRenderer = window.L.svg({ pane: "korea-menu-fill" });
    const strokeRenderer = window.L.svg({ pane: "korea-menu-stroke" });

    const layersByCode = new Map();
    const fillLayersByCode = new Map();
    const strokeLayersByCode = new Map();
    let activeCodes = new Set();
    let activeCode = null;
    let districts = [];
    let itemsByCode = new Map();
    let itemCount = 0;
    let collection = null;
    let geoLayer = null;
    let nkOutlineLayer = null;
    let dokdoLayer = null;
    let dokdoLabel = null;
    let fillLayer = null;
    let strokeLayer = null;

    let hoverPopup = null;
    let hoverCode = null;
    let emptyPopup = null;
    let emptyTimer = 0;
    let hideTimer = 0;

    const styleFor = (code) => {
      if (activeCodes.has(code)) return OPEN_HIT;
      if (activeCode && code === activeCode) return HOVER;
      return VEIL;
    };

    const applyLayerStyle = (code) => {
      const layer = layersByCode.get(code);
      if (layer) layer.setStyle(styleFor(code));
      const fill = fillLayersByCode.get(code);
      if (fill) fill.setStyle(activeCode === code ? ACTIVE_FILL_HOVER : ACTIVE_FILL);
      const stroke = strokeLayersByCode.get(code);
      if (stroke) stroke.setStyle(activeCode === code ? ACTIVE_STROKE_HOVER : ACTIVE_STROKE);
    };

    const setActiveCode = (code) => {
      if (activeCode === code) return;
      const prev = activeCode;
      activeCode = code;
      if (prev) {
        const prevLayer = layersByCode.get(prev);
        if (prevLayer && typeof prevLayer.closeTooltip === "function") prevLayer.closeTooltip();
        applyLayerStyle(prev);
      }
      if (code) applyLayerStyle(code);
    };

    const dismissEmptyPopup = () => {
      if (emptyTimer) {
        window.clearTimeout(emptyTimer);
        emptyTimer = 0;
      }
      if (!emptyPopup) return;
      map.closePopup(emptyPopup);
      emptyPopup = null;
    };

    const dismissHoverPopup = () => {
      if (hideTimer) {
        window.clearTimeout(hideTimer);
        hideTimer = 0;
      }
      if (!hoverPopup) return;
      map.closePopup(hoverPopup);
      hoverPopup = null;
      hoverCode = null;
    };

    const scheduleHideHoverPopup = () => {
      // 이미 카운트 중이면 리셋하지 않는다. (처음 다른 지역으로 나간 시점부터 1회만)
      if (hideTimer) return;
      hideTimer = window.setTimeout(() => {
        hideTimer = 0;
        if (hoverPopup) {
          map.closePopup(hoverPopup);
          hoverPopup = null;
          hoverCode = null;
        }
        setStatus(itemCount ? withItemsStatus : idleStatus);
      }, popupHideDelay);
    };

    const cancelHideHoverPopup = () => {
      if (!hideTimer) return;
      window.clearTimeout(hideTimer);
      hideTimer = 0;
    };

    const showHoverPopup = (items, latlng, districtName, code) => {
      dismissEmptyPopup();
      cancelHideHoverPopup();
      if (hoverPopup && hoverCode === code) return;

      if (hoverPopup) {
        map.closePopup(hoverPopup);
        hoverPopup = null;
      }

      const html =
        typeof options.renderHoverPopup === "function"
          ? options.renderHoverPopup(items, {
              code,
              name: districtName,
              latlng,
              district: districts.find((d) => d.code === code) || null,
            })
          : `<p class="korea-soon-text">${escapeHtml(districtName)} · ${items.length}개</p>`;

      hoverCode = code;
      hoverPopup = window.L.popup({
        className: options.popupClassName || "korea-choice-popup",
        closeButton: options.popupCloseButton !== false,
        autoClose: false,
        closeOnClick: false,
        maxWidth: options.popupMaxWidth || 280,
        offset: options.popupOffset || [0, -11],
      })
        .setLatLng(latlng)
        .setContent(html)
        .openOn(map);

      const root = hoverPopup.getElement();
      if (root) {
        root.addEventListener("mouseenter", cancelHideHoverPopup);
        root.addEventListener("mouseleave", scheduleHideHoverPopup);
        if (typeof options.onPopupReady === "function") {
          options.onPopupReady(root, items, { code, name: districtName, latlng });
        }
      }
      setStatus(`${districtName} · ${items.length}개 중 선택`);
    };

    const showEmptyClick = (latlng, ctx) => {
      dismissHoverPopup();
      dismissEmptyPopup();
      const html =
        typeof options.renderEmptyClick === "function"
          ? options.renderEmptyClick({ ...ctx, latlng })
          : `<p class="korea-soon-text">연결된 항목이 없습니다</p>`;
      if (!html) return;

      emptyPopup = window.L.popup({
        className: "korea-soon-popup",
        closeButton: false,
        autoClose: true,
        closeOnClick: true,
        offset: [0, -8],
      })
        .setLatLng(latlng)
        .setContent(html)
        .openOn(map);

      if (emptyClickStatus) setStatus(emptyClickStatus);
      emptyTimer = window.setTimeout(() => {
        dismissEmptyPopup();
        setStatus(itemCount ? withItemsStatus : idleStatus);
      }, emptyClickDuration);
    };

    const paintActiveOverlays = () => {
      if (fillLayer) {
        map.removeLayer(fillLayer);
        fillLayer = null;
      }
      if (strokeLayer) {
        map.removeLayer(strokeLayer);
        strokeLayer = null;
      }
      fillLayersByCode.clear();
      strokeLayersByCode.clear();

      if (!collection || !activeCodes.size) return;
      const features = (collection.features || []).filter((feature) =>
        activeCodes.has(String(feature.properties && feature.properties.code))
      );
      if (!features.length) return;

      const menuCollection = { type: "FeatureCollection", features };
      fillLayer = window.L.geoJSON(menuCollection, {
        pane: "korea-menu-fill",
        renderer: fillRenderer,
        style: ACTIVE_FILL,
        interactive: false,
        onEachFeature: (feature, layer) => {
          fillLayersByCode.set(String(feature.properties.code), layer);
        },
      }).addTo(map);
      strokeLayer = window.L.geoJSON(menuCollection, {
        pane: "korea-menu-stroke",
        renderer: strokeRenderer,
        style: ACTIVE_STROKE,
        interactive: false,
        onEachFeature: (feature, layer) => {
          strokeLayersByCode.set(String(feature.properties.code), layer);
        },
      }).addTo(map);
    };

    let viewInitialized = false;

    const bindRegions = ({ resetView = false } = {}) => {
      if (geoLayer) {
        map.removeLayer(geoLayer);
        geoLayer = null;
      }
      layersByCode.clear();

      geoLayer = window.L.geoJSON(collection, {
        style: (feature) => styleFor(String(feature.properties.code)),
        onEachFeature: (feature, layer) => {
          const code = String(feature.properties.code);
          const name = displayDistrictName(feature.properties.name || "", code);
          const matched = itemsByCode.get(code) || [];
          layersByCode.set(code, layer);

          if (!matched.length) {
            layer.bindTooltip(name, {
              permanent: false,
              sticky: true,
              direction: "bottom",
              offset: [0, 14],
              className: "korea-name-label",
              opacity: 1,
            });
          }

          layer.on("mouseover", (event) => {
            dismissEmptyPopup();
            setActiveCode(code);
            if (matched.length) {
              const anchor = event.latlng || layer.getBounds().getCenter();
              showHoverPopup(matched, anchor, name, code);
            } else {
              // 다른 지역으로 옮기면 열려 있던 목록은 지연 후 닫는다.
              scheduleHideHoverPopup();
              setStatus(name);
            }
            if (typeof options.onRegionEnter === "function") {
              options.onRegionEnter({ code, name, items: matched, latlng: event.latlng });
            }
          });

          layer.on("mouseout", (event) => {
            const related = event.originalEvent && event.originalEvent.relatedTarget;
            const popupEl = hoverPopup && hoverPopup.getElement();
            if (related && popupEl && popupEl.contains(related)) {
              if (matched.length) scheduleHideHoverPopup();
              return;
            }
            if (typeof layer.closeTooltip === "function") layer.closeTooltip();
            if (activeCode === code) setActiveCode(null);
            if (matched.length) scheduleHideHoverPopup();
            else setStatus(itemCount ? withItemsStatus : idleStatus);
            if (typeof options.onRegionLeave === "function") {
              options.onRegionLeave({ code, name, items: matched });
            }
          });

          layer.on("click", (event) => {
            window.L.DomEvent.stopPropagation(event);
            const latlng = event.latlng || layer.getBounds().getCenter();
            if (matched.length) {
              showHoverPopup(matched, latlng, name, code);
            } else {
              showEmptyClick(latlng, { code, name });
            }
            if (typeof options.onRegionClick === "function") {
              options.onRegionClick({ code, name, items: matched, latlng });
            }
          });
        },
      }).addTo(map);

      paintActiveOverlays();
      // 초기 1회만 fitBounds/zoom 고정. 일기 저장 후 setItems 시 재확대 방지.
      // 남한(+독도)만 프레임에 맞춘다. 북한 아웃라인은 배율 계산에서 제외(잘려도 됨).
      if (!viewInitialized || resetView) {
        map.invalidateSize(false);
        let southBounds = geoLayer.getBounds();
        if (dokdoLayer) {
          southBounds = southBounds.extend(dokdoLayer.getBounds());
        }
        // 캔버스가 세로로 커져도 배율은 기준 높이(820px)에 맞춘다.
        // 남는 세로는 상·하 패딩으로 흡수 → 지도 확대처럼 보이지 않음.
        const size = map.getSize();
        const refHeight = 820;
        const surplusY = Math.max(0, size.y - refHeight);
        const padX = 20;
        const padTop = 32 + Math.floor(surplusY / 2);
        const padBottom = 44 + Math.ceil(surplusY / 2);
        map.fitBounds(southBounds, {
          paddingTopLeft: [padX, padTop],
          paddingBottomRight: [padX, padBottom],
          maxZoom: 8,
          animate: false,
        });
        let startZoom = map.getZoom() + zoomOffset;
        if (startZoom < 1) startZoom = 1;
        map.setView(map.getCenter(), startZoom, { animate: false });
        map.setMinZoom(startZoom);
        map.setMaxZoom(startZoom);
        viewInitialized = true;
      }
    };

    const setItems = (items) => {
      const list = Array.isArray(items) ? items : [];
      itemsByCode = indexItemsByCode(list);
      itemCount = list.length;
      activeCodes = new Set();
      list.forEach((item) => {
        (item.codes || []).forEach((code) => activeCodes.add(String(code)));
      });
      if (collection) {
        dismissHoverPopup();
        dismissEmptyPopup();
        bindRegions({ resetView: false });
        setStatus(itemCount ? withItemsStatus : idleStatus);
      }
    };

    const loadNkOutline = () => {
      if (!nkOutlineUrl) return Promise.resolve(null);
      return fetch(nkOutlineUrl)
        .then((response) => {
          if (!response.ok) throw new Error(`nk outline ${response.status}`);
          return response.json();
        })
        .then((geojson) => {
          if (nkOutlineLayer) {
            map.removeLayer(nkOutlineLayer);
            nkOutlineLayer = null;
          }
          nkOutlineLayer = window.L.geoJSON(geojson, {
            style: NK_OUTLINE,
            interactive: false,
            pane: "overlayPane",
          }).addTo(map);
          return nkOutlineLayer;
        })
        .catch((err) => {
          console.warn("TripEnterSigMap: North Korea outline skipped:", err);
          return null;
        });
    };

    const loadDokdo = () => {
      if (!dokdoUrl) return Promise.resolve(null);
      return fetch(dokdoUrl)
        .then((response) => {
          if (!response.ok) throw new Error(`dokdo ${response.status}`);
          return response.json();
        })
        .then((geojson) => {
          if (dokdoLayer) {
            map.removeLayer(dokdoLayer);
            dokdoLayer = null;
          }
          if (dokdoLabel) {
            map.removeLayer(dokdoLabel);
            dokdoLabel = null;
          }
          dokdoLayer = window.L.geoJSON(geojson, {
            style: DOKDO_FILL,
            interactive: false,
            pane: "overlayPane",
          }).addTo(map);
          dokdoLabel = window.L.marker(DOKDO_LABEL_LATLNG, {
            interactive: false,
            keyboard: false,
            pane: "tooltipPane",
            icon: window.L.divIcon({
              className: "korea-dokdo-label",
              html: "<span>독도</span>",
              iconSize: [36, 16],
              iconAnchor: [-6, 8],
            }),
          }).addTo(map);
          return dokdoLayer;
        })
        .catch((err) => {
          console.warn("TripEnterSigMap: Dokdo layer skipped:", err);
          return null;
        });
    };

    const ready = Promise.all([
      fetch(geoUrl).then((response) => {
        if (!response.ok) throw new Error(`geojson ${response.status}`);
        return response.json();
      }),
      loadNkOutline(),
      loadDokdo(),
    ])
      .then(async ([geojson]) => {
        collection = geojson;
        districts = buildDistricts(collection);

        let items = [];
        if (typeof options.loadItems === "function") {
          items = (await options.loadItems({ districts, map, collection })) || [];
        } else if (Array.isArray(options.items)) {
          items = options.items;
        }
        setItems(items);

        const onResize = () => map.invalidateSize();
        window.addEventListener("resize", onResize);

        return {
          map,
          districts,
          getItemsByCode: () => itemsByCode,
          setItems,
          destroy: () => {
            window.removeEventListener("resize", onResize);
            dismissHoverPopup();
            dismissEmptyPopup();
            map.remove();
          },
        };
      })
      .catch((err) => {
        console.error("TripEnterSigMap failed:", err);
        mapEl.textContent = "지도를 불러오지 못했습니다.";
        throw err;
      });

    return {
      ready,
      map,
      setItems,
      setStatus,
      displayDistrictName,
      escapeHtml,
    };
  }

  const api = {
    create,
    escapeHtml,
    formatName,
    displayDistrictName,
    buildDistricts,
    matchDistrictByRegion,
    matchDistrictByTitle,
    prefixesFromContext,
    indexItemsByCode,
    FOLDER_REGIONS,
    REGION_BY_PREFIX,
  };

  window.TripEnterSigMap = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
