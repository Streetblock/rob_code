const test = require("node:test");
const assert = require("node:assert/strict");
const RoBCodeRenderer = require("../lib/rob-code.js");

function fakeSvg() {
  return {
    children: [],
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
      style: {},
      setAttribute(key, value) { this.attributes[key] = String(value); }
    };
  }
};

function defaultSettings(overrides = {}) {
  return {
    exponential: false,
    stepSize: 2,
    startRing: 1,
    xorEnabled: true,
    xorValue: "0xAA",
    centerX: 250,
    centerY: 250,
    ringWidth: 20,
    bytesPerSector: 1,
    centerType: "no_center",
    centerByte: "0xAA",
    bitOrder: "msb",
    parity: "even",
    counterClockwise: false,
    boundingCircle: true,
    colourEnabled: true,
    unrolled: false,
    colours: ["#f00", "#fb0", "#ff0", "#0f0", "#0ff", "#00f", "#708", "#f0f", "#000"],
    ...overrides
  };
}

test("preserves the legacy low-byte string encoding", () => {
  const renderer = new RoBCodeRenderer(fakeSvg());
  assert.deepEqual(renderer.encodeString("A😀"), [0x41, 0x3d, 0x00]);
});

test("parses all legacy numeric notations", () => {
  const renderer = new RoBCodeRenderer(fakeSvg());
  assert.equal(renderer.parseNumber("0b10101010"), 0xaa);
  assert.equal(renderer.parseNumber("0aA"), 0x41);
  assert.equal(renderer.parseNumber("0xAA"), 0xaa);
  assert.equal(renderer.parseNumber("170"), 170);
});

test("keeps the original linear and exponential ring calculations", () => {
  const renderer = new RoBCodeRenderer(fakeSvg());
  assert.equal(renderer.firstSectorForRing(4, 2, false), 13);
  assert.equal(renderer.firstSectorForRing(4, 2, true), 15);
  assert.equal(renderer.sectorsInRing(4, { ringIncrement: 2, exponential: false }), 8);
  assert.equal(renderer.sectorsInRing(4, { ringIncrement: 2, exponential: true }), 16);
});

test("renders circular and unrolled output", () => {
  const circularSvg = fakeSvg();
  new RoBCodeRenderer(circularSvg).render("A", defaultSettings());
  assert.equal(circularSvg.children.filter(item => item.name === "path").length, 10);
  assert.equal(circularSvg.children.filter(item => item.name === "circle").length, 1);

  const unrolledSvg = fakeSvg();
  new RoBCodeRenderer(unrolledSvg).render("A", defaultSettings({ unrolled: true }));
  assert.equal(unrolledSvg.children.filter(item => item.name === "rect").length, 18);
});
