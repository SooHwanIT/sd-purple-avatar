// qarun 과 같지만 길이·장수 지정 (QA_SEC, QA_PICKS)
stage.setBackground('#3a3346');
Object.assign(stage.view, window.QA_VIEW);
const r = await window.qaRun(window.QA_SEED ?? 3, window.QA_SEC ?? 120, window.QA_PICKS ?? 48, window.QA_DIR);
return r.map((x) => `${x.t}s ax${x.ax} ay${x.ay} az${x.az} eye${x.eye} m${x.mouth} ${x.ex}`);
