const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const multer = require('multer');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(session({
  secret: 'sigc-rp-secret-' + crypto.randomBytes(16).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 30 * 60 * 1000 }
}));
app.use((req, res, next) => {
  if (req.session && req.session.lastActivity) {
    const ahora = Date.now();
    const diff = ahora - req.session.lastActivity;
    if (diff > 30 * 60 * 1000) {
      return req.session.destroy(() => res.status(401).json({ error: 'Sesión expirada por inactividad' }));
    }
  }
  if (req.session) req.session.lastActivity = Date.now();
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ====== FILE UPLOAD ======
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|bmp|svg|mp4|webm|ogg|pdf|doc|docx|xls|xlsx|txt|zip|rar)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido'));
    }
  }
});

// Serve uploaded files (auth required)
app.get('/api/files/:filename', requireAuth, (req, res) => {
  const filepath = path.join(UPLOADS_DIR, req.params.filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Archivo no encontrado' });
  res.sendFile(filepath);
});

// Upload single file
app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se envió ningún archivo' });
  logAudit(req, 'SUBIR_ARCHIVO', `Archivo: ${req.file.originalname} (${req.file.filename})`);
  res.json({
    filename: req.file.filename,
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size
  });
});

// Upload multiple files
app.post('/api/upload/multiple', requireAuth, upload.array('files', 20), (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'No se enviaron archivos' });
  const files = req.files.map(f => ({
    filename: f.filename,
    originalname: f.originalname,
    mimetype: f.mimetype,
    size: f.size
  }));
  logAudit(req, 'SUBIR_ARCHIVOS', `${files.length} archivo(s) subido(s)`);
  res.json(files);
});

// Delete file (admin/oficial only, consistent with informes deletion)
app.delete('/api/files/:filename', requireAuth, (req, res) => {
  const userRoles = (req.session.user.roles || req.session.user.rol || '').split(',').map(r => r.trim()).filter(Boolean);
  if (!userRoles.some(r => r === ROLES.ADMIN || r === ROLES.OFICIAL)) return res.status(403).json({ error: 'Acceso denegado' });
  const filepath = path.join(UPLOADS_DIR, req.params.filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Archivo no encontrado' });
  try {
    fs.unlinkSync(filepath);
    logAudit(req, 'ELIMINAR_ARCHIVO', `Archivo: ${req.params.filename}`);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar archivo' });
  }
});

function getIP(req) {
  return req.headers['x-forwarded-for'] || req.connection.remoteAddress || '0.0.0.0';
}

const ROLES = { ALUMNO: 'alumno', GUARDIA: 'guardia', SUBOFICIAL: 'suboficial', OFICIAL: 'oficial', UCO: 'uco', FYF: 'fyf', ADMIN: 'admin' };
const ROL_HIERARCHY = { alumno: 1, guardia: 2, suboficial: 3, oficial: 4, uco: 5, fyf: 5, admin: 6 };

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'No autenticado' });
  const u = db.one('SELECT bloqueado, bloqueado_hasta FROM usuarios WHERE id = ?', [req.session.user.id]);
  if (u && u.bloqueado) {
    if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
      req.session.destroy();
      return res.status(423).json({ error: 'Cuenta bloqueada' });
    }
    db.run('UPDATE usuarios SET bloqueado=0, bloqueado_hasta=NULL, intentos_fallidos=0 WHERE id=?', [req.session.user.id]);
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'No autenticado' });
    const userRoles = (req.session.user.roles || req.session.user.rol || '').split(',').map(r => r.trim()).filter(Boolean);
    if (!roles.some(r => userRoles.includes(r))) return res.status(403).json({ error: 'Acceso denegado' });
    next();
  };
}

function minLevel(nivel) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'No autenticado' });
    const userRoles = (req.session.user.roles || req.session.user.rol || '').split(',').map(r => r.trim()).filter(Boolean);
    const maxRoleLevel = Math.max(...userRoles.map(r => ROL_HIERARCHY[r] || 0), 0);
    if (maxRoleLevel < nivel) return res.status(403).json({ error: 'Acceso denegado' });
    next();
  };
}

function logAudit(req, accion, detalle = '') {
  if (!req.session.user) return;
  try {
    db.run('INSERT INTO auditoria (usuario_id, usuario, rol, accion, detalle, ip, fecha) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.session.user.id, req.session.user.usuario, req.session.user.rol, accion, detalle, getIP(req),
       new Date().toISOString().replace('T', ' ').slice(0, 19)]);
  } catch {}
}

const DEFAULT_USERS = [
  { usuario: 'alumno', rol: ROLES.ALUMNO, nombre_completo: 'Alumno en Prácticas', numero_profesional: 'AL-0001', identificador_interno: 'INT-AL-001' },
  { usuario: 'guardia', rol: ROLES.GUARDIA, nombre_completo: 'Guardia Civil', numero_profesional: 'GC-0001', identificador_interno: 'INT-GC-001' },
  { usuario: 'suboficial', rol: ROLES.SUBOFICIAL, nombre_completo: 'Suboficial', numero_profesional: 'SO-0001', identificador_interno: 'INT-SO-001' },
  { usuario: 'oficial', rol: ROLES.OFICIAL, nombre_completo: 'Oficial', numero_profesional: 'OF-0001', identificador_interno: 'INT-OF-001' },
  { usuario: 'uco', rol: ROLES.UCO, nombre_completo: 'Agente UCO', numero_profesional: 'UCO-001', identificador_interno: 'INT-UCO-001' },
  { usuario: 'fyf', rol: ROLES.FYF, nombre_completo: 'Agente FyF', numero_profesional: 'FYF-001', identificador_interno: 'INT-FYF-001' },
  { usuario: 'admin', rol: ROLES.ADMIN, nombre_completo: 'Administrador', numero_profesional: 'ADM-001', identificador_interno: 'INT-ADM-001' },
];

