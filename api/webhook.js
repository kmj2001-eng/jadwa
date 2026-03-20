import crypto from 'crypto';

// ── إرسال فاتورة الدفع بالبريد الإلكتروني ──────────────────
async function sendInvoiceEmail({ to, name, invoiceNumber, date, transactionId }) {
  if (!process.env.RESEND_API_KEY) return;
  const siteUrl = 'https://eses.store';
  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
  body{margin:0;padding:20px 0;background:#0f172a;font-family:'Cairo','Segoe UI',Tahoma,sans-serif;direction:rtl;}
  .wrap{max-width:560px;margin:0 auto;background:#1e293b;border-radius:20px;overflow:hidden;border:1px solid #1e3a5f;box-shadow:0 8px 40px rgba(0,0,0,0.5);}
  .header{background:linear-gradient(135deg,#1d4ed8 0%,#1e40af 100%);padding:32px 28px;text-align:center;}
  .logo-box{display:inline-flex;align-items:center;gap:10px;margin-bottom:6px;}
  .logo-mark{width:44px;height:44px;background:rgba(255,255,255,0.18);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.4rem;font-weight:800;color:#fff;font-family:'Cairo',sans-serif;}
  .logo-name{color:#fff;font-size:1.4rem;font-weight:800;font-family:'Cairo',sans-serif;}
  .logo-name span{color:#93c5fd;}
  .tagline{color:#bfdbfe;font-size:0.82rem;margin:4px 0 0;}
  .inv-badge{display:inline-block;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);border-radius:8px;padding:6px 16px;margin-top:14px;color:#e0f2fe;font-size:0.85rem;font-weight:700;letter-spacing:1px;}
  .body{padding:32px 28px;}
  .section-title{font-size:0.72rem;font-weight:700;color:#64748b;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px;margin-top:0;}
  .card{background:#0f172a;border:1px solid #1e3a5f;border-radius:14px;padding:18px 20px;margin-bottom:16px;}
  .row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #1e293b;}
  .row:last-child{border-bottom:none;}
  .row-label{color:#64748b;font-size:0.88rem;}
  .row-value{color:#cbd5e1;font-size:0.88rem;font-weight:600;text-align:left;direction:ltr;}
  .total-row{display:flex;justify-content:space-between;align-items:center;padding:12px 20px;background:linear-gradient(135deg,rgba(59,130,246,0.12),rgba(29,78,216,0.08));border-radius:10px;margin-top:4px;}
  .total-label{color:#93c5fd;font-size:0.95rem;font-weight:700;}
  .total-value{color:#60a5fa;font-size:1.2rem;font-weight:800;direction:ltr;}
  .status-badge{display:inline-flex;align-items:center;gap:6px;background:rgba(52,211,153,0.1);border:1px solid rgba(52,211,153,0.3);border-radius:8px;padding:8px 16px;color:#34d399;font-size:0.88rem;font-weight:700;margin-bottom:20px;}
  .divider{border:none;border-top:1px solid #1e3a5f;margin:20px 0;}
  .thanks{color:#94a3b8;font-size:0.9rem;text-align:center;line-height:1.9;}
  .thanks strong{color:#f1f5f9;}
  .footer{background:#0f172a;padding:22px;text-align:center;border-top:1px solid #1e293b;}
  .footer-logo{color:#f1f5f9;font-size:1rem;font-weight:800;margin-bottom:4px;font-family:'Cairo',sans-serif;}
  .footer-logo span{color:#60a5fa;}
  .footer-link{color:#3b82f6;font-size:0.8rem;text-decoration:none;font-weight:600;}
  .footer-copy{color:#334155;font-size:0.7rem;margin-top:8px;}
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
    <div class="inv-badge">🧾 فاتورة شراء &nbsp;#${invoiceNumber}</div>
  </div>
  <div class="body">

    <!-- حالة الطلب -->
    <div style="text-align:center;margin-bottom:24px;">
      <div class="status-badge">✅ &nbsp;مكتمل — تم الدفع بنجاح</div>
    </div>

    <!-- بيانات العميل -->
    <p class="section-title">👤 بيانات العميل</p>
    <div class="card">
      <div class="row"><span class="row-label">الاسم</span><span class="row-value">${name}</span></div>
      <div class="row"><span class="row-label">البريد الإلكتروني</span><span class="row-value">${to}</span></div>
      <div class="row"><span class="row-label">تاريخ العملية</span><span class="row-value">${date}</span></div>
      <div class="row"><span class="row-label">رقم المرجع</span><span class="row-value">${transactionId}</span></div>
    </div>

    <!-- تفاصيل الطلب -->
    <p class="section-title">📦 تفاصيل الطلب</p>
    <div class="card">
      <div class="row"><span class="row-label">الخدمة</span><span class="row-value">باقة نقاط الجدوى</span></div>
      <div class="row"><span class="row-label">عدد النقاط</span><span class="row-value">5 نقاط</span></div>
      <div class="row"><span class="row-label">الوصف</span><span class="row-value" style="font-size:0.8rem;">إنشاء دراسات جدوى احترافية</span></div>
      <div class="row"><span class="row-label">طريقة الدفع</span><span class="row-value">بوابة الدفع الإلكتروني</span></div>
    </div>

    <!-- المبلغ -->
    <p class="section-title">💰 المبلغ</p>
    <div class="card">
      <div class="row"><span class="row-label">سعر الباقة</span><span class="row-value">49.99 ر.س</span></div>
      <div class="row"><span class="row-label">الضريبة</span><span class="row-value">مشمولة</span></div>
    </div>
    <div class="total-row">
      <span class="total-label">الإجمالي</span>
      <span class="total-value">49.99 ر.س</span>
    </div>

    <hr class="divider">
    <p class="thanks">
      🙏 شكراً لاختيارك <strong>ذكاء الأعمال</strong><br>
      نتمنى لك تجربة ناجحة ومميزة 🚀
    </p>
  </div>
  <div class="footer">
    <div class="footer-logo">ذكاء <span>الأعمال</span></div>
    <a href="${siteUrl}" class="footer-link">${siteUrl}</a>
    <div class="footer-copy">© ${new Date().getFullYear()} ذكاء الأعمال — جميع الحقوق محفوظة</div>
  </div>
</div>
</body></html>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: `ذكاء الأعمال <${process.env.SENDER_EMAIL || 'onboarding@resend.dev'}>`,
      to: [to],
      subject: `🧾 فاتورتك من ذكاء الأعمال — #${invoiceNumber}`,
      html
    })
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const hmacSecret = process.env.PAYMOB_HMAC_SECRET;
  const receivedHmac = req.query.hmac;

  // التحقق من صحة HMAC إذا كان المفتاح موجوداً
  if (hmacSecret && receivedHmac) {
    const obj = req.body?.obj || {};

    // ترتيب حقول HMAC كما تحدده Paymob
    const concatFields = [
      obj.amount_cents,
      obj.created_at,
      obj.currency,
      obj.error_occured,
      obj.has_parent_transaction,
      obj.id,
      obj.integration_id,
      obj.is_3d_secure,
      obj.is_auth,
      obj.is_capture,
      obj.is_refunded,
      obj.is_standalone_payment,
      obj.is_voided,
      obj.order?.id,
      obj.owner,
      obj.pending,
      obj.source_data?.pan,
      obj.source_data?.sub_type,
      obj.source_data?.type,
      obj.success,
    ];

    const concat = concatFields.map(f => f?.toString() ?? '').join('');
    const computed = crypto.createHmac('sha512', hmacSecret).update(concat).digest('hex');

    if (computed.toLowerCase() !== receivedHmac.toLowerCase()) {
      console.error('Paymob Webhook: HMAC mismatch');
      return res.status(401).json({ error: 'Invalid HMAC signature' });
    }
  }

  const obj = req.body?.obj || {};
  const paymobOrderId = obj?.order?.id?.toString();
  const transactionId = obj?.id?.toString();
  const success = obj?.success === true || obj?.success === 'true';
  const isPending = obj?.pending === true || obj?.pending === 'true';

  console.log(`Paymob Webhook: orderId=${paymobOrderId}, txId=${transactionId}, success=${success}, pending=${isPending}`);

  if (success && !isPending) {
    try {
      if (process.env.POSTGRES_URL) {
        const { neon } = await import('@neondatabase/serverless');
        const sql = neon(process.env.POSTGRES_URL);

        // ── تحديث حالة الطلب بـ paymob_order_id ──
        const updated = await sql`
          UPDATE orders
          SET status = 'paid', updated_at = NOW()
          WHERE paymob_order_id = ${paymobOrderId}
            AND status != 'paid'
          RETURNING *
        `;

        // التحقق من merchant_order_id بديلاً (jadwa_{dbId}_timestamp)
        const merchantOrderId = obj?.order?.merchant_order_id?.toString() || '';
        const dbIdFromMerchant = merchantOrderId.match(/^jadwa_(\d+)_/)?.[1];

        let order = updated[0];

        // إن لم يُعثر على الطلب بـ paymob_order_id → ابحث بـ merchant_order_id
        if (!order && dbIdFromMerchant) {
          const fallback = await sql`
            UPDATE orders SET status = 'paid', paymob_order_id = ${paymobOrderId}, updated_at = NOW()
            WHERE id = ${parseInt(dbIdFromMerchant)} AND status != 'paid'
            RETURNING *
          `;
          order = fallback[0];
        }

        if (order) {
          const invoiceNumber = String(order.id).padStart(5, '0');

          // ── إنشاء فاتورة (مرة واحدة) ──
          await sql`
            INSERT INTO invoices (order_id, user_id, amount, currency, status, invoice_number)
            VALUES (${order.id}, ${order.user_id}, ${order.amount}, ${order.currency}, 'paid', ${invoiceNumber})
            ON CONFLICT DO NOTHING
          `;

          // ── منح 5 نقاط للمستخدم (مرة واحدة لكل طلب) ──
          await sql`
            INSERT INTO user_points (user_id, order_id, total_points, used_points)
            VALUES (${order.user_id}, ${order.id}, 5, 0)
            ON CONFLICT (order_id) DO NOTHING
          `;

          // ── إرسال فاتورة للعميل عبر البريد ──
          try {
            const users = await sql`SELECT name, email FROM users WHERE id = ${order.user_id} LIMIT 1`;
            const user  = users[0];
            if (user?.email) {
              const date = new Date().toLocaleDateString('ar-SA', { year:'numeric', month:'long', day:'numeric' });
              sendInvoiceEmail({
                to: user.email,
                name: user.name || user.email,
                invoiceNumber,
                date,
                transactionId: transactionId || paymobOrderId || '—'
              }).catch(e => console.warn('Invoice email error:', e.message));
            }
          } catch(emailErr) {
            console.warn('Invoice email lookup error:', emailErr.message);
          }

          console.log(`✅ Webhook: Order ${order.id} paid | user ${order.user_id} | invoice ${invoiceNumber}`);
        } else {
          // لم يُعثر على الطلب — سجّل للمراجعة اليدوية
          console.warn(`⚠️ Webhook: paymobOrderId=${paymobOrderId} not found in DB | merchant=${merchantOrderId}`);
        }
      }
    } catch (dbErr) {
      // لا نفشل الـ webhook بسبب خطأ في DB — Paymob يعيد المحاولة إن لم يحصل على 200
      console.error('Webhook DB Error:', dbErr.message);
    }
  }

  // Paymob يتوقع 200 دائماً
  return res.status(200).json({ received: true, success });
}
