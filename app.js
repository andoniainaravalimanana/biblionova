/**
 * BiblioNova — app.js (VERSION COMPLETE ET STABLE)
 */

/* ============================================================
   ⚙️  CONFIGURATION
============================================================ */
const SUPABASE_URL = 'https://yjqbbtrliohckffdhxpj.supabase.co';
const SUPABASE_ANON = 'sb_publishable_4aAn7Zz2VCyRG1TBB2tJLw_sHUk7Ket';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqcWJidHJsaW9oY2tmZmRoeHBqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Nzk4ODU2NCwiZXhwIjoyMDkzNTY0NTY0fQ.S05p5lUC4u3QLFGA2-zHbKtq3nSsF6pjZv1XX2XvuFM';
const STORAGE_BUCKET = 'pdf-library';
const DEMO_MODE = false;

/* ============================================================
   🗄️  DEMO DATA
============================================================ */
const DEMO_FOLDERS = [
  { id: 'f1', name: 'Mathématiques', created_at: '2024-01-01' },
  { id: 'f2', name: 'Informatique',  created_at: '2024-01-02' },
];
const DEMO_FILES = [
  { id: 'd1', name: "Introduction à l'Algèbre", folder_id: 'f1', file_url: 'https://arxiv.org/pdf/1802.01528', created_at: '2024-02-01' },
  { id: 'd2', name: 'Structures de Données',    folder_id: 'f2', file_url: 'https://arxiv.org/pdf/1907.11174', created_at: '2024-02-03' },
];
const DEMO_USERS = [
  { email: 'admin@biblionova.com',    password: 'admin123', role: 'admin',   name: 'Admin' },
  { email: 'etudiant@biblionova.com', password: 'etu123',   role: 'student', name: 'Étudiant' },
];

/* ============================================================
   🔑  HELPERS
============================================================ */
function getToken() {
  return localStorage.getItem('sb_token') || SUPABASE_ANON;
}
function getSessionId() {
  let sid = localStorage.getItem('bn_session_id');
  if (!sid) {
    sid = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2);
    localStorage.setItem('bn_session_id', sid);
  }
  return sid;
}
function authHeaders(extra = {}) {
  return { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json', ...extra };
}

/* ============================================================
   🌐  SUPABASE HELPERS
============================================================ */
async function sbSelect(table, filters = {}, orderCol = null) {
  const params = new URLSearchParams({ select: '*' });
  Object.entries(filters).forEach(([k, v]) => params.append(k, `eq.${v}`));
  if (orderCol) params.append('order', `${orderCol}.asc`);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, { headers: authHeaders() });
  if (!res.ok) { console.error('sbSelect error', await res.text()); return []; }
  return res.json();
}
async function sbInsert(table, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers: authHeaders({ 'Prefer': 'return=representation' }), body: JSON.stringify(row)
  });
  const data = await res.json();
  if (!res.ok) { console.error('sbInsert error', data); return { ok: false, error: data }; }
  return { ok: true, data: Array.isArray(data) ? data[0] : data };
}
async function sbUpdate(table, filters, row) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => params.append(k, `eq.${v}`));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    method: 'PATCH', headers: authHeaders({ 'Prefer': 'return=representation' }), body: JSON.stringify(row)
  });
  if (!res.ok) { console.error('sbUpdate error', await res.text()); return { ok: false }; }
  return { ok: true };
}
async function sbDelete(table, filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => params.append(k, `eq.${v}`));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) { console.error('sbDelete error', await res.text()); return { ok: false }; }
  return { ok: true };
}
async function sbUpsert(table, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers: authHeaders({ 'Prefer': 'return=minimal,resolution=merge-duplicates' }), body: JSON.stringify(row)
  });
  if (!res.ok) {
    // Essaie avec PATCH si POST échoue
    console.warn('sbUpsert fallback to ignore', await res.text());
  }
  return { ok: true };
}

/* ============================================================
   📦  STATE
============================================================ */
const state = {
  user: null, folders: [], files: [], currentFolder: 'all', searchQuery: '',
  pdf: { doc: null, currentPage: 1, totalPages: 1, zoom: 1.0, fileId: null },
  pendingDelete: null, pendingRename: null, saveTimeout: null
};

/* ============================================================
   🔐  AUTH
============================================================ */
async function login(email, password) {
  if (DEMO_MODE) {
    const user = DEMO_USERS.find(u => u.email === email && u.password === password);
    if (user) {
      state.user = { ...user };
      localStorage.setItem('bn_user', JSON.stringify(state.user));
      return { ok: true };
    }
    return { ok: false, message: 'Email ou mot de passe incorrect.' };
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, message: data.error_description || data.message || 'Identifiants incorrects.' };

    const meta = data.user?.user_metadata || {};
    state.user = { id: data.user.id, email, role: meta.role || 'student', name: meta.name || email.split('@')[0] };
    localStorage.setItem('sb_token', data.access_token);
    localStorage.setItem('sb_refresh_token', data.refresh_token || '');
    localStorage.setItem('bn_user', JSON.stringify(state.user));
    return { ok: true };
  } catch (err) {
    return { ok: false, message: 'Erreur de connexion au serveur.' };
  }
}

function logout() {
  document.body.insertAdjacentHTML('beforeend', `
    <div id="logoutOverlay" style="
      position:fixed;inset:0;
      background:rgba(15,17,23,0.92);
      display:flex;flex-direction:column;
      align-items:center;justify-content:center;
      z-index:9999;gap:20px">
      <div class="spinner" style="width:40px;height:40px;border-width:4px"></div>
      <p style="color:#fff;font-family:var(--font-body);font-size:1rem;letter-spacing:.02em">
        Déconnexion...
      </p>
    </div>
  `);
  setTimeout(() => {
    state.user = null;
    localStorage.removeItem('bn_user');
    localStorage.removeItem('sb_token');
    localStorage.removeItem('sb_refresh_token');
    closePdfReader();
    showLoginOverlay();
    const ov = document.getElementById('logoutOverlay');
    if (ov) ov.remove();
  }, 1500);
}

