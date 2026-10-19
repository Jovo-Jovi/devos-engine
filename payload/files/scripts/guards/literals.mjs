// guard:literals — business contact data lives in content/, never as literals in source (Dev OS §7).
import { hasSrc, srcFiles, scan, result } from "./lib.mjs";

const RULES = [
  { re: /(?<![\w-])\+?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}(?![\w-])/, label: "phone-like literal" },
  { re: /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, label: "email literal" },
];

export default function literals() {
  if (!hasSrc()) return result("N/A", [], "src/ does not exist yet");
  const files = srcFiles([".ts", ".tsx", ".json"]).filter((f) => !/\.test\.tsx?$/.test(f) && !f.includes("/__fixtures__/"));
  const findings = scan(files, RULES);
  return result(findings.length ? "FAIL" : "PASS", findings, `${files.length} files scanned`);
}
