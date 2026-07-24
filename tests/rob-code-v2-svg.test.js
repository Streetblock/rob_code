const test = require("node:test");
const assert = require("node:assert/strict");
const RoBCode2Encoder = require("../lib/rob-code-v2.js");
const RoBCode2SvgRenderer = require("../lib/rob-code-v2-svg.js");

function fakeSvg() {
  return {
    attributes: {},
    children: [],
    setAttribute(key, value) { this.attributes[key] = String(value); },
    appendChild(element) { this.children.push(element); },
    removeChild(element) { this.children.splice(this.children.indexOf(element), 1); },
    get lastChild() { return this.children.at(-1) || null; }
  };
}

global.document = {
  createElementNS(namespace, name) {
    return {
      namespace,
      name,
      attributes: {},
      setAttribute(key, value) { this.attributes[key] = String(value); }
    };
  }
};

function byRole(svg, role) {
  return svg.children.filter(element => element.attributes["data-role"] === role);
}

test("renders the complete normative structure and quiet zone", () => {
  const svg = fakeSvg();
  const renderer = new RoBCode2SvgRenderer(svg);
  const symbol = renderer.renderBytes([], { moduleSize: 10 });

  assert.equal(svg.attributes.viewBox, "0 0 197 197");
  assert.equal(svg.attributes.xmlns, "http://www.w3.org/2000/svg");
  assert.equal(svg.attributes.width, "197");
  assert.equal(svg.attributes.height, "197");
  assert.equal(svg.attributes["data-format"], "RoBCode-2");
  assert.equal(svg.attributes["data-outer-ring"], "7");
  assert.equal(byRole(svg, "quiet-zone").length, 1);
  assert.equal(byRole(svg, "center-disc").length, 1);
  assert.equal(byRole(svg, "locator-ring").length, 1);
  assert.equal(byRole(svg, "bounding-ring").length, 1);

  const quietZone = byRole(svg, "quiet-zone")[0];
  assert.equal(quietZone.attributes.width, "197");
  assert.equal(quietZone.attributes.fill, "#ffffff");
  assert.equal(byRole(svg, "center-disc")[0].attributes.r, "5");
  assert.equal(byRole(svg, "locator-ring")[0].attributes.r, "8");
  assert.equal(byRole(svg, "bounding-ring")[0].attributes.r, "82.5");
});

test("places the fixed synchronization word clockwise from the top", () => {
  const svg = fakeSvg();
  new RoBCode2SvgRenderer(svg).renderText("RoBCode");
  const syncCells = byRole(svg, "sync-cell");

  assert.equal(syncCells.length, 19);
  assert.deepEqual(
    syncCells.map(cell => Number(cell.attributes["data-cell"])),
    Array.from(RoBCode2SvgRenderer.syncBits, Number)
      .flatMap((bit, index) => bit ? [index] : [])
  );
  assert.equal(syncCells[0].attributes["data-start-angle"], "0");
  assert.equal(syncCells[0].attributes["data-end-angle"], "10");
  assert.match(syncCells[0].attributes.d, /^M /);
});

test("draws exactly the set data cells in their encoded rings", () => {
  const svg = fakeSvg();
  const encoder = new RoBCode2Encoder();
  const symbol = encoder.encodeText("RoBCode");
  new RoBCode2SvgRenderer(svg, encoder).renderEncoded(symbol);
  const dataCells = byRole(svg, "data-cell");

  assert.equal(dataCells.length, symbol.cells.reduce((sum, bit) => sum + bit, 0));
  for (const ring of symbol.rings) {
    assert.equal(
      dataCells.filter(cell => Number(cell.attributes["data-ring"]) === ring.ring).length,
      ring.cells.reduce((sum, bit) => sum + bit, 0)
    );
  }

  const first = dataCells[0];
  const ring = Number(first.attributes["data-ring"]);
  const cell = Number(first.attributes["data-cell"]);
  assert.equal(Number(first.attributes["data-start-angle"]), cell * 360 / (18 * ring));
  assert.equal(Number(first.attributes["data-end-angle"]), (cell + 1) * 360 / (18 * ring));
});

test("supports the nine heritage colors only on data cells", () => {
  const colors = Array.from({ length: 9 }, (_, index) => `color-${index}`);
  const svg = fakeSvg();
  new RoBCode2SvgRenderer(svg).renderBytes([], {
    darkColor: "neutral-dark",
    lightColor: "neutral-light",
    dataColors: colors
  });

  assert.equal(byRole(svg, "center-disc")[0].attributes.fill, "neutral-dark");
  assert.equal(byRole(svg, "sync-cell")[0].attributes.fill, "neutral-dark");
  assert.equal(byRole(svg, "bounding-ring")[0].attributes.stroke, "neutral-dark");
  assert.ok(byRole(svg, "data-cell").every(cell => {
    const cellIndex = Number(cell.attributes["data-cell"]);
    return cell.attributes.fill === colors[cellIndex % 9];
  }));
});

test("clears previous output and validates renderer options", () => {
  const svg = fakeSvg();
  const renderer = new RoBCode2SvgRenderer(svg);
  renderer.renderText("first");
  const firstQuietZone = byRole(svg, "quiet-zone")[0];
  renderer.renderText("second");

  assert.ok(!svg.children.includes(firstQuietZone));
  assert.equal(byRole(svg, "quiet-zone").length, 1);
  assert.throws(() => renderer.renderText("bad", { moduleSize: 0 }), RangeError);
  assert.throws(() => renderer.renderText("bad", { dataColors: ["black"] }), RangeError);
  assert.throws(() => renderer.renderEncoded({ version: 1 }), TypeError);
});
