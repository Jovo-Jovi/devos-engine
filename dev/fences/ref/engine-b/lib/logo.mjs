// The DEV_OS wordmark. Block glyphs only (they exist in every terminal code page
// that ships with Windows, macOS, and Linux). Color is added only when the
// stream is a real terminal; piped or redirected output stays plain.

const LETTERS = {
  D: [
    '██████╗ ',
    '██╔══██╗',
    '██║  ██║',
    '██║  ██║',
    '██████╔╝',
    '╚═════╝ ',
  ],
  E: [
    '███████╗',
    '██╔════╝',
    '█████╗  ',
    '██╔══╝  ',
    '███████╗',
    '╚══════╝',
  ],
  V: [
    '██╗   ██╗',
    '██║   ██║',
    '██║   ██║',
    '╚██╗ ██╔╝',
    ' ╚████╔╝ ',
    '  ╚═══╝  ',
  ],
  O: [
    ' ██████╗ ',
    '██╔═══██╗',
    '██║   ██║',
    '██║   ██║',
    '╚██████╔╝',
    ' ╚═════╝ ',
  ],
  S: [
    '███████╗',
    '██╔════╝',
    '███████╗',
    '╚════██║',
    '███████║',
    '╚══════╝',
  ],
};

function paint(text, stream) {
  const tty = stream && stream.isTTY;
  const dumb = process.env.TERM === 'dumb' || process.env.NO_COLOR;
  // Modern Windows terminals (Windows Terminal, VS Code) advertise themselves;
  // legacy conhost does not, so color stays off there to avoid escape garbage.
  const winOk = process.env.WT_SESSION || process.env.TERM_PROGRAM || process.env.ANSICON;
  if (!tty || dumb || (process.platform === 'win32' && !winOk)) return text;
  // Warm accent (matches the guided UI's #e8a15a), dim rule lines.
  return text
    .replace(/█/g, '\x1b[38;2;232;161;90m█\x1b[0m')
    .replace(/[╔╗╚╝║═]/g, (c) => `\x1b[2m${c}\x1b[0m`);
}

export function renderLogo(stream = process.stdout) {
  const word = ['D', 'E', 'V', null, 'O', 'S']; // null = the gap in DEV_OS
  const rows = [];
  for (let r = 0; r < 6; r++) {
    rows.push(word.map((ch) => (ch ? LETTERS[ch][r] : '    ')).join(' '));
  }
  const art = rows.join('\n');
  return `${paint(art, stream)}\n  build once here — GitHub Actions builds the rest\n`;
}
