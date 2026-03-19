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

    // ── migration واحد آمن بـ PL/pgSQL block — يضيف الأعمدة مرة واحدة ──
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='feasibility_studies' AND column_name='metadata') THEN
          ALTER TABLE feasibility_studies ADD COLUMN metadata JSONB;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='feasibility_studies' AND column_name='input_data') THEN
          ALTER TABLE feasibility_studies ADD COLUMN input_data JSONB;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='feasibility_studies' AND column_name='status') THEN
          ALTER TABLE feasibility_studies ADD COLUMN status TEXT DEFAULT 'completed';
        END IF;
      END $$
    `;

    // ── GET: قائمة الدراسات أو دراسة واحدة بمحتواها ──
    if (req.method === 'GET') {
      const studyId = req.query.id ? parseInt(req.query.id) : null;

      if (studyId) {
        const rows = await sql`
          SELECT id, project_name AS title, ai_output AS content, metadata, input_data,
                 COALESCE(status, 'completed') AS status, created_at
          FROM feasibility_studies
          WHERE id = ${studyId} AND user_id = ${userId}
          LIMIT 1
        `;
        if (!rows[0]) return res.status(404).json({ error: 'الدراسة غير موجودة' });
        return res.status(200).json({ study: rows[0] });
      }

      const rows = await sql`
        SELECT id, project_name AS title, metadata, input_data,
               COALESCE(status, 'completed') AS status, created_at
        FROM feasibility_studies
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT 50
      `;
      return res.status(200).json({ studies: rows });
    }

    // ── POST: حفظ دراسة (upsert بنفس الاسم) ──
    if (req.method === 'POST') {
      const { title, content, metadata, input_data, status } = req.body || {};
      if (!title || !content) return res.status(400).json({ error: 'العنوان والمحتوى مطلوبان' });

      const metaJson      = metadata   ? JSON.stringify(metadata)   : null;
      const inputDataJson = input_data ? JSON.stringify(input_data) : null;
      const studyStatus   = status === 'draft' ? 'draft' : 'completed';

      const existing = await sql`
        SELECT id FROM feasibility_studies
        WHERE user_id = ${userId} AND project_name = ${title}
        LIMIT 1
      `;

      let studyId;
      if (existing.length > 0) {
        await sql`
          UPDATE feasibility_studies
          SET ai_output  = ${content},
              metadata   = CASE WHEN ${metaJson} IS NULL THEN NULL ELSE ${metaJson}::jsonb END,
              input_data = CASE WHEN ${inputDataJson} IS NULL THEN NULL ELSE ${inputDataJson}::jsonb END,
              status     = ${studyStatus},
              created_at = NOW()
          WHERE id = ${existing[0].id}
        `;
        studyId = existing[0].id;
      } else {
        const rows = await sql`
          INSERT INTO feasibility_studies (user_id, project_name, ai_output, metadata, input_data, status)
          VALUES (
            ${userId}, ${title}, ${content},
            CASE WHEN ${metaJson} IS NULL THEN NULL ELSE ${metaJson}::jsonb END,
            CASE WHEN ${inputDataJson} IS NULL THEN NULL ELSE ${inputDataJson}::jsonb END,
            ${studyStatus}
          )
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
      await sql`DELETE FROM feasibility_studies WHERE id = ${id} AND user_id = ${userId}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (e) {
    console.error('studies API error:', e);
    return res.status(500).json({ error: 'خطأ في الخادم: ' + e.message });
  }
}
