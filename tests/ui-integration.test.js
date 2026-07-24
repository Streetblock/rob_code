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
    "lib/rob-code-v2-decoder.js",
    "lib/rob-code-v2-svg.js",
    "lib/rob-code-v2-svg-importer.js",
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
  assert.match(html, /name="svg_upload"[^>]*accept="image\/svg\+xml,\.svg"/);
  assert.match(html, /data-action="use-decoded"/);
});

test("keeps the controller object-oriented and importable without a browser", () => {
  assert.equal(typeof RoBCodeApp, "function");
  assert.equal(typeof RoBCodeApp.prototype.drawVersion2, "function");
  assert.equal(typeof RoBCodeApp.prototype.drawLegacy, "function");
  assert.equal(typeof RoBCodeApp.prototype.downloadSvg, "function");
  assert.equal(typeof RoBCodeApp.prototype.decodeSvgFile, "function");
  assert.equal(typeof RoBCodeApp.prototype.showDecodedResult, "function");
});

test("provides every named form field used by the controller", () => {
  const fieldNames = [...appSource.matchAll(/fields\.([a-z0-9_]+)/g)]
    .map(match => match[1])
    .filter((name, index, names) => names.indexOf(name) === index);

  for (const name of fieldNames) {
    assert.match(html, new RegExp(`name="${name}"`), `missing form field ${name}`);
  }
});

test("formats decoded text and binary payloads without injecting markup", () => {
  const app = Object.create(RoBCodeApp.prototype);
  const textPreview = app.formatDecodedPayload({ text: "<b>plain text</b>", payload: Uint8Array.of() });
  const binaryPreview = app.formatDecodedPayload({ text: null, payload: Uint8Array.of(0, 15, 255) });

  assert.equal(textPreview.value, "<b>plain text</b>");
  assert.equal(binaryPreview.value, "00 0f ff");
});

test("reads an SVG file and forwards only validated importer output", async () => {
  const app = Object.create(RoBCodeApp.prototype);
  const expected = { text: "decoded", payload: Uint8Array.of(1), parityFailures: [] };
  let shown = null;
  app.decodeResult = { hidden: false };
  app.useDecodedButton = { hidden: false };
  app.decodePanel = { dataset: {} };
  app.decodeBadge = { textContent: "" };
  app.decodeStatus = { textContent: "" };
  app.svgImporter = { importString(source) { assert.equal(source, "<svg/>"); return expected; } };
  app.showDecodedResult = (decoded, name) => { shown = { decoded, name }; };

  await app.decodeSvgFile({
    name: "valid.svg",
    type: "image/svg+xml",
    size: 6,
    async text() { return "<svg/>"; }
  });

  assert.deepEqual(shown, { decoded: expected, name: "valid.svg" });
});
