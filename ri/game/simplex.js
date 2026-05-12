/**
 * simplex.js — Seeded 2D Simplex noise.
 *
 * Adapted from Stefan Gustavson's public-domain implementation.
 * Accepts a seedrandom-compatible PRNG so all outputs are deterministic.
 */

const GRAD3 = [
  [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
  [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
  [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1],
];

function dot2(g, x, y) { return g[0] * x + g[1] * y; }

/**
 * Build a Simplex noise function seeded by a given PRNG.
 * @param {() => number} rng — zero-arg function returning [0,1)
 * @returns {(x: number, y: number) => number} noise function → [-1, 1]
 */
export function buildSimplex(rng) {
  // Build a shuffled permutation table
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }

  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;

  return function noise(xin, yin) {
    const s  = (xin + yin) * F2;
    const i  = Math.floor(xin + s);
    const j  = Math.floor(yin + s);
    const t  = (i + j) * G2;
    const X0 = i - t, Y0 = j - t;
    const x0 = xin - X0, y0 = yin - Y0;

    const [i1, j1] = x0 > y0 ? [1, 0] : [0, 1];
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2*G2, y2 = y0 - 1 + 2*G2;

    const ii = i & 255, jj = j & 255;
    const gi0 = permMod12[ii        + perm[jj       ]];
    const gi1 = permMod12[ii + i1   + perm[jj + j1  ]];
    const gi2 = permMod12[ii + 1    + perm[jj + 1   ]];

    let n0 = 0, n1 = 0, n2 = 0;
    let t0 = 0.5 - x0*x0 - y0*y0;
    if (t0 >= 0) { t0 *= t0; n0 = t0*t0 * dot2(GRAD3[gi0], x0, y0); }
    let t1 = 0.5 - x1*x1 - y1*y1;
    if (t1 >= 0) { t1 *= t1; n1 = t1*t1 * dot2(GRAD3[gi1], x1, y1); }
    let t2 = 0.5 - x2*x2 - y2*y2;
    if (t2 >= 0) { t2 *= t2; n2 = t2*t2 * dot2(GRAD3[gi2], x2, y2); }

    // Scale to [-1, 1]
    return 70 * (n0 + n1 + n2);
  };
}