async function seedUsers() {
  const count = db.one('SELECT COUNT(*) as total FROM usuarios');
  if (count.total > 0) return;
  const FIXED_PASSWORDS = {
    alumno: 'kMI4xdKH!',
    guardia: 'yjwOiW5!',
    suboficial: 'S0TtTI7!',
    oficial: 'SM8u3kUQ!',
    uco: 'cnhHzxd!',
    fyf: 'fyfPwd789!',
    admin: 'yyzqtcd6!',
  };
  const passwords = { ...FIXED_PASSWORDS };
  for (const u of DEFAULT_USERS) {
    const pwd = FIXED_PASSWORDS[u.usuario];
    const hash = await bcrypt.hash(pwd, 10);
    db.run('INSERT INTO usuarios (usuario, password, rol, roles, nombre_completo, numero_profesional, identificador_interno, escala, verificado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
      [u.usuario, hash, u.rol, u.rol, u.nombre_completo, u.numero_profesional, u.identificador_interno, u.rol]);
  }
  console.log('');
  console.log('==================================================');
  console.log('  CREDENCIALES DE ACCESO');
  console.log('==================================================');
  const creds = [];
  for (const u of DEFAULT_USERS) {
    console.log(`  ${u.usuario.padEnd(12)} -> ${passwords[u.usuario]}  (${u.rol})`);
    creds.push(`${u.usuario}:${passwords[u.usuario]}:${u.rol}`);
  }
  console.log('==================================================');
  console.log('');
  try {
    require('fs').writeFileSync(path.join(__dirname, 'credenciales.txt'), creds.join('\n'));
  } catch {}
  console.log('Credenciales guardadas en credenciales.txt');
}

// ====== AUTH ======

// ====== REGISTRO ======
app.post('/api/registro', async (req, res) => {
  const { placa, password, nombre_completo } = req.body;
  if (!placa || !password) return res.status(400).json({ error: 'Número de placa y contraseña son obligatorios.' });
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  const placaLower = placa.toLowerCase().trim();
  const existente = db.one('SELECT id FROM usuarios WHERE usuario=?', [placaLower]);
  if (existente) return res.status(409).json({ error: 'Ya existe un usuario registrado con ese número de placa.' });
  try {
    const hash = await bcrypt.hash(password, 10);
    db.run('INSERT INTO usuarios (usuario, password, nombre_completo, verificado, rol, roles) VALUES (?, ?, ?, 0, ?, ?)',
      [placaLower, hash, nombre_completo || placaLower, '', '']);
    console.log(`[REGISTRO] Nuevo usuario: ${placaLower}`);
    res.status(201).json({ ok: true, mensaje: 'Registro exitoso. Su cuenta queda pendiente de verificación por un administrador.' });
  } catch (err) {
    console.error('[REGISTRO] Error:', err.message);
    res.status(500).json({ error: 'Error interno al registrar.' });
  }
});

const BLOQUEO_MAX = 20;
const BLOQUEO_VENTANA = 60 * 60 * 1000;
const BLOQUEO_TIEMPO = 5 * 60 * 1000;

app.post('/api/login', async (req, res) => {
  const { usuario, password } = req.body;
  const ip = getIP(req);
  if (!usuario || !password) return res.status(400).json({ error: 'Credenciales inválidas.' });

  const ahora = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const ventana = new Date(Date.now() - BLOQUEO_VENTANA).toISOString().replace('T', ' ').slice(0, 19);

  const recientes = db.one(
    'SELECT COUNT(*) as total FROM intentos_login WHERE usuario=? AND exitoso=0 AND fecha > ?',
    [usuario.toLowerCase(), ventana]
  );

  if (recientes.total >= BLOQUEO_MAX) {
    db.run('UPDATE usuarios SET bloqueado=1, bloqueado_hasta=? WHERE usuario=?',
      [new Date(Date.now() + BLOQUEO_TIEMPO).toISOString().replace('T', ' ').slice(0, 19), usuario.toLowerCase()]);
    return res.status(429).json({ error: 'Demasiados intentos. Cuenta bloqueada temporalmente.' });
  }

  const user = db.one('SELECT * FROM usuarios WHERE usuario = ?', [usuario.toLowerCase()]);
  if (!user) {
    db.run('INSERT INTO intentos_login (usuario, ip, exitoso, fecha) VALUES (?, ?, 0, ?)', [usuario.toLowerCase(), ip, ahora]);
    return res.status(401).json({ error: 'Credenciales inválidas.' });
  }

  if (user.bloqueado) {
    if (user.bloqueado_hasta && new Date(user.bloqueado_hasta) > new Date()) {
      return res.status(423).json({ error: 'Cuenta bloqueada temporalmente.' });
    }
    db.run('UPDATE usuarios SET bloqueado=0, bloqueado_hasta=NULL, intentos_fallidos=0 WHERE id=?', [user.id]);
  }

  if (!user.verificado) {
    return res.status(403).json({ error: 'Cuenta pendiente de verificación. Contacte a un administrador.' });
  }

  if (!user.rol) {
    return res.status(403).json({ error: 'Su cuenta no tiene un rol asignado. Contacte a un administrador.' });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    db.run('INSERT INTO intentos_login (usuario, ip, exitoso, fecha) VALUES (?, ?, 0, ?)', [usuario.toLowerCase(), ip, ahora]);
    return res.status(401).json({ error: 'Credenciales inválidas.' });
  }

  db.begin();
  try {
    db.run('INSERT INTO intentos_login (usuario, ip, exitoso, fecha) VALUES (?, ?, 1, ?)', [usuario.toLowerCase(), ip, ahora]);
    db.run('UPDATE usuarios SET intentos_fallidos=0 WHERE id=?', [user.id]);
    db.commit();
  } catch (e) {
    db.rollback();
    return res.status(500).json({ error: 'Error interno al iniciar sesión' });
  }

  const rolesList = (user.roles || user.rol || '').split(',').filter(Boolean);

  req.session.user = {
    id: user.id, usuario: user.usuario, rol: user.rol, roles: rolesList.join(','), nombre_completo: user.nombre_completo,
    numero_profesional: user.numero_profesional, identificador_interno: user.identificador_interno,
    escala: user.escala
  };

  logAudit(req, 'INICIO_SESION', `Usuario ${user.usuario} (${user.rol}) inició sesión`);
  res.json({
    id: user.id, usuario: user.usuario, rol: user.rol, roles: rolesList, nombre_completo: user.nombre_completo,
    numero_profesional: user.numero_profesional, identificador_interno: user.identificador_interno,
    escala: user.escala
  });
});

app.post('/api/logout', (req, res) => {
  logAudit(req, 'CIERRE_SESION', `Usuario ${req.session.user?.usuario} cerró sesión`);
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'No autenticado' });
  const user = { ...req.session.user };
  if (typeof user.roles === 'string') {
    user.roles = user.roles.split(',').filter(Boolean);
  }
  res.json(user);
});