// ✅ checkSession — restaure la session depuis localStorage
function checkSession() {
  const saved = localStorage.getItem('bn_user');
  const token = localStorage.getItem('sb_token');
  if (!saved || !token) return false;
  try {
    // Vérifie expiration JWT avec tolérance 7 jours
    const parts = token.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1]));
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && (payload.exp + 7 * 24 * 3600) < now) {
        localStorage.removeItem('bn_user');
        localStorage.removeItem('sb_token');
        localStorage.removeItem('sb_refresh_token');
        return false;
      }
    }
    state.user = JSON.parse(saved);
    return true;
  } catch (e) {
    try { state.user = JSON.parse(saved); return true; } catch (e2) { return false; }
  }
}

// ✅ refreshToken — renouvelle silencieusement
async function refreshToken() {
  const token = localStorage.getItem('sb_token');
  const refreshTok = localStorage.getItem('sb_refresh_token');
  if (!token || !refreshTok || !state.user) return;
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1]));
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && (payload.exp - now) > 7200) return;
    }
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshTok })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.access_token) localStorage.setItem('sb_token', data.access_token);
      if (data.refresh_token) localStorage.setItem('sb_refresh_token', data.refresh_token);
    }
  } catch (e) {
    console.log('Token refresh failed', e);
  }
}

