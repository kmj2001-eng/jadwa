// api/webhook.js — Paymob Webhook Handler
import crypto from "crypto";
import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (req.method === "GET") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  try {
    const data = req.body;

    // ── 🔐 1. تحقق HMAC ──────────────────────────────────────
    const receivedHmac = req.query.hmac;
    const secret       = process.env.PAYMOB_HMAC_SECRET;

    if (secret && receivedHmac) {
      const obj = data.obj;

      const hmacData = [
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
        obj.order.id,
        obj.owner,
        obj.pending,
        obj.source_data?.pan,
        obj.source_data?.sub_type,
        obj.source_data?.type,
        obj.success,
      ].join("");

      const calculatedHmac = crypto
        .createHmac("sha512", secret)
        .update(hmacData)
        .digest("hex");

      if (calculatedHmac.toLowerCase() !== receivedHmac.toLowerCase()) {
        console.error("❌ HMAC mismatch");
        return res.status(403).send("Invalid HMAC");
      }
    }

    // ── ✅ 2. استخراج البيانات ────────────────────────────────
    const obj           = data.obj;
    const success       = obj.success === true || obj.success === "true";
    const isPending     = obj.pending === true  || obj.pending === "true";
    const paymobOrderId = String(obj.order?.id || "");
    const transactionId = String(obj.id || "");
    const merchantId    = String(obj.order?.merchant_order_id || "");

    console.log(`[webhook] orderId=${paymobOrderId} | tx=${transactionId} | success=${success} | pending=${isPending}`);

    if (isPending) {
      // لا نفعل شيئاً — ننتظر التأكيد النهائي
      return res.status(200).json({ received: true });
    }

    // ── 🧠 3. تحديث قاعدة البيانات ───────────────────────────
    if (!process.env.POSTGRES_URL) {
      return res.status(200).json({ received: true });
    }

    const sql = neon(process.env.POSTGRES_URL);

    // استخرج dbOrderId من merchant_order_id (jadwa_31_timestamp)
    const dbId = merchantId.match(/^jadwa_(\d+)_/)?.[1];

    if (success) {
      // ── تحديث الطلب إلى مدفوع ──
      let order = null;

      // بحث بـ paymob_order_id أولاً
      const byPaymob = await sql`
        UPDATE orders SET status = 'paid', updated_at = NOW()
        WHERE paymob_order_id = ${paymobOrderId} AND status != 'paid'
        RETURNING *
      `;
      order = byPaymob[0];

      // بحث بـ merchant_order_id كبديل
      if (!order && dbId) {
        const byMerchant = await sql`
          UPDATE orders SET status = 'paid', paymob_order_id = ${paymobOrderId}, updated_at = NOW()
          WHERE id = ${parseInt(dbId)} AND status != 'paid'
          RETURNING *
        `;
        order = byMerchant[0];
      }

      // إذا كان الطلب موجوداً لكن مدفوعاً مسبقاً (عبر polling) — نجلبه للتأكد من إضافة النقاط
      if (!order && dbId) {
        const existing = await sql`SELECT * FROM orders WHERE id = ${parseInt(dbId)} LIMIT 1`;
        order = existing[0] || null;
      }
      if (!order && paymobOrderId) {
        const existing = await sql`SELECT * FROM orders WHERE paymob_order_id = ${paymobOrderId} LIMIT 1`;
        order = existing[0] || null;
      }

      if (order) {
        // ── منح 5 نقاط للمستخدم صالحة 6 أشهر (مرة واحدة) ──
        try {
          await sql`
            INSERT INTO user_points (user_id, order_id, total_points, used_points, expires_at)
            VALUES (${order.user_id}, ${order.id}, 5, 0, NOW() + INTERVAL '6 months')
            ON CONFLICT (order_id) DO NOTHING
          `;
        } catch (_) {}

        // ── إنشاء فاتورة + إرسال إيميل ──
        try {
          const invoiceNumber = String(order.id).padStart(5, "0");
          await sql`
            INSERT INTO invoices (order_id, user_id, amount, currency, status, invoice_number)
            VALUES (${order.id}, ${order.user_id}, ${order.amount}, ${order.currency}, 'paid', ${invoiceNumber})
            ON CONFLICT DO NOTHING
          `;

          // جلب بيانات المستخدم لإرسال الإيميل
          const users = await sql`SELECT name, email FROM users WHERE id = ${order.user_id} LIMIT 1`;
          const user  = users[0];
          const amountSAR = (order.amount / 100).toFixed(2);
          const dateStr   = new Date().toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' });

          if (user?.email && process.env.RESEND_API_KEY) {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: `ذكاء الأعمال <${process.env.SENDER_EMAIL || 'support@eses.store'}>`,
                to:   [user.email],
                subject: `🧾 فاتورة رقم #${invoiceNumber} — ذكاء الأعمال`,
                html: `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><style>
  body { font-family: Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 20px; }
  .card { background: #fff; max-width: 560px; margin: auto; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,.1); }
  .header { background: linear-gradient(135deg,#1e3a5f,#2563eb); padding: 32px 24px; text-align: center; color: #fff; }
  .header h1 { margin: 0; font-size: 22px; }
  .header p  { margin: 6px 0 0; opacity: .8; font-size: 14px; }
  .body { padding: 28px 24px; }
  .greeting { font-size: 16px; color: #1e293b; margin-bottom: 20px; }
  .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px; color: #475569; }
  .row span:last-child { font-weight: bold; color: #1e293b; }
  .amount-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; text-align: center; margin: 20px 0; }
  .amount-box .label { font-size: 13px; color: #16a34a; margin-bottom: 4px; }
  .amount-box .value { font-size: 28px; font-weight: bold; color: #15803d; }
  .points { background: #eff6ff; border-radius: 8px; padding: 14px 16px; font-size: 14px; color: #1d4ed8; margin-bottom: 20px; }
  .footer { background: #f8fafc; padding: 20px 24px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
  .footer a { color: #2563eb; text-decoration: none; }
</style></head>
<body>
<div class="card">
  <div class="header">
    <h1>🧾 فاتورة ذكاء الأعمال</h1>
    <p>شكراً لثقتك بنا!</p>
  </div>
  <div class="body">
    <p class="greeting">مرحباً ${user.name || 'عزيزنا'}،<br>تم استلام دفعتك بنجاح.</p>
    <div class="row"><span>رقم الفاتورة</span><span>#${invoiceNumber}</span></div>
    <div class="row"><span>التاريخ</span><span>${dateStr}</span></div>
    <div class="row"><span>الخطة</span><span>باقة دراسات الجدوى — 5 دراسات (6 أشهر)</span></div>
    <div class="row"><span>العملة</span><span>${order.currency || 'SAR'}</span></div>
    <div class="amount-box">
      <div class="label">المبلغ المدفوع</div>
      <div class="value">${amountSAR} ر.س</div>
    </div>
    <div class="points">🎉 تمت إضافة <strong>5 نقاط جدوى</strong> إلى حسابك — ابدأ دراستك الآن!</div>
  </div>
  <div class="footer">
    <p>منصة ذكاء الأعمال · <a href="https://eses.store">eses.store</a></p>
    <p>للتواصل: <a href="mailto:support@eses.store">support@eses.store</a></p>
  </div>
</div>
</body></html>`,
              }),
            });
            console.log(`📧 Invoice email sent to: ${user.email}`);
          }
        } catch (e) { console.error('[webhook] invoice/email error:', e.message); }

        console.log(`✅ Payment success: orderId=${paymobOrderId} | dbOrder=${order.id} | user=${order.user_id}`);
      } else {
        console.warn(`⚠️ Order not found: paymobOrderId=${paymobOrderId} | merchant=${merchantId}`);
      }

    } else {
      // ── تحديث الطلب إلى مرفوض ──
      await sql`
        UPDATE orders SET status = 'failed', updated_at = NOW()
        WHERE paymob_order_id = ${paymobOrderId} AND status = 'pending'
      `.catch(() => {});

      if (dbId) {
        await sql`
          UPDATE orders SET status = 'failed', updated_at = NOW()
          WHERE id = ${parseInt(dbId)} AND status = 'pending'
        `.catch(() => {});
      }

      console.log(`❌ Payment failed: orderId=${paymobOrderId}`);
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error("[webhook] error:", error.message);
    // نُرجع 200 دائماً حتى لا يُعيد Paymob المحاولة
    return res.status(200).end();
  }
}
