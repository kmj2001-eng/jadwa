import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, Header, Footer,
  convertInchesToTwip,
} from 'docx';
import ExcelJS from 'exceljs';

// ── مساعد: فقرة RTL عربية ─────────────────────────────────
function rPara(options) {
  return new Paragraph({
    ...options,
    bidirectional: true,
    alignment: options.alignment ?? AlignmentType.RIGHT,
  });
}

// ── مساعد: نص عربي (بلا خطوط حمراء + RTL) ───────────────
function aRun(options) {
  return new TextRun({
    font: 'Arial',
    ...options,
    rightToLeft: true,
    noProofChecking: true,
    language: { value: 'ar-SA', eastAsia: 'ar-SA' },
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { title = 'دراسة الجدوى', content = '', format = 'docx', meta = {} } = req.body;

  // ── توليد Excel إذا طُلب ──
  if (format === 'xlsx') {
    return generateXlsx(req, res, title, content, meta);
  }

  try {
    const children = buildDocxContent(title, content);

    const doc = new Document({
      // ── إعدادات اللغة الافتراضية ──
      styles: {
        default: {
          document: {
            run: {
              font: 'Arial',
              size: 22,
              color: '1a1a2e',
              rightToLeft: true,
              noProofChecking: true,
              language: { value: 'ar-SA', eastAsia: 'ar-SA' },
            },
            paragraph: {
              bidirectional: true,
              alignment: AlignmentType.RIGHT,
            },
          },
        },
      },

      sections: [
        {
          properties: {
            // ── RTL على مستوى القسم ──
            bidi: true,
            page: {
              // ── هوامش A4 قياسية ──
              margin: {
                top:    convertInchesToTwip(1.0),
                bottom: convertInchesToTwip(1.0),
                right:  convertInchesToTwip(1.18),  // 3cm
                left:   convertInchesToTwip(1.18),
                header: convertInchesToTwip(0.5),
                footer: convertInchesToTwip(0.5),
              },
            },
          },

          headers: {
            default: new Header({
              children: [
                rPara({
                  children: [
                    aRun({
                      text: 'ذكاء الأعمال — دراسات الجدوى الاستثمارية',
                      size: 16,
                      color: '3B82F6',
                    }),
                  ],
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
                rPara({
                  children: [
                    aRun({
                      text: 'منصة ذكاء الأعمال  ·  eses.store',
                      size: 16,
                      color: '999999',
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
    const safeTitle = title
      .replace(/[^\u0600-\u06FFa-zA-Z0-9\s\-_]/g, '')
      .trim() || 'study';

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(safeTitle)}.docx`,
    );
    res.setHeader('Content-Length', buffer.length);
    return res.status(200).end(buffer);

  } catch (err) {
    console.error('DOCX Generation Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ════════════════════════════════════════════════════════════
// بناء محتوى الملف
// ════════════════════════════════════════════════════════════
function buildDocxContent(title, html) {
  const children = [];
  const dateStr = new Date().toLocaleDateString('ar-SA', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // ── صفحة الغلاف ─────────────────────────────────────────
  children.push(
    rPara({
      children: [aRun({ text: title, bold: true, size: 52, color: '1D4ED8' })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 1200, after: 300 },
    }),
    rPara({
      children: [aRun({ text: 'دراسة جدوى استثمارية شاملة', size: 24, color: '475569' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
    }),
    rPara({
      children: [aRun({ text: 'ذكاء الأعمال لدراسات الجدوى الاقتصادية', size: 20, color: '3B82F6' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    // خط فاصل أزرق
    rPara({
      children: [],
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: '3B82F6' } },
      spacing: { after: 200 },
    }),
    rPara({
      children: [aRun({ text: `📅 تاريخ الإصدار: ${dateStr}`, size: 18, color: '94A3B8' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 480 },
    }),
    // فاصل صفحة
    rPara({
      children: [aRun({ text: '', size: 22 })],
      pageBreakBefore: true,
      spacing: { after: 0 },
    }),
  );

  // ── محتوى الدراسة ───────────────────────────────────────
  parseHtmlToDocx(html, children);

  // ── نهاية الدراسة ───────────────────────────────────────
  children.push(
    rPara({
      children: [aRun({ text: '', size: 22 })],
      spacing: { before: 800 },
    }),
    rPara({
      children: [
        aRun({ text: '— نهاية الدراسة —  منصة ذكاء الأعمال  ·  eses.store', size: 18, color: '94A3B8' }),
      ],
      alignment: AlignmentType.CENTER,
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'C7D2FE' } },
      spacing: { before: 400 },
    }),
  );

  return children;
}

// ════════════════════════════════════════════════════════════
// تحليل HTML وتحويله لعناصر DOCX
// ════════════════════════════════════════════════════════════
function parseHtmlToDocx(html, children) {
  let text = html
    .replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  // ── استخراج الجداول أولاً ──
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  const tablePositions = [];
  let tMatch;
  while ((tMatch = tableRegex.exec(text)) !== null) {
    tablePositions.push({
      start: tMatch.index,
      end: tMatch.index + tMatch[0].length,
      html: tMatch[0],
    });
  }

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
        children.push(rPara({ children: [aRun({ text: '' })], spacing: { after: 200 } }));
      }
    } else {
      parseTextHtml(part.content, children);
    }
  }
}

function parseTextHtml(html, children) {
  // h2
  html = html.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => {
    children.push(rPara({
      children: [aRun({ text: stripTags(t), bold: true, size: 30, color: '1D4ED8' })],
      spacing: { before: 480, after: 180 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BFDBFE' } },
    }));
    return '';
  });

  // h3
  html = html.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => {
    children.push(rPara({
      children: [aRun({ text: stripTags(t), bold: true, size: 26, color: '1e3a8a' })],
      spacing: { before: 280, after: 120 },
    }));
    return '';
  });

  // h4
  html = html.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, t) => {
    children.push(rPara({
      children: [aRun({ text: stripTags(t), bold: true, size: 22, color: '374151' })],
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
        children.push(rPara({
          children: [
            aRun({ text: '• ', bold: true, color: '3B82F6', size: 22 }),
            aRun({ text: liText.trim(), size: 22 }),
          ],
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
        children.push(rPara({
          children: [
            aRun({ text: `${idx + 1}. `, bold: true, color: '3B82F6', size: 22 }),
            aRun({ text: liText.trim(), size: 22 }),
          ],
          indent: { right: 360 },
          spacing: { after: 80 },
        }));
      }
    });
    return '';
  });

  // p
  html = html.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => {
    const pText = stripTags(t);
    if (pText.trim()) {
      children.push(rPara({
        children: buildInlineRuns(t),
        spacing: { after: 120 },
      }));
    }
    return '';
  });

  // النص المتبقي
  const remaining = stripTags(html).trim();
  if (remaining) {
    remaining.split('\n').forEach(line => {
      const l = line.trim();
      if (l) {
        children.push(rPara({
          children: [aRun({ text: l, size: 22 })],
          spacing: { after: 100 },
        }));
      }
    });
  }
}

function buildInlineRuns(html) {
  const runs = [];
  const parts = html.split(/(<strong[^>]*>[\s\S]*?<\/strong>|<b[^>]*>[\s\S]*?<\/b>)/gi);
  for (const part of parts) {
    const isBold = /^<(strong|b)[^>]*>/i.test(part);
    const text = stripTags(part);
    if (text.trim()) {
      runs.push(aRun({
        text,
        bold: isBold,
        size: 22,
        color: isBold ? '1D4ED8' : '1a1a2e',
      }));
    }
  }
  return runs.length
    ? runs
    : [aRun({ text: stripTags(html), size: 22 })];
}

// ════════════════════════════════════════════════════════════
// بناء الجداول
// ════════════════════════════════════════════════════════════
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
          rPara({
            children: [
              aRun({
                text: cellText,
                bold: isHeaderRow,
                size: 18,
                color: isHeaderRow ? 'FFFFFF' : '1a1a2e',
              }),
            ],
            spacing: { before: 40, after: 40 },
          }),
        ],
        shading: isHeaderRow
          ? { fill: '1D4ED8', type: ShadingType.SOLID }
          : rowIdx % 2 === 0
            ? { fill: 'EFF6FF', type: ShadingType.SOLID }
            : { fill: 'FFFFFF', type: ShadingType.SOLID },
        margins: { top: 80, bottom: 80, left: 140, right: 140 },
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
      top:     { style: BorderStyle.SINGLE, size: 8, color: '1D4ED8' },
      bottom:  { style: BorderStyle.SINGLE, size: 8, color: '1D4ED8' },
      left:    { style: BorderStyle.SINGLE, size: 8, color: '1D4ED8' },
      right:   { style: BorderStyle.SINGLE, size: 8, color: '1D4ED8' },
      insideH: { style: BorderStyle.SINGLE, size: 4, color: 'BFDBFE' },
      insideV: { style: BorderStyle.SINGLE, size: 4, color: 'BFDBFE' },
    },
    visuallyRightToLeft: true,
  });
}

// ════════════════════════════════════════════════════════════
// تنظيف HTML
// ════════════════════════════════════════════════════════════
function stripTags(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

// ════════════════════════════════════════════════════════════
// EXCEL (ExcelJS) — مدمج هنا لتوفير Serverless Function
// ════════════════════════════════════════════════════════════
const XC = {
  blue:'FF1D4ED8', blueDark:'FF1e3a8a', blueLight:'FFEFF6FF',
  blueMid:'FFBFDBFE', white:'FFFFFFFF', grayLight:'FFF8FAFC',
  text:'FF0f172a', textMid:'FF334155', textLight:'FF64748B', gold:'FFFBBF24',
};
const XCOLS = 6;

function xRtl(h='right'){ return { horizontal:h, vertical:'middle', wrapText:true, readingOrder:2 }; }
function xBorder(cell, color='FFBFDBFE', style='thin'){
  const b={style, color:{argb:color}};
  cell.border={top:b,bottom:b,left:b,right:b};
}
function xMerge(ws,row,f,t){
  const c=ws.getCell(row,f);
  if(t>f){ try{ ws.mergeCells(row,f,row,t); }catch(_){} }
  return c;
}

// ── استخراج عناوين الفهرس من HTML ──
function xExtractTOC(html) {
  const items = [];
  const reg = /<h([234])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m, counter = 0;
  while ((m = reg.exec(html)) !== null) {
    const level = parseInt(m[1]);
    const text = m[2].replace(/<[^>]+>/g,'').replace(/&[a-z]+;/gi,'').trim();
    if (text) { counter++; items.push({ level, text, num: counter }); }
  }
  return items;
}

// ── ورقة الفهرس ──
function xAddTOCSheet(wb, tocItems, title, dateStr) {
  const wt = wb.addWorksheet('فهرس المحتويات', {
    views:[{rightToLeft:true, showGridLines:false}],
    properties:{tabColor:{argb:XC.gold}},
  });
  wt.columns=[
    {key:'A',width:6},{key:'B',width:8},{key:'C',width:56},{key:'D',width:12},
    {key:'E',width:12},{key:'F',width:14},
  ];

  let r = 1;
  // شريط علوي
  wt.getRow(r).height=22;
  const h1=xMerge(wt,r,1,6);
  h1.value='✦  ذكاء الأعمال  —  دراسات الجدوى الاستثمارية';
  h1.font={name:'Arial',size:11,bold:true,color:{argb:XC.white}};
  h1.fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.blueDark}};
  h1.alignment=xRtl('center'); r++;

  wt.getRow(r).height=4;
  xMerge(wt,r,1,6).fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.gold}}; r++;

  // عنوان الدراسة
  wt.getRow(r).height=38;
  const tc=xMerge(wt,r,1,6);
  tc.value=title;
  tc.font={name:'Arial',size:18,bold:true,color:{argb:XC.white}};
  tc.fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.blue}};
  tc.alignment=xRtl('center'); r++;

  // تاريخ
  wt.getRow(r).height=18;
  const dc=xMerge(wt,r,1,6);
  dc.value=`📅 ${dateStr}`;
  dc.font={name:'Arial',size:9,color:{argb:XC.textLight}};
  dc.fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.blueLight}};
  dc.alignment=xRtl('center'); r++;

  wt.getRow(r).height=8; r++;

  // رأس الفهرس
  wt.getRow(r).height=22;
  const fh=xMerge(wt,r,1,6);
  fh.value='فهرس المحتويات';
  fh.font={name:'Arial',size:13,bold:true,color:{argb:XC.white}};
  fh.fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.blue}};
  fh.alignment=xRtl('center');
  xBorder(fh, XC.blueMid); r++;

  wt.getRow(r).height=4;
  xMerge(wt,r,1,6).fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.gold}}; r++;

  // بنود الفهرس
  tocItems.forEach((it) => {
    wt.getRow(r).height = it.level===2 ? 20 : 17;
    const numCell = wt.getCell(r, 1);
    numCell.value = it.num;
    numCell.font = {name:'Arial', size: it.level===2?10:9, bold: it.level===2,
      color:{argb: it.level===2 ? XC.blue : XC.textMid}};
    numCell.fill = {type:'pattern',pattern:'solid',
      fgColor:{argb: it.level===2 ? XC.blueLight : XC.grayLight}};
    numCell.alignment = xRtl('center');
    xBorder(numCell, XC.blueMid);

    const txtCell = xMerge(wt,r,2,6);
    const indent = it.level===2 ? '' : it.level===3 ? '    ' : '        ';
    txtCell.value = indent + it.text;
    txtCell.font = {
      name:'Arial',
      size: it.level===2 ? 11 : 9.5,
      bold: it.level===2,
      color:{argb: it.level===2 ? XC.blueDark : it.level===3 ? XC.textMid : XC.textLight},
    };
    txtCell.fill = {type:'pattern',pattern:'solid',
      fgColor:{argb: it.level===2 ? XC.blueLight : XC.grayLight}};
    txtCell.alignment = xRtl('right');
    xBorder(txtCell, XC.blueMid);
    r++;
  });

  wt.getRow(r).height=6;
  xMerge(wt,r,1,6).fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.blueMid}}; r++;

  // تطبيق RTL على كل الخلايا
  wt.eachRow((row) => {
    row.eachCell({includeEmpty:false}, (cell) => {
      const a=cell.alignment||{};
      cell.alignment={...a,readingOrder:2,horizontal:a.horizontal||'right',
        vertical:a.vertical||'middle',wrapText:a.wrapText!==false};
    });
  });
}

async function generateXlsx(req, res, title, content, meta) {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator='ذكاء الأعمال'; wb.company='eses.store';
    wb.created=new Date(); wb.modified=new Date();

    // ── فهرس المحتويات (ورقة أولى) ──
    const dateStr=new Date().toLocaleDateString('ar-SA',{year:'numeric',month:'long',day:'numeric'});
    const tocItems=xExtractTOC(content);
    if(tocItems.length>1) xAddTOCSheet(wb, tocItems, title, dateStr);

    const ws = wb.addWorksheet('دراسة الجدوى', {
      views:[{rightToLeft:true, showGridLines:false}],
      properties:{tabColor:{argb:XC.blue}},
    });
    ws.columns=[
      {key:'A',width:6},{key:'B',width:42},{key:'C',width:22},
      {key:'D',width:22},{key:'E',width:22},{key:'F',width:18},
    ];
    ws.pageSetup={
      paperSize:9, orientation:'portrait', fitToPage:true,
      fitToWidth:1, fitToHeight:0, printTitlesRow:'1:6',
      horizontalDpi:200, verticalDpi:200,
      margins:{left:0.5,right:0.5,top:0.75,bottom:0.75,header:0.3,footer:0.3},
    };
    ws.headerFooter={
      oddHeader:'&R&"Arial,Bold"&9ذكاء الأعمال — دراسات الجدوى&L&9&D',
      oddFooter:'&C&"Arial"&8eses.store  ·  صفحة &P من &N',
    };

    let row=1;
    // ── ترويسة ──
    ws.getRow(row).height=22;
    const b=xMerge(ws,row,1,XCOLS);
    b.value='✦  ذكاء الأعمال  —  دراسات الجدوى الاستثمارية';
    b.font={name:'Arial',size:11,bold:true,color:{argb:XC.white}};
    b.fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.blueDark}};
    b.alignment=xRtl('center'); row++;

    ws.getRow(row).height=4;
    xMerge(ws,row,1,XCOLS).fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.gold}}; row++;

    ws.getRow(row).height=44;
    const tc=xMerge(ws,row,1,XCOLS);
    tc.value=title; tc.font={name:'Arial',size:20,bold:true,color:{argb:XC.white}};
    tc.fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.blue}};
    tc.alignment=xRtl('center'); row++;

    ws.getRow(row).height=22;
    const metaText=[
      meta.capital?`💰 رأس المال: ${meta.capital}`:'',
      meta.employees?`👥 الموظفون: ${meta.employees}`:'',
      meta.location?`📍 الموقع: ${meta.location}`:'',
      meta.sector?`🏭 القطاع: ${meta.sector}`:'',
      `📅 ${dateStr}`,
    ].filter(Boolean).join('   |   ');
    const mc=xMerge(ws,row,1,XCOLS);
    mc.value=metaText; mc.font={name:'Arial',size:9,color:{argb:XC.textLight}};
    mc.fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.blueLight}};
    mc.alignment=xRtl('center'); row++;

    ws.getRow(row).height=10; row++;

    // ── محتوى ──
    row=xParseHtml(ws, content, row, XCOLS);

    // ── تذييل ──
    ws.getRow(row).height=6;
    xMerge(ws,row,1,XCOLS).fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.blueMid}}; row++;
    ws.getRow(row).height=20;
    const fc=xMerge(ws,row,1,XCOLS);
    fc.value='— نهاية الدراسة —   منصة ذكاء الأعمال  ·  eses.store';
    fc.font={name:'Arial',size:10,italic:true,color:{argb:XC.textLight}};
    fc.fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.grayLight}};
    fc.alignment=xRtl('center'); row++;

    ws.pageSetup.printArea=`A1:F${row}`;

    // ── ضمان RTL على كل خلية لتوافق تطبيقات الجوال (WPS, Excel Mobile) ──
    ws.eachRow((r) => {
      r.eachCell({ includeEmpty: false }, (cell) => {
        const a = cell.alignment || {};
        cell.alignment = {
          ...a,
          readingOrder: 2,                           // 2 = RTL دائماً
          horizontal: a.horizontal || 'right',
          vertical:   a.vertical   || 'middle',
          wrapText:   a.wrapText   !== false,
        };
      });
    });

    const buf=await wb.xlsx.writeBuffer();
    const safe=title.replace(/[^\u0600-\u06FFa-zA-Z0-9\s\-_]/g,'').trim()||'study';
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(safe)}.xlsx`);
    res.setHeader('Content-Length', buf.byteLength);
    return res.status(200).end(Buffer.from(buf));
  } catch(err) {
    console.error('XLSX Error:',err);
    return res.status(500).json({error:err.message});
  }
}

function xParseHtml(ws, html, row, cols) {
  if(!html) return row;
  let text=html.replace(/\r\n/g,'\n').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  const tableRegex=/<table[^>]*>[\s\S]*?<\/table>/gi;
  const tPos=[]; let m;
  while((m=tableRegex.exec(text))!==null) tPos.push({start:m.index,end:m.index+m[0].length,html:m[0]});
  const parts=[]; let last=0;
  for(const tp of tPos){
    if(tp.start>last) parts.push({type:'html',content:text.slice(last,tp.start)});
    parts.push({type:'table',content:tp.html}); last=tp.end;
  }
  if(last<text.length) parts.push({type:'html',content:text.slice(last)});
  for(const p of parts) row = p.type==='table' ? xWriteTable(ws,p.content,row,cols) : xWriteText(ws,p.content,row,cols);
  return row;
}

function xWriteText(ws, html, row, cols) {
  html=html.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi,(_,t)=>{
    const v=stripTags(t); if(!v) return '';
    ws.getRow(row).height=8; row++;
    ws.getRow(row).height=26;
    const c=xMerge(ws,row,1,cols);
    c.value='  '+v; c.font={name:'Arial',size:13,bold:true,color:{argb:XC.white}};
    c.fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.blue}}; c.alignment=xRtl(); row++; return '';
  });
  html=html.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi,(_,t)=>{
    const v=stripTags(t); if(!v) return '';
    ws.getRow(row).height=6; row++;
    ws.getRow(row).height=22;
    const c=xMerge(ws,row,1,cols);
    c.value='  ▶  '+v; c.font={name:'Arial',size:11,bold:true,color:{argb:XC.white}};
    c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF2563EB'}}; c.alignment=xRtl(); row++; return '';
  });
  html=html.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi,(_,t)=>{
    const v=stripTags(t); if(!v) return '';
    ws.getRow(row).height=20;
    const c=xMerge(ws,row,1,cols);
    c.value='  ◆  '+v; c.font={name:'Arial',size:10,bold:true,color:{argb:XC.blueDark}};
    c.fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.blueLight}}; c.alignment=xRtl(); row++; return '';
  });
  html=html.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi,(_,ul)=>{
    (ul.match(/<li[^>]*>([\s\S]*?)<\/li>/gi)||[]).forEach(li=>{
      const v=stripTags(li); if(!v.trim()) return;
      ws.getRow(row).height=18;
      const c=xMerge(ws,row,1,cols);
      c.value='    •  '+v.trim(); c.font={name:'Arial',size:10,color:{argb:XC.textMid}};
      c.fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.white}}; c.alignment=xRtl();
      xBorder(c,'FFe2e8f0','hair'); row++;
    }); return '';
  });
  html=html.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi,(_,ol)=>{
    (ol.match(/<li[^>]*>([\s\S]*?)<\/li>/gi)||[]).forEach((li,i)=>{
      const v=stripTags(li); if(!v.trim()) return;
      ws.getRow(row).height=18;
      const c=xMerge(ws,row,1,cols);
      c.value=`    ${i+1}.  `+v.trim(); c.font={name:'Arial',size:10,color:{argb:XC.textMid}};
      c.fill={type:'pattern',pattern:'solid',fgColor:{argb:i%2===0?XC.white:XC.grayLight}}; c.alignment=xRtl(); row++;
    }); return '';
  });
  html=html.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi,(_,t)=>{
    const v=stripTags(t); if(!v.trim()) return '';
    ws.getRow(row).height=Math.max(18,Math.min(60,Math.ceil(v.length/80)*16));
    const c=xMerge(ws,row,1,cols);
    c.value='  '+v.trim(); c.font={name:'Arial',size:10,color:{argb:XC.text}};
    c.fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.white}}; c.alignment={...xRtl(),wrapText:true}; row++; return '';
  });
  const rem=stripTags(html);
  if(rem.trim()) rem.split('\n').forEach(line=>{
    const l=line.trim(); if(!l) return;
    ws.getRow(row).height=16;
    const c=xMerge(ws,row,1,cols);
    c.value='  '+l; c.font={name:'Arial',size:10,color:{argb:XC.textMid}};
    c.fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.white}}; c.alignment=xRtl(); row++;
  });
  return row;
}

