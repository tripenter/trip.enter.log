(() => {
  const stage = document.querySelector("[data-stage]");
  const canvas = document.querySelector("[data-scene]");
  const meterEl = document.querySelector("[data-meter]");
  const weatherEl = document.querySelector("[data-weather]");
  const hintEl = document.querySelector("[data-hint]");
  if (!stage || !canvas) return;

  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = {
    w: 0,
    h: 0,
    dpr: 1,
    t: 0,
    clear: 0,
    targetClear: 0,
    mx: 0.5,
    my: 0.35,
    hasPointer: false,
    wipeTrail: [],
  };

  const rnd = (() => {
    let s = 20251011;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  })();

  const clouds = Array.from({ length: 14 }, () => ({
    x: rnd(),
    y: 0.05 + rnd() * 0.38,
    r: 0.08 + rnd() * 0.16,
    soft: 0.55 + rnd() * 0.35,
    drift: 0.015 + rnd() * 0.03,
  }));

  const rain = Array.from({ length: 220 }, () => ({
    x: rnd(),
    y: rnd(),
    len: 10 + rnd() * 18,
    sp: 0.55 + rnd() * 0.85,
    thick: 0.6 + rnd() * 0.9,
  }));

  const splashes = [];
  const MAX_SPLASH = 80;

  function makePerson(umbrella) {
    return {
      x: rnd(),
      dir: rnd() > 0.5 ? 1 : -1,
      speed: 0.018 + rnd() * 0.028,
      phase: rnd() * Math.PI * 2,
      hue: 180 + rnd() * 80,
      umbrella,
      scale: 0.85 + rnd() * 0.3,
    };
  }

  const rainyPeople = Array.from({ length: 4 }, () => makePerson(true));
  const clearPeople = Array.from({ length: 15 }, () => makePerson(false));

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
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function mixColor(c0, c1, t) {
    return {
      r: Math.round(lerp(c0.r, c1.r, t)),
      g: Math.round(lerp(c0.g, c1.g, t)),
      b: Math.round(lerp(c0.b, c1.b, t)),
    };
  }

  function rgb(c, a = 1) {
    return `rgba(${c.r},${c.g},${c.b},${a})`;
  }

  function horizonY() {
    return state.h * 0.58;
  }

  function seaY() {
    return state.h * 0.62;
  }

  function deckPath(u) {
    // S-curve floating boardwalk across lower mid scene
    const x0 = state.w * 0.02;
    const x1 = state.w * 0.98;
    const x = lerp(x0, x1, u);
    const base = state.h * 0.72;
    const y =
      base +
      Math.sin(u * Math.PI * 1.15 + 0.4) * state.h * 0.035 +
      (u - 0.5) * state.h * 0.02;
    return { x, y };
  }

  function wipeAt(nx, ny) {
    state.wipeTrail.push({ x: nx, y: ny, life: 1 });
    if (state.wipeTrail.length > 48) state.wipeTrail.shift();
    // Clearing strength depends on how cloudy the area still is
    const rainLeft = 1 - state.clear;
    state.targetClear = clamp(state.targetClear + 0.012 * (0.35 + rainLeft), 0, 1);
  }

  function onPointer(e) {
    const rect = canvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    state.mx = nx;
    state.my = ny;
    state.hasPointer = true;
    if (ny < 0.62) wipeAt(nx, ny);
  }

  canvas.addEventListener("pointermove", onPointer);
  canvas.addEventListener("pointerdown", onPointer);
  canvas.addEventListener(
    "pointerleave",
    () => {
      state.hasPointer = false;
    },
    { passive: true }
  );

  function drawSky(clear) {
    const topRain = { r: 72, g: 84, b: 96 };
    const botRain = { r: 110, g: 122, b: 132 };
    const topClear = { r: 118, g: 168, b: 196 };
    const botClear = { r: 214, g: 196, b: 156 };
    const top = mixColor(topRain, topClear, clear);
    const bot = mixColor(botRain, botClear, clear);
    const g = ctx.createLinearGradient(0, 0, 0, horizonY());
    g.addColorStop(0, rgb(top));
    g.addColorStop(1, rgb(bot));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, state.w, horizonY() + 2);

    // Soft sun glow when clearing
    if (clear > 0.2) {
      const sx = state.w * 0.78;
      const sy = state.h * 0.22;
      const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, state.w * 0.35);
      sun.addColorStop(0, `rgba(255, 214, 140, ${0.55 * clear})`);
      sun.addColorStop(0.35, `rgba(255, 196, 120, ${0.22 * clear})`);
      sun.addColorStop(1, "rgba(255,196,120,0)");
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, state.w, horizonY());
    }
  }

  function drawCity(clear) {
    const fog = 1 - clear;
    const hy = horizonY();
    const baseAlpha = lerp(0.18, 0.72, clear);
    ctx.save();
    ctx.globalAlpha = baseAlpha;

    const buildings = [
      [0.05, 0.1, 0.12],
      [0.12, 0.07, 0.16],
      [0.18, 0.11, 0.1],
      [0.28, 0.08, 0.14],
      [0.35, 0.13, 0.09],
      [0.48, 0.06, 0.18],
      [0.55, 0.1, 0.11],
      [0.66, 0.08, 0.15],
      [0.74, 0.12, 0.1],
      [0.84, 0.07, 0.17],
      [0.92, 0.1, 0.12],
    ];

    for (const [nx, nw, nh] of buildings) {
      const x = state.w * nx;
      const w = state.w * nw;
      const h = state.h * nh;
      const y = hy - h;
      ctx.fillStyle = `rgb(${40 + clear * 30},${52 + clear * 28},${62 + clear * 20})`;
      ctx.fillRect(x, y, w, h + 2);
      // windows
      if (clear > 0.45) {
        ctx.fillStyle = `rgba(255, 220, 150, ${(clear - 0.45) * 0.55})`;
        for (let wy = y + 6; wy < hy - 8; wy += 8) {
          for (let wx = x + 3; wx < x + w - 3; wx += 7) {
            if ((wx + wy) % 3 === 0) ctx.fillRect(wx, wy, 2.2, 2.8);
          }
        }
      }
    }

    ctx.restore();

    // Fog veil over city
    if (fog > 0.02) {
      const fogG = ctx.createLinearGradient(0, hy - state.h * 0.22, 0, hy + 8);
      fogG.addColorStop(0, `rgba(170, 182, 192, ${0.55 * fog})`);
      fogG.addColorStop(0.55, `rgba(150, 164, 176, ${0.72 * fog})`);
      fogG.addColorStop(1, `rgba(140, 154, 166, ${0.2 * fog})`);
      ctx.fillStyle = fogG;
      ctx.fillRect(0, hy - state.h * 0.24, state.w, state.h * 0.28);
    }
  }

  function drawClouds(clear) {
    const dens = 1 - clear * 0.92;
    if (dens < 0.02) return;

    for (const c of clouds) {
      const cx = ((c.x + state.t * c.drift * 0.02) % 1.3) * state.w - state.w * 0.15;
      const cy = c.y * state.h;
      const r = c.r * state.w;

      // Wipe holes near trail
      let hole = 0;
      for (const w of state.wipeTrail) {
        const dx = (cx / state.w - w.x) * 1.4;
        const dy = (cy / state.h - w.y) * 2.2;
        const d = Math.hypot(dx, dy);
        hole = Math.max(hole, clamp(1 - d / 0.22, 0, 1) * w.life);
      }

      const alpha = dens * c.soft * (1 - hole * 0.95) * (1 - clear * 0.35);
      if (alpha < 0.02) continue;

      const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
      g.addColorStop(0, `rgba(190, 198, 206, ${alpha})`);
      g.addColorStop(0.55, `rgba(160, 170, 180, ${alpha * 0.75})`);
      g.addColorStop(1, "rgba(150,160,170,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.35, cy + r * 0.08, r * 0.55, r * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + r * 0.4, cy + r * 0.05, r * 0.5, r * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSea(clear) {
    const y0 = seaY();
    const deepRain = { r: 28, g: 52, b: 64 };
    const deepClear = { r: 22, g: 78, b: 96 };
    const shallowRain = { r: 70, g: 92, b: 102 };
    const shallowClear = { r: 90, g: 150, b: 158 };
    const deep = mixColor(deepRain, deepClear, clear);
    const shallow = mixColor(shallowRain, shallowClear, clear);

    const g = ctx.createLinearGradient(0, y0, 0, state.h);
    g.addColorStop(0, rgb(shallow));
    g.addColorStop(1, rgb(deep));
    ctx.fillStyle = g;
    ctx.fillRect(0, y0 - 2, state.w, state.h - y0 + 4);

    // Animated waves
    const amp = lerp(10, 5, clear);
    ctx.lineWidth = 1.2;
    for (let band = 0; band < 7; band += 1) {
      const yy = y0 + 12 + band * ((state.h - y0) / 8);
      ctx.beginPath();
      for (let x = 0; x <= state.w; x += 6) {
        const wave =
          Math.sin(x * 0.012 + state.t * (1.4 + band * 0.12) + band) * amp * (1 - band * 0.08) +
          Math.sin(x * 0.035 - state.t * 0.9 + band * 2) * amp * 0.35;
        const y = yy + wave;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(210, 230, 236, ${0.08 + clear * 0.1})`;
      ctx.stroke();
    }

    // Foam near rocks
    ctx.fillStyle = `rgba(220, 235, 240, ${0.12 + clear * 0.12})`;
    for (let i = 0; i < 40; i += 1) {
      const fx = state.w * (0.28 + (i % 12) * 0.035);
      const fy =
        y0 +
        18 +
        Math.sin(state.t * 2.2 + i) * 4 +
        (i % 5) * 3;
      ctx.beginPath();
      ctx.ellipse(fx, fy, 6 + (i % 3), 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawGatbawi(clear) {
    const y0 = seaY();
    const sharpness = 0.35 + clear * 0.65;
    const baseX = state.w * 0.42;
    const scale = Math.min(state.w, state.h) * 0.00115;

    function rock(ox, oy, s, lean) {
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(s, s);
      ctx.rotate(lean);

      // body
      const body = ctx.createLinearGradient(0, -120, 0, 80);
      body.addColorStop(0, `rgba(${90 + clear * 40},${88 + clear * 30},${82 + clear * 20},${sharpness})`);
      body.addColorStop(0.45, `rgba(${70 + clear * 25},${68 + clear * 20},${62},${sharpness})`);
      body.addColorStop(1, `rgba(45,48,52,${sharpness})`);
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(-55, 70);
      ctx.bezierCurveTo(-70, 10, -48, -40, -35, -70);
      ctx.bezierCurveTo(-20, -95, 20, -95, 38, -68);
      ctx.bezierCurveTo(55, -35, 68, 15, 52, 72);
      ctx.closePath();
      ctx.fill();

      // hat brim (갓)
      ctx.fillStyle = `rgba(${55 + clear * 35},${58 + clear * 25},${55},${sharpness})`;
      ctx.beginPath();
      ctx.ellipse(0, -62, 78, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-40, -62);
      ctx.quadraticCurveTo(0, -118, 40, -62);
      ctx.closePath();
      ctx.fill();

      // honeycomb weathering
      ctx.fillStyle = `rgba(30, 28, 26, ${0.18 * sharpness})`;
      for (let i = 0; i < 18; i += 1) {
        const hx = -25 + (i % 6) * 10;
        const hy = -10 + Math.floor(i / 6) * 18;
        ctx.beginPath();
        ctx.ellipse(hx, hy, 3.5, 4.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    // Reflection
    ctx.save();
    ctx.globalAlpha = 0.18 + clear * 0.12;
    ctx.translate(0, y0 * 2 + 40);
    ctx.scale(1, -0.35);
    rock(baseX - 55 * scale * 90, y0 + 20, scale * 90, -0.05);
    rock(baseX + 70 * scale * 80, y0 + 28, scale * 78, 0.06);
    ctx.restore();

    // Father rock / son rock
    rock(baseX - 36, y0 + 8, scale * 95, -0.04);
    rock(baseX + 58, y0 + 18, scale * 78, 0.05);

    // Soft mist on rocks when rainy
    if (clear < 0.7) {
      const mist = 1 - clear;
      const g = ctx.createRadialGradient(baseX, y0 - 40, 10, baseX, y0 - 20, 180);
      g.addColorStop(0, `rgba(170,180,190,${0.35 * mist})`);
      g.addColorStop(1, "rgba(170,180,190,0)");
      ctx.fillStyle = g;
      ctx.fillRect(baseX - 200, y0 - 160, 400, 220);
    }
  }

  function drawDeck(clear) {
    const samples = 48;
    const pts = [];
    for (let i = 0; i <= samples; i += 1) pts.push(deckPath(i / samples));

    // pillars into water
    ctx.strokeStyle = `rgba(50, 42, 36, ${0.35 + clear * 0.35})`;
    ctx.lineWidth = 2;
    for (let i = 2; i < samples; i += 4) {
      const p = pts[i];
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + 6);
      ctx.lineTo(p.x, p.y + 38 + Math.sin(i + state.t) * 2);
      ctx.stroke();
    }

    // boardwalk body
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y - 5);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y - 5);
    for (let i = pts.length - 1; i >= 0; i -= 1) ctx.lineTo(pts[i].x, pts[i].y + 7);
    ctx.closePath();
    const wood = ctx.createLinearGradient(0, pts[0].y - 20, 0, pts[0].y + 20);
    wood.addColorStop(0, `rgba(${120 + clear * 40},${96 + clear * 30},${72},${0.55 + clear * 0.4})`);
    wood.addColorStop(1, `rgba(${70 + clear * 20},${58 + clear * 15},${46},${0.55 + clear * 0.4})`);
    ctx.fillStyle = wood;
    ctx.fill();

    // railing
    ctx.strokeStyle = `rgba(200, 205, 210, ${0.35 + clear * 0.5})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y - 14);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y - 14);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y - 4);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y - 4);
    ctx.stroke();

    for (let i = 0; i < samples; i += 3) {
      const p = pts[i];
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 14);
      ctx.lineTo(p.x, p.y + 5);
      ctx.stroke();
    }
  }

  function drawPerson(p, umbrella, alpha) {
    const pos = deckPath(p.x);
    const bob = Math.sin(state.t * 8 + p.phase) * 1.2;
    const x = pos.x;
    const y = pos.y - 8 + bob;
    const s = p.scale * (state.h / 900);

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(p.dir * s, s);
    ctx.globalAlpha = alpha;

    // legs
    ctx.strokeStyle = "#1a2228";
    ctx.lineWidth = 1.6;
    const stride = Math.sin(state.t * 7 + p.phase) * 4;
    ctx.beginPath();
    ctx.moveTo(-2, 0);
    ctx.lineTo(-3 - stride, 10);
    ctx.moveTo(2, 0);
    ctx.lineTo(3 + stride, 10);
    ctx.stroke();

    // body
    ctx.fillStyle = `hsl(${p.hue} 28% ${lerp(28, 42, state.clear)}%)`;
    ctx.fillRect(-4, -14, 8, 14);

    // head
    ctx.fillStyle = "#d7c4a8";
    ctx.beginPath();
    ctx.arc(0, -18, 3.2, 0, Math.PI * 2);
    ctx.fill();

    if (umbrella) {
      ctx.fillStyle = `hsl(${(p.hue + 40) % 360} 45% 42%)`;
      ctx.beginPath();
      ctx.arc(0, -28, 11, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, -28);
      ctx.lineTo(0, -8);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawPeople(clear) {
    const rainCount = 1 + Math.floor(clamp(1 - clear, 0, 1) * 3); // 1..4
    const clearCount = 10 + Math.floor(clear * 5); // 10..15
    const showRain = clear < 0.72;
    const showClear = clear > 0.28;

    if (showRain) {
      const alpha = clamp(1 - (clear - 0.35) / 0.4, 0, 1);
      for (let i = 0; i < rainCount; i += 1) {
        const p = rainyPeople[i];
        p.x += p.dir * p.speed * 0.016;
        if (p.x > 1.05) {
          p.x = -0.05;
          p.dir = 1;
        }
        if (p.x < -0.05) {
          p.x = 1.05;
          p.dir = -1;
        }
        drawPerson(p, true, alpha);
      }
    }

    if (showClear) {
      const alpha = clamp((clear - 0.28) / 0.45, 0, 1);
      for (let i = 0; i < clearCount; i += 1) {
        const p = clearPeople[i];
        p.x += p.dir * p.speed * 0.016;
        if (p.x > 1.05) {
          p.x = -0.05;
          p.dir = 1;
        }
        if (p.x < -0.05) {
          p.x = 1.05;
          p.dir = -1;
        }
        drawPerson(p, false, alpha);
      }
    }
  }

  function drawRain(clear) {
    const intensity = 1 - clear;
    if (intensity < 0.04) return;

    const count = Math.floor(rain.length * intensity);
    const ySea = seaY() + 8;
    ctx.strokeStyle = `rgba(200, 215, 225, ${0.22 + intensity * 0.25})`;

    for (let i = 0; i < count; i += 1) {
      const d = rain[i];
      d.y += d.sp * 0.018 * (0.7 + intensity);
      d.x += 0.0015;
      if (d.y > 1.05) {
        d.y = -0.05;
        d.x = rnd();
        // splash when drop resets near sea band
        if (splashes.length < MAX_SPLASH && rnd() < 0.55 * intensity) {
          splashes.push({
            x: d.x * state.w,
            y: ySea + rnd() * (state.h - ySea) * 0.55,
            r: 0.5,
            life: 1,
          });
        }
      }
      if (d.x > 1.1) d.x = -0.05;

      const x = d.x * state.w;
      const y = d.y * state.h;
      if (y > ySea + 40) continue;
      ctx.lineWidth = d.thick;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 1.2, y + d.len * intensity);
      ctx.stroke();
    }

    // Tiny sea splashes
    for (let i = splashes.length - 1; i >= 0; i -= 1) {
      const s = splashes[i];
      s.r += 0.35;
      s.life -= 0.045;
      if (s.life <= 0) {
        splashes.splice(i, 1);
        continue;
      }
      ctx.strokeStyle = `rgba(220, 235, 240, ${0.35 * s.life * intensity})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, s.r * 1.6, s.r * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawCursor() {
    if (!state.hasPointer) return;
    const x = state.mx * state.w;
    const y = state.my * state.h;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.fillStyle = "rgba(230, 200, 140, 0.15)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 22, y);
    ctx.lineTo(x + 22, y);
    ctx.moveTo(x, y - 22);
    ctx.lineTo(x, y + 22);
    ctx.stroke();
    ctx.restore();
  }

  function updateUi(clear) {
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
        hintEl.textContent = "마우스로 구름을 쓸어 걷어내 보세요";
        hintEl.classList.remove("is-done");
      }
    }
  }

  function frame(now) {
    state.t = now * 0.001;
    // Slow natural recovery toward target; tiny auto-clear stop
    state.clear = lerp(state.clear, state.targetClear, 0.06);
    // Slight decay so user keeps interacting unless almost clear
    if (state.targetClear < 0.98) {
      state.targetClear = clamp(state.targetClear - 0.0008, 0, 1);
    }

    for (const w of state.wipeTrail) w.life *= 0.94;
    state.wipeTrail = state.wipeTrail.filter((w) => w.life > 0.04);

    const clear = state.clear;
    ctx.clearRect(0, 0, state.w, state.h);
    drawSky(clear);
    drawCity(clear);
    drawClouds(clear);
    drawSea(clear);
    drawGatbawi(clear);
    drawDeck(clear);
    drawPeople(clear);
    drawRain(clear);
    drawCursor();
    updateUi(clear);

    if (!reduceMotion) requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  resize();
  updateUi(0);

  if (reduceMotion) {
    state.clear = 0.35;
    state.targetClear = 0.35;
    requestAnimationFrame(frame);
  } else {
    requestAnimationFrame(frame);
  }
})();
