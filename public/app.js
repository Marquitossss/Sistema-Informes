const API = '/api';
let currentUser = null;
let editingInfId = null;
let editingCiuId = null;
let inactivityTimer = null;
let currentSection = 'dashboard';
let allCiudadanosCache = [];

document.addEventListener('DOMContentLoaded', () => {
  checkSession();
  setupLoginForm();
  setupRegistroForm();
  setupLogout();
  setupMenuToggle();
  setupGlobalSearch();
  setupAdminTabs();
  setupUCOTabs();
  setupUcoForm();
  setupCiudadanoForm();
  setupInformeForm();
  setupSearchCiudadanos();
  setupSearchInformes();
  setupSearchAuditoria();
  setupSearchUCO();
  setupFyfTabs();
  setupFyfForm();
  setupSearchFYF();
  setupNewUserBtn();
});

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw { status: res.status, ...data };
  return data;
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(API + '/upload', { method: 'POST', body: formData });
  if (!res.ok) { const e = await res.json(); throw e; }
  return res.json();
}

async function uploadFiles(files) {
  const formData = new FormData();
  for (const f of files) formData.append('files', f);
  const res = await fetch(API + '/upload/multiple', { method: 'POST', body: formData });
  if (!res.ok) { const e = await res.json(); throw e; }
  return res.json();
}

async function deleteFile(filename) {
  return api('/files/' + filename, { method: 'DELETE' });
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function attrEsc(s) {
  if (!s) return '';
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function getFileIcon(mime) {
  if (!mime) return '📄';
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.includes('pdf')) return '📕';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  if (mime.includes('sheet') || mime.includes('excel')) return '📊';
  if (mime.includes('zip') || mime.includes('rar')) return '📦';
  return '📄';
}

function setupFileDropZone(zoneId, inputId, previewId, onFilesChanged) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  if (!zone || !input) return;
  input.addEventListener('change', () => {
    if (onFilesChanged) onFilesChanged(Array.from(input.files));
  });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => { zone.classList.remove('drag-over'); });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) {
      input.files = e.dataTransfer.files;
      if (onFilesChanged) onFilesChanged(Array.from(e.dataTransfer.files));
    }
  });
}

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    alert('Sesión expirada por inactividad.');
    logout();
  }, 30 * 60 * 1000);
}

async function checkSession() {
  try {
    const user = await api('/me');
    currentUser = user;
    showApp();
    resetInactivityTimer();
  } catch {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('loginScreen').style.display = '';
  document.getElementById('appScreen').style.display = 'none';
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = '';
  renderSidebar();
  renderUserInfo();
  navigateTo('dashboard');
}

function renderUserInfo() {
  if (!currentUser) return;
  document.getElementById('userName').textContent = currentUser.nombre_completo || currentUser.usuario;
  const rolesList = (currentUser.roles && currentUser.roles.length) ? currentUser.roles : [currentUser.rol];
  document.getElementById('userRole').textContent = rolesList.join(', ');
  const badge = document.getElementById('userBadge');
  badge.textContent = rolesList.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(', ');
  document.getElementById('userIdentity').textContent = currentUser.nombre_completo || currentUser.usuario;
  const roleBadge = document.getElementById('roleBadge');
  roleBadge.innerHTML = rolesList.map(r => '<span class="role-badge role-' + r + '">' + esc(r) + '</span>').join(' ');
  roleBadge.className = '';
}

function hasRole(role) {
  return currentUser && ((currentUser.roles && currentUser.roles.includes(role)) || currentUser.rol === role);
}

function renderSidebar() {
  const nav = document.getElementById('sidebarNav');
  const items = [
    { id: 'dashboard', label: 'Dashboard', icon: '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="7" height="8" rx="1"/><rect x="11" y="2" width="7" height="5" rx="1"/><rect x="2" y="12" width="7" height="6" rx="1"/><rect x="11" y="9" width="7" height="9" rx="1"/></svg>' },
    { id: 'ciudadanos', label: 'Ciudadanos', icon: '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="6" r="3.5"/><path d="M3 18c0-3.5 3-6.5 7-6.5s7 3 7 6.5"/></svg>' },
    { id: 'informes', label: 'Informes', icon: '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 2h6l4 4v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M11 2v4h4"/></svg>' },
  ];
  if (currentUser && (hasRole('uco') || hasRole('admin'))) {
    items.push({ id: 'uco', label: 'UCO', icon: '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M17 10a7 7 0 0 0-.3-2l1.8-1.2-1.5-2.6-2 .6a6.8 6.8 0 0 0-1.7-1L13 2h-3l-.3 1.8a6.8 6.8 0 0 0-1.7 1l-2-.6L4.5 6.8 6.3 8A7 7 0 0 0 6 10c0 .7.1 1.4.3 2l-1.8 1.2 1.5 2.6 2-.6a6.8 6.8 0 0 0 1.7 1L10 18h3l.3-1.8a6.8 6.8 0 0 0 1.7-1l2 .6 1.5-2.6L17 12a7 7 0 0 0 .3-2z"/></svg>' });
  }
  if (currentUser && (hasRole('fyf') || hasRole('admin'))) {
    items.push({ id: 'fyf', label: 'FyF', icon: '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 3h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M7 7h6M7 10h6M7 13h4"/></svg>' });
  }
  if (currentUser && (hasRole('oficial') || hasRole('uco') || hasRole('admin'))) {
    items.push({ id: 'auditoria', label: 'Auditoría', icon: '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 3h6a1 1 0 0 1 1 1v1h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h1V4a1 1 0 0 1 1-1z"/></svg>' });
  }
  if (currentUser && hasRole('admin')) {
    items.push({ id: 'admin', label: 'Admin', icon: '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="2.5"/><path d="M17 10a7 7 0 0 0-.3-2l1.8-1.2-1.5-2.6-2 .6a6.8 6.8 0 0 0-1.7-1L13 2h-3l-.3 1.8a6.8 6.8 0 0 0-1.7 1l-2-.6L4.5 6.8 6.3 8A7 7 0 0 0 6 10c0 .7.1 1.4.3 2l-1.8 1.2 1.5 2.6 2-.6a6.8 6.8 0 0 0 1.7 1L10 18h3l.3-1.8a6.8 6.8 0 0 0 1.7-1l2 .6 1.5-2.6L17 12a7 7 0 0 0 .3-2z"/></svg>' });
  }
  nav.innerHTML = items.map(i =>
    '<a href="#" class="nav-item' + (i.id === currentSection ? ' active' : '') + '" data-section="' + i.id + '">' + i.icon + '<span>' + i.label + '</span></a>'
  ).join('');
  nav.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(el.dataset.section);
    });
  });
}

function navigateTo(section) {
  currentSection = section;
  document.body.classList.remove('uco-theme', 'fyf-theme');
  if (section === 'uco') document.body.classList.add('uco-theme');
  if (section === 'fyf') document.body.classList.add('fyf-theme');
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const target = document.getElementById('section-' + section);
  if (target) target.classList.add('active');
  const titles = { dashboard: 'Dashboard', ciudadanos: 'Ciudadanos', informes: 'Informes', auditoria: 'Auditoría', uco: 'Unidad Central Operativa', fyf: 'Fiscal y Fronteras', admin: 'Administración' };
  document.getElementById('pageTitle').textContent = titles[section] || section;
  updateLogos(section);
  renderSidebar();
  loadSection(section);
}