function xWriteTable(ws, tableHtml, row, cols) {
  ws.getRow(row).height=6; row++;
  const trs=tableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi)||[];
  if(!trs.length) return row;
  let maxC=0;
  trs.forEach(tr=>{ const cs=tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi)||[]; maxC=Math.max(maxC,cs.length); });
  maxC=Math.min(maxC,cols);
  for(let ri=0;ri<trs.length;ri++){
    const tr=trs[ri]; const isH=/<th[^>]*>/i.test(tr);
    const cs=tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi)||[];
    if(!cs.length) continue;
    ws.getRow(row).height=isH?22:18;
    cs.slice(0,maxC).forEach((ch,ci)=>{
      const v=stripTags(ch); const cell=ws.getCell(row,ci+1);
      cell.value=v;
      cell.font={name:'Arial',size:isH?10:9,bold:isH,color:{argb:isH?XC.white:XC.text}};
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:isH?XC.blue:ri%2===0?XC.blueLight:XC.white}};
      cell.alignment={...xRtl(),wrapText:true};
      xBorder(cell,isH?XC.blueMid:'FFbfdbfe','thin');
    });
    if(maxC<cols){ try{ ws.mergeCells(row,maxC+1,row,cols); ws.getCell(row,maxC+1).fill={type:'pattern',pattern:'solid',fgColor:{argb:XC.grayLight}}; }catch(_){} }
    row++;
  }
  ws.getRow(row).height=6; row++;
  return row;
}
