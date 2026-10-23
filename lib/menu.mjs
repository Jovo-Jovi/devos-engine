import readline from "node:readline";

export function lineReader(input) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const pending = [];
  let done = false;
  let waiting = null;
  rl.on("line", (line) => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(line);
      return;
    }
    pending.push(line);
  });
  rl.on("close", () => {
    done = true;
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(null);
    }
  });
  const read = () => {
    if (pending.length > 0) return Promise.resolve(pending.shift());
    if (done) return Promise.resolve(null);
    return new Promise((resolve) => {
      waiting = resolve;
    });
  };
  read.pause = () => rl.pause();
  read.resume = () => rl.resume();
  return read;
}

function ended() {
  console.log("devos: input ended before setup finished");
  return null;
}

function invalid(title) {
  console.log(`devos: no valid answer for ${title}`);
  return undefined;
}

function sameText(left, right) {
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function matches(line, option) {
  if (sameText(line, option.label)) return true;
  const value = option.value;
  if (typeof value === "string" || typeof value === "number") return sameText(line, value);
  if (value && typeof value === "object" && typeof value.model === "string") {
    if (sameText(line, value.model)) return true;
    if (typeof value.tool === "string" && sameText(line, `${value.tool} ${value.model}`)) return true;
  }
  return false;
}

function oneMatch(line, options) {
  const text = line.trim();
  if (/^\d+$/.test(text)) {
    const number = Number(text);
    if (number >= 1 && number <= options.length) return options[number - 1].value;
    return undefined;
  }
  const found = options.filter((option) => matches(text, option));
  if (found.length === 1) return found[0].value;
  return undefined;
}

function printOptions(stdout, title, options, defaultText) {
  stdout.write(`${title}\n`);
  options.forEach((option, index) => {
    stdout.write(`  ${index + 1}) ${option.label}\n`);
  });
  stdout.write(`[default: ${defaultText}]\n`);
}

export async function select(read, stdout, { title, options, defaultIndex = 0 }) {
  const index = options.length === 0 ? 0 : Math.min(Math.max(defaultIndex, 0), options.length - 1);
  printOptions(stdout, title, options, String(index + 1));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const line = await read();
    if (line === null) return ended();
    if (line.trim() === "") return options[index].value;
    const value = oneMatch(line, options);
    if (value !== undefined) return value;
  }
  return invalid(title);
}

export async function multiSelect(read, stdout, { title, options, defaultIndexes = [], emptyAllowed = false }) {
  const indexes = defaultIndexes.filter((item) => item >= 0 && item < options.length);
  const defaultText = indexes.length > 0 ? indexes.map((item) => item + 1).join(", ") : "none";
  printOptions(stdout, title, options, defaultText);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const line = await read();
    if (line === null) return ended();
    if (line.trim() === "") {
      if (indexes.length === 0 && emptyAllowed) return [];
      if (indexes.length > 0) return indexes.map((item) => options[item].value);
      if (emptyAllowed) return [];
    } else {
      const parts = line.split(",").map((part) => part.trim()).filter(Boolean);
      const values = [];
      let bad = false;
      for (const part of parts) {
        const value = oneMatch(part, options);
        if (value === undefined) {
          bad = true;
          break;
        }
        values.push(value);
      }
      if (!bad && (values.length > 0 || emptyAllowed)) return values;
    }
  }
  return invalid(title);
}

export async function text(read, stdout, { title, accept }) {
  stdout.write(`${title}\n`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const line = await read();
    if (line === null) return ended();
    const value = accept(line);
    if (value !== undefined) return value;
  }
  return invalid(title);
}

export async function confirm(read, stdout, title, defaultYes = true) {
  const expected = defaultYes ? "yes" : "no";
  stdout.write(`${title} (yes/no) [${expected}]: `);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const line = await read();
    if (line === null) return ended();
    const value = line.trim() === "" ? expected : line.trim().toLowerCase();
    if (value === "yes" || value === "no") return value === "yes";
  }
  return invalid(title);
}

export async function secret(read, stdout, title) {
  stdout.write(`${title}`);
  const tty = typeof read.isTTY === "boolean" ? read.isTTY : Boolean(process.stdin.isTTY);
  if (!tty) {
    const line = await read();
    if (line === null) return ended();
    return line;
  }
  if (typeof read.pause === "function") read.pause();
  const stdin = read.stream ?? process.stdin;
  let raw = false;
  const restore = () => {
    if (raw && typeof stdin.setRawMode === "function") {
      stdin.setRawMode(false);
      raw = false;
    }
    if (typeof read.resume === "function") read.resume();
  };
  try {
    if (typeof stdin.setRawMode === "function") stdin.setRawMode(true);
    raw = true;
    let value = "";
    return await new Promise((resolve) => {
      const onData = (buf) => {
        const text = buf.toString("utf8");
        for (const ch of text) {
          if (ch === "\u0003") {
            stdin.removeListener("data", onData);
            restore();
            process.exit(130);
          }
          if (ch === "\u0008" || ch === "\u007f") {
            if (value.length > 0) {
              value = value.slice(0, -1);
              stdout.write("\b \b");
            }
            continue;
          }
          if (ch === "\r" || ch === "\n") {
            stdin.removeListener("data", onData);
            stdout.write("\n");
            restore();
            resolve(value);
            return;
          }
          value += ch;
          stdout.write("*");
        }
      };
      stdin.on("data", onData);
      if (typeof stdin.resume === "function") stdin.resume();
    });
  } finally {
    restore();
  }
}
