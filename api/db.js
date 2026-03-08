import { sql } from '@vercel/postgres';

export { sql };

export async function setupTables() {
  // جدول المستخدمين
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id          SERIAL PRIMARY KEY,
      email       VARCHAR(255) UNIQUE NOT NULL,
      phone       VARCHAR(50),
      name        VARCHAR(255),
      created_at  TIMESTAMP DEFAULT NOW()
    );
  `;

  // جدول الطلبات
  await sql`
    CREATE TABLE IF NOT EXISTS orders (
      id                SERIAL PRIMARY KEY,
      user_id           INTEGER REFERENCES users(id),
      paymob_order_id   VARCHAR(255) UNIQUE,
      amount            INTEGER NOT NULL,
      currency          VARCHAR(10) DEFAULT 'SAR',
      status            VARCHAR(50) DEFAULT 'pending',
      plan              VARCHAR(50) DEFAULT 'basic',
      created_at        TIMESTAMP DEFAULT NOW(),
      updated_at        TIMESTAMP DEFAULT NOW()
    );
  `;

  // جدول النقاط (نظام الاشتراك بالنقاط)
  await sql`
    CREATE TABLE IF NOT EXISTS user_points (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER REFERENCES users(id),
      order_id      INTEGER REFERENCES orders(id),
      total_points  INTEGER DEFAULT 5,
      used_points   INTEGER DEFAULT 0,
      expires_at    TIMESTAMP DEFAULT (NOW() + INTERVAL '6 months'),
      created_at    TIMESTAMP DEFAULT NOW()
    );
  `;

  // جدول الدراسات المحفوظة
  await sql`
    CREATE TABLE IF NOT EXISTS studies (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id),
      order_id    INTEGER REFERENCES orders(id),
      title       VARCHAR(500),
      content     TEXT,
      metadata    JSONB,
      created_at  TIMESTAMP DEFAULT NOW()
    );
  `;

  // جدول الفواتير
  await sql`
    CREATE TABLE IF NOT EXISTS invoices (
      id              SERIAL PRIMARY KEY,
      order_id        INTEGER REFERENCES orders(id),
      user_id         INTEGER REFERENCES users(id),
      amount          INTEGER NOT NULL,
      currency        VARCHAR(10) DEFAULT 'SAR',
      status          VARCHAR(50) DEFAULT 'pending',
      invoice_number  VARCHAR(100) UNIQUE,
      created_at      TIMESTAMP DEFAULT NOW()
    );
  `;

  return { success: true, message: 'All tables created successfully' };
}

// إنشاء مستخدم أو جلبه إذا كان موجوداً
export async function upsertUser({ email, phone, name }) {
  const { rows } = await sql`
    INSERT INTO users (email, phone, name)
    VALUES (${email}, ${phone}, ${name})
    ON CONFLICT (email) DO UPDATE
      SET phone = EXCLUDED.phone,
          name  = EXCLUDED.name
    RETURNING *
  `;
  return rows[0];
}

// إنشاء طلب
export async function createOrder({ userId, paymobOrderId, amount, currency, plan }) {
  const { rows } = await sql`
    INSERT INTO orders (user_id, paymob_order_id, amount, currency, plan)
    VALUES (${userId}, ${paymobOrderId}, ${amount}, ${currency}, ${plan})
    RETURNING *
  `;
  return rows[0];
}

// جلب نقاط المستخدم المتاحة
export async function getUserPoints(userId) {
  const { rows } = await sql`
    SELECT
      SUM(total_points) AS total,
      SUM(used_points)  AS used,
      SUM(total_points - used_points) AS remaining
    FROM user_points
    WHERE user_id = ${userId}
      AND expires_at > NOW()
  `;
  return rows[0] || { total: 0, used: 0, remaining: 0 };
}

// استهلاك نقطة واحدة
export async function consumePoint(userId) {
  const { rows } = await sql`
    UPDATE user_points
    SET used_points = used_points + 1
    WHERE id = (
      SELECT id FROM user_points
      WHERE user_id = ${userId}
        AND (total_points - used_points) > 0
        AND expires_at > NOW()
      ORDER BY created_at ASC
      LIMIT 1
    )
    RETURNING *
  `;
  return rows[0] || null;
}
