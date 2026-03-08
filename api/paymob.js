// api/paymob.js — Vercel Serverless Function
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { amount, currency = 'SAR', orderId, customer } = req.body;

  if (!amount || !orderId) {
    return res.status(400).json({ error: 'amount و orderId مطلوبان' });
  }

  const API_KEY        = process.env.PAYMOB_API_KEY;
  const INTEGRATION_ID = process.env.PAYMOB_INTEGRATION_ID;
  const IFRAME_ID      = process.env.PAYMOB_IFRAME_ID;

  try {
    // ── الخطوة 1: Authentication ──
    const authRes = await fetch('https://ksa.paymob.com/api/auth/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: API_KEY }),
    });
    if (!authRes.ok) {
      const e = await authRes.json();
      throw new Error('Authentication فشل: ' + JSON.stringify(e));
    }
    const { token: authToken } = await authRes.json();

    // ── الخطوة 2: Order Registration ──
    const orderRes = await fetch('https://ksa.paymob.com/api/ecommerce/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authToken,
        delivery_needed: false,
        amount_cents: amount,
        currency,
        merchant_order_id: orderId,
        items: [],
      }),
    });
    if (!orderRes.ok) {
      const e = await orderRes.json();
      throw new Error('Order Registration فشل: ' + JSON.stringify(e));
    }
    const { id: paymobOrderId } = await orderRes.json();

    // ── الخطوة 3: Payment Key ──
    const payKeyRes = await fetch('https://ksa.paymob.com/api/acceptance/payment_keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authToken,
        amount_cents: amount,
        expiration: 3600,
        order_id: paymobOrderId,
        currency,
        integration_id: Number(INTEGRATION_ID),
        billing_data: {
          first_name:      customer?.firstName  || 'Guest',
          last_name:       customer?.lastName   || 'User',
          email:           customer?.email      || 'guest@example.com',
          phone_number:    customer?.phone      || '+966500000000',
          apartment:       'NA',
          floor:           'NA',
          street:          'NA',
          building:        'NA',
          shipping_method: 'NA',
          postal_code:     'NA',
          city:            'NA',
          country:         'SA',
          state:           'NA',
        },
      }),
    });
    if (!payKeyRes.ok) {
      const e = await payKeyRes.json();
      throw new Error('Payment Key فشل: ' + JSON.stringify(e));
    }
    const { token: paymentKey } = await payKeyRes.json();

    return res.status(200).json({
      iframeUrl: `https://ksa.paymob.com/api/acceptance/iframes/${IFRAME_ID}?payment_token=${paymentKey}`,
      paymentKey,
      paymobOrderId,
    });

  } catch (err) {
    console.error('Paymob Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
