/**
 * api/ready-studies.js
 * يقدّم محتوى الدراسات الجاهزة من data/ready-studies-content.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'data', 'ready-studies-content.json');

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  if (!fs.existsSync(DATA_FILE)) {
    return res.status(404).json({ error: 'الدراسات لم تُولَّد بعد — شغّل scripts/generate-ready-studies.mjs أولاً' });
  }

  try {
    const raw  = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: 'خطأ في قراءة ملف الدراسات: ' + e.message });
  }
}
