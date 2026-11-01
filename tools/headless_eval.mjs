// 보이지 않는 크롬으로 시험 페이지를 열고 스크립트를 실행해 결과를 출력 (사용자 화면에 창이 뜨지 않음)
// 사용: node tools/headless_eval.mjs <url> <script.js> [시간제한초]
//  script.js 의 내용은 async 함수 본문으로 실행되고 return 값이 JSON 으로 출력됨
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [url, scriptPath, limitS = '900'] = process.argv.slice(2);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9300 + Math.floor(Math.random() * 500);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-'));
const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check',
  '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1200,1200', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { proc.kill(); } catch {} setTimeout(() => { try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} }, 800); };
const timer = setTimeout(() => { console.error('시간 초과'); cleanup(); process.exit(2); }, +limitS * 1000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const pg = list.find((t) => t.type === 'page');
    if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); break; }
  } catch {}
  await sleep(250);
}
if (!ws) { console.error('크롬 연결 실패'); cleanup(); process.exit(1); }
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pend = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && process.env.HL_LOG) console.error('[page]', m.params.args.map((a) => a.value ?? a.description).join(' '));
  if (m.method === 'Runtime.exceptionThrown') console.error('[page error]', m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url });
for (let i = 0; i < 240; i++) {
  const r = await send('Runtime.evaluate', { expression: 'window.ready === true', returnByValue: true });
  if (r.result?.result?.value) break;
  await sleep(250);
}
const body = fs.readFileSync(scriptPath, 'utf8');
const r = await send('Runtime.evaluate', { expression: `(async () => { ${body}\n })()`, awaitPromise: true, returnByValue: true });
if (r.result?.exceptionDetails) console.error(r.result.exceptionDetails.exception?.description ?? JSON.stringify(r.result.exceptionDetails));
else console.log(JSON.stringify(r.result?.result?.value));
clearTimeout(timer);
ws.close();
cleanup();
setTimeout(() => process.exit(0), 1000);