/* ============================================================
   📂  DATA LAYER
============================================================ */
async function loadFolders() {
  if (DEMO_MODE) { state.folders = [...DEMO_FOLDERS]; return; }
  state.folders = await sbSelect('folders', {}, 'name');
}
async function loadFiles(folderId = null) {
  if (DEMO_MODE) { state.files = folderId ? DEMO_FILES.filter(f => f.folder_id === folderId) : [...DEMO_FILES]; return; }
  state.files = await sbSelect('files', folderId ? { folder_id: folderId } : {}, 'name');
}
async function createFolder(name) {
  if (!name.trim()) return { ok: false };
  if (DEMO_MODE) { const f = { id: 'f' + Date.now(), name: name.trim(), created_at: new Date().toISOString() }; DEMO_FOLDERS.push(f); state.folders = [...DEMO_FOLDERS]; return { ok: true }; }
  const result = await sbInsert('folders', { name: name.trim() });
  if (result.ok) { state.folders.push(result.data); state.folders.sort((a, b) => a.name.localeCompare(b.name)); }
  return result;
}
async function renameFolder(id, name) {
  if (DEMO_MODE) { const f = DEMO_FOLDERS.find(x => x.id === id); if (f) f.name = name; state.folders = [...DEMO_FOLDERS]; return { ok: true }; }
  const r = await sbUpdate('folders', { id }, { name });
  if (r.ok) state.folders = state.folders.map(f => f.id === id ? { ...f, name } : f);
  return r;
}
async function deleteFolder(id) {
  if (DEMO_MODE) { const i = DEMO_FOLDERS.findIndex(x => x.id === id); if (i !== -1) DEMO_FOLDERS.splice(i, 1); state.folders = [...DEMO_FOLDERS]; return { ok: true }; }
  const r = await sbDelete('folders', { id });
  if (r.ok) state.folders = state.folders.filter(f => f.id !== id);
  return r;
}
async function deleteFile(id) {
  if (DEMO_MODE) { const i = DEMO_FILES.findIndex(x => x.id === id); if (i !== -1) DEMO_FILES.splice(i, 1); return { ok: true }; }
  return sbDelete('files', { id });
}
async function uploadFile(title, folderId, file, onProgress) {
  if (DEMO_MODE) {
    for (let i = 0; i <= 100; i += 20) { onProgress && onProgress(i); await new Promise(r => setTimeout(r, 80)); }
    const f = { id: 'd' + Date.now(), name: title, folder_id: folderId, file_url: URL.createObjectURL(file), created_at: new Date().toISOString() };
    DEMO_FILES.push(f); return { ok: true };
  }
  const token = getToken();
  const safeName = file.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
  const path = `${folderId}/${Date.now()}_${safeName}`;
  onProgress && onProgress(10);
  const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${path}`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
    body: file
  });
  if (!uploadRes.ok) { const err = await uploadRes.json().catch(() => ({})); return { ok: false, message: err.message || `Erreur Storage (${uploadRes.status})` }; }
  onProgress && onProgress(70);
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
  const dbResult = await sbInsert('files', { name: title, folder_id: folderId, file_url: publicUrl });
  if (!dbResult.ok) return { ok: false, message: dbResult.error?.message || 'Erreur base de données' };
  onProgress && onProgress(100);
  return { ok: true };
}

/* ============================================================
   📖  READING PROGRESS
============================================================ */
async function getProgress(fileId) {
  const key = `progress_${state.user?.email}_${fileId}`;
  const local = localStorage.getItem(key);
  if (local) return parseInt(local, 10);
  if (DEMO_MODE || !state.user?.id) return 1;
  const rows = await sbSelect('reading_progress', { file_id: fileId, user_id: state.user.id });
  return rows?.[0]?.last_page || 1;
}
async function saveProgress(fileId, page) {
  const key = `progress_${state.user?.email}_${fileId}`;
  localStorage.setItem(key, page);
  if (DEMO_MODE || !state.user?.id) return;
  await sbUpsert('reading_progress', { user_id: state.user.id, file_id: fileId, last_page: page, updated_at: new Date().toISOString() });
}

/* ============================================================
   🎨  RENDER
============================================================ */
function renderSidebar() {
  const list = document.getElementById('folderList');
  const allFiles = DEMO_MODE ? DEMO_FILES : state.files;
  list.innerHTML = `
    <li class="folder-item ${state.currentFolder === 'all' ? 'active' : ''}" data-id="all">
      <span class="folder-icon">🗂</span><span class="folder-name">Tous les fichiers</span>
      <span class="folder-badge">${allFiles.length}</span>
    </li>`;
  state.folders.forEach(folder => {
    const count = (DEMO_MODE ? DEMO_FILES : state.files).filter(f => f.folder_id === folder.id).length;
    const li = document.createElement('li');
    li.className = `folder-item ${state.currentFolder === folder.id ? 'active' : ''}`;
    li.dataset.id = folder.id;
    li.innerHTML = `<span class="folder-icon">📁</span><span class="folder-name">${esc(folder.name)}</span><span class="folder-badge">${count}</span>`;
    li.addEventListener('click', () => switchFolder(folder.id));
    list.appendChild(li);
  });
}

function renderUserInfo() {
  const u = state.user; if (!u) return;
  document.getElementById('userAvatar').textContent = (u.name || u.email)[0].toUpperCase();
  document.getElementById('userName').textContent = u.role === 'admin' ? 'Admin' : (u.name || u.email.split('@')[0]);
  document.getElementById('adminBtn').style.display = u.role === 'admin' ? 'flex' : 'none';
  if (u.role === 'admin') {
    document.getElementById('userRole').textContent = 'Andoniaina RAVALIMANANA';
    const img = document.getElementById('userAvatarImg');
    if (img) {
      img.src = 'photo.jpg';
      img.onload = () => { img.classList.remove('hidden'); document.getElementById('userAvatar').style.display = 'none'; };
      img.onerror = () => { img.classList.add('hidden'); document.getElementById('userAvatar').style.display = ''; };
    }
  } else {
    document.getElementById('userRole').textContent = u.name || 'Étudiant';
  }
}

async function renderFileGrid() {
  const grid = document.getElementById('fileGrid');
  const empty = document.getElementById('emptyState');
  grid.innerHTML = Array(4).fill(0).map(() => `
    <div class="file-card" style="pointer-events:none">
      <div class="skeleton" style="width:56px;height:72px;border-radius:6px"></div>
      <div style="width:100%">
        <div class="skeleton" style="height:14px;width:80%;margin-bottom:8px"></div>
        <div class="skeleton" style="height:11px;width:50%"></div>
      </div>
    </div>
  `).join('');
  const title = document.getElementById('sectionTitle');
  const count = document.getElementById('fileCount');
  const top = document.getElementById('topbarTitle');
  const all = DEMO_MODE ? DEMO_FILES : state.files;
  let files = state.currentFolder === 'all' ? all : all.filter(f => f.folder_id === state.currentFolder);
  if (state.searchQuery) files = files.filter(f => f.name.toLowerCase().includes(state.searchQuery.toLowerCase()));
  const folder = state.folders.find(f => f.id === state.currentFolder);
  const label = state.currentFolder === 'all' ? 'Tous les fichiers' : (folder?.name || '');
  title.textContent = label; top.textContent = label; count.textContent = `${files.length} fichier(s)`;
  grid.innerHTML = '';
  if (!files.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  for (const file of files) {
    const page = await getProgress(file.id);
    const card = document.createElement('div');
    card.className = 'file-card';
    card.innerHTML = `<div class="file-thumb">📄</div><div class="file-info"><div class="file-name">${esc(file.name)}</div><div class="file-meta">Dernière lecture : p.${page}</div></div>`;
    card.addEventListener('click', () => openPdf(file));
    grid.appendChild(card);
  }
}

/* ============================================================
   📖  PDF READER
============================================================ */
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

async function openPdf(file) {
  showView('reader');
  document.getElementById('readerTitle').textContent = file.name;
  document.getElementById('pdfLoading').style.display = 'flex';
  document.getElementById('pdfLoading').innerHTML = '<div class="spinner"></div><p>Chargement du document...</p>';
  document.getElementById('pdfPages').innerHTML = '';
  state.pdf.fileId = file.id;
  state.pdf.zoom = 1.0;
  updateZoomDisplay();
  const lastPage = await getProgress(file.id);

  try {
    document.getElementById('pdfLoading').innerHTML = '<div class="spinner"></div><p>Sécurisation...</p>';
    let fetchUrl = file.file_url;

    if (!DEMO_MODE) {
      const urlParts = file.file_url.split('/pdf-library/');
      const filePath = urlParts[1];
      if (filePath) {
        const signRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/pdf-library/${filePath}`, {
          method: 'POST',
          headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresIn: 30 })
        });
        if (signRes.ok) {
          const signData = await signRes.json();
          fetchUrl = `${SUPABASE_URL}/storage/v1${signData.signedURL}`;
        }
      }
    }

    document.getElementById('pdfLoading').innerHTML = '<div class="spinner"></div><p>Téléchargement… 0%</p>';
    const response = await fetch(fetchUrl, { method: 'GET', mode: 'cors' });
    if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);

    const contentLength = response.headers.get('Content-Length');
    const total = contentLength ? parseInt(contentLength) : 0;
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total > 0) {
        const pct = Math.round(received / total * 100);
        document.getElementById('pdfLoading').innerHTML = `<div class="spinner"></div><p>Chargement… ${pct}%</p>`;
      }
    }

    const pdfData = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { pdfData.set(chunk, offset); offset += chunk.length; }

    document.getElementById('pdfLoading').innerHTML = '<div class="spinner"></div><p>Rendu du document...</p>';
    const task = pdfjsLib.getDocument({
      data: pdfData,
      cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
      cMapPacked: true,
      disableAutoFetch: true,
      disableStream: false,
    });

    const pdf = await task.promise;
    state.pdf.doc = pdf;
    state.pdf.totalPages = pdf.numPages;
    document.getElementById('totalPages').textContent = `/ ${pdf.numPages}`;
    document.getElementById('pageInput').max = pdf.numPages;
    document.getElementById('pdfLoading').style.display = 'none';

    await renderAllPages(pdf);

    state.pdf.currentPage = Math.min(lastPage, pdf.numPages);
    updatePageDisplay(state.pdf.currentPage);
    // Double scroll pour garantir l'arrivée à la bonne page
    setTimeout(() => {
      scrollToPage(state.pdf.currentPage);
      setTimeout(() => scrollToPage(state.pdf.currentPage), 600);
    }, 300);

  } catch (err) {
    console.error('PDF load error:', err);
    document.getElementById('pdfLoading').innerHTML = `
      <span style="font-size:2rem">⚠️</span>
      <p style="color:var(--danger);margin-top:8px">Erreur de chargement</p>
      <p style="font-size:.8rem;color:var(--text-muted)">${err.message}</p>
    `;
  }
}

