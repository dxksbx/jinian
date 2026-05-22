// ── State ──
let photosByLocation = {};   // { locationName: [photo, ...] }
let locations = {};           // { name: { coverImage, photoCount, ... } }
let currentLocation = '';     // location currently in view
let currentLightboxIdx = -1;
let contextTarget = null;
let uploading = false;
let confirmResolve = null;
let loadingCount = 0;
let sectionObserver = null;

// ── DOM refs ──
const $ = (s) => document.querySelector(s);
const scrollContainer = $('#scrollContainer');
const lightbox = $('#lightbox');
const lightboxImg = $('#lightboxImg');
const lightboxCaption = $('#lightboxCaption');
const lightboxDate = $('#lightboxDate');
const fileInput = $('#fileInput');
const contextMenu = $('#contextMenu');
const editModal = $('#editModal');
const createLocationModal = $('#createLocationModal');
const confirmModal = $('#confirmModal');
const toast = $('#toast');
const loading = $('#loading');

// ============================================================
//  UTIL
// ============================================================

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function showLoading() { loadingCount++; loading.classList.add('show'); }
function hideLoading() { loadingCount = Math.max(0, loadingCount - 1); if (loadingCount === 0) loading.classList.remove('show'); }

let toastTimer;
function toastMsg(msg) {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function showConfirm(title, msg) {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    $('#confirmTitle').textContent = title;
    $('#confirmMsg').textContent = msg;
    confirmModal.classList.add('open');
  });
}

function closeConfirm(result) {
  confirmModal.classList.remove('open');
  if (confirmResolve) { confirmResolve(result); confirmResolve = null; }
}

// ============================================================
//  SCATTER ZONES
// ============================================================

const SCATTER_ZONES = [
  { tx: -35, ty: -33 },  // top-left
  { tx:   5, ty: -33 },  // top-right
  { tx: -35, ty:   5 },  // bottom-left
  { tx:   5, ty:   5 },  // bottom-right
  { tx: -15, ty: -15 },  // center
];

function assignScatterPositions(photos) {
  return photos.map((p, i) => {
    const zone = SCATTER_ZONES[i % SCATTER_ZONES.length];
    // Add jitter for photos sharing the same zone
    const jx = Math.floor(i / SCATTER_ZONES.length) * 6;
    const jy = Math.floor(i / SCATTER_ZONES.length) * 4;
    const signX = i % 2 === 0 ? 1 : -1;
    const signY = i % 3 === 0 ? 1 : -1;
    return {
      ...p,
      tx: zone.tx + jx * signX,
      ty: zone.ty + jy * signY,
      z: i,
    };
  });
}

// ============================================================
//  BUILD UI
// ============================================================

function buildAllSections() {
  scrollContainer.innerHTML = '';

  // Merge location names from both locations.json and photosByLocation
  // so photos with a valid location are never invisible even if
  // locations.json is empty or out of sync (e.g. fresh Bonto deploy)
  const locNames = new Set([
    ...Object.keys(locations),
    ...Object.keys(photosByLocation).filter(Boolean),
  ]);
  const names = [...locNames].sort((a, b) => {
    const ta = locations[a]?.createdAt || '0';
    const tb = locations[b]?.createdAt || '0';
    return tb.localeCompare(ta);
  });

  if (names.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'location-section';
    empty.style.justifyContent = 'center';
    empty.style.alignItems = 'center';
    empty.style.textAlign = 'center';
    empty.innerHTML = `<div style="color:var(--text-tertiary)"><p style="font-size:1.2rem;margin-bottom:8px;">还没有地点</p><p class="empty-hint" style="font-size:0.78rem;color:var(--text-tertiary)">点击下方"创建地点"开始</p></div>`;
    scrollContainer.appendChild(empty);
  } else {
    names.forEach(name => buildLocationSection(name));
  }

  setupIntersectionObserver();
  updateNavVisibility();
}

