import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-user-id');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = parseInt(req.headers['x-user-id']);
  if (!userId || isNaN(userId)) return res.status(401).json({ error: 'غير مصرح' });

  if (!process.env.POSTGRES_URL) return res.status(500).json({ error: 'POSTGRES_URL غير موجود' });
  const sql = neon(process.env.POSTGRES_URL);

  try {
    // ── GET: قائمة الدراسات أو دراسة واحدة بمحتواها ──
    if (req.method === 'GET') {
      const studyId = req.query.id ? parseInt(req.query.id) : null;

      if (studyId) {
        const rows = await sql`
          SELECT id, title, content, created_at
          FROM studies
          WHERE id = ${studyId} AND user_id = ${userId}
          LIMIT 1
        `;
        if (!rows[0]) return res.status(404).json({ error: 'الدراسة غير موجودة' });
        return res.status(200).json({ study: rows[0] });
      }

      const rows = await sql`
        SELECT id, title, created_at
        FROM studies
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT 50
      `;
      return res.status(200).json({ studies: rows });
    }

    // ── POST: حفظ دراسة (upsert بنفس العنوان) ──
    if (req.method === 'POST') {
      const { title, content } = req.body || {};
      if (!title || !content) return res.status(400).json({ error: 'العنوان والمحتوى مطلوبان' });

      const existing = await sql`
        SELECT id FROM studies WHERE user_id = ${userId} AND title = ${title} LIMIT 1
      `;

      let studyId;
      if (existing.length > 0) {
        await sql`
          UPDATE studies SET content = ${content}, created_at = NOW()
          WHERE id = ${existing[0].id}
        `;
        studyId = existing[0].id;
      } else {
        const rows = await sql`
          INSERT INTO studies (user_id, title, content)
          VALUES (${userId}, ${title}, ${content})
          RETURNING id
        `;
        studyId = rows[0].id;
      }

      return res.status(200).json({ id: studyId });
    }

    // ── DELETE: حذف دراسة ──
    if (req.method === 'DELETE') {
      const id = parseInt(req.query.id);
      if (!id || isNaN(id)) return res.status(400).json({ error: 'id مطلوب' });
      await sql`DELETE FROM studies WHERE id = ${id} AND user_id = ${userId}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (e) {
    console.error('studies API error:', e);
    return res.status(500).json({ error: 'خطأ في الخادم: ' + e.message });
  }
}
