// 파츠 리그 시험용 작은 서버: avatar/public 을 보여 주고, 시험 페이지가 보내는 프레임(JPEG)을 저장한다.
//   node tools/parts_test_server.mjs [--port 8799]
// 프레임: POST /__frame?i=번호&dir=이름 (본문 = data:image/jpeg;base64,...) → source/vtuber/video/<이름>/f_00001.jpg
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '..', 'avatar', 'public');
const VIDEO = resolve(HERE, '..', 'source', 'vtuber', 'video');
const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 8799;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'POST' && url.pathname === '/__frame') {
      const dir = (url.searchParams.get('dir') || 'frames_parts').replace(/[^a-z0-9_]/gi, '');
      const i = Math.max(0, Math.min(99999, Number(url.searchParams.get('i')) || 0));
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks).toString();
      const b64 = body.slice(body.indexOf(',') + 1);
      const out = join(VIDEO, dir);
      await mkdir(out, { recursive: true });
      await writeFile(join(out, `f_${String(i).padStart(5, '0')}.jpg`), Buffer.from(b64, 'base64'));
      res.writeHead(200).end('ok');
      return;
    }
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, '');
    if (!p) p = 'parts_test.html';
    const file = resolve(ROOT, p);
    if (!file.startsWith(ROOT + sep)) {
      res.writeHead(403).end();
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`parts test server http://127.0.0.1:${port}/`));
