import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  const studies = {};
  for (const id of [1, 2, 3]) {
    const filePath = path.join(__dirname, '..', 'data', `study-${id}.md`);
    studies[id] = {
      text: fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
    };
  }

  return res.status(200).json(studies);
}
