import crypto from 'crypto';
import {
  createUserWithPassword,
  getUserByEmail,
  setResetToken,
  getUserByResetToken,
  updatePassword,
  migrateUsersTable
} from './db.js';

// ──────────────────────────────────────────────────────────
//  JWT Helpers (بدون مكتبات خارجية)
// ──────────────────────────────────────────────────────────
function b64url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function signJWT(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = b64url(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30  // 30 يوم
  }));
  const sig = crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'jadwa-secret-change-in-production')
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${header}.${body}.${sig}`;
}

function verifyJWT(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto
      .createHmac('sha256', process.env.JWT_SECRET || 'jadwa-secret-change-in-production')
      .update(`${header}.${body}`)
      .digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    if (expected !== sig) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

// ──────────────────────────────────────────────────────────
//  Password Helpers
// ──────────────────────────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const incoming = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(incoming, 'hex'));
  } catch { return false; }
}

// ──────────────────────────────────────────────────────────
//  Main Handler
// ──────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-setup-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { action } = req.body || {};

  try {

    // ── REGISTER ────────────────────────────────────────────
    if (action === 'register') {
      const { email, password, name, phone } = req.body;
      if (!email || !password || !name)
        return res.status(400).json({ error: 'الاسم والبريد وكلمة السر مطلوبة' });
      if (password.length < 8)
        return res.status(400).json({ error: 'كلمة السر يجب أن تكون 8 أحرف على الأقل' });

      const existing = await getUserByEmail(email.toLowerCase().trim());
      if (existing)
        return res.status(409).json({ error: 'هذا البريد الإلكتروني مسجَّل مسبقاً' });

      const user = await createUserWithPassword({
        email: email.toLowerCase().trim(),
        name: name.trim(),
        phone: phone?.trim() || null,
        passwordHash: hashPassword(password)
      });
      const token = signJWT({ userId: user.id, email: user.email, name: user.name });
      return res.status(200).json({
        token,
        user: { id: user.id, email: user.email, name: user.name, phone: user.phone }
      });
    }

    // ── LOGIN ────────────────────────────────────────────────
    if (action === 'login') {
      const { email, password } = req.body;
      if (!email || !password)
        return res.status(400).json({ error: 'البريد وكلمة السر مطلوبان' });

      const user = await getUserByEmail(email.toLowerCase().trim());
      if (!user || !user.password_hash)
        return res.status(401).json({ error: 'البريد أو كلمة السر غير صحيحة' });

      if (!verifyPassword(password, user.password_hash))
        return res.status(401).json({ error: 'البريد أو كلمة السر غير صحيحة' });

      const token = signJWT({ userId: user.id, email: user.email, name: user.name });
      return res.status(200).json({
        token,
        user: { id: user.id, email: user.email, name: user.name, phone: user.phone }
      });
    }

    // ── FORGOT PASSWORD ──────────────────────────────────────
    if (action === 'forgot') {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'البريد الإلكتروني مطلوب' });

      const user = await getUserByEmail(email.toLowerCase().trim());
      if (!user) {
        // لا نكشف إذا كان البريد مسجلاً أم لا
        return res.status(200).json({ success: true, resetToken: null });
      }
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expiresAt  = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // ساعة
      await setResetToken(user.email, resetToken, expiresAt);
      // نُعيد التوكن مباشرة (لا يوجد email service حالياً)
      return res.status(200).json({ success: true, resetToken });
    }

    // ── RESET PASSWORD ───────────────────────────────────────
    if (action === 'reset') {
      const { resetToken, newPassword } = req.body;
      if (!resetToken || !newPassword)
        return res.status(400).json({ error: 'التوكن وكلمة السر الجديدة مطلوبان' });
      if (newPassword.length < 8)
        return res.status(400).json({ error: 'كلمة السر يجب أن تكون 8 أحرف على الأقل' });

      const user = await getUserByResetToken(resetToken);
      if (!user)
        return res.status(400).json({ error: 'الرابط منتهي الصلاحية أو غير صالح' });

      await updatePassword(user.id, hashPassword(newPassword));
      const token = signJWT({ userId: user.id, email: user.email, name: user.name });
      return res.status(200).json({
        success: true, token,
        user: { id: user.id, email: user.email, name: user.name }
      });
    }

    // ── VERIFY TOKEN ─────────────────────────────────────────
    if (action === 'verify') {
      const authHeader = req.headers.authorization || '';
      const payload = verifyJWT(authHeader.replace('Bearer ', ''));
      if (!payload) return res.status(401).json({ error: 'توكن غير صالح أو منتهي' });
      return res.status(200).json({ valid: true, user: payload });
    }

    // ── MIGRATE ──────────────────────────────────────────────
    if (action === 'migrate') {
      const secret = req.headers['x-setup-secret'];
      if (!secret || secret !== process.env.SETUP_SECRET)
        return res.status(401).json({ error: 'Unauthorized' });
      const result = await migrateUsersTable();
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'action غير معروف' });

  } catch (err) {
    console.error('Auth Error:', err.message);
    return res.status(500).json({ error: 'خطأ في الخادم: ' + err.message });
  }
}
