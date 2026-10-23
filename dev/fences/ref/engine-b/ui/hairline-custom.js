// Two DEV_OS figures drawn in the hairline style (@lucasmarkes/hairline, MIT):
//   firecrawl-reader — a flame reads a page; each part it passes peels off onto
//                      a sheet of markdown (from the hairline-adopt skill gallery).
//   cursor-tab       — a caret over code; each suggested line it passes is accepted.
// They follow the same contract as the package figures: figure(el, options)
// draws into the element (400x320 viewBox, [data-hairline] container) and
// returns { update, destroy }. They play on their own in a loop — the run stage
// has no pointer on it — and rest under prefers-reduced-motion.
// Palette: the same --hl-* variables the package injects; if none exist yet,
// they fall back to the DEV_OS panel palette, so the figure is never invisible.

const NS = 'http://www.w3.org/2000/svg';
const VIEW = { w: 400, h: 320 };

const HI = 'var(--hl-hi, var(--text, #d0d6e0))';
const MID = 'var(--hl-mid, var(--muted, #8b93a7))';
const LO = 'var(--hl-lo, var(--hairline, rgba(128,128,128,0.35)))';
const EDGE = 'var(--hl-edge, var(--muted, #5b5d64))';

function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function svgEl(parent, name, attrs = {}) {
  const el = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent.appendChild(el);
  return el;
}

