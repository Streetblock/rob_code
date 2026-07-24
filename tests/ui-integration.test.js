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
    "lib/rob-code-v2-raster-sampler.js",
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
  assert.match(html, /data-action="download-svg"/);
  assert.match(html, /data-action="download-png"/);
  assert.match(html, /name="code_upload"[^>]*accept="image\/svg\+xml,image\/png,image\/jpeg,\.svg,\.png,\.jpg,\.jpeg"/);
  assert.match(html, /data-action="use-decoded"/);
});

test("keeps the controller object-oriented and importable without a browser", () => {
  assert.equal(typeof RoBCodeApp, "function");
  assert.equal(typeof RoBCodeApp.prototype.drawVersion2, "function");
  assert.equal(typeof RoBCodeApp.prototype.drawLegacy, "function");
  assert.equal(typeof RoBCodeApp.prototype.downloadSvg, "function");
  assert.equal(typeof RoBCodeApp.prototype.downloadPng, "function");
  assert.equal(typeof RoBCodeApp.prototype.decodeFile, "function");
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

test("shows JPEG erasure recovery diagnostics", () => {
  const app = Object.create(RoBCodeApp.prototype);
  app.decodePanel = { dataset: {} };
  app.decodeBadge = { textContent: "" };
  app.decodeStatus = { textContent: "" };
  app.decodeSummary = { textContent: "" };
  app.decodedPayload = { value: "" };
  app.decodePreviewNote = { textContent: "" };
  app.useDecodedButton = { hidden: true };
  app.decodeResult = { hidden: true };

  app.showDecodedResult({
    source: "raster",
    text: "RoBCode 2",
    payload: Uint8Array.of(1, 2),
    correctedSymbols: 1,
    erasureSymbols: 14,
    parityFailures: [3],
    outerDataRing: 10
  }, "photo.jpg", "jpeg");

  assert.match(app.decodeStatus.textContent, /valid RoBCode 2 JPEG/);
  assert.match(app.decodeSummary.textContent, /14 frame erasures/);
  assert.equal(app.decodeBadge.textContent, "Verified");
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

  await app.decodeFile({
    name: "valid.svg",
    type: "image/svg+xml",
    size: 6,
    async text() { return "<svg/>"; }
  });

  assert.deepEqual(shown, { decoded: expected, name: "valid.svg" });
});

test("routes PNG files through canvas image data and the raster sampler", async () => {
  const app = Object.create(RoBCodeApp.prototype);
  const imageData = { width: 100, height: 100, data: new Uint8ClampedArray(40000) };
  const expected = { source: "raster", text: "png", payload: Uint8Array.of(), parityFailures: [] };
  let shown = null;
  app.decodeResult = { hidden: false };
  app.useDecodedButton = { hidden: false };
  app.decodePanel = { dataset: {} };
  app.decodeBadge = { textContent: "" };
  app.decodeStatus = { textContent: "" };
  app.imageDataFromImage = async (file, kind) => {
    assert.equal(kind, "png");
    return imageData;
  };
  app.rasterSampler = {
    decodeImageData(actual) { assert.equal(actual, imageData); return expected; }
  };
  app.showDecodedResult = (decoded, name) => { shown = { decoded, name }; };

  await app.decodeFile({ name: "valid.png", type: "image/png", size: 100 });
  assert.deepEqual(shown, { decoded: expected, name: "valid.png" });
});

test("routes JPEG photos through canvas image data and the raster sampler", async () => {
  const app = Object.create(RoBCodeApp.prototype);
  const imageData = { width: 100, height: 100, data: new Uint8ClampedArray(40000) };
  const expected = { source: "raster", text: "jpeg", payload: Uint8Array.of(), parityFailures: [] };
  let shown = null;
  app.decodeResult = { hidden: false };
  app.useDecodedButton = { hidden: false };
  app.decodePanel = { dataset: {} };
  app.decodeBadge = { textContent: "" };
  app.decodeStatus = { textContent: "" };
  app.imageDataFromImage = async (file, kind) => {
    assert.equal(kind, "jpeg");
    return imageData;
  };
  app.rasterSampler = {
    decodeImageData(actual) { assert.equal(actual, imageData); return expected; }
  };
  app.showDecodedResult = (decoded, name, kind) => { shown = { decoded, name, kind }; };

  await app.decodeFile({ name: "photo.jpeg", type: "image/jpeg", size: 100 });
  assert.deepEqual(shown, { decoded: expected, name: "photo.jpeg", kind: "jpeg" });
});

test("recognizes SVG, PNG, and JPEG file types", () => {
  const app = Object.create(RoBCodeApp.prototype);
  assert.equal(app.detectFileKind({ name: "code.svg", type: "" }), "svg");
  assert.equal(app.detectFileKind({ name: "code.bin", type: "image/png" }), "png");
  assert.equal(app.detectFileKind({ name: "photo.jpg", type: "" }), "jpeg");
  assert.equal(app.detectFileKind({ name: "photo.bin", type: "image/jpeg" }), "jpeg");
  assert.equal(app.detectFileKind({ name: "photo.jpeg", type: "" }), "jpeg");
  assert.throws(() => app.detectFileKind({ name: "code.gif", type: "image/gif" }), /SVG, PNG, or JPEG/);
});

test("upscales PNG export to at least eight pixels per module", async () => {
  const app = Object.create(RoBCodeApp.prototype);
  const cloneAttributes = { viewBox: "0 0 200 200" };
  const clone = {
    setAttribute(name, value) { cloneAttributes[name] = String(value); },
    getAttribute(name) { return cloneAttributes[name] || null; }
  };
  const context = {
    fillStyle: "",
    fillRect() {},
    drawImage() {}
  };
  const canvas = { width: 0, height: 0, getContext() { return context; } };
  const expectedBlob = { type: "image/png" };
  app.svg = {
    cloneNode() { return clone; },
    getAttribute(name) { return name === "width" ? "200" : null; }
  };
  app.form = { elements: { mode: { value: "v2" }, module_size: { value: "4" } } };
  app.document = { createElement(name) { assert.equal(name, "canvas"); return canvas; } };
  app.loadImageBlob = async () => ({ width: 400, height: 400 });
  app.canvasToBlob = async (actualCanvas, type) => {
    assert.equal(actualCanvas, canvas);
    assert.equal(type, "image/png");
    return expectedBlob;
  };

  const PreviousXmlSerializer = global.XMLSerializer;
  global.XMLSerializer = class { serializeToString() { return "<svg/>"; } };
  try {
    assert.equal(await app.renderPngBlob(), expectedBlob);
  } finally {
    global.XMLSerializer = PreviousXmlSerializer;
  }
  assert.equal(canvas.width, 400);
  assert.equal(canvas.height, 400);
  assert.equal(cloneAttributes.width, "400");
  assert.equal(cloneAttributes.height, "400");
});
