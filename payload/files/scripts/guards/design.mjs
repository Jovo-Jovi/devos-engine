// guard:design — logical properties only, tokens only, no third-party hosts (DESIGN_SYSTEM, I18N_MODEL §4).
import { hasSrc, srcFiles, scan, result } from "./lib.mjs";

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
// Tower configuration (docs/DESIGN_SYSTEM.md §5, PR-34): the Tower must name GitHub origins in code. Allowed hosts:
//   github.com                          — evidence links `https://github.com/<repo>/blob/<commit>/<path>` (EvidenceLink)
//   avatars.githubusercontent.com       — the owner's GitHub avatar origin in the CSP `img-src`
//   token.actions.githubusercontent.com — the OIDC issuer and JWKS the ingestion route verifies against
// Any other host is still a finding. A new host is a method change (PR-28), not an edit here.
const ALLOWED_HOSTS = ["github.com", "avatars.githubusercontent.com", "token.actions.githubusercontent.com"];
const HOST_RULE = [{ re: new RegExp(`https?:\\/\\/(?!localhost\\b|127\\.0\\.0\\.1\\b|(?:${ALLOWED_HOSTS.map((h) => h.replace(/\./g, "\\.")).join("|")})(?![\\w.-]))[^\\s"'\`)]+`), label: "third-party host" }];

export default function design() {
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