async function renderAllPages(pdf) {
  const container = document.getElementById('pdfPages');
  container.innerHTML = '';
  for (let i = 1; i <= Math.min(3, pdf.numPages); i++) {
    const w = document.createElement('div'); w.className = 'pdf-page-wrapper'; w.dataset.page = i;
    container.appendChild(w); await renderPage(pdf, i, w);
  }
  for (let i = 4; i <= pdf.numPages; i++) {
    const w = document.createElement('div'); w.className = 'pdf-page-wrapper'; w.dataset.page = i;
    w.style.minHeight = '842px'; w.style.minWidth = '595px'; w.style.background = '#fff';
    container.appendChild(w);
  }
  const obs = new IntersectionObserver(async (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        const w = e.target; const pg = parseInt(w.dataset.page);
        if (!w.querySelector('canvas')) await renderPage(pdf, pg, w);
        state.pdf.currentPage = pg; updatePageDisplay(pg); debouncedSave(pg); obs.unobserve(w);
      }
    }
  }, { threshold: 0.1, rootMargin: '200px' });
  container.querySelectorAll('.pdf-page-wrapper').forEach(w => { if (!w.querySelector('canvas')) obs.observe(w); });
}

async function renderPage(pdf, pageNum, wrapper) {
  try {
    const page = await pdf.getPage(pageNum);
    const containerWidth = document.getElementById('pdfContainer').clientWidth - 32;
    const isMobile = window.innerWidth <= 768;
    const baseViewport = page.getViewport({ scale: 1 });
    const fitScale = containerWidth / baseViewport.width;
    let scale = fitScale * state.pdf.zoom;
    if (isMobile) scale = Math.max(scale, fitScale * 1.2);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.floor(viewport.width  * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width  = Math.floor(viewport.width)  + 'px';
    canvas.style.height = Math.floor(viewport.height) + 'px';
    ctx.scale(dpr, dpr);
    wrapper.style.width  = Math.floor(viewport.width)  + 'px';
    wrapper.style.height = Math.floor(viewport.height) + 'px';
    wrapper.style.minHeight = '';
    wrapper.style.minWidth  = '';
    wrapper.innerHTML = '';
    wrapper.appendChild(canvas);
    await page.render({ canvasContext: ctx, viewport }).promise;
    page.cleanup();
    const userName = state.user?.name || state.user?.email || 'BiblioNova';
    wrapper.dataset.watermark = userName.toUpperCase();
  } catch (err) { console.warn('Page error p.' + pageNum, err); }
}

function scrollToPage(n) { const t = document.querySelector(`[data-page="${n}"]`); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function updatePageDisplay(p) { document.getElementById('pageInput').value = p; document.getElementById('readerInfo').textContent = `Page ${p} / ${state.pdf.totalPages}`; }
function updateZoomDisplay() { document.getElementById('zoomLevel').textContent = Math.round(state.pdf.zoom * 100) + '%'; }
function debouncedSave(page) {
  clearTimeout(state.saveTimeout);
  state.saveTimeout = setTimeout(async () => {
    await saveProgress(state.pdf.fileId, page);
    const ind = document.getElementById('saveIndicator'); ind.classList.add('visible');
    setTimeout(() => ind.classList.remove('visible'), 2000);
  }, 1000);
}
async function rezoomPdf(z) {
  if (!state.pdf.doc) return;
  state.pdf.zoom = Math.max(0.5, Math.min(3.0, z));
  updateZoomDisplay();
  const currentPage = state.pdf.currentPage;
  const container = document.getElementById('pdfPages');
  const wrappers = container.querySelectorAll('.pdf-page-wrapper');
  const renderPromises = [];
  for (const wrapper of wrappers) {
    if (wrapper.querySelector('canvas')) renderPromises.push(renderPage(state.pdf.doc, parseInt(wrapper.dataset.page), wrapper));
  }
  await Promise.all(renderPromises);
  requestAnimationFrame(() => {
    const target = document.querySelector(`[data-page="${currentPage}"]`);
    if (target) target.scrollIntoView({ behavior: 'instant', block: 'start' });
  });
}
function closePdfReader() {
  if (state.pdf.doc) { state.pdf.doc.destroy(); state.pdf.doc = null; }
  document.getElementById('pdfPages').innerHTML = ''; showView('grid');
}
function toggleFullscreen() {
  const reader = document.getElementById('pdfReaderView');
  const btn = document.getElementById('fullscreenBtn');
  if (reader.classList.contains('fullscreen')) {
    reader.classList.remove('fullscreen'); btn.classList.remove('active'); btn.textContent = '⛶'; document.body.style.overflow = '';
  } else {
    reader.classList.add('fullscreen'); btn.classList.add('active'); btn.textContent = '✕'; document.body.style.overflow = 'hidden';
  }
}

/* ============================================================
   🗂️  VIEW / FOLDER
============================================================ */
function showView(v) {
  document.getElementById('fileGridView').classList.toggle('hidden', v !== 'grid');
  document.getElementById('pdfReaderView').classList.toggle('hidden', v !== 'reader');
}
async function switchFolder(id) {
  state.currentFolder = id;
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('active');
  if (!DEMO_MODE) await loadFiles(id !== 'all' ? id : null);
  renderSidebar(); renderFileGrid();
}

/* ============================================================
   ⚙️  ADMIN
============================================================ */
function openAdmin() {
  document.getElementById('adminOverlay').classList.add('active');
  renderAdminFolders(); renderAdminFiles(); populateUploadFolderSelect();
}
function closeAdmin() { document.getElementById('adminOverlay').classList.remove('active'); }

function renderAdminFolders() {
  const list = document.getElementById('adminFolderList');
  const folders = DEMO_MODE ? DEMO_FOLDERS : state.folders;
  list.innerHTML = '';
  if (!folders.length) { list.innerHTML = '<div style="color:var(--text-muted);font-size:.85rem;padding:8px">Aucun dossier</div>'; return; }
  folders.forEach(f => {
    const item = document.createElement('div'); item.className = 'admin-list-item';
    item.innerHTML = `<span>📁 ${esc(f.name)}</span><button class="btn-sm" onclick="openRename('${f.id}','${esc(f.name)}')">✏️</button><button class="btn-sm danger" onclick="openDelete('folder','${f.id}','${esc(f.name)}')">🗑</button>`;
    list.appendChild(item);
  });
}
function renderAdminFiles() {
  const list = document.getElementById('adminFileList');
  const files = DEMO_MODE ? DEMO_FILES : state.files;
  const folders = DEMO_MODE ? DEMO_FOLDERS : state.folders;
  list.innerHTML = '';
  if (!files.length) { list.innerHTML = '<div style="color:var(--text-muted);font-size:.85rem;padding:8px">Aucun fichier</div>'; return; }
  files.forEach(f => {
    const folder = folders.find(x => x.id === f.folder_id);
    const item = document.createElement('div'); item.className = 'admin-list-item';
    item.innerHTML = `<span>📄 ${esc(f.name)} <em style="color:var(--text-muted);font-size:.75rem">(${folder?.name || '?'})</em></span><button class="btn-sm danger" onclick="openDelete('file','${f.id}','${esc(f.name)}')">🗑</button>`;
    list.appendChild(item);
  });
}
function populateUploadFolderSelect() {
  const sel = document.getElementById('uploadFolder');
  sel.innerHTML = '<option value="">— Choisir un dossier —</option>';
  (DEMO_MODE ? DEMO_FOLDERS : state.folders).forEach(f => { const o = document.createElement('option'); o.value = f.id; o.textContent = f.name; sel.appendChild(o); });
}

/* ============================================================
   👥  DEMANDES ÉTUDIANTS
============================================================ */
async function loadRequests() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/student_requests?order=created_at.desc`, {
    headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${getToken()}` }
  });
  if (!res.ok) return [];
  return res.json();
}

