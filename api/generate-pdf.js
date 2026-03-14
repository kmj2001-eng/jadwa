// api/generate-pdf.js
// يستدعي Claude API لتحويل الـ markdown إلى HTML نظيف قابل للطباعة
// إذا لم يتوفر CLAUDE_API_KEY يستخدم محوّل محلي احتياطي

// ── محوّل Markdown → HTML محلي (fallback) ──────────────────────────
function mdToHtmlLocal(md) {
  if (!md) return '';
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // جداول HTML الأصلية (حفظها كما هي بعد إعادة رموز <> )
  const tables = [];
  html = html.replace(/&lt;table[\s\S]*?&lt;\/table&gt;/gi, m => {
    const idx = tables.length;
    tables.push(
      m
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
    );
    return `%%TABLE_${idx}%%`;
  });

  // عناوين
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // تنسيق نص
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // قوائم
  html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>)(\n(?!<li>)|$)/g, '$1\n');
  // لف li بـ ul
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, m => `<ul>${m}</ul>\n`);

  // فقرات
  html = html.replace(/\n{2,}/g, '\n</p><p>\n');
  html = html.replace(/^(?!<[hul%]|<\/)/gm, '');

  // إرجاع الجداول
  tables.forEach((t, i) => {
    html = html.replace(`%%TABLE_${i}%%`, t);
  });

  return '<p>' + html.trim() + '</p>';
}

// ── بناء صفحة HTML كاملة للطباعة ───────────────────────────────────
function buildPrintPage(title, bodyHtml, date) {
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  @page{size:A4;margin:15mm;}
  @media print{
    body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .no-print{display:none!important;}
  }
  body{
    background:#fff;color:#111;
    font-family:Arial,Tahoma,"Segoe UI",sans-serif;
    font-size:13px;line-height:1.9;
    direction:rtl;padding:20px 40px;
  }
  .page-header{
    text-align:center;border-bottom:3px solid #1D4ED8;
    padding-bottom:16px;margin-bottom:24px;
  }
  .page-header h1{font-size:22px;font-weight:800;color:#1D4ED8;margin-bottom:4px;}
  .page-header .sub{font-size:11px;color:#555;}
  h2{
    color:#1D4ED8;font-size:16px;font-weight:800;
    margin:24px 0 8px;border-right:4px solid #1D4ED8;
    padding-right:10px;page-break-after:avoid;
  }
  h3{color:#1e3a8a;font-size:14px;font-weight:700;margin:16px 0 6px;page-break-after:avoid;}
  h1{color:#1D4ED8;font-size:18px;font-weight:800;margin:20px 0 8px;}
  p{color:#222;margin:5px 0 8px;}
  ul,ol{padding-right:22px;margin:6px 0;}
  li{color:#222;margin:3px 0;}
  strong,b{color:#111;font-weight:700;}
  em,i{color:#333;font-style:italic;}
  table{
    width:100%;border-collapse:collapse;
    margin:14px 0;font-size:12px;
    page-break-inside:avoid;
  }
  th{
    background:#1D4ED8!important;color:#fff!important;
    padding:8px 10px;border:1px solid #93c5fd;
    text-align:right;font-weight:700;
  }
  td{padding:7px 10px;border:1px solid #ddd;text-align:right;color:#222;}
  tr:nth-child(even) td{background:#f0f7ff!important;}
  .footer{
    margin-top:30px;border-top:1px solid #dde3f5;
    padding-top:10px;text-align:center;
    color:#888;font-size:11px;
  }
  .print-btn{
    position:fixed;top:16px;left:16px;
    background:#1D4ED8;color:#fff;border:none;
    padding:10px 20px;border-radius:8px;
    font-size:14px;cursor:pointer;font-family:inherit;
    box-shadow:0 4px 12px rgba(29,78,216,.4);
    z-index:999;
  }
  .print-btn:hover{background:#1e40af;}
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">🖨️ طباعة / حفظ PDF</button>

<div class="page-header">
  <h1>${title}</h1>
  <div class="sub">أُعدَّت بواسطة منصة ذكاء الأعمال · ${date}</div>
</div>

<div class="content">
${bodyHtml}
</div>

<div class="footer">منصة ذكاء الأعمال — دراسات جدوى بالذكاء الاصطناعي · www.eses.store</div>

<script>
  // طباعة تلقائية بعد تحميل الصفحة
  window.addEventListener('load', function(){
    setTimeout(function(){ window.print(); }, 800);
  });
</script>
</body>
</html>`;
}

// ── Handler الرئيسي ─────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { title = 'دراسة الجدوى', markdown } = req.body || {};
  if (!markdown) return res.status(400).json({ error: 'markdown مطلوب' });

  const date = new Date().toLocaleDateString('ar-SA', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  const apiKey = process.env.CLAUDE_API_KEY;

  // ── المسار الأول: Claude API ────────────────────────────────────
  if (apiKey) {
    try {
      const prompt = `أنت محوّل Markdown إلى HTML للطباعة. حوّل النص التالي فقط — لا تُضف محتوى جديداً.

المتطلبات:
- HTML5 كامل مستقل: DOCTYPE + html + head + body
- CSS مضمّن في <style> فقط
- خلفية #ffffff، نص #111111
- RTL، lang="ar"، font-family: Arial,Tahoma,sans-serif
- h2: color:#1D4ED8; border-right:4px solid #1D4ED8; padding-right:10px
- h3: color:#1e3a8a
- th: background:#1D4ED8; color:#fff
- tr:nth-child(even) td: background:#f0f7ff
- @page{size:A4;margin:15mm}
- @media print{body{-webkit-print-color-adjust:exact}}
- زر طباعة أعلى اليسار class="no-print" مخفي عند الطباعة
- <script>window.onload=function(){setTimeout(function(){window.print();},800);}</script>
- رأسية تحتوي العنوان: "${title}" وتاريخ "${date}"
- تذييل: "منصة ذكاء الأعمال — www.eses.store"

نص الدراسة:
${markdown}

أرجع HTML فقط بدون أي نص إضافي أو code blocks.`;

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

      if (claudeRes.ok) {
        const data = await claudeRes.json();
        let html = data.content?.[0]?.text || '';
        html = html.replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
        if (html && html.includes('<body')) {
          return res.status(200).json({ html, source: 'claude' });
        }
      }
    } catch (_) {
      // fall through to local conversion
    }
  }

  // ── المسار الثاني: محوّل محلي (fallback) ────────────────────────
  const bodyHtml = mdToHtmlLocal(markdown);
  const html = buildPrintPage(title, bodyHtml, date);
  return res.status(200).json({ html, source: 'local' });
}
