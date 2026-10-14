(() => {
  const stage = document.querySelector("[data-stage]");
  const canvas = document.querySelector("[data-scene]");
  const meterEl = document.querySelector("[data-meter]");
  const weatherEl = document.querySelector("[data-weather]");
  const hintEl = document.querySelector("[data-hint]");
  const rainCountdownEl = document.querySelector("[data-rain-countdown]");
  const rainSecEl = document.querySelector("[data-rain-sec]");
  if (!stage || !canvas) return;

  const ctx = canvas.getContext("2d", { alpha: false });
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const touchUi = window.matchMedia("(hover: none)").matches;

  const IMG_RAIN = "../../img/gatbawi-rain.jpg";
  const IMG_CLEAR = "../../img/gatbawi-clear.jpg";

  // 구름이 충분히 걷힌 뒤 이 시간이 지나면 다시 비 오는 상태로 돌아간다.
  const CLEAR_HOLD_MS = 20000;
  const CLEAR_HOLD_THRESHOLD = 0.9;

  const state = {
    w: 0,
    h: 0,
    dpr: 1,
    t: 0,
    clear: 0,
    targetClear: 0,
    // 0=왼쪽 풍경, 1=오른쪽 풍경 (가로 패닝)
    pan: 0,
    targetPan: 0,
    hasPanned: false,
    mx: 0.5,
    my: 0.3,
    hasPointer: false,
    wipeTrail: [],
    ready: false,
    cloudsWereHeavy: true,
    clearHoldStartedAt: 0,
  };

  const rainImg = new Image();
  const clearImg = new Image();
  let loaded = 0;

  // 수면 왜곡용 오프스크린
  const waveCanvas = document.createElement("canvas");
  const waveCtx = waveCanvas.getContext("2d");

  const rnd = (() => {
    let s = 50011011;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  })();

  function cloudRand(seed) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /** 밑은 편평하고 위는 높이가 다른 봉우리가 몸통에 붙은 적운을 한 장으로 구워 둔다. */
  function bakeCloudSprite(rand) {
    const span = 1.28 + rand() * 0.28;
    const belly = 0.2;
    const puffs = [];
    const count = 5;
    for (let i = 0; i < count; i += 1) {
      const t = (i + 0.5) / count;
      const edge = Math.sin(t * Math.PI);
      const s = 0.15 + edge * 0.07 + rand() * 0.035;
      const rise = edge * (0.08 + rand() * 0.2);
      puffs.push({
        ox: (t - 0.5) * span + (rand() - 0.5) * 0.03,
        oy: belly - rise * 0.55,
        s,
      });
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of puffs) {
      minX = Math.min(minX, p.ox - p.s);
      maxX = Math.max(maxX, p.ox + p.s);
      minY = Math.min(minY, p.oy - p.s);
      maxY = Math.max(maxY, p.oy + p.s);
    }
    const pad = 0.06;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY = Math.max(maxY, belly + 0.06) + pad;

    const unit = 280;
    const sharp = document.createElement("canvas");
    sharp.width = Math.max(1, Math.ceil((maxX - minX) * unit));
    sharp.height = Math.max(1, Math.ceil((maxY - minY) * unit));
    const g = sharp.getContext("2d");
    const px = (p) => (p.ox - minX) * unit;
    const py = (p) => (p.oy - minY) * unit;

    g.fillStyle = "rgb(168, 176, 186)";
    for (const p of puffs) {
      g.beginPath();
      g.arc(px(p), py(p), p.s * unit, 0, Math.PI * 2);
      g.fill();
    }
    for (const p of puffs) {
      const rad = p.s * unit;
      const hx = px(p) - rad * 0.18;
      const hy = py(p) - rad * 0.42;
      const glow = g.createRadialGradient(hx, hy, rad * 0.04, hx, hy, rad * 0.85);
      glow.addColorStop(0, "rgba(236, 240, 244, 0.8)");
      glow.addColorStop(1, "rgba(236, 240, 244, 0)");
      g.fillStyle = glow;
      g.beginPath();
      g.arc(hx, hy, rad * 0.85, 0, Math.PI * 2);
      g.fill();
    }

    const cut = (belly - minY) * unit;
    g.globalCompositeOperation = "destination-in";
    g.fillStyle = "#fff";
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(sharp.width, 0);
    g.lineTo(sharp.width, cut);
    g.quadraticCurveTo(sharp.width * 0.5, cut + unit * 0.045, 0, cut);
    g.closePath();
    g.fill();

    const soft = document.createElement("canvas");
    soft.width = sharp.width;
    soft.height = sharp.height;
    const sg = soft.getContext("2d");
    sg.filter = "blur(5px)";
    sg.drawImage(sharp, 0, 0);

    return { canvas: soft, minX, minY, w: maxX - minX, h: maxY - minY };
  }

  /** 사진 왼쪽 갓바위와 겹치지 않도록 구름을 이 비율 오른쪽에만 둔다. */
  const ROCK_CLEAR_X = 0.2;
  const CLOUD_Y0 = 0.02;
  const CLOUD_YH = 0.34;

  const clouds = Array.from({ length: 38 }, (_, i) => ({
    x: ROCK_CLEAR_X + rnd() * (1 - ROCK_CLEAR_X),
    y: CLOUD_Y0 + rnd() * CLOUD_YH,
    r: 0.1 + rnd() * 0.18,
    soft: 0.5 + rnd() * 0.4,
    drift: 0.01 + rnd() * 0.025,
    sprite: bakeCloudSprite(cloudRand(8100 + i * 131)),
    shiftTop40: false,
    shiftTop30: false,
    shiftTop20: false,
    shiftTop10: false,
  }));

  {
    const byY = [...clouds].sort((a, b) => a.y - b.y);
    const n40 = Math.max(1, Math.ceil(byY.length * 0.4));
    const n30 = Math.max(1, Math.ceil(byY.length * 0.3));
    const n20 = Math.max(1, Math.ceil(byY.length * 0.2));
    const n10 = Math.max(1, Math.ceil(byY.length * 0.1));
    for (let i = 0; i < n40; i += 1) byY[i].shiftTop40 = true;
    for (let i = 0; i < n30; i += 1) byY[i].shiftTop30 = true;
    for (let i = 0; i < n20; i += 1) byY[i].shiftTop20 = true;
    for (let i = 0; i < n10; i += 1) byY[i].shiftTop10 = true;
  }

  const drops = Array.from({ length: 260 }, () => ({
    x: rnd(),
    y: rnd(),
    len: 12 + rnd() * 20,
    sp: 0.55 + rnd() * 0.9,
    thick: 0.55 + rnd() * 0.85,
  }));

  const splashes = [];
  const MAX_SPLASH = 90;

  function makePerson(umbrella) {
    return {
      u: rnd() * 0.85,
      dir: rnd() > 0.5 ? 1 : -1,
      speed: 0.012 + rnd() * 0.02,
      phase: rnd() * Math.PI * 2,
      hue: 170 + rnd() * 90,
      umbrella,
      scale: 0.8 + rnd() * 0.35,
      bubble: null,
    };
  }

  const rainyPeople = Array.from({ length: 4 }, () => makePerson(true));
  const clearPeople = Array.from({ length: 15 }, () => makePerson(false));

  const LINES_RAIN = [
    "우산 없었으면 큰일인데!",
    "비가 추적추적하네…",
    "갓바위가 빗속에 더 운치 있다",
    "신발 젖겠어, 조심해!",
    "빗소리가 좋네",
    "우산 나눠 쓸까?",
    "바다 위 비 냄새 맡아봐",
    "미끄러우니까 손잡이 잡아",
    "사진 찍기엔 흐린 날이 제격이야",
    "저 바위, 삿갓 쓴 것 같지 않아?",
    "비 맞으며 걷는 맛이지",
    "바람까지 부니까 더 춥다",
    "보행교가 살짝 흔들리네",
    "비옷 입고 오길 잘했어",
    "빗줄기 사이로 도시가 보여",
  ];

  const LINES_CLEAR = [
    "와! 멋지다!",
    "굉장한데?",
    "여기 풍경 진짜다",
    "갓바위 실물이 훨씬 커",
    "사진 찍자, 빨리!",
    "바닷바람 시원하다",
    "저 실루엣 예술이야",
    "목포 오면 꼭 여기 와야 해",
    "걸으면서 보니 더 예쁘네",
    "하늘이 맑아서 다행이다",
    "보행교 끝으로 가볼까?",
    "이거 완전 인생샷 각인데",
    "파도 소리가 편안해",
    "친구들한테도 알려줘야지",
    "자연이 깎아 낸 조각품이야",
  ];

  const LINES_FUN = [
    "배고파…",
    "화장실 급해!",
    "다리 아파, 조금만 쉬자",
    "휴대폰 배터리 거의 없어",
    "누가 아이스크림 사 오면 좋겠다",
    "모기 물렸나 간지러워",
    "커피 마시고 싶다",
    "신발끈 풀렸어!",
    "차 키가 어디 갔지…",
    "배에서 꼬르륵 소리 났지?",
  ];

  function clearAllBubbles() {
    for (const p of rainyPeople) p.bubble = null;
    for (const p of clearPeople) p.bubble = null;
  }

  function activeBubbleTexts() {
    const now = performance.now();
    const used = new Set();
    for (const p of rainyPeople) {
      if (p.bubble && now < p.bubble.until) used.add(p.bubble.text);
    }
    for (const p of clearPeople) {
      if (p.bubble && now < p.bubble.until) used.add(p.bubble.text);
    }
    return used;
  }

  function pickFrom(lines, used) {
    const free = lines.filter((t) => !used.has(t));
    if (!free.length) return null;
    return free[Math.floor(Math.random() * free.length)];
  }

  function pickLine(rainy) {
    const used = activeBubbleTexts();
    if (Math.random() < 0.1) {
      const fun = pickFrom(LINES_FUN, used);
      if (fun) return fun;
    }
    const main = pickFrom(rainy ? LINES_RAIN : LINES_CLEAR, used);
    if (main) return main;
    return (
      pickFrom([...LINES_FUN, ...LINES_RAIN, ...LINES_CLEAR], used) || "와!"
    );
  }

  function personScale(p) {
    return p.scale * (state.h / 1100) * 0.85 * 1.5 * 1.2;
  }

  function personScreenPos(p) {
    const pos = deckPath(p.u);
    const bob = Math.sin(state.t * 7.5 + p.phase) * 0.9;
    // 왼쪽 출발 구간(u≈0)에서 추가로 왼쪽으로 — 끝점만 확실히 밀기
    const leftNudge = p.u < 0.25 ? 60 * (1 - p.u / 0.25) : 0;
    return { x: pos.x - leftNudge, y: pos.y - 6 + bob, s: personScale(p) };
  }

  function visiblePeople(clear) {
    const list = [];
    const rainCount = 1 + Math.floor(clamp(1 - clear, 0, 1) * 3);
    const clearCount = 10 + Math.floor(clear * 5);
    if (clear < 0.72) {
      for (let i = 0; i < rainCount; i += 1) list.push({ p: rainyPeople[i], rainy: true });
    }
    if (clear > 0.28) {
      for (let i = 0; i < clearCount; i += 1) list.push({ p: clearPeople[i], rainy: false });
    }
    return list;
  }

  function hitPerson(nx, ny) {
    const px = nx * state.w;
    const py = ny * state.h;
    const list = visiblePeople(state.clear);
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const { p, rainy } = list[i];
      if (p.bubble && performance.now() < p.bubble.until) continue;
      const pos = personScreenPos(p);
      const hw = 16 * pos.s;
      const top = pos.y - (p.umbrella ? 38 : 28) * pos.s;
      const bot = pos.y + 12 * pos.s;
      if (px >= pos.x - hw && px <= pos.x + hw && py >= top && py <= bot) {
        return { p, rainy };
      }
    }
    return null;
  }

  function onReady() {
    loaded += 1;
    if (loaded >= 2) {
      state.ready = true;
      resize();
      requestAnimationFrame(frame);
    }
  }

  rainImg.onload = onReady;
  clearImg.onload = onReady;
  rainImg.onerror = onReady;
  clearImg.onerror = onReady;
  rainImg.src = IMG_RAIN;
  clearImg.src = IMG_CLEAR;

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * cover-fit + 가로 비대칭 크롭.
   * 이미지 세로맞춤 너비(fitW)보다 화면이 좁으면(로딩·리사이즈 공통)
   * 왼쪽을 최대 170px까지 자르고, 나머지 가로 잘림은 오른쪽에서 가져온다. 세로는 중앙.
   */
  function coverRect(img) {
    const iw = img.naturalWidth || 1;
    const ih = img.naturalHeight || 1;

    const scaleH = state.h / ih;
    const fitW = iw * scaleH;
    let scale;
    let dw;
    let dh;

    if (state.w >= fitW) {
      scale = state.w / iw;
      dw = state.w;
      dh = ih * scale;
    } else {
      // 좁을 때 이미지를 축소하지 않고 가로 클립
      scale = scaleH;
      dw = fitW;
      dh = state.h;
    }

    const overflowX = Math.max(0, dw - state.w);
    // pan 0→왼쪽, 1→오른쪽. 좌우 드래그로 크롭 위치를 옮긴다.
    const leftCrop = overflowX * clamp(state.pan, 0, 1);
    const rightCrop = Math.max(0, overflowX - leftCrop);

    // 소스 좌표로 크롭 (dx 음수보다 확실함)
    const sy = Math.max(0, ((dh - state.h) / 2) / scale);
    const sh = Math.min(ih - sy, state.h / scale);
    const sx = leftCrop / scale;
    const sw = Math.max(1, iw - sx - rightCrop / scale);

    return {
      dx: 0,
      dy: 0,
      dw: state.w,
      dh: state.h,
      scale,
      sx,
      sy,
      sw,
      sh,
      leftCrop,
      overflowX,
      // 동선용: 잘리기 전 이미지 평면에서의 위치
      planeDx: -leftCrop,
      planeDy: (state.h - dh) / 2,
      planeDw: dw,
      planeDh: dh,
    };
  }

  /** 예전 고정 크롭(왼쪽 최대 170px)에 가깝게 초기 패닝을 잡는다. */
  function defaultPan() {
    const img =
      rainImg.naturalWidth > 0
        ? rainImg
        : clearImg.naturalWidth > 0
          ? clearImg
          : null;
    if (!img || state.w <= 0 || state.h <= 0) return 0;
    const iw = img.naturalWidth || 1;
    const ih = img.naturalHeight || 1;
    const scaleH = state.h / ih;
    const fitW = iw * scaleH;
    const scale = state.w >= fitW ? state.w / iw : scaleH;
    const dw = iw * scale;
    const overflowX = Math.max(0, dw - state.w);
    if (overflowX <= 0) return 0;
    return clamp(Math.min(170, overflowX) / overflowX, 0, 1);
  }

  function seaTop() {
    return state.h * 0.42;
  }

  /** 보행교 시작 UV — 갓바위(왼쪽) 오른쪽, 다리 위 (0.4에서 왼쪽으로 ~30px) */
  const DECK_U0 = 0.37;
  const DECK_U1 = 1.0;

  /**
   * 사진(cover-fit) 기준 보행교 경로.
   * 왼쪽 끝은 바위와 겹치지 않게 DECK_U0부터.
   */
  function deckPath(u) {
    const img =
      rainImg.naturalWidth > 0
        ? rainImg
        : clearImg.naturalWidth > 0
          ? clearImg
          : { naturalWidth: 1024, naturalHeight: 531 };
    const r = coverRect(img);
    const leftCrop = r.leftCrop || 0;
    const toScreenX = (uv) => uv * r.planeDw - leftCrop;
    const x0 = toScreenX(DECK_U0);
    const x1 = toScreenX(DECK_U1);
    const y0 = r.planeDy + r.planeDh * 0.735;
    const y1 = r.planeDy + r.planeDh * 0.8;
    const x = lerp(x0, x1, u);
    const y =
      lerp(y0, y1, u) +
      Math.sin(u * Math.PI * 0.9) * r.planeDh * 0.012 -
      u * r.planeDh * 0.006;
    return { x, y };
  }

  function stepPerson(p) {
    p.u += p.dir * p.speed * 0.016;
    // 바위 쪽으로 u<0 들어가지 않게 끝에서 바로 반대편으로
    if (p.u >= 1) {
      p.u = 0;
      p.dir = 1;
      p.bubble = null;
    } else if (p.u <= 0) {
      p.u = 1;
      p.dir = -1;
      p.bubble = null;
    }
  }

  function resize() {
    const rect = stage.getBoundingClientRect();
    state.w = Math.max(1, Math.floor(rect.width));
    state.h = Math.max(1, Math.floor(rect.height));
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(state.w * state.dpr);
    canvas.height = Math.floor(state.h * state.dpr);
    canvas.style.width = `${state.w}px`;
    canvas.style.height = `${state.h}px`;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

    waveCanvas.width = state.w;
    waveCanvas.height = state.h;

    // 아직 사용자가 패닝하지 않았다면 초기 구도를 유지한다.
    if (!state.hasPanned) {
      const p = defaultPan();
      state.pan = p;
      state.targetPan = p;
    }
  }

  function wipeAt(nx, ny) {
    state.wipeTrail.push({ x: nx, y: ny, life: 1 });
    if (state.wipeTrail.length > 56) state.wipeTrail.shift();
    const rainLeft = 1 - state.clear;
    state.targetClear = clamp(state.targetClear + 0.014 * (0.4 + rainLeft), 0, 1);
  }

  function applyInteraction(clientX, clientY, opts = {}) {
    const { pan = true, wipe = true } = opts;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    state.mx = (clientX - rect.left) / w;
    state.my = (clientY - rect.top) / h;
    state.hasPointer = true;
    if (pan) {
      // 청령포와 같이 포인터 X로 좌우 시점을 옮긴다.
      state.targetPan = clamp(state.mx, 0.02, 0.98);
      state.hasPanned = true;
    }
    if (wipe && state.my < 0.55) wipeAt(state.mx, state.my);
  }

  function tryPersonBubble() {
    const hit = hitPerson(state.mx, state.my);
    if (!hit) return;
    const rainyMood = hit.rainy || state.clear < 0.45;
    hit.p.bubble = {
      text: pickLine(rainyMood),
      until: performance.now() + 10000,
    };
  }

  let gesture = { active: false, axis: null, startX: 0, startY: 0 };

  function resetGesture() {
    gesture.active = false;
    gesture.axis = null;
    state.hasPointer = false;
  }

  if (touchUi) {
    // 모바일: 세로는 네이티브 스크롤, 가로만 패닝·구름 쓸기
    stage.addEventListener(
      "touchstart",
      (event) => {
        const touch = event.changedTouches[0];
        if (!touch) return;
        gesture = {
          active: true,
          axis: null,
          startX: touch.clientX,
          startY: touch.clientY,
        };
        applyInteraction(touch.clientX, touch.clientY, { pan: false, wipe: false });
        tryPersonBubble();
      },
      { passive: true }
    );

    stage.addEventListener(
      "touchmove",
      (event) => {
        if (!gesture.active) return;
        const touch = event.touches[0];
        if (!touch) return;

        if (!gesture.axis) {
          const dx = touch.clientX - gesture.startX;
          const dy = touch.clientY - gesture.startY;
          if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
          gesture.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
        }

        if (gesture.axis === "y") return;

        event.preventDefault();
        applyInteraction(touch.clientX, touch.clientY, { pan: true, wipe: true });
      },
      { passive: false }
    );

    stage.addEventListener("touchend", resetGesture, { passive: true });
    stage.addEventListener("touchcancel", resetGesture, { passive: true });
  } else {
    function onPointer(e) {
      applyInteraction(e.clientX, e.clientY, { pan: true, wipe: true });
    }

    function onPointerDown(e) {
      onPointer(e);
      tryPersonBubble();
    }

    canvas.addEventListener("pointermove", onPointer);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener(
      "pointerleave",
      () => {
        state.hasPointer = false;
      },
      { passive: true }
    );
  }

  function drawPhotoBase(clear) {
    const rainOk = rainImg.complete && rainImg.naturalWidth > 0;
    const clearOk = clearImg.complete && clearImg.naturalWidth > 0;

    if (rainOk) {
      const r = coverRect(rainImg);
      ctx.drawImage(rainImg, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
    } else {
      ctx.fillStyle = "#5a6670";
      ctx.fillRect(0, 0, state.w, state.h);
    }

    // 맑아질수록 두 번째 사진으로 크로스페이드 + 채도/밝기
    if (clearOk && clear > 0.02) {
      const r = coverRect(clearImg);
      ctx.save();
      ctx.globalAlpha = clear;
      ctx.filter = `saturate(${1 + clear * 0.45}) brightness(${1 + clear * 0.12}) contrast(${1 + clear * 0.08})`;
      ctx.drawImage(clearImg, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
      ctx.restore();
    }

    // 비 올 때 원경 안개 베일 (건물 쪽)
    const fog = 1 - clear;
    if (fog > 0.02) {
      const g = ctx.createLinearGradient(0, state.h * 0.18, 0, state.h * 0.55);
      g.addColorStop(0, `rgba(160, 170, 180, ${0.22 * fog})`);
      g.addColorStop(0.55, `rgba(150, 160, 170, ${0.38 * fog})`);
      g.addColorStop(1, `rgba(140, 150, 160, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, state.w, state.h * 0.58);
    }
  }

  /** 하단 30% · 왼쪽 35% 제외 구간에만 사인 오프셋으로 물결감 */
  function drawWaveDistortion(clear) {
    const y0 = Math.floor(state.h * 0.7);
    const y1 = state.h;
    const x0 = Math.floor(state.w * 0.35);
    if (y1 <= y0 || x0 >= state.w) return;

    // 캔버스 비트맵 → 오프스크린(CSS 픽셀) 복사 후 물결로 되그림
    waveCtx.setTransform(1, 0, 0, 1, 0, 0);
    waveCtx.clearRect(0, 0, state.w, state.h);
    waveCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, state.w, state.h);

    const amp = lerp(2.8, 1.2, clear);
    const step = 3;
    const ww = state.w - x0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, ww, y1 - y0);
    ctx.clip();
    for (let y = y0; y < y1; y += step) {
      const depth = (y - y0) / (y1 - y0);
      const shift =
        Math.sin(y * 0.045 + state.t * 2.1) * amp * (0.35 + depth) +
        Math.sin(y * 0.11 - state.t * 1.4) * amp * 0.45;
      ctx.drawImage(waveCanvas, x0, y, ww, step, x0 + shift, y, ww, step);
    }

    const bands = 7;
    for (let i = 0; i < bands; i += 1) {
      const yy = y0 + 24 + i * ((y1 - y0) / (bands + 1));
      ctx.beginPath();
      for (let x = x0; x <= state.w; x += 8) {
        const wave =
          Math.sin(x * 0.014 + state.t * 1.6 + i) * lerp(5.5, 2.5, clear) +
          Math.sin(x * 0.03 - state.t + i * 1.3) * 1.8;
        const y = yy + wave;
        if (x === x0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(220, 235, 245, ${0.07 + clear * 0.08})`;
      ctx.lineWidth = 1.15;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 구름 크기·왼쪽 크롭 — 화면이 줄어도 이미지 평면(fitW) 기준 유지 */
  function cloudCoverMetrics() {
    const img =
      rainImg.naturalWidth > 0
        ? rainImg
        : clearImg.naturalWidth > 0
          ? clearImg
          : null;
    if (!img) return { refW: Math.max(1, state.w), leftCrop: 0 };
    const cover = coverRect(img);
    return {
      refW: Math.max(state.w, cover.planeDw || state.w),
      leftCrop: cover.leftCrop || 0,
    };
  }

  function drawClouds(clear) {
    const dens = 1 - clear * 0.95;
    if (dens < 0.02) return;

    const rockPx = state.w * ROCK_CLEAR_X;
    const span = 1.15 - ROCK_CLEAR_X;
    const { refW, leftCrop } = cloudCoverMetrics();
    // 왼쪽 크롭 비율에 비례해, 구름영역 아래 30%는 최대 30px 오른쪽
    const cropT = clamp(leftCrop / Math.max(170, leftCrop, 1), 0, 1);
    const midY0 = CLOUD_Y0 + CLOUD_YH * 0.4;
    const bottomY0 = CLOUD_Y0 + CLOUD_YH * 0.7;

    for (const c of clouds) {
      const drift = ((c.x - ROCK_CLEAR_X + state.t * c.drift * 0.015) % span + span) % span;
      let cx = (ROCK_CLEAR_X + drift) * state.w + 50;
      const cy = c.y * state.h;
      const r = c.r * refW;
      const sprite = c.sprite;
      // 바위 여백을 먼저 맞춘 뒤, 왼쪽 이동을 나중에 적용해야 이동이 남는다
      const clearX = c.shiftTop20 ? Math.max(0, rockPx - 30) : rockPx;
      const left = cx + sprite.minX * r;
      if (left < clearX) cx += clearX - left;
      if (c.shiftTop40) cx -= 50;
      if (c.shiftTop30) cx -= 40;
      if (c.shiftTop10) cx -= 20;
      if (c.y >= bottomY0) cx += 30 * cropT;

      let hole = 0;
      for (const w of state.wipeTrail) {
        const dx = (cx / state.w - w.x) * 1.35;
        const dy = (cy / state.h - w.y) * 2.1;
        hole = Math.max(hole, clamp(1 - Math.hypot(dx, dy) / 0.24, 0, 1) * w.life);
      }

      let alpha = dens * c.soft * (1 - hole * 0.97) * (1 - clear * 0.25);
      // 상단 40% → 40%, 가운데 30% → 30%, 하단 30% → 20%
      if (c.y >= bottomY0) alpha *= 0.2;
      else if (c.y >= midY0) alpha *= 0.3;
      else alpha *= 0.4;
      if (alpha < 0.02) continue;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(
        sprite.canvas,
        cx + sprite.minX * r,
        cy + sprite.minY * r,
        sprite.w * r,
        sprite.h * r
      );
      ctx.restore();
    }
  }

  function drawRain(clear) {
    const intensity = 1 - clear;
    if (intensity < 0.04) return;

    const count = Math.floor(drops.length * intensity);
    const splashY0 = state.h * 0.7;
    const splashYH = state.h * 0.3;
    ctx.strokeStyle = `rgba(210, 222, 232, ${0.2 + intensity * 0.28})`;

    for (let i = 0; i < count; i += 1) {
      const d = drops[i];
      d.y += d.sp * 0.017 * (0.75 + intensity);
      d.x += 0.0012;
      if (d.y > 1.08) {
        d.y = -0.05;
        d.x = rnd();
        if (splashes.length < MAX_SPLASH && rnd() < 0.5 * intensity) {
          splashes.push({
            x: d.x * state.w,
            y: splashY0 + rnd() * splashYH,
            r: 0.4,
            life: 1,
          });
        }
      }
      if (d.x > 1.1) d.x = -0.05;

      const x = d.x * state.w;
      const y = d.y * state.h;
      ctx.lineWidth = d.thick;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 1.1, y + d.len * intensity);
      ctx.stroke();
    }

    for (let i = splashes.length - 1; i >= 0; i -= 1) {
      const s = splashes[i];
      s.r += 0.32;
      s.life -= 0.05;
      if (s.life <= 0) {
        splashes.splice(i, 1);
        continue;
      }
      ctx.strokeStyle = `rgba(225, 238, 245, ${0.4 * s.life * intensity})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, s.r * 1.7, s.r * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function roundRectPath(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawSpeechBubble(x, y, text, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '600 13px "Pretendard", "Noto Sans KR", sans-serif';
    const padX = 10;
    const padY = 7;
    const tw = ctx.measureText(text).width;
    const bw = tw + padX * 2;
    const bh = 26;
    let bx = x - bw / 2;
    bx = clamp(bx, 8, state.w - bw - 8);
    const by = y - bh - 10;

    ctx.fillStyle = "rgba(255, 252, 248, 0.94)";
    ctx.strokeStyle = "rgba(30, 40, 48, 0.22)";
    ctx.lineWidth = 1;
    roundRectPath(bx, by, bw, bh, 10);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x - 5, by + bh);
    ctx.lineTo(x, by + bh + 7);
    ctx.lineTo(x + 5, by + bh);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#1a242c";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(text, bx + bw / 2, by + bh / 2 + 0.5);
    ctx.restore();
  }

  function drawBubbles() {
    const now = performance.now();
    for (const p of rainyPeople) {
      if (!p.bubble) continue;
      if (now >= p.bubble.until) {
        p.bubble = null;
        continue;
      }
      const pos = personScreenPos(p);
      const remain = p.bubble.until - now;
      const fade = remain < 800 ? remain / 800 : 1;
      const head = pos.y - (p.umbrella ? 36 : 26) * pos.s;
      drawSpeechBubble(pos.x, head, p.bubble.text, fade);
    }
    for (const p of clearPeople) {
      if (!p.bubble) continue;
      if (now >= p.bubble.until) {
        p.bubble = null;
        continue;
      }
      const pos = personScreenPos(p);
      const remain = p.bubble.until - now;
      const fade = remain < 800 ? remain / 800 : 1;
      const head = pos.y - 26 * pos.s;
      drawSpeechBubble(pos.x, head, p.bubble.text, fade);
    }
  }

  function drawPerson(p, umbrella, alpha) {
    const pos = personScreenPos(p);
    const s = pos.s;

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.scale(p.dir * s, s);
    ctx.globalAlpha = alpha;

    ctx.strokeStyle = "#1a2228";
    ctx.lineWidth = 1.5;
    const stride = Math.sin(state.t * 6.5 + p.phase) * 3.5;
    ctx.beginPath();
    ctx.moveTo(-2, 0);
    ctx.lineTo(-3 - stride, 9);
    ctx.moveTo(2, 0);
    ctx.lineTo(3 + stride, 9);
    ctx.stroke();

    ctx.fillStyle = `hsl(${p.hue} 30% ${lerp(30, 44, state.clear)}%)`;
    ctx.fillRect(-3.5, -13, 7, 13);

    ctx.fillStyle = "#d7c4a8";
    ctx.beginPath();
    ctx.arc(0, -16.5, 2.8, 0, Math.PI * 2);
    ctx.fill();

    if (umbrella) {
      ctx.fillStyle = `hsl(${(p.hue + 50) % 360} 48% 40%)`;
      ctx.beginPath();
      ctx.arc(0, -26, 10, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(0, -26);
      ctx.lineTo(0, -8);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawPeople(clear) {
    const rainCount = 1 + Math.floor(clamp(1 - clear, 0, 1) * 3);
    const clearCount = 10 + Math.floor(clear * 5);
    const showRain = clear < 0.72;
    const showClear = clear > 0.28;

    if (showRain) {
      const alpha = clamp(1 - (clear - 0.35) / 0.4, 0, 1);
      for (let i = 0; i < rainCount; i += 1) {
        const p = rainyPeople[i];
        stepPerson(p);
        drawPerson(p, true, alpha);
      }
    }

    if (showClear) {
      const alpha = clamp((clear - 0.28) / 0.45, 0, 1);
      for (let i = 0; i < clearCount; i += 1) {
        const p = clearPeople[i];
        stepPerson(p);
        drawPerson(p, false, alpha);
      }
    }
  }

  function drawCursor() {
    /* 시스템 손모양 커서(pointer) 사용 */
  }

  function updateRainCountdown(now) {
    if (!rainCountdownEl || !rainSecEl) return;
    if (!state.clearHoldStartedAt) {
      rainCountdownEl.hidden = true;
      return;
    }
    const remainMs = Math.max(0, CLEAR_HOLD_MS - (now - state.clearHoldStartedAt));
    const sec = Math.max(1, Math.ceil(remainMs / 1000));
    rainSecEl.textContent = String(sec);
    rainCountdownEl.hidden = false;
  }

  function updateUi(clear, now = performance.now()) {
    if (meterEl) meterEl.style.width = `${Math.round(clear * 100)}%`;
    if (weatherEl) {
      weatherEl.textContent =
        clear < 0.25
          ? "추적추적 비"
          : clear < 0.55
            ? "구름이 걷히는 중"
            : clear < 0.85
              ? "비가 잦아드는 중"
              : "맑은 갓바위";
    }
    if (hintEl) {
      if (clear >= 0.92) {
        hintEl.textContent = "비가 그쳤습니다 · 아래로 스크롤해 이야기를 읽어 보세요";
        hintEl.classList.add("is-done");
      } else {
        hintEl.textContent = touchUi
          ? "좌우로 밀며 구름을 쓸어 걷어내 보세요"
          : "마우스로 구름을 쓸어 걷어내 보세요";
        hintEl.classList.remove("is-done");
      }
    }
    updateRainCountdown(now);
  }

  function frame(now) {
    if (!state.ready) return;
    state.t = now * 0.001;
    state.clear = lerp(state.clear, state.targetClear, 0.055);
    state.pan = lerp(state.pan, state.targetPan, reduceMotion ? 1 : 0.14);
    if (state.targetClear < 0.98) {
      state.targetClear = clamp(state.targetClear - 0.0007, 0, 1);
    }

    for (const w of state.wipeTrail) w.life *= 0.93;
    state.wipeTrail = state.wipeTrail.filter((w) => w.life > 0.04);

    const clear = state.clear;

    // 구름이 걷힌 상태를 20초 유지한 뒤 비로 되돌린다.
    if (clear >= CLEAR_HOLD_THRESHOLD && state.targetClear >= CLEAR_HOLD_THRESHOLD) {
      if (!state.clearHoldStartedAt) state.clearHoldStartedAt = now;
      else if (now - state.clearHoldStartedAt >= CLEAR_HOLD_MS) {
        state.targetClear = 0;
        state.wipeTrail = [];
        state.clearHoldStartedAt = 0;
      }
    } else if (clear < 0.45) {
      state.clearHoldStartedAt = 0;
    }

    // 구름이 걷히면(맑음 쪽) 떠 있던 말풍선 전부 제거
    if (state.cloudsWereHeavy && clear >= 0.55) {
      clearAllBubbles();
      state.cloudsWereHeavy = false;
    }
    if (clear < 0.3) state.cloudsWereHeavy = true;

    ctx.clearRect(0, 0, state.w, state.h);

    drawPhotoBase(clear);
    if (!reduceMotion) drawWaveDistortion(clear);
    drawClouds(clear);
    drawPeople(clear);
    drawRain(clear);
    drawBubbles();
    drawCursor();
    updateUi(clear, now);

    if (!reduceMotion) requestAnimationFrame(frame);
  }

  window.addEventListener("resize", () => {
    resize();
    if (reduceMotion && state.ready) {
      state.clear = state.targetClear;
      requestAnimationFrame(frame);
    }
  });

  resize();
  updateUi(0);
})();
