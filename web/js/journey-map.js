(() => {
  const state = {
    regionCode: "",
    regionName: "",
    keepPhotoIds: [],
    existingPhotos: [],
    pendingFiles: [],
  };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setJourneyOpen(open) {
    const modal = document.querySelector("[data-journey-modal]");
    if (!modal) return;
    modal.hidden = !open;
    document.body.classList.toggle("is-journey-open", open);
  }

  function ensureModal() {
    let modal = document.querySelector("[data-journey-modal]");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.className = "journey-modal";
    modal.setAttribute("data-journey-modal", "");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "journey-modal-title");
    modal.hidden = true;
    modal.innerHTML = `
      <div class="journey-modal-backdrop" data-journey-close tabindex="-1"></div>
      <div class="journey-modal-panel">
        <div class="journey-modal-head">
          <h2 class="journey-modal-title font-display" id="journey-modal-title">여행 일기</h2>
          <button type="button" class="journey-modal-close" data-journey-close aria-label="닫기">×</button>
        </div>
        <p class="journey-modal-region" data-journey-region></p>
        <form class="journey-form" data-journey-form>
          <label class="journey-field">
            <span>제목</span>
            <input type="text" name="title" data-journey-title maxlength="200" required placeholder="이 여행의 제목" />
          </label>
          <label class="journey-field">
            <span>내용</span>
            <textarea name="body" data-journey-body rows="6" placeholder="그날의 풍경, 공기, 이야기를 남겨 주세요"></textarea>
          </label>
          <div class="journey-field">
            <span>사진 (개수 제한 없음)</span>
            <div class="journey-photos" data-journey-photos></div>
          </div>
          <p class="journey-form-status" data-journey-status hidden></p>
          <div class="journey-form-actions">
            <button type="button" class="journey-btn-ghost" data-journey-close>취소</button>
            <button type="submit" class="journey-btn-primary" data-journey-save>저장</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-journey-close]")) setJourneyOpen(false);
      const removeBtn = event.target.closest("[data-remove-existing]");
      if (removeBtn) {
        const id = Number(removeBtn.getAttribute("data-remove-existing"));
        state.keepPhotoIds = state.keepPhotoIds.filter((x) => x !== id);
        state.existingPhotos = state.existingPhotos.filter((p) => p.id !== id);
        renderPhotoGrid();
        return;
      }
      const removePending = event.target.closest("[data-remove-pending]");
      if (removePending) {
        const idx = Number(removePending.getAttribute("data-remove-pending"));
        state.pendingFiles.splice(idx, 1);
        renderPhotoGrid();
      }
    });

    modal.querySelector("[data-journey-form]")?.addEventListener("submit", onSave);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modal.hidden) setJourneyOpen(false);
    });
    return modal;
  }

  function renderPhotoGrid() {
    const modal = ensureModal();
    const grid = modal.querySelector("[data-journey-photos]");
    if (!grid) return;

    const existingHtml = state.existingPhotos
      .map(
        (photo) => `
      <div class="journey-photo-item">
        <img src="${escapeHtml(photo.file_path)}" alt="" />
        <button type="button" class="journey-photo-remove" data-remove-existing="${photo.id}" aria-label="사진 삭제">×</button>
      </div>`
      )
      .join("");

    const pendingHtml = state.pendingFiles
      .map((file, index) => {
        const url = URL.createObjectURL(file);
        return `
      <div class="journey-photo-item">
        <img src="${url}" alt="" data-object-url="${url}" />
        <button type="button" class="journey-photo-remove" data-remove-pending="${index}" aria-label="사진 삭제">×</button>
      </div>`;
      })
      .join("");

    grid.innerHTML = `
      ${existingHtml}
      ${pendingHtml}
      <label class="journey-photo-add">
        + 사진 추가
        <input type="file" accept="image/*" multiple data-journey-file />
      </label>
    `;

    grid.querySelector("[data-journey-file]")?.addEventListener("change", (event) => {
      const input = event.target;
      const files = Array.from(input.files || []);
      if (!files.length) return;
      state.pendingFiles = state.pendingFiles.concat(files);
      input.value = "";
      renderPhotoGrid();
    });
  }

  async function openDiaryEditor({ code, name }) {
    const auth = await fetch("/rest/auth/me", { credentials: "same-origin" }).then((r) => r.json());
    if (!auth || !auth.logged_in) {
      window.location.href = "/index.html";
      return;
    }

    const modal = ensureModal();
    state.regionCode = code;
    state.regionName = name;
    state.pendingFiles = [];
    state.existingPhotos = [];
    state.keepPhotoIds = [];

    modal.querySelector("[data-journey-region]").textContent = name;
    modal.querySelector("[data-journey-title]").value = "";
    modal.querySelector("[data-journey-body]").value = "";
    const status = modal.querySelector("[data-journey-status]");
    if (status) {
      status.hidden = true;
      status.textContent = "";
    }

    try {
      const res = await fetch(`/rest/diary/by-region?code=${encodeURIComponent(code)}`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`diary ${res.status}`);
      const data = await res.json();
      if (data.diary) {
        modal.querySelector("[data-journey-title]").value = data.diary.title || "";
        modal.querySelector("[data-journey-body]").value = data.diary.body || "";
        state.existingPhotos = Array.isArray(data.diary.photos) ? data.diary.photos : [];
        state.keepPhotoIds = state.existingPhotos.map((p) => p.id);
      }
    } catch (err) {
      console.error(err);
      if (status) {
        status.hidden = false;
        status.textContent = "기존 일기를 불러오지 못했습니다. 새로 작성할 수 있습니다.";
      }
    }

    renderPhotoGrid();
    setJourneyOpen(true);
    modal.querySelector("[data-journey-title]")?.focus();
  }

  async function onSave(event) {
    event.preventDefault();
    const modal = ensureModal();
    const saveBtn = modal.querySelector("[data-journey-save]");
    const status = modal.querySelector("[data-journey-status]");
    const title = modal.querySelector("[data-journey-title]")?.value || "";
    const body = modal.querySelector("[data-journey-body]")?.value || "";
    if (!title.trim()) {
      if (status) {
        status.hidden = false;
        status.textContent = "제목을 입력해 주세요.";
      }
      return;
    }

    const form = new FormData();
    form.append("region", state.regionName);
    form.append("region_code", state.regionCode);
    form.append("title", title.trim());
    form.append("body", body);
    form.append("keep_photo_ids", state.keepPhotoIds.join(","));
    state.pendingFiles.forEach((file) => form.append("photos", file, file.name));

    if (saveBtn) saveBtn.disabled = true;
    if (status) {
      status.hidden = false;
      status.textContent = "저장 중…";
    }
    try {
      const res = await fetch("/rest/diary", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      if (!res.ok) throw new Error(`save ${res.status}`);
      if (status) status.textContent = "저장했습니다.";
      setTimeout(() => {
        setJourneyOpen(false);
        if (window.__journeyReloadItems) window.__journeyReloadItems();
      }, 400);
    } catch (err) {
      console.error(err);
      if (status) status.textContent = "저장에 실패했습니다. 다시 시도해 주세요.";
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  function diariesToMapItems(diaries) {
    return (diaries || []).map((d) => {
      const cover = String(d.cover_path || "").trim();
      return {
        id: d.id,
        title: d.title || d.region,
        region: d.region,
        codes: [String(d.region_code)],
        href: "#",
        covers: cover ? [cover] : [],
        coverPath: cover,
        districtLabel: d.region,
        photoCount: d.photo_count || 0,
      };
    });
  }

  async function loadMyDiaries() {
    const res = await fetch("/rest/diary/mine", { credentials: "same-origin" });
    if (res.status === 401) {
      window.location.href = "/index.html";
      return [];
    }
    if (!res.ok) throw new Error(`mine ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.diaries) ? data.diaries : [];
  }

  function renderHoverPopup(items, ctx) {
    const { escapeHtml: esc } = window.TripEnterSigMap;
    const item = items[0];
    const cover = item.coverPath || (item.covers && item.covers[0]) || "";
    const coverHtml = cover
      ? `<img src="${esc(cover)}" alt="" data-journey-cover />`
      : `<span class="font-mono">diary</span>`;
    return `
      <div class="korea-choice">
        <p class="korea-choice-heading">${esc(ctx.name)}</p>
        <p class="korea-choice-sub font-mono">여행 일기 · 클릭하여 편집</p>
        <div class="korea-choice-list">
          <button type="button" class="korea-choice-item" data-open-diary style="width:100%;text-align:left;cursor:pointer;border:0;background:#fff">
            <span class="korea-choice-cover${cover ? "" : " is-fallback"}">${coverHtml}</span>
            <span class="korea-choice-body">
              <strong>${esc(item.title || "여행 일기")}</strong>
              <em>사진 ${item.photoCount || 0}장</em>
            </span>
          </button>
        </div>
      </div>
    `;
  }

  async function boot() {
    const meRes = await fetch("/rest/auth/me", { credentials: "same-origin" });
    const me = meRes.ok ? await meRes.json() : null;
    if (!me || !me.logged_in) {
      window.location.href = "/index.html";
      return;
    }
    const title = document.querySelector("[data-journey-title]");
    if (title && me.nickname) title.textContent = `${me.nickname}의 여정`;

    if (!window.TripEnterSigMap) {
      console.error("TripEnterSigMap missing");
      return;
    }

    let mapApi = null;
    const instance = window.TripEnterSigMap.create({
      el: "#korea-map",
      statusEl: "[data-korea-status]",
      geoUrl: "../data/korea-sig.geojson",
      zoomOffset: 1,
      messages: {
        idle: "시·군·구를 클릭하면 여행 일기를 작성할 수 있습니다.",
        withItems: "기록이 있는 지역은 강조됩니다. 클릭해 일기를 편집하세요.",
        emptyClick: "이 지역의 여행 일기를 작성해 보세요.",
      },
      loadItems: async () => {
        try {
          const diaries = await loadMyDiaries();
          return diariesToMapItems(diaries);
        } catch (err) {
          console.error(err);
          return [];
        }
      },
      renderHoverPopup,
      renderEmptyClick: () => `<p class="korea-soon-text">클릭하여 여행 일기를 작성하세요</p>`,
      onRegionClick: ({ code, name }) => {
        openDiaryEditor({ code, name });
      },
      onPopupReady: (root, items) => {
        const item = items[0];
        root.querySelector("[data-open-diary]")?.addEventListener("click", () => {
          const code = (item.codes && item.codes[0]) || "";
          openDiaryEditor({ code: String(code), name: item.districtLabel || item.region || "" });
        });
        const coverImg = root.querySelector("[data-journey-cover]");
        if (coverImg) {
          coverImg.addEventListener("error", () => {
            const box = coverImg.closest(".korea-choice-cover");
            if (!box) return;
            box.classList.add("is-fallback");
            box.innerHTML = `<span class="font-mono">diary</span>`;
          });
        }
      },
    });
    mapApi = instance;
    window.__journeyReloadItems = async () => {
      try {
        const diaries = await loadMyDiaries();
        mapApi.setItems(diariesToMapItems(diaries));
      } catch (err) {
        console.error(err);
      }
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
