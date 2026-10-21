// Damped spring solver. Semi-implicit Euler on a fixed 1/240 s substep, so a long frame cannot blow it up.
// Reference constants measured on the card-lean spring: stiffness 190, damping 21 (zeta about 0.76, slight overshoot).
export const K = 190;
export const C = 21;

export class Spring {
  constructor(x = 0, k = K, c = C) {
    this.x = x; this.v = 0; this.t = x; this.k = k; this.c = c;
  }
  step(dt) {
    const h = 1 / 240;
    let n = Math.min(60, Math.ceil(dt / h));
    while (n-- > 0) {
      this.v += (this.k * (this.t - this.x) - this.c * this.v) * h;
      this.x += this.v * h;
    }
  }
  get settled() {
    return Math.abs(this.t - this.x) < 0.0008 && Math.abs(this.v) < 0.008;
  }
  snap(x) { this.x = this.t = x; this.v = 0; }
}

// One shared frame loop. A task returns true to stay alive and false once it has settled.
const tasks = new Set();
let raf = 0;
let last = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  for (const task of tasks) if (!task(dt)) tasks.delete(task);
  raf = tasks.size ? requestAnimationFrame(frame) : 0;
}
export function run(task) {
  tasks.add(task);
  if (!raf) {
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
}
