import { setupTables } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // حماية نقطة النهاية بمفتاح سري
  const secret = req.headers['x-setup-secret'];
  if (!secret || secret !== process.env.SETUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized — مطلوب x-setup-secret' });
  }

  try {
    const result = await setupTables();
    return res.status(200).json(result);
  } catch (err) {
    console.error('Setup DB Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
