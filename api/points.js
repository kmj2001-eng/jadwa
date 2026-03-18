import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-user-id');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = parseInt(req.headers['x-user-id']);
  if (!userId || isNaN(userId)) return res.status(401).json({ error: 'غير مصرح' });

  if (!process.env.POSTGRES_URL) return res.status(500).json({ error: 'POSTGRES_URL غير موجود' });
  const sql = neon(process.env.POSTGRES_URL);

  try {

    // ── GET: رصيد النقاط الحالي ──
    if (req.method === 'GET') {
      const rows = await sql`
        SELECT
          COALESCE(SUM(total_points), 0)::int          AS total,
          COALESCE(SUM(used_points),  0)::int          AS used,
          COALESCE(SUM(total_points - used_points), 0)::int AS remaining
        FROM user_points
        WHERE user_id = ${userId} AND expires_at > NOW()
      `;
      return res.status(200).json(rows[0] || { total: 0, used: 0, remaining: 0 });
    }

    // ── POST: استهلاك نقطة واحدة ──
    if (req.method === 'POST') {
      const { action } = req.body || {};
      if (action !== 'consume') return res.status(400).json({ error: 'action غير صالح' });

      // التحقق من وجود نقاط كافية أولاً
      const check = await sql`
        SELECT COALESCE(SUM(total_points - used_points), 0)::int AS remaining
        FROM user_points
        WHERE user_id = ${userId} AND expires_at > NOW()
      `;
      if (!check[0] || check[0].remaining < 1) {
        return res.status(402).json({ error: 'لا توجد نقاط كافية', remaining: 0 });
      }

      // استهلاك نقطة من أقدم باقة نشطة
      const updated = await sql`
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
        RETURNING total_points, used_points
      `;

      if (!updated[0]) return res.status(402).json({ error: 'لا توجد نقاط كافية' });

      const remaining = updated[0].total_points - updated[0].used_points;
      return res.status(200).json({ consumed: true, remaining });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (e) {
    console.error('points API error:', e);
    return res.status(500).json({ error: 'خطأ في الخادم: ' + e.message });
  }
}