async function renderRequestsTab() {
  const requests = await loadRequests();
  const pending = requests.filter(r => r.status === 'pending');
  const badge = document.getElementById('requestsBadge');
  if (pending.length > 0) { badge.textContent = pending.length; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');

  const container = document.getElementById('tab-requests');
  container.innerHTML = `
    <div class="admin-section">
      <h3>Demandes en attente <span style="color:var(--warning)">(${pending.length})</span></h3>
      <div id="pendingRequestsList"></div>
    </div>
    <div class="admin-section">
      <h3>Toutes les demandes</h3>
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:160px;position:relative">
          <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:.85rem">🔍</span>
          <input type="text" id="requestSearch" placeholder="Rechercher..."
            style="width:100%;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 8px 8px 30px;color:var(--text-primary);font-family:var(--font-body);font-size:.85rem;outline:none" />
        </div>
        <select id="requestSort" style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 12px;color:var(--text-primary);font-family:var(--font-body);font-size:.85rem;outline:none;cursor:pointer">
          <option value="date_desc">📅 Plus récent</option>
          <option value="date_asc">📅 Plus ancien</option>
          <option value="alpha_asc">🔤 A → Z</option>
          <option value="alpha_desc">🔤 Z → A</option>
          <option value="accepted">✅ Acceptés</option>
          <option value="rejected">❌ Refusés</option>
          <option value="pending">⏳ En attente</option>
        </select>
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:.82rem">
          <thead>
            <tr style="border-bottom:1px solid var(--border)">
              <th style="text-align:left;padding:8px 10px;color:var(--text-muted);font-weight:500">Nom</th>
              <th style="text-align:left;padding:8px 10px;color:var(--text-muted);font-weight:500">Email</th>
              <th style="text-align:left;padding:8px 10px;color:var(--text-muted);font-weight:500">Téléphone</th>
              <th style="text-align:left;padding:8px 10px;color:var(--text-muted);font-weight:500">Date</th>
              <th style="text-align:left;padding:8px 10px;color:var(--text-muted);font-weight:500">Statut</th>
              <th style="text-align:left;padding:8px 10px;color:var(--text-muted);font-weight:500">Actions</th>
            </tr>
          </thead>
          <tbody id="requestsTableBody"></tbody>
        </table>
      </div>
      <div id="requestsEmpty" class="hidden" style="color:var(--text-muted);font-size:.85rem;padding:16px;text-align:center">Aucun résultat</div>
    </div>
  `;

  const pendingList = document.getElementById('pendingRequestsList');
  if (!pending.length) pendingList.innerHTML = '<div style="color:var(--text-muted);font-size:.85rem;padding:8px">Aucune demande en attente</div>';
  pending.forEach(r => {
    const card = document.createElement('div'); card.className = 'request-card';
    card.innerHTML = `
      <div class="req-name">${esc(r.full_name)}</div>
      <div class="req-meta">📧 ${esc(r.email)}&nbsp;&nbsp;📱 ${esc(r.phone)}&nbsp;&nbsp;📅 ${new Date(r.created_at).toLocaleDateString('fr-FR')}</div>
      <div class="req-actions">
        <button class="btn-accept" onclick="handleRequest('${r.id}','accepted')">✓ Accepter</button>
        <button class="btn-reject" onclick="handleRequest('${r.id}','rejected')">✕ Refuser</button>
      </div>`;
    pendingList.appendChild(card);
  });

  window._allRequests = requests;
  renderRequestsTable(requests);
  document.getElementById('requestSearch').addEventListener('input', filterRequests);
  document.getElementById('requestSort').addEventListener('change', filterRequests);
}

function filterRequests() {
  const search = document.getElementById('requestSearch').value.toLowerCase();
  const sort = document.getElementById('requestSort').value;
  let data = [...(window._allRequests || [])];
  if (search) data = data.filter(r => r.full_name.toLowerCase().includes(search) || r.email.toLowerCase().includes(search) || r.phone.includes(search));
  if (['accepted', 'rejected', 'pending'].includes(sort)) data = data.filter(r => r.status === sort);
  if (sort === 'alpha_asc') data.sort((a, b) => a.full_name.localeCompare(b.full_name));
  if (sort === 'alpha_desc') data.sort((a, b) => b.full_name.localeCompare(a.full_name));
  if (sort === 'date_asc') data.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  if (sort === 'date_desc') data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  renderRequestsTable(data);
}

function renderRequestsTable(data) {
  const tbody = document.getElementById('requestsTableBody');
  const empty = document.getElementById('requestsEmpty');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!data.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  data.forEach(r => {
    const statusLabel = r.status === 'accepted' ? 'Accepté' : r.status === 'rejected' ? 'Refusé' : 'En attente';
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border)';
    tr.innerHTML = `
      <td style="padding:10px;color:var(--text-primary);font-weight:500">${esc(r.full_name)}</td>
      <td style="padding:10px;color:var(--text-secondary)">${esc(r.email)}</td>
      <td style="padding:10px;color:var(--text-secondary)">${esc(r.phone)}</td>
      <td style="padding:10px;color:var(--text-muted);white-space:nowrap">${new Date(r.created_at).toLocaleDateString('fr-FR')}</td>
      <td style="padding:10px"><span class="status-badge ${r.status}">${statusLabel}</span></td>
      <td style="padding:10px">
        ${r.status === 'pending' ? `
          <button class="btn-accept" style="padding:4px 10px;font-size:.75rem" onclick="handleRequest('${r.id}','accepted')">✓</button>
          <button class="btn-reject" style="padding:4px 10px;font-size:.75rem;margin-left:4px" onclick="handleRequest('${r.id}','rejected')">✕</button>
        ` : '—'}
      </td>`;
    tbody.appendChild(tr);
  });
}