function updateLogos(section) {
  const topbarLogo = document.getElementById('topbarLogoImg');
  const sidebarLogo = document.getElementById('sidebarLogoImg');
  if (section === 'uco') {
    if (topbarLogo) topbarLogo.src = 'images/uco-logo.svg';
    if (sidebarLogo) sidebarLogo.src = 'images/uco-logo.svg';
  } else if (section === 'fyf') {
    if (topbarLogo) topbarLogo.src = 'images/fyf-patch.jpg';
    if (sidebarLogo) sidebarLogo.src = 'images/fyf-patch.jpg';
  } else {
    if (topbarLogo) topbarLogo.src = 'images/escudo.svg';
    if (sidebarLogo) sidebarLogo.src = 'images/escudo.svg';
  }
}

function loadSection(section) {
  switch (section) {
    case 'dashboard': loadDashboard(); break;
    case 'ciudadanos': loadCiudadanos(); break;
    case 'informes': loadInformes(); break;
    case 'auditoria': loadAuditoria(); break;
    case 'uco': loadUCO(); break;
    case 'fyf': loadFYF(); break;
    case 'admin': loadAdmin(); break;
  }
}

function setupLoginForm() {
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const usuario = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value;
    const errorEl = document.getElementById('loginError');
    errorEl.textContent = '';
    if (!usuario || !password) {
      errorEl.textContent = 'Introduce usuario y contraseña.';
      return;
    }
    try {
      const user = await api('/login', { method: 'POST', body: { usuario, password } });
      currentUser = user;
      showApp();
      resetInactivityTimer();
    } catch (err) {
      errorEl.textContent = err.error || 'Error al iniciar sesión.';
    }
  });
}

function setupRegistroForm() {
  document.getElementById('registroForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const placa = document.getElementById('regPlaca').value.trim();
    const nombre = document.getElementById('regNombre').value.trim();
    const password = document.getElementById('regPassword').value;
    const password2 = document.getElementById('regPassword2').value;
    const errorEl = document.getElementById('regError');
    const successEl = document.getElementById('regSuccess');
    errorEl.textContent = '';
    successEl.textContent = '';
    if (password !== password2) {
      errorEl.textContent = 'Las contraseñas no coinciden.';
      return;
    }
    try {
      const res = await api('/registro', { method: 'POST', body: { placa, password, nombre_completo: nombre } });
      successEl.textContent = res.mensaje || 'Registro exitoso.';
      document.getElementById('registroForm').reset();
    } catch (err) {
      errorEl.textContent = err.error || 'Error al registrar.';
    }
  });
}

function mostrarRegistro() {
  document.getElementById('loginStep1').style.display = 'none';
  document.getElementById('registroPanel').style.display = '';
  document.getElementById('showRegistro').style.display = 'none';
}

function volverLoginRegistro() {
  document.getElementById('loginStep1').style.display = '';
  document.getElementById('registroPanel').style.display = 'none';
  document.getElementById('showRegistro').style.display = '';
  document.getElementById('loginError').textContent = '';
  document.getElementById('regError').textContent = '';
  document.getElementById('regSuccess').textContent = '';
}

function setupLogout() {
  document.getElementById('logoutBtn').addEventListener('click', logout);
}

async function logout() {
  try { await api('/logout', { method: 'POST' }); } catch {}
  currentUser = null;
  clearTimeout(inactivityTimer);
  document.getElementById('loginForm').reset();
  document.getElementById('loginError').textContent = '';
  showLogin();
}

