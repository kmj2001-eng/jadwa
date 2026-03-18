import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.headers['x-setup-secret'] !== process.env.SETUP_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });

  const sql = neon(process.env.POSTGRES_URL);

  const users = await sql`
    SELECT id, name, email, phone,
           password_hash IS NOT NULL AS has_password,
           created_at
    FROM users ORDER BY created_at DESC LIMIT 20
  `;

  const cols = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'users'
    ORDER BY ordinal_position
  `;

  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `;

  return res.status(200).json({ tables: tables.map(t=>t.table_name), columns: cols, users });
}
