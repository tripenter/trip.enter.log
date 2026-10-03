(() => {
  const stage = document.querySelector("[data-stage]");
  if (!stage) return;

  const skyCanvas = stage.querySelector("[data-sky]");
  const waterCanvas = stage.querySelector("[data-water]");
  const airCanvas = stage.querySelector("[data-air]");
  const sceneEl = stage.querySelector("[data-scene]");
  const figureEl = stage.querySelector("[data-figure]");
  const spotLayer = stage.querySelector("[data-hotspots]");
  const clockTimeEl = stage.querySelector("[data-clock-time]");
  const clockPhaseEl = stage.querySelector("[data-clock-phase]");
  const hintEl = stage.querySelector("[data-hint]");
  const questCountEl = stage.querySelector("[data-quest-count]");
  const questTotalEl = stage.querySelector("[data-quest-total]");
  const rewardEl = stage.querySelector("[data-reward]");

  const sky = skyCanvas.getContext("2d");
  const water = waterCanvas.getContext("2d");
  const air = airCanvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 좌표는 모두 배경 원화(2560x970) 기준 0~1 비율이다.
  const ART = { w: 2560, h: 970 };
  const RIDGE = 0.1;
  const DAY_END = 0.79;

  const SPOTS = [
    {
      nx: 0.355,
      ny: 0.15,
      tag: "cliff",
      title: "육륙봉",
      text: "강 건너에 솟은 암벽. 한반도를 빼닮은 생김새로 청령포를 명승으로 만든 얼굴입니다.",
    },
    {
      nx: 0.51,
      ny: 0.27,
      tag: "pine",
      title: "관음송",
      text: "단종의 유배를 지켜보고 그 오열을 들었다 하여 관음송이라 부릅니다. 솔숲에서 가장 오래된 나무입니다.",
    },
    {
      nx: 0.3,
      ny: 0.56,
      tag: "stone",
      title: "단묘유지비",
      text: "단종이 머물던 집터를 알리는 비석입니다. 어린 임금이 앉아 있던 자리를 후대가 돌에 적어 두었습니다.",
    },
    {
      nx: 0.72,
      ny: 0.55,
      tag: "hill",
      title: "노산대",
      text: "단종이 한양 쪽 하늘을 바라보며 눈물을 흘렸다고 전해지는 언덕입니다.",
    },
    {
      nx: 0.63,
      ny: 0.64,
      tag: "mark",
      title: "금표비",
      text: "이 안으로는 누구도 드나들지 못하게 금한 표석입니다. 물이 끊은 길을 돌이 한 번 더 끊었습니다.",
    },
    {
      nx: 0.22,
      ny: 0.6,
      tag: "cairn",
      title: "돌탑",
      text: "청령포를 찾은 이들이 단종의 넋을 기리며 하나씩 올려 둔 돌탑입니다.",
    },
    {
      nx: 0.07,
      ny: 0.7,
      tag: "river",
      title: "서강",
      text: "동·남·북 삼면을 감싸 도는 강. 물이 길을 끊어 이곳은 섬이 아니면서 섬이 되었습니다.",
    },
  ];

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const toRgb = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const hex = (c) =>
    `#${[c[0], c[1], c[2]].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("")}`;
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  // 가로로 길게 눕힌 부드러운 빛 덩어리. 경계선이 생기지 않게 원형 그라데이션을 눌러서 쓴다.
  function softBlob(ctx, x, y, rx, ry, color, alpha, core = 0) {
    if (alpha <= 0.002 || rx <= 0 || ry <= 0) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, rgba(color, alpha));
    if (core > 0) g.addColorStop(core, rgba(color, alpha * 0.55));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const KEYS = [
    { at: 0, top: "#16203c", mid: "#4b4a73", low: "#d98a74", body: "#ff7a3c", grade: "#5b6392", gradeA: 0.5, bright: 0.76, sat: 0.85, night: 0.45 },
    { at: 0.07, top: "#4e75a8", mid: "#c58fa0", low: "#ffc38a", body: "#ff9a46", grade: "#d98f6a", gradeA: 0.44, bright: 0.95, sat: 1.05, night: 0.1 },
    { at: 0.2, top: "#7bb3df", mid: "#bcdcef", low: "#f3f7f3", body: "#fff0bd", grade: "#f6efdd", gradeA: 0.26, bright: 1, sat: 0.95, night: 0 },
    { at: 0.45, top: "#6fb0e8", mid: "#a9d6f2", low: "#e6f3f7", body: "#ffffff", grade: "#eef1ea", gradeA: 0.2, bright: 1.01, sat: 0.9, night: 0 },
    { at: 0.62, top: "#79b0dd", mid: "#cdd8e8", low: "#ffdfae", body: "#ffe39a", grade: "#ffe3b8", gradeA: 0.34, bright: 0.98, sat: 1, night: 0 },
    { at: 0.73, top: "#51618f", mid: "#c47a6e", low: "#ff9f5e", body: "#ff7b3a", grade: "#ff9f6b", gradeA: 0.5, bright: 0.9, sat: 1.12, night: 0.08 },
    { at: 0.8, top: "#2b3760", mid: "#6d4e70", low: "#c9705f", body: "#e0603a", grade: "#7b6d9c", gradeA: 0.55, bright: 0.72, sat: 0.9, night: 0.42 },
    { at: 0.88, top: "#0d1733", mid: "#1b2a4d", low: "#2f4164", body: "#93b6e8", grade: "#3d5590", gradeA: 0.66, bright: 0.5, sat: 0.6, night: 0.92 },
    { at: 1, top: "#16203c", mid: "#4b4a73", low: "#d98a74", body: "#ff7a3c", grade: "#5b6392", gradeA: 0.5, bright: 0.76, sat: 0.85, night: 0.45 },
  ].map((k) => ({
    ...k,
    top: toRgb(k.top),
    mid: toRgb(k.mid),
    low: toRgb(k.low),
    body: toRgb(k.body),
    grade: toRgb(k.grade),
  }));

  function palette(p) {
    let i = 0;
    while (i < KEYS.length - 2 && p >= KEYS[i + 1].at) i += 1;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const t = clamp((p - a.at) / (b.at - a.at), 0, 1);
    return {
      top: mix(a.top, b.top, t),
      mid: mix(a.mid, b.mid, t),
      low: mix(a.low, b.low, t),
      body: mix(a.body, b.body, t),
      grade: mix(a.grade, b.grade, t),
      gradeA: lerp(a.gradeA, b.gradeA, t),
      bright: lerp(a.bright, b.bright, t),
      sat: lerp(a.sat, b.sat, t),
      night: lerp(a.night, b.night, t),
    };
  }

  const view = {
    w: 0,
    h: 0,
    dpr: 1,
    left: 0,
    top: 0,
    sw: 0,
    sh: 0,
    horizon: 0,
    rise: 0,
    overflow: 0,
    maxPan: 0,
    panX: 0,
    panY: 0,
    figLeft: 0,
    figWidth: 0,
  };

  const state = {
    p: 0.04,
    target: 0.04,
    auto: !reduceMotion,
    idle: 0,
    px: 0.86,
    py: 0.5,
    sx: 0.86,
    sy: 0.5,
    wind: 0,
    time: 0,
    found: 0,
    travel: 0,
    hint: 0,
    rewardLock: false,
    completed: false,
  };

  const rnd = (() => {
    let seed = 20081231;
    return () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
  })();

  const stars = Array.from({ length: 170 }, () => ({
    x: rnd(),
    y: rnd() * 0.78,
    r: 0.5 + rnd() * 1.5,
    tw: rnd() * Math.PI * 2,
    sp: 0.6 + rnd() * 1.8,
  }));

  const clouds = Array.from({ length: 7 }, (_, i) => ({
    x: rnd(),
    y: 0.12 + rnd() * 0.6,
    w: 0.16 + rnd() * 0.26,
    h: 0.03 + rnd() * 0.05,
    sp: 0.004 + rnd() * 0.008,
    depth: 0.3 + (i / 7) * 0.7,
  }));

  const motes = Array.from({ length: 70 }, () => ({
    x: rnd(),
    y: rnd(),
    r: 0.7 + rnd() * 1.9,
    vx: -0.01 + rnd() * 0.02,
    vy: -0.004 - rnd() * 0.012,
    ph: rnd() * Math.PI * 2,
  }));

  const flies = Array.from({ length: 40 }, () => ({
    x: rnd(),
    y: 0.45 + rnd() * 0.5,
    ph: rnd() * Math.PI * 2,
    sp: 0.4 + rnd() * 0.9,
    r: 1 + rnd() * 1.6,
    blink: rnd() * Math.PI * 2,
  }));

  const ripples = [];
  const lanterns = [];

  function isWater(nx, ny) {
    if (ny < 0.5 || ny > 0.87) return false;
    if (ny >= 0.7) {
      if (nx < 0.02 || nx > 0.98) return false;
      return !(nx > 0.4 && nx < 0.56);
    }
    if (ny >= 0.66) return nx < 0.18 || nx > 0.82;
    return nx < 0.13 || nx > 0.86;
  }

  function resize() {
    view.w = stage.clientWidth;
    view.h = stage.clientHeight;
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);

    [
      [skyCanvas, sky],
      [waterCanvas, water],
      [airCanvas, air],
    ].forEach(([canvas, ctx]) => {
      canvas.width = Math.round(view.w * view.dpr);
      canvas.height = Math.round(view.h * view.dpr);
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    });

    // 좌우 끝으로 마우스를 밀어도 산 배경이 화면을 덮도록, 패닝 여유만큼 더 키운다.
    const coverScale = Math.max(view.w / ART.w, (view.h * 0.68) / ART.h);
    const panBudget = Math.max(56, view.w * 0.08);
    const minSw = view.w + panBudget * 2;
    view.sw = Math.max(ART.w * coverScale, minSw);
    view.sh = view.sw * (ART.h / ART.w);
    if (view.sh < view.h * 0.62) {
      view.sh = view.h * 0.62;
      view.sw = view.sh * (ART.w / ART.h);
    }
    view.left = (view.w - view.sw) / 2;
    view.top = view.h - view.sh + Math.min(20, view.sh * 0.02);
    view.horizon = view.top + view.sh * RIDGE;
    view.rise = Math.max(view.horizon - 92, 86);

    // 패닝 가능한 최대치 = 한쪽 넘침. 이보다 크게 밀면 가장자리가 비게 된다.
    view.overflow = Math.max(0, view.sw - view.w);
    view.maxPan = view.overflow / 2;

    sceneEl.style.left = `${view.left}px`;
    sceneEl.style.top = `${view.top}px`;
    sceneEl.style.width = `${view.sw}px`;
    sceneEl.style.height = `${view.sh}px`;
    stage.style.setProperty("--horizon", `${view.horizon}px`);

    view.figLeft = figureEl.offsetLeft;
    view.figWidth = figureEl.offsetWidth;
    placeSpots();
  }

  function placeSpots() {
    spotLayer.querySelectorAll(".hotspot").forEach((el, i) => {
      const spot = SPOTS[i];
      el.style.left = `${view.left + spot.nx * view.sw}px`;
      el.style.top = `${view.top + spot.ny * view.sh}px`;
    });
  }

  function buildSpots() {
    const frag = document.createDocumentFragment();
    SPOTS.forEach((spot, i) => {
      const el = document.createElement("div");
      el.className = "hotspot";
      el.dataset.align = spot.nx < 0.2 ? "start" : spot.nx > 0.8 ? "end" : "center";
      if (spot.ny < 0.3) el.dataset.flip = "down";

      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "hotspot-dot";
      dot.textContent = spot.title;

      const card = document.createElement("div");
      card.className = "hotspot-card";
      card.innerHTML = `<span class="card-tag font-mono">${spot.tag}</span><h3 class="font-display">${spot.title}</h3><p>${spot.text}</p>`;

      const discover = () => {
        if (el.classList.contains("is-found")) return;
        el.classList.add("is-found");
        state.found += 1;
        questCountEl.textContent = String(state.found);
        if (state.found === SPOTS.length) complete();
        else if (state.hint < 3) setHint(3, "찾은 자리는 금빛으로 남습니다");
      };

      const showCard = () => {
        if (state.rewardLock) return;
        spotLayer.querySelectorAll(".hotspot.is-open").forEach((other) => {
          if (other !== el) other.classList.remove("is-open");
        });
        el.classList.add("is-open");
        discover();
      };

      const hideCard = () => {
        el.classList.remove("is-open");
      };

      el.addEventListener("pointerenter", showCard);
      el.addEventListener("pointerleave", hideCard);
      dot.addEventListener("focus", showCard);
      dot.addEventListener("blur", hideCard);

      el.append(dot, card);
      frag.appendChild(el);
      SPOTS[i].el = el;
    });
    spotLayer.appendChild(frag);
    questTotalEl.textContent = String(SPOTS.length);
  }

  function complete() {
    if (state.completed) return;
    state.completed = true;
    state.rewardLock = true;

    spotLayer.querySelectorAll(".hotspot.is-open").forEach((el) => {
      el.classList.remove("is-open");
    });
    rewardEl.classList.add("is-shown");
    setHint(4, "밤이 오면 강에 등불이 흐릅니다");

    window.setTimeout(() => {
      rewardEl.classList.remove("is-shown");
      // 페이드가 끝난 뒤 포인트 설명을 다시 허용한다.
      window.setTimeout(() => {
        state.rewardLock = false;
      }, reduceMotion ? 0 : 1200);
    }, 10000);

    if (reduceMotion) return;
    for (let i = 0; i < 20; i += 1) {
      lanterns.push({
        x: 0.1 + Math.random() * 0.8,
        y: 0.98 + Math.random() * 0.3,
        r: 2 + Math.random() * 2.6,
        sp: 0.02 + Math.random() * 0.03,
        ph: Math.random() * Math.PI * 2,
      });
    }
  }

  function setHint(level, text) {
    if (state.hint >= level) return;
    state.hint = level;
    hintEl.style.opacity = "0";
    window.setTimeout(() => {
      hintEl.textContent = text;
      hintEl.style.opacity = "1";
    }, 260);
  }

  function spawnRipple(nx, ny, strength) {
    if (reduceMotion || ripples.length > 70) return;
    ripples.push({ nx, ny, r: 2, max: 34 + strength * 90, a: 0.5 + strength * 0.3 });
  }

  function sunAt(p) {
    const t = clamp(p / DAY_END, 0, 1);
    const alt = Math.sin(Math.PI * t);
    return {
      x: lerp(view.w * 0.955, view.w * 0.045, t),
      y: view.horizon + 16 - alt * view.rise,
      alt,
      vis: 1 - smooth(DAY_END - 0.015, DAY_END + 0.035, p),
    };
  }

  function moonAt(p) {
    const t = clamp((p - 0.74) / 0.28, 0, 1);
    const alt = Math.sin(Math.PI * t);
    return {
      x: lerp(view.w * 0.95, view.w * 0.06, t),
      y: view.horizon + 14 - alt * view.rise * 0.78,
      alt,
      vis: smooth(0.76, 0.86, p),
    };
  }

  function drawSky(pal, sun, moon) {
    const horizon = view.horizon;
    const grad = sky.createLinearGradient(0, 0, 0, horizon + 2);
    grad.addColorStop(0, rgba(pal.top, 1));
    grad.addColorStop(0.55, rgba(pal.mid, 1));
    grad.addColorStop(1, rgba(pal.low, 1));
    sky.fillStyle = grad;
    sky.fillRect(0, 0, view.w, horizon + 2);
    sky.fillStyle = rgba(pal.low, 1);
    sky.fillRect(0, horizon, view.w, view.h - horizon);

    if (pal.night > 0.02) {
      const drift = (state.sx - 0.5) * 16;
      stars.forEach((s) => {
        const tw = 0.45 + 0.55 * Math.sin(state.time * s.sp + s.tw);
        sky.globalAlpha = clamp(pal.night * tw * 0.95, 0, 1);
        sky.fillStyle = "#fdfbff";
        sky.beginPath();
        sky.arc(s.x * view.w + drift, s.y * horizon, s.r, 0, Math.PI * 2);
        sky.fill();
      });
      sky.globalAlpha = 1;
    }

    clouds.forEach((c) => {
      const cx =
        (((c.x + state.time * c.sp) % 1.3) - 0.15) * view.w - (state.sx - 0.5) * 42 * c.depth;
      const cy = c.y * horizon * 0.86 - (state.sy - 0.5) * 12 * c.depth;
      const lit = clamp(sun.alt * sun.vis, 0, 1);
      const tint = mix(mix(pal.low, [255, 255, 255], lit * 0.7), pal.mid, 0.25);
      softBlob(
        sky,
        cx,
        cy,
        c.w * view.w,
        c.h * horizon * 1.6,
        tint,
        0.4 * (1 - pal.night * 0.6),
        0.45
      );
    });

    sky.globalCompositeOperation = "lighter";

    if (sun.vis > 0.01) {
      const glow = sky.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, view.w * 0.42);
      glow.addColorStop(0, rgba(pal.body, 0.5 * sun.vis));
      glow.addColorStop(0.18, rgba(pal.body, 0.2 * sun.vis));
      glow.addColorStop(1, rgba(pal.body, 0));
      sky.fillStyle = glow;
      sky.fillRect(0, 0, view.w, view.h);

      const r = lerp(34, 22, sun.alt);
      const disc = sky.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, r);
      disc.addColorStop(0, rgba(mix(pal.body, [255, 255, 255], 0.18 + sun.alt * 0.45), sun.vis));
      disc.addColorStop(0.75, rgba(pal.body, sun.vis));
      disc.addColorStop(1, rgba(pal.body, 0));
      sky.fillStyle = disc;
      sky.beginPath();
      sky.arc(sun.x, sun.y, r, 0, Math.PI * 2);
      sky.fill();
    }

    if (moon.vis > 0.01) {
      const mc = [236, 243, 255];
      const glow = sky.createRadialGradient(moon.x, moon.y, 0, moon.x, moon.y, view.w * 0.18);
      glow.addColorStop(0, rgba(mc, 0.24 * moon.vis));
      glow.addColorStop(1, rgba(mc, 0));
      sky.fillStyle = glow;
      sky.fillRect(0, 0, view.w, view.h);

      const disc = sky.createRadialGradient(
        moon.x - 4,
        moon.y - 4,
        2,
        moon.x,
        moon.y,
        15
      );
      disc.addColorStop(0, rgba([255, 255, 255], 0.98 * moon.vis));
      disc.addColorStop(0.82, rgba(mc, 0.82 * moon.vis));
      disc.addColorStop(1, rgba(mc, 0));
      sky.fillStyle = disc;
      sky.beginPath();
      sky.arc(moon.x, moon.y, 15, 0, Math.PI * 2);
      sky.fill();
    }

    const hazeA = 0.22 * (0.3 + sun.vis * 0.7);
    const haze = sky.createLinearGradient(0, horizon - view.rise * 0.5, 0, horizon);
    haze.addColorStop(0, rgba(pal.body, 0));
    haze.addColorStop(1, rgba(pal.body, hazeA));
    sky.fillStyle = haze;
    sky.fillRect(0, horizon - view.rise * 0.5, view.w, view.rise * 0.5);
    sky.fillStyle = rgba(pal.body, hazeA);
    sky.fillRect(0, horizon, view.w, view.h - horizon);

    sky.globalCompositeOperation = "source-over";
  }

  function grade(pal, sun, moon) {
    const style = stage.style;
    style.setProperty("--art-bright", pal.bright.toFixed(3));
    style.setProperty("--art-contrast", (1.04 + (1 - pal.night) * 0.08).toFixed(3));
    style.setProperty("--art-sat", pal.sat.toFixed(3));
    style.setProperty("--grade", hex(pal.grade));
    style.setProperty("--grade-a", pal.gradeA.toFixed(3));

    const light = sun.vis > moon.vis ? sun : moon;
    const lightColor = sun.vis > moon.vis ? pal.body : [190, 212, 255];
    style.setProperty("--light-x", `${(((light.x - view.left) / view.sw) * 100).toFixed(1)}%`);
    style.setProperty("--light-y", `${(((light.y - view.top) / view.sh) * 100).toFixed(1)}%`);
    style.setProperty("--light-color", hex(lightColor));
    style.setProperty(
      "--light-a",
      (sun.vis > moon.vis ? 0.18 + (1 - sun.alt) * 0.42 * sun.vis : 0.2 * moon.vis).toFixed(3)
    );

    const figLeft = view.figLeft;
    const relX = clamp(((light.x - figLeft) / view.figWidth) * 100, -70, 170);
    style.setProperty("--rim-x", `${relX.toFixed(1)}%`);
    style.setProperty(
      "--rim-a",
      (sun.vis > moon.vis ? 0.3 + sun.alt * 0.35 : 0.26 * moon.vis).toFixed(3)
    );

    const figCenter = figLeft + view.figWidth * 0.6;
    const byDay = sun.vis > moon.vis;
    const lowness = 1 - clamp(byDay ? sun.alt : moon.alt * 0.7, 0, 1);
    const dir = clamp((figCenter - light.x) / view.w, -1, 1);
    style.setProperty("--shadow-dx", `${(dir * 70 * (0.4 + lowness)).toFixed(1)}px`);
    style.setProperty("--shadow-sx", (1 + lowness * 1.4).toFixed(2));
    style.setProperty(
      "--shadow-a",
      (0.12 + (byDay ? sun.alt * sun.vis * 0.5 : moon.vis * 0.2)).toFixed(3)
    );
  }

  function drawWater(pal, sun, moon, dt) {
    water.clearRect(0, 0, view.w, view.h);

    const bandTop = view.top + view.panY + view.sh * 0.69;
    const bandBottom = view.top + view.panY + view.sh * 0.86;
    const light = sun.vis > moon.vis ? sun : moon;
    const lightColor = sun.vis > moon.vis ? pal.body : [204, 222, 255];
    const strength = sun.vis > moon.vis ? (0.6 + (1 - sun.alt) * 0.6) * sun.vis : 0.55 * moon.vis;

    if (strength > 0.02) {
      water.globalCompositeOperation = "lighter";
      const rows = 22;
      for (let i = 0; i < rows; i += 1) {
        const t = i / (rows - 1);
        const y = lerp(bandTop, bandBottom, t);
        const wob = Math.sin(state.time * 1.5 + t * 9) * (6 + t * 26);
        const rx = lerp(24, 110, t) * (0.7 + 0.3 * Math.sin(state.time * 2.2 + t * 5));
        softBlob(water, light.x + wob, y, rx, lerp(3, 8, t), lightColor, (1 - t) * 0.42 * strength);
      }
      water.globalCompositeOperation = "source-over";
    }

    for (let i = ripples.length - 1; i >= 0; i -= 1) {
      const rp = ripples[i];
      rp.r += dt * 60;
      rp.a *= 1 - dt * 0.95;
      if (rp.r > rp.max || rp.a < 0.02) {
        ripples.splice(i, 1);
        continue;
      }
      const x = view.left + view.panX + rp.nx * view.sw;
      const y = view.top + view.panY + rp.ny * view.sh;
      water.strokeStyle = rgba([255, 255, 255], Math.min(1, rp.a * 1.4));
      water.lineWidth = 2;
      water.beginPath();
      water.ellipse(x, y, rp.r, rp.r * 0.3, 0, 0, Math.PI * 2);
      water.stroke();
      water.strokeStyle = rgba([46, 62, 78], rp.a * 0.65);
      water.lineWidth = 1.2;
      water.beginPath();
      water.ellipse(x, y, rp.r * 0.68, rp.r * 0.2, 0, 0, Math.PI * 2);
      water.stroke();
    }

    const mist = clamp(0.07 + pal.night * 0.1 + (1 - state.sy) * 0.12 + state.wind * 0.05, 0, 0.3);
    const tint = mix([255, 255, 255], pal.low, 0.35);
    for (let i = 0; i < 9; i += 1) {
      const band = i % 3;
      const y = view.top + view.panY + view.sh * (0.6 + band * 0.11);
      const span = view.w * 0.42;
      const x =
        (((i / 9 + state.time * (0.009 + band * 0.004)) % 1.25) - 0.12) * view.w * 1.1;
      const rx = span * (0.6 + ((i * 7) % 5) / 10);
      const ry = view.sh * 0.05 * (1 + band * 0.2);
      softBlob(water, x, y, rx, ry, tint, mist * (1 - band * 0.2));
    }
  }

  function drawAir(pal, dt) {
    air.clearRect(0, 0, view.w, view.h);
    if (reduceMotion) return;

    const day = 1 - pal.night;
    if (day > 0.05) {
      air.globalCompositeOperation = "lighter";
      motes.forEach((m) => {
        m.x += (m.vx + state.wind * 0.06) * dt;
        m.y += m.vy * dt;
        if (m.x > 1.05) m.x = -0.05;
        if (m.x < -0.05) m.x = 1.05;
        if (m.y < -0.05) m.y = 1.02;
        const x = m.x * view.w + Math.sin(state.time * 0.8 + m.ph) * 12;
        const y = m.y * view.h;
        air.fillStyle = rgba(mix([255, 248, 224], pal.body, 0.4), 0.42 * day);
        air.beginPath();
        air.arc(x, y, m.r, 0, Math.PI * 2);
        air.fill();
      });
      air.globalCompositeOperation = "source-over";
    }

    const dark = smooth(0.25, 0.6, pal.night);
    if (dark > 0.02) {
      air.globalCompositeOperation = "lighter";
      flies.forEach((f) => {
        f.ph += dt * f.sp;
        f.blink += dt * (1.4 + f.sp);
        const pullX = (state.sx - f.x) * 0.1;
        const pullY = (state.sy - f.y) * 0.08;
        f.x = clamp(f.x + (Math.cos(f.ph) * 0.02 + pullX) * dt, 0, 1);
        f.y = clamp(f.y + (Math.sin(f.ph * 1.3) * 0.016 + pullY) * dt, 0.35, 1);
        const a = (0.35 + 0.65 * Math.max(0, Math.sin(f.blink))) * dark;
        const x = f.x * view.w;
        const y = f.y * view.h;
        const g = air.createRadialGradient(x, y, 0, x, y, f.r * 9);
        g.addColorStop(0, rgba([214, 255, 176], 0.85 * a));
        g.addColorStop(1, rgba([160, 255, 120], 0));
        air.fillStyle = g;
        air.beginPath();
        air.arc(x, y, f.r * 9, 0, Math.PI * 2);
        air.fill();
      });
      air.globalCompositeOperation = "source-over";
    }

    if (lanterns.length) {
      air.globalCompositeOperation = "lighter";
      for (let i = lanterns.length - 1; i >= 0; i -= 1) {
        const l = lanterns[i];
        l.y -= l.sp * dt;
        l.ph += dt * 0.8;
        if (l.y < -0.1) {
          lanterns.splice(i, 1);
          continue;
        }
        const x = l.x * view.w + Math.sin(l.ph) * 18;
        const y = l.y * view.h;
        const g = air.createRadialGradient(x, y, 0, x, y, l.r * 10);
        g.addColorStop(0, rgba([255, 214, 150], 0.9));
        g.addColorStop(1, rgba([255, 150, 70], 0));
        air.fillStyle = g;
        air.beginPath();
        air.arc(x, y, l.r * 10, 0, Math.PI * 2);
        air.fill();
      }
      air.globalCompositeOperation = "source-over";
    }
  }

  const PHASES = [
    [0.035, "동틀 무렵"],
    [0.1, "일출"],
    [0.3, "아침"],
    [0.55, "한낮"],
    [0.68, "늦은 오후"],
    [0.78, "일몰"],
    [0.86, "어스름"],
    [1.01, "밤"],
  ];

  let lastClock = "";

  function updateClock(p) {
    const minutes =
      p < DAY_END ? 330 + (p / DAY_END) * 840 : 1170 + ((p - DAY_END) / (1 - DAY_END)) * 600;
    const m = Math.round(minutes) % 1440;
    const label = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    if (label === lastClock) return;
    lastClock = label;
    clockTimeEl.textContent = label;
    clockPhaseEl.textContent = (PHASES.find(([edge]) => p < edge) || PHASES[PHASES.length - 1])[1];
  }

  function parallax() {
    // sx=0(왼쪽) → 배경을 오른쪽으로, sx=1(오른쪽) → 왼쪽으로. 최대 overflow/2까지만.
    view.panX = (0.5 - state.sx) * 2 * view.maxPan;
    view.panY = (state.sy - 0.5) * -8;
    const bob = reduceMotion ? 0 : Math.sin(state.time * 0.7) * 2.4;
    const move = `translate3d(${view.panX.toFixed(1)}px, ${view.panY.toFixed(1)}px, 0)`;
    sceneEl.style.transform = move;
    spotLayer.style.transform = move;
    figureEl.style.transform = `translate3d(${((0.5 - state.sx) * 18).toFixed(1)}px, ${(
      view.panY * 1.2 + bob
    ).toFixed(1)}px, 0)`;
  }

  let pointerX = null;
  let pointerY = null;
  let lastMove = { x: 0, y: 0, ok: false };

  function toArt(x, y) {
    return {
      nx: (x - view.left - view.panX) / view.sw,
      ny: (y - view.top - view.panY) / view.sh,
    };
  }

  function stagePoint(event) {
    const box = stage.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top, w: box.width, h: box.height };
  }

  function onPointer(event) {
    const { x, y, w, h } = stagePoint(event);
    if (x < 0 || y < 0 || x > w || y > h) return;

    if (lastMove.ok) {
      const d = Math.hypot(x - lastMove.x, y - lastMove.y);
      state.travel += d;
      state.wind = clamp(state.wind + d * 0.004, 0, 1.6);
      if (d > 20) {
        const art = toArt(x, y);
        if (isWater(art.nx, art.ny)) {
          spawnRipple(art.nx, art.ny, clamp(d / 90, 0.1, 1));
          setHint(2, "솔숲의 표식을 눌러 단종의 흔적을 찾아보세요");
        }
        lastMove = { x, y, ok: true };
      }
    } else {
      lastMove = { x, y, ok: true };
    }

    pointerX = x / w;
    pointerY = y / h;
    state.target = clamp(0.015 + (1 - pointerX) * 0.97, 0, 0.999);
    state.auto = false;
    state.idle = 0;
    if (state.travel > 900) setHint(1, "강 위를 쓸어 물결을 일으켜 보세요");
  }

  stage.addEventListener("pointermove", onPointer);
  stage.addEventListener("pointerdown", (event) => {
    onPointer(event);
    const { x, y } = stagePoint(event);
    const art = toArt(x, y);
    if (isWater(art.nx, art.ny)) {
      spawnRipple(art.nx, art.ny, 1);
      spawnRipple(art.nx, art.ny, 0.55);
      window.setTimeout(() => spawnRipple(art.nx, art.ny, 0.3), 130);
    }
  });
  stage.addEventListener("pointerleave", () => {
    lastMove.ok = false;
  });

  stage.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 0.08 : 0.025;
    if (event.key === "ArrowLeft") state.target = clamp(state.target + step, 0, 0.999);
    else if (event.key === "ArrowRight") state.target = clamp(state.target - step, 0, 0.999);
    else return;
    event.preventDefault();
    state.auto = false;
    state.idle = 0;
  });
  stage.tabIndex = 0;

  function step(dt) {
    state.time += dt;
    state.wind *= 1 - dt * 1.6;

    if (pointerX !== null) {
      state.sx += (pointerX - state.sx) * clamp(dt * 4.5, 0, 1);
      state.sy += (pointerY - state.sy) * clamp(dt * 4.5, 0, 1);
    }

    state.idle += dt;
    if (!state.auto && state.idle > 2.6 && !reduceMotion) state.auto = true;

    if (state.auto) {
      state.p = (state.p + dt * 0.034) % 1;
      state.target = state.p;
    } else {
      let diff = state.target - state.p;
      if (diff > 0.5) diff -= 1;
      if (diff < -0.5) diff += 1;
      state.p = (state.p + diff * clamp(dt * 5, 0, 1) + 1) % 1;
    }
  }

  let raf = 0;
  let last = performance.now();

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    step(dt);

    const pal = palette(state.p);
    const sun = sunAt(state.p);
    const moon = moonAt(state.p);

    parallax();
    drawSky(pal, sun, moon);
    grade(pal, sun, moon);
    drawWater(pal, sun, moon, dt);
    drawAir(pal, dt);
    updateClock(state.p);

    raf = requestAnimationFrame(frame);
  }

  function start() {
    cancelAnimationFrame(raf);
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else start();
  });

  window.addEventListener("resize", resize);

  buildSpots();
  resize();
  if (reduceMotion) {
    state.p = 0.45;
    state.target = 0.45;
  }
  start();
})();