function setupMenuToggle() {
  document.getElementById('menuToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });
}

async function loadDashboard() {
  try {
    const [stats, actividad] = await Promise.all([api('/dashboard'), api('/dashboard/actividad')]);
    document.getElementById('statTotal').textContent = stats.total || 0;
    document.getElementById('statPendientes').textContent = stats.pendientes || 0;
    document.getElementById('statActivos').textContent = stats.activos || 0;
    document.getElementById('statCiudadanos').textContent = stats.ciudadanos || 0;
    document.getElementById('statDerivados').textContent = stats.derivados || 0;
    document.getElementById('statArchivados').textContent = stats.archivados || 0;
    const feed = document.getElementById('feedList');
    const emptyMsg = document.getElementById('emptyFeedMsg');
    if (!actividad.length) {
      feed.innerHTML = '';
      emptyMsg.style.display = '';
      return;
    }
    emptyMsg.style.display = 'none';
    feed.innerHTML = actividad.map(a => {
      const iconCfg = {
        CREAR_INFORME:     { cls: 'feed-icon-informe',   svg: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 2h6l4 4v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M11 2v4h4"/></svg>' },
        EDITAR_INFORME:    { cls: 'feed-icon-informe',   svg: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z"/></svg>' },
        APROBAR_INFORME:   { cls: 'feed-icon-aprobado',  svg: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="10" r="7"/><polyline points="6,10 9,13 14,7"/></svg>' },
        ARCHIVAR_INFORME:  { cls: 'feed-icon-archivado', svg: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="14" height="13" rx="1"/><line x1="3" y1="8" x2="17" y2="8"/></svg>' },
        DERIVAR_INFORME:   { cls: 'feed-icon-derivar',   svg: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3l-6 6h12"/><path d="M11 17l6-6H5"/></svg>' },
        CREAR_CIUDADANO:   { cls: 'feed-icon-ciudadano', svg: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="7" r="3"/><path d="M3 18c0-3.5 3-6 7-6s7 2.5 7 6"/></svg>' },
        EDITAR_CIUDADANO:  { cls: 'feed-icon-ciudadano', svg: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="7" r="3"/><path d="M3 18c0-3.5 3-6 7-6s7 2.5 7 6"/></svg>' },
        ELIMINAR_CIUDADANO:{ cls: 'feed-icon-archivado', svg: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 17,6"/><path d="M8 6V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2"/><path d="M16 6l-1 12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1L4 6"/></svg>' },
        ELIMINAR_INFORME:  { cls: 'feed-icon-archivado', svg: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 17,6"/><path d="M8 6V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2"/><path d="M16 6l-1 12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1L4 6"/></svg>' },
        CREAR_INFORME_UCO:  { cls: 'feed-icon-uco',      svg: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M17 10a7 7 0 0 0-.3-2l1.8-1.2-1.5-2.6-2 .6a6.8 6.8 0 0 0-1.7-1L13 2h-3l-.3 1.8a6.8 6.8 0 0 0-1.7 1l-2-.6L4.5 6.8 6.3 8A7 7 0 0 0 6 10c0 .7.1 1.4.3 2l-1.8 1.2 1.5 2.6 2-.6a6.8 6.8 0 0 0 1.7 1L10 18h3l.3-1.8a6.8 6.8 0 0 0 1.7-1l2 .6 1.5-2.6L17 12a7 7 0 0 0 .3-2z"/></svg>' },
        CREAR_INFORME_FYF:  { cls: 'feed-icon-fyf',      svg: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M7 7h6M7 10h6M7 13h4"/></svg>' }
      };
      const cfg = iconCfg[a.accion] || { cls: 'feed-icon-informe', svg: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="10" r="7"/></svg>' };
      const label = a.accion.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
      return '<div class="feed-item"><div class="feed-item-icon ' + cfg.cls + '">' + cfg.svg + '</div><div class="feed-item-body"><div class="feed-item-action">' + label + '</div><div class="feed-item-detail">' + (a.detalle || '') + '</div><div class="feed-item-user"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="5" r="2.5"/><path d="M2 14c0-3 2.5-5.5 6-5.5s6 2.5 6 5.5"/></svg> ' + esc(a.nombre_completo || a.usuario) + '</div></div><div class="feed-item-time">' + formatFecha(a.fecha) + '</div></div>';
    }).join('');
  } catch (err) {
    console.error('Dashboard error:', err);
  }
}

function formatFecha(f) {
  if (!f) return '';
  return f.replace('T', ' ').slice(0, 16);
}

async function loadCiudadanos(q) {
  try {
    const query = q ? '?q=' + encodeURIComponent(q) : '';
    const rows = await api('/ciudadanos' + query);
    allCiudadanosCache = rows;
    const tbody = document.getElementById('ciudadanosBody');
    const emptyMsg = document.getElementById('emptyCiuMsg');
    if (!rows.length) {
      tbody.innerHTML = '';
      emptyMsg.style.display = '';
      return;
    }
    emptyMsg.style.display = 'none';
    tbody.innerHTML = rows.map(c =>
      '<tr><td>' + esc(c.dni) + '</td><td>' + esc(c.nombre) + '</td><td>' + esc(c.apellidos) + '</td><td class="actions-cell"><button class="btn btn-sm btn-secondary" onclick="viewCiudadano(' + c.id + ')">Ver</button>' + (!hasRole('alumno') ? ' <button class="btn btn-sm btn-secondary" onclick="editCiudadano(' + c.id + ')">Editar</button>' : '') + (hasRole('admin') || hasRole('oficial') ? ' <button class="btn btn-sm btn-danger" onclick="deleteCiudadano(' + c.id + ')">Eliminar</button>' : '') + '</td></tr>'
    ).join('');
  } catch (err) {
    console.error('Ciudadanos error:', err);
  }
}

async function viewCiudadano(id) {
  try {
    const c = await api('/ciudadanos/' + id);
    const informes = await api('/ciudadanos/' + id + '/informes');
    let photoHtml = '';
    if (c.foto_url) {
      photoHtml = '<div style="text-align:center;margin-bottom:14px"><img src="' + c.foto_url + '" alt="Foto" style="width:120px;height:120px;border-radius:50%;object-fit:cover;border:3px solid var(--border-light);cursor:pointer" onclick="window.open(\'' + c.foto_url + '\')"></div>';
    }
    let infHtml = '<p style="color:var(--text-light)">No hay informes.</p>';
    if (informes.length) {
      infHtml = '<table class="modal-table"><thead><tr><th>Nº</th><th>Título</th><th>Estado</th></tr></thead><tbody>' + informes.map(i =>
        '<tr style="cursor:pointer" onclick="closeModal();viewInforme(' + i.id + ')"><td>' + esc(i.numero_informe) + '</td><td>' + esc(i.titulo) + '</td><td><span class="estado-badge estado-' + i.estado + '">' + esc(i.estado) + '</span></td></tr>'
      ).join('') + '</tbody></table>';
    }
    openModal('Ciudadano: ' + esc(c.nombre) + ' ' + esc(c.apellidos),
      photoHtml + '<div class="modal-detail"><p><strong>DNI:</strong> ' + esc(c.dni) + '</p><p><strong>Nombre:</strong> ' + esc(c.nombre) + ' ' + esc(c.apellidos) + '</p>' + (c.observaciones ? '<p><strong>Observaciones:</strong> ' + esc(c.observaciones) + '</p>' : '') + '</div><h4 style="margin-top:16px">Informes</h4>' + infHtml);
  } catch (err) {
    alert(err.error || 'Error al cargar ciudadano.');
  }
}

function editCiudadano(id) {
  const c = allCiudadanosCache.find(x => x.id === id);
  if (!c) return;
  editingCiuId = id;
  let currentPhotoHtml = '';
  api('/ciudadanos/' + id).then(full => {
    if (full.foto_url) {
      currentPhotoHtml = '<div style="text-align:center;margin-bottom:10px"><img src="' + full.foto_url + '" alt="Foto actual" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:2px solid var(--border-light)"></div>';
    }
    openModal('Editar Ciudadano',
      '<form id="editCiuForm">' + currentPhotoHtml + '<div class="form-group"><label>Cambiar foto</label><div class="file-zone" id="editCiuPhotoZone"><div class="file-zone-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg></div><div class="file-zone-text"><strong>Seleccionar foto</strong> o arrastra aquí</div><div class="file-zone-hint">JPG, PNG, GIF</div><input type="file" id="ec_photo" accept="image/*"></div><div id="ecPhotoPreview"></div></div><div class="form-group"><label>DNI</label><input type="text" id="ec_dni" value="' + esc(c.dni) + '"></div><div class="form-group"><label>Nombre</label><input type="text" id="ec_nombre" value="' + esc(c.nombre) + '"></div><div class="form-group"><label>Apellidos</label><input type="text" id="ec_apellidos" value="' + esc(c.apellidos) + '"></div></form>',
      '<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveEditCiudadano()">Guardar</button>');
    setTimeout(() => {
      setupFileDropZone('editCiuPhotoZone', 'ec_photo', 'ecPhotoPreview', (files) => {
        if (files.length) {
          const reader = new FileReader();
          reader.onload = (e) => {
            document.getElementById('ecPhotoPreview').innerHTML = '<div class="file-card"><div class="file-card-thumb"><img src="' + e.target.result + '" alt="preview"></div><div class="file-card-info"><div class="file-card-name">' + esc(files[0].name) + '</div><div class="file-card-meta">Nueva foto</div></div></div>';
          };
          reader.readAsDataURL(files[0]);
        }
      });
    }, 50);
  }).catch(() => {
    openModal('Editar Ciudadano',
      '<form id="editCiuForm"><div class="form-group"><label>DNI</label><input type="text" id="ec_dni" value="' + esc(c.dni) + '"></div><div class="form-group"><label>Nombre</label><input type="text" id="ec_nombre" value="' + esc(c.nombre) + '"></div><div class="form-group"><label>Apellidos</label><input type="text" id="ec_apellidos" value="' + esc(c.apellidos) + '"></div></form>',
      '<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveEditCiudadano()">Guardar</button>');
  });
}

async function saveEditCiudadano() {
  try {
    const body = { dni: document.getElementById('ec_dni').value, nombre: document.getElementById('ec_nombre').value, apellidos: document.getElementById('ec_apellidos').value };
    const photoInput = document.getElementById('ec_photo');
    if (photoInput && photoInput.files && photoInput.files.length) {
      const uploaded = await uploadFile(photoInput.files[0]);
      body.foto = uploaded.filename;
    }
    await api('/ciudadanos/' + editingCiuId, { method: 'PUT', body });
    closeModal();
    loadCiudadanos();
  } catch (err) {
    alert(err.error || 'Error al guardar.');
  }
}

async function deleteCiudadano(id) {
  if (!confirm('¿Eliminar este ciudadano?')) return;
  try {
    await api('/ciudadanos/' + id, { method: 'DELETE' });
    loadCiudadanos();
  } catch (err) {
    alert(err.error || 'Error al eliminar.');
  }
}

async function loadInformes(q) {
  try {
    let url = '/informes';
    if (q) url += '?q=' + encodeURIComponent(q);
    const rows = await api(url);
    const tbody = document.getElementById('informesBody');
    const emptyMsg = document.getElementById('emptyInfMsg');
    if (!rows.length) {
      tbody.innerHTML = '';
      emptyMsg.style.display = '';
      return;
    }
    emptyMsg.style.display = 'none';
    tbody.innerHTML = rows.map(i => {
      const estadoClass = 'estado-' + i.estado;
      return '<tr><td>' + esc(i.numero_informe) + '</td><td>' + esc(i.titulo) + '</td><td>' + esc(i.autor_nombre || '') + '</td><td><span class="estado-badge ' + estadoClass + '">' + esc(i.estado) + '</span></td><td>' + formatFecha(i.fecha_creacion) + '</td><td class="actions-cell"><button class="btn btn-sm btn-secondary" onclick="viewInforme(' + i.id + ')">Ver</button>' + (canEditInforme(i) ? ' <button class="btn btn-sm btn-secondary" onclick="editInforme(' + i.id + ')">Editar</button>' : '') + (hasRole('admin') || hasRole('oficial') ? ' <button class="btn btn-sm btn-danger" onclick="deleteInforme(' + i.id + ')">Eliminar</button>' : '') + '</td></tr>';
    }).join('');
  } catch (err) {
    console.error('Informes error:', err);
  }
}

function canEditInforme(i) {
  if (hasRole('admin') || hasRole('oficial') || hasRole('suboficial')) return true;
  if (hasRole('uco') && i.tipo_uco) return true;
  if (hasRole('fyf') && i.tipo_fyf) return true;
  return false;
}

async function viewInforme(id) {
  try {
    const i = await api('/informes/' + id);
    let ciudadanoHtml = '';
    if (i.ciudadano_id) {
      try {
        const c = await api('/ciudadanos/' + i.ciudadano_id);
        ciudadanoHtml = '<p><strong>Ciudadano:</strong> <a href="#" onclick="closeModal();viewCiudadano(' + c.id + ');return false" style="color:var(--accent);text-decoration:underline">' + esc(c.nombre) + ' ' + esc(c.apellidos) + ' (' + esc(c.dni) + ')</a></p>';
      } catch {}
    }
    let archivosHtml = '';
    if (i.archivos_list && i.archivos_list.length) {
      archivosHtml = '<div style="margin-top:12px"><h4 style="font-size:0.82rem;margin-bottom:6px;color:var(--text-light)">Archivos adjuntos</h4><div style="display:flex;flex-wrap:wrap;gap:8px">' +
        i.archivos_list.map(a => {
          const isImage = a.mimetype && a.mimetype.startsWith('image/');
          const isVideo = a.mimetype && a.mimetype.startsWith('video/');
          const thumb = isImage ? '<div class="file-card-thumb"><img src="' + a.url + '" alt="' + attrEsc(a.originalname) + '" style="width:100%;height:100%;object-fit:cover"></div>' : '<div class="file-card-thumb"><div class="file-type-icon file-type-' + (a.mimetype?.includes('pdf') ? 'pdf' : 'other') + '">' + (a.originalname?.split('.').pop() || '?') + '</div></div>';
          const previewFn = isImage ? 'window.open(\'' + a.url + '\')' : (isVideo ? 'previewVideo(\'' + a.url + '\')' : '');
          const safeName = attrEsc(a.originalname || 'download');
          const previewBtn = previewFn ? '<button class="btn btn-sm btn-secondary" onclick="' + previewFn + '" style="font-size:0.65rem;padding:2px 6px">Ver</button>' : '';
          return '<div class="file-card" style="max-width:200px"><div style="cursor:pointer" onclick="' + (previewFn || 'downloadFile(\'' + a.url + '\',\'' + safeName + '\')') + '">' + thumb + '</div><div class="file-card-info" style="padding:6px 8px"><div class="file-card-name" style="font-size:0.72rem">' + esc(a.originalname) + '</div><div class="file-card-meta">' + formatFileSize(a.size) + '</div><div style="margin-top:4px;display:flex;gap:4px">' + previewBtn + '<button class="btn btn-sm btn-secondary" onclick="downloadFile(\'' + a.url + '\',\'' + safeName + '\')" style="font-size:0.65rem;padding:2px 6px">Descargar</button></div></div></div>';
        }).join('') + '</div></div>';
    }
    openModal('Informe ' + esc(i.numero_informe),
      '<div class="modal-detail"><p><strong>Título:</strong> ' + esc(i.titulo) + '</p><p><strong>Estado:</strong> <span class="estado-badge estado-' + i.estado + '">' + esc(i.estado) + '</span></p><p><strong>Autor:</strong> ' + esc(i.autor_nombre || '') + '</p><p><strong>Fecha:</strong> ' + formatFecha(i.fecha_creacion) + '</p>' + ciudadanoHtml + (i.placas_participantes ? '<p><strong>Placas:</strong> ' + esc(i.placas_participantes) + '</p>' : '') + '<div style="margin-top:12px;padding:12px;background:var(--bg);border-radius:var(--radius)">' + (i.contenido || '<em>Sin contenido</em>') + '</div>' + archivosHtml + '</div>');
  } catch (err) {
    alert(err.error || 'Error al cargar informe.');
  }
}

function downloadFile(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function previewVideo(url) {
  openModal('Vista previa',
    '<div style="text-align:center"><video src="' + url + '" controls style="max-width:100%;max-height:70vh" autoplay></video></div>',
    '<button class="btn btn-secondary" onclick="closeModal()">Cerrar</button>');
}

function editInforme(id) {
  editingInfId = id;
  Promise.all([api('/informes/' + id), api('/informes/' + id + '/historial-estados')]).then(([i, hist]) => {
    const canChangeState = hasRole('admin') || hasRole('oficial') || hasRole('suboficial');
    const estadoOpts = ['pendiente', 'aprobado', 'archivado'].map(s =>
      '<option value="' + s + '"' + (i.estado === s ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>'
    ).join('');
    const estadoHtml = canChangeState
      ? '<div class="form-group"><label>Estado</label><select id="ei_estado">' + estadoOpts + '</select></div>'
      : '<div class="form-group"><label>Estado</label><span class="estado-badge estado-' + i.estado + '">' + esc(i.estado) + '</span><input type="hidden" id="ei_estado" value="' + i.estado + '"></div>';
    const histHtml = hist && hist.length
      ? '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border-light)"><h4 style="font-size:0.8rem;color:var(--text-light);margin-bottom:6px">Historial de cambios de estado</h4><div style="font-size:0.78rem">' + hist.map(h =>
          '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border-light)"><span>' + esc(h.estado_anterior) + ' → ' + esc(h.estado_nuevo) + '</span><span style="color:var(--text-muted)">' + esc(h.cambiado_por_usuario) + ' · ' + formatFecha(h.fecha) + '</span></div>'
        ).join('') + '</div></div>'
      : '';
    openModal('Editar Informe',
      '<form id="editInfForm"><div class="form-group"><label>Título</label><input type="text" id="ei_titulo" value="' + esc(i.titulo) + '"></div><div class="form-group"><label>Placas participantes</label><input type="text" id="ei_placas" value="' + esc(i.placas_participantes || '') + '"></div><div class="form-group"><label>Contenido</label><textarea id="ei_contenido" rows="6" style="width:100%">' + esc(i.contenido || '') + '</textarea></div>' + estadoHtml + histHtml + '</form>',
      '<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveEditInforme()">Guardar</button>');
  }).catch(err => alert(err.error || 'Error.'));
}

async function saveEditInforme() {
  try {
    await api('/informes/' + editingInfId, { method: 'PUT', body: { titulo: document.getElementById('ei_titulo').value, placas_participantes: document.getElementById('ei_placas').value, contenido: document.getElementById('ei_contenido').value, estado: document.getElementById('ei_estado').value } });
    closeModal();
    loadInformes();
  } catch (err) {
    alert(err.error || 'Error al guardar.');
  }
}

async function deleteInforme(id) {
  if (!confirm('¿Eliminar este informe?')) return;
  try {
    await api('/informes/' + id, { method: 'DELETE' });
    loadInformes();
  } catch (err) {
    alert(err.error || 'Error al eliminar.');
  }
}

function setupCiudadanoForm() {
  document.getElementById('newCiudadanoBtn').addEventListener('click', () => {
    openModal('Nuevo Ciudadano',
      '<form id="newCiuForm"><div class="form-group"><label>Foto</label><div class="file-zone" id="ciuPhotoZone"><div class="file-zone-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg></div><div class="file-zone-text"><strong>Seleccionar foto</strong> o arrastra aquí</div><div class="file-zone-hint">JPG, PNG, GIF · Max 5 MB</div><input type="file" id="ciu_photo" accept="image/*"></div><div id="ciuPhotoPreview"></div></div><div class="form-group"><label>DNI *</label><input type="text" id="nc_dni" required></div><div class="form-group"><label>Nombre *</label><input type="text" id="nc_nombre" required></div><div class="form-group"><label>Apellidos *</label><input type="text" id="nc_apellidos" required></div></form>',
      '<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveNewCiudadano()">Crear</button>');
    setTimeout(() => {
      document.getElementById('ciuPhotoPreview').innerHTML = '';
      document.getElementById('ciu_photo').value = '';
      setupFileDropZone('ciuPhotoZone', 'ciu_photo', 'ciuPhotoPreview', (files) => {
        if (files.length) {
          const reader = new FileReader();
          reader.onload = (e) => {
            document.getElementById('ciuPhotoPreview').innerHTML = '<div class="file-card"><div class="file-card-thumb"><img src="' + e.target.result + '" alt="preview"></div><div class="file-card-info"><div class="file-card-name">' + esc(files[0].name) + '</div><div class="file-card-meta">' + formatFileSize(files[0].size) + '</div></div></div>';
          };
          reader.readAsDataURL(files[0]);
        }
      });
    }, 50);
  });
}

async function saveNewCiudadano() {
  const dni = document.getElementById('nc_dni').value.trim();
  const nombre = document.getElementById('nc_nombre').value.trim();
  const apellidos = document.getElementById('nc_apellidos').value.trim();
  if (!dni || !nombre || !apellidos) { alert('DNI, nombre y apellidos son obligatorios.'); return; }
  try {
    let foto = '';
    const photoInput = document.getElementById('ciu_photo');
    if (photoInput && photoInput.files && photoInput.files.length) {
      const uploaded = await uploadFile(photoInput.files[0]);
      foto = uploaded.filename;
    }
    await api('/ciudadanos', { method: 'POST', body: { dni, nombre, apellidos, foto } });
    closeModal();
    loadCiudadanos();
  } catch (err) {
    alert(err.error || 'Error al crear ciudadano.');
  }
}

let pendingFiles = [];

function setupInformeForm() {
  document.getElementById('newInformeBtn').addEventListener('click', async () => {
    try { allCiudadanosCache = await api('/ciudadanos'); } catch {}
    const opts = '<option value="">-- Ninguno --</option>' + allCiudadanosCache.map(c => '<option value="' + c.id + '">' + esc(c.dni) + ' - ' + esc(c.nombre) + ' ' + esc(c.apellidos) + '</option>').join('');
    pendingFiles = [];
    openModal('Nuevo Informe',
      '<form id="newInfForm"><div class="form-group"><label>Título *</label><input type="text" id="ni_titulo" required></div><div class="form-group"><label>Placas participantes</label><input type="text" id="ni_placas" placeholder="Ej: 123-456-789"></div><div class="form-group"><label>Ciudadano</label><select id="ni_ciudadano">' + opts + '</select></div><div class="form-group"><label>Contenido</label><textarea id="ni_contenido" rows="6" style="width:100%"></textarea></div><div class="form-group"><label>Archivos adjuntos</label><div class="file-zone" id="infFileZone"><div class="file-zone-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg></div><div class="file-zone-text"><strong>Seleccionar archivos</strong> o arrastra aquí</div><div class="file-zone-hint">PDF, JPG, PNG, MP4 · Archivos múltiples permitidos</div><input type="file" id="inf_files" accept="image/*,.pdf,.mp4,.webm,.doc,.docx,.txt" multiple></div><div id="infFilePreview"></div></div></form>',
      '<button class="btn btn-secondary" onclick="cancelPendingFiles();closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveNewInforme()">Crear</button>');
    setTimeout(() => {
      setupFileDropZone('infFileZone', 'inf_files', 'infFilePreview', (files) => {
        renderFilePreview('infFilePreview', files, true);
        pendingFiles = files;
      });
    }, 50);
  });
}

function renderFilePreview(containerId, files, isPending) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  if (!files || !files.length) return;
  Array.from(files).forEach((f, i) => {
    const isImage = f.type && f.type.startsWith('image/');
    const thumbHtml = isImage
      ? '<img src="' + URL.createObjectURL(f) + '" alt="preview" style="width:100%;height:100%;object-fit:cover">'
      : '<div class="file-type-icon file-type-' + (f.type?.includes('pdf') ? 'pdf' : 'other') + '">' + (f.name?.split('.').pop() || '?') + '</div>';
    container.innerHTML += '<div class="file-card" data-idx="' + i + '"><div class="file-card-thumb">' + thumbHtml + '</div><div class="file-card-info"><div class="file-card-name">' + esc(f.name) + '</div><div class="file-card-meta">' + formatFileSize(f.size) + '</div></div><button class="file-card-remove" type="button" onclick="this.closest(\'.file-card\').remove()" title="Eliminar">✕</button></div>';
  });
}

async function cancelPendingFiles() {
  pendingFiles = [];
}

async function saveNewInforme() {
  const titulo = document.getElementById('ni_titulo').value.trim();
  if (!titulo) { alert('El título es obligatorio.'); return; }
  try {
    let archivos = [];
    const fileInput = document.getElementById('inf_files');
    if (fileInput && fileInput.files && fileInput.files.length) {
      archivos = await uploadFiles(fileInput.files);
    } else if (pendingFiles && pendingFiles.length) {
      archivos = await uploadFiles(pendingFiles);
    }
    await api('/informes', { method: 'POST', body: { titulo, placas_participantes: document.getElementById('ni_placas').value, ciudadano_id: document.getElementById('ni_ciudadano').value || null, contenido: document.getElementById('ni_contenido').value, archivos } });
    pendingFiles = [];
    closeModal();
    loadInformes();
  } catch (err) {
    alert(err.error || 'Error al crear informe.');
  }
}

async function loadAuditoria(q) {
  try {
    let url = '/auditoria';
    if (q) url += '?q=' + encodeURIComponent(q);
    const rows = await api(url);
    const tbody = document.getElementById('auditoriaBody');
    const emptyMsg = document.getElementById('emptyAudMsg');
    if (!rows.length) {
      tbody.innerHTML = '';
      emptyMsg.style.display = '';
      return;
    }
    emptyMsg.style.display = 'none';
    tbody.innerHTML = rows.map(a =>
      '<tr><td>' + formatFecha(a.fecha) + '</td><td>' + esc(a.usuario) + '</td><td>' + esc(a.rol) + '</td><td>' + esc(a.accion) + '</td><td>' + esc(a.detalle) + '</td><td>' + esc(a.ip) + '</td></tr>'
    ).join('');
  } catch (err) {
    console.error('Auditoría error:', err);
  }
}

async function loadUCO(q) {
  try {
    const query = q ? '?q=' + encodeURIComponent(q) : '';
    const rows = await api('/uco/informes' + query);
    const tbody = document.getElementById('ucoBody');
    const emptyMsg = document.getElementById('emptyUcoMsg');
    if (!rows.length) {
      tbody.innerHTML = '';
      emptyMsg.style.display = '';
      return;
    }
    emptyMsg.style.display = 'none';
    tbody.innerHTML = rows.map(i =>
      '<tr><td>' + esc(i.numero_informe) + '</td><td>' + esc(i.titulo) + '</td><td>' + esc(i.autor_nombre || '') + '</td><td>' + esc(i.tipo_uco) + '</td><td><span class="estado-badge estado-' + i.estado + '">' + esc(i.estado) + '</span></td><td>' + formatFecha(i.fecha_creacion) + '</td><td class="actions-cell"><button class="btn btn-sm btn-secondary" onclick="viewInforme(' + i.id + ')">Ver</button>' + (canEditInforme(i) ? ' <button class="btn btn-sm btn-secondary" onclick="editInforme(' + i.id + ')">Editar</button>' : '') + '</td></tr>'
    ).join('');
  } catch (err) {
    console.error('UCO error:', err);
  }
  loadDerivados();
}

async function loadDerivados() {
  try {
    const rows = await api('/uco/derivados');
    const tbody = document.getElementById('derivadosBody');
    const emptyMsg = document.getElementById('emptyDerMsg');
    if (!rows.length) {
      tbody.innerHTML = '';
      emptyMsg.style.display = '';
      return;
    }
    emptyMsg.style.display = 'none';
    tbody.innerHTML = rows.map(i =>
      '<tr><td>' + esc(i.numero_informe) + '</td><td>' + esc(i.titulo) + '</td><td>' + esc(i.num_informe_origen || '') + '</td><td><span class="estado-badge estado-' + i.estado + '">' + esc(i.estado) + '</span></td><td>' + formatFecha(i.fecha_creacion) + '</td><td class="actions-cell"><button class="btn btn-sm btn-secondary" onclick="viewInforme(' + i.id + ')">Ver</button></td></tr>'
    ).join('');
  } catch (err) {
    console.error('Derivados error:', err);
  }
}

function setupUcoForm() {
  document.getElementById('ucoForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titulo = document.getElementById('f_uco_titulo').value.trim();
    const tipo_uco = document.getElementById('f_uco_tipo').value;
    if (!titulo) { alert('El título es obligatorio.'); return; }
    try {
      let archivos = [];
      const fileInput = document.getElementById('f_uco_archivos');
      if (fileInput && fileInput.files && fileInput.files.length) {
        archivos = await uploadFiles(fileInput.files);
      }
      await api('/uco/informes', { method: 'POST', body: { titulo, tipo_uco, placas_participantes: document.getElementById('f_uco_placas').value, ciudadano_id: document.getElementById('f_uco_ciudadano').value || null, contenido: document.getElementById('f_uco_contenido').innerHTML, archivos } });
      document.getElementById('ucoForm').reset();
      document.getElementById('f_uco_contenido').innerHTML = '';
      document.getElementById('ucoFilePreview').innerHTML = '';
      loadUCO();
      setupUCOTabs();
    } catch (err) {
      alert(err.error || 'Error al crear informe UCO.');
    }
  });
}

function setupUCOTabs() {
  document.querySelectorAll('.uco-tab').forEach(tab => {
    tab.addEventListener('click', async () => {
      document.querySelectorAll('.uco-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.uco-panel').forEach(p => p.style.display = 'none');
      const target = tab.dataset.ucotab;
      if (target === 'propios') document.getElementById('ucoPropios').style.display = '';
      else if (target === 'nuevo') {
        document.getElementById('ucoNuevo').style.display = '';
        try {
          const ciudadanos = await api('/ciudadanos');
          const sel = document.getElementById('f_uco_ciudadano');
          sel.innerHTML = '<option value="">-- Ninguno --</option>' + ciudadanos.map(c => '<option value="' + c.id + '">' + esc(c.dni) + ' - ' + esc(c.nombre) + ' ' + esc(c.apellidos) + '</option>').join('');
        } catch {}
        setupFileDropZone('ucoFileZone', 'f_uco_archivos', 'ucoFilePreview', (files) => {
          renderFilePreview('ucoFilePreview', files, true);
        });
      }
      else if (target === 'derivados') document.getElementById('ucoDerivados').style.display = '';
    });
  });
  document.querySelectorAll('.uco-panel').forEach(p => p.style.display = 'none');
  document.getElementById('ucoPropios').style.display = '';
}

function loadPendientes() {
  api('/admin/pendientes').then(rows => {
    const tbody = document.getElementById('pendientesBody');
    const emptyMsg = document.getElementById('emptyPendMsg');
    document.getElementById('pendientesCount').textContent = rows.length;
    if (!rows.length) {
      tbody.innerHTML = '';
      emptyMsg.style.display = '';
      return;
    }
    emptyMsg.style.display = 'none';
    const allRoles = ['alumno', 'guardia', 'suboficial', 'oficial', 'uco', 'fyf', 'admin'];
    tbody.innerHTML = rows.map(u => {
      const checkboxes = allRoles.map(r =>
        '<label class="checkbox-label" style="display:inline-flex;align-items:center;gap:4px;margin:2px 6px 2px 0;cursor:pointer;font-size:0.78rem;background:var(--bg);padding:2px 6px;border-radius:4px;border:1px solid var(--border-light)"><input type="checkbox" class="ap-role-cb-' + u.id + '" value="' + r + '"' + (r === 'alumno' ? ' checked' : '') + '> <span style="white-space:nowrap">' + r.charAt(0).toUpperCase() + r.slice(1) + '</span></label>'
      ).join('');
      return '<tr><td>' + u.id + '</td><td><strong>' + esc(u.usuario) + '</strong>' + (u.nombre_completo ? '<br><span style="font-size:0.78rem;color:var(--text-light)">' + esc(u.nombre_completo) + '</span>' : '') + '</td><td>' + formatFecha(u.fecha_creacion) + '</td><td><span style="font-size:0.78rem;color:var(--text-muted)">Pendiente</span></td><td><div style="display:flex;flex-wrap:wrap;gap:2px;max-width:350px">' + checkboxes + '</div></td><td class="actions-cell" style="white-space:nowrap"><button class="btn btn-sm btn-primary" onclick="aprobarUsuario(' + u.id + ')">Aprobar</button> <button class="btn btn-sm btn-danger" onclick="rechazarUsuario(' + u.id + ')">Rechazar</button></td></tr>';
    }).join('');
  }).catch(err => alert(err.error || 'Error al cargar pendientes.'));
}

async function aprobarUsuario(id) {
  const cbs = document.querySelectorAll('.ap-role-cb-' + id + ':checked');
  const roles = Array.from(cbs).map(cb => cb.value);
  if (!roles.length) { alert('Debe seleccionar al menos un rol para aprobar.'); return; }
  if (!confirm('¿Aprobar y asignar rol(es): ' + roles.join(', ') + '?')) return;
  try {
    await api('/admin/aprobar/' + id, { method: 'POST', body: { roles } });
    loadPendientes();
  } catch (err) {
    alert(err.error || 'Error al aprobar.');
  }
}

async function rechazarUsuario(id) {
  if (!confirm('¿Rechazar y eliminar esta cuenta?')) return;
  try {
    await api('/admin/rechazar/' + id, { method: 'POST' });
    loadPendientes();
  } catch (err) {
    alert(err.error || 'Error al rechazar.');
  }
}

function setupAdminTabs() {
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.admin-panel').forEach(p => p.style.display = 'none');
      const target = tab.dataset.admintab;
      if (target === 'usuarios') document.getElementById('adminTabUsuarios').style.display = '';
      else if (target === 'verificaciones') {
        document.getElementById('adminTabVerificaciones').style.display = '';
        loadPendientes();
      }
    });
  });
}

function setupNewUserBtn() {
  document.getElementById('newUserBtn').addEventListener('click', () => {
    openModal('Nuevo Usuario',
      '<form id="newUserForm"><div class="form-group"><label>Usuario *</label><input type="text" id="nu_usuario" required></div><div class="form-group"><label>Contraseña *</label><input type="password" id="nu_password" required></div><div class="form-group"><label>Roles</label><div style="padding:8px 0">' + ['alumno','guardia','suboficial','oficial','uco','fyf','admin'].map(r => '<label class="checkbox-label" style="display:inline-flex;align-items:center;gap:6px;margin:4px 8px 4px 0;cursor:pointer;font-size:0.85rem"><input type="checkbox" class="nu-role-cb" value="' + r + '"' + (r === 'alumno' ? ' checked' : '') + '> ' + r.charAt(0).toUpperCase() + r.slice(1) + '</label>').join('') + '</div></div><div class="form-group"><label>Nombre completo</label><input type="text" id="nu_nombre"></div></form>',
      '<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveNewUser()">Crear</button>');
  });
}

async function saveNewUser() {
  try {
    const cbs = document.querySelectorAll('.nu-role-cb:checked');
    const roles = Array.from(cbs).map(cb => cb.value);
    if (!roles.length) { alert('Debe seleccionar al menos un rol.'); return; }
    await api('/admin/usuarios', { method: 'POST', body: { usuario: document.getElementById('nu_usuario').value, password: document.getElementById('nu_password').value, rol: roles[0], roles, nombre_completo: document.getElementById('nu_nombre').value } });
    closeModal();
    loadAdmin();
  } catch (err) {
    alert(err.error || 'Error al crear usuario.');
  }
}

async function loadAdmin() {
  try {
    const rows = await api('/admin/usuarios');
    const tbody = document.getElementById('usuariosBody');
    const emptyMsg = document.getElementById('emptyUsersMsg');
    if (!rows.length) {
      tbody.innerHTML = '';
      emptyMsg.style.display = '';
      return;
    }
    emptyMsg.style.display = 'none';
    tbody.innerHTML = rows.map(u => {
      const rolesList = (u.roles || u.rol || '').split(',').filter(Boolean);
      const rolesHtml = rolesList.map(r => '<span class="role-badge role-' + r + '">' + esc(r) + '</span>').join(' ');
      return '<tr><td>' + u.id + '</td><td>' + esc(u.usuario) + '</td><td>' + rolesHtml + '</td><td>' + esc(u.nombre_completo) + '</td><td>' + esc(u.numero_profesional) + '</td><td>' + (u.verificado ? '✅' : '❌') + '</td><td>' + (u.bloqueado ? '🔒 Bloqueado' : '✅ Activo') + '</td><td class="actions-cell">' + (u.bloqueado ? '<button class="btn btn-sm btn-secondary" onclick="desbloquear(' + u.id + ')">Desbloquear</button>' : '') + ' <button class="btn btn-sm btn-secondary" onclick="editarUsuario(' + u.id + ')">Editar</button> <button class="btn btn-sm btn-danger" onclick="eliminarUsuario(' + u.id + ')">Eliminar</button></td></tr>';
    }).join('');
  } catch (err) {
    console.error('Admin error:', err);
  }
}

async function desbloquear(id) {
  try {
    await api('/admin/usuarios/' + id + '/desbloquear', { method: 'PUT' });
    loadAdmin();
  } catch (err) {
    alert(err.error || 'Error al desbloquear.');
  }
}

function editarUsuario(id) {
  api('/admin/usuarios').then(rows => {
    const u = rows.find(x => x.id === id);
    if (!u) return;
    const currentRoles = (u.roles || u.rol || '').split(',').filter(Boolean);
    const allRoles = ['alumno', 'guardia', 'suboficial', 'oficial', 'uco', 'fyf', 'admin'];
    const checkboxes = allRoles.map(r =>
      '<label class="checkbox-label" style="display:inline-flex;align-items:center;gap:6px;margin:4px 8px 4px 0;cursor:pointer;font-size:0.85rem"><input type="checkbox" class="eu-role-cb" value="' + r + '"' + (currentRoles.includes(r) ? ' checked' : '') + '> ' + r.charAt(0).toUpperCase() + r.slice(1) + '</label>'
    ).join('');
    openModal('Editar Usuario',
      '<form id="editUserForm"><div class="form-group"><label>Roles</label><div style="padding:8px 0">' + checkboxes + '</div></div><div class="form-group"><label>Nombre completo</label><input type="text" id="eu_nombre" value="' + esc(u.nombre_completo || '') + '"></div></form>',
      '<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveEditUsuario(' + u.id + ')">Guardar</button>');
  });
}

async function saveEditUsuario(id) {
  try {
    const cbs = document.querySelectorAll('.eu-role-cb:checked');
    const roles = Array.from(cbs).map(cb => cb.value);
    if (!roles.length) { alert('Debe seleccionar al menos un rol.'); return; }
    await api('/admin/usuarios/' + id, { method: 'PUT', body: { roles, nombre_completo: document.getElementById('eu_nombre').value } });
    closeModal();
    loadAdmin();
  } catch (err) {
    alert(err.error || 'Error al guardar.');
  }
}

async function eliminarUsuario(id) {
  if (!confirm('¿Eliminar este usuario?')) return;
  try {
    await api('/admin/usuarios/' + id, { method: 'DELETE' });
    loadAdmin();
  } catch (err) {
    alert(err.error || 'Error al eliminar.');
  }
}

function setupGlobalSearch() {
  const input = document.getElementById('gsInput');
  const dropdown = document.getElementById('gsDropdown');
  let debounce;
  let selectedIdx = -1;
  let results = [];

  function renderDropdown() {
    if (!results.length) {
      dropdown.innerHTML = '<div class="gs-item">Sin resultados</div>';
      dropdown.style.display = '';
      selectedIdx = -1;
      return;
    }
    let html = '';
    let idx = 0;
    for (const group of results) {
      html += '<div class="gs-group">' + group.label + '</div>';
      for (const item of group.items) {
        const cls = 'gs-item' + (idx === selectedIdx ? ' gs-selected' : '') + (item.cls ? ' ' + item.cls : '');
        html += '<div class="' + cls + '" data-idx="' + idx + '">' + item.html + '</div>';
        idx++;
      }
    }
    dropdown.innerHTML = html;
    dropdown.style.display = '';
    // Scroll selected into view
    const sel = dropdown.querySelector('.gs-selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function selectActive() {
    if (selectedIdx < 0) return;
    let idx = 0;
    for (const group of results) {
      for (const item of group.items) {
        if (idx === selectedIdx) {
          item.onclick();
          return;
        }
        idx++;
      }
    }
  }

  function buildResults(res) {
    const groups = [];
    if (res.usuarios && res.usuarios.length) {
      groups.push({
        label: 'Usuarios',
        items: res.usuarios.map(u => ({
          html: esc(u.usuario) + ' - ' + esc(u.nombre_completo || '') + ' <span class="gs-role">' + esc(u.rol) + '</span>',
          onclick: () => { dropdown.style.display = 'none'; navigateTo('admin'); }
        }))
      });
    }
    if (res.ciudadanos && res.ciudadanos.length) {
      groups.push({
        label: 'Ciudadanos',
        items: res.ciudadanos.map(c => ({
          html: esc(c.dni) + ' - ' + esc(c.nombre) + ' ' + esc(c.apellidos),
          onclick: () => { dropdown.style.display = 'none'; navigateTo('ciudadanos'); setTimeout(() => viewCiudadano(c.id), 200); }
        }))
      });
    }
    if (res.informes && res.informes.length) {
      groups.push({
        label: 'Informes',
        items: res.informes.map(i => {
          const section = (i.tipo_uco && i.tipo_uco !== '') ? 'uco' : (i.tipo_fyf && i.tipo_fyf !== '') ? 'fyf' : 'informes';
          return {
            html: esc(i.numero_informe) + ' - ' + esc(i.titulo) + ' <span class="gs-estado">' + esc(i.estado) + '</span>',
            onclick: () => { dropdown.style.display = 'none'; navigateTo(section); setTimeout(() => viewInforme(i.id), 200); }
          };
        })
      });
    }
    if (res.placas && res.placas.length) {
      groups.push({
        label: 'Matrículas',
        items: res.placas.map(p => ({
          html: esc(p.placas_participantes) + ' → ' + esc(p.numero_informe),
          cls: 'gs-placa',
          onclick: () => { dropdown.style.display = 'none'; navigateTo('informes'); setTimeout(() => viewInforme(p.id), 200); }
        }))
      });
    }
    return groups;
  }

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 2) { dropdown.style.display = 'none'; return; }
      try {
        const res = await api('/buscar?q=' + encodeURIComponent(q));
        results = buildResults(res);
        selectedIdx = -1;
        renderDropdown();
      } catch (err) {
        console.warn('Error en búsqueda:', err);
      }
    }, 250);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const total = results.reduce((acc, g) => acc + g.items.length, 0);
      if (total === 0) return;
      selectedIdx = Math.min(selectedIdx + 1, total - 1);
      renderDropdown();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (selectedIdx <= 0) { selectedIdx = -1; renderDropdown(); return; }
      selectedIdx = Math.max(selectedIdx - 1, 0);
      renderDropdown();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectActive();
    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none';
      input.blur();
    }
  });

  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) input.dispatchEvent(new Event('input')); });
  document.addEventListener('click', (e) => { if (!dropdown.contains(e.target) && e.target !== input) dropdown.style.display = 'none'; });
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'k') { e.preventDefault(); input.focus(); }
  });
}

