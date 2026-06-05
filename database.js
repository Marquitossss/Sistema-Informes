const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'sigc.db');
let db = null;
let _inTransaction = false;

async function init() {
  const SQL = await initSqlJs();
  try {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } catch {
    db = new SQL.Database();
  }
  db.run('PRAGMA foreign_keys = ON');

  db.run(`CREATE TABLE IF NOT EXISTS ciudadanos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dni TEXT UNIQUE NOT NULL,
    nombre TEXT NOT NULL,
    apellidos TEXT NOT NULL,
    foto TEXT DEFAULT ''
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    rol TEXT DEFAULT '',
    nombre_completo TEXT DEFAULT '',
    numero_profesional TEXT DEFAULT '',
    identificador_interno TEXT DEFAULT '',
    escala TEXT DEFAULT '',
    verificado INTEGER DEFAULT 0,
    fecha_creacion TEXT DEFAULT (datetime('now')),
    bloqueado INTEGER DEFAULT 0,
    bloqueado_hasta TEXT DEFAULT NULL,
    intentos_fallidos INTEGER DEFAULT 0,
    auth_2fa INTEGER DEFAULT 1
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS informes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero_informe TEXT UNIQUE NOT NULL,
    autor_id INTEGER NOT NULL,
    ciudadano_id INTEGER,
    titulo TEXT NOT NULL,
    contenido TEXT DEFAULT '',
    placas_participantes TEXT DEFAULT '',
    fecha_creacion TEXT NOT NULL,
    fecha_modificacion TEXT,
    estado TEXT DEFAULT 'borrador',
    prioritaria INTEGER DEFAULT 0,
    archivada INTEGER DEFAULT 0,
    tipo_uco TEXT DEFAULT '',
    informe_origen_id INTEGER DEFAULT NULL,
    FOREIGN KEY (autor_id) REFERENCES usuarios(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS auditoria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    usuario TEXT,
    rol TEXT,
    accion TEXT NOT NULL,
    detalle TEXT DEFAULT '',
    ip TEXT DEFAULT '',
    fecha TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS historial_estados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    informe_id INTEGER NOT NULL,
    estado_anterior TEXT NOT NULL,
    estado_nuevo TEXT NOT NULL,
    cambiado_por_id INTEGER NOT NULL,
    cambiado_por_usuario TEXT NOT NULL,
    fecha TEXT NOT NULL,
    FOREIGN KEY (informe_id) REFERENCES informes(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS intentos_login (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario TEXT NOT NULL,
    ip TEXT DEFAULT '',
    exitoso INTEGER DEFAULT 0,
    fecha TEXT NOT NULL
  )`);

  migrarColumnas();
  migrarUsuarios();
  crearIndices();
  save();
}

function migrarColumnas() {
  const infCols = all("PRAGMA table_info('informes')").map(r => r.name);
  if (!infCols.includes('ciudadano_id')) {
    try { run('ALTER TABLE informes ADD COLUMN ciudadano_id INTEGER'); } catch {}
  }
  if (!infCols.includes('archivos')) {
    try { run("ALTER TABLE informes ADD COLUMN archivos TEXT DEFAULT ''"); } catch {}
  }
  if (!infCols.includes('placas_participantes')) {
    try { run("ALTER TABLE informes ADD COLUMN placas_participantes TEXT DEFAULT ''"); } catch {}
  }
  if (!infCols.includes('tipo_uco')) {
    try { run("ALTER TABLE informes ADD COLUMN tipo_uco TEXT DEFAULT ''"); } catch {}
  }
  if (!infCols.includes('tipo_fyf')) {
    try { run("ALTER TABLE informes ADD COLUMN tipo_fyf TEXT DEFAULT ''"); } catch {}
  }
  if (!infCols.includes('informe_origen_id')) {
    try { run("ALTER TABLE informes ADD COLUMN informe_origen_id INTEGER DEFAULT NULL"); } catch {}
  }
  const ciuCols = all("PRAGMA table_info('ciudadanos')").map(r => r.name);
  if (!ciuCols.includes('foto')) {
    try { run("ALTER TABLE ciudadanos ADD COLUMN foto TEXT DEFAULT ''"); } catch {}
  }
  if (!ciuCols.includes('observaciones')) {
    try { run("ALTER TABLE ciudadanos ADD COLUMN observaciones TEXT DEFAULT ''"); } catch {}
  }
}