app.get('/api/me/verificar', requireAuth, (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'No autenticado' });
  const u = db.one('SELECT usuario, rol, nombre_completo, numero_profesional, escala, identificador_interno FROM usuarios WHERE id=?', [req.session.user.id]);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (u.rol !== req.session.user.rol) {
    logAudit(req, 'DISCREPANCIA_ROL', `Discrepancia: BD=${u.rol}, Sesión=${req.session.user.rol}`);
    req.session.destroy();
    return res.status(403).json({ error: 'Discrepancia de permisos detectada. Acceso bloqueado.' });
  }
  res.json(u);
});

// ====== DASHBOARD ======

app.get('/api/dashboard', requireAuth, (req, res) => {
  const userRoles = (req.session.user.roles || req.session.user.rol || '').split(',').map(r => r.trim()).filter(Boolean);
  let filtroUCO = '', filtroFYF = '';
  if (!userRoles.includes(ROLES.UCO) && !userRoles.includes(ROLES.ADMIN)) {
    filtroUCO = " AND (tipo_uco = '' OR tipo_uco IS NULL)";
  }
  if (!userRoles.includes(ROLES.FYF) && !userRoles.includes(ROLES.ADMIN)) {
    filtroFYF = " AND (tipo_fyf = '' OR tipo_fyf IS NULL)";
  }
  const total = db.one('SELECT COUNT(*) as total FROM informes WHERE 1=1' + filtroUCO + filtroFYF);
  const pendientes = db.one("SELECT COUNT(*) as total FROM informes WHERE estado='pendiente'" + filtroUCO + filtroFYF);
  const aprobados = db.one("SELECT COUNT(*) as total FROM informes WHERE estado='aprobado'" + filtroUCO + filtroFYF);
  const archivados = db.one("SELECT COUNT(*) as total FROM informes WHERE estado='archivado'" + filtroUCO + filtroFYF);
  const activos = db.one("SELECT COUNT(*) as total FROM informes WHERE estado IN ('pendiente','aprobado')" + filtroUCO + filtroFYF);
  const derivados = db.one('SELECT COUNT(*) as total FROM informes WHERE informe_origen_id IS NOT NULL' + filtroUCO + filtroFYF);
  const ciudadanos = db.one('SELECT COUNT(*) as total FROM ciudadanos');
  res.json({
    total: total.total, pendientes: pendientes.total,
    aprobados: aprobados.total, archivados: archivados.total,
    activos: activos.total, derivados: derivados.total,
    ciudadanos: ciudadanos.total
  });
});

app.get('/api/dashboard/actividad', requireAuth, (req, res) => {
  const userRoles = (req.session.user.roles || req.session.user.rol || '').split(',').map(r => r.trim()).filter(Boolean);
  const userLevel = Math.max(...userRoles.map(r => ROL_HIERARCHY[r] || 0), 0);
  let allowedRoles;
  if (userLevel <= 1) {
    allowedRoles = ['alumno'];
  } else if (userLevel <= 2) {
    allowedRoles = ['alumno', 'guardia'];
  } else if (userLevel <= 3) {
    allowedRoles = ['alumno', 'guardia', 'suboficial'];
  } else {
    allowedRoles = ['alumno', 'guardia', 'suboficial', 'oficial', 'uco', 'fyf'];
  }
  const placeholders = allowedRoles.map(() => '?').join(',');
  const acciones = db.all(
    "SELECT a.*, u.nombre_completo FROM auditoria a LEFT JOIN usuarios u ON a.usuario = u.usuario WHERE a.accion IN ('CREAR_INFORME','EDITAR_INFORME','APROBAR_INFORME','ARCHIVAR_INFORME','DERIVAR_INFORME','CREAR_CIUDADANO','EDITAR_CIUDADANO','ELIMINAR_CIUDADANO','ELIMINAR_INFORME','CREAR_INFORME_FYF','CREAR_INFORME_UCO') AND a.rol IN (" + placeholders + ") ORDER BY a.fecha DESC LIMIT 15",
    allowedRoles
  );
  res.json(acciones);
});

// ====== CIUDADANOS ======