function setupSearchCiudadanos() {
  const input = document.getElementById('searchCiuInput');
  const btn = document.getElementById('searchCiuBtn');
  btn.addEventListener('click', () => loadCiudadanos(input.value.trim()));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadCiudadanos(input.value.trim()); });
}

function setupSearchInformes() {
  const input = document.getElementById('searchInfInput');
  const btn = document.getElementById('searchInfBtn');
  btn.addEventListener('click', () => loadInformes(input.value.trim()));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadInformes(input.value.trim()); });
}

function setupSearchAuditoria() {
  const input = document.getElementById('searchAudInput');
  const btn = document.getElementById('searchAudBtn');
  btn.addEventListener('click', () => loadAuditoria(input.value.trim()));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadAuditoria(input.value.trim()); });
}

function setupSearchUCO() {
  const input = document.getElementById('searchUcoInput');
  const btn = document.getElementById('searchUcoBtn');
  btn.addEventListener('click', () => loadUCO(input.value.trim()));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadUCO(input.value.trim()); });
}

// ====== FYF ======

async function loadFYF(q) {
  try {
    const query = q ? '?q=' + encodeURIComponent(q) : '';
    const rows = await api('/fyf/informes' + query);
    const tbody = document.getElementById('fyfBody');
    const emptyMsg = document.getElementById('emptyFyfMsg');
    if (!rows.length) {
      tbody.innerHTML = '';
      emptyMsg.style.display = '';
      return;
    }
    emptyMsg.style.display = 'none';
    tbody.innerHTML = rows.map(i =>
      '<tr><td>' + esc(i.numero_informe) + '</td><td>' + esc(i.titulo) + '</td><td>' + esc(i.autor_nombre || '') + '</td><td>' + esc(i.tipo_fyf) + '</td><td><span class="estado-badge estado-' + i.estado + '">' + esc(i.estado) + '</span></td><td>' + formatFecha(i.fecha_creacion) + '</td><td class="actions-cell"><button class="btn btn-sm btn-secondary" onclick="viewInforme(' + i.id + ')">Ver</button>' + (canEditInforme(i) ? ' <button class="btn btn-sm btn-secondary" onclick="editInforme(' + i.id + ')">Editar</button>' : '') + '</td></tr>'
    ).join('');
  } catch (err) {
    console.error('FyF error:', err);
  }
}

