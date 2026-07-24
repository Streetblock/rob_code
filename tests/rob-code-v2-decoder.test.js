const test = require("node:test");
const assert = require("node:assert/strict");
const RoBCode2Encoder = require("../lib/rob-code-v2.js");
const RoBCode2Decoder = require("../lib/rob-code-v2-decoder.js");
const vectors = require("../docs/test-vectors.json");

function flipDataBit(cells, byteIndex, bit = 0) {
  cells[byteIndex * 9 + bit] ^= 1;
}

function replaceHeader(encoder, symbol, update) {
  const header = symbol.header.slice();
  update(header);
  const crc = encoder.crc16CcittFalse(header.subarray(0, 14));
  header[14] = crc >>> 8;
  header[15] = crc;
  const padded = symbol.paddedCodeStream.slice();
  padded.set(encoder.reedSolomon.encode(header), 0);
  return encoder.toCells(encoder.whiten(padded));
}

test("decodes all golden-vector payloads from visible cells", () => {
  const encoder = new RoBCode2Encoder();
  const decoder = new RoBCode2Decoder();

  for (const vector of vectors.vectors) {
    const payload = Buffer.from(vector.payloadHex, "hex");
    const symbol = vector.flags === RoBCode2Encoder.constants.textUtf8Flag
      ? encoder.encodeText(payload.toString("utf8"))
      : encoder.encodeBytes(payload);
    const decoded = decoder.decodeCells(symbol.cells);

    assert.equal(Buffer.from(decoded.payload).toString("hex"), vector.payloadHex, vector.name);
    assert.equal(decoded.flags, vector.flags, vector.name);
    assert.equal(decoded.outerDataRing, vector.outerDataRing, vector.name);
    assert.equal(decoded.paddingBytes, vector.paddingBytes, vector.name);
    assert.equal(decoded.correctedSymbols, 0, vector.name);
    assert.deepEqual(decoded.parityFailures, [], vector.name);
  }
});

test("returns validated UTF-8 text and keeps binary payloads binary", () => {
  const encoder = new RoBCode2Encoder();
  const decoder = new RoBCode2Decoder();

  assert.equal(decoder.decodeSymbol(encoder.encodeText("Grüße 🌍")).text, "Grüße 🌍");
  const binary = decoder.decodeSymbol(encoder.encodeBytes([0xff, 0x00, 0x80]));
  assert.equal(binary.text, null);
  assert.deepEqual(Array.from(binary.payload), [0xff, 0x00, 0x80]);
});

test("corrects up to sixteen erroneous symbols in one codeword", () => {
  const encoder = new RoBCode2Encoder();
  const decoder = new RoBCode2Decoder();
  const text = "This payload contains enough bytes for sixteen independent errors.";
  const symbol = encoder.encodeText(text);
  const damaged = symbol.cells.slice();

  for (let error = 0; error < 16; error++) {
    flipDataBit(damaged, 48 + error, error % 8);
  }
  const decoded = decoder.decodeCells(damaged);

  assert.equal(decoded.text, text);
  assert.equal(decoded.correctedSymbols, 16);
  assert.equal(decoded.parityFailures.length, 16);
});

test("uses known erasures to recover more than sixteen damaged symbols", () => {
  const encoder = new RoBCode2Encoder();
  const decoder = new RoBCode2Decoder();
  const symbol = encoder.encodeText("Known frame occlusion can identify damaged bytes.");
  const damaged = symbol.cells.slice();
  const erasures = Array.from({ length: 20 }, (_, index) => 48 + index);
  erasures.forEach((byteIndex, index) => flipDataBit(damaged, byteIndex, index % 8));

  const decoded = decoder.decodeCells(damaged, erasures);

  assert.equal(decoded.text, "Known frame occlusion can identify damaged bytes.");
  assert.equal(decoded.correctedSymbols, 20);
  assert.equal(decoded.erasureSymbols, 20);
});

test("corrects header errors before reading the payload length", () => {
  const encoder = new RoBCode2Encoder();
  const decoder = new RoBCode2Decoder();
  const symbol = encoder.encodeText("header recovery");
  const damaged = symbol.cells.slice();
  flipDataBit(damaged, 0, 2);
  flipDataBit(damaged, 10, 7);
  flipDataBit(damaged, 35, 4);

  const decoded = decoder.decodeCells(damaged);
  assert.equal(decoded.text, "header recovery");
  assert.equal(decoded.correctedSymbols, 3);
});

