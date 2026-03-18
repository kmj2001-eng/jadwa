/**
 * patch-index.mjs
 * يستبدل كتلة READY_STUDIES في index.html بالكود الجديد الذي يقرأ من /api/ready-studies
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.join(__dirname, '..', 'index.html');

const NEW_CODE = `
// ─── READY STUDIES — يُحمَّل من /api/ready-studies (مُولَّد بـ claude.js) ───
let _readyStudiesData = null;

async function loadReadyStudies() {
  if (_readyStudiesData) return _readyStudiesData;
  try {
    const res = await fetch('/api/ready-studies');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _readyStudiesData = await res.json();
    return _readyStudiesData;
  } catch (e) {
    console.error('تعذّر تحميل الدراسات الجاهزة:', e.message);
    return null;
  }
}

async function openReadyStudy(id) {
  const overlay  = document.getElementById('study-viewer-overlay');
  const viewBody = document.getElementById('study-viewer-body');
  const titleEl  = document.getElementById('study-viewer-title');
  if (!overlay || !viewBody) return;

  // شاشة تحميل أولية
  titleEl.textContent = 'جاري تحميل الدراسة...';
  overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';
  overlay.scrollTop = 0;
  viewBody.innerHTML = \`<div style="text-align:center;padding:80px 24px;">
    <div class="typing-dots" style="justify-content:center;"><span></span><span></span><span></span></div>
    <p style="color:var(--text3);margin-top:18px;font-size:0.9rem;">جاري تحميل الدراسة...</p>
  </div>\`;

  const data = await loadReadyStudies();
  if (!data || !data[id]) {
    viewBody.innerHTML = \`<div style="text-align:center;padding:60px 24px;color:var(--rose);">
      <p style="font-size:2rem;">⚠️</p>
      <p>تعذّر تحميل الدراسة. يُرجى المحاولة لاحقاً.</p>
    </div>\`;
    return;
  }

  const study = data[id];
  titleEl.textContent = study.title;

  // تحويل Markdown → HTML بنفس دالة المنصة
  const html = typeof mdToHtml === 'function' ? mdToHtml(study.text) : study.text;
  viewBody.innerHTML = \`<div class="output-body">\${html}</div>\`;
}

function closeStudyViewer() {
  const overlay = document.getElementById('study-viewer-overlay');
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}

`;

const content = fs.readFileSync(INDEX, 'utf8');
const lines   = content.split('\n');

// أسطر 3674-4096 (1-based) = indices 3673-4095 (0-based)
const START = 3673; // inclusive (0-based)
const END   = 4096; // exclusive (0-based) = line 4097

const before = lines.slice(0, START);
const after  = lines.slice(END);

const patched = [...before, ...NEW_CODE.split('\n'), ...after].join('\n');
fs.writeFileSync(INDEX, patched, 'utf8');

console.log('✅ index.html تم تحديثه');
console.log(`   أُزيل ${END - START} سطر، أُضيف ${NEW_CODE.split('\n').length} سطر`);
