export default async function handler(req, res) {
  // السماح فقط بطلبات POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'الحقل prompt مطلوب' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return res.status(response.status).json({ error: error?.error?.message || 'خطأ من Claude API' });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    return res.status(200).json({ text });

  } catch (err) {
    console.error('Claude API Error:', err);
    return res.status(500).json({ error: 'خطأ داخلي في الخادم' });
  }
}