test("corrects independent errors across multiple payload codewords", () => {
  const encoder = new RoBCode2Encoder();
  const decoder = new RoBCode2Decoder();
  const payload = Uint8Array.from({ length: 224 }, (_, index) => index & 0xff);
  const symbol = encoder.encodeBytes(payload);
  const damaged = symbol.cells.slice();
  flipDataBit(damaged, 48, 1);
  flipDataBit(damaged, 48 + 255, 6);

  const decoded = decoder.decodeCells(damaged);
  assert.deepEqual(decoded.payload, payload);
  assert.equal(decoded.correctedSymbols, 2);
});

test("reports parity-cell damage without changing valid data", () => {
  const encoder = new RoBCode2Encoder();
  const decoder = new RoBCode2Decoder();
  const symbol = encoder.encodeText("parity only");
  const damaged = symbol.cells.slice();
  damaged[48 * 9 + 8] ^= 1;

  const decoded = decoder.decodeCells(damaged);
  assert.equal(decoded.text, "parity only");
  assert.equal(decoded.correctedSymbols, 0);
  assert.deepEqual(decoded.parityFailures, [48]);
});

test("rejects uncorrectable codewords and invalid padding", () => {
  const encoder = new RoBCode2Encoder();
  const decoder = new RoBCode2Decoder();
  const symbol = encoder.encodeText("A payload long enough to damage seventeen payload symbols.");
  const tooDamaged = symbol.cells.slice();
  for (let error = 0; error < 17; error++) flipDataBit(tooDamaged, 48 + error, error % 8);

  assert.throws(
    () => decoder.decodeCells(tooDamaged),
    error => error instanceof RoBCode2Decoder.DecodeError && error.code === "RS_UNCORRECTABLE"
  );

  const badPadding = encoder.encodeText("RoBCode").cells.slice();
  flipDataBit(badPadding, encoder.encodeText("RoBCode").codeStream.length, 0);
  assert.throws(
    () => decoder.decodeCells(badPadding),
    error => error instanceof RoBCode2Decoder.DecodeError && error.code === "INVALID_PADDING"
  );
  const paddingIndex = encoder.encodeText("RoBCode").codeStream.length;
  assert.equal(decoder.decodeCells(badPadding, [paddingIndex]).text, "RoBCode");
  const toleratedPadding = decoder.decodeCells(
    badPadding,
    [],
    { allowDamagedPadding: true }
  );
  assert.equal(toleratedPadding.text, "RoBCode");
  assert.deepEqual(toleratedPadding.paddingFailures, [paddingIndex]);
});

test("decodes consecutive ring objects and rejects malformed sampling", () => {
  const encoder = new RoBCode2Encoder();
  const decoder = new RoBCode2Decoder();
  const symbol = encoder.encodeText("ring input");

  assert.equal(decoder.decodeRings(symbol.rings).text, "ring input");
  assert.throws(() => decoder.decodeCells(symbol.cells.slice(1)), /divisible by nine/);
  assert.throws(() => decoder.decodeCells(Uint8Array.of(2)), RangeError);
  assert.throws(() => decoder.decodeCells([0.5]), RangeError);
  assert.throws(() => decoder.decodeRings(symbol.rings.slice(1)), /consecutive from ring 2/);
});

test("validates reserved flags, payload CRC, and declared UTF-8", () => {
  const encoder = new RoBCode2Encoder();
  const decoder = new RoBCode2Decoder();

  const reservedFlagSymbol = encoder.encodeText("flags");
  const reservedFlagCells = replaceHeader(encoder, reservedFlagSymbol, header => { header[4] = 0x02; });
  assert.throws(
    () => decoder.decodeCells(reservedFlagCells),
    error => error instanceof RoBCode2Decoder.DecodeError && error.code === "FLAGS"
  );

  const crcSymbol = encoder.encodeText("crc");
  const badCrcCells = replaceHeader(encoder, crcSymbol, header => { header[10] ^= 1; });
  assert.throws(
    () => decoder.decodeCells(badCrcCells),
    error => error instanceof RoBCode2Decoder.DecodeError && error.code === "PAYLOAD_CRC"
  );

  const invalidTextSymbol = encoder.encodeBytes([0xff]);
  const invalidTextCells = replaceHeader(encoder, invalidTextSymbol, header => { header[4] = 0x01; });
  assert.throws(
    () => decoder.decodeCells(invalidTextCells),
    error => error instanceof RoBCode2Decoder.DecodeError && error.code === "UTF8"
  );

  const hugeLengthSymbol = encoder.encodeBytes([]);
  const hugeLengthCells = replaceHeader(encoder, hugeLengthSymbol, header => {
    header.set([0xff, 0xff, 0xff, 0xff], 6);
  });
  assert.throws(
    () => decoder.decodeCells(hugeLengthCells),
    error => error instanceof RoBCode2Decoder.DecodeError && error.code === "TRUNCATED_SYMBOL"
  );
});
