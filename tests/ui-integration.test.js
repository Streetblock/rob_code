const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const RoBCodeApp = require("../app.js");

const projectRoot = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(projectRoot, "app.js"), "utf8");

test("loads legacy, encoder, renderer, and app scripts in dependency order", () => {
  const scripts = [
    "lib/rob-code.js",
    "lib/rob-code-v2.js",
    "lib/rob-code-v2-svg.js",
    "app.js"
  ];
  const positions = scripts.map(script => html.indexOf(`src="${script}"`));

  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
});

test("exposes both generator modes and the SVG download control", () => {
  assert.match(html, /name="mode" value="v2" checked/);
  assert.match(html, /name="mode" value="legacy"/);
  assert.match(html, /data-mode-section="v2"/);
  assert.match(html, /data-mode-section="legacy" hidden/);
  assert.match(html, /data-action="download"/);
});

test("keeps the controller object-oriented and importable without a browser", () => {
  assert.equal(typeof RoBCodeApp, "function");
  assert.equal(typeof RoBCodeApp.prototype.drawVersion2, "function");
  assert.equal(typeof RoBCodeApp.prototype.drawLegacy, "function");
  assert.equal(typeof RoBCodeApp.prototype.downloadSvg, "function");
});

test("provides every named form field used by the controller", () => {
  const fieldNames = [...appSource.matchAll(/fields\.([a-z0-9_]+)/g)]
    .map(match => match[1])
    .filter((name, index, names) => names.indexOf(name) === index);

  for (const name of fieldNames) {
    assert.match(html, new RegExp(`name="${name}"`), `missing form field ${name}`);
  }
});
