// Checks every locale file against en.json: missing/extra keys, placeholders and plural "other" forms.
// Usage: npm run i18n:check
import { readFile, readdir } from "node:fs/promises";

const dir = new URL("../src/i18n/messages/", import.meta.url);
const en = JSON.parse(await readFile(new URL("en.json", dir), "utf8"));

const isPlural = (v) => v && typeof v === "object" && typeof v.other === "string";
function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string" || isPlural(v)) out[key] = v;
    else if (v && typeof v === "object") flatten(v, key, out);
  }
  return out;
}
const vars = (v) => new Set([...(typeof v === "string" ? [v] : Object.values(v)).join(" ").matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

const base = flatten(en);
let problems = 0;
for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json") && f !== "en.json").sort()) {
  const tr = flatten(JSON.parse(await readFile(new URL(file, dir), "utf8")));
  const issues = [];
  for (const [k, v] of Object.entries(base)) {
    if (!(k in tr)) issues.push(`missing ${k}`);
    else if (isPlural(v) !== isPlural(tr[k])) issues.push(`plural mismatch ${k}`);
    else {
      const want = vars(v);
      const got = vars(tr[k]);
      for (const x of want) if (!got.has(x) && x !== "count") issues.push(`${k} lacks {${x}}`);
      for (const x of got) if (!want.has(x)) issues.push(`${k} has unknown {${x}}`);
    }
  }
  for (const k of Object.keys(tr)) if (!(k in base)) issues.push(`extra ${k}`);
  console.log(`${file.padEnd(11)} ${issues.length ? `${issues.length} issue(s)` : "ok"}`);
  issues.slice(0, 20).forEach((i) => console.log("   " + i));
  problems += issues.length;
}
process.exit(problems ? 1 : 0);
