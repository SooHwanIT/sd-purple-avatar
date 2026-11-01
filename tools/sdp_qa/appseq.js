// 앱 본 화면을 그대로 돌리며(실시간 루프: 대기 흔들림·자동 깜빡임·얼굴 연기) 일정 간격으로 캔버스 캡처
await new Promise((r) => setTimeout(r, 4000));
const c = document.getElementById('avatar');
const n = window.N ?? 24, gap = window.GAP ?? 400;
for (let i = 0; i < n; i++) {
  await new Promise((r) => setTimeout(r, gap));
  await fetch(`/__frame?i=${i}&dir=sdp_appseq`, { method: 'POST', body: c.toDataURL('image/jpeg', 0.9) });
}
return n;
