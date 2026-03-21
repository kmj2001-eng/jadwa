import ExcelJS from 'exceljs';

// ════════════════════════════════════════════════════════════
// ألوان المنصة
// ════════════════════════════════════════════════════════════
const C = {
  blue:      'FF1D4ED8',
  blueDark:  'FF1e3a8a',
  blueLight: 'FFEFF6FF',
  blueMid:   'FFBFDBFE',
  blueRow:   'FFdbeafe',
  white:     'FFFFFFFF',
  grayLight: 'FFF8FAFC',
  grayMid:   'FFe2e8f0',
  green:     'FF059669',
  text:      'FF0f172a',
  textMid:   'FF334155',
  textLight: 'FF64748B',
  gold:      'FFFBBF24',
};

// ── عدد الأعمدة الأساسي للمحتوى ──
const COLS = 6; // A-F

// ── مساعدات ─────────────────────────────────────────────────
function stripTags(html = '') {
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

function rtlAlign(horizontal = 'right') {
  return { horizontal, vertical: 'middle', wrapText: true, readingOrder: 2 };
}

function applyBorder(cell, color = 'FFBFDBFE', style = 'thin') {
  const b = { style, color: { argb: color } };
  cell.border = { top: b, bottom: b, left: b, right: b };
}

// دمج خلايا وإرجاع الخلية الأولى
function mergeRow(ws, row, fromCol, toCol) {
  const startCell = ws.getCell(row, fromCol);
  if (toCol > fromCol) {
    try { ws.mergeCells(row, fromCol, row, toCol); } catch (_) {}
  }
  return startCell;
}

// ════════════════════════════════════════════════════════════
// HANDLER الرئيسي
// ════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { title = 'دراسة الجدوى', content = '', meta = {} } = req.body;

  try {
    const wb = new ExcelJS.Workbook();
    wb.creator  = 'ذكاء الأعمال';
    wb.company  = 'eses.store';
    wb.created  = new Date();
    wb.modified = new Date();

    const ws = wb.addWorksheet('دراسة الجدوى', {
      views: [{ rightToLeft: true, showGridLines: false }],
      properties: { tabColor: { argb: C.blue } },
    });

    // ── عرض الأعمدة ──
    ws.columns = [
      { key: 'A', width: 6  },  // A: رقم / مساحة
      { key: 'B', width: 42 },  // B: محتوى رئيسي
      { key: 'C', width: 22 },  // C
      { key: 'D', width: 22 },  // D
      { key: 'E', width: 22 },  // E
      { key: 'F', width: 18 },  // F
    ];

    let row = 1; // العداد الحالي للصفوف

    // ── إعداد الطباعة ──
    ws.pageSetup = {
      paperSize:       9,           // A4
      orientation:     'portrait',
      fitToPage:       true,
      fitToWidth:      1,
      fitToHeight:     0,
      printTitlesRow:  '1:6',       // تكرار الرأس عند الطباعة
      horizontalDpi:   200,
      verticalDpi:     200,
      margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
    };

    ws.headerFooter = {
      oddHeader:  '&R&"Arial,Bold"&9ذكاء الأعمال — دراسات الجدوى&L&9&D',
      oddFooter:  '&C&"Arial"&8eses.store  ·  صفحة &P من &N',
    };

    // ════════════════
    // غلاف / ترويسة
    // ════════════════
    // صف 1-2: شعار المنصة
    ws.getRow(row).height = 22;
    const brandCell = mergeRow(ws, row, 1, COLS);
    brandCell.value     = '✦  ذكاء الأعمال  —  دراسات الجدوى الاستثمارية';
    brandCell.font      = { name: 'Arial', size: 11, bold: true, color: { argb: C.white } };
    brandCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.blueDark } };
    brandCell.alignment = rtlAlign('center');
    row++;

    ws.getRow(row).height = 4;
    const divider = mergeRow(ws, row, 1, COLS);
    divider.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.gold } };
    row++;

    // صف العنوان الرئيسي
    ws.getRow(row).height = 44;
    const titleCell = mergeRow(ws, row, 1, COLS);
    titleCell.value     = title;
    titleCell.font      = { name: 'Arial', size: 20, bold: true, color: { argb: C.white } };
    titleCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.blue } };
    titleCell.alignment = rtlAlign('center');
    row++;

    // صف بيانات تعريفية
    ws.getRow(row).height = 22;
    const dateStr = new Date().toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' });
    const metaText = [
      meta.capital    ? `💰 رأس المال: ${meta.capital}`       : '',
      meta.employees  ? `👥 الموظفون: ${meta.employees}`       : '',
      meta.location   ? `📍 الموقع: ${meta.location}`          : '',
      meta.sector     ? `🏭 القطاع: ${meta.sector}`            : '',
      `📅 ${dateStr}`,
    ].filter(Boolean).join('   |   ');

    const metaCell = mergeRow(ws, row, 1, COLS);
    metaCell.value     = metaText;
    metaCell.font      = { name: 'Arial', size: 9, color: { argb: C.textLight } };
    metaCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.blueLight } };
    metaCell.alignment = rtlAlign('center');
    row++;

    // فراغ فاصل
    ws.getRow(row).height = 10;
    row++;

    // ════════════════
    // محتوى الدراسة
    // ════════════════
    row = parseHtmlToXlsx(ws, content, row, COLS);

    // ════════════════
    // تذييل
    // ════════════════
    ws.getRow(row).height = 6;
    const footerLine = mergeRow(ws, row, 1, COLS);
    footerLine.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.blueMid } };
    row++;

    ws.getRow(row).height = 20;
    const footerCell = mergeRow(ws, row, 1, COLS);
    footerCell.value     = '— نهاية الدراسة —   منصة ذكاء الأعمال  ·  eses.store';
    footerCell.font      = { name: 'Arial', size: 10, italic: true, color: { argb: C.textLight } };
    footerCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.grayLight } };
    footerCell.alignment = rtlAlign('center');
    row++;

    // منطقة الطباعة
    ws.pageSetup.printArea = `A1:F${row}`;

    // ── تحويل لـ Buffer وإرسال ──
    const buffer = await wb.xlsx.writeBuffer();
    const safeTitle = title.replace(/[^\u0600-\u06FFa-zA-Z0-9\s\-_]/g, '').trim() || 'study';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeTitle)}.xlsx`);
    res.setHeader('Content-Length', buffer.byteLength);
    return res.status(200).end(Buffer.from(buffer));

  } catch (err) {
    console.error('XLSX Generation Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ════════════════════════════════════════════════════════════
// المحلل الرئيسي: يُحوّل HTML إلى صفوف Excel
// ════════════════════════════════════════════════════════════
function parseHtmlToXlsx(ws, html, row, cols) {
  if (!html) return row;

  // تطبيع
  let text = html
    .replace(/\r\n/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  // ── فصل الجداول عن باقي المحتوى ──
  const tableRegex = /<table[^>]*>[\s\S]*?<\/table>/gi;
  const tablePositions = [];
  let m;
  while ((m = tableRegex.exec(text)) !== null) {
    tablePositions.push({ start: m.index, end: m.index + m[0].length, html: m[0] });
  }

  const parts = [];
  let lastIdx = 0;
  for (const tp of tablePositions) {
    if (tp.start > lastIdx) parts.push({ type: 'html', content: text.slice(lastIdx, tp.start) });
    parts.push({ type: 'table', content: tp.html });
    lastIdx = tp.end;
  }
  if (lastIdx < text.length) parts.push({ type: 'html', content: text.slice(lastIdx) });

  for (const part of parts) {
    if (part.type === 'table') {
      row = writeTable(ws, part.content, row, cols);
    } else {
      row = writeTextHtml(ws, part.content, row, cols);
    }
  }

  return row;
}

// ── كتابة HTML نصي (h2 h3 h4 p ul ol) ──────────────────────
function writeTextHtml(ws, html, row, cols) {
  // ── h2 ──
  html = html.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => {
    const val = stripTags(t);
    if (!val) return '';
    // فراغ قبل
    ws.getRow(row).height = 8; row++;

    ws.getRow(row).height = 26;
    const c = mergeRow(ws, row, 1, cols);
    c.value     = '  ' + val;
    c.font      = { name: 'Arial', size: 13, bold: true, color: { argb: C.white } };
    c.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.blue } };
    c.alignment = rtlAlign('right');
    row++;
    return '';
  });

  // ── h3 ──
  html = html.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => {
    const val = stripTags(t);
    if (!val) return '';
    ws.getRow(row).height = 6; row++;

    ws.getRow(row).height = 22;
    const c = mergeRow(ws, row, 1, cols);
    c.value     = '  ▶  ' + val;
    c.font      = { name: 'Arial', size: 11, bold: true, color: { argb: C.white } };
    c.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    c.alignment = rtlAlign('right');
    row++;
    return '';
  });

  // ── h4 ──
  html = html.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, t) => {
    const val = stripTags(t);
    if (!val) return '';
    ws.getRow(row).height = 20;
    const c = mergeRow(ws, row, 1, cols);
    c.value     = '  ◆  ' + val;
    c.font      = { name: 'Arial', size: 10, bold: true, color: { argb: C.blueDark } };
    c.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.blueLight } };
    c.alignment = rtlAlign('right');
    row++;
    return '';
  });

  // ── ul ──
  html = html.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, ulContent) => {
    const liMatches = ulContent.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
    liMatches.forEach(li => {
      const val = stripTags(li);
      if (!val.trim()) return;
      ws.getRow(row).height = 18;
      const c = mergeRow(ws, row, 1, cols);
      c.value     = '    •  ' + val.trim();
      c.font      = { name: 'Arial', size: 10, color: { argb: C.textMid } };
      c.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.white } };
      c.alignment = rtlAlign('right');
      applyBorder(c, 'FFe2e8f0', 'hair');
      row++;
    });
    return '';
  });

  // ── ol ──
  html = html.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, olContent) => {
    const liMatches = olContent.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
    liMatches.forEach((li, idx) => {
      const val = stripTags(li);
      if (!val.trim()) return;
      ws.getRow(row).height = 18;
      const c = mergeRow(ws, row, 1, cols);
      c.value     = `    ${idx + 1}.  ` + val.trim();
      c.font      = { name: 'Arial', size: 10, color: { argb: C.textMid } };
      c.fill      = { type: 'pattern', pattern: 'solid', fgColor: idx % 2 === 0 ? C.white : C.grayLight };
      c.alignment = rtlAlign('right');
      row++;
    });
    return '';
  });

  // ── p ──
  html = html.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => {
    const val = stripTags(t);
    if (!val.trim()) return '';
    ws.getRow(row).height = Math.max(18, Math.min(60, Math.ceil(val.length / 80) * 16));
    const c = mergeRow(ws, row, 1, cols);
    c.value     = '  ' + val.trim();
    c.font      = { name: 'Arial', size: 10, color: { argb: C.text } };
    c.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.white } };
    c.alignment = { ...rtlAlign('right'), wrapText: true };
    row++;
    return '';
  });

  // ── نص متبقٍ ──
  const remaining = stripTags(html);
  if (remaining.trim()) {
    remaining.split('\n').forEach(line => {
      const l = line.trim();
      if (!l) return;
      ws.getRow(row).height = 16;
      const c = mergeRow(ws, row, 1, cols);
      c.value     = '  ' + l;
      c.font      = { name: 'Arial', size: 10, color: { argb: C.textMid } };
      c.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.white } };
      c.alignment = rtlAlign('right');
      row++;
    });
  }

  return row;
}

// ── كتابة جداول ──────────────────────────────────────────────
function writeTable(ws, tableHtml, row, cols) {
  // فراغ قبل الجدول
  ws.getRow(row).height = 6; row++;

  const trMatches = tableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  if (!trMatches.length) return row;

  // حساب أقصى عدد أعمدة
  let maxCols = 0;
  trMatches.forEach(tr => {
    const cells = tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) || [];
    maxCols = Math.max(maxCols, cells.length);
  });
  maxCols = Math.min(maxCols, cols); // لا تتجاوز عدد أعمدة الورقة

  // عرض الأعمدة لكل جدول
  const colWidth = Math.floor(100 / maxCols);

  for (let ri = 0; ri < trMatches.length; ri++) {
    const trHtml    = trMatches[ri];
    const isHeader  = /<th[^>]*>/i.test(trHtml);
    const cellMatches = trHtml.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) || [];
    if (!cellMatches.length) continue;

    ws.getRow(row).height = isHeader ? 22 : 18;

    cellMatches.slice(0, maxCols).forEach((cellHtml, ci) => {
      const val  = stripTags(cellHtml);
      const cell = ws.getCell(row, ci + 1);

      cell.value     = val;
      cell.font      = {
        name: 'Arial',
        size: isHeader ? 10 : 9,
        bold: isHeader,
        color: { argb: isHeader ? C.white : C.text },
      };
      cell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: isHeader
          ? C.blue
          : ri % 2 === 0 ? C.blueLight : C.white,
        },
      };
      cell.alignment = { ...rtlAlign('right'), wrapText: true };
      applyBorder(cell, isHeader ? C.blueMid : 'FFbfdbfe', 'thin');
    });

    // دمج الخلايا الفارغة في نهاية الصف إذا كان الجدول أضيق من الورقة
    if (maxCols < cols) {
      try {
        ws.mergeCells(row, maxCols + 1, row, cols);
        const extraCell = ws.getCell(row, maxCols + 1);
        extraCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.grayLight } };
      } catch (_) {}
    }

    row++;
  }

  // فراغ بعد الجدول
  ws.getRow(row).height = 6; row++;
  return row;
}
