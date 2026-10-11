(() => {
  const stage = document.querySelector("[data-stage]");
  const canvas = document.querySelector("[data-scene]");
  const meterEl = document.querySelector("[data-meter]");
  const weatherEl = document.querySelector("[data-weather]");
  const hintEl = document.querySelector("[data-hint]");
  if (!stage || !canvas) return;

  const ctx = canvas.getContext("2d", { alpha: false });
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const IMG_RAIN = "../../img/gatbawi-rain.jpg";
  const IMG_CLEAR = "../../img/gatbawi-clear.jpg";

  const state = {
    w: 0,
    h: 0,
    dpr: 1,
    t: 0,
    clear: 0,
    targetClear: 0,
    mx: 0.5,
    my: 0.3,
    hasPointer: false,
    wipeTrail: [],
    ready: false,
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

  const clouds = Array.from({ length: 16 }, () => ({
    x: rnd(),
    y: 0.02 + rnd() * 0.34,
    r: 0.1 + rnd() * 0.18,
    soft: 0.5 + rnd() * 0.4,
    drift: 0.01 + rnd() * 0.025,
  }));

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
    };
  }

  const rainyPeople = Array.from({ length: 4 }, () => makePerson(true));
  const clearPeople = Array.from({ length: 15 }, () => makePerson(false));

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

  /** cover-fit draw rect for an image into canvas */
  function coverRect(img) {
    const iw = img.naturalWidth || 1;
    const ih = img.naturalHeight || 1;
    const scale = Math.max(state.w / iw, state.h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    return {
      dx: (state.w - dw) / 2,
      dy: (state.h - dh) / 2,
      dw,
      dh,
      scale,
    };
  }

  function seaTop() {
    return state.h * 0.42;
  }

  /** 사진 속 보행교 대략 경로 (정규화 u: 0→1) */
  function deckPath(u) {
    const x = lerp(state.w * 0.08, state.w * 0.92, u);
    const y =
      state.h * 0.72 +
      Math.sin(u * Math.PI * 0.9) * state.h * 0.02 -
      u * state.h * 0.01;
    return { x, y };
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
  }

  function wipeAt(nx, ny) {
    state.wipeTrail.push({ x: nx, y: ny, life: 1 });
    if (state.wipeTrail.length > 56) state.wipeTrail.shift();
    const rainLeft = 1 - state.clear;
    state.targetClear = clamp(state.targetClear + 0.014 * (0.4 + rainLeft), 0, 1);
  }

  function onPointer(e) {
    const rect = canvas.getBoundingClientRect();
    state.mx = (e.clientX - rect.left) / rect.width;
    state.my = (e.clientY - rect.top) / rect.height;
    state.hasPointer = true;
    if (state.my < 0.55) wipeAt(state.mx, state.my);
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

  function drawPhotoBase(clear) {
    const rainOk = rainImg.complete && rainImg.naturalWidth > 0;
    const clearOk = clearImg.complete && clearImg.naturalWidth > 0;

    if (rainOk) {
      const r = coverRect(rainImg);
      ctx.drawImage(rainImg, r.dx, r.dy, r.dw, r.dh);
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
      ctx.drawImage(clearImg, r.dx, r.dy, r.dw, r.dh);
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

  /** 수면 띠를 사인 오프셋으로 다시 그려 파도감 */
  function drawWaveDistortion(clear) {
    const y0 = Math.floor(seaTop());
    const y1 = state.h;
    if (y1 <= y0) return;

    // 캔버스 비트맵 → 오프스크린(CSS 픽셀) 복사 후 물결로 되그림
    waveCtx.setTransform(1, 0, 0, 1, 0, 0);
    waveCtx.clearRect(0, 0, state.w, state.h);
    waveCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, state.w, state.h);

    const amp = lerp(2.8, 1.2, clear);
    const step = 3;
    for (let y = y0; y < y1; y += step) {
      const depth = (y - y0) / (y1 - y0);
      const shift =
        Math.sin(y * 0.045 + state.t * 2.1) * amp * (0.35 + depth) +
        Math.sin(y * 0.11 - state.t * 1.4) * amp * 0.45;
      ctx.drawImage(waveCanvas, 0, y, state.w, step, shift, y, state.w, step);
    }

    const bands = 7;
    for (let i = 0; i < bands; i += 1) {
      const yy = y0 + 24 + i * ((y1 - y0) / (bands + 1));
      ctx.beginPath();
      for (let x = 0; x <= state.w; x += 8) {
        const wave =
          Math.sin(x * 0.014 + state.t * 1.6 + i) * lerp(5.5, 2.5, clear) +
          Math.sin(x * 0.03 - state.t + i * 1.3) * 1.8;
        const y = yy + wave;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(220, 235, 245, ${0.07 + clear * 0.08})`;
      ctx.lineWidth = 1.15;
      ctx.stroke();
    }
  }

  function drawClouds(clear) {
    const dens = 1 - clear * 0.95;
    if (dens < 0.02) return;

    for (const c of clouds) {
      const cx = ((c.x + state.t * c.drift * 0.015) % 1.35) * state.w - state.w * 0.15;
      const cy = c.y * state.h;
      const r = c.r * state.w;

      let hole = 0;
      for (const w of state.wipeTrail) {
        const dx = (cx / state.w - w.x) * 1.35;
        const dy = (cy / state.h - w.y) * 2.1;
        hole = Math.max(hole, clamp(1 - Math.hypot(dx, dy) / 0.24, 0, 1) * w.life);
      }

      const alpha = dens * c.soft * (1 - hole * 0.97) * (1 - clear * 0.25);
      if (alpha < 0.02) continue;

      const g = ctx.createRadialGradient(cx, cy, r * 0.08, cx, cy, r);
      g.addColorStop(0, `rgba(195, 202, 210, ${alpha})`);
      g.addColorStop(0.5, `rgba(165, 174, 184, ${alpha * 0.8})`);
      g.addColorStop(1, "rgba(150,160,170,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.38, cy + r * 0.06, r * 0.55, r * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + r * 0.42, cy + r * 0.04, r * 0.5, r * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawRain(clear) {
    const intensity = 1 - clear;
    if (intensity < 0.04) return;

    const count = Math.floor(drops.length * intensity);
    const ySea = seaTop() + 10;
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
            y: ySea + rnd() * (state.h - ySea) * 0.7,
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

  function drawPerson(p, umbrella, alpha) {
    const pos = deckPath(p.u);
    const bob = Math.sin(state.t * 7.5 + p.phase) * 0.9;
    const s = p.scale * (state.h / 1100) * 0.85;

    ctx.save();
    ctx.translate(pos.x, pos.y - 6 + bob);
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
        p.u += p.dir * p.speed * 0.016;
        if (p.u > 1.02) {
          p.u = -0.02;
          p.dir = 1;
        }
        if (p.u < -0.02) {
          p.u = 1.02;
          p.dir = -1;
        }
        drawPerson(p, true, alpha);
      }
    }

    if (showClear) {
      const alpha = clamp((clear - 0.28) / 0.45, 0, 1);
      for (let i = 0; i < clearCount; i += 1) {
        const p = clearPeople[i];
        p.u += p.dir * p.speed * 0.016;
        if (p.u > 1.02) {
          p.u = -0.02;
          p.dir = 1;
        }
        if (p.u < -0.02) {
          p.u = 1.02;
          p.dir = -1;
        }
        drawPerson(p, false, alpha);
      }
    }
  }

  function drawCursor() {
    if (!state.hasPointer) return;
    const x = state.mx * state.w;
    const y = state.my * state.h;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.fillStyle = "rgba(230, 200, 140, 0.12)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.fill();
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
    if (!state.ready) return;
    state.t = now * 0.001;
    state.clear = lerp(state.clear, state.targetClear, 0.055);
    if (state.targetClear < 0.98) {
      state.targetClear = clamp(state.targetClear - 0.0007, 0, 1);
    }

    for (const w of state.wipeTrail) w.life *= 0.93;
    state.wipeTrail = state.wipeTrail.filter((w) => w.life > 0.04);

    const clear = state.clear;
    ctx.clearRect(0, 0, state.w, state.h);

    drawPhotoBase(clear);
    if (!reduceMotion) drawWaveDistortion(clear);
    drawClouds(clear);
    drawPeople(clear);
    drawRain(clear);
    drawCursor();
    updateUi(clear);

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
