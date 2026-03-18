import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const incoming = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(incoming, 'hex'));
  } catch { return false; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-user-id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const userId = parseInt(req.headers['x-user-id']);
  if (!userId || isNaN(userId)) return res.status(401).json({ error: 'غير مصرح' });

  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'كلمة المرور مطلوبة للتأكيد' });

  if (!process.env.POSTGRES_URL) return res.status(500).json({ error: 'POSTGRES_URL غير موجود' });
  const sql = neon(process.env.POSTGRES_URL);

  try {
    // التحقق من كلمة المرور
    const users = await sql`SELECT id, password_hash FROM users WHERE id = ${userId} LIMIT 1`;
    if (!users[0]) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (!verifyPassword(password, users[0].password_hash))
      return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });

    // حذف البيانات بالترتيب الصحيح (FK)
    await sql`DELETE FROM feasibility_studies WHERE user_id = ${userId}`;
    await sql`DELETE FROM invoices        WHERE user_id = ${userId}`;
    await sql`DELETE FROM user_points     WHERE user_id = ${userId}`;
    await sql`DELETE FROM orders          WHERE user_id = ${userId}`;
    await sql`DELETE FROM users           WHERE id      = ${userId}`;

    return res.status(200).json({ success: true, message: 'تم حذف الحساب وجميع البيانات بنجاح' });

  } catch(e) {
    console.error('delete-account error:', e);
    return res.status(500).json({ error: 'خطأ في الخادم: ' + e.message });
  }
}
