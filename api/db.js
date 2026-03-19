import { neon } from '@neondatabase/serverless';

function getSQL() {
  if (!process.env.POSTGRES_URL) throw new Error('POSTGRES_URL غير موجود');
  return neon(process.env.POSTGRES_URL);
}

// ──────────────────────────────────────────────────────────
//  SETUP / MIGRATION
// ──────────────────────────────────────────────────────────
export async function setupTables() {
  const sql = getSQL();

  // 1. users
  await sql`CREATE TABLE IF NOT EXISTS users (
    id                   SERIAL PRIMARY KEY,
    name                 TEXT NOT NULL,
    email                TEXT UNIQUE NOT NULL,
    password_hash        TEXT NOT NULL,
    phone                TEXT,
    reset_token          TEXT,
    reset_token_expires  TIMESTAMP WITH TIME ZONE,
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`;

  // 2. orders
  await sql`CREATE TABLE IF NOT EXISTS orders (
    id               SERIAL PRIMARY KEY,
    user_id          INTEGER REFERENCES users(id),
    amount           INTEGER NOT NULL,
    currency         TEXT DEFAULT 'SAR',
    status           TEXT DEFAULT 'pending',
    plan             TEXT DEFAULT 'basic',
    paymob_order_id  TEXT UNIQUE,
    payment_id       TEXT,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`;

  // 3. feasibility_studies
  await sql`CREATE TABLE IF NOT EXISTS feasibility_studies (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER REFERENCES users(id),
    order_id      INTEGER REFERENCES orders(id),
    project_name  TEXT NOT NULL,
    input_data    JSONB,
    ai_output     TEXT,
    metadata      JSONB,
    word_file_url TEXT,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`;

  // 4. invoices
  await sql`CREATE TABLE IF NOT EXISTS invoices (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id),
    order_id        INTEGER REFERENCES orders(id),
    invoice_number  TEXT UNIQUE,
    amount          INTEGER NOT NULL,
    currency        TEXT DEFAULT 'SAR',
    status          TEXT DEFAULT 'paid',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`;

  // 5. user_points
  await sql`CREATE TABLE IF NOT EXISTS user_points (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER REFERENCES users(id),
    order_id      INTEGER UNIQUE REFERENCES orders(id),
    total_points  INTEGER DEFAULT 5,
    used_points   INTEGER DEFAULT 0,
    expires_at    TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '6 months'),
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`;

  // 6. bonus_tracker — تتبع الأجهزة/IPs التي حصلت على النقطة المجانية
  await sql`CREATE TABLE IF NOT EXISTS bonus_tracker (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES users(id),
    ip_address  TEXT,
    fingerprint TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_bonus_ip ON bonus_tracker(ip_address)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_bonus_fp ON bonus_tracker(fingerprint)`;

  return { success: true, message: 'تم إنشاء جميع الجداول بنجاح' };
}

// migration آمن للجداول الموجودة → يضيف الأعمدة الناقصة بدون حذف بيانات
export async function migrateUsersTable() {
  const sql = getSQL();
  // users
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS name                 TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone                TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash        TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token          TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires  TIMESTAMP WITH TIME ZONE`;
  try { await sql`ALTER TABLE users ALTER COLUMN password DROP NOT NULL`; } catch (_) {}

  // orders
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS plan        TEXT DEFAULT 'basic'`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_id  TEXT`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`;

  // إنشاء feasibility_studies إن لم تكن موجودة (احتياط)
  await sql`CREATE TABLE IF NOT EXISTS feasibility_studies (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER REFERENCES users(id),
    order_id      INTEGER REFERENCES orders(id),
    project_name  TEXT NOT NULL,
    input_data    JSONB,
    ai_output     TEXT,
    metadata      JSONB,
    word_file_url TEXT,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`;

  // نقل البيانات من studies → feasibility_studies إن وجدت
  try {
    await sql`
      INSERT INTO feasibility_studies (user_id, order_id, project_name, ai_output, metadata, created_at)
      SELECT user_id, order_id, title, content, metadata, created_at
      FROM studies
      WHERE NOT EXISTS (
        SELECT 1 FROM feasibility_studies f WHERE f.user_id = studies.user_id AND f.project_name = studies.title
      )
    `;
  } catch (_) { /* جدول studies قد لا يوجد */ }

  // إضافة unique constraint على user_points.order_id إن لم يكن موجوداً
  try {
    await sql`ALTER TABLE user_points ADD CONSTRAINT user_points_order_id_unique UNIQUE (order_id)`;
  } catch (_) { /* قد يكون موجوداً بالفعل */ }

  // إنشاء جدول bonus_tracker إن لم يكن موجوداً
  await sql`CREATE TABLE IF NOT EXISTS bonus_tracker (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES users(id),
    ip_address  TEXT,
    fingerprint TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`;
  try { await sql`CREATE INDEX IF NOT EXISTS idx_bonus_ip ON bonus_tracker(ip_address)`; } catch(_) {}
  try { await sql`CREATE INDEX IF NOT EXISTS idx_bonus_fp ON bonus_tracker(fingerprint)`; } catch(_) {}

  return { success: true, message: 'تم تحديث قاعدة البيانات بنجاح' };
}

