import { readdirSync } from "node:fs";
import path from "node:path";

function countDocs(folder) {
  const root = path.join(folder, "docs");
  let count = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else count += 1;
    }
  };
  walk(root);
  return count;
}

export function heartbeat({ label, folder, everyMs, now }) {
  const fromEnv = Number(process.env.DEVOS_HEARTBEAT_MS);
  const interval = everyMs ?? (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 60000);
  const clock = typeof now === "function" ? now : () => Date.now();
  let timer = null;
  let started = 0;
  const tick = () => {
    const minutes = Math.floor(Math.max(0, clock() - started) / 60000);
    const files = countDocs(folder);
    console.log(`devos: ${label} · ${minutes} min · ${files} files under docs/`);
  };
  return {
    start() {
      started = clock();
      timer = setInterval(tick, interval);
      if (typeof timer.unref === "function") timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