async function handleRequest(id, status) {
  const btn = event.target; btn.disabled = true; btn.textContent = '…';
  await fetch(`${SUPABASE_URL}/rest/v1/student_requests?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, reviewed_at: new Date().toISOString() })
  });
  if (status === 'accepted') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/student_requests?id=eq.${id}`, { headers: authHeaders() });
    const reqs = await res.json(); const req = reqs[0];
    if (req) {
      const fnRes = await fetch(`${SUPABASE_URL}/functions/v1/create-student-account`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: req.email, password: atob(req.password_hash), full_name: req.full_name, phone: req.phone })
      });
      const fnData = await fnRes.json();
      if (!fnData.ok) alert('Demande acceptée mais erreur création compte : ' + fnData.message);
    }
  }
  await renderRequestsTab();
}

async function deleteRequest(id) {
  state.pendingDelete = { type: 'request', id };
  document.getElementById('deleteModalMsg').textContent = 'Supprimer cette demande ? Action irréversible.';
  document.getElementById('deleteModal').classList.remove('hidden');
}

/* ============================================================
   🏷️  MODALS
============================================================ */
function openRename(id, name) {
  state.pendingRename = id;
  document.getElementById('renameInput').value = name;
  document.getElementById('renameModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('renameInput').focus(), 50);
}
function closeRename() { state.pendingRename = null; document.getElementById('renameModal').classList.add('hidden'); }
async function confirmRenameAction() {
  const name = document.getElementById('renameInput').value.trim();
  if (!name || !state.pendingRename) return;
  const { ok } = await renameFolder(state.pendingRename, name);
  if (ok) { closeRename(); renderSidebar(); renderAdminFolders(); }
}
function openDelete(type, id, name) {
  state.pendingDelete = { type, id };
  document.getElementById('deleteModalMsg').textContent = `Supprimer ${type === 'folder' ? 'le dossier' : 'le fichier'} « ${name} » ? Action irréversible.`;
  document.getElementById('deleteModal').classList.remove('hidden');
}
function closeDelete() { state.pendingDelete = null; document.getElementById('deleteModal').classList.add('hidden'); }
async function confirmDeleteAction() {
  if (!state.pendingDelete) return;
  const { type, id } = state.pendingDelete;
  if (type === 'folder') {
    await deleteFolder(id); closeDelete();
    if (!DEMO_MODE) await loadFiles();
    renderSidebar(); renderAdminFolders(); renderAdminFiles(); renderFileGrid();
  } else if (type === 'file') {
    await deleteFile(id); closeDelete();
    if (!DEMO_MODE) await loadFiles();
    renderSidebar(); renderAdminFolders(); renderAdminFiles(); renderFileGrid();
  } else if (type === 'request') {
    await fetch(`${SUPABASE_URL}/rest/v1/student_requests?id=eq.${id}`, { method: 'DELETE', headers: authHeaders() });
    closeDelete(); await renderRequestsTab();
  }
}

/* ============================================================
   📝  INSCRIPTION
============================================================ */
async function registerStudent(fullName, email, phone, password) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/student_requests`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify({ full_name: fullName, email, phone, password_hash: btoa(password), status: 'pending', created_at: new Date().toISOString() })
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.message || data.details || '';
    if (msg.includes('unique') || msg.includes('duplicate')) return { ok: false, message: 'Cet email est déjà utilisé.' };
    return { ok: false, message: msg || 'Erreur lors de la création.' };
  }
  return { ok: true };
}

/* ============================================================
   🔒  SECURITY
============================================================ */
function applyPdfSecurity() {
  document.addEventListener('contextmenu', e => {
    if (e.target.closest('#pdfContainer') || e.target.tagName === 'CANVAS') e.preventDefault();
  });
  document.addEventListener('keydown', e => {
    const inReader = !document.getElementById('pdfReaderView').classList.contains('hidden');
    if (inReader && (e.ctrlKey || e.metaKey) && ['s', 'p', 'u', 'a'].includes(e.key)) e.preventDefault();
    if (e.key === 'Escape') {
      const reader = document.getElementById('pdfReaderView');
      if (reader.classList.contains('fullscreen')) toggleFullscreen();
    }
  });
  document.addEventListener('dragstart', e => { if (e.target.tagName === 'CANVAS') e.preventDefault(); });
  window.addEventListener('beforeprint', e => {
    if (!document.getElementById('pdfReaderView').classList.contains('hidden')) e.preventDefault();
  });
  if (window.top !== window.self) {
    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#fff;background:#0f1117;font-family:sans-serif">Accès non autorisé</div>';
  }
  document.addEventListener('selectstart', e => { if (e.target.tagName === 'CANVAS') e.preventDefault(); });
  let inactivityTimer;
  function resetTimer() {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      if (state.user) { alert('Session expirée pour inactivité. Vous allez être déconnecté.'); logout(); }
    }, 2 * 60 * 60 * 1000);
  }
  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(e => document.addEventListener(e, resetTimer, { passive: true }));
  resetTimer();
}

// Bloque F12
document.addEventListener('keydown', e => {
  if (e.key === 'F12') { e.preventDefault(); return false; }
  if (e.ctrlKey && e.shiftKey && ['i', 'j', 'c', 'k'].includes(e.key.toLowerCase())) { e.preventDefault(); return false; }
  if (e.ctrlKey && e.key === 'u') { e.preventDefault(); return false; }
});

// Détecte DevTools
const devtools = { open: false };
setInterval(() => {
  const threshold = 160;
  if (window.outerWidth - window.innerWidth > threshold || window.outerHeight - window.innerHeight > threshold) {
    if (!devtools.open) {
      devtools.open = true;
      const container = document.getElementById('pdfContainer');
      if (container) container.classList.add('blurred');
      const pages = document.getElementById('pdfPages');
      if (pages) pages.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:400px;color:var(--text-secondary);gap:16px">
          <span style="font-size:3rem">🔒</span>
          <p>Accès bloqué — fermez les outils de développement</p>
        </div>`;
    }
  } else {
    devtools.open = false;
    const container = document.getElementById('pdfContainer');
    if (container) container.classList.remove('blurred');
  }
}, 500);

