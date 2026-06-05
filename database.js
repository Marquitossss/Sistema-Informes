const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.postgresql://sigc_db_user:BleKrtuBGlb4N1cpVBkou5pTu9rgh60M@dpg-d8hjp1sm0tmc73ftdfq0-a.frankfurt-postgres.render.com/sigc_db,
  ssl: {
    rejectUnauthorized: false
  }
});

module.exports = pool;
