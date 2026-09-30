// One-Euro filter (Casiez, Roussel & Vogel, CHI 2012): adaptive low-pass filter that
// removes tracking jitter at rest while staying responsive during fast motion.

class LowPass {
  private y: number | null = null;
  filter(x: number, alpha: number) {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
  last() { return this.y; }
  reset() { this.y = null; }
}

export class OneEuro {
  private x = new LowPass();
  private dx = new LowPass();
  private lastT: number | null = null;

  minCutoff: number;
  beta: number;
  dCutoff: number;

  constructor(minCutoff = 1.0, beta = 0.02, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, tSeconds: number) {
    const dt = this.lastT === null ? 1 / 30 : Math.max(1e-3, tSeconds - this.lastT);
    this.lastT = tSeconds;
    const prev = this.x.last();
    const deriv = prev === null ? 0 : (value - prev) / dt;
    const edx = this.dx.filter(deriv, this.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(value, this.alpha(cutoff, dt));
  }

  reset() { this.x.reset(); this.dx.reset(); this.lastT = null; }
}

/** Filters a fixed-size vector with one One-Euro filter per channel. */
export class OneEuroVec {
  private f: OneEuro[];
  constructor(n: number, minCutoff = 1.0, beta = 0.02) {
    this.f = Array.from({ length: n }, () => new OneEuro(minCutoff, beta));
  }
  filter(v: number[], t: number) { return v.map((x, i) => this.f[i].filter(x, t)); }
  reset() { this.f.forEach((f) => f.reset()); }
}
