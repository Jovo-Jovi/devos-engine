// guard:design — logical properties only, tokens only, no third-party hosts (DESIGN_SYSTEM, I18N_MODEL §4).
import { existsSync, readFileSync } from "node:fs";
import { hasSrc, srcFiles, scan, result } from "./lib.mjs";
import { P } from "../devos/lib.mjs";

const TOKENS = "src/styles/tokens.css";

const CSS_RULES = [
  { re: /(^|[\s;{])(margin|padding|border)-(left|right)(-[a-z]+)?\s*:/, label: "physical property (use *-inline-start/end)" },
  { re: /(^|[\s;{])(left|right)\s*:/, label: "physical inset (use inset-inline-start/end)" },
  { re: /text-align\s*:\s*(left|right)\b/, label: "physical text-align (use start/end)" },
  { re: /float\s*:\s*(left|right)\b/, label: "physical float (use inline-start/end)" },
  { re: /border-(top|bottom)-(left|right)-radius/, label: "physical radius (use border-start-start-radius etc.)" },
  { re: /#[0-9a-fA-F]{3,8}\b/, label: "raw colour (use a --color-* token)" },
  { re: /\b(rgba?|hsla?|oklch|oklab|lab|lch)\(/, label: "raw colour function (use a token)" },
  { re: /(?<![\w-])(?!1px\b)\d*\.?\d+px\b/, label: "raw px value (use a --space-*/--radius-* token; 1px hairlines allowed)" },
];
const TSX_RULES = [
  { re: /\b(marginLeft|marginRight|paddingLeft|paddingRight|borderLeft|borderRight)\b/, label: "physical style prop" },
  { re: /\btextAlign\s*:\s*["'](left|right)["']/, label: "physical textAlign" },
];
function readSetting(path, check) {
  const file = existsSync(P("devos.config.json")) ? "devos.config.json" : "devos/engine.defaults.json";
  let cur = JSON.parse(readFileSync(P(file), "utf8"));
  for (const key of path) {
    if (cur === null || typeof cur !== "object" || !Object.hasOwn(cur, key)) throw new Error(`config: ${path.join(".")} missing`);
    cur = cur[key];
  }
  if (!check(cur)) throw new Error(`config: ${path.join(".")} missing`);
  return cur;
}

function hostRule(hosts) {
  const listed = hosts.map((host) => host.replace(/\./g, "\\.")).join("|");
  const extra = listed ? `|(?:${listed})(?![\\w.-])` : "";
  return [{ re: new RegExp(`https?:\\/\\/(?!localhost\\b|127\\.0\\.0\\.1\\b${extra})[^\\s"'\`)]+`), label: "third-party host" }];
}

export default function design() {
  const hosts = readSetting(["guards", "design", "allowed_hosts"], Array.isArray);
  const HOST_RULE = hostRule(hosts);
  if (!hasSrc()) return result("N/A", [], "src/ does not exist yet");
  const css = srcFiles([".css"]).filter((f) => f !== TOKENS);
  const code = srcFiles([".ts", ".tsx"]);
  const findings = [
    ...scan(css, CSS_RULES),
    ...scan(code, TSX_RULES),
    ...scan([...css, ...code], HOST_RULE),
  ];
  return result(findings.length ? "FAIL" : "PASS", findings, `${css.length} css, ${code.length} ts/tsx`);
}