app.get('/api/ciudadanos', requireAuth, (req, res) => {
  const { q } = req.query;
  let rows;
  if (q) {
    rows = db.all('SELECT id, dni, nombre, apellidos FROM ciudadanos WHERE dni LIKE ? OR nombre LIKE ? OR apellidos LIKE ? OR observaciones LIKE ? ORDER BY apellidos, nombre',
      [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`]);
  } else {
    rows = db.all('SELECT id, dni, nombre, apellidos FROM ciudadanos ORDER BY apellidos, nombre');
  }
  res.json(rows);
});

app.get('/api/ciudadanos/:id', requireAuth, (req, res) => {
  const c = db.one('SELECT * FROM ciudadanos WHERE id=?', [+req.params.id]);
  if (!c) return res.status(404).json({ error: 'Ciudadano no encontrado' });
  if (c.foto) {
    c.foto_url = '/api/files/' + c.foto;
  }
  res.json(c);
});

app.post('/api/ciudadanos', requireAuth, (req, res) => {
  const { dni, nombre, apellidos, foto, observaciones } = req.body;
  console.log(`[CIUDADANO] POST recibido: dni="${dni}" nombre="${nombre}" apellidos="${apellidos}"`);
  if (!dni || !nombre || !apellidos) {
    console.log('[CIUDADANO] Error: campos obligatorios faltantes');
    return res.status(400).json({ error: 'DNI, nombre y apellidos son obligatorios' });
  }
  const rol = req.session.user.rol;
  if (rol === ROLES.ALUMNO || rol === ROLES.GUARDIA) {
    console.log('[CIUDADANO] Acceso denegado');
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  try {
    const dniUp = dni.toUpperCase().trim();
    db.begin();
    db.run('INSERT INTO ciudadanos (dni, nombre, apellidos, foto, observaciones) VALUES (?,?,?,?,?)',
      [dniUp, nombre.trim(), apellidos.trim(), foto || '', observaciones || '']);
    const newId = db.lastId();
    console.log(`[CIUDADANO] Creado ID=${newId} DNI=${dniUp}`);
    logAudit(req, 'CREAR_CIUDADANO', `DNI: ${dniUp}, Nombre: ${nombre.trim()} ${apellidos.trim()}`);
    db.commit();
    res.status(201).json({ id: newId });
  } catch (err) {
    console.error('[CIUDADANO] Error en POST:', err.message);
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe un ciudadano con ese DNI' });
    res.status(500).json({ error: 'Error interno: ' + err.message });
  }
});

app.put('/api/ciudadanos/:id', requireAuth, (req, res) => {
  const c = db.one('SELECT * FROM ciudadanos WHERE id=?', [+req.params.id]);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  const rol = req.session.user.rol;
  if (rol === ROLES.ALUMNO || rol === ROLES.GUARDIA) return res.status(403).json({ error: 'Acceso denegado' });
  const { dni, nombre, apellidos, foto, observaciones } = req.body;
  console.log(`[CIUDADANO] PUT ID=${req.params.id}: dni="${dni}" nombre="${nombre}"`);
  const tieneFoto = 'foto' in req.body;
  const tieneObs = 'observaciones' in req.body;
  try {
    const params = [
      (dni || c.dni).toUpperCase(), nombre || c.nombre, apellidos || c.apellidos
    ];
    let sql = 'UPDATE ciudadanos SET dni=?,nombre=?,apellidos=?';
    if (tieneFoto) { sql += ',foto=?'; params.push(foto); }
    if (tieneObs) { sql += ',observaciones=?'; params.push(observaciones); }
    sql += ' WHERE id=?';
    params.push(+req.params.id);
    db.run(sql, params);
    console.log(`[CIUDADANO] Actualizado ID=${req.params.id}`);
    logAudit(req, 'EDITAR_CIUDADANO', `DNI: ${(dni || c.dni).toUpperCase()}`);
    res.json({ updated: true });
  } catch (err) {
    console.error('[CIUDADANO] Error en PUT:', err.message);
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe un ciudadano con ese DNI' });
    res.status(500).json({ error: 'Error interno: ' + err.message });
  }
});

app.delete('/api/ciudadanos/:id', requireAuth, (req, res) => {
  const rol = req.session.user.rol;
  if (rol !== ROLES.ADMIN && rol !== ROLES.OFICIAL) return res.status(403).json({ error: 'Acceso denegado' });
  const r = db.run('DELETE FROM ciudadanos WHERE id=?', [+req.params.id]);
  if (r.changes === 0) return res.status(404).json({ error: 'No encontrado' });
  console.log(`[CIUDADANO] Eliminado ID=${req.params.id}`);
  logAudit(req, 'ELIMINAR_CIUDADANO', `ID: ${req.params.id}`);
  res.json({ deleted: true });
});

app.get('/api/ciudadanos/:id/informes', requireAuth, (req, res) => {
  const userRoles = (req.session.user.roles || req.session.user.rol || '').split(',').map(r => r.trim()).filter(Boolean);
  let filtro = '';
  if (!userRoles.includes(ROLES.UCO) && !userRoles.includes(ROLES.ADMIN)) {
    filtro += " AND (i.tipo_uco = '' OR i.tipo_uco IS NULL)";
  }
  if (!userRoles.includes(ROLES.FYF) && !userRoles.includes(ROLES.ADMIN)) {
    filtro += " AND (i.tipo_fyf = '' OR i.tipo_fyf IS NULL)";
  }
  const rows = db.all('SELECT i.*, u.usuario as autor_usuario, u.nombre_completo as autor_nombre FROM informes i LEFT JOIN usuarios u ON i.autor_id=u.id WHERE i.ciudadano_id=?' + filtro + ' ORDER BY i.fecha_creacion DESC', [+req.params.id]);
  res.json(rows);
});

// ====== INFORMES ======

app.get('/api/informes', requireAuth, (req, res) => {
  const rol = req.session.user.rol;
  const userRoles = (req.session.user.roles || rol || '').split(',').map(r => r.trim()).filter(Boolean);
  const q = req.query.q;
  const baseQuery = 'SELECT i.*, u.usuario as autor_usuario, u.nombre_completo as autor_nombre FROM informes i LEFT JOIN usuarios u ON i.autor_id=u.id';
  let params = [];
  let whereClause = '';
  // Non-UCO/FyF users cannot see specialized reports
  if (!userRoles.includes(ROLES.UCO) && !userRoles.includes(ROLES.ADMIN)) {
    whereClause = " WHERE (i.tipo_uco = '' OR i.tipo_uco IS NULL)";
  } else {
    whereClause = " WHERE 1=1";
  }
  if (!userRoles.includes(ROLES.FYF) && !userRoles.includes(ROLES.ADMIN)) {
    whereClause += " AND (i.tipo_fyf = '' OR i.tipo_fyf IS NULL)";
  }
  if (q) {
    const like = `%${q}%`;
    whereClause += " AND (i.titulo LIKE ? OR i.numero_informe LIKE ? OR i.contenido LIKE ?)";
    params.push(like, like, like);
  }
  const rows = db.all(baseQuery + whereClause + ' ORDER BY i.fecha_creacion DESC', params);
  res.json(rows);
});

app.get('/api/informes/:id', requireAuth, (req, res) => {
  const inf = db.one('SELECT i.*, u.usuario as autor_usuario, u.nombre_completo as autor_nombre FROM informes i LEFT JOIN usuarios u ON i.autor_id=u.id WHERE i.id=?', [+req.params.id]);
  if (!inf) return res.status(404).json({ error: 'Informe no encontrado' });
  const rol = req.session.user.rol;
  const userRoles = (req.session.user.roles || rol || '').split(',').map(r => r.trim()).filter(Boolean);
  const uid = req.session.user.id;
  if (rol === ROLES.ALUMNO && inf.autor_id !== uid) return res.status(403).json({ error: 'Acceso denegado' });
  if (rol === ROLES.GUARDIA) {
    const autor = db.one('SELECT rol FROM usuarios WHERE id=?', [inf.autor_id]);
    if (inf.autor_id !== uid && autor && ROL_HIERARCHY[autor.rol] >= ROL_HIERARCHY[rol]) return res.status(403).json({ error: 'Acceso denegado' });
  }
  // Non-UCO/FyF users cannot view specialized reports
  if (inf.tipo_uco && inf.tipo_uco !== '' && !userRoles.includes(ROLES.UCO) && !userRoles.includes(ROLES.ADMIN)) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  if (inf.tipo_fyf && inf.tipo_fyf !== '' && !userRoles.includes(ROLES.FYF) && !userRoles.includes(ROLES.ADMIN)) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  if (inf.archivos) {
    try {
      const arr = JSON.parse(inf.archivos);
      inf.archivos_list = arr.map(a => ({
        ...a,
        url: '/api/files/' + (a.filename || a.id)
      }));
    } catch { inf.archivos_list = []; }
  } else {
    inf.archivos_list = [];
  }
  res.json(inf);
});

app.post('/api/informes', requireAuth, (req, res) => {
  const rol = req.session.user.rol;
  if (rol === ROLES.ALUMNO || rol === ROLES.GUARDIA || rol === ROLES.UCO || rol === ROLES.FYF) return res.status(403).json({ error: 'Acceso denegado' });
  const { titulo, contenido, ciudadano_id, archivos, placas_participantes } = req.body;
  if (!titulo) return res.status(400).json({ error: 'El título es obligatorio' });
  const num = 'INF-' + Date.now().toString(36).toUpperCase() + '-' + String(Math.floor(Math.random() * 999)).padStart(3, '0');
  const ahora = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const archivosJson = archivos && archivos.length ? JSON.stringify(archivos) : '';
  db.begin();
  try {
    db.run('INSERT INTO informes (numero_informe,autor_id,ciudadano_id,titulo,contenido,placas_participantes,fecha_creacion,archivos) VALUES (?,?,?,?,?,?,?,?)',
      [num, req.session.user.id, ciudadano_id || null, titulo, contenido || '', placas_participantes || '', ahora, archivosJson]);
    const newInfId = db.lastId();
    const detalle = `Nº: ${num}, Título: ${titulo}` + (ciudadano_id ? `, Ciudadano ID: ${ciudadano_id}` : '');
    logAudit(req, 'CREAR_INFORME', detalle);
    db.commit();
    res.status(201).json({ id: newInfId, numero_informe: num });
  } catch (e) {
    db.rollback();
    res.status(500).json({ error: 'Error al crear informe' });
  }
});

app.put('/api/informes/:id', requireAuth, (req, res) => {
  const inf = db.one('SELECT * FROM informes WHERE id=?', [+req.params.id]);
  if (!inf) return res.status(404).json({ error: 'No encontrado' });
  const rol = req.session.user.rol;
  const uid = req.session.user.id;
  const userRoles = (req.session.user.roles || rol || '').split(',').map(r => r.trim()).filter(Boolean);

  // Permission logic:
  // ALUMNO, GUARDIA → denied (read-only)
  // SUBOFICIAL, OFICIAL, ADMIN → allowed any report
  // UCO → allowed only on UCO reports
  // FYF → allowed only on FYF reports
  if (rol === ROLES.ALUMNO || rol === ROLES.GUARDIA) return res.status(403).json({ error: 'Acceso denegado' });
  if (rol === ROLES.UCO && (inf.tipo_uco === '' || inf.tipo_uco === null)) return res.status(403).json({ error: 'No tienes permiso para editar este informe' });
  if (rol === ROLES.FYF && (inf.tipo_fyf === '' || inf.tipo_fyf === null)) return res.status(403).json({ error: 'No tienes permiso para editar este informe' });

  const { titulo, contenido, estado, prioritaria, archivada, ciudadano_id, archivos, placas_participantes } = req.body;
  // Prevent content edits on finalized reports
  if ((inf.estado === 'aprobado' || inf.estado === 'archivado') && (titulo !== undefined || contenido !== undefined || archivos !== undefined || placas_participantes !== undefined || ciudadano_id !== undefined)) {
    if (estado && estado !== inf.estado) {
      // Only allow state transitions, not content changes
    } else {
      return res.status(400).json({ error: 'No se puede modificar el contenido de un informe ' + inf.estado });
    }
  }
  let nuevoEstado = inf.estado;
  const huboCambioEstado = estado && estado !== inf.estado;
  if (huboCambioEstado) {
    if (estado === 'aprobado' && !userRoles.some(r => [ROLES.SUBOFICIAL, ROLES.OFICIAL, ROLES.ADMIN].includes(r))) return res.status(403).json({ error: 'No tienes permiso para aprobar informes' });
    if (estado === 'archivado' && !userRoles.some(r => [ROLES.OFICIAL, ROLES.ADMIN].includes(r))) return res.status(403).json({ error: 'No tienes permiso para archivar informes' });
    nuevoEstado = estado;
  }
  const ahora = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const archivosJson = archivos !== undefined ? JSON.stringify(archivos) : inf.archivos;
  db.begin();
  try {
    db.run('UPDATE informes SET titulo=?,contenido=?,placas_participantes=?,estado=?,prioritaria=?,archivada=?,ciudadano_id=?,archivos=?,fecha_modificacion=? WHERE id=?',
      [titulo || inf.titulo, contenido !== undefined ? contenido : inf.contenido,
       placas_participantes !== undefined ? placas_participantes : inf.placas_participantes,
       nuevoEstado,
       prioritaria !== undefined ? (prioritaria ? 1 : 0) : inf.prioritaria,
       archivada !== undefined ? (archivada ? 1 : 0) : inf.archivada,
       ciudadano_id !== undefined ? ciudadano_id : inf.ciudadano_id, archivosJson, ahora, +req.params.id]);
    if (huboCambioEstado) {
      db.run('INSERT INTO historial_estados (informe_id, estado_anterior, estado_nuevo, cambiado_por_id, cambiado_por_usuario, fecha) VALUES (?,?,?,?,?,?)',
        [inf.id, inf.estado, nuevoEstado, uid, req.session.user.usuario, ahora]);
      if (nuevoEstado === 'aprobado') {
        logAudit(req, 'APROBAR_INFORME', `Nº: ${inf.numero_informe}`);
      } else if (nuevoEstado === 'archivado') {
        logAudit(req, 'ARCHIVAR_INFORME', `Nº: ${inf.numero_informe}`);
      } else {
        logAudit(req, 'CAMBIAR_ESTADO', `Nº: ${inf.numero_informe}: ${inf.estado} → ${nuevoEstado}`);
      }
    } else {
      logAudit(req, 'EDITAR_INFORME', `Nº: ${inf.numero_informe}, Estado: ${nuevoEstado}`);
    }
    db.commit();
    res.json({ updated: true, estado: nuevoEstado });
  } catch (e) {
    db.rollback();
    res.status(500).json({ error: 'Error al actualizar informe' });
  }
});

app.delete('/api/informes/:id', requireAuth, (req, res) => {
  const inf = db.one('SELECT * FROM informes WHERE id=?', [+req.params.id]);
  if (!inf) return res.status(404).json({ error: 'No encontrado' });
  const rol = req.session.user.rol;
  if (rol !== ROLES.ADMIN && rol !== ROLES.OFICIAL && rol !== ROLES.SUBOFICIAL) return res.status(403).json({ error: 'Acceso denegado' });
  db.begin();
  try {
    db.run('DELETE FROM informes WHERE id=?', [+req.params.id]);
    logAudit(req, 'ELIMINAR_INFORME', `Nº: ${inf.numero_informe}`);
    db.commit();
    res.json({ deleted: true });
  } catch (e) {
    db.rollback();
    res.status(500).json({ error: 'Error al eliminar informe' });
  }
});

// ====== HISTORIAL ESTADOS ======

app.get('/api/informes/:id/historial-estados', requireAuth, (req, res) => {
  const inf = db.one('SELECT id FROM informes WHERE id=?', [+req.params.id]);
  if (!inf) return res.status(404).json({ error: 'Informe no encontrado' });
  const rows = db.all('SELECT * FROM historial_estados WHERE informe_id=? ORDER BY fecha DESC', [+req.params.id]);
  res.json(rows);
});

// ====== AUDITORIA ======

app.get('/api/auditoria', requireAuth, (req, res) => {
  const rol = req.session.user.rol;
  if (rol !== ROLES.OFICIAL && rol !== ROLES.UCO && rol !== ROLES.FYF && rol !== ROLES.ADMIN) return res.status(403).json({ error: 'Acceso denegado' });
  const { q } = req.query;
  let rows;
  if (q) {
    rows = db.all('SELECT * FROM auditoria WHERE usuario LIKE ? OR accion LIKE ? OR detalle LIKE ? ORDER BY fecha DESC LIMIT 200',
      [`%${q}%`, `%${q}%`, `%${q}%`]);
  } else {
    rows = db.all('SELECT * FROM auditoria ORDER BY fecha DESC LIMIT 200');
  }
  res.json(rows);
});

// ====== ADMIN ======

app.get('/api/admin/usuarios', requireRole(ROLES.ADMIN), (req, res) => {
  res.json(db.all('SELECT id, usuario, rol, roles, nombre_completo, numero_profesional, identificador_interno, escala, bloqueado, verificado FROM usuarios ORDER BY id'));
});

app.post('/api/admin/usuarios', requireRole(ROLES.ADMIN), async (req, res) => {
  const { usuario, password, rol, roles, nombre_completo, numero_profesional, identificador_interno, escala } = req.body;
  if (!usuario || !password || !rol) return res.status(400).json({ error: 'Campos obligatorios' });
  const hash = await bcrypt.hash(password, 10);
  const rolesStr = roles && Array.isArray(roles) ? roles.join(',') : rol;
  try {
    db.run('INSERT INTO usuarios (usuario,password,rol,roles,nombre_completo,numero_profesional,identificador_interno,escala,verificado) VALUES (?,?,?,?,?,?,?,?,1)',
      [usuario.toLowerCase(), hash, rol, rolesStr, nombre_completo || '', numero_profesional || '', identificador_interno || '', escala || rol]);
    const newUserId = db.lastId();
    logAudit(req, 'CREAR_USUARIO', `Usuario: ${usuario}, Rol: ${rol}, Roles: ${rolesStr}`);
    res.status(201).json({ id: newUserId });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'El usuario ya existe' });
    res.status(500).json({ error: 'Error interno' });
  }
});

app.put('/api/admin/usuarios/:id', requireRole(ROLES.ADMIN), (req, res) => {
  const { rol, roles, nombre_completo, numero_profesional, identificador_interno, escala } = req.body;
  const rolesStr = roles && Array.isArray(roles) && roles.length
    ? roles.join(',')
    : (rol || '');
  const primaryRol = (roles && Array.isArray(roles) && roles.length) ? roles[0] : (rol || '');
  db.run('UPDATE usuarios SET rol=?,roles=?,nombre_completo=?,numero_profesional=?,identificador_interno=?,escala=? WHERE id=?',
    [primaryRol, rolesStr, nombre_completo || '', numero_profesional || '', identificador_interno || '', escala || '', +req.params.id]);
  logAudit(req, 'EDITAR_USUARIO', `ID: ${req.params.id} Roles: ${rolesStr}`);
  res.json({ updated: true });
});

app.delete('/api/admin/usuarios/:id', requireRole(ROLES.ADMIN), (req, res) => {
  if (+req.params.id === req.session.user.id) return res.status(400).json({ error: 'No puedes eliminarte' });
  const r = db.run('DELETE FROM usuarios WHERE id=?', [+req.params.id]);
  if (r.changes === 0) return res.status(404).json({ error: 'No encontrado' });
  logAudit(req, 'ELIMINAR_USUARIO', `ID: ${req.params.id}`);
  res.json({ deleted: true });
});

app.put('/api/admin/usuarios/:id/password', requireRole(ROLES.ADMIN), async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Contraseña requerida' });
  const hash = await bcrypt.hash(password, 10);
  db.run('UPDATE usuarios SET password=? WHERE id=?', [hash, +req.params.id]);
  res.json({ updated: true });
});

app.put('/api/admin/usuarios/:id/desbloquear', requireRole(ROLES.ADMIN), (req, res) => {
  db.run('UPDATE usuarios SET bloqueado=0, bloqueado_hasta=NULL, intentos_fallidos=0 WHERE id=?', [+req.params.id]);
  res.json({ updated: true });
});

// ====== VERIFICACIONES ======

app.get('/api/admin/pendientes', requireRole(ROLES.ADMIN), (req, res) => {
  const rows = db.all("SELECT id, usuario, nombre_completo, fecha_creacion FROM usuarios WHERE verificado=0 ORDER BY id");
  res.json(rows);
});

app.post('/api/admin/aprobar/:id', requireRole(ROLES.ADMIN), (req, res) => {
  const u = db.one('SELECT id, usuario FROM usuarios WHERE id=? AND verificado=0', [+req.params.id]);
  if (!u) return res.status(404).json({ error: 'Cuenta pendiente no encontrada.' });
  const { roles } = req.body;
  const rolesValidos = ['alumno', 'guardia', 'suboficial', 'oficial', 'uco', 'fyf', 'admin'];
  if (!roles || !Array.isArray(roles) || !roles.length) {
    return res.status(400).json({ error: 'Debe seleccionar al menos un rol.' });
  }
  const rolesOk = roles.filter(r => rolesValidos.includes(r));
  if (!rolesOk.length) return res.status(400).json({ error: 'Roles no válidos.' });
  const rol = rolesOk[0];
  const rolesStr = rolesOk.join(',');
  db.run('UPDATE usuarios SET verificado=1, rol=?, roles=? WHERE id=?', [rol, rolesStr, u.id]);
  logAudit(req, 'APROBAR_CUENTA', `Usuario: ${u.usuario} (ID: ${u.id}) Roles: ${rolesStr}`);
  res.json({ ok: true, mensaje: `Cuenta de ${u.usuario} aprobada con rol(es): ${rolesStr}.` });
});

app.post('/api/admin/rechazar/:id', requireRole(ROLES.ADMIN), (req, res) => {
  const u = db.one('SELECT id, usuario FROM usuarios WHERE id=? AND verificado=0', [+req.params.id]);
  if (!u) return res.status(404).json({ error: 'Cuenta pendiente no encontrada.' });
  db.run('DELETE FROM usuarios WHERE id=?', [u.id]);
  logAudit(req, 'RECHAZAR_CUENTA', `Usuario: ${u.usuario} (ID: ${u.id}) - Cuenta eliminada`);
  res.json({ ok: true, mensaje: `Cuenta de ${u.usuario} rechazada y eliminada.` });
});

app.put('/api/admin/usuarios/:id/asignar-rol', requireRole(ROLES.ADMIN), (req, res) => {
  const { rol, roles } = req.body;
  const rolesValidos = ['alumno', 'guardia', 'suboficial', 'oficial', 'uco', 'fyf', 'admin'];
  let rolesOk;
  if (roles && Array.isArray(roles) && roles.length) {
    rolesOk = roles.filter(r => rolesValidos.includes(r));
    if (!rolesOk.length) return res.status(400).json({ error: 'Roles no válidos.' });
  } else if (rol) {
    if (!rolesValidos.includes(rol)) return res.status(400).json({ error: 'Rol no válido.' });
    rolesOk = [rol];
  } else {
    return res.status(400).json({ error: 'Debe seleccionar al menos un rol.' });
  }
  const u = db.one('SELECT id, usuario, verificado FROM usuarios WHERE id=?', [+req.params.id]);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (!u.verificado) return res.status(400).json({ error: 'La cuenta debe estar verificada antes de asignar un rol.' });
  const rolesStr = rolesOk.join(',');
  db.run('UPDATE usuarios SET rol=?, roles=?, escala=? WHERE id=?', [rolesOk[0], rolesStr, rolesOk[0], u.id]);
  logAudit(req, 'ASIGNAR_ROL', `Usuario: ${u.usuario} -> Roles: ${rolesStr}`);
  res.json({ ok: true, mensaje: `Roles ${rolesStr} asignados a ${u.usuario}.` });
});

// ====== UCO ======

app.get('/api/uco/informes', requireAuth, requireRole(ROLES.UCO, ROLES.ADMIN), (req, res) => {
  const { q } = req.query;
  let rows;
  if (q) {
    rows = db.all("SELECT i.*, u.usuario as autor_usuario, u.nombre_completo as autor_nombre FROM informes i LEFT JOIN usuarios u ON i.autor_id=u.id WHERE i.tipo_uco != '' AND (i.titulo LIKE ? OR i.numero_informe LIKE ? OR i.contenido LIKE ?) ORDER BY i.fecha_creacion DESC",
      [`%${q}%`, `%${q}%`, `%${q}%`]);
  } else {
    rows = db.all("SELECT i.*, u.usuario as autor_usuario, u.nombre_completo as autor_nombre FROM informes i LEFT JOIN usuarios u ON i.autor_id=u.id WHERE i.tipo_uco != '' ORDER BY i.fecha_creacion DESC");
  }
  res.json(rows);
});

app.post('/api/uco/informes', requireAuth, requireRole(ROLES.UCO, ROLES.ADMIN), (req, res) => {
  const { titulo, contenido, ciudadano_id, archivos, placas_participantes, tipo_uco } = req.body;
  if (!titulo) return res.status(400).json({ error: 'El título es obligatorio' });
  if (!tipo_uco) return res.status(400).json({ error: 'El tipo UCO es obligatorio' });
  const num = 'UCO-' + Date.now().toString(36).toUpperCase() + '-' + String(Math.floor(Math.random() * 999)).padStart(3, '0');
  const ahora = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const archivosJson = archivos && archivos.length ? JSON.stringify(archivos) : '';
  db.begin();
  try {
    db.run('INSERT INTO informes (numero_informe,autor_id,ciudadano_id,titulo,contenido,placas_participantes,fecha_creacion,archivos,tipo_uco) VALUES (?,?,?,?,?,?,?,?,?)',
      [num, req.session.user.id, ciudadano_id || null, titulo, contenido || '', placas_participantes || '', ahora, archivosJson, tipo_uco]);
    const newInfId = db.lastId();
    logAudit(req, 'CREAR_INFORME_UCO', `Nº: ${num}, Tipo: ${tipo_uco}, Título: ${titulo}`);
    db.commit();
    res.status(201).json({ id: newInfId, numero_informe: num });
  } catch (e) {
    db.rollback();
    res.status(500).json({ error: 'Error al crear informe UCO' });
  }
});

app.post('/api/informes/:id/derivar', requireAuth, requireRole(ROLES.UCO, ROLES.ADMIN), (req, res) => {
  const inf = db.one('SELECT * FROM informes WHERE id=?', [+req.params.id]);
  if (!inf) return res.status(404).json({ error: 'Informe no encontrado' });
  if (inf.tipo_uco && inf.tipo_uco !== '') {
    return res.status(400).json({ error: 'Los informes UCO no pueden ser derivados.' });
  }
  if (inf.tipo_fyf && inf.tipo_fyf !== '') {
    return res.status(400).json({ error: 'Los informes FyF no pueden ser derivados.' });
  }
  const existente = db.one('SELECT id, numero_informe FROM informes WHERE informe_origen_id=?', [+req.params.id]);
  if (existente) {
    return res.status(409).json({ error: 'Este informe ya ha sido derivado anteriormente (Nº ' + existente.numero_informe + '). No se puede repetir la acción.' });
  }
  const num = 'DER-' + Date.now().toString(36).toUpperCase() + '-' + String(Math.floor(Math.random() * 999)).padStart(3, '0');
  const ahora = new Date().toISOString().replace('T', ' ').slice(0, 19);
  db.begin();
  try {
    db.run('INSERT INTO informes (numero_informe,autor_id,ciudadano_id,titulo,contenido,placas_participantes,fecha_creacion,fecha_modificacion,estado,prioritaria,archivada,archivos,informe_origen_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [num, req.session.user.id, inf.ciudadano_id, inf.titulo + ' (Derivado)', inf.contenido, inf.placas_participantes, ahora, null, 'pendiente', inf.prioritaria, 0, inf.archivos, inf.id]);
    const newDerId = db.lastId();
    logAudit(req, 'DERIVAR_INFORME', `Origen: ${inf.numero_informe}, Derivado: ${num}`);
    db.commit();
    res.status(201).json({ id: newDerId, numero_informe: num });
  } catch (e) {
    db.rollback();
    res.status(500).json({ error: 'Error al derivar informe' });
  }
});

app.get('/api/uco/derivados', requireAuth, requireRole(ROLES.UCO, ROLES.ADMIN), (req, res) => {
  const rows = db.all('SELECT d.*, o.numero_informe as num_informe_origen, o.titulo as titulo_origen FROM informes d LEFT JOIN informes o ON d.informe_origen_id=o.id WHERE d.informe_origen_id IS NOT NULL ORDER BY d.fecha_creacion DESC');
  res.json(rows);
});

// ====== FyF ======

app.get('/api/fyf/informes', requireAuth, requireRole(ROLES.FYF, ROLES.ADMIN), (req, res) => {
  const { q } = req.query;
  let rows;
  if (q) {
    rows = db.all("SELECT i.*, u.usuario as autor_usuario, u.nombre_completo as autor_nombre FROM informes i LEFT JOIN usuarios u ON i.autor_id=u.id WHERE i.tipo_fyf != '' AND (i.titulo LIKE ? OR i.numero_informe LIKE ? OR i.contenido LIKE ?) ORDER BY i.fecha_creacion DESC",
      [`%${q}%`, `%${q}%`, `%${q}%`]);
  } else {
    rows = db.all("SELECT i.*, u.usuario as autor_usuario, u.nombre_completo as autor_nombre FROM informes i LEFT JOIN usuarios u ON i.autor_id=u.id WHERE i.tipo_fyf != '' ORDER BY i.fecha_creacion DESC");
  }
  res.json(rows);
});

app.post('/api/fyf/informes', requireAuth, requireRole(ROLES.FYF, ROLES.ADMIN), (req, res) => {
  const { titulo, contenido, ciudadano_id, archivos, placas_participantes, tipo_fyf } = req.body;
  if (!titulo) return res.status(400).json({ error: 'El título es obligatorio' });
  if (!tipo_fyf) return res.status(400).json({ error: 'El tipo FyF es obligatorio' });
  const num = 'FYF-' + Date.now().toString(36).toUpperCase() + '-' + String(Math.floor(Math.random() * 999)).padStart(3, '0');
  const ahora = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const archivosJson = archivos && archivos.length ? JSON.stringify(archivos) : '';
  db.begin();
  try {
    db.run('INSERT INTO informes (numero_informe,autor_id,ciudadano_id,titulo,contenido,placas_participantes,fecha_creacion,archivos,tipo_fyf) VALUES (?,?,?,?,?,?,?,?,?)',
      [num, req.session.user.id, ciudadano_id || null, titulo, contenido || '', placas_participantes || '', ahora, archivosJson, tipo_fyf]);
    const newInfId = db.lastId();
    logAudit(req, 'CREAR_INFORME_FYF', `Nº: ${num}, Tipo: ${tipo_fyf}, Título: ${titulo}`);
    db.commit();
    res.status(201).json({ id: newInfId, numero_informe: num });
  } catch (e) {
    db.rollback();
    res.status(500).json({ error: 'Error al crear informe FyF' });
  }
});

app.get('/api/buscar', requireAuth, (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json({ ciudadanos: [], informes: [], placas: [], usuarios: [] });
  const userRoles = (req.session.user.roles || req.session.user.rol || '').split(',').map(r => r.trim()).filter(Boolean);
  const term = `%${q}%`;
  const ciudadanos = db.all(`SELECT id, dni, nombre, apellidos FROM ciudadanos WHERE dni LIKE ? OR nombre LIKE ? OR apellidos LIKE ? OR observaciones LIKE ? LIMIT 5`, [term, term, term, term]);
  let filtroUnidad = '';
  if (!userRoles.includes(ROLES.UCO) && !userRoles.includes(ROLES.FYF) && !userRoles.includes(ROLES.ADMIN)) {
    filtroUnidad = " AND (tipo_uco = '' OR tipo_uco IS NULL) AND (tipo_fyf = '' OR tipo_fyf IS NULL)";
  } else if (!userRoles.includes(ROLES.UCO) && !userRoles.includes(ROLES.ADMIN)) {
    filtroUnidad = " AND (tipo_uco = '' OR tipo_uco IS NULL)";
  } else if (!userRoles.includes(ROLES.FYF) && !userRoles.includes(ROLES.ADMIN)) {
    filtroUnidad = " AND (tipo_fyf = '' OR tipo_fyf IS NULL)";
  }
  const informes = db.all(`SELECT id, numero_informe, titulo, estado, tipo_uco, tipo_fyf FROM informes WHERE (titulo LIKE ? OR numero_informe LIKE ? OR contenido LIKE ?)` + filtroUnidad + ` ORDER BY CASE WHEN titulo LIKE ? THEN 0 WHEN numero_informe LIKE ? THEN 1 ELSE 2 END LIMIT 8`, [term, term, term, q, q]);
  const placas = db.all(`SELECT id, numero_informe, titulo, placas_participantes, estado, tipo_uco, tipo_fyf FROM informes WHERE placas_participantes LIKE ? AND placas_participantes != ''` + filtroUnidad + ` LIMIT 5`, [term]);
  // User search for roles with management access
  let usuarios = [];
  if (userRoles.some(r => [ROLES.ADMIN, ROLES.OFICIAL, ROLES.SUBOFICIAL, ROLES.UCO, ROLES.FYF].includes(r))) {
    usuarios = db.all(`SELECT id, usuario, rol, nombre_completo, numero_profesional FROM usuarios WHERE usuario LIKE ? OR nombre_completo LIKE ? OR numero_profesional LIKE ? LIMIT 5`, [term, term, term]);
  }
  res.json({ ciudadanos, informes, placas, usuarios });
});

app.get('/', (req, res) => res.redirect('/informes'));

app.get('/informes*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

db.init().then(async () => {
  await seedUsers();

  db.run("DELETE FROM auditoria WHERE accion IN ('INICIO_SESION','CIERRE_SESION')");

  const PORT = process.env.PORT || 3000;

  app.listen(PORT, () => {
    console.log(`Sistema Informes - Guardia Civil corriendo en puerto ${PORT}`);
  });
});
  });
}).catch(err => {
  console.error('Error:', err);
});
