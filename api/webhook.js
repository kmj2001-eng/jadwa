import crypto from 'crypto';

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
          const invoiceNumber = 'INV-' + Date.now();

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
