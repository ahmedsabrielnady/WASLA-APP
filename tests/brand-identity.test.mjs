import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("WASLA brand uses the Latin W monogram across the main app surfaces", () => {
  const app = read("../src/main.js");
  assert.match(app, /brand-mark" aria-hidden="true"><span>W<\/span>/);
  assert.match(app, /hero-monogram">W<\/span>/);
  assert.match(app, /hero-wordmark">WASLA<\/span>/);
  assert.match(app, /footer-brand.*WASLA/s);
  assert.doesNotMatch(app, /brand-mark">و/);
  assert.doesNotMatch(app, /hero-logo">و/);
});

test("WASLA brand tokens preserve emerald and deep navy contrast", () => {
  const css = read("../styles.css");
  assert.match(css, /--green:\s*#00a878/i);
  assert.match(css, /--navy:\s*#09263b/i);
  assert.match(css, /WASLA identity system/);
  assert.match(css, /prefers-reduced-motion/);
});

test("browser title and PWA theme use the WASLA wordmark identity", () => {
  const html = read("../index.html");
  const manifest = read("../manifest.webmanifest");
  const icon = read("../wasla-icon.svg");
  assert.match(html, /WASLA \| وصلة/);
  assert.match(manifest, /"theme_color": "#087b61"/);
  assert.match(icon, /fill="url\(#mark\)"/);
});
