import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, Header, Footer,
  convertInchesToTwip, HeadingLevel,
} from 'docx';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { title = 'دراسة الجدوى', content = '' } = req.body;

  try {
    const children = buildDocxContent(title, content);

    const doc = new Document({
      styles: {
        default: {
          document: {
            run: { font: 'Arial', size: 22, color: '1a1a2e' },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              margin: {
                top:    convertInchesToTwip(1.1),
                right:  convertInchesToTwip(1.2),
                bottom: convertInchesToTwip(1.1),
                left:   convertInchesToTwip(1.2),
              },
            },
          },
          headers: {
            default: new Header({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: 'ذكاء الأعمال — دراسات الجدوى الاستثمارية بالذكاء الاصطناعي',
                      size: 16,
                      color: '3B82F6',
                      font: 'Arial',
                    }),
                  ],
                  alignment: AlignmentType.RIGHT,
                  border: {
                    bottom: { style: BorderStyle.SINGLE, size: 4, color: 'BFDBFE' },
                  },
                }),
              ],
            }),
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: 'منصة ذكاء الأعمال  ·  eses.store',
                      size: 16,
                      color: '999999',
                      font: 'Arial',
                    }),
                  ],
                  alignment: AlignmentType.CENTER,
                  border: {
                    top: { style: BorderStyle.SINGLE, size: 4, color: 'C7D2FE' },
                  },
                }),
              ],
            }),
          },
          children,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const safeTitle = title.replace(/[^\u0600-\u06FFa-zA-Z0-9\s\-_]/g, '').trim() || 'study';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeTitle)}.docx`);
    res.setHeader('Content-Length', buffer.length);
    return res.status(200).end(buffer);
  } catch (err) {
    console.error('DOCX Generation Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ════════════════════════════════
// بناء محتوى ملف الـ DOCX
// ════════════════════════════════
function buildDocxContent(title, html) {
  const children = [];
  const dateStr = new Date().toLocaleDateString('ar-SA', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // ── صفحة الغلاف ──
  children.push(
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 52, color: '1D4ED8', font: 'Arial' })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 800, after: 240 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `أُعدَّت بواسطة منصة ذكاء الأعمال · ${dateStr}`, size: 20, color: '777777', font: 'Arial' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
    }),
    // خط فاصل
    new Paragraph({
      children: [],
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '3B82F6' } },
      spacing: { after: 480 },
    }),
  );

  // ── تحليل HTML وتحويله لعناصر docx ──
  parseHtmlToDocx(html, children);

  // ── تذييل الدراسة ──
  children.push(
    new Paragraph({
      children: [new TextRun({ text: '', size: 22 })],
      spacing: { before: 800 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: '— نهاية الدراسة — منصة ذكاء الأعمال',
          size: 18, color: '999999', font: 'Arial',
        }),
      ],
      alignment: AlignmentType.CENTER,
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'C7D2FE' } },
      spacing: { before: 400 },
    }),
  );

  return children;
}

function parseHtmlToDocx(html, children) {
  // تنظيف HTML أولاً
  let text = html
    .replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  // استخراج الجداول وتحويلها (قبل أي replace آخر)
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  const tablePositions = [];
  let tMatch;
  while ((tMatch = tableRegex.exec(text)) !== null) {
    tablePositions.push({ start: tMatch.index, end: tMatch.index + tMatch[0].length, html: tMatch[0] });
  }

  // تقسيم النص إلى أجزاء (جداول وغيرها)
  const parts = [];
  let lastIdx = 0;
  for (const tPos of tablePositions) {
    if (tPos.start > lastIdx) {
      parts.push({ type: 'html', content: text.slice(lastIdx, tPos.start) });
    }
    parts.push({ type: 'table', content: tPos.html });
    lastIdx = tPos.end;
  }
  if (lastIdx < text.length) {
    parts.push({ type: 'html', content: text.slice(lastIdx) });
  }

  for (const part of parts) {
    if (part.type === 'table') {
      const tableEl = buildTable(part.content);
      if (tableEl) {
        children.push(tableEl);
        children.push(new Paragraph({ text: '', spacing: { after: 200 } }));
      }
    } else {
      parseTextHtml(part.content, children);
    }
  }
}

function parseTextHtml(html, children) {
  // h2
  html = html.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => {
    children.push(new Paragraph({
      children: [new TextRun({ text: stripTags(t), bold: true, size: 32, color: '1D4ED8', font: 'Arial' })],
      alignment: AlignmentType.RIGHT,
      spacing: { before: 480, after: 180 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'BFDBFE' } },
    }));
    return '';
  });

  // h3
  html = html.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => {
    children.push(new Paragraph({
      children: [new TextRun({ text: stripTags(t), bold: true, size: 26, color: '1e3a8a', font: 'Arial' })],
      alignment: AlignmentType.RIGHT,
      spacing: { before: 280, after: 120 },
    }));
    return '';
  });

  // h4
  html = html.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, t) => {
    children.push(new Paragraph({
      children: [new TextRun({ text: stripTags(t), bold: true, size: 22, color: '1e3a8a', font: 'Arial' })],
      alignment: AlignmentType.RIGHT,
      spacing: { before: 200, after: 100 },
    }));
    return '';
  });

  // ul
  html = html.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, ulContent) => {
    const liMatches = ulContent.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
    liMatches.forEach(li => {
      const liText = stripTags(li);
      if (liText.trim()) {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: '• ', bold: true, color: '3B82F6', font: 'Arial', size: 22 }),
            new TextRun({ text: liText.trim(), size: 22, font: 'Arial' }),
          ],
          alignment: AlignmentType.RIGHT,
          indent: { right: 360 },
          spacing: { after: 80 },
        }));
      }
    });
    return '';
  });

  // ol
  html = html.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, olContent) => {
    const liMatches = olContent.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
    liMatches.forEach((li, idx) => {
      const liText = stripTags(li);
      if (liText.trim()) {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: `${idx + 1}. `, bold: true, color: '3B82F6', font: 'Arial', size: 22 }),
            new TextRun({ text: liText.trim(), size: 22, font: 'Arial' }),
          ],
          alignment: AlignmentType.RIGHT,
          indent: { right: 360 },
          spacing: { after: 80 },
        }));
      }
    });
    return '';
  });

  // strong داخل p (inline)
  // p
  html = html.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => {
    const pText = stripTags(t);
    if (pText.trim()) {
      children.push(new Paragraph({
        children: buildInlineRuns(t),
        alignment: AlignmentType.RIGHT,
        spacing: { after: 120 },
      }));
    }
    return '';
  });

  // النص المتبقي بعد إزالة العلامات
  const remaining = stripTags(html).trim();
  if (remaining) {
    remaining.split('\n').forEach(line => {
      const l = line.trim();
      if (l) {
        children.push(new Paragraph({
          children: [new TextRun({ text: l, size: 22, font: 'Arial' })],
          alignment: AlignmentType.RIGHT,
          spacing: { after: 100 },
        }));
      }
    });
  }
}

function buildInlineRuns(html) {
  const runs = [];
  // تقسيم النص بناءً على وسوم strong/b
  const parts = html.split(/(<strong[^>]*>[\s\S]*?<\/strong>|<b[^>]*>[\s\S]*?<\/b>)/gi);
  for (const part of parts) {
    const isBold = /^<(strong|b)[^>]*>/i.test(part);
    const text = stripTags(part);
    if (text.trim()) {
      runs.push(new TextRun({
        text,
        bold: isBold,
        size: 22,
        font: 'Arial',
        color: isBold ? '1D4ED8' : '1a1a2e',
      }));
    }
  }
  return runs.length ? runs : [new TextRun({ text: stripTags(html), size: 22, font: 'Arial' })];
}

function buildTable(tableHtml) {
  const rows = [];
  const trMatches = tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];

  for (let rowIdx = 0; rowIdx < trMatches.length; rowIdx++) {
    const trHtml = trMatches[rowIdx];
    const isHeaderRow = /<th[^>]*>/i.test(trHtml);
    const cellMatches = trHtml.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi) || [];

    if (!cellMatches.length) continue;

    const cells = cellMatches.map(cellHtml => {
      const cellText = stripTags(cellHtml).trim();
      return new TableCell({
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: cellText,
                bold: isHeaderRow,
                size: 18,
                font: 'Arial',
                color: isHeaderRow ? 'FFFFFF' : '1a1a2e',
              }),
            ],
            alignment: AlignmentType.RIGHT,
          }),
        ],
        shading: isHeaderRow
          ? { fill: '1D4ED8', type: ShadingType.SOLID }
          : rowIdx % 2 === 0
            ? { fill: 'EFF6FF', type: ShadingType.SOLID }
            : { fill: 'FFFFFF', type: ShadingType.SOLID },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        borders: {
          top:    { style: BorderStyle.SINGLE, size: 4, color: 'BFDBFE' },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: 'BFDBFE' },
          left:   { style: BorderStyle.SINGLE, size: 4, color: 'BFDBFE' },
          right:  { style: BorderStyle.SINGLE, size: 4, color: 'BFDBFE' },
        },
      });
    });

    rows.push(new TableRow({ children: cells, cantSplit: true }));
  }

  if (!rows.length) return null;

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:          { style: BorderStyle.SINGLE, size: 8,  color: '1D4ED8' },
      bottom:       { style: BorderStyle.SINGLE, size: 8,  color: '1D4ED8' },
      left:         { style: BorderStyle.SINGLE, size: 8,  color: '1D4ED8' },
      right:        { style: BorderStyle.SINGLE, size: 8,  color: '1D4ED8' },
      insideH:      { style: BorderStyle.SINGLE, size: 4,  color: 'BFDBFE' },
      insideV:      { style: BorderStyle.SINGLE, size: 4,  color: 'BFDBFE' },
    },
  });
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}
