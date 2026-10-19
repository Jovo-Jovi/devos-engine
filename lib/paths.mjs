function assertPosix(value, name) {
  if (typeof value !== "string" || value.includes("\\")) {
    throw new Error(`${name} expects a POSIX path`);
  }
}

export function toStored(installed) {
  assertPosix(installed, "toStored");
  return installed.split("/").map((segment) => {
    if (segment.startsWith("dot-")) {
      throw new Error(`installed segment already starts with dot-: ${segment}`);
    }
    if (segment.startsWith(".")) return `dot-${segment.slice(1)}`;
    return segment;
  }).join("/");
}

export function toInstalled(stored) {
  assertPosix(stored, "toInstalled");
  return stored.split("/").map((segment) => {
    if (segment.startsWith("dot-")) return `.${segment.slice(4)}`;
    return segment;
  }).join("/");
}
