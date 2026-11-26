/**
 * 시·군·구 Leaflet 지도 코어.
 * - 배율 고정(확대/축소 없음), 마우스 드래그로 지도 이동 가능
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
  // 울릉·독도는 시각적으로 이동해 표시한다. 독도는 울릉도 크기의 40%로 맞춘다.
  const EAST_ISLAND_LNG_SHIFT = -1.0; // 울릉군
  const DOKDO_LNG_SHIFT = -1.6; // 독도 (서 1.8 → 동 0.2)
  const DOKDO_LAT_SHIFT = 0.1; // 독도 북쪽으로
  const DOKDO_TO_ULLEUNG_SIZE = 0.4;
  const EAST_ISLAND_CODES = new Set(["37430"]); // 울릉군
  const ULLEUNG_BODY_LNG_MAX = 131.2; // 울릉 본체(독도 첨점 제외)
  const ONGJIN_CODE = "23320"; // 인천 옹진군
  const ONGJIN_LNG_SHIFT = 0.2; // 동
  const ONGJIN_LAT_SHIFT = -0.1; // 남

  // 서울은 한강 기준으로 강북/강남만 표시한다.
  const SEOUL_GANGBUK_CODE = "11901";
  const SEOUL_GANGNAM_CODE = "11902";
  const SEOUL_GANGBUK_GU_CODES = [
    "11010", // 종로구
    "11020", // 중구
    "11030", // 용산구
    "11040", // 성동구
    "11050", // 광진구
    "11060", // 동대문구
    "11070", // 중랑구
    "11080", // 성북구
    "11090", // 강북구
    "11100", // 도봉구
    "11110", // 노원구
    "11120", // 은평구
    "11130", // 서대문구
    "11140", // 마포구
  ];
  const SEOUL_GANGNAM_GU_CODES = [
    "11150", // 양천구
    "11160", // 강서구
    "11170", // 구로구
    "11180", // 금천구
    "11190", // 영등포구
    "11200", // 동작구
    "11210", // 관악구
    "11220", // 서초구
    "11230", // 강남구
    "11240", // 송파구
    "11250", // 강동구
  ];
  const SEOUL_GANGBUK_SET = new Set(SEOUL_GANGBUK_GU_CODES);
  const SEOUL_GANGNAM_SET = new Set(SEOUL_GANGNAM_GU_CODES);
  const SEOUL_GU_TO_BANK = {};
  SEOUL_GANGBUK_GU_CODES.forEach((code) => {
    SEOUL_GU_TO_BANK[code] = SEOUL_GANGBUK_CODE;
  });
  SEOUL_GANGNAM_GU_CODES.forEach((code) => {
    SEOUL_GU_TO_BANK[code] = SEOUL_GANGNAM_CODE;
  });

  // 자치구가 있는 시는 구를 시 단위로 합친다. (이미 시·군인 지역은 그대로)
  const CITY_MERGE_GROUPS = [
    { cityCode: "31010", cityName: "수원시", prefix: "31", guCodes: ["31011", "31012", "31013", "31014"] },
    { cityCode: "31020", cityName: "성남시", prefix: "31", guCodes: ["31021", "31022", "31023"] },
    { cityCode: "31040", cityName: "안양시", prefix: "31", guCodes: ["31041", "31042"] },
    { cityCode: "31090", cityName: "안산시", prefix: "31", guCodes: ["31091", "31092"] },
    { cityCode: "31100", cityName: "고양시", prefix: "31", guCodes: ["31101", "31103", "31104"] },
    { cityCode: "31190", cityName: "용인시", prefix: "31", guCodes: ["31191", "31192", "31193"] },
    { cityCode: "33040", cityName: "청주시", prefix: "33", guCodes: ["33041", "33042", "33043", "33044"] },
    { cityCode: "35010", cityName: "전주시", prefix: "35", guCodes: ["35011", "35012"] },
  ];
  const CITY_GU_TO_CITY = {};
  CITY_MERGE_GROUPS.forEach((group) => {
    group.guCodes.forEach((code) => {
      CITY_GU_TO_CITY[code] = group.cityCode;
    });
  });

  // 광역시는 구·군을 하나의 덩어리로 합친다. (서울·도는 별도 규칙)
  const METRO_MERGE_GROUPS = [
    {
      mergedCode: "21000",
      name: "부산",
      prefix: "21",
      kind: "busan-metro",
      memberCodes: [
        "21010", "21020", "21030", "21040", "21050", "21060", "21070", "21080",
        "21090", "21100", "21110", "21120", "21130", "21140", "21150", "21310",
      ],
    },
    {
      mergedCode: "22000",
      name: "대구",
      prefix: "22",
      kind: "daegu-metro",
      memberCodes: [
        "22010", "22020", "22030", "22040", "22050", "22060", "22070", "22310",
      ],
    },
    {
      mergedCode: "24000",
      name: "광주",
      prefix: "24",
      kind: "gwangju-metro",
      memberCodes: ["24010", "24020", "24030", "24040", "24050"],
    },
    {
      mergedCode: "25000",
      name: "대전",
      prefix: "25",
      kind: "daejeon-metro",
      memberCodes: ["25010", "25020", "25030", "25040", "25050"],
    },
    {
      mergedCode: "26000",
      name: "울산",
      prefix: "26",
      kind: "ulsan-metro",
      memberCodes: ["26010", "26020", "26030", "26040", "26310"],
    },
  ];
  const METRO_MERGED_NAME_BY_CODE = {};
  const METRO_CODE_BY_MEMBER = {};
  const METRO_GROUP_BY_PREFIX = {};
  METRO_MERGE_GROUPS.forEach((group) => {
    METRO_MERGED_NAME_BY_CODE[group.mergedCode] = group.name;
    METRO_GROUP_BY_PREFIX[group.prefix] = group;
    group.memberCodes.forEach((code) => {
      METRO_CODE_BY_MEMBER[code] = group.mergedCode;
    });
  });

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
    const codeStr = String(code || "");
    if (codeStr === SEOUL_GANGBUK_CODE) return "서울 강북";
    if (codeStr === SEOUL_GANGNAM_CODE) return "서울 강남";
    if (METRO_MERGED_NAME_BY_CODE[codeStr]) return METRO_MERGED_NAME_BY_CODE[codeStr];
    const formatted = formatName(raw);
    const region = REGION_BY_PREFIX[codeStr.slice(0, 2)];
    if (!region) return formatted;
    if (/^(.+시)(.+구)$/.test(raw)) return formatted;
    if (region.kind === "metro") {
      if (raw === "세종시" || raw === "세종") return "세종";
      return `${region.label} ${formatted}`;
    }
    return `${region.label} ${formatted}`;
  }

  function seoulBankCodeFor(code) {
    return SEOUL_GU_TO_BANK[String(code || "")] || "";
  }

  function cityMergedCodeFor(code) {
    return CITY_GU_TO_CITY[String(code || "")] || "";
  }

  function metroMergedCodeFor(code) {
    const codeStr = String(code || "");
    if (METRO_MERGED_NAME_BY_CODE[codeStr]) return codeStr;
    if (METRO_CODE_BY_MEMBER[codeStr]) return METRO_CODE_BY_MEMBER[codeStr];
    const group = METRO_GROUP_BY_PREFIX[codeStr.slice(0, 2)];
    return group ? group.mergedCode : "";
  }

  function featureToClipGeom(feature) {
    const geom = feature && feature.geometry;
    if (!geom || !Array.isArray(geom.coordinates)) return null;
    // polygon-clipping: Geom = Polygon[] , Polygon = Ring[]
    if (geom.type === "Polygon") return [geom.coordinates];
    if (geom.type === "MultiPolygon") return geom.coordinates;
    return null;
  }

  function unionBankGeometry(features) {
    const geoms = [];
    features.forEach((feature) => {
      const geom = featureToClipGeom(feature);
      if (geom && geom.length) geoms.push(geom);
    });
    if (!geoms.length) return null;

    const clipper =
      (typeof window !== "undefined" && window.polygonClipping) ||
      (typeof polygonClipping !== "undefined" ? polygonClipping : null);
    if (clipper && typeof clipper.union === "function") {
      try {
        const united = clipper.union(...geoms);
        if (Array.isArray(united) && united.length) {
          // 구 경계 틈이 hole로 남아 획이 그려지므로 외곽 링만 사용한다.
          const exteriors = united.map((poly) => [poly[0]]);
          return exteriors.length === 1
            ? { type: "Polygon", coordinates: exteriors[0] }
            : { type: "MultiPolygon", coordinates: exteriors };
        }
      } catch (_) {
        // fall through — MultiPolygon concat (내부 경계가 남을 수 있음)
      }
    }

    const coordinates = [];
    geoms.forEach((geom) => {
      geom.forEach((poly) => coordinates.push(poly));
    });
    return { type: "MultiPolygon", coordinates };
  }

  function mergeSeoulBanks(geojson) {
    if (!geojson || !Array.isArray(geojson.features)) return geojson;
    const others = [];
    const gangbuk = [];
    const gangnam = [];
    const guMeta = [];

    geojson.features.forEach((feature) => {
      const code = String((feature.properties && feature.properties.code) || "");
      const name = (feature.properties && feature.properties.name) || "";
      if (SEOUL_GANGBUK_SET.has(code)) {
        gangbuk.push(feature);
        guMeta.push({ code, name, bankCode: SEOUL_GANGBUK_CODE, bankName: "강북" });
        return;
      }
      if (SEOUL_GANGNAM_SET.has(code)) {
        gangnam.push(feature);
        guMeta.push({ code, name, bankCode: SEOUL_GANGNAM_CODE, bankName: "강남" });
        return;
      }
      // 혹시 남은 서울 코드도 강북으로 흡수
      if (code.startsWith("11")) {
        gangbuk.push(feature);
        guMeta.push({ code, name, bankCode: SEOUL_GANGBUK_CODE, bankName: "강북" });
        return;
      }
      others.push(feature);
    });

    const buildBank = (list, bankCode, bankName) => {
      const memberCodes = list
        .map((feature) => String((feature.properties && feature.properties.code) || ""))
        .filter(Boolean);
      const geometry = unionBankGeometry(list);
      if (!geometry) return null;
      return {
        type: "Feature",
        properties: {
          name: bankName,
          code: bankCode,
          kind: "seoul-bank",
          memberCodes,
        },
        geometry,
      };
    };

    const features = others.slice();
    const buk = buildBank(gangbuk, SEOUL_GANGBUK_CODE, "강북");
    const nam = buildBank(gangnam, SEOUL_GANGNAM_CODE, "강남");
    if (buk) features.push(buk);
    if (nam) features.push(nam);
    return {
      type: "FeatureCollection",
      features,
      _seoulGuMeta: guMeta,
    };
  }

  function mergeCityDistricts(geojson) {
    if (!geojson || !Array.isArray(geojson.features)) return geojson;
    const guToGroup = new Map();
    CITY_MERGE_GROUPS.forEach((group) => {
      group.guCodes.forEach((code) => guToGroup.set(code, group));
    });

    const buckets = new Map();
    const guMeta = [];
    const others = [];

    geojson.features.forEach((feature) => {
      const code = String((feature.properties && feature.properties.code) || "");
      const name = (feature.properties && feature.properties.name) || "";
      const group = guToGroup.get(code);
      if (!group) {
        others.push(feature);
        return;
      }
      if (!buckets.has(group.cityCode)) {
        buckets.set(group.cityCode, { group, list: [] });
      }
      buckets.get(group.cityCode).list.push(feature);
      guMeta.push({
        code,
        name,
        cityCode: group.cityCode,
        cityName: group.cityName,
        prefix: group.prefix,
      });
    });

    const features = others.slice();
    buckets.forEach(({ group, list }) => {
      const memberCodes = list
        .map((feature) => String((feature.properties && feature.properties.code) || ""))
        .filter(Boolean);
      const geometry = unionBankGeometry(list);
      if (!geometry) return;
      features.push({
        type: "Feature",
        properties: {
          name: group.cityName,
          code: group.cityCode,
          kind: "city-merge",
          memberCodes,
        },
        geometry,
      });
    });

    return {
      type: "FeatureCollection",
      features,
      _seoulGuMeta: geojson._seoulGuMeta,
      _cityGuMeta: guMeta,
    };
  }

  function mergeMetroRegions(geojson) {
    if (!geojson || !Array.isArray(geojson.features)) return geojson;
    const buckets = new Map();
    const guMeta = [];
    const others = [];

    geojson.features.forEach((feature) => {
      const code = String((feature.properties && feature.properties.code) || "");
      const name = (feature.properties && feature.properties.name) || "";
      const group = METRO_GROUP_BY_PREFIX[code.slice(0, 2)];
      if (!group) {
        others.push(feature);
        return;
      }
      if (!buckets.has(group.mergedCode)) {
        buckets.set(group.mergedCode, { group, list: [] });
      }
      buckets.get(group.mergedCode).list.push(feature);
      guMeta.push({
        code,
        name,
        metroCode: group.mergedCode,
        metroName: group.name,
        prefix: group.prefix,
      });
    });

    const features = others.slice();
    buckets.forEach(({ group, list }) => {
      const memberCodes = list
        .map((feature) => String((feature.properties && feature.properties.code) || ""))
        .filter(Boolean);
      const geometry = unionBankGeometry(list);
      if (!geometry) return;
      features.push({
        type: "Feature",
        properties: {
          name: group.name,
          code: group.mergedCode,
          kind: group.kind,
          memberCodes,
        },
        geometry,
      });
    });

    return {
      type: "FeatureCollection",
      features,
      _seoulGuMeta: geojson._seoulGuMeta,
      _cityGuMeta: geojson._cityGuMeta,
      _metroGuMeta: guMeta,
    };
  }

  function shiftCoords(coords, deltaLng, deltaLat = 0) {
    if (!Array.isArray(coords) || !coords.length) return coords;
    if (typeof coords[0] === "number") {
      return [coords[0] + deltaLng, coords[1] + deltaLat];
    }
    return coords.map((part) => shiftCoords(part, deltaLng, deltaLat));
  }

  function shiftFeature(feature, deltaLng, deltaLat = 0) {
    if (!feature || !feature.geometry || !Array.isArray(feature.geometry.coordinates)) {
      return feature;
    }
    if (!deltaLng && !deltaLat) return feature;
    return {
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: shiftCoords(feature.geometry.coordinates, deltaLng, deltaLat),
      },
    };
  }

  function keepUlleungBodyOnly(feature) {
    if (!feature || !feature.geometry) return feature;
    const geom = feature.geometry;
    if (geom.type !== "MultiPolygon" || !Array.isArray(geom.coordinates)) return feature;
    const kept = geom.coordinates.filter((poly) => {
      const pts = collectLngLat(poly);
      if (!pts.length) return false;
      return pointsBBox(pts).cx < ULLEUNG_BODY_LNG_MAX;
    });
    if (!kept.length) return feature;
    return {
      ...feature,
      geometry: {
        ...geom,
        coordinates: kept,
      },
    };
  }

  function shiftEastIslands(geojson) {
    if (!geojson || !Array.isArray(geojson.features)) return geojson;
    return {
      ...geojson,
      features: geojson.features.map((feature) => {
        const code = String((feature.properties && feature.properties.code) || "");
        const kind = String((feature.properties && feature.properties.kind) || "");
        if (kind === "dokdo") {
          return shiftFeature(feature, DOKDO_LNG_SHIFT, DOKDO_LAT_SHIFT);
        }
        if (EAST_ISLAND_CODES.has(code)) {
          // 울릉군 MultiPolygon에 섞인 독도 첨점은 제거하고 본체만 이동
          const body = keepUlleungBodyOnly(feature);
          return shiftFeature(body, EAST_ISLAND_LNG_SHIFT, 0);
        }
        if (code === ONGJIN_CODE) {
          return shiftFeature(feature, ONGJIN_LNG_SHIFT, ONGJIN_LAT_SHIFT);
        }
        return feature;
      }),
    };
  }

  function collectLngLat(coords, out = []) {
    if (!Array.isArray(coords) || !coords.length) return out;
    if (typeof coords[0] === "number") {
      out.push([coords[0], coords[1]]);
      return out;
    }
    coords.forEach((part) => collectLngLat(part, out));
    return out;
  }

  function pointsBBox(pts) {
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    pts.forEach(([lng, lat]) => {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    });
    const width = maxLng - minLng;
    const height = maxLat - minLat;
    return {
      minLng,
      maxLng,
      minLat,
      maxLat,
      width,
      height,
      diag: Math.hypot(width, height),
      cx: (minLng + maxLng) / 2,
      cy: (minLat + maxLat) / 2,
    };
  }

  function scaleCoordsAround(coords, scale, cx, cy) {
    if (!Array.isArray(coords) || !coords.length) return coords;
    if (typeof coords[0] === "number") {
      return [cx + (coords[0] - cx) * scale, cy + (coords[1] - cy) * scale];
    }
    return coords.map((part) => scaleCoordsAround(part, scale, cx, cy));
  }

  function scaleFeatureAround(feature, scale, cx, cy) {
    if (!feature || !feature.geometry || !Array.isArray(feature.geometry.coordinates)) {
      return feature;
    }
    return {
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: scaleCoordsAround(feature.geometry.coordinates, scale, cx, cy),
      },
    };
  }

  function findFeatureByCode(geojson, code) {
    const want = String(code);
    return (geojson && geojson.features ? geojson.features : []).find(
      (feature) => String((feature.properties && feature.properties.code) || "") === want
    );
  }

  function prepareDokdoGeojson(rawDokdo, sourceGeojson) {
    if (!rawDokdo || !Array.isArray(rawDokdo.features) || !rawDokdo.features.length) {
      return rawDokdo;
    }
    let feature = rawDokdo.features[0];
    const dokPts = collectLngLat(feature.geometry && feature.geometry.coordinates);
    if (!dokPts.length) return rawDokdo;
    const dokBox = pointsBBox(dokPts);

    let scale = 1;
    const ulleung = findFeatureByCode(sourceGeojson, "37430");
    if (ulleung && dokBox.diag > 0) {
      const ullPts = collectLngLat(ulleung.geometry && ulleung.geometry.coordinates).filter(
        ([lng]) => lng < ULLEUNG_BODY_LNG_MAX
      );
      const ullBox = pointsBBox(ullPts.length ? ullPts : collectLngLat(ulleung.geometry.coordinates));
      if (ullBox.diag > 0) {
        scale = (DOKDO_TO_ULLEUNG_SIZE * ullBox.diag) / dokBox.diag;
      }
    }

    feature = scaleFeatureAround(feature, scale, dokBox.cx, dokBox.cy);
    feature = shiftFeature(feature, DOKDO_LNG_SHIFT, DOKDO_LAT_SHIFT);
    const labelPts = collectLngLat(feature.geometry.coordinates);
    const labelBox = pointsBBox(labelPts);
    return {
      type: "FeatureCollection",
      features: [feature],
      _labelLatLng: [labelBox.cy, labelBox.cx],
    };
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
    const districts = (collection.features || [])
      .map((feature) => {
        const name = feature.properties && feature.properties.name;
        const code = String((feature.properties && feature.properties.code) || "");
        const center = featureCentroid(feature.geometry || {});
        if (!name || !code || !center) return null;
        const compound = name.match(/^(.+시)(.+구)$/);
        const memberCodes = Array.isArray(feature.properties && feature.properties.memberCodes)
          ? feature.properties.memberCodes.map(String)
          : [code];
        const district = {
          name,
          code,
          prefix: code.slice(0, 2),
          city: compound ? compound[1] : "",
          lat: center.lat,
          lng: center.lng,
          aliases: aliasesFor(name),
          memberCodes,
        };
        METROS.forEach((metro) => {
          if (metro.prefix === district.prefix) {
            district.aliases.push({ text: metro.text, rank: metro.rank || 1, kind: "metro" });
          }
        });
        return district;
      })
      .filter(Boolean);

    // 메뉴 WM_Region이 개별 구명이어도 합쳐진 구역으로 매칭되도록 가상 구 엔트리를 추가
    const byCode = new Map(districts.map((d) => [d.code, d]));
    const seoulGuMeta = Array.isArray(collection && collection._seoulGuMeta) ? collection._seoulGuMeta : [];
    seoulGuMeta.forEach((meta) => {
      const bank = byCode.get(meta.bankCode);
      if (!bank || !meta.name) return;
      const aliases = aliasesFor(meta.name);
      aliases.push({ text: "서울", rank: 1, kind: "metro" });
      districts.push({
        name: meta.name,
        code: meta.bankCode,
        prefix: "11",
        city: "",
        lat: bank.lat,
        lng: bank.lng,
        aliases,
        memberCodes: bank.memberCodes || [meta.bankCode],
        guCode: meta.code,
      });
    });

    const cityGuMeta = Array.isArray(collection && collection._cityGuMeta)
      ? collection._cityGuMeta
      : [];
    cityGuMeta.forEach((meta) => {
      const city = byCode.get(meta.cityCode);
      if (!city || !meta.name) return;
      const aliases = aliasesFor(meta.name);
      const prefix = meta.prefix || String(meta.cityCode).slice(0, 2);
      const region = REGION_BY_PREFIX[prefix];
      if (region && region.label) {
        aliases.push({ text: region.label, rank: 1, kind: "metro" });
        if (region.label.endsWith("도")) {
          aliases.push({ text: region.label.replace(/도$/, ""), rank: 1, kind: "metro" });
        }
      }
      districts.push({
        name: meta.name,
        code: meta.cityCode,
        prefix,
        city: meta.cityName || "",
        lat: city.lat,
        lng: city.lng,
        aliases,
        memberCodes: city.memberCodes || [meta.cityCode],
        guCode: meta.code,
      });
    });

    const metroGuMeta = Array.isArray(collection && collection._metroGuMeta)
      ? collection._metroGuMeta
      : [];
    metroGuMeta.forEach((meta) => {
      const metro = byCode.get(meta.metroCode);
      if (!metro || !meta.name) return;
      const aliases = aliasesFor(meta.name);
      if (meta.metroName) aliases.push({ text: meta.metroName, rank: 1, kind: "metro" });
      districts.push({
        name: meta.name,
        code: meta.metroCode,
        prefix: meta.prefix || String(meta.metroCode).slice(0, 2),
        city: "",
        lat: metro.lat,
        lng: metro.lng,
        aliases,
        memberCodes: metro.memberCodes || [meta.metroCode],
        guCode: meta.code,
      });
    });

    return districts;
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

    // SVG 시군구 레이어 위에서 Leaflet 기본 dragging이 자주 끊기므로
    // 기본 드래그는 끄고 포인터 팬을 직접 처리한다.
    const map = window.L.map(mapEl, {
      dragging: false,
      inertia: false,
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

    const dismissAllMapTips = ({ resetActive = false } = {}) => {
      cancelHideHoverPopup();
      dismissHoverPopup();
      dismissEmptyPopup();
      layersByCode.forEach((layer) => {
        if (layer && typeof layer.closeTooltip === "function") layer.closeTooltip();
      });
      if (dokdoLayer) {
        dokdoLayer.eachLayer((layer) => {
          if (layer && typeof layer.closeTooltip === "function") layer.closeTooltip();
        });
      }
      if (typeof map.closeTooltip === "function") map.closeTooltip();
      if (resetActive) setActiveCode(null);
      setStatus(itemCount ? withItemsStatus : idleStatus);
    };

    let pointerPan = null;
    let suppressNextRegionClick = false;
    const isMapPanning = () => Boolean(pointerPan && pointerPan.moved);

    const onPointerPanMove = (event) => {
      if (!pointerPan) return;
      const dx = event.clientX - pointerPan.x;
      const dy = event.clientY - pointerPan.y;
      if (!pointerPan.moved) {
        if (dx * dx + dy * dy < 16) return;
        pointerPan.moved = true;
        suppressNextRegionClick = true;
        map.getContainer().classList.add("leaflet-drag-target");
        dismissAllMapTips({ resetActive: false });
        map.fire("dragstart");
      }
      const startPoint = map.latLngToContainerPoint(pointerPan.center);
      const nextCenter = map.containerPointToLatLng([startPoint.x - dx, startPoint.y - dy]);
      map.setView(nextCenter, map.getZoom(), { animate: false });
      map.fire("drag");
    };

    const onPointerPanUp = () => {
      if (!pointerPan) return;
      const moved = pointerPan.moved;
      pointerPan = null;
      window.removeEventListener("pointermove", onPointerPanMove, true);
      window.removeEventListener("pointerup", onPointerPanUp, true);
      window.removeEventListener("pointercancel", onPointerPanUp, true);
      map.getContainer().classList.remove("leaflet-drag-target");
      if (moved) {
        setActiveCode(null);
        map.fire("dragend");
        // 드래그 직후 click이 한 번 더 들어오는 것을 짧게 무시
        window.setTimeout(() => {
          suppressNextRegionClick = false;
        }, 0);
      }
    };

    map.getContainer().addEventListener(
      "pointerdown",
      (event) => {
        if (event.button != null && event.button !== 0) return;
        if (event.target && event.target.closest && event.target.closest(".leaflet-popup, .leaflet-control")) {
          return;
        }
        pointerPan = {
          x: event.clientX,
          y: event.clientY,
          center: map.getCenter(),
          moved: false,
        };
        window.addEventListener("pointermove", onPointerPanMove, true);
        window.addEventListener("pointerup", onPointerPanUp, true);
        window.addEventListener("pointercancel", onPointerPanUp, true);
      },
      true
    );

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

    const collectMatchedItems = (codes) => {
      const seen = new Set();
      const matched = [];
      (codes || []).forEach((code) => {
        (itemsByCode.get(String(code)) || []).forEach((item) => {
          const key = item && item.id != null ? `id:${item.id}` : `ref:${matched.length}`;
          if (seen.has(key)) return;
          seen.add(key);
          matched.push(item);
        });
      });
      return matched;
    };

    const attachRegionHandlers = (layer, { code, name, memberCodes = null, registerLayer = true } = {}) => {
      const regionCode = String(code || "");
      const regionName = name || regionCode;
      const lookupCodes = Array.isArray(memberCodes) && memberCodes.length
        ? Array.from(new Set([regionCode].concat(memberCodes.map(String))))
        : [regionCode];
      const matched = collectMatchedItems(lookupCodes);
      if (registerLayer) {
        layersByCode.set(regionCode, layer);
        lookupCodes.forEach((memberCode) => layersByCode.set(String(memberCode), layer));
      }

      if (typeof layer.unbindTooltip === "function") layer.unbindTooltip();
      layer.off("mouseover");
      layer.off("mouseout");
      layer.off("click");

      if (!matched.length) {
        layer.bindTooltip(regionName, {
          permanent: false,
          sticky: true,
          direction: "bottom",
          offset: [0, 14],
          className: "korea-name-label",
          opacity: 1,
        });
      }

      layer.on("mouseover", (event) => {
        if (isMapPanning()) return;
        dismissEmptyPopup();
        setActiveCode(regionCode);
        if (matched.length) {
          const anchor = event.latlng || layer.getBounds().getCenter();
          showHoverPopup(matched, anchor, regionName, regionCode);
        } else {
          scheduleHideHoverPopup();
          setStatus(regionName);
        }
        if (typeof options.onRegionEnter === "function") {
          options.onRegionEnter({ code: regionCode, name: regionName, items: matched, latlng: event.latlng });
        }
      });

      layer.on("mouseout", (event) => {
        if (isMapPanning()) return;
        const related = event.originalEvent && event.originalEvent.relatedTarget;
        const popupEl = hoverPopup && hoverPopup.getElement();
        if (related && popupEl && popupEl.contains(related)) {
          if (matched.length) scheduleHideHoverPopup();
          return;
        }
        if (typeof layer.closeTooltip === "function") layer.closeTooltip();
        if (activeCode === regionCode) setActiveCode(null);
        if (matched.length) scheduleHideHoverPopup();
        else setStatus(itemCount ? withItemsStatus : idleStatus);
        if (typeof options.onRegionLeave === "function") {
          options.onRegionLeave({ code: regionCode, name: regionName, items: matched });
        }
      });

      layer.on("click", (event) => {
        if (suppressNextRegionClick || isMapPanning()) {
          window.L.DomEvent.stopPropagation(event);
          if (event.originalEvent) window.L.DomEvent.preventDefault(event.originalEvent);
          return;
        }
        window.L.DomEvent.stopPropagation(event);
        const latlng = event.latlng || layer.getBounds().getCenter();
        if (matched.length) {
          showHoverPopup(matched, latlng, regionName, regionCode);
        } else {
          showEmptyClick(latlng, { code: regionCode, name: regionName });
        }
        if (typeof options.onRegionClick === "function") {
          options.onRegionClick({ code: regionCode, name: regionName, items: matched, latlng });
        }
      });
    };

    const bindDokdoHandlers = () => {
      if (!dokdoLayer) return;
      dokdoLayer.eachLayer((layer) => {
        // 행정구역상 울릉군(37430). 표시명은 독도.
        attachRegionHandlers(layer, {
          code: "37430",
          name: "독도",
          registerLayer: false,
        });
      });
    };

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
          const memberCodes = Array.isArray(feature.properties.memberCodes)
            ? feature.properties.memberCodes.map(String)
            : null;
          attachRegionHandlers(layer, { code, name, memberCodes, registerLayer: true });
        },
      }).addTo(map);

      bindDokdoHandlers();
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
        (item.codes || []).forEach((rawCode) => {
          const code = String(rawCode);
          activeCodes.add(code);
          const bank = seoulBankCodeFor(code);
          if (bank) activeCodes.add(bank);
          const city = cityMergedCodeFor(code);
          if (city) activeCodes.add(city);
          const metro = metroMergedCodeFor(code);
          if (metro) activeCodes.add(metro);
        });
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

    const fetchDokdo = () => {
      if (!dokdoUrl) return Promise.resolve(null);
      return fetch(dokdoUrl)
        .then((response) => {
          if (!response.ok) throw new Error(`dokdo ${response.status}`);
          return response.json();
        })
        .catch((err) => {
          console.warn("TripEnterSigMap: Dokdo layer skipped:", err);
          return null;
        });
    };

    const mountDokdo = (rawDokdo, sourceGeojson) => {
      if (!rawDokdo) return null;
      if (dokdoLayer) {
        map.removeLayer(dokdoLayer);
        dokdoLayer = null;
      }
      if (dokdoLabel) {
        map.removeLayer(dokdoLabel);
        dokdoLabel = null;
      }
      const prepared = prepareDokdoGeojson(rawDokdo, sourceGeojson);
      dokdoLayer = window.L.geoJSON(prepared, {
        style: DOKDO_FILL,
        interactive: true,
        pane: "overlayPane",
      }).addTo(map);
      bindDokdoHandlers();
      return dokdoLayer;
    };

    const ready = Promise.all([
      fetch(geoUrl).then((response) => {
        if (!response.ok) throw new Error(`geojson ${response.status}`);
        return response.json();
      }),
      loadNkOutline(),
      fetchDokdo(),
    ])
      .then(async ([geojson, , dokdoRaw]) => {
        collection = shiftEastIslands(
          mergeMetroRegions(mergeCityDistricts(mergeSeoulBanks(geojson)))
        );
        mountDokdo(dokdoRaw, geojson);
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
