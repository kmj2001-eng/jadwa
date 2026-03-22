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

      if (order) {
        // ── منح 5 نقاط للمستخدم صالحة 6 أشهر (مرة واحدة) ──
        try {
          await sql`
            INSERT INTO user_points (user_id, order_id, total_points, used_points, expires_at)
            VALUES (${order.user_id}, ${order.id}, 5, 0, NOW() + INTERVAL '6 months')
            ON CONFLICT (order_id) DO NOTHING
          `;
        } catch (_) {}

        // ── إنشاء فاتورة ──
        try {
          const invoiceNumber = String(order.id).padStart(5, "0");
          await sql`
            INSERT INTO invoices (order_id, user_id, amount, currency, status, invoice_number)
            VALUES (${order.id}, ${order.user_id}, ${order.amount}, ${order.currency}, 'paid', ${invoiceNumber})
            ON CONFLICT DO NOTHING
          `;
        } catch (_) {}

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