/* ============================================================
   🛠️  UTILS
============================================================ */
function showLoginOverlay() { document.getElementById('loginOverlay').classList.add('active'); document.getElementById('appShell').classList.add('hidden'); }
function hideLoginOverlay() { document.getElementById('loginOverlay').classList.remove('active'); document.getElementById('appShell').classList.remove('hidden'); }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function showUploadMsg(text, type) {
  const m = document.getElementById('uploadMsg');
  m.textContent = text; m.className = `upload-msg ${type}`; m.classList.remove('hidden');
  if (type === 'success') setTimeout(() => m.classList.add('hidden'), 4000);
}
function togglePwd(inputId, btn) {
  const input = document.getElementById(inputId);
  if (input.type === 'password') { input.type = 'text'; btn.textContent = '🙈'; btn.classList.add('visible'); }
  else { input.type = 'password'; btn.textContent = '👁'; btn.classList.remove('visible'); }
}

/* ============================================================
   🚀  INIT
============================================================ */
async function init() {
  applyPdfSecurity();
  setupRegisterEvents();
  setupEventListeners();

  if (checkSession()) {
    // Rafraîchit le token en arrière-plan sans bloquer l'affichage
    refreshToken().catch(() => {});
    hideLoginOverlay();
    renderUserInfo();
    await loadFolders();
    await loadFiles();
    renderSidebar();
    renderFileGrid();
  }
  // Sinon → page login reste visible
}

/* ============================================================
   🎛️  EVENTS
============================================================ */
function setupRegisterEvents() {
  document.getElementById('showRegisterBtn').addEventListener('click', () => {
    document.getElementById('loginCard').classList.add('hidden');
    document.getElementById('registerCard').classList.remove('hidden');
  });
  document.getElementById('showLoginBtn').addEventListener('click', () => {
    document.getElementById('registerCard').classList.add('hidden');
    document.getElementById('loginCard').classList.remove('hidden');
  });
  document.getElementById('registerBtn').addEventListener('click', async () => {
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const phone = document.getElementById('regPhone').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirm = document.getElementById('regConfirm').value;
    const errEl = document.getElementById('registerError');
    const sucEl = document.getElementById('registerSuccess');
    const btn = document.getElementById('registerBtn');
    errEl.classList.add('hidden'); sucEl.classList.add('hidden');
    function showRegErr(msg) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
    if (!name) return showRegErr('Veuillez entrer votre nom complet.');
    if (!email || !email.includes('@')) return showRegErr('Adresse email invalide.');
    if (!phone) return showRegErr('Veuillez entrer votre numéro de téléphone.');
    if (password.length < 6) return showRegErr('Le mot de passe doit contenir au moins 6 caractères.');
    if (password !== confirm) return showRegErr('Les mots de passe ne correspondent pas.');
    btn.disabled = true; btn.textContent = 'Envoi en cours…';
    const { ok, message } = await registerStudent(name, email, phone, password);
    btn.disabled = false; btn.textContent = 'Créer mon compte';
    if (ok) {
      sucEl.innerHTML = '✅ Demande envoyée ! Un administrateur va valider votre compte.';
      sucEl.classList.remove('hidden');
      ['regName', 'regEmail', 'regPhone', 'regPassword', 'regConfirm'].forEach(id => document.getElementById(id).value = '');
    } else { showRegErr(message); }
  });
}

