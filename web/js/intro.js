(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function spawnStars() {
    const field = document.querySelector("[data-starfield]");
    if (!field) return;
    const count = window.innerWidth < 768 ? 36 : 64;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i += 1) {
      const star = document.createElement("span");
      star.className = "star";
      star.style.left = `${Math.random() * 100}%`;
      star.style.top = `${Math.random() * 70}%`;
      star.style.setProperty("--dur", `${2.8 + Math.random() * 3.8}s`);
      star.style.animationDelay = `${Math.random() * 4}s`;
      frag.appendChild(star);
    }
    field.appendChild(frag);
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

  spawnStars();
  revealHero();
  observeThemes();
  bindNavKeyboard();
})();