function buildLocationSection(locName, beforeNode = null) {
  const photos = photosByLocation[locName] || [];
  const loc = locations[locName] || {};
  const desc = loc.description || '';

  const section = document.createElement('section');
  section.className = 'location-section';
  section.dataset.location = locName;

  // Cover image as dimmed background
  if (loc.coverImage) {
    section.style.setProperty('--cover', `url('/covers/${esc(loc.coverImage)}')`);
  }

  // Left text
  const descHtml = desc ? `<p class="location-desc">${esc(desc)}</p>` : '';
  section.innerHTML = `
    <div class="location-text">
      <h2 class="location-name">${esc(locName)}</h2>
      ${descHtml}
      <span class="photo-count-hint">${photos.length} 张照片</span>
      <div class="location-actions">
        <button class="location-action-btn" data-action="edit-desc" data-location="${esc(locName)}">编辑描述</button>
        <button class="location-action-btn" data-action="delete-loc" data-location="${esc(locName)}" style="color:#d4736a;">删除地点</button>
      </div>
    </div>
    <div class="photo-area"></div>
  `;

  const photoArea = section.querySelector('.photo-area');

  if (photos.length > 0) {
    buildPhotoStack(photoArea, photos, locName);
  } else {
    const emptyStack = document.createElement('div');
    emptyStack.className = 'photo-stack-empty';
    emptyStack.innerHTML = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><p>还没有照片</p><p class="empty-hint">点击下方按钮添加</p>`;
    photoArea.appendChild(emptyStack);
  }

  if (beforeNode) {
    scrollContainer.insertBefore(section, beforeNode);
  } else {
    scrollContainer.appendChild(section);
  }
}

// ── Photo Stack ──

function buildPhotoStack(container, photos, locName) {
  const stack = document.createElement('div');
  stack.className = 'photo-stack';
  stack.dataset.location = locName;

  const scattered = assignScatterPositions(photos);

  scattered.forEach((p, i) => {
    const img = document.createElement('img');
    img.className = 'stack-photo';
    img.src = `/photos/${esc(p.filename)}`;
    img.alt = esc(p.caption || '');
    img.loading = 'lazy';
    img.dataset.filename = p.filename;
    img.dataset.index = i;
    img.style.setProperty('--r', `${(i % 5 - 2) * 1.5}deg`);
    img.style.setProperty('--scatter-tx', `${p.tx}%`);
    img.style.setProperty('--scatter-ty', `${p.ty}%`);
    img.style.zIndex = p.z;

    img.addEventListener('click', (e) => {
      if (!stack.classList.contains('scattered')) {
        // Stacked: click to scatter first, then open lightbox on second click
        stack.classList.add('scattered');
      } else {
        e.stopPropagation();
        openLightboxForLocation(locName, parseInt(img.dataset.index));
      }
    });

    img.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      contextTarget = { filename: p.filename, location: locName };
      showContextMenu(e.clientX, e.clientY);
    });

    stack.appendChild(img);
  });

  // Hover handlers for scatter
  stack.addEventListener('mouseenter', () => {
    stack.classList.add('scattered');
  });

  stack.addEventListener('mouseleave', () => {
    stack.classList.remove('scattered');
  });

  container.appendChild(stack);
}

// ── Rebuild a single location section (after photo changes) ──

function rebuildLocationSection(locName) {
  const old = scrollContainer.querySelector(`.location-section[data-location="${CSS.escape(locName)}"]`);
  if (!old) return;
  const nextSibling = old.nextSibling;
  old.remove();
  buildLocationSection(locName, nextSibling);
  setupIntersectionObserver();
  updateNavVisibility();
}

// ── Incremental section add / remove (avoids full rebuild) ──

function appendLocationSection(locName, scrollTo = false) {
  // Remove empty-state if present
  const empty = scrollContainer.querySelector('.location-section[data-location]');
  // Only remove actual empty-state sections (no data-location)
  const allSections = scrollContainer.querySelectorAll('.location-section');
  // Check if we have a "no locations" placeholder
  if (allSections.length === 1 && !allSections[0].dataset.location) {
    allSections[0].remove();
  }

  buildLocationSection(locName);
  setupIntersectionObserver();
  updateNavVisibility();

  if (scrollTo) {
    scrollToSection(locName);
  }
}

function removeLocationSection(locName) {
  const section = scrollContainer.querySelector(`.location-section[data-location="${CSS.escape(locName)}"]`);
  if (section) section.remove();
  delete locations[locName];
  delete photosByLocation[locName];

  // If no sections left, rebuild to show empty state
  const remaining = scrollContainer.querySelectorAll('.location-section[data-location]');
  if (remaining.length === 0) {
    buildAllSections();
  } else {
    setupIntersectionObserver();
    updateNavVisibility();
    // Snap to nearest remaining section
    requestAnimationFrame(() => {
      const idx = getCurrentSectionIndex();
      if (idx >= 0) goToSection(idx);
    });
  }
}

function scrollToSection(locName) {
  // Wait for layout after DOM insert
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const section = scrollContainer.querySelector(`.location-section[data-location="${CSS.escape(locName)}"]`);
      if (section) {
        section.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
}

// ============================================================
//  NAV BUTTONS
// ============================================================

function getSections() {
  return [...scrollContainer.querySelectorAll('.location-section')];
}

function getCurrentSectionIndex() {
  const sections = getSections();
  if (!sections.length) return -1;
  const viewTop = scrollContainer.scrollTop;
  let bestIdx = 0, bestDist = Infinity;
  sections.forEach((s, i) => {
    const dist = Math.abs(s.offsetTop - viewTop);
    if (dist < bestDist) { bestDist = dist; best = s; bestIdx = i; }
  });
  return bestIdx;
}

function goToSection(idx) {
  const sections = getSections();
  if (idx < 0 || idx >= sections.length) return;
  sections[idx].scrollIntoView({ behavior: 'smooth' });
}

// Re-snap on window resize — only if section is significantly misaligned
let resizeDebounce = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeDebounce);
  resizeDebounce = setTimeout(() => {
    const sections = getSections();
    if (!sections.length) return;
    const viewTop = scrollContainer.scrollTop;
    const viewH = scrollContainer.clientHeight;
    let bestSection = null, bestDist = Infinity;
    sections.forEach(s => {
      const dist = Math.abs(s.offsetTop - viewTop);
      if (dist < bestDist) { bestDist = dist; bestSection = s; }
    });
    // Only re-snap if section is more than 30% off-screen
    if (bestSection && bestDist > viewH * 0.3) {
      bestSection.scrollIntoView({ behavior: 'instant' });
    }
  }, 150);
});

$('#navPrev').addEventListener('click', () => {
  const idx = getCurrentSectionIndex();
  goToSection(idx - 1);
});

$('#navNext').addEventListener('click', () => {
  const idx = getCurrentSectionIndex();
  goToSection(idx + 1);
});

// Keyboard nav
document.addEventListener('keydown', (e) => {
  if (lightbox.classList.contains('open')) return;
  if (editModal.classList.contains('open')) return;
  if (createLocationModal.classList.contains('open')) return;
  if (confirmModal.classList.contains('open')) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
    e.preventDefault();
    const idx = getCurrentSectionIndex();
    goToSection(idx + 1);
  }
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
    e.preventDefault();
    const idx = getCurrentSectionIndex();
    goToSection(idx - 1);
  }
});

// ============================================================
//  INTERSECTION OBSERVER (track current location)
// ============================================================

function updateNavVisibility() {
  const sections = getSections();
  const idx = getCurrentSectionIndex();
  const total = sections.length;

  const prevBtn = $('#navPrev');
  const nextBtn = $('#navNext');

  if (total <= 1) {
    prevBtn.style.opacity = '0';
    prevBtn.style.pointerEvents = 'none';
    nextBtn.style.opacity = '0';
    nextBtn.style.pointerEvents = 'none';
    return;
  }

  // First section: hide prev
  if (idx <= 0) {
    prevBtn.style.opacity = '0';
    prevBtn.style.pointerEvents = 'none';
  } else {
    prevBtn.style.opacity = '';
    prevBtn.style.pointerEvents = '';
  }

  // Last section: hide next
  if (idx >= total - 1) {
    nextBtn.style.opacity = '0';
    nextBtn.style.pointerEvents = 'none';
  } else {
    nextBtn.style.opacity = '';
    nextBtn.style.pointerEvents = '';
  }
}

function setupIntersectionObserver() {
  if (sectionObserver) sectionObserver.disconnect();

  sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
        currentLocation = entry.target.dataset.location || '';
        updateUploadLabel();
        updateNavVisibility();
      }
    });
  }, { threshold: [0.5] });

  scrollContainer.querySelectorAll('.location-section').forEach(s => {
    sectionObserver.observe(s);
  });
}

function updateUploadLabel() {
  const label = $('#uploadLabel');
  if (currentLocation) {
    label.querySelector('span').textContent = `添加照片到 "${currentLocation}"`;
  } else {
    label.querySelector('span').textContent = '添加照片';
  }
}

// ============================================================
//  LIGHTBOX
// ============================================================

function openLightboxForLocation(locName, idx) {
  const photos = photosByLocation[locName] || [];
  if (!photos.length) return;
  currentLightboxIdx = idx;
  currentLocation = locName;
  updateLightboxImage(photos);
  lightbox.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function updateLightboxImage(photos) {
  const pool = photos || photosByLocation[currentLocation] || [];
  const p = pool[currentLightboxIdx];
  if (!p) return;
  lightboxImg.src = `/photos/${p.filename}`;
  lightboxCaption.textContent = p.caption || '';
  lightboxDate.textContent = p.date || '';
}

function closeLightbox() {
  lightbox.classList.remove('open');
  document.body.style.overflow = '';
}

function lbPrev() {
  const pool = photosByLocation[currentLocation] || [];
  if (!pool.length) return;
  currentLightboxIdx = (currentLightboxIdx - 1 + pool.length) % pool.length;
  updateLightboxImage(pool);
}

function lbNext() {
  const pool = photosByLocation[currentLocation] || [];
  if (!pool.length) return;
  currentLightboxIdx = (currentLightboxIdx + 1) % pool.length;
  updateLightboxImage(pool);
}

// ============================================================
//  CONTEXT MENU
// ============================================================

function showContextMenu(x, y) {
  contextMenu.style.left = Math.min(x, window.innerWidth - 150) + 'px';
  contextMenu.style.top = Math.min(y, window.innerHeight - 110) + 'px';
  contextMenu.classList.add('open');
}

function hideContextMenu() {
  contextMenu.classList.remove('open');
  contextTarget = null;
}

// ============================================================
//  EDIT MODAL
// ============================================================

function openEditModal(filename) {
  // Search all locations for the photo
  let photo = null;
  for (const [loc, photos] of Object.entries(photosByLocation)) {
    photo = photos.find(p => p.filename === filename);
    if (photo) break;
  }
  if (!photo) return;

  $('#editFilename').value = filename;
  $('#editLocation').value = photo.location || '';
  $('#editCaption').value = photo.caption || '';
  $('#editDate').value = photo.date || '';
  editModal.classList.add('open');
}

function closeEditModal() {
  editModal.classList.remove('open');
}

// ============================================================
//  API CALLS
// ============================================================

async function fetchAllData() {
  try {
    const [locRes, photoRes] = await Promise.all([
      fetch('/api/locations'),
      fetch('/api/photos'),
    ]);
    if (locRes.ok) locations = await locRes.json();
    if (photoRes.ok) {
      const allPhotos = await photoRes.json();
      // Group photos by location
      photosByLocation = {};
      allPhotos.forEach(p => {
        const loc = p.location || '';
        if (!photosByLocation[loc]) photosByLocation[loc] = [];
        photosByLocation[loc].push(p);
      });
    }
  } catch (e) {
    console.error(e);
    toastMsg('加载数据失败');
  }
}

async function refreshLocation(locName) {
  try {
    const res = await fetch('/api/photos?location=' + encodeURIComponent(locName));
    if (res.ok) {
      photosByLocation[locName] = await res.json();
    }
    const locRes = await fetch('/api/locations');
    if (locRes.ok) locations = await locRes.json();
  } catch (e) {
    console.error(e);
  }
}

// ============================================================
//  UPLOAD
// ============================================================

async function uploadFiles(locationName, files) {
  if (uploading) return 0;
  if (!files.length) return 0;
  if (!locationName) {
    toastMsg('请先滚动到某个地点再添加照片');
    return 0;
  }

  uploading = true;
  showLoading();
  toastMsg(`正在上传 ${files.length} 张照片…`);

  let saved = 0;
  for (const f of files) {
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('读取失败'));
        reader.readAsDataURL(f);
      });

      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ filename: f.name, data: dataUrl, location: locationName }]),
      });
      if (!res.ok) throw new Error('服务器错误');
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      if (result.saved?.length) saved++;
    } catch (e) {
      console.error(`上传 ${f.name} 失败:`, e);
    }
  }

  uploading = false;
  hideLoading();

  if (saved > 0) {
    toastMsg(`已添加 ${saved} 张照片`);
    await refreshLocation(locationName);
    rebuildLocationSection(locationName);
  } else {
    toastMsg('上传失败，请重试');
  }

  return saved;
}

fileInput.addEventListener('change', async () => {
  const files = Array.from(fileInput.files);
  fileInput.value = '';
  if (files.length) await uploadFiles(currentLocation, files);
});

// ── Drag & Drop to location sections ──

let dragTargetSection = null;

function clearDragHighlight() {
  if (dragTargetSection) {
    const photoArea = dragTargetSection.querySelector('.photo-area');
    if (photoArea) photoArea.classList.remove('drag-over');
  }
  dragTargetSection = null;
}

scrollContainer.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (!e.dataTransfer) return;
  e.dataTransfer.dropEffect = 'copy';

  const section = e.target.closest('.location-section');
  const locName = section?.dataset.location;
  if (!locName) return;

  if (dragTargetSection !== section) {
    clearDragHighlight();
    dragTargetSection = section;
    const photoArea = section.querySelector('.photo-area');
    if (photoArea) photoArea.classList.add('drag-over');
  }
});

scrollContainer.addEventListener('dragleave', (e) => {
  // Only clear when actually leaving the container, not entering a child
  if (!scrollContainer.contains(e.relatedTarget)) {
    clearDragHighlight();
  }
});

scrollContainer.addEventListener('drop', async (e) => {
  e.preventDefault();
  const targetSection = dragTargetSection;
  clearDragHighlight();

  const locName = targetSection?.dataset.location;
  if (!locName) return;

  const files = e.dataTransfer?.files;
  if (!files || !files.length) return;

  const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (imageFiles.length) await uploadFiles(locName, imageFiles);
});

// Cleanup if drag is cancelled (e.g. Esc key)
document.addEventListener('dragend', () => {
  clearDragHighlight();
});

// ============================================================
//  CREATE LOCATION
// ============================================================

let coverFile = null;
let coverDataUrl = '';

function resizeCover(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1200;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else       { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('加载封面失败')); };
    img.src = url;
  });
}

$('#createLocationBtn').addEventListener('click', () => {
  $('#newLocationName').value = '';
  $('#newLocationCover').value = '';
  $('#coverDrop').classList.remove('has-image');
  const img = $('#coverDrop').querySelector('.cover-drop-img');
  if (img) img.remove();
  coverFile = null;
  coverDataUrl = '';
  createLocationModal.classList.add('open');
});

$('#btnCancelCreate').addEventListener('click', () => {
  createLocationModal.classList.remove('open');
});
createLocationModal.addEventListener('click', (e) => {
  if (e.target === createLocationModal) createLocationModal.classList.remove('open');
});

const coverDrop = $('#coverDrop');
const coverInput = $('#newLocationCover');

coverDrop.addEventListener('click', () => coverInput.click());
coverDrop.addEventListener('dragover', (e) => { e.preventDefault(); coverDrop.classList.add('drag-over'); });
coverDrop.addEventListener('dragleave', () => coverDrop.classList.remove('drag-over'));
coverDrop.addEventListener('drop', (e) => {
  e.preventDefault();
  coverDrop.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handleCoverFile(file);
});
coverInput.addEventListener('change', () => {
  const file = coverInput.files[0];
  if (file) handleCoverFile(file);
});

async function handleCoverFile(file) {
  coverFile = file;
  try {
    coverDataUrl = await resizeCover(file);
    let img = coverDrop.querySelector('.cover-drop-img');
    if (!img) { img = document.createElement('img'); img.className = 'cover-drop-img'; coverDrop.appendChild(img); }
    img.src = coverDataUrl;
    coverDrop.classList.add('has-image');
  } catch (e) {
    console.error(e);
    toastMsg('封面加载失败');
  }
}

$('#btnSaveCreate').addEventListener('click', async () => {
  const name = $('#newLocationName').value.trim();
  if (!name) { toastMsg('请输入地点名称'); return; }

  try {
    const res = await fetch('/api/locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, coverData: coverDataUrl }),
    });
    const result = await res.json();
    if (res.status === 409) { toastMsg('地点已存在'); return; }
    if (result.error) { toastMsg(result.error); return; }

    createLocationModal.classList.remove('open');
    toastMsg('地点已创建');

    // Incremental: add to memory and append one section
    locations[name] = result;
    photosByLocation[name] = [];
    appendLocationSection(name, true);
  } catch (e) {
    console.error(e);
    toastMsg('创建失败');
  }
});

// ============================================================
//  DELETE LOCATION
// ============================================================

scrollContainer.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const locName = btn.dataset.location;
  if (btn.dataset.action === 'delete-loc') {
    if (!(await showConfirm('删除地点', `确定要删除"${locName}"及其所有照片吗？此操作不可撤销。`))) return;
    try {
      await fetch('/api/locations/' + encodeURIComponent(locName), { method: 'DELETE' });
      toastMsg('地点已删除');
      // Incremental: remove section from DOM and memory
      removeLocationSection(locName);
    } catch (e) {
      toastMsg('删除失败');
    }
  }

  if (btn.dataset.action === 'edit-desc') {
    const loc = locations[locName] || {};
    const desc = prompt('编辑描述', loc.description || '');
    if (desc === null) return;
    try {
      const res = await fetch('/api/locations/' + encodeURIComponent(locName), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc }),
      });
      if (res.ok) {
        locations[locName] = { ...loc, description: desc };
        rebuildLocationSection(locName);
        toastMsg('描述已更新');
      }
    } catch (e) {
      toastMsg('描述更新失败');
    }
  }
});

// ============================================================
//  CONTEXT MENU ACTIONS
// ============================================================

$('#ctxEdit').addEventListener('click', () => {
  const fn = contextTarget?.filename;
  hideContextMenu();
  if (fn) openEditModal(fn);
});

$('#ctxDelete').addEventListener('click', async () => {
  const target = contextTarget;
  hideContextMenu();
  if (!target) return;
  if (!(await showConfirm('删除照片', '确定要删除这张照片吗？'))) return;

  try {
    await fetch(`/api/photos/${encodeURIComponent(target.filename)}`, { method: 'DELETE' });
    toastMsg('照片已删除');
    if (lightbox.classList.contains('open')) closeLightbox();
    await refreshLocation(target.location);
    rebuildLocationSection(target.location);
  } catch (e) {
    toastMsg('删除失败');
  }
});

// ============================================================
//  EDIT MODAL SAVE
// ============================================================

$('#btnSaveEdit').addEventListener('click', async () => {
  const filename = $('#editFilename').value;
  const newLocation = $('#editLocation').value.trim();
  const caption = $('#editCaption').value;
  const date = $('#editDate').value;

  // Find old location before update
  let oldLocation = '';
  for (const [loc, photos] of Object.entries(photosByLocation)) {
    if (photos.find(p => p.filename === filename)) { oldLocation = loc; break; }
  }

  try {
    await fetch(`/api/photos/${encodeURIComponent(filename)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: newLocation, caption, date }),
    });
    closeEditModal();
    toastMsg('已更新');

    // Incremental: only refresh affected locations
    const affected = new Set([oldLocation, newLocation].filter(Boolean));
    for (const loc of affected) {
      await refreshLocation(loc);
      rebuildLocationSection(loc);
    }
  } catch (e) {
    toastMsg('更新失败');
  }
});