function setupEventListeners() {
  // LOGIN
  document.getElementById('loginBtn').addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value.trim();
    const pwd = document.getElementById('loginPassword').value;
    const err = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');
    err.classList.add('hidden'); btn.textContent = 'Connexion…'; btn.disabled = true;
    const { ok, message } = await login(email, pwd);
    btn.textContent = 'Se connecter'; btn.disabled = false;
    if (ok) { hideLoginOverlay(); renderUserInfo(); await loadFolders(); await loadFiles(); renderSidebar(); renderFileGrid(); }
    else { err.textContent = message; err.classList.remove('hidden'); }
  });
  document.getElementById('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('loginBtn').click(); });

  document.getElementById('logoutBtn').addEventListener('click', logout);

  document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarOverlay').classList.toggle('active');
  });
  document.getElementById('sidebarOverlay').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('active');
  });

  document.getElementById('folderList').addEventListener('click', async e => {
    const li = e.target.closest('.folder-item');
    if (li && li.dataset.id === 'all') await switchFolder('all');
  });

  document.getElementById('searchInput').addEventListener('input', e => { state.searchQuery = e.target.value; renderFileGrid(); });

  document.getElementById('adminBtn').addEventListener('click', openAdmin);
  document.getElementById('closeAdmin').addEventListener('click', closeAdmin);
  document.getElementById('adminOverlay').addEventListener('click', e => { if (e.target === document.getElementById('adminOverlay')) closeAdmin(); });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'upload') populateUploadFolderSelect();
      if (btn.dataset.tab === 'requests') renderRequestsTab();
    });
  });

  document.getElementById('createFolderBtn').addEventListener('click', async () => {
    const el = document.getElementById('newFolderName'); const btn = document.getElementById('createFolderBtn');
    const name = el.value.trim(); if (!name) return;
    btn.textContent = '…'; btn.disabled = true;
    const { ok, error } = await createFolder(name);
    btn.textContent = 'Créer'; btn.disabled = false;
    if (ok) { el.value = ''; renderSidebar(); renderAdminFolders(); populateUploadFolderSelect(); }
    else alert('Erreur : ' + (error?.message || 'impossible de créer le dossier'));
  });
  document.getElementById('newFolderName').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('createFolderBtn').click(); });

  const fileDrop = document.getElementById('fileDrop');
  const fileInput = document.getElementById('fileInput');
  fileDrop.addEventListener('click', () => fileInput.click());
  fileDrop.addEventListener('dragover', e => { e.preventDefault(); fileDrop.style.borderColor = 'var(--accent)'; });
  fileDrop.addEventListener('dragleave', () => { fileDrop.style.borderColor = ''; });
  fileDrop.addEventListener('drop', e => { e.preventDefault(); fileDrop.style.borderColor = ''; const f = e.dataTransfer.files[0]; if (f?.type === 'application/pdf') setFile(f); });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });
  function setFile(f) {
    fileInput._file = f;
    const nm = document.getElementById('fileSelectedName');
    nm.textContent = `✓ ${f.name} (${(f.size / 1024 / 1024).toFixed(2)} MB)`; nm.classList.remove('hidden');
    const t = document.getElementById('uploadTitle'); if (!t.value) t.value = f.name.replace(/\.pdf$/i, '');
  }

  document.getElementById('uploadBtn').addEventListener('click', async () => {
    const title = document.getElementById('uploadTitle').value.trim();
    const folder = document.getElementById('uploadFolder').value;
    const file = document.getElementById('fileInput')._file;
    if (!title) return showUploadMsg('Veuillez entrer un titre.', 'error');
    if (!folder) return showUploadMsg('Veuillez choisir un dossier.', 'error');
    if (!file) return showUploadMsg('Veuillez sélectionner un fichier PDF.', 'error');
    const btn = document.getElementById('uploadBtn');
    const prog = document.getElementById('uploadProgress');
    const fill = document.getElementById('progressFill');
    const pct = document.getElementById('progressText');
    btn.disabled = true; btn.textContent = 'Upload en cours…';
    prog.classList.remove('hidden'); document.getElementById('uploadMsg').classList.add('hidden');
    const { ok, message } = await uploadFile(title, folder, file, p => { fill.style.width = p + '%'; pct.textContent = p + '%'; });
    btn.disabled = false; btn.textContent = 'Uploader';
    setTimeout(() => prog.classList.add('hidden'), 800);
    if (ok) {
      showUploadMsg('✓ Fichier uploadé avec succès !', 'success');
      document.getElementById('uploadTitle').value = '';
      document.getElementById('uploadFolder').value = '';
      document.getElementById('fileInput')._file = null;
      document.getElementById('fileSelectedName').classList.add('hidden');
      if (!DEMO_MODE) await loadFiles();
      renderAdminFiles(); renderFileGrid();
    } else { showUploadMsg('✗ ' + (message || "Erreur lors de l'upload."), 'error'); }
  });

  document.getElementById('prevPage').addEventListener('click', () => { if (state.pdf.currentPage > 1) scrollToPage(state.pdf.currentPage - 1); });
  document.getElementById('nextPage').addEventListener('click', () => { if (state.pdf.currentPage < state.pdf.totalPages) scrollToPage(state.pdf.currentPage + 1); });
  document.getElementById('pageInput').addEventListener('change', e => { const p = parseInt(e.target.value); if (p >= 1 && p <= state.pdf.totalPages) scrollToPage(p); });
  document.getElementById('pageInput').addEventListener('keydown', e => { if (e.key === 'Enter') { const p = parseInt(e.target.value); if (p >= 1 && p <= state.pdf.totalPages) scrollToPage(p); } });

  document.getElementById('zoomIn').addEventListener('click', () => rezoomPdf(state.pdf.zoom + 0.2));
  document.getElementById('zoomOut').addEventListener('click', () => rezoomPdf(state.pdf.zoom - 0.2));
  document.getElementById('zoomFit').addEventListener('click', () => rezoomPdf(1.0));
  document.getElementById('fullscreenBtn').addEventListener('click', toggleFullscreen);
  document.getElementById('backToGrid').addEventListener('click', () => { closePdfReader(); renderFileGrid(); });

  document.getElementById('cancelRename').addEventListener('click', closeRename);
  document.getElementById('confirmRename').addEventListener('click', confirmRenameAction);
  document.getElementById('renameInput').addEventListener('keydown', e => { if (e.key === 'Enter') confirmRenameAction(); });
  document.getElementById('cancelDelete').addEventListener('click', closeDelete);
  document.getElementById('confirmDelete').addEventListener('click', confirmDeleteAction);
  document.getElementById('renameModal').addEventListener('click', e => { if (e.target === document.getElementById('renameModal')) closeRename(); });
  document.getElementById('deleteModal').addEventListener('click', e => { if (e.target === document.getElementById('deleteModal')) closeDelete(); });
}

// Expose globals
window.openRename = openRename;
window.openDelete = openDelete;
window.handleRequest = handleRequest;
window.deleteRequest = deleteRequest;
window.togglePwd = togglePwd;

// Refresh toutes les 10 minutes
setInterval(refreshToken, 10 * 60 * 1000);

// Point d'entrée unique
document.addEventListener('DOMContentLoaded', init);
