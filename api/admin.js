import { neon } from '@neondatabase/serverless';

const ADMIN_EMAIL = 'kmj2001@gmail.com';

function isAdmin(req) {
  const email = (req.headers['x-admin-email'] || '').toLowerCase().trim();
  return email === ADMIN_EMAIL;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-email');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!isAdmin(req)) {
    return res.status(403).json({ error: 'غير مصرح' });
  }

  const sql = neon(process.env.POSTGRES_URL);
  const { action } = req.query;

  try {
    // ── إحصائيات عامة ──────────────────────────────────────────
    if (action === 'stats') {
      const [users, orders, studies, points, revenue] = await Promise.all([
        sql`SELECT COUNT(*) AS total FROM users`,
        sql`SELECT COUNT(*) AS total FROM orders WHERE status = 'paid'`,
        sql`SELECT COUNT(*) AS total FROM feasibility_studies`,
        sql`SELECT COALESCE(SUM(total_points),0) AS total FROM user_points`,
        sql`SELECT COALESCE(SUM(amount),0) AS total FROM orders WHERE status = 'paid'`,
      ]);
      return res.json({
        users:   parseInt(users[0].total),
        orders:  parseInt(orders[0].total),
        studies: parseInt(studies[0].total),
        points:  parseInt(points[0].total),
        revenue: parseInt(revenue[0].total),
      });
    }

    // ── آخر 5 مستخدمين ─────────────────────────────────────────
    if (action === 'users') {
      const rows = await sql`
        SELECT u.id, u.name, u.email, u.created_at,
               COALESCE(SUM(up.total_points - up.used_points), 0) AS remaining_points,
               COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'paid') AS paid_orders
        FROM users u
        LEFT JOIN user_points up ON up.user_id = u.id AND up.expires_at > NOW()
        LEFT JOIN orders o ON o.user_id = u.id
        GROUP BY u.id, u.name, u.email, u.created_at
        ORDER BY u.created_at DESC
        LIMIT 5
      `;
      return res.json({ users: rows });
    }

    // ── آخر 5 طلبات ────────────────────────────────────────────
    if (action === 'orders') {
      const rows = await sql`
        SELECT o.id, o.amount, o.currency, o.status, o.created_at,
               u.name AS user_name, u.email AS user_email
        FROM orders o
        LEFT JOIN users u ON u.id = o.user_id
        ORDER BY o.created_at DESC
        LIMIT 5
      `;
      return res.json({ orders: rows });
    }

    // ── آخر 5 دراسات ───────────────────────────────────────────
    if (action === 'studies') {
      const rows = await sql`
        SELECT fs.id, fs.title, fs.status, fs.created_at,
               u.name AS user_name, u.email AS user_email
        FROM feasibility_studies fs
        LEFT JOIN users u ON u.id = fs.user_id
        ORDER BY fs.created_at DESC
        LIMIT 5
      `;
      return res.json({ studies: rows });
    }

    // ── آخر 5 نقاط ─────────────────────────────────────────────
    if (action === 'points') {
      const rows = await sql`
        SELECT up.id, up.total_points, up.used_points, up.expires_at, up.created_at,
               u.name AS user_name, u.email AS user_email
        FROM user_points up
        LEFT JOIN users u ON u.id = up.user_id
        ORDER BY up.created_at DESC
        LIMIT 5
      `;
      return res.json({ points: rows });
    }

    // ── بحث مستخدم ─────────────────────────────────────────────
    if (action === 'search' && req.method === 'GET') {
      const q = `%${req.query.q || ''}%`;
      const rows = await sql`
        SELECT u.id, u.name, u.email, u.created_at,
               COALESCE(SUM(up.total_points - up.used_points), 0) AS remaining_points
        FROM users u
        LEFT JOIN user_points up ON up.user_id = u.id AND up.expires_at > NOW()
        WHERE u.email ILIKE ${q} OR u.name ILIKE ${q}
        GROUP BY u.id, u.name, u.email, u.created_at
        ORDER BY u.created_at DESC
        LIMIT 10
      `;
      return res.json({ users: rows });
    }

    // ── منح نقاط ───────────────────────────────────────────────
    if (action === 'grant-points' && req.method === 'POST') {
      const { userId, points } = req.body || {};
      if (!userId || !points) return res.status(400).json({ error: 'بيانات ناقصة' });
      await sql`
        INSERT INTO user_points (user_id, order_id, total_points, used_points, expires_at)
        VALUES (${userId}, NULL, ${parseInt(points)}, 0, NOW() + INTERVAL '6 months')
      `;
      return res.json({ ok: true });
    }

    // ── إرسال إيميل ────────────────────────────────────────────
    if (action === 'send-email' && req.method === 'POST') {
      const { to, subject, message, sendAll } = req.body || {};
      if (!subject || !message) return res.status(400).json({ error: 'الموضوع والرسالة مطلوبان' });

      let recipients = [];
      if (sendAll) {
        const users = await sql`SELECT email, name FROM users WHERE email IS NOT NULL`;
        recipients = users;
      } else if (to) {
        recipients = [{ email: to, name: '' }];
      }

      if (!recipients.length) return res.status(400).json({ error: 'لا يوجد مستلمون' });

      const RESEND_KEY = process.env.RESEND_API_KEY;
      const SENDER    = process.env.SENDER_EMAIL || 'support@eses.store';
      let sent = 0;

      for (const user of recipients) {
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: `ذكاء الأعمال <${SENDER}>`,
              to:   [user.email],
              subject,
              html: `
                <div dir="rtl" style="font-family:Cairo,Arial,sans-serif;max-width:600px;margin:auto;background:#0f2a4a;color:#e2e8f0;border-radius:16px;padding:32px;">
                  <div style="text-align:center;margin-bottom:24px;">
                    <div style="font-size:1.5rem;font-weight:bold;color:#3B82F6;">ذكاء الأعمال</div>
                  </div>
                  ${user.name ? `<p>مرحباً ${user.name}،</p>` : ''}
                  <div style="line-height:1.8;white-space:pre-wrap;">${message}</div>
                  <div style="margin-top:24px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.1);font-size:0.8rem;color:#94a3b8;text-align:center;">
                    منصة ذكاء الأعمال · eses.store
                  </div>
                </div>
              `,
            }),
          });
          sent++;
        } catch(e) { console.error('email error:', e); }
      }

      return res.json({ ok: true, sent });
    }

    return res.status(400).json({ error: 'action غير معروف' });

  } catch(err) {
    console.error('Admin error:', err);
    return res.status(500).json({ error: err.message });
  }
}