function setupFyfForm() {
  document.getElementById('fyfForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titulo = document.getElementById('f_fyf_titulo').value.trim();
    const tipo_fyf = document.getElementById('f_fyf_tipo').value;
    if (!titulo) { alert('El título es obligatorio.'); return; }
    try {
      let archivos = [];
      const fileInput = document.getElementById('f_fyf_archivos');
      if (fileInput && fileInput.files && fileInput.files.length) {
        archivos = await uploadFiles(fileInput.files);
      }
      await api('/fyf/informes', { method: 'POST', body: { titulo, tipo_fyf, placas_participantes: document.getElementById('f_fyf_placas').value, ciudadano_id: document.getElementById('f_fyf_ciudadano').value || null, contenido: document.getElementById('f_fyf_contenido').innerHTML, archivos } });
      document.getElementById('fyfForm').reset();
      document.getElementById('f_fyf_contenido').innerHTML = '';
      document.getElementById('fyfFilePreview').innerHTML = '';
      loadFYF();
      setupFyfTabs();
    } catch (err) {
      alert(err.error || 'Error al crear informe FyF.');
    }
  });
}

function setupFyfTabs() {
  document.querySelectorAll('.fyf-tab').forEach(tab => {
    tab.addEventListener('click', async () => {
      document.querySelectorAll('.fyf-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.fyf-panel').forEach(p => p.style.display = 'none');
      const target = tab.dataset.fyftab;
      if (target === 'propios') document.getElementById('fyfPropios').style.display = '';
      else if (target === 'nuevo') {
        document.getElementById('fyfNuevo').style.display = '';
        try {
          const ciudadanos = await api('/ciudadanos');
          const sel = document.getElementById('f_fyf_ciudadano');
          sel.innerHTML = '<option value="">-- Ninguno --</option>' + ciudadanos.map(c => '<option value="' + c.id + '">' + esc(c.dni) + ' - ' + esc(c.nombre) + ' ' + esc(c.apellidos) + '</option>').join('');
        } catch {}
        setupFileDropZone('fyfFileZone', 'f_fyf_archivos', 'fyfFilePreview', (files) => {
          renderFilePreview('fyfFilePreview', files, true);
        });
      }
    });
  });
  document.querySelectorAll('.fyf-panel').forEach(p => p.style.display = 'none');
  document.getElementById('fyfPropios').style.display = '';
}

function setupSearchFYF() {
  const input = document.getElementById('searchFyfInput');
  const btn = document.getElementById('searchFyfBtn');
  btn.addEventListener('click', () => loadFYF(input.value.trim()));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadFYF(input.value.trim()); });
}

function execFormat(cmd, e) {
  e.preventDefault();
  document.execCommand(cmd, false, null);
}

function openModal(title, body, footer) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = body;
  document.getElementById('modalFooter').innerHTML = footer || '';
  document.getElementById('modalOverlay').classList.add('active');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
});

function esc(s) {
  if (!s) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
