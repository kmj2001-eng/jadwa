// api/paymob.js — Paymob SA Integration (ksa.paymob.com)
import { neon } from '@neondatabase/serverless';

const BASE = 'https://ksa.paymob.com/api';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-user-id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // ── متغيرات البيئة ──────────────────────────────────────────
  const API_KEY        = process.env.PAYMOB_API_KEY;
  const INTEGRATION_ID = process.env.PAYMOB_INTEGRATION_ID;
  const IFRAME_ID      = process.env.PAYMOB_IFRAME_ID;
  const HMAC_SECRET    = process.env.PAYMOB_HMAC_SECRET;
  const SITE_URL       = (process.env.SITE_URL || 'https://eses.store').replace(/\/$/, '');

  if (!API_KEY || !INTEGRATION_ID || !IFRAME_ID) {
    console.error('Paymob env missing:', { API_KEY: !!API_KEY, INTEGRATION_ID: !!INTEGRATION_ID, IFRAME_ID: !!IFRAME_ID });
    return res.status(500).json({ error: 'إعدادات Paymob ناقصة في بيئة الخادم' });
  }

  // ── بيانات الطلب ─────────────────────────────────────────────
  const { customer } = req.body || {};
  const amount   = 4999;     // 49.99 ر.س بالهللات
  const currency = 'SAR';
  const plan     = 'basic';  // الباقة الأساسية: 5 دراسات / 6 أشهر

  const userId = parseInt(req.headers['x-user-id']) || null;

  let sql       = null;
  let dbOrderId = null;

  try {

    // ── 0. حفظ الطلب في قاعدة البيانات (pending) ─────────────
    if (process.env.POSTGRES_URL && userId) {
      sql = neon(process.env.POSTGRES_URL);

      // migration آمن — يضيف عمود plan إن لم يكن موجوداً
      try {
        await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'basic'`;
      } catch (_) {}

      const dbRows = await sql`
        INSERT INTO orders (user_id, amount, currency, status, plan)
        VALUES (${userId}, ${amount}, ${currency}, 'pending', ${plan})
        RETURNING id
      `;
      dbOrderId = dbRows[0]?.id;
    }

    // merchant_order_id يتضمن معرّف DB ليربطهما الـ webhook
    const merchantOrderId = dbOrderId
      ? `jadwa_${dbOrderId}_${Date.now()}`
      : `jadwa_guest_${Date.now()}`;

    // ── 1. Authentication Token ──────────────────────────────
    const authRes = await fetch(`${BASE}/auth/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: API_KEY }),
    });
    if (!authRes.ok) {
      const txt = await authRes.text();
      throw new Error(`Paymob Auth فشل (${authRes.status}): ${txt}`);
    }
    const { token: authToken } = await authRes.json();

    // ── 2. Order Registration ────────────────────────────────
    const orderBody = {
      auth_token:        authToken,
      delivery_needed:   false,
      amount_cents:      amount,
      currency,
      merchant_order_id: merchantOrderId,
      items: [
        {
          name:          'باقة دراسات الجدوى — 5 دراسات',
          amount_cents:  amount,
          description:   'باقة 5 دراسات جدوى بالذكاء الاصطناعي، صالحة 6 أشهر',
          quantity:      1,
        },
      ],
    };

    const orderRes = await fetch(`${BASE}/ecommerce/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderBody),
    });
    if (!orderRes.ok) {
      const e = await orderRes.json();
      throw new Error(`Order Registration فشل (${orderRes.status}): ${JSON.stringify(e)}`);
    }
    const paymobOrder = await orderRes.json();
    const paymobOrderId = paymobOrder.id?.toString();

    // ربط معرّف Paymob بسجل DB
    if (sql && dbOrderId) {
      await sql`
        UPDATE orders
        SET paymob_order_id = ${paymobOrderId}, updated_at = NOW()
        WHERE id = ${dbOrderId}
      `;
    }

    // ── 3. Payment Key ────────────────────────────────────────
    // بيانات بيلينج — Paymob يشترطها حتى لو كانت placeholder
    const billing = {
      first_name:      (customer?.firstName  || 'عميل').slice(0, 50),
      last_name:       (customer?.lastName   || 'جديد').slice(0, 50),
      email:           customer?.email       || 'guest@eses.store',
      phone_number:    (customer?.phone      || '+966500000000').replace(/\s/g, ''),
      apartment:       'NA',
      floor:           'NA',
      street:          'NA',
      building:        'NA',
      shipping_method: 'NA',
      postal_code:     'NA',
      city:            'Riyadh',
      country:         'SA',
      state:           'Riyadh',
    };

    const payKeyBody = {
      auth_token:       authToken,
      amount_cents:     amount,
      expiration:       3600,
      order_id:         paymobOrderId,
      currency,
      integration_id:   Number(INTEGRATION_ID),
      billing_data:     billing,
      // إعادة التوجيه بعد الدفع خارج iframe — Paymob يُضيف ?success=true&id=...
      redirect_url:     `${SITE_URL}/`,
    };

    const payKeyRes = await fetch(`${BASE}/acceptance/payment_keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payKeyBody),
    });
    if (!payKeyRes.ok) {
      const e = await payKeyRes.json();
      throw new Error(`Payment Key فشل (${payKeyRes.status}): ${JSON.stringify(e)}`);
    }
    const { token: paymentKey } = await payKeyRes.json();

    const iframeUrl = `${BASE}/acceptance/iframes/${IFRAME_ID}?payment_token=${paymentKey}`;

    return res.status(200).json({
      iframeUrl,
      paymentKey,
      paymobOrderId,
      ourOrderId: dbOrderId,
      amount,
      currency,
    });

  } catch (err) {
    console.error('Paymob Integration Error:', err.message);

    // تعليم الطلب بالفشل في DB
    if (sql && dbOrderId) {
      sql`UPDATE orders SET status = 'failed', updated_at = NOW() WHERE id = ${dbOrderId}`.catch(() => {});
    }

    return res.status(500).json({ error: err.message || 'خطأ في بوابة الدفع' });
  }
}
