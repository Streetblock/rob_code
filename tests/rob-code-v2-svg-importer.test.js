const test = require("node:test");
const assert = require("node:assert/strict");
const RoBCode2SvgRenderer = require("../lib/rob-code-v2-svg.js");
const RoBCode2SvgImporter = require("../lib/rob-code-v2-svg-importer.js");

function fakeSvg() {
  return {
    localName: "svg",
    attributeMap: {},
    children: [],
    setAttribute(key, value) { this.attributeMap[key] = String(value); },
    getAttribute(key) { return this.attributeMap[key] ?? null; },
    appendChild(element) { this.children.push(element); },
    removeChild(element) { this.children.splice(this.children.indexOf(element), 1); },
    querySelectorAll(selector) {
      return selector === "[data-role]"
        ? this.children.filter(child => child.attributeMap["data-role"] !== undefined)
        : [];
    },
    get attributes() {
      return Object.entries(this.attributeMap).map(([name, value]) => ({ name, value }));
    },
    get lastChild() { return this.children.at(-1) || null; }
  };
}

global.document = {
  createElementNS(_namespace, name) {
    return {
      localName: name,
      attributeMap: {},
      setAttribute(key, value) { this.attributeMap[key] = String(value); },
      getAttribute(key) { return this.attributeMap[key] ?? null; },
      get attributes() {
        return Object.entries(this.attributeMap).map(([attributeName, value]) => ({
          name: attributeName,
          value
        }));
      }
    };
  }
};

function escapeAttribute(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("\"", "&quot;");
}

function serialize(svg) {
  const attributes = Object.entries(svg.attributeMap)
    .map(([name, value]) => `${name}="${escapeAttribute(value)}"`)
    .join(" ");
  const children = svg.children.map(element => {
    const childAttributes = Object.entries(element.attributeMap)
      .map(([name, value]) => `${name}="${escapeAttribute(value)}"`)
      .join(" ");
    return `<${element.localName} ${childAttributes}/>`;
  }).join("");
  return `<svg ${attributes}>${children}</svg>`;
}

function renderText(text = "SVG roundtrip") {
  const svg = fakeSvg();
  new RoBCode2SvgRenderer(svg).renderText(text);
  return svg;
}

test("imports generated RoBCode 2 from SVG text", () => {
  const svg = renderText("Grüße 🌍");
  const decoded = new RoBCode2SvgImporter().importString(serialize(svg));

  assert.equal(decoded.text, "Grüße 🌍");
  assert.equal(decoded.source, "svg");
  assert.equal(decoded.moduleSize, 20);
  assert.equal(decoded.svgMetadata.outerDataRing, 10);
  assert.equal(decoded.correctedSymbols, 0);
});

test("imports an SVG DOM element", () => {
  const svg = renderText("DOM input");
  const decoded = new RoBCode2SvgImporter().importElement(svg);

  assert.equal(decoded.text, "DOM input");
  assert.equal(decoded.svgMetadata.declaredPayloadBytes, 9);
});

test("passes recoverable missing data cells to Reed-Solomon correction", () => {
  const svg = renderText("recover one missing path");
  const dataIndex = svg.children.findIndex(
    element => element.attributeMap["data-role"] === "data-cell"
      && Number(element.attributeMap["data-ring"]) >= 8
  );
  assert.ok(dataIndex >= 0);
  svg.children.splice(dataIndex, 1);

  const decoded = new RoBCode2SvgImporter().importString(serialize(svg));
  assert.equal(decoded.text, "recover one missing path");
  assert.equal(decoded.correctedSymbols, 1);
});

test("rejects missing finder elements and malformed synchronization", () => {
  const importer = new RoBCode2SvgImporter();
  const withoutFinder = serialize(renderText()).replace('data-role="center-disc"', 'data-role="unknown"');
  assert.throws(
    () => importer.importString(withoutFinder),
    error => error instanceof RoBCode2SvgImporter.ImportError && error.code === "UNKNOWN_ROLE"
  );

  const badSync = serialize(renderText()).replace(
    'data-role="sync-cell" data-cell="0" data-start-angle="0" data-end-angle="10"',
    'data-role="sync-cell" data-cell="0" data-start-angle="0" data-end-angle="11"'
  );
  assert.throws(
    () => importer.importString(badSync),
    error => error instanceof RoBCode2SvgImporter.ImportError && error.code === "SYNC_GEOMETRY"
  );
});

test("rejects duplicate data cells and altered quiet-zone geometry", () => {
  const importer = new RoBCode2SvgImporter();
  const source = serialize(renderText());
  const dataPath = source.match(/<path [^>]*data-role="data-cell"[^>]*\/>/)[0];
  const duplicate = source.replace("</svg>", `${dataPath}</svg>`);
  assert.throws(
    () => importer.importString(duplicate),
    error => error instanceof RoBCode2SvgImporter.ImportError && error.code === "DATA_DUPLICATE"
  );

  const wrongSize = source.replace(
    /width="([^"]+)"/,
    (_match, width) => `width="${Number(width) + 1}"`
  );
  assert.throws(
    () => importer.importString(wrongSize),
    error => error instanceof RoBCode2SvgImporter.ImportError && error.code === "ROOT_GEOMETRY"
  );
});

test("rejects a cell whose drawn path differs from its metadata", () => {
  const importer = new RoBCode2SvgImporter();
  const source = serialize(renderText()).replace(/d="M ([^"]+)"/, 'd="M 0 0"');
  assert.throws(
    () => importer.importString(source),
    error => error instanceof RoBCode2SvgImporter.ImportError && error.code === "SYNC_GEOMETRY"
  );
});

test("rejects non-RoBCode and unsafe XML input", () => {
  const importer = new RoBCode2SvgImporter();
  assert.throws(() => importer.importString("<svg></svg>"), /not marked as RoBCode 2/);
  assert.throws(
    () => importer.importString('<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///secret">]><svg></svg>'),
    error => error instanceof RoBCode2SvgImporter.ImportError && error.code === "UNSAFE_XML"
  );
  assert.throws(() => importer.importString('<svg data-format="RoBCode-2">'), /exactly one closed root/);
});
