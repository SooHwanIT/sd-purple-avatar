// CDP 도우미: node cdp.mjs <port> <urlSubstring> <expr|@file.js> [shot.png W H]
// 그 주소를 가진 페이지에서 식을 실행해 결과를 출력하고, 지정하면 화면을 저장 (숨긴 창도 크기 지정해 캡처)
import fs from 'node:fs';
const [port, match, exprArg, shot, W, H] = process.argv.slice(2);
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const pg = list.find((t) => t.type === 'page' && t.url.includes(match)) ?? list.find((t) => t.type === 'page');
if (!pg) { console.error('no page', list.map((t) => t.url)); process.exit(1); }
const ws = new WebSocket(pg.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pend = new Map();
const logs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text));
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) logs.push(m.params.type + ' ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable');
const expr = exprArg?.startsWith('@') ? fs.readFileSync(exprArg.slice(1), 'utf8') : exprArg;
if (expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr}\n })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('ERR', r.result.exceptionDetails.exception?.description ?? JSON.stringify(r.result.exceptionDetails));
  else console.log(JSON.stringify(r.result?.result?.value));
}
if (shot) {
  await send('Emulation.setDeviceMetricsOverride', { width: +W || 1280, height: +H || 800, deviceScaleFactor: 1, mobile: false });
  await new Promise((r) => setTimeout(r, 600));
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(shot, Buffer.from(s.result.data, 'base64'));
  await send('Emulation.clearDeviceMetricsOverride');
  console.log('shot', shot);
}
if (logs.length) console.log('LOGS', logs.slice(0, 20).join('\n'));
ws.close();
setTimeout(() => process.exit(0), 200);
