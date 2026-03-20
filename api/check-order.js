import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing order id' });

  try {
    const sql = neon(process.env.POSTGRES_URL);
    const rows = await sql`
      SELECT status, user_id, amount, created_at
      FROM orders
      WHERE id = ${id}
      LIMIT 1
    `;
    if (!rows.length) return res.status(404).json({ error: 'Order not found' });

    const order = rows[0];
    return res.status(200).json({
      status:     order.status,      // pending | paid | failed
      userId:     order.user_id,
      amount:     order.amount,
      createdAt:  order.created_at,
    });
  } catch (err) {
    console.error('[check-order] DB error:', err.message);
    return res.status(500).json({ error: 'Database error', detail: err.message });
  }
}
