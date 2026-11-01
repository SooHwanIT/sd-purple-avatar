// 앱 본 화면(index.html)을 시험 서버로 열어 콘솔 오류·표정 버튼 수·캔버스 캡처 (Electron 없이 되는 부분만)
await new Promise((r) => setTimeout(r, 6000));
const c = document.getElementById('avatar');
let shot = null;
try { await fetch('/__frame?i=0&dir=sdp_app', { method: 'POST', body: c.toDataURL('image/jpeg', 0.9) }); shot = [c.width, c.height]; } catch (e) { shot = String(e); }
return { shot, exprButtons: document.querySelectorAll('#expr-list button').length, exprLabels: [...document.querySelectorAll('#expr-list button')].map((b) => b.textContent.trim().slice(0, 6)), title: document.title };
