// guard:boundary — nothing accepts, stores or sends visitor data (BOUNDARY_MODEL §2, non-waivable).
//
// Zones (PR-19): a signed OD may open named zones (a staff dashboard, a member area) where forms,
// cookies and route handlers are allowed. They are declared in one machine-readable line of
// docs/BOUNDARY_MODEL.md:
//   <!-- devos:boundary {"profile":"A","zones":[{"name":"operator","src":["src/app/[locale]/staff/**"],"urls":["/staff"],"personal_data":false}]} -->
// Everything outside a zone keeps the full rule. Analytics and third-party scripts are never
// allowed by a zone. A zone with personal_data:true requires docs/PROTECTION_MODEL.md (handbook
// §10.3, the Personal-Data Protection gate).
import { hasSrc, srcFiles, walk, scan, result, exists, read } from "./lib.mjs";

const ZONE_RULES = [
  { re: /<(form|input|textarea|select)\b/i, label: "form control" },
  { re: /\bdocument\.cookie\b|\bcookies\(\)/, label: "cookie access" },
  { re: /\b(localStorage|sessionStorage|indexedDB)\b/, label: "browser storage" },
];
const ALWAYS_RULES = [
  { re: /\bsendBeacon\b/, label: "beacon" },
  { re: /posthog|@sentry\/|gtag\(|googletagmanager|google-analytics|plausible|mixpanel|segment\.com/i, label: "analytics / tracker" },
];
// Framework-owned pages Next.js generates itself. `_global-error.html` contains a "try again" <form>
// that posts nothing; it is excluded and named in the guard's note so the exclusion is visible.
const FRAMEWORK_HTML = new Set([".next/server/app/_global-error.html"]);
const HTML_FORM = [{ re: /<(form|input|textarea|select)\b/i, label: "form control in built HTML" }];
const HTML_ALWAYS = [{ re: /<script[^>]+src=["']https?:\/\//i, label: "third-party script in built HTML" }];

function globToRe(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") { re += ".*"; i++; if (glob[i + 1] === "/") i++; }
    else if (c === "*") re += "[^/]*";
    else re += c.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function boundaryConfig() {
  const fallback = { profile: "A", zones: [] };
  if (!exists("docs/BOUNDARY_MODEL.md")) return fallback;
  const m = /<!--\s*devos:boundary\s+(\{[\s\S]*?\})\s*-->/.exec(read("docs/BOUNDARY_MODEL.md"));
  if (!m) return fallback;
  const cfg = JSON.parse(m[1]);
  return { profile: cfg.profile ?? "A", zones: (cfg.zones ?? []).map((z) => ({ ...z, srcRe: (z.src ?? []).map(globToRe) })) };
}

export default function boundary() {
  if (!hasSrc()) return result("N/A", [], "src/ does not exist yet");
  let cfg;
  try { cfg = boundaryConfig(); } catch (e) { return result("FAIL", [`docs/BOUNDARY_MODEL.md — the devos:boundary line is not valid JSON: ${e.message}`]); }
  const inZone = (f) => cfg.zones.find((z) => z.srcRe.some((re) => re.test(f)));
  const files = srcFiles([".ts", ".tsx", ".js", ".jsx"]);
  const findings = [
    ...scan(files.filter((f) => !inZone(f)), ZONE_RULES),
    ...scan(files, ALWAYS_RULES),
  ];
  for (const f of walk("src/app")) {
    if (/\/route\.(t|j)sx?$/.test(f) && !inZone(f)) findings.push(`${f} — route handler outside a declared zone`);
  }
  if (cfg.zones.some((z) => z.personal_data) && !exists("docs/PROTECTION_MODEL.md")) {
    findings.push("docs/PROTECTION_MODEL.md — a zone holds personal data, so the Personal-Data Protection model is required (handbook §10.3)");
  }

  const allHtml = walk(".next/server/app").filter((f) => f.endsWith(".html"));
  const html = allHtml.filter((f) => !FRAMEWORK_HTML.has(f));
  const urlOf = (f) => f.slice(".next/server/app".length).replace(/\.html$/, "").replace(/^\/[a-z]{2}(?:-[A-Za-z]{2,4})?(?=\/|$)/, "") || "/";
  const htmlInZone = (f) => cfg.zones.some((z) => (z.urls ?? []).some((u) => urlOf(f) === u || urlOf(f).startsWith(`${u}/`)));
  findings.push(...scan(html.filter((f) => !htmlInZone(f)), HTML_FORM, { skipComments: false }));
  findings.push(...scan(html, HTML_ALWAYS, { skipComments: false }));

  const skipped = allHtml.length - html.length;
  const zones = cfg.zones.length ? `; zones: ${cfg.zones.map((z) => z.name + (z.personal_data ? " (personal data)" : "")).join(", ")}` : "";
  const note = (allHtml.length
    ? `${html.length} built HTML files scanned${skipped ? `, ${skipped} framework-owned skipped (_global-error)` : ""}`
    : "no build present; source only") + `; profile ${cfg.profile}${zones}`;
  return result(findings.length ? "FAIL" : "PASS", findings, note);
}
