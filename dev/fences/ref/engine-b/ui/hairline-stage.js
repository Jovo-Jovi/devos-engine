// The run stage: one hairline figure at a time, rotating while the model works.
// The five figures — Terminal, firecrawl-reader, Cabinet, cursor-tab, Slow —
// were picked from hairline.lucasmarkes.com (figures + skills). Each plays on
// its own; when one has had its turn (or the run enters a new phase) the stage
// switches to the next one, so the writing phase cycles through all of them.
// This is a plain ES module: index.html loads it before app.js, and app.js
// talks to it through window.DEVOS_FIGURES (mount / setPhase / stop).

import { terminal, cabinet, slow } from './hairline.js';
import { firecrawlReader, cursorTab } from './hairline-custom.js';

const FIGURES = [
  { id: 'terminal', name: 'Terminal', make: terminal },
  { id: 'firecrawl-reader', name: 'firecrawl-reader', make: firecrawlReader },
  { id: 'cabinet', name: 'Cabinet', make: cabinet },
  { id: 'cursor-tab', name: 'cursor-tab', make: cursorTab },
  { id: 'slow', name: 'Slow', make: slow },
];

const TURN_MS = 20000; // one figure's turn before the next takes over

const stage = {
  el: null,        // the #run-figure element, while the run view is on screen
  instance: null,  // the mounted figure's { update, destroy }
  index: 0,
  timer: null,
  caption: null,
};

function show(i) {
  if (!stage.el || !stage.el.isConnected) return;
  if (stage.instance) { try { stage.instance.destroy(); } catch { /* the next one still mounts */ } stage.instance = null; }
  const fig = FIGURES[((i % FIGURES.length) + FIGURES.length) % FIGURES.length];
  stage.index = ((i % FIGURES.length) + FIGURES.length) % FIGURES.length;
  try {
    stage.instance = fig.make(stage.el, { play: true });
    if (stage.caption) stage.caption.textContent = `${fig.name} — ${FIGURES.length} figures rotate while the model works`;
  } catch { /* a figure that cannot mount must never break the run view */ }
}

function schedule() {
  if (stage.timer) clearInterval(stage.timer);
  stage.timer = setInterval(() => show(stage.index + 1), TURN_MS);
  stage.timer.unref?.();
}

export function mountStage(el) {
  if (!el) return;
  stage.el = el;
  stage.caption = el.ownerDocument.getElementById('run-figure-cap');
  show(stage.index);
  schedule();
}

export function setPhase(name) {
  // A phase change is a visible beat in the run — take the next figure now.
  if (!stage.el || !stage.el.isConnected) return;
  show(stage.index + 1);
}

export function stopStage() {
  if (stage.timer) { clearInterval(stage.timer); stage.timer = null; }
  if (stage.instance) { try { stage.instance.destroy(); } catch { /* already gone */ } stage.instance = null; }
  stage.el = null;
  stage.caption = null;
}

window.DEVOS_FIGURES = { mount: mountStage, setPhase, stop: stopStage };
document.dispatchEvent(new CustomEvent('devos:figures-ready'));
