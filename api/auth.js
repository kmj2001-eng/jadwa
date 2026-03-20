import crypto from 'crypto';
import {
  createUserWithPassword,
  getUserByEmail,
  setResetToken,
  getUserByResetToken,
  updatePassword,
  migrateUsersTable,
  checkBonusAlreadyUsed,
  recordBonusUsed,
  grantWelcomePoint
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
//  Temp Password Generator — حرف واحد + 5 أرقام
// ──────────────────────────────────────────────────────────
function generateTempPassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // بدون I و O لتجنب الالتباس
  const letter = letters[crypto.randomInt(letters.length)];
  const digits = Array.from({ length: 5 }, () => crypto.randomInt(10)).join('');
  return letter + digits;
}

// ──────────────────────────────────────────────────────────
//  Email Helper (Resend) — إرسال كلمة المرور المؤقتة
// ──────────────────────────────────────────────────────────
async function sendTempPasswordEmail({ to, name, tempPassword }) {
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
  .pw-box{background:#0f172a;border:2px solid #2563eb;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;}
  .pw-label{color:#64748b;font-size:0.78rem;margin-bottom:8px;}
  .pw-value{color:#60a5fa;font-size:2rem;font-weight:700;letter-spacing:6px;font-family:monospace;}
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
      تلقّينا طلباً لاستعادة كلمة المرور الخاصة بحسابك.<br>
      فيما يلي كلمة مرورك الجديدة — استخدمها لتسجيل الدخول.
    </p>
    <div class="pw-box">
      <div class="pw-label">كلمة المرور الجديدة</div>
      <div class="pw-value">${tempPassword}</div>
    </div>
    <p class="note">
      ⚠️ إذا لم تطلب استعادة كلمة المرور، يمكنك تجاهل هذا الإيميل بأمان — حسابك بخير.<br>
      لأسباب أمنية لا تشارك هذه الكلمة مع أحد.
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
      subject: '🔑 كلمة المرور الجديدة — ذكاء الأعمال',
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
//  Email Helper (Resend) — رسالة ترحيب بالعميل الجديد
// ──────────────────────────────────────────────────────────
async function sendWelcomeEmail({ to, name }) {
  const displayName = name || to;
  const siteUrl     = 'https://eses.store';
  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
  body{margin:0;padding:20px 0;background:#0f172a;font-family:'Cairo','Segoe UI',Tahoma,sans-serif;direction:rtl;}
  .wrap{max-width:520px;margin:0 auto;background:#1e293b;border-radius:20px;overflow:hidden;border:1px solid #1e3a5f;box-shadow:0 8px 40px rgba(0,0,0,0.5);}
  .header{background:linear-gradient(135deg,#1d4ed8 0%,#1e40af 100%);padding:40px 28px 36px;text-align:center;}
  .logo-box{display:inline-flex;align-items:center;gap:12px;margin-bottom:10px;}
  .logo-mark{width:48px;height:48px;background:rgba(255,255,255,0.18);border-radius:14px;display:flex;align-items:center;justify-content:center;font-family:'Cairo',sans-serif;font-size:1.6rem;font-weight:800;color:#fff;}
  .logo-name{color:#fff;font-size:1.5rem;font-weight:800;letter-spacing:0.5px;font-family:'Cairo',sans-serif;}
  .logo-name span{color:#93c5fd;}
  .tagline{color:#bfdbfe;font-size:0.85rem;margin:4px 0 0;font-weight:400;}
  .body{padding:40px 32px;}
  .emoji-big{font-size:3rem;text-align:center;margin-bottom:20px;line-height:1;}
  .title-main{color:#f8fafc;font-size:1.35rem;font-weight:800;text-align:center;margin-bottom:6px;font-family:'Cairo',sans-serif;}
  .title-sub{color:#60a5fa;font-size:1rem;font-weight:600;text-align:center;margin-bottom:28px;font-family:'Cairo',sans-serif;}
  .divider{width:48px;height:3px;background:linear-gradient(90deg,#3b82f6,#60a5fa);border-radius:2px;margin:0 auto 28px;border:none;}
  .greeting{color:#cbd5e1;font-size:1rem;line-height:2;text-align:center;margin-bottom:32px;font-weight:400;}
  .greeting strong{color:#f1f5f9;font-weight:700;}
  .cta{display:block;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;text-decoration:none;text-align:center;padding:16px 28px;border-radius:14px;font-size:1rem;font-weight:700;margin-bottom:32px;font-family:'Cairo',sans-serif;letter-spacing:0.3px;}
  .wish{color:#64748b;font-size:0.9rem;text-align:center;line-height:1.9;font-weight:400;}
  .footer{background:#0f172a;padding:24px;text-align:center;border-top:1px solid #1e293b;}
  .footer-logo{color:#f1f5f9;font-size:1.05rem;font-weight:800;margin-bottom:6px;font-family:'Cairo',sans-serif;}
  .footer-logo span{color:#60a5fa;}
  .footer-link{color:#3b82f6;font-size:0.8rem;text-decoration:none;font-weight:600;}
  .footer-copy{color:#334155;font-size:0.72rem;margin-top:10px;font-weight:400;}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo-box">
      <div class="logo-mark">ذ</div>
      <div class="logo-name">ذكاء <span>الأعمال</span></div>
    </div>
    <p class="tagline">منصة دراسات الجدوى الذكية</p>
  </div>
  <div class="body">
    <div class="emoji-big">🎉</div>
    <div class="title-main">مرحباً ${displayName}!</div>
    <div class="title-sub">✅ تم إنشاء حسابك بنجاح!</div>
    <hr class="divider">
    <p class="greeting">
      <strong>أهلاً بك 👋</strong><br>
      ابدأ الآن واستفد من خدماتنا بكل سهولة.<br>
      نحن هنا لمساعدتك في كل خطوة.
    </p>
    <a href="${siteUrl}" class="cta">🚀 &nbsp;ابدأ تجربتك الآن</a>
    <p class="wish">🌟 نتمنى لك تجربة رائعة مع ذكاء الأعمال!</p>
  </div>
  <div class="footer">
    <div class="footer-logo">ذكاء <span>الأعمال</span></div>
    <a href="${siteUrl}" class="footer-link">${siteUrl}</a>
    <div class="footer-copy">© ${new Date().getFullYear()} ذكاء الأعمال — جميع الحقوق محفوظة</div>
  </div>
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
      subject: '🎉 مرحباً بك في ذكاء الأعمال!',
      html
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error('Resend error: ' + JSON.stringify(err));
  }
  return res.json();
}

// ──────────────────────────────────────────────────────────
//  Main Handler
// ──────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const allowedOrigins = ['https://eses.store', 'https://www.eses.store', 'http://localhost:3001'];
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes(origin) ? origin : allowedOrigins[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-setup-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { action } = req.body || {};

  try {

    // ── REGISTER ────────────────────────────────────────────
    if (action === 'register') {
      const { email, password, name, phone, fingerprint } = req.body;
      if (!email || !password || !name)
        return res.status(400).json({ error: 'الاسم والبريد وكلمة السر مطلوبة' });
      if (password.length < 8)
        return res.status(400).json({ error: 'كلمة السر يجب أن تكون 8 أحرف على الأقل' });

      const existing = await getUserByEmail(email.toLowerCase().trim());
      if (existing)
        return res.status(409).json({ error: 'هذا البريد الإلكتروني مسجَّل مسبقاً' });

      // استخراج IP الحقيقي (Vercel يضعه في x-forwarded-for)
      const ip = (req.headers['x-forwarded-for'] || '')
        .split(',')[0].trim()
        || req.headers['x-real-ip']
        || req.socket?.remoteAddress
        || 'unknown';

      // فحص هل هذا الجهاز/IP استخدم النقطة المجانية من قبل
      let bonusAlreadyUsed = false;
      try {
        bonusAlreadyUsed = await checkBonusAlreadyUsed(ip, fingerprint || null);
      } catch(e) {
        console.warn('bonus check failed:', e.message);
        bonusAlreadyUsed = true; // رفض المنح احتياطاً عند خطأ DB
      }

      // إنشاء الحساب دائماً بغض النظر عن الـ bonus
      const user = await createUserWithPassword({
        email: email.toLowerCase().trim(),
        name: name.trim(),
        phone: phone?.trim() || null,
        passwordHash: hashPassword(password)
      });
      const token = signJWT({ userId: user.id, email: user.email, name: user.name });

      // إرسال بريد ترحيبي لجميع المسجلين (لا يوقف التسجيل إذا فشل)
      if (process.env.RESEND_API_KEY) {
        sendWelcomeEmail({ to: user.email, name: user.name })
          .then(() => console.log(`✅ Welcome email sent to ${user.email}`))
          .catch(e => console.error(`❌ Welcome email failed for ${user.email}:`, e.message));
      } else {
        console.warn('⚠️ RESEND_API_KEY not set — welcome email skipped');
      }

      if (bonusAlreadyUsed) {
        // سبق منح النقطة المجانية لهذا الجهاز/IP — لا نمنح نقطة
        return res.status(200).json({
          token,
          user: { id: user.id, email: user.email, name: user.name, phone: user.phone },
          bonusGranted: false,
          bonusDenied: true
        });
      }

      // منح نقطة ترحيبية مجانية وتسجيل الجهاز/IP
      try {
        await grantWelcomePoint(user.id);
        await recordBonusUsed(user.id, ip, fingerprint || null);
      } catch(_) {}

      return res.status(200).json({
        token,
        user: { id: user.id, email: user.email, name: user.name, phone: user.phone },
        bonusGranted: true
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
        return res.status(200).json({ success: true, emailSent: false, tempPassword: null });
      }

      // توليد كلمة مرور مؤقتة: حرف واحد + 5 أرقام
      const tempPassword = generateTempPassword();
      await updatePassword(user.id, hashPassword(tempPassword));

      // ── إرسال الإيميل إذا تم ضبط RESEND_API_KEY ──────────
      if (process.env.RESEND_API_KEY) {
        try {
          await sendTempPasswordEmail({ to: user.email, name: user.name, tempPassword });
          return res.status(200).json({ success: true, emailSent: true });
        } catch (emailErr) {
          console.warn('Resend email failed, falling back to UI response:', emailErr.message);
        }
      }

      // ── الوضع الاحتياطي: لا يوجد بريد أو فشل الإرسال ──────
      return res.status(200).json({ success: true, emailSent: false, tempPassword });
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
    return res.status(500).json({ error: 'خطأ في الخادم، حاول مجدداً' });
  }
}
