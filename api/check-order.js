// api/check-order.js — التحقق من حالة المعاملة مباشرة من Paymob

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET')
    return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing transaction id' });

  try {
    const API_KEY = process.env.PAYMOB_API_KEY;
    const BASE_URL = 'https://ksa.paymob.com/api';

    // ── 1. Auth Token ─────────────────────────────────────────
    const authRes  = await fetch(`${BASE_URL}/auth/tokens`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ api_key: API_KEY }),
    });
    const { token } = await authRes.json();

    // ── 2. جلب حالة المعاملة ──────────────────────────────────
    const txRes  = await fetch(
      `${BASE_URL}/acceptance/transactions/${id}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const tx = await txRes.json();

    console.log('[check-order] id:', id, '| success:', tx.success, '| pending:', tx.pending);

    // ✅ مدفوع
    if (tx.success === true && tx.pending === false) {
      return res.json({ status: 'paid', transactionId: tx.id });
    }

    // ❌ مرفوض
    if (tx.success === false && tx.pending === false) {
      return res.json({ status: 'failed', reason: tx.data?.message || 'رُفضت' });
    }

    // ⏳ قيد الانتظار
    return res.json({ status: 'pending' });

  } catch (err) {
    console.error('[check-order]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
}
