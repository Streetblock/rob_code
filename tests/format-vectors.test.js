const test = require("node:test");
const assert = require("node:assert/strict");
const vectors = require("../docs/test-vectors.json");

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function crc16CcittFalse(bytes) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
    }
  }
  return crc;
}

class ReferenceReedSolomonEncoder {
  constructor(paritySymbols = 32) {
    this.paritySymbols = paritySymbols;
    this.exp = new Uint8Array(512);
    this.log = new Uint8Array(256);
    let value = 1;
    for (let exponent = 0; exponent < 255; exponent++) {
      this.exp[exponent] = value;
      this.log[value] = exponent;
      value <<= 1;
      if (value & 0x100) value ^= 0x11d;
    }
    for (let exponent = 255; exponent < 512; exponent++) {
      this.exp[exponent] = this.exp[exponent - 255];
    }
    this.generator = Uint8Array.of(1);
    for (let root = 0; root < paritySymbols; root++) {
      this.generator = this.multiplyPolynomials(this.generator, Uint8Array.of(1, this.exp[root]));
    }
  }

  multiply(a, b) {
    return a && b ? this.exp[this.log[a] + this.log[b]] : 0;
  }

  multiplyPolynomials(a, b) {
    const result = new Uint8Array(a.length + b.length - 1);
    for (let left = 0; left < a.length; left++) {
      for (let right = 0; right < b.length; right++) {
        result[left + right] ^= this.multiply(a[left], b[right]);
      }
    }
    return result;
  }

  encode(data) {
    const result = new Uint8Array(data.length + this.paritySymbols);
    result.set(data);
    for (let index = 0; index < data.length; index++) {
      const coefficient = result[index];
      if (!coefficient) continue;
      for (let term = 1; term < this.generator.length; term++) {
        result[index + term] ^= this.multiply(this.generator[term], coefficient);
      }
    }
    result.set(data);
    return result;
  }
}

function hex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

function ringCapacity(ring) {
  return ring * (ring + 1) - 2;
}

test("sync word is balanced and distinguishes rotation and mirroring", () => {
  const bits = Array.from(vectors.syncBits, Number);
  const mirrored = [...bits].reverse();
  let cyclicDistance = Infinity;
  let mirroredDistance = Infinity;

  for (let shift = 1; shift < bits.length; shift++) {
    cyclicDistance = Math.min(
      cyclicDistance,
      bits.reduce((distance, bit, index) => distance + (bit ^ bits[(index + shift) % bits.length]), 0)
    );
  }
  for (let shift = 0; shift < bits.length; shift++) {
    mirroredDistance = Math.min(
      mirroredDistance,
      bits.reduce((distance, bit, index) => distance + (bit ^ mirrored[(index + shift) % bits.length]), 0)
    );
  }

  assert.equal(bits.length, 36);
  assert.equal(bits.reduce((sum, bit) => sum + bit, 0), 19);
  assert.equal(cyclicDistance, 16);
  assert.equal(mirroredDistance, 14);
});

test("CRC check values match the named standards", () => {
  const check = Buffer.from("123456789", "ascii");
  assert.equal(crc32(check), 0xcbf43926);
  assert.equal(crc16CcittFalse(check), 0x29b1);
});

test("golden headers, Reed-Solomon words, and ring sizes are self-consistent", () => {
  const rs = new ReferenceReedSolomonEncoder(vectors.reedSolomon.paritySymbols);
  assert.equal(hex(rs.generator), vectors.reedSolomon.generatorHex);

  for (const vector of vectors.vectors) {
    const payload = Buffer.from(vector.payloadHex, "hex");
    const header = Buffer.from(vector.headerHex, "hex");
    assert.equal(payload.length, header.readUInt32BE(6));
    assert.equal(crc32(payload).toString(16).padStart(8, "0"), vector.payloadCrc32);
    assert.equal(crc16CcittFalse(header.subarray(0, 14)), header.readUInt16BE(14));
    assert.equal(hex(rs.encode(header)), vector.headerCodewordHex);

    const blocks = [];
    for (let offset = 0; offset < payload.length; offset += 223) {
      blocks.push(hex(rs.encode(payload.subarray(offset, offset + 223))));
    }
    assert.deepEqual(blocks, vector.payloadCodewordsHex);
    assert.equal(
      vector.headerCodewordHex.length / 2 + blocks.reduce((length, block) => length + block.length / 2, 0),
      vector.codeStreamLength
    );
    assert.ok(ringCapacity(vector.outerDataRing - 1) < vector.codeStreamLength);
    assert.equal(ringCapacity(vector.outerDataRing) - vector.codeStreamLength, vector.paddingBytes);
  }
});
