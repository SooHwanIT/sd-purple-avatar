stage.setBackground('#3a3346');
Object.assign(stage.view, window.QA_VIEW);
const r = await window.qaRun(window.QA_SEED ?? 3, 60, 24, window.QA_DIR);
return r.map((x) => `${x.t}s ax${x.ax} ay${x.ay} az${x.az} eye${x.eye} m${x.mouth} ${x.ex}`);
