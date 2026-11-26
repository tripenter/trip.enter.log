(() => {
  const state = {
    activeDialog: null, // view | edit | null
    diaryId: 0,
    regionCode: "",
    regionName: "",
    keepPhotoIds: [],
    existingPhotos: [],
    pendingFiles: [],
    lightboxIndex: 0,
    pendingObjectUrls: [],
    viewTitle: "",
    viewBody: "",
    viewTravelDate: "",
  };

  function todayISODate() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function formatTravelDateLabel(iso) {
    const raw = String(iso || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
    const [y, m, d] = raw.split("-");
    return `${y}.${m}.${d}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function syncBodyOpenClass() {
    const viewOpen = (() => {
      const el = document.querySelector("[data-journey-view-modal]");
      return el && !el.hidden;
    })();
    const editOpen = (() => {
      const el = document.querySelector("[data-journey-edit-modal]");
      return el && !el.hidden;
    })();
    document.body.classList.toggle("is-journey-open", viewOpen || editOpen);
  }

  function setViewOpen(open) {
    const modal = ensureViewModal();
    modal.hidden = !open;
    if (open) state.activeDialog = "view";
    else if (state.activeDialog === "view") state.activeDialog = null;
    syncBodyOpenClass();
    if (!open) setLightboxOpen(false);
  }

  function setEditOpen(open) {
    const modal = ensureEditModal();
    modal.hidden = !open;
    if (open) state.activeDialog = "edit";
    else if (state.activeDialog === "edit") state.activeDialog = null;
    syncBodyOpenClass();
    if (!open) setLightboxOpen(false);
  }

  function closeAllDialogs() {
    setViewOpen(false);
    setEditOpen(false);
  }

  function gallerySources() {
    if (state.activeDialog === "view") {
      return state.existingPhotos.map((p) => p.file_path);
    }
    const existing = state.existingPhotos.map((p) => p.file_path);
    const pending = state.pendingObjectUrls.slice();
    return existing.concat(pending);
  }

  function ensureLightbox() {
    let box = document.querySelector("[data-journey-lightbox]");
    if (box) return box;

    box = document.createElement("div");
    box.className = "journey-lightbox";
    box.setAttribute("data-journey-lightbox", "");
    box.hidden = true;
    box.innerHTML = `
      <div class="journey-lightbox-backdrop" data-lightbox-close tabindex="-1"></div>
      <button type="button" class="journey-lightbox-nav journey-lightbox-prev" data-lightbox-prev aria-label="이전 사진">&lt;</button>
      <figure class="journey-lightbox-figure">
        <img src="" alt="" data-lightbox-image />
        <figcaption class="journey-lightbox-caption" data-lightbox-caption></figcaption>
      </figure>
      <button type="button" class="journey-lightbox-nav journey-lightbox-next" data-lightbox-next aria-label="다음 사진">&gt;</button>
      <button type="button" class="journey-lightbox-close" data-lightbox-close aria-label="닫기">×</button>
    `;
    document.body.appendChild(box);

    box.addEventListener("click", (event) => {
      if (event.target.closest("[data-lightbox-close]")) {
        setLightboxOpen(false);
        return;
      }
      if (event.target.closest("[data-lightbox-prev]")) {
        showLightboxAt(state.lightboxIndex - 1);
        return;
      }
      if (event.target.closest("[data-lightbox-next]")) {
        showLightboxAt(state.lightboxIndex + 1);
      }
    });
    return box;
  }

  function updateLightboxCaption() {
    const box = ensureLightbox();
    const caption = box.querySelector("[data-lightbox-caption]");
    const sources = gallerySources();
    if (!caption) return;
    if (!sources.length) {
      caption.textContent = "";
      return;
    }
    caption.textContent = `${state.lightboxIndex + 1} / ${sources.length}`;
  }

  function showLightboxAt(index) {
    const sources = gallerySources();
    if (!sources.length) {
      setLightboxOpen(false);
      return;
    }
    const next = ((index % sources.length) + sources.length) % sources.length;
    state.lightboxIndex = next;
    const box = ensureLightbox();
    const img = box.querySelector("[data-lightbox-image]");
    if (img) img.src = sources[next];
    updateLightboxCaption();
    const prevBtn = box.querySelector("[data-lightbox-prev]");
    const nextBtn = box.querySelector("[data-lightbox-next]");
    const multi = sources.length > 1;
    if (prevBtn) prevBtn.hidden = !multi;
    if (nextBtn) nextBtn.hidden = !multi;
  }

  function setLightboxOpen(open, index = 0) {
    const box = ensureLightbox();
    box.hidden = !open;
    document.body.classList.toggle("is-journey-lightbox-open", open);
    if (open) showLightboxAt(index);
  }

  function bindDialogPhotoClicks(root) {
    root.addEventListener("click", (event) => {
      const viewBtn = event.target.closest("[data-view-photo]");
      if (!viewBtn) return;
      const index = Number(viewBtn.getAttribute("data-view-photo"));
      if (!Number.isNaN(index)) setLightboxOpen(true, index);
    });
  }

  function ensureViewModal() {
    let modal = document.querySelector("[data-journey-view-modal]");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.className = "journey-modal journey-view-modal";
    modal.setAttribute("data-journey-view-modal", "");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "journey-view-modal-title");
    modal.hidden = true;
    modal.innerHTML = `
      <div class="journey-modal-backdrop" data-journey-view-close tabindex="-1"></div>
      <div class="journey-modal-panel">
        <div class="journey-modal-head">
          <h2 class="journey-modal-title font-display" id="journey-view-modal-title">여행 일기</h2>
          <button type="button" class="journey-modal-close" data-journey-view-close aria-label="닫기">×</button>
        </div>
        <p class="journey-modal-region" data-view-region></p>
        <div class="journey-view">
          <p class="journey-view-date font-mono" data-view-date></p>
          <h3 class="journey-view-title font-display" data-view-title></h3>
          <div class="journey-view-body-scroll" data-view-scroll>
            <div class="journey-view-body" data-view-body></div>
          </div>
          <div class="journey-field journey-view-photos-field">
            <span>사진</span>
            <div class="journey-photos journey-view-photos" data-view-photos></div>
          </div>
          <p class="journey-form-status" data-view-status hidden></p>
          <div class="journey-form-actions">
            <button type="button" class="journey-btn-primary" data-journey-edit>수정</button>
            <button type="button" class="journey-btn-danger" data-journey-delete>삭제</button>
            <button type="button" class="journey-btn-ghost" data-journey-view-close>닫기</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-journey-view-close]")) {
        setViewOpen(false);
        return;
      }
      if (event.target.closest("[data-journey-edit]")) {
        openEditFromView();
        return;
      }
      if (event.target.closest("[data-journey-delete]")) {
        onDelete();
      }
    });
    bindDialogPhotoClicks(modal);
    return modal;
  }

  function ensureEditModal() {
    let modal = document.querySelector("[data-journey-edit-modal]");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.className = "journey-modal journey-edit-modal";
    modal.setAttribute("data-journey-edit-modal", "");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "journey-edit-modal-title");
    modal.hidden = true;
    modal.innerHTML = `
      <div class="journey-modal-backdrop" data-journey-edit-close tabindex="-1"></div>
      <div class="journey-modal-panel">
        <div class="journey-modal-head">
          <h2 class="journey-modal-title font-display" id="journey-edit-modal-title">새 여행 일기</h2>
          <button type="button" class="journey-modal-close" data-journey-edit-close aria-label="닫기">×</button>
        </div>
        <p class="journey-modal-region" data-edit-region></p>
        <form class="journey-form" data-journey-form>
          <label class="journey-field">
            <span>여행일</span>
            <input type="date" name="travel_date" data-journey-travel-date required />
          </label>
          <label class="journey-field">
            <span>제목</span>
            <input type="text" name="title" data-journey-title maxlength="200" required placeholder="이 여행의 제목" />
          </label>
          <label class="journey-field">
            <span>내용</span>
            <textarea name="body" data-journey-body rows="6" placeholder="그날의 풍경, 공기, 이야기를 남겨 주세요"></textarea>
          </label>
          <div class="journey-field">
            <span>사진 (여러 장 한 번에 선택 가능)</span>
            <div class="journey-photos" data-journey-photos></div>
          </div>
          <p class="journey-form-status" data-journey-status hidden></p>
          <div class="journey-form-actions">
            <button type="button" class="journey-btn-ghost" data-journey-edit-close>취소</button>
            <button type="submit" class="journey-btn-primary" data-journey-save>저장</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-journey-edit-close]")) {
        setEditOpen(false);
        return;
      }
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
    bindDialogPhotoClicks(modal);
    modal.querySelector("[data-journey-form]")?.addEventListener("submit", onSave);
    return modal;
  }

  function ensureKeyHandlers() {
    if (document.documentElement.hasAttribute("data-journey-keys")) return;
    document.documentElement.setAttribute("data-journey-keys", "");
    document.addEventListener("keydown", (event) => {
      const lightbox = document.querySelector("[data-journey-lightbox]");
      if (lightbox && !lightbox.hidden) {
        if (event.key === "Escape") {
          setLightboxOpen(false);
          event.stopPropagation();
          return;
        }
        if (event.key === "ArrowLeft") {
          showLightboxAt(state.lightboxIndex - 1);
          return;
        }
        if (event.key === "ArrowRight") {
          showLightboxAt(state.lightboxIndex + 1);
          return;
        }
      }
      if (event.key !== "Escape") return;
      const edit = document.querySelector("[data-journey-edit-modal]");
      if (edit && !edit.hidden) {
        setEditOpen(false);
        return;
      }
      const view = document.querySelector("[data-journey-view-modal]");
      if (view && !view.hidden) setViewOpen(false);
    });
  }

  function renderViewPhotos() {
    const modal = ensureViewModal();
    const grid = modal.querySelector("[data-view-photos]");
    if (!grid) return;
    if (!state.existingPhotos.length) {
      grid.innerHTML = `<p class="journey-view-empty">등록된 사진이 없습니다.</p>`;
      return;
    }
    grid.innerHTML = state.existingPhotos
      .map(
        (photo, index) => `
      <div class="journey-photo-item is-readonly">
        <button type="button" class="journey-photo-view" data-view-photo="${index}" aria-label="사진 크게 보기">
          <img src="${escapeHtml(photo.file_path)}" alt="" />
        </button>
      </div>`
      )
      .join("");
  }

  function renderPhotoGrid() {
    const modal = ensureEditModal();
    const grid = modal.querySelector("[data-journey-photos]");
    if (!grid) return;

    state.pendingObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    state.pendingObjectUrls = state.pendingFiles.map((file) => URL.createObjectURL(file));

    const existingHtml = state.existingPhotos
      .map(
        (photo, index) => `
      <div class="journey-photo-item">
        <button type="button" class="journey-photo-view" data-view-photo="${index}" aria-label="사진 크게 보기">
          <img src="${escapeHtml(photo.file_path)}" alt="" />
        </button>
        <button type="button" class="journey-photo-remove" data-remove-existing="${photo.id}" aria-label="사진 삭제">×</button>
      </div>`
      )
      .join("");

    const pendingOffset = state.existingPhotos.length;
    const pendingHtml = state.pendingObjectUrls
      .map(
        (url, index) => `
      <div class="journey-photo-item">
        <button type="button" class="journey-photo-view" data-view-photo="${pendingOffset + index}" aria-label="사진 크게 보기">
          <img src="${url}" alt="" />
        </button>
        <button type="button" class="journey-photo-remove" data-remove-pending="${index}" aria-label="사진 삭제">×</button>
      </div>`
      )
      .join("");

    grid.innerHTML = `
      ${existingHtml}
      ${pendingHtml}
      <label class="journey-photo-add">
        + 여러 장 추가
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif"
          multiple="multiple"
          data-journey-file
        />
      </label>
    `;

    const fileInput = grid.querySelector("[data-journey-file]");
    if (fileInput) {
      fileInput.multiple = true;
      fileInput.addEventListener("change", (event) => {
        const input = event.target;
        const files = Array.from(input.files || []).filter((file) =>
          String(file.type || "").startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name || "")
        );
        if (!files.length) return;
        state.pendingFiles = state.pendingFiles.concat(files);
        input.value = "";
        renderPhotoGrid();
      });
    }
  }

  function fillViewPanel() {
    const modal = ensureViewModal();
    const dateEl = modal.querySelector("[data-view-date]");
    const titleEl = modal.querySelector("[data-view-title]");
    const bodyEl = modal.querySelector("[data-view-body]");
    const dateLabel = formatTravelDateLabel(state.viewTravelDate);
    if (dateEl) {
      dateEl.textContent = dateLabel ? `여행일 ${dateLabel}` : "";
      dateEl.hidden = !dateLabel;
    }
    if (titleEl) titleEl.textContent = state.viewTitle || "제목 없음";
    if (bodyEl) {
      const text = state.viewBody || "";
      bodyEl.textContent = text.trim() ? text : "내용이 없습니다.";
      bodyEl.classList.toggle("is-empty", !text.trim());
    }
    renderViewPhotos();
  }

  async function ensureLoggedIn() {
    const auth = await fetch("/rest/auth/me", { credentials: "same-origin" }).then((r) => r.json());
    if (!auth || !auth.logged_in) {
      window.location.href = "/index.html";
      return false;
    }
    return true;
  }

  async function loadDiaryIntoState(diaryId) {
    const res = await fetch(`/rest/diary?id=${encodeURIComponent(diaryId)}`, {
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error(`diary ${res.status}`);
    const data = await res.json();
    if (!data.diary) throw new Error("diary missing");
    state.diaryId = data.diary.id;
    state.viewTitle = data.diary.title || "";
    state.viewBody = data.diary.body || "";
    state.viewTravelDate = data.diary.travel_date || "";
    if (data.diary.region) state.regionName = data.diary.region;
    if (data.diary.region_code) state.regionCode = data.diary.region_code;
    state.existingPhotos = Array.isArray(data.diary.photos) ? data.diary.photos : [];
    state.keepPhotoIds = state.existingPhotos.map((p) => p.id);
    state.pendingFiles = [];
  }

  function openEditFromView() {
    const edit = ensureEditModal();
    const heading = edit.querySelector("#journey-edit-modal-title");
    if (heading) heading.textContent = "여행 일기 편집";
    edit.querySelector("[data-edit-region]").textContent = state.regionName;
    edit.querySelector("[data-journey-travel-date]").value = state.viewTravelDate || todayISODate();
    edit.querySelector("[data-journey-title]").value = state.viewTitle || "";
    edit.querySelector("[data-journey-body]").value = state.viewBody || "";
    state.pendingFiles = [];
    state.keepPhotoIds = state.existingPhotos.map((p) => p.id);
    const status = edit.querySelector("[data-journey-status]");
    if (status) {
      status.hidden = true;
      status.textContent = "";
    }
    setViewOpen(false);
    renderPhotoGrid();
    setEditOpen(true);
    edit.querySelector("[data-journey-travel-date]")?.focus();
  }

  async function openDiaryViewer({ code, name, diaryId }) {
    ensureKeyHandlers();
    if (!(await ensureLoggedIn())) return;
    if (!diaryId) {
      openDiaryEditor({ code, name, diaryId: 0 });
      return;
    }

    setEditOpen(false);
    const modal = ensureViewModal();
    state.regionCode = code;
    state.regionName = name;
    state.diaryId = Number(diaryId) || 0;
    state.pendingFiles = [];
    state.existingPhotos = [];
    state.keepPhotoIds = [];
    state.viewTitle = "";
    state.viewBody = "";
    state.viewTravelDate = "";

    modal.querySelector("[data-view-region]").textContent = name;
    const status = modal.querySelector("[data-view-status]");
    if (status) {
      status.hidden = true;
      status.textContent = "";
    }

    setViewOpen(true);

    try {
      await loadDiaryIntoState(state.diaryId);
      modal.querySelector("[data-view-region]").textContent = state.regionName;
      fillViewPanel();
    } catch (err) {
      console.error(err);
      if (status) {
        status.hidden = false;
        status.textContent = "일기를 불러오지 못했습니다.";
      }
    }
  }

  async function openDiaryEditor({ code, name, diaryId = 0 }) {
    ensureKeyHandlers();
    if (!(await ensureLoggedIn())) return;

    setViewOpen(false);
    const modal = ensureEditModal();
    state.diaryId = Number(diaryId) > 0 ? Number(diaryId) : 0;
    state.regionCode = code;
    state.regionName = name;
    state.pendingFiles = [];
    state.existingPhotos = [];
    state.keepPhotoIds = [];
    state.viewTitle = "";
    state.viewBody = "";
    state.viewTravelDate = "";

    const heading = modal.querySelector("#journey-edit-modal-title");
    if (heading) heading.textContent = state.diaryId ? "여행 일기 편집" : "새 여행 일기";
    modal.querySelector("[data-edit-region]").textContent = name;
    modal.querySelector("[data-journey-travel-date]").value = todayISODate();
    modal.querySelector("[data-journey-title]").value = "";
    modal.querySelector("[data-journey-body]").value = "";
    const status = modal.querySelector("[data-journey-status]");
    if (status) {
      status.hidden = true;
      status.textContent = "";
    }

    if (state.diaryId) {
      try {
        await loadDiaryIntoState(state.diaryId);
        modal.querySelector("[data-journey-travel-date]").value = state.viewTravelDate || todayISODate();
        modal.querySelector("[data-journey-title]").value = state.viewTitle || "";
        modal.querySelector("[data-journey-body]").value = state.viewBody || "";
        modal.querySelector("[data-edit-region]").textContent = state.regionName;
      } catch (err) {
        console.error(err);
        if (status) {
          status.hidden = false;
          status.textContent = "기존 일기를 불러오지 못했습니다. 새로 작성할 수 있습니다.";
        }
        state.diaryId = 0;
        if (heading) heading.textContent = "새 여행 일기";
      }
    }

    renderPhotoGrid();
    setEditOpen(true);
    modal.querySelector("[data-journey-travel-date]")?.focus();
  }

  async function onDelete() {
    if (!state.diaryId) return;
    if (!window.confirm("이 여행 일기를 삭제할까요? 사진도 함께 삭제됩니다.")) return;

    const modal = ensureViewModal();
    const status = modal.querySelector("[data-view-status]");
    const deleteBtn = modal.querySelector("[data-journey-delete]");
    if (deleteBtn) deleteBtn.disabled = true;
    if (status) {
      status.hidden = false;
      status.textContent = "삭제 중…";
    }
    try {
      const res = await fetch(`/rest/diary?id=${encodeURIComponent(state.diaryId)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (res.status === 401) {
        window.location.href = "/index.html";
        return;
      }
      if (!res.ok) throw new Error(`delete ${res.status}`);
      closeAllDialogs();
      if (window.__journeyReloadItems) window.__journeyReloadItems();
    } catch (err) {
      console.error(err);
      if (status) status.textContent = "삭제에 실패했습니다. 다시 시도해 주세요.";
    } finally {
      if (deleteBtn) deleteBtn.disabled = false;
    }
  }

  async function onSave(event) {
    event.preventDefault();
    const modal = ensureEditModal();
    const saveBtn = modal.querySelector("[data-journey-save]");
    const status = modal.querySelector("[data-journey-status]");
    const travelDate = modal.querySelector("[data-journey-travel-date]")?.value || "";
    const title = modal.querySelector("[data-journey-title]")?.value || "";
    const body = modal.querySelector("[data-journey-body]")?.value || "";
    if (!travelDate) {
      if (status) {
        status.hidden = false;
        status.textContent = "여행일을 선택해 주세요.";
      }
      return;
    }
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
    form.append("travel_date", travelDate);
    form.append("title", title.trim());
    form.append("body", body);
    form.append("keep_photo_ids", state.keepPhotoIds.join(","));
    if (state.diaryId > 0) form.append("diary_id", String(state.diaryId));
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
      let payload = null;
      try {
        payload = await res.json();
      } catch (_) {
        payload = null;
      }
      if (res.status === 401) {
        if (status) status.textContent = "로그인이 만료되었습니다. 다시 로그인해 주세요.";
        setTimeout(() => {
          window.location.href = "/index.html";
        }, 800);
        return;
      }
      if (!res.ok) {
        const msg =
          (payload && (payload.message || payload.error)) ||
          `save ${res.status}`;
        throw new Error(msg);
      }
      if (status) status.textContent = "저장했습니다.";
      setTimeout(() => {
        closeAllDialogs();
        if (window.__journeyReloadItems) window.__journeyReloadItems();
      }, 400);
    } catch (err) {
      console.error(err);
      if (status) {
        const detail = err && err.message ? String(err.message) : "";
        status.textContent = detail && detail !== "save failed"
          ? `저장에 실패했습니다. (${detail})`
          : "저장에 실패했습니다. 다시 시도해 주세요.";
      }
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
        travelDate: d.travel_date || "",
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
    const listHtml = (items || [])
      .map((item) => {
        const cover = item.coverPath || (item.covers && item.covers[0]) || "";
        const coverHtml = cover
          ? `<img src="${esc(cover)}" alt="" data-journey-cover />`
          : `<span class="font-mono">diary</span>`;
        const dateLabel = formatTravelDateLabel(item.travelDate);
        const meta = dateLabel
          ? `여행일 ${dateLabel} · 사진 ${item.photoCount || 0}장`
          : `사진 ${item.photoCount || 0}장`;
        return `
          <button type="button" class="korea-choice-item" data-open-diary="${esc(String(item.id || ""))}" style="width:100%;text-align:left;cursor:pointer;border:0;background:#fff">
            <span class="korea-choice-cover${cover ? "" : " is-fallback"}">${coverHtml}</span>
            <span class="korea-choice-body">
              <strong>${esc(item.title || "여행 일기")}</strong>
              <em>${esc(meta)}</em>
            </span>
          </button>`;
      })
      .join("");

    const count = (items || []).length;
    return `
      <div class="korea-choice">
        <p class="korea-choice-heading">${esc(ctx.name)}</p>
        <p class="korea-choice-sub font-mono">여행 일기 ${count}개</p>
        <div class="korea-choice-list">
          ${listHtml}
          <button type="button" class="korea-choice-record" data-new-diary>기록</button>
        </div>
      </div>
    `;
  }

  async function boot() {
    ensureKeyHandlers();
    const meRes = await fetch("/rest/auth/me", { credentials: "same-origin" });
    const me = meRes.ok ? await meRes.json() : null;
    if (!me || !me.logged_in || !me.account_id) {
      window.location.href = "/index.html";
      return;
    }
    const title = document.querySelector("[data-journey-title]");
    if (title && me.nickname) title.textContent = `${me.nickname}님의 여정`;

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
        withItems: "기록이 있는 지역은 강조됩니다. 일기를 선택하거나 새로 작성하세요.",
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
      onRegionClick: ({ code, name, items }) => {
        if (items && items.length) return;
        openDiaryEditor({ code, name, diaryId: 0 });
      },
      onPopupReady: (root, items, ctx) => {
        root.querySelectorAll("[data-open-diary]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const diaryId = Number(btn.getAttribute("data-open-diary")) || 0;
            const code = (ctx && ctx.code) || (items[0] && items[0].codes && items[0].codes[0]) || "";
            const name =
              (ctx && ctx.name) ||
              (items[0] && (items[0].districtLabel || items[0].region)) ||
              "";
            openDiaryViewer({ code: String(code), name, diaryId });
          });
        });
        root.querySelector("[data-new-diary]")?.addEventListener("click", () => {
          const code = (ctx && ctx.code) || (items[0] && items[0].codes && items[0].codes[0]) || "";
          const name =
            (ctx && ctx.name) ||
            (items[0] && (items[0].districtLabel || items[0].region)) ||
            "";
          openDiaryEditor({ code: String(code), name, diaryId: 0 });
        });
        root.querySelectorAll("[data-journey-cover]").forEach((coverImg) => {
          coverImg.addEventListener("error", () => {
            const box = coverImg.closest(".korea-choice-cover");
            if (!box) return;
            box.classList.add("is-fallback");
            box.innerHTML = `<span class="font-mono">diary</span>`;
          });
        });
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
