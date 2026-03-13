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
  await sql`CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    email       VARCHAR(255) UNIQUE NOT NULL,
    phone       VARCHAR(50),
    name        VARCHAR(255),
    created_at  TIMESTAMP DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS orders (
    id                SERIAL PRIMARY KEY,
    user_id           INTEGER REFERENCES users(id),
    paymob_order_id   VARCHAR(255) UNIQUE,
    amount            INTEGER NOT NULL,
    currency          VARCHAR(10) DEFAULT 'SAR',
    status            VARCHAR(50) DEFAULT 'pending',
    plan              VARCHAR(50) DEFAULT 'basic',
    created_at        TIMESTAMP DEFAULT NOW(),
    updated_at        TIMESTAMP DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS user_points (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER REFERENCES users(id),
    order_id      INTEGER REFERENCES orders(id),
    total_points  INTEGER DEFAULT 5,
    used_points   INTEGER DEFAULT 0,
    expires_at    TIMESTAMP DEFAULT (NOW() + INTERVAL '6 months'),
    created_at    TIMESTAMP DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS studies (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES users(id),
    order_id    INTEGER REFERENCES orders(id),
    title       VARCHAR(500),
    content     TEXT,
    metadata    JSONB,
    created_at  TIMESTAMP DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS invoices (
    id              SERIAL PRIMARY KEY,
    order_id        INTEGER REFERENCES orders(id),
    user_id         INTEGER REFERENCES users(id),
    amount          INTEGER NOT NULL,
    currency        VARCHAR(10) DEFAULT 'SAR',
    status          VARCHAR(50) DEFAULT 'pending',
    invoice_number  VARCHAR(100) UNIQUE,
    created_at      TIMESTAMP DEFAULT NOW()
  )`;
  return { success: true, message: 'تم إنشاء جميع الجداول بنجاح' };
}

// إضافة أعمدة Auth لجدول users (migration آمن)
export async function migrateUsersTable() {
  const sql = getSQL();
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS name          VARCHAR(255)`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone         VARCHAR(50)`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token   VARCHAR(255)`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP`;
  return { success: true, message: 'تم تحديث جدول users بنجاح' };
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