// Common container dressing, mirroring what the package's create() does.
function dress(el, id, label) {
  if (!el.hasAttribute('data-hairline-theme')) el.removeAttribute('data-hairline-theme');
  el.setAttribute('data-hairline', id);
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${VIEW.w} ${VIEW.h}`);
  svg.setAttribute('aria-hidden', 'true');
  el.appendChild(svg);
  return svg;
}

const line = (svg, x1, y1, x2, y2, stroke = HI, w = 1.1, dash = null) =>
  svgEl(svg, 'line', { x1, y1, x2, y2, stroke, 'stroke-width': w, 'vector-effect': 'non-scaling-stroke', ...(dash ? { 'stroke-dasharray': dash } : {}) });

const rect = (svg, x, y, w2, h2, stroke = HI, w = 1.1, rx = 3) =>
  svgEl(svg, 'rect', { x, y, width: w2, height: h2, rx, fill: 'none', stroke, 'stroke-width': w, 'vector-effect': 'non-scaling-stroke' });

// ---------------------------------------------------------------- firecrawl-reader
// A page on the left, a markdown sheet on the right. The flame slides down the
// page; every paragraph it passes peels toward the sheet, where its lines land
// one by one. Loop ~14 s, then the sheet clears and it starts again.
export function firecrawlReader(el, options = {}) {
  const svg = dress(el, 'firecrawl-reader', options.label || 'A flame reads a page; each part it passes peels off onto a sheet of markdown');
  const PX = 58, PY = 42, PW = 118, PH = 236;           // page
  const SX = 252, SY = 66, SW2 = 96, SH = 190;          // markdown sheet
  const groups = 6;
  const rowH = (PH - 24) / (groups * 3 - 1);

  rect(svg, PX, PY, PW, PH, EDGE, 1.2, 2);
  rect(svg, SX, SY, SW2, SH, EDGE, 1.2, 2);

  // page paragraphs: three bars each, narrowing like text
  const paras = [];
  for (let g = 0; g < groups; g += 1) {
    const y = PY + 14 + g * rowH * 3;
    const gEl = svgEl(svg, 'g');
    line(gEl, PX + 12, y, PX + 12 + PW * 0.72, y, MID);
    line(gEl, PX + 12, y + rowH, PX + 12 + PW * (g % 2 ? 0.58 : 0.66), y + rowH, MID);
    line(gEl, PX + 12, y + rowH * 2, PX + 12 + PW * 0.34, y + rowH * 2, MID);
    paras.push({ y: y + rowH, el: gEl });
  }

  // markdown sheet: a heading tick (#) plus slots that fill as paragraphs peel
  const sheetLines = [];
  for (let i = 0; i < groups + 1; i += 1) {
    const y = SY + 18 + i * ((SH - 34) / groups);
    if (i === 0) {
      line(svg, SX + 12, y, SX + 20, y, HI, 1.4);        // the "#"
      line(svg, SX + 26, y, SX + 26 + SW2 * 0.5, y, HI, 1.4);
    } else {
      sheetLines.push(line(svg, SX + 12, y, SX + 12, y, LO, 1.1)); // grows when filled
    }
  }

  // the flame: a small leaf-shaped path that flickers between two poses
  const flame = svgEl(svg, 'path', { fill: 'none', stroke: HI, 'stroke-width': 1.3, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' });
  const flameD = (k) => `M 0 -11 C 5 -5 ${5 + k * 2} -1 0 6 C ${-5 - k * 2} -1 -5 -5 0 -11 Z`;

  const state = { raf: 0, t0: 0, destroyed: false };
  const LOOP = 14000;
  const frame = (now) => {
    if (state.destroyed) return;
    if (!state.t0) state.t0 = now;
    const t = ((now - state.t0) % LOOP) / LOOP;          // 0..1 down the page
    const fy = PY + 10 + t * (PH - 26);
    const fx = PX + PW + 10 + Math.sin(now / 260) * 1.6; // hover at the page's edge, flickering
    flame.setAttribute('d', flameD(Math.sin(now / 140) * 0.5));
    flame.setAttribute('transform', `translate(${fx} ${fy})`);

    let filled = 0;
    for (const p of paras) {
      const passed = fy > p.y;
      const fresh = passed && fy < p.y + 26;             // mid-peel: lifted and faded
      p.el.setAttribute('opacity', passed ? (fresh ? '0.35' : '0.15') : '1');
      p.el.setAttribute('transform', fresh ? 'translate(4 -2)' : 'translate(0 0)');
      if (passed) filled += 1;
    }
    for (let i = 0; i < sheetLines.length; i += 1) {
      const on = i < filled - 1;                          // the heading row is always there
      const w = on ? SW2 * (0.5 + 0.18 * (i % 3)) : 0.01;
      sheetLines[i].setAttribute('x2', SX + 12 + w);
      sheetLines[i].setAttribute('stroke', on ? HI : LO);
    }
    state.raf = requestAnimationFrame(frame);
  };

  if (reducedMotion()) {
    // rest pose: everything already read
    for (const p of paras) p.el.setAttribute('opacity', '0.15');
    for (let i = 0; i < sheetLines.length; i += 1) {
      sheetLines[i].setAttribute('x2', SX + 12 + SW2 * (0.5 + 0.18 * (i % 3)));
      sheetLines[i].setAttribute('stroke', HI);
    }
    flame.setAttribute('d', flameD(0));
    flame.setAttribute('transform', `translate(${PX + PW + 10} ${PY + PH - 14})`);
  } else {
    state.raf = requestAnimationFrame(frame);
  }

  return {
    update() {},
    destroy() {
      state.destroyed = true;
      if (state.raf) cancelAnimationFrame(state.raf);
      svg.remove();
      el.removeAttribute('data-hairline');
      el.removeAttribute('role');
      el.removeAttribute('aria-label');
    },
  };
}

// --------------------------------------------------------------------- cursor-tab
// A code panel of bars. The caret steps down; the two dashed suggestion lines
// below it turn solid (accepted) as it passes, with a small Tab keycap beside
// them. At the bottom the panel is fully accepted; it holds, then resets.
export function cursorTab(el, options = {}) {
  const svg = dress(el, 'cursor-tab', options.label || 'A caret over code; each suggested line it passes is accepted');
  const PX = 56, PY = 46, PW = 250, PH = 228;
  const rows = 8;
  const rowH = (PH - 28) / (rows - 1);
  const widths = [0.62, 0.5, 0.71, 0.44, 0.58, 0.66, 0.4, 0.54];

  rect(svg, PX, PY, PW, PH, EDGE, 1.2, 2);

  const bars = [];
  for (let i = 0; i < rows; i += 1) {
    const y = PY + 18 + i * rowH;
    line(svg, PX + 14, y, PX + 22, y, LO, 1);           // line number tick
    bars.push(line(svg, PX + 32, y, PX + 32 + PW * 0.6 * widths[i], y, LO, 1.1));
  }

  // the caret: a vertical bar with a small foot
  const caret = svgEl(svg, 'path', { fill: 'none', stroke: HI, 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke', 'stroke-linecap': 'round' });
  caret.setAttribute('d', 'M 0 -7 L 0 7 M 0 7 L 4 4');

  // the Tab keycap that rides beside the suggestion pair
  const key = svgEl(svg, 'g');
  rect(key, -16, -8, 32, 16, MID, 1.1, 3);
  line(key, -8, 0, 8, 0, MID, 1.1);
  line(key, 4, -4, 8, 0, MID, 1.1);
  line(key, 4, 4, 8, 0, MID, 1.1);

  const state = { raf: 0, t0: 0, destroyed: false };
  const STEP = 950;                                       // one line per step
  const HOLD = 1600;
  const frame = (now) => {
    if (state.destroyed) return;
    if (!state.t0) state.t0 = now;
    const cycle = rows * STEP + HOLD;
    const t = (now - state.t0) % cycle;
    const idx = Math.min(rows - 1, Math.floor(t / STEP));
    for (let i = 0; i < rows; i += 1) {
      const accepted = i <= idx;
      const suggested = !accepted && (i === idx + 1 || i === idx + 2);
      const b = bars[i];
      b.setAttribute('stroke', accepted ? HI : suggested ? EDGE : LO);
      b.setAttribute('stroke-dasharray', suggested ? '4 4' : 'none');
      b.setAttribute('opacity', accepted ? '1' : suggested ? '0.9' : '0.7');
    }
    const y = PY + 18 + idx * rowH;
    const bob = Math.sin(now / 180) * 1.2;
    caret.setAttribute('transform', `translate(${PX + 26} ${y + bob})`);
    const sugY = PY + 18 + Math.min(rows - 1, idx + 1) * rowH;
    key.setAttribute('transform', `translate(${PX + PW - 34} ${sugY})`);
    key.setAttribute('opacity', idx < rows - 2 ? '1' : '0');
    state.raf = requestAnimationFrame(frame);
  };

  if (reducedMotion()) {
    for (const b of bars) { b.setAttribute('stroke', HI); b.setAttribute('opacity', '1'); }
    caret.setAttribute('transform', `translate(${PX + 26} ${PY + 18 + (rows - 1) * rowH})`);
    key.setAttribute('opacity', '0');
  } else {
    state.raf = requestAnimationFrame(frame);
  }

  return {
    update() {},
    destroy() {
      state.destroyed = true;
      if (state.raf) cancelAnimationFrame(state.raf);
      svg.remove();
      el.removeAttribute('data-hairline');
      el.removeAttribute('role');
      el.removeAttribute('aria-label');
    },
  };
}
