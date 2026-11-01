// Exact damped spring, including a linearly moving target. Position and velocity
// remain continuous when a gesture changes direction or the render rate varies.
export function springStep(state, target, dt, freq, damping, previousTarget = target) {
  if (!(dt > 0)) return state.x;
  const w = 2 * Math.PI * freq, z = Math.max(0, damping);
  const speed = (target - previousTarget) / dt;
  const offset = 2 * z * speed / w;
  const x = state.x - previousTarget + offset, v = state.v - speed;
  const decay = Math.exp(-z * w * dt);
  let y, velocity;
  if (Math.abs(z - 1) < 1e-4) {
    const b = v + w * x;
    y = decay * (x + b * dt);
    velocity = decay * (v - w * b * dt);
  } else if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z), c = Math.cos(wd * dt), s = Math.sin(wd * dt);
    const b = (v + z * w * x) / wd;
    y = decay * (x * c + b * s);
    velocity = decay * (v * c - (z * w * v + w * w * x) / wd * s);
  } else {
    const d = Math.sqrt(z * z - 1), r1 = -w * (z - d), r2 = -w * (z + d);
    const a = (v - r2 * x) / (r1 - r2), b = x - a;
    const e1 = Math.exp(r1 * dt), e2 = Math.exp(r2 * dt);
    y = a * e1 + b * e2;
    velocity = r1 * a * e1 + r2 * b * e2;
  }
  state.x = target - offset + y;
  state.v = speed + velocity;
  return state.x;
}