// ──────────────────────────────────────────────────────────
//  USER AUTH HELPERS
// ──────────────────────────────────────────────────────────
export async function createUserWithPassword({ email, name, phone, passwordHash }) {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO users (email, name, phone, password_hash)
    VALUES (${email}, ${name}, ${phone || null}, ${passwordHash})
    RETURNING id, email, name, phone, created_at
  `;
  return rows[0];
}

export async function getUserByEmail(email) {
  const sql = getSQL();
  const rows = await sql`
    SELECT id, email, name, phone, password_hash, created_at
    FROM users WHERE email = ${email} LIMIT 1
  `;
  return rows[0] || null;
}

export async function setResetToken(email, token, expiresAt) {
  const sql = getSQL();
  await sql`
    UPDATE users SET reset_token = ${token}, reset_token_expires = ${expiresAt}
    WHERE email = ${email}
  `;
}

export async function getUserByResetToken(token) {
  const sql = getSQL();
  const rows = await sql`
    SELECT id, email, name FROM users
    WHERE reset_token = ${token} AND reset_token_expires > NOW()
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function updatePassword(userId, newPasswordHash) {
  const sql = getSQL();
  await sql`
    UPDATE users
    SET password_hash = ${newPasswordHash}, reset_token = NULL, reset_token_expires = NULL
    WHERE id = ${userId}
  `;
}

// ──────────────────────────────────────────────────────────
//  ORDERS & POINTS
// ──────────────────────────────────────────────────────────
export async function upsertUser({ email, phone, name }) {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO users (email, phone, name)
    VALUES (${email}, ${phone}, ${name})
    ON CONFLICT (email) DO UPDATE
      SET phone = EXCLUDED.phone, name = EXCLUDED.name
    RETURNING *
  `;
  return rows[0];
}

export async function createOrder({ userId, paymobOrderId, amount, currency, plan }) {
  const sql = getSQL();
  const rows = await sql`
    INSERT INTO orders (user_id, paymob_order_id, amount, currency, plan)
    VALUES (${userId}, ${paymobOrderId}, ${amount}, ${currency}, ${plan})
    RETURNING *
  `;
  return rows[0];
}

export async function getUserPoints(userId) {
  const sql = getSQL();
  const rows = await sql`
    SELECT
      SUM(total_points) AS total,
      SUM(used_points)  AS used,
      SUM(total_points - used_points) AS remaining
    FROM user_points
    WHERE user_id = ${userId} AND expires_at > NOW()
  `;
  return rows[0] || { total: 0, used: 0, remaining: 0 };
}

export async function consumePoint(userId) {
  const sql = getSQL();
  const rows = await sql`
    UPDATE user_points SET used_points = used_points + 1
    WHERE id = (
      SELECT id FROM user_points
      WHERE user_id = ${userId}
        AND (total_points - used_points) > 0
        AND expires_at > NOW()
      ORDER BY created_at ASC LIMIT 1
    )
    RETURNING *
  `;
  return rows[0] || null;
}

// ──────────────────────────────────────────────────────────
//  REGISTRATION BONUS HELPERS
// ──────────────────────────────────────────────────────────

// التحقق: هل سبق لهذا الجهاز أو الـ IP الحصول على النقطة المجانية؟
export async function checkBonusAlreadyUsed(ip, fingerprint) {
  const sql = getSQL();
  const safeIp = (ip && ip !== 'unknown' && ip !== '::1' && ip !== '127.0.0.1') ? ip : null;
  const safeFp = fingerprint || null;
  if (!safeIp && !safeFp) return false;
  const rows = await sql`
    SELECT id FROM bonus_tracker
    WHERE
      (${safeIp} IS NOT NULL AND ip_address  = ${safeIp})
      OR
      (${safeFp} IS NOT NULL AND fingerprint = ${safeFp})
    LIMIT 1
  `;
  return rows.length > 0;
}

// تسجيل استخدام النقطة المجانية
export async function recordBonusUsed(userId, ip, fingerprint) {
  const sql = getSQL();
  const safeIp = (ip && ip !== 'unknown' && ip !== '::1' && ip !== '127.0.0.1') ? ip : null;
  const safeFp = fingerprint || null;
  await sql`
    INSERT INTO bonus_tracker (user_id, ip_address, fingerprint)
    VALUES (${userId}, ${safeIp}, ${safeFp})
  `;
}

// منح نقطة ترحيبية مجانية واحدة للمستخدم الجديد
export async function grantWelcomePoint(userId) {
  const sql = getSQL();
  await sql`
    INSERT INTO user_points (user_id, order_id, total_points, used_points, expires_at)
    VALUES (${userId}, NULL, 1, 0, NOW() + INTERVAL '6 months')
  `;
}
