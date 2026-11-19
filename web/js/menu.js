(() => {
  const MENU_API = "/rest/get/menu";
  const MQ_MOBILE = window.matchMedia("(max-width: 768px)");

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function menuHref(folder) {
    if (!folder) return "#";
    const cleaned = String(folder).replace(/^\/+|\/+$/g, "");
    if (!cleaned) return "#";
    // web 루트 기준 경로 (하위 페이지에서도 동일하게 동작)
    return `/${cleaned}/`;
  }

  function renderChild(child) {
    const href = menuHref(child.folder);
    const title = escapeHtml(child.title || "");
    const label = child.folder
      ? `<span class="panel-label">${escapeHtml(String(child.folder).split("/").pop())}</span>`
      : "";
    return `<div>${label}<a href="${href}">${title}</a></div>`;
  }

  function childCountBadge(count) {
    if (!count) return "";
    return `<span class="nav-count" aria-label="활성 하위 메뉴 ${count}개">${count}</span>`;
  }

  function renderParent(menu) {
    // /rest/get/menu 는 활성(WM_IsActive=1) 메뉴만 반환하므로 children 수가 활성 하위 개수다.
    const children = Array.isArray(menu.children) ? menu.children : [];
    const title = escapeHtml(menu.title || "");
    const topHref = menuHref(menu.folder);
    const count = children.length;
    const panelBody = count
      ? children.map(renderChild).join("")
      : `<p class="panel-empty">기록 예정이에요</p>`;

    return `
      <div class="nav-item nav-link-desktop" data-nav-item>
        <a class="nav-link" href="${topHref}">
          <span class="nav-link-label">${title}</span>
          ${childCountBadge(count)}
        </a>
        <div class="nav-panel" role="region" aria-label="${title} 하위메뉴">
          <div class="nav-panel-inner${count ? "" : " is-empty"}">
            ${panelBody}
          </div>
        </div>
      </div>
    `;
  }

  function renderMobileChild(child) {
    const href = menuHref(child.folder);
    const title = escapeHtml(child.title || "");
    return `<a class="nav-drawer-link" href="${href}">${title}</a>`;
  }

  function renderMobileParent(menu, index) {
    const children = Array.isArray(menu.children) ? menu.children : [];
    const title = escapeHtml(menu.title || "");
    const topHref = menuHref(menu.folder);
    const count = children.length;
    const id = `nav-drawer-section-${index}`;
    const titleWithCount = `
      <span class="nav-drawer-title">
        <span>${title}</span>
        ${childCountBadge(count)}
      </span>
    `;

    if (!count) {
      return `
        <div class="nav-drawer-item">
          <a class="nav-drawer-parent" href="${topHref}">${titleWithCount}</a>
        </div>
      `;
    }

    return `
      <div class="nav-drawer-item" data-drawer-item>
        <button
          type="button"
          class="nav-drawer-parent is-toggle"
          aria-expanded="false"
          aria-controls="${id}"
          data-drawer-toggle
        >
          ${titleWithCount}
          <span class="nav-drawer-chevron" aria-hidden="true"></span>
        </button>
        <div class="nav-drawer-children" id="${id}" hidden>
          ${children.map(renderMobileChild).join("")}
        </div>
      </div>
    `;
  }

  function bindNavKeyboard(root) {
    root.querySelectorAll("[data-nav-item]").forEach((item) => {
      const link = item.querySelector(".nav-link");
      if (!link) return;
      link.addEventListener("keydown", (event) => {
        if (event.key === "Escape") link.blur();
      });
    });
  }

  function setNavOpen(open) {
    const nav = document.querySelector(".site-nav");
    const toggle = document.querySelector("[data-nav-toggle]");
    const drawer = document.querySelector("[data-nav-drawer]");
    if (!nav || !toggle || !drawer) return;

    nav.classList.toggle("is-nav-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
    drawer.hidden = !open;
    document.body.classList.toggle("is-nav-locked", open);

    if (!open) {
      drawer.querySelectorAll("[data-drawer-toggle]").forEach((btn) => {
        btn.setAttribute("aria-expanded", "false");
        const panel = drawer.querySelector(`#${btn.getAttribute("aria-controls")}`);
        if (panel) panel.hidden = true;
      });
    }
  }

  function setAuthOpen(open) {
    const modal = document.querySelector("[data-auth-modal]");
    const loginBtn = document.querySelector("[data-nav-login]");
    if (!modal) return;
    modal.hidden = !open;
    document.body.classList.toggle("is-auth-open", open);
    if (loginBtn) loginBtn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      const closeBtn = modal.querySelector("[data-auth-close]");
      if (closeBtn) closeBtn.focus();
    }
  }

  function ensureUserShell(end) {
    let wrap = end.querySelector("[data-nav-user-wrap]");
    if (wrap) return wrap;

    wrap = document.createElement("div");
    wrap.className = "nav-user-wrap";
    wrap.setAttribute("data-nav-user-wrap", "");
    wrap.hidden = true;
    wrap.innerHTML = `
      <p class="nav-user-greeting" data-nav-user-greeting></p>
      <button
        type="button"
        class="nav-user-menu-btn"
        data-nav-user-toggle
        aria-haspopup="menu"
        aria-expanded="false"
        aria-controls="nav-user-menu"
        aria-label="계정 메뉴"
      >
        <span class="nav-user-menu-bars" aria-hidden="true">
          <span></span><span></span><span></span>
        </span>
      </button>
      <div class="nav-user-menu" id="nav-user-menu" data-nav-user-menu role="menu" hidden>
        <button type="button" class="nav-user-menu-item" data-nav-profile role="menuitem">프로필 수정</button>
        <div class="nav-user-menu-spacer" aria-hidden="true"></div>
        <button type="button" class="nav-user-logout" data-nav-logout role="menuitem">로그아웃</button>
      </div>
    `;
    end.appendChild(wrap);
    return wrap;
  }

  function loadDaumPostcode() {
    if (window.daum && window.daum.Postcode) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-daum-postcode]');
      if (existing) {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("daum postcode load failed")));
        return;
      }
      const script = document.createElement("script");
      script.src = "https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
      script.async = true;
      script.setAttribute("data-daum-postcode", "");
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("daum postcode load failed"));
      document.head.appendChild(script);
    });
  }

  function setProfileOpen(open) {
    const modal = document.querySelector("[data-profile-modal]");
    if (!modal) return;
    modal.hidden = !open;
    document.body.classList.toggle("is-profile-open", open);
    if (open) {
      const first = modal.querySelector("[data-profile-email]");
      if (first) first.focus();
    }
  }

  function ensureProfileModal() {
    let modal = document.querySelector("[data-profile-modal]");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.className = "profile-modal";
    modal.id = "profile-modal";
    modal.setAttribute("data-profile-modal", "");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "profile-modal-title");
    modal.hidden = true;
    modal.innerHTML = `
      <div class="profile-modal-backdrop" data-profile-close tabindex="-1"></div>
      <div class="profile-modal-panel">
        <div class="profile-modal-head">
          <h2 class="profile-modal-title font-display" id="profile-modal-title">프로필 수정</h2>
          <button type="button" class="profile-modal-close" data-profile-close aria-label="닫기">×</button>
        </div>
        <p class="profile-modal-copy">주소·연락처·소개를 남겨 두면 여행 기록에 함께 쓸 수 있어요.</p>
        <form class="profile-form" data-profile-form>
          <label class="profile-field">
            <span>이메일</span>
            <input type="email" name="email" data-profile-email autocomplete="email" placeholder="name@example.com" />
          </label>
          <label class="profile-field">
            <span>휴대전화번호</span>
            <input type="tel" name="phone" data-profile-phone autocomplete="tel" placeholder="010-0000-0000" />
          </label>
          <div class="profile-field">
            <span>주소</span>
            <div class="profile-address-row">
              <input type="text" name="zonecode" data-profile-zonecode readonly placeholder="우편번호" />
              <button type="button" class="profile-address-btn" data-profile-address-search>주소 검색</button>
            </div>
            <input type="text" name="address" data-profile-address readonly placeholder="기본주소" />
            <input type="text" name="address_detail" data-profile-address-detail placeholder="상세주소" autocomplete="address-line2" />
          </div>
          <label class="profile-field">
            <span>자기소개</span>
            <textarea name="intro" data-profile-intro rows="4" placeholder="짧게 소개해 주세요"></textarea>
          </label>
          <p class="profile-form-status" data-profile-status hidden></p>
          <div class="profile-form-actions">
            <button type="button" class="profile-btn-ghost" data-profile-close>취소</button>
            <button type="submit" class="profile-btn-primary" data-profile-save>저장</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-profile-close]")) setProfileOpen(false);
    });

    modal.querySelector("[data-profile-address-search]")?.addEventListener("click", async () => {
      try {
        await loadDaumPostcode();
        new window.daum.Postcode({
          oncomplete(data) {
            const zonecode = modal.querySelector("[data-profile-zonecode]");
            const address = modal.querySelector("[data-profile-address]");
            const detail = modal.querySelector("[data-profile-address-detail]");
            if (zonecode) zonecode.value = data.zonecode || "";
            if (address) {
              address.value = data.roadAddress || data.jibunAddress || data.address || "";
            }
            if (detail) detail.focus();
          },
        }).open();
      } catch (err) {
        console.error(err);
        const status = modal.querySelector("[data-profile-status]");
        if (status) {
          status.hidden = false;
          status.textContent = "주소 검색을 불러오지 못했습니다.";
        }
      }
    });

    modal.querySelector("[data-profile-form]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = modal.querySelector("[data-profile-status]");
      const saveBtn = modal.querySelector("[data-profile-save]");
      const body = {
        email: modal.querySelector("[data-profile-email]")?.value || "",
        phone: modal.querySelector("[data-profile-phone]")?.value || "",
        zonecode: modal.querySelector("[data-profile-zonecode]")?.value || "",
        address: modal.querySelector("[data-profile-address]")?.value || "",
        address_detail: modal.querySelector("[data-profile-address-detail]")?.value || "",
        intro: modal.querySelector("[data-profile-intro]")?.value || "",
      };
      if (saveBtn) saveBtn.disabled = true;
      if (status) {
        status.hidden = false;
        status.textContent = "저장 중…";
      }
      try {
        const res = await fetch("/rest/auth/profile", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`profile save ${res.status}`);
        if (status) status.textContent = "저장했습니다.";
        setTimeout(() => setProfileOpen(false), 450);
      } catch (err) {
        console.error(err);
        if (status) status.textContent = "저장에 실패했습니다. 다시 시도해 주세요.";
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modal.hidden) setProfileOpen(false);
    });

    return modal;
  }

  async function openProfileEditor() {
    setUserMenuOpen(false);
    setAuthOpen(false);
    const modal = ensureProfileModal();
    const status = modal.querySelector("[data-profile-status]");
    if (status) {
      status.hidden = true;
      status.textContent = "";
    }
    setProfileOpen(true);
    try {
      const res = await fetch("/rest/auth/profile", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`profile get ${res.status}`);
      const data = await res.json();
      const setVal = (sel, value) => {
        const el = modal.querySelector(sel);
        if (el) el.value = value || "";
      };
      setVal("[data-profile-email]", data.email);
      setVal("[data-profile-phone]", data.phone);
      setVal("[data-profile-zonecode]", data.zonecode);
      setVal("[data-profile-address]", data.address);
      setVal("[data-profile-address-detail]", data.address_detail);
      setVal("[data-profile-intro]", data.intro);
    } catch (err) {
      console.error(err);
      if (status) {
        status.hidden = false;
        status.textContent = "프로필을 불러오지 못했습니다.";
      }
    }
  }

  function setUserMenuOpen(open) {
    const menu = document.querySelector("[data-nav-user-menu]");
    const toggle = document.querySelector("[data-nav-user-toggle]");
    if (!menu || !toggle) return;
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function syncJourneyNav(nickname) {
    const mount = document.querySelector("[data-dynamic-menu]");
    const drawer = document.querySelector("[data-nav-drawer] .nav-drawer-inner");
    document.querySelectorAll("[data-nav-journey]").forEach((el) => el.remove());
    if (!nickname) return;

    const label = `${nickname}의 여정`;
    if (mount) {
      const link = document.createElement("a");
      link.className = "nav-journey nav-link-desktop";
      link.href = "/journey/";
      link.setAttribute("data-nav-journey", "");
      link.textContent = label;
      mount.appendChild(link);
    }
    if (drawer) {
      const link = document.createElement("a");
      link.className = "nav-journey";
      link.href = "/journey/";
      link.setAttribute("data-nav-journey", "");
      link.textContent = label;
      drawer.appendChild(link);
    }
  }

  function renderLoggedOut(loginBtn) {
    loginBtn.hidden = false;
    loginBtn.className = "nav-login";
    loginBtn.setAttribute("aria-haspopup", "dialog");
    loginBtn.setAttribute("aria-controls", "auth-modal");
    loginBtn.setAttribute("aria-label", "로그인");
    loginBtn.textContent = "로그인";
    const wrap = document.querySelector("[data-nav-user-wrap]");
    if (wrap) wrap.hidden = true;
    setUserMenuOpen(false);
    syncJourneyNav(null);
  }

  function renderLoggedIn(loginBtn, nickname) {
    const end = loginBtn.parentElement;
    if (!end) return;
    const wrap = ensureUserShell(end);
    const greeting = wrap.querySelector("[data-nav-user-greeting]");
    loginBtn.hidden = true;
    wrap.hidden = false;
    if (greeting) greeting.textContent = `${nickname}님 함께 떠나요`;
    setUserMenuOpen(false);
    syncJourneyNav(nickname);
  }

  async function logout() {
    try {
      await fetch("/rest/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch (err) {
      console.error("logout failed:", err);
    }
    const loginBtn = document.querySelector("[data-nav-login]");
    if (loginBtn) renderLoggedOut(loginBtn);
    setUserMenuOpen(false);
    if (window.location.pathname.startsWith("/journey")) {
      window.location.href = "/index.html";
    }
  }

  async function refreshAuthUI(loginBtn) {
    try {
      const res = await fetch("/rest/auth/me", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`auth me ${res.status}`);
      const data = await res.json();
      if (data && data.logged_in && data.nickname) {
        renderLoggedIn(loginBtn, String(data.nickname));
      } else {
        renderLoggedOut(loginBtn);
      }
    } catch (err) {
      console.error("Failed to load auth session:", err);
      renderLoggedOut(loginBtn);
    }
  }

  function ensureAuthUI(navInner) {
    let end = navInner.querySelector("[data-nav-end]");
    if (!end) {
      end = document.createElement("div");
      end.className = "nav-end";
      end.setAttribute("data-nav-end", "");
      navInner.appendChild(end);
    }

    let loginBtn = end.querySelector("[data-nav-login]");
    if (!loginBtn) {
      loginBtn = document.createElement("button");
      loginBtn.type = "button";
      loginBtn.className = "nav-login";
      loginBtn.setAttribute("data-nav-login", "");
      loginBtn.setAttribute("aria-haspopup", "dialog");
      loginBtn.setAttribute("aria-expanded", "false");
      loginBtn.setAttribute("aria-controls", "auth-modal");
      loginBtn.textContent = "로그인";
      end.appendChild(loginBtn);
    }

    let modal = document.querySelector("[data-auth-modal]");
    if (!modal) {
      modal = document.createElement("div");
      modal.className = "auth-modal";
      modal.id = "auth-modal";
      modal.setAttribute("data-auth-modal", "");
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-labelledby", "auth-modal-title");
      modal.hidden = true;
      modal.innerHTML = `
        <div class="auth-modal-backdrop" data-auth-close tabindex="-1"></div>
        <div class="auth-modal-panel">
          <div class="auth-modal-head">
            <h2 class="auth-modal-title font-display" id="auth-modal-title">로그인</h2>
            <button type="button" class="auth-modal-close" data-auth-close aria-label="닫기">×</button>
          </div>
          <p class="auth-modal-copy">소셜 계정으로 트립엔터에 로그인하세요.</p>
          <div class="auth-provider-list">
            <a class="auth-provider auth-provider-kakao" href="/rest/auth/kakao">
              <span class="auth-provider-mark" aria-hidden="true">K</span>
              <span>카카오로 계속하기</span>
            </a>
            <a class="auth-provider auth-provider-naver" href="/rest/auth/naver">
              <span class="auth-provider-mark" aria-hidden="true">N</span>
              <span>네이버로 계속하기</span>
            </a>
            <a class="auth-provider auth-provider-google" href="/rest/auth/google">
              <span class="auth-provider-mark" aria-hidden="true">G</span>
              <span>구글로 계속하기</span>
            </a>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      loginBtn.addEventListener("click", () => {
        setNavOpen(false);
        setUserMenuOpen(false);
        setAuthOpen(true);
      });

      end.addEventListener("click", (event) => {
        if (event.target.closest("[data-nav-user-toggle]")) {
          setNavOpen(false);
          setAuthOpen(false);
          setProfileOpen(false);
          const menu = document.querySelector("[data-nav-user-menu]");
          setUserMenuOpen(!!(menu && menu.hidden));
          return;
        }
        if (event.target.closest("[data-nav-profile]")) {
          openProfileEditor();
          return;
        }
        if (event.target.closest("[data-nav-logout]")) {
          logout();
        }
      });

      document.addEventListener("click", (event) => {
        const wrap = document.querySelector("[data-nav-user-wrap]");
        if (!wrap || wrap.hidden) return;
        if (event.target.closest("[data-nav-user-wrap]")) return;
        setUserMenuOpen(false);
      });

      modal.addEventListener("click", (event) => {
        if (event.target.closest("[data-auth-close]")) setAuthOpen(false);
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !modal.hidden) setAuthOpen(false);
      });
    }

    refreshAuthUI(loginBtn);
    return { end, loginBtn, modal };
  }

  function ensureMobileShell(navInner) {
    const auth = ensureAuthUI(navInner);

    let toggle = auth.end.querySelector("[data-nav-toggle]");
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "nav-toggle";
      toggle.setAttribute("data-nav-toggle", "");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-controls", "nav-drawer");
      toggle.setAttribute("aria-label", "메뉴 열기");
      toggle.innerHTML = `
        <span class="nav-toggle-bars" aria-hidden="true">
          <span></span><span></span><span></span>
        </span>
      `;
      auth.end.appendChild(toggle);
    }

    let drawer = document.querySelector("[data-nav-drawer]");
    if (!drawer) {
      drawer = document.createElement("div");
      drawer.className = "nav-drawer";
      drawer.id = "nav-drawer";
      drawer.setAttribute("data-nav-drawer", "");
      drawer.setAttribute("role", "navigation");
      drawer.setAttribute("aria-label", "모바일 메뉴");
      drawer.hidden = true;
      // site-nav의 backdrop-filter 스택 밖에 두어 히어로 위에 그린다
      document.body.appendChild(drawer);
    }

    return { toggle, drawer };
  }

  function bindMobileNav({ toggle, drawer }) {
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      setNavOpen(open);
    });

    drawer.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-drawer-toggle]");
      if (!btn || !drawer.contains(btn)) return;
      const panelId = btn.getAttribute("aria-controls");
      const panel = panelId ? drawer.querySelector(`#${panelId}`) : null;
      if (!panel) return;
      const next = btn.getAttribute("aria-expanded") !== "true";
      btn.setAttribute("aria-expanded", next ? "true" : "false");
      panel.hidden = !next;
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setNavOpen(false);
    });

    const onViewportChange = () => {
      if (!MQ_MOBILE.matches) setNavOpen(false);
    };
    if (typeof MQ_MOBILE.addEventListener === "function") {
      MQ_MOBILE.addEventListener("change", onViewportChange);
    } else if (typeof MQ_MOBILE.addListener === "function") {
      MQ_MOBILE.addListener(onViewportChange);
    }
  }

  async function loadMenus() {
    const mount = document.querySelector("[data-dynamic-menu]");
    const navInner = document.querySelector(".nav-inner");
    if (!mount || !navInner) return;

    const shell = ensureMobileShell(navInner);
    bindMobileNav(shell);

    let nickname = null;
    try {
      const authRes = await fetch("/rest/auth/me", { credentials: "same-origin" });
      if (authRes.ok) {
        const auth = await authRes.json();
        if (auth && auth.logged_in && auth.nickname) nickname = String(auth.nickname);
      }
    } catch (_) {
      /* ignore */
    }

    try {
      const res = await fetch(MENU_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        throw new Error(`menu api ${res.status}`);
      }
      const data = await res.json();
      const menus = Array.isArray(data.menus) ? data.menus : [];
      mount.innerHTML = menus.map(renderParent).join("");
      shell.drawer.innerHTML = `
        <div class="nav-drawer-inner">
          ${menus.map(renderMobileParent).join("")}
        </div>
      `;
      bindNavKeyboard(mount);
    } catch (err) {
      console.error("Failed to load WebMenu:", err);
      mount.innerHTML = "";
      shell.drawer.innerHTML = `
        <div class="nav-drawer-inner">
          <p class="nav-drawer-empty">메뉴를 불러오지 못했습니다</p>
        </div>
      `;
    }

    if (nickname) syncJourneyNav(nickname);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadMenus);
  } else {
    loadMenus();
  }
})();
