const test = require("node:test");
const assert = require("node:assert/strict");
const RoBCode2Encoder = require("../lib/rob-code-v2.js");
const vectors = require("../docs/test-vectors.json");

function hex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

test("encodes every golden vector exactly", () => {
  const encoder = new RoBCode2Encoder();

  for (const vector of vectors.vectors) {
    const payload = Buffer.from(vector.payloadHex, "hex");
    const result = vector.flags === RoBCode2Encoder.constants.textUtf8Flag
      ? encoder.encodeText(payload.toString("utf8"))
      : encoder.encodeBytes(payload);

    assert.equal(result.flags, vector.flags, vector.name);
    assert.equal(result.payloadCrc32.toString(16).padStart(8, "0"), vector.payloadCrc32, vector.name);
    assert.equal(hex(result.header), vector.headerHex, vector.name);
    assert.equal(hex(result.headerCodeword), vector.headerCodewordHex, vector.name);
    assert.deepEqual(result.payloadCodewords.map(hex), vector.payloadCodewordsHex, vector.name);
    assert.equal(result.codeStream.length, vector.codeStreamLength, vector.name);
    assert.equal(result.outerDataRing, vector.outerDataRing, vector.name);
    assert.equal(result.paddingBytes, vector.paddingBytes, vector.name);
  }
});

test("whitens bytes and adds MSB-first even parity cells", () => {
  const result = new RoBCode2Encoder().encodeBytes([]);

  assert.equal(result.codeStream[0], 0x52);
  assert.equal(result.visibleBytes[0], 0xf8);
  assert.deepEqual(Array.from(result.cells.slice(0, 9)), [1, 1, 1, 1, 1, 0, 0, 0, 1]);
  assert.ok(result.cells.every(cell => cell === 0 || cell === 1));

  for (let offset = 0; offset < result.cells.length; offset += 9) {
    const setCells = result.cells.slice(offset, offset + 9).reduce((sum, bit) => sum + bit, 0);
    assert.equal(setCells % 2, 0);
  }

  assert.ok(result.paddedCodeStream.slice(-result.paddingBytes).every(byte => byte === 0));
  assert.ok(result.visibleBytes.slice(-result.paddingBytes).every(byte => byte === 0xaa));
});

test("splits payloads into shortened RS blocks at 223 bytes", () => {
  const encoder = new RoBCode2Encoder();
  const exactBlock = encoder.encodeBytes(new Uint8Array(223));
  const splitBlock = encoder.encodeBytes(new Uint8Array(224));

  assert.deepEqual(exactBlock.payloadCodewords.map(block => block.length), [255]);
  assert.deepEqual(splitBlock.payloadCodewords.map(block => block.length), [255, 33]);
  assert.equal(exactBlock.codeStream.length, 48 + 255);
  assert.equal(splitBlock.codeStream.length, 48 + 255 + 33);
});

test("returns complete sequential ring data", () => {
  const result = new RoBCode2Encoder().encodeText("RoBCode");

  assert.equal(result.rings[0].ring, 2);
  assert.equal(result.rings.at(-1).ring, result.outerDataRing);
  assert.deepEqual(result.rings.map(ring => ring.byteCount), [4, 6, 8, 10, 12, 14, 16, 18]);
  assert.equal(result.rings.reduce((sum, ring) => sum + ring.byteCount, 0), result.capacity);
  assert.equal(result.rings.reduce((sum, ring) => sum + ring.cells.length, 0), result.cells.length);
  assert.equal(hex(result.rings[0].visibleBytes), hex(result.visibleBytes.slice(0, 4)));
});

test("copies binary input and rejects invalid payload types", () => {
  const encoder = new RoBCode2Encoder();
  const source = Uint8Array.of(1, 2, 3);
  const result = encoder.encodeBytes(source);
  source[0] = 99;

  assert.deepEqual(Array.from(result.payload), [1, 2, 3]);
  assert.throws(() => encoder.encodeText(null), TypeError);
  assert.throws(() => encoder.encodeBytes("not bytes"), TypeError);
  assert.throws(() => encoder.encodeBytes([0, 256]), RangeError);
});
