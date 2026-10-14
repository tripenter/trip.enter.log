(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const CODE_LINES = [
    { html: `<span class="tok-cmt">// trip.enter — log a place as code</span>` },
    { html: `<span class="tok-key">const</span> place = <span class="tok-fn">read</span>(<span class="tok-str">"yeongwol"</span>);` },
    { html: `<span class="tok-key">await</span> place.<span class="tok-fn">walk</span>({ wind: <span class="tok-str">"west"</span> });` },
    { html: `memory.<span class="tok-fn">push</span>({ air: place.air, light: place.light });` },
    { html: `<span class="tok-key">export</span> <span class="tok-key">default</span> memory;` },
  ];

  function renderHeroCode() {
    const pre = document.querySelector("[data-hero-code]");
    const caret = document.querySelector("[data-hero-caret]");
    if (!pre) return;

    if (reduceMotion) {
      pre.innerHTML = CODE_LINES.map((line, i) => `${i + 1}  ${line.html}`).join("\n");
      if (caret) caret.style.opacity = "0";
      return;
    }

    let lineIndex = 0;
    let charIndex = 0;
    const built = CODE_LINES.map(() => "");

    const tick = () => {
      if (lineIndex >= CODE_LINES.length) {
        if (caret) positionCaret(pre, caret);
        return;
      }

      const raw = CODE_LINES[lineIndex].html;
      charIndex += 1;
      // type by advancing through HTML string cautiously: reveal whole tokens in chunks
      const step = Math.min(raw.length, charIndex + Math.floor(Math.random() * 3));
      charIndex = step;
      built[lineIndex] = raw.slice(0, charIndex);

      pre.innerHTML = built
        .map((line, i) => {
          if (!line && i > lineIndex) return "";
          const num = String(i + 1).padStart(2, " ");
          return `<span class="code-row"><span class="tok-cmt">${num}</span>  ${line || ""}</span>`;
        })
        .filter(Boolean)
        .join("\n");

      if (caret) positionCaret(pre, caret);

      if (charIndex >= raw.length) {
        lineIndex += 1;
        charIndex = 0;
        window.setTimeout(tick, 220);
      } else {
        window.setTimeout(tick, 18 + Math.random() * 28);
      }
    };

    window.setTimeout(tick, 280);
  }

  function positionCaret(pre, caret) {
    const rows = pre.querySelectorAll(".code-row");
    const last = rows[rows.length - 1];
    const editor = pre.closest(".hero-editor");
    if (!last || !editor) return;
    const editorBox = editor.getBoundingClientRect();
    const rowBox = last.getBoundingClientRect();
    caret.style.opacity = "1";
    caret.style.left = `${rowBox.right - editorBox.left + 4}px`;
    caret.style.top = `${rowBox.top - editorBox.top + 2}px`;
    caret.style.height = `${Math.max(14, rowBox.height * 0.85)}px`;
  }

  function revealHero() {
    const nodes = document.querySelectorAll("[data-hero-in]");
    if (reduceMotion) {
      nodes.forEach((el) => el.classList.add("is-in"));
      return;
    }
    nodes.forEach((el, index) => {
      window.setTimeout(() => el.classList.add("is-in"), 120 + index * 160);
    });
  }

  function observeThemes() {
    const items = document.querySelectorAll("[data-reveal]");
    if (!items.length) return;
    if (reduceMotion || !("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        });
      },
      { threshold: 0.2, rootMargin: "0px 0px -8% 0px" }
    );
    items.forEach((el, index) => {
      el.style.transitionDelay = `${index * 90}ms`;
      io.observe(el);
    });
  }

  function bindNavKeyboard() {
    document.querySelectorAll("[data-nav-item]").forEach((item) => {
      const link = item.querySelector(".nav-link");
      const panel = item.querySelector(".nav-panel");
      if (!link || !panel) return;
      link.addEventListener("keydown", (event) => {
        if (event.key === "Escape") link.blur();
      });
    });
  }

  renderHeroCode();
  revealHero();
  observeThemes();
  bindNavKeyboard();

  window.addEventListener("resize", () => {
    const pre = document.querySelector("[data-hero-code]");
    const caret = document.querySelector("[data-hero-caret]");
    if (pre && caret) positionCaret(pre, caret);
  });
})();