function migrarUsuarios() {
  const cols = all("PRAGMA table_info('usuarios')").map(r => r.name);
  const nuevas = ['numero_profesional', 'identificador_interno', 'escala', 'bloqueado', 'bloqueado_hasta', 'intentos_fallidos', 'auth_2fa', 'verificado'];
  for (const col of nuevas) {
    if (!cols.includes(col)) {
      if (col === 'verificado') {
        try { run("ALTER TABLE usuarios ADD COLUMN verificado INTEGER DEFAULT 0"); } catch {}
      } else if (col === 'fecha_creacion') {
        try { run("ALTER TABLE usuarios ADD COLUMN fecha_creacion TEXT DEFAULT (datetime('now'))"); } catch {}
      } else {
        try { run(`ALTER TABLE usuarios ADD COLUMN ${col} ${col.includes('hasta') ? 'TEXT' : col.includes('intentos') ? 'INTEGER' : col.includes('auth') ? 'INTEGER' : col.includes('bloqueado') ? 'INTEGER' : 'TEXT'} DEFAULT ${col.includes('bloqueado') || col.includes('intentos') || col.includes('auth') || col.includes('2fa') ? '0' : "''"}`); } catch {}
      }
    }
  }
  if (!cols.includes('roles')) {
    try { run("ALTER TABLE usuarios ADD COLUMN roles TEXT DEFAULT ''"); } catch {}
  }
  const rows = all("SELECT id, rol, roles FROM usuarios WHERE roles IS NULL OR roles = ''");
  for (const r of rows) {
    run("UPDATE usuarios SET roles=? WHERE id=?", [r.rol || '', r.id]);
  }
}

function crearIndices() {
  try { run("CREATE INDEX IF NOT EXISTS idx_informes_autor_id ON informes(autor_id)"); } catch {}
  try { run("CREATE INDEX IF NOT EXISTS idx_informes_estado ON informes(estado)"); } catch {}
  try { run("CREATE INDEX IF NOT EXISTS idx_informes_ciudadano_id ON informes(ciudadano_id)"); } catch {}
  try { run("CREATE INDEX IF NOT EXISTS idx_informes_fecha_creacion ON informes(fecha_creacion)"); } catch {}
  try { run("CREATE INDEX IF NOT EXISTS idx_informes_tipo_uco ON informes(tipo_uco)"); } catch {}
  try { run("CREATE INDEX IF NOT EXISTS idx_informes_tipo_fyf ON informes(tipo_fyf)"); } catch {}
  try { run("CREATE INDEX IF NOT EXISTS idx_informes_informe_origen_id ON informes(informe_origen_id)"); } catch {}
  try { run("CREATE INDEX IF NOT EXISTS idx_auditoria_fecha ON auditoria(fecha)"); } catch {}
  try { run("CREATE INDEX IF NOT EXISTS idx_auditoria_rol_accion ON auditoria(rol, accion)"); } catch {}
  try { run("CREATE INDEX IF NOT EXISTS idx_intentos_login_usuario_fecha ON intentos_login(usuario, fecha)"); } catch {}
  try { run("CREATE INDEX IF NOT EXISTS idx_ciudadanos_nombre_apellidos ON ciudadanos(nombre, apellidos)"); } catch {}
  try { run("CREATE INDEX IF NOT EXISTS idx_usuarios_verificado ON usuarios(verificado)"); } catch {}
  try { run("CREATE INDEX IF NOT EXISTS idx_historial_estados_informe_id ON historial_estados(informe_id)"); } catch {}
}

function save() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function one(sql, params = []) {
  const rows = all(sql, params);
  return rows.length ? rows[0] : null;
}

let _lastInsertId = 0;

function run(sql, params = []) {
  db.run(sql, params);
  const changes = db.getRowsModified();
  _lastInsertId = db.exec("SELECT last_insert_rowid() AS id")[0].values[0][0];
  if (!_inTransaction) save();
  return { changes };
}

function begin() {
  _inTransaction = true;
  db.run("BEGIN TRANSACTION");
}

function commit() {
  db.run("COMMIT");
  _inTransaction = false;
  save();
}

function rollback() {
  db.run("ROLLBACK");
  _inTransaction = false;
  save();
}

function lastId() {
  return _lastInsertId;
}

module.exports = { init, all, one, run, lastId, begin, commit, rollback };