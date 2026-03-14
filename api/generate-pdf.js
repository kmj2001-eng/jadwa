// api/generate-pdf.js
// يستدعي Claude API لتحويل الـ markdown إلى HTML نظيف قابل للطباعة كـ PDF

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { title = 'دراسة الجدوى', markdown } = req.body || {};
  if (!markdown) return res.status(400).json({ error: 'markdown مطلوب' });

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'CLAUDE_API_KEY غير موجود' });

  const date = new Date().toLocaleDateString('ar-SA', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  const prompt = `أنت محوّل Markdown إلى HTML للطباعة. حوّل النص التالي فقط — لا تُضف أي محتوى جديد ولا تُعلّق.

المتطلبات الصارمة لصفحة HTML المُخرَجة:
- صفحة HTML مكتملة مستقلة (standalone): DOCTYPE + html + head + body
- CSS مضمّن في <style> فقط بالـ head، بدون أي stylesheets خارجية
- خلفية #ffffff بيضاء في كل مكان، نص #111111 داكن
- اتجاه RTL، lang="ar"، font-family: Arial, Tahoma, sans-serif
- h2: color:#1D4ED8; border-right:4px solid #1D4ED8; padding-right:10px; margin:22px 0 8px;
- h3: color:#1e3a8a; margin:14px 0 6px;
- p,li: color:#222; line-height:1.9;
- table: width:100%; border-collapse:collapse;
- th: background:#1D4ED8; color:#fff; padding:8px 10px; border:1px solid #93c5fd; text-align:right;
- td: padding:7px 10px; border:1px solid #ddd; text-align:right; color:#222;
- tr:nth-child(even) td: background:#f8faff;
- @page { size: A4; margin: 15mm; }
- @media print { body { -webkit-print-color-adjust:exact; } }
- رأسية الصفحة: عنوان "${title}" بـ #1D4ED8 وتاريخ "${date}"
- تذييل: "منصة ذكاء الأعمال — دراسات جدوى بالذكاء الاصطناعي"
- <script>window.onload=function(){setTimeout(function(){window.print();},600);}</script> في الـ body

نص الدراسة (Markdown):
${markdown}

أرجع كود HTML فقط بدون أي نص إضافي أو \`\`\` code blocks.`;

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 16000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Claude API error ${claudeRes.status}`);
    }

    const data = await claudeRes.json();
    let html = data.content?.[0]?.text || '';

    // إزالة code blocks إن أضافها النموذج
    html = html
      .replace(/^```html\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    return res.status(200).json({ html });

  } catch (err) {
    console.error('generate-pdf error:', err.message);
    return res.status(500).json({ error: 'فشل توليد PDF: ' + err.message });
  }
}
