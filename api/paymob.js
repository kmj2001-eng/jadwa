// api/paymob.js — Paymob KSA Direct Charge
// POST /api/paymob        → إنشاء جلسة دفع + Direct Charge
// GET  /api/paymob?id=TX  → التحقق من حالة المعاملة (مدمج من check-order)
import { neon } from '@neondatabase/serverless';

const BASE_URL = 'https://ksa.paymob.com/api';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-user-id');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: التحقق من حالة المعاملة (check-order مدمج) ──────
  if (req.method === 'GET') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing transaction id' });
    try {
      const API_KEY = process.env.PAYMOB_API_KEY;
      const authRes = await fetch(`${BASE_URL}/auth/tokens`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ api_key: API_KEY }),
      });
      const { token } = await authRes.json();
      const txRes = await fetch(`${BASE_URL}/acceptance/transactions/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const tx = await txRes.json();
      console.log('[check] id:', id, '| success:', tx.success, '| pending:', tx.pending);
      if (tx.success === true  && tx.pending === false)
        return res.json({ status: 'paid',    transactionId: tx.id });
      if (tx.success === false && tx.pending === false)
        return res.json({ status: 'failed',  reason: tx.data?.message });
      return res.json({ status: 'pending' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' });

  const API_KEY        = process.env.PAYMOB_API_KEY;
  const INTEGRATION_ID = process.env.PAYMOB_INTEGRATION_ID;

  if (!API_KEY || !INTEGRATION_ID) {
    return res.status(500).json({ error: 'إعدادات Paymob ناقصة' });
  }

  try {
    const { card, amount = 100 } = req.body || {};  // 100 هللة = 1 ر.س (اختبار مؤقت)
    const currency = 'SAR';
    const userId   = parseInt(req.headers['x-user-id']) || null;

    // ── حفظ الطلب في DB (اختياري) ────────────────────────────
    let dbOrderId = null;
    try {
      if (process.env.POSTGRES_URL && userId) {
        const sql = neon(process.env.POSTGRES_URL);
        const rows = await sql`
          INSERT INTO orders (user_id, amount, currency, status)
          VALUES (${userId}, ${amount}, ${currency}, 'pending')
          RETURNING id
        `;
        dbOrderId = rows[0]?.id;
      }
    } catch (_) { /* DB اختياري */ }

    const merchantOrderId = dbOrderId
      ? `jadwa_${dbOrderId}_${Date.now()}`
      : `jadwa_guest_${Date.now()}`;

    // ── 1. Auth Token ─────────────────────────────────────────
    const authRes  = await fetch(`${BASE_URL}/auth/tokens`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ api_key: API_KEY }),
    });
    const { token } = await authRes.json();
    if (!token) throw new Error('فشل Auth Token من Paymob');

    // ── 2. Create Order ───────────────────────────────────────
    const orderRes  = await fetch(`${BASE_URL}/ecommerce/orders`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        auth_token:        token,
        delivery_needed:   false,
        amount_cents:      amount,
        currency,
        merchant_order_id: merchantOrderId,
        items: [],
      }),
    });
    const orderData     = await orderRes.json();
    const paymobOrderId = String(orderData.id || '');
    if (!paymobOrderId) throw new Error('فشل إنشاء Order في Paymob');

    // احفظ paymob_order_id في DB حتى يجده الـ webhook
    try {
      if (dbOrderId && process.env.POSTGRES_URL) {
        const sql = neon(process.env.POSTGRES_URL);
        await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS paymob_order_id TEXT`;
        await sql`UPDATE orders SET paymob_order_id = ${paymobOrderId} WHERE id = ${dbOrderId}`;
      }
    } catch (_) {}

    // ── 3. Payment Key ────────────────────────────────────────
    const pkRes  = await fetch(`${BASE_URL}/acceptance/payment_keys`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        auth_token:     token,
        amount_cents:   amount,
        expiration:     3600,
        order_id:       orderData.id,
        currency,
        integration_id: Number(INTEGRATION_ID),
        billing_data: {
          first_name:   'User',
          last_name:    'Test',
          email:        'test@email.com',
          phone_number: '+966500000000',
          apartment: 'NA', floor:    'NA',
          street:    'NA', building: 'NA',
          city: 'Riyadh', country: 'SA', state: 'NA',
        },
      }),
    });
    const pkData     = await pkRes.json();
    const paymentKey = pkData.token;
    if (!paymentKey) throw new Error('فشل الحصول على Payment Key');

    // ── 4. Direct Charge ──────────────────────────────────────
    if (!card?.number) {
      return res.status(400).json({ error: 'بيانات البطاقة مفقودة' });
    }

    const [expMonth, expYear] = card.expiry.split('/');

    const chargeRes  = await fetch(`${BASE_URL}/acceptance/payments/pay`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        source: {
          identifier:        card.number.replace(/\s/g, ''),
          sourceholder_name: card.name || 'Card Holder',
          subtype:           'CARD',
          expiry_month:      expMonth.trim(),
          expiry_year:       expYear.trim(),   // رقمان فقط: "27" وليس "2027"
          cvn:               card.cvv,
        },
        payment_token: paymentKey,
      }),
    });
    const charge = await chargeRes.json();
    console.log('[paymob] charge success:', charge.success, '| pending:', charge.pending);

    // ── ابحث عن redirect_url في كل الحقول الممكنة (3DS / MIGS) ──
    const url3ds = charge.redirect_url
                || charge.redirection_url
                || charge?.data?.redirect_url
                || charge?.data?.redirection_url
                || charge?.data?.url
                || charge?.data?.three_d_secure_url;

    console.log('[paymob] 3DS url:', url3ds || 'NONE');

    // ✅ نجح الدفع فوراً
    if (charge.success === true) {
      try {
        if (dbOrderId && process.env.POSTGRES_URL) {
          const sql = neon(process.env.POSTGRES_URL);

          // تحديث الطلب + حفظ paymob_order_id
          await sql`
            UPDATE orders
            SET status = 'paid', paymob_order_id = ${paymobOrderId}
            WHERE id = ${dbOrderId}
          `;

          // ── إضافة 5 نقاط للمستخدم (صالحة 6 أشهر) ──
          const order = await sql`SELECT user_id FROM orders WHERE id = ${dbOrderId} LIMIT 1`;
          if (order[0]?.user_id) {
            await sql`
              INSERT INTO user_points (user_id, order_id, total_points, used_points, expires_at)
              VALUES (${order[0].user_id}, ${dbOrderId}, 5, 0, NOW() + INTERVAL '6 months')
              ON CONFLICT (order_id) DO NOTHING
            `;
          }
        }
      } catch (e) { console.error('[paymob] points error:', e.message); }
      return res.json({ success: true, transactionId: String(charge.id) });
    }

    // 🔐 يحتاج 3DS — إذا وُجد redirect_url أو كان pending: true
    if (url3ds || charge.pending === true) {
      console.log('[paymob] 3DS required, url:', url3ds);
      return res.json({
        pending:       true,
        redirectUrl:   url3ds || null,
        transactionId: String(charge.id),
      });
    }

    // ❌ رُفضت البطاقة
    const reason = charge?.data?.message
                || charge?.data?.reject_reason_message_ar
                || charge?.data?.reject_reason_message
                || charge?.data?.txn_response_code
                || charge?.txn_response_code
                || charge?.message
                || charge?.detail
                || 'رُفضت البطاقة';

    return res.status(400).json({ error: reason });

  } catch (err) {
    console.error('[paymob] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
