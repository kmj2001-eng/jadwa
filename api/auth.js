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
//  Email Helper (Resend)
// ──────────────────────────────────────────────────────────
async function sendResetEmail({ to, name, resetLink }) {
  const siteUrl = process.env.SITE_URL || 'https://jadwa-omega.vercel.app';
  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Tahoma,sans-serif;direction:rtl;}
  .wrap{max-width:520px;margin:40px auto;background:#1e293b;border-radius:16px;overflow:hidden;border:1px solid #334155;}
  .header{background:linear-gradient(135deg,#1d4ed8,#2563eb);padding:32px 24px;text-align:center;}
  .logo{color:#fff;font-size:1.5rem;font-weight:700;letter-spacing:1px;}
  .logo span{color:#93c5fd;}
  .body{padding:32px 28px;}
  .greeting{color:#e2e8f0;font-size:1.05rem;margin-bottom:16px;}
  .msg{color:#94a3b8;font-size:0.92rem;line-height:1.8;margin-bottom:24px;}
  .btn{display:block;width:fit-content;margin:0 auto 24px;background:#2563eb;color:#fff!important;text-decoration:none;padding:14px 36px;border-radius:10px;font-size:1rem;font-weight:600;}
  .link-box{background:#0f172a;border-radius:8px;padding:12px 16px;margin-bottom:24px;}
  .link-box p{color:#64748b;font-size:0.78rem;margin:0 0 6px;}
  .link-box a{color:#60a5fa;font-size:0.78rem;word-break:break-all;}
  .note{color:#64748b;font-size:0.8rem;line-height:1.7;border-top:1px solid #334155;padding-top:20px;}
  .footer{background:#0f172a;padding:16px;text-align:center;color:#475569;font-size:0.75rem;}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo">ذكاء <span>الأعمال</span></div>
    <p style="color:#bfdbfe;font-size:0.85rem;margin:6px 0 0;">منصة دراسات الجدوى الذكية</p>
  </div>
  <div class="body">
    <p class="greeting">مرحباً ${name || 'عزيزنا'} 👋</p>
    <p class="msg">
      تلقّينا طلباً لإعادة تعيين كلمة المرور الخاصة بحسابك في منصة <strong>ذكاء الأعمال</strong>.<br>
      اضغط على الزر أدناه لتعيين كلمة مرور جديدة. الرابط صالح لمدة <strong>ساعة واحدة</strong> فقط.
    </p>
    <a href="${resetLink}" class="btn">🔑 إعادة تعيين كلمة المرور</a>
    <div class="link-box">
      <p>إذا لم يعمل الزر، انسخ الرابط التالي في متصفحك:</p>
      <a href="${resetLink}">${resetLink}</a>
    </div>
    <p class="note">
      ⚠️ إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذا الإيميل بأمان — حسابك بخير.<br>
      لأسباب أمنية لا تشارك هذا الرابط مع أحد.
    </p>
  </div>
  <div class="footer">© ${new Date().getFullYear()} ذكاء الأعمال — جميع الحقوق محفوظة</div>
</div>
</body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: `ذكاء الأعمال <${process.env.SENDER_EMAIL || 'onboarding@resend.dev'}>`,
      to: [to],
      subject: '🔑 إعادة تعيين كلمة المرور — ذكاء الأعمال',
      html
    })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error('Resend error: ' + JSON.stringify(err));
  }
  return res.json();
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

      const siteUrl   = process.env.SITE_URL || 'https://eses.store';
      const resetLink = `${siteUrl}/#reset?token=${resetToken}`;

      // ── إرسال الإيميل إذا تم ضبط RESEND_API_KEY ──────────
      if (process.env.RESEND_API_KEY) {
        try {
          await sendResetEmail({ to: user.email, name: user.name, resetLink });
          // البريد أُرسل بنجاح — لا نُرجع التوكن (أمان)
          return res.status(200).json({ success: true, emailSent: true });
        } catch (emailErr) {
          console.warn('Resend email failed, falling back to token response:', emailErr.message);
          // سقوط للوضع الاحتياطي: إرجاع التوكن مباشرة
        }
      }

      // ── الوضع الاحتياطي: لا يوجد بريد أو فشل الإرسال ──────
      // نُرجع التوكن ليعرضه الـ UI مباشرة
      return res.status(200).json({ success: true, emailSent: false, resetToken, resetLink });
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
