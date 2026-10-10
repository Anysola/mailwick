// Downloads a Material Symbols Rounded subset with only the icons listed in src/lib/icon-names.json.
// After using a new icon, add it to that list and run `npm run icons`; the font is written to public/fonts and committed.
import { readFile, writeFile, mkdir } from "node:fs/promises";

const names = JSON.parse(await readFile(new URL("../src/lib/icon-names.json", import.meta.url), "utf8")).sort();
const url =
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" +
  `&icon_names=${names.join(",")}&display=block`;
// a modern browser user agent is needed to get woff2 back
const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const css = await (await fetch(url, { headers: { "User-Agent": ua } })).text();
const src = css.match(/src:\s*url\(([^)]+)\)\s*format\('woff2'\)/)?.[1];
if (!src) throw new Error("woff2 URL not found:\n" + css.slice(0, 400));
const font = Buffer.from(await (await fetch(src)).arrayBuffer());
await mkdir(new URL("../public/fonts/", import.meta.url), { recursive: true });
await writeFile(new URL("../public/fonts/material-symbols-rounded.woff2", import.meta.url), font);
console.log(`${names.length} icons, ${(font.length / 1024).toFixed(1)} KB`);