$('#btnCancelEdit').addEventListener('click', closeEditModal);
editModal.addEventListener('click', (e) => {
  if (e.target === editModal) closeEditModal();
});

// ============================================================
//  LIGHTBOX EVENTS
// ============================================================

$('#lightboxClose').addEventListener('click', closeLightbox);
$('#lightboxPrev').addEventListener('click', lbPrev);
$('#lightboxNext').addEventListener('click', lbNext);
lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) closeLightbox();
});

document.addEventListener('keydown', (e) => {
  if (!lightbox.classList.contains('open')) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') lbPrev();
  if (e.key === 'ArrowRight') lbNext();
});

// ============================================================
//  GLOBAL CLICK (hide context menu)
// ============================================================

document.addEventListener('click', (e) => {
  if (!contextMenu.contains(e.target)) hideContextMenu();
});

// ============================================================
//  CONFIRM DIALOG EVENTS
// ============================================================

$('#btnOkConfirm').addEventListener('click', () => closeConfirm(true));
$('#btnCancelConfirm').addEventListener('click', () => closeConfirm(false));
confirmModal.addEventListener('click', (e) => {
  if (e.target === confirmModal) closeConfirm(false);
});

// ============================================================
//  INIT
// ============================================================

async function init() {
  showLoading();
  await fetchAllData();
  hideLoading();
  buildAllSections();
}

init();
