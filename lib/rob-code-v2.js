(function (root, factory) {
  const RoBCode2Encoder = factory();
  if (typeof module === "object" && module.exports) module.exports = RoBCode2Encoder;
  root.RoBCode2Encoder = RoBCode2Encoder;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAGIC = Uint8Array.of(0x52, 0x4f, 0x42, 0x32);
  const TEXT_UTF8 = 0x01;
  const EC_PROFILE = 0x01;
  const HEADER_LENGTH = 16;
  const DATA_SYMBOLS = 223;
  const PARITY_SYMBOLS = 32;
  const WHITENING_MASK = 0xaa;

  class ReedSolomonEncoder {
    constructor(paritySymbols) {
      this.paritySymbols = paritySymbols;
      this.exponents = new Uint8Array(512);
      this.logarithms = new Uint8Array(256);

      let value = 1;
      for (let exponent = 0; exponent < 255; exponent++) {
        this.exponents[exponent] = value;
        this.logarithms[value] = exponent;
        value <<= 1;
        if (value & 0x100) value ^= 0x11d;
      }
      for (let exponent = 255; exponent < this.exponents.length; exponent++) {
        this.exponents[exponent] = this.exponents[exponent - 255];
      }

      this.generator = Uint8Array.of(1);
      for (let root = 0; root < paritySymbols; root++) {
        this.generator = this.multiplyPolynomials(
          this.generator,
          Uint8Array.of(1, this.exponents[root])
        );
      }
    }

    multiply(left, right) {
      return left && right
        ? this.exponents[this.logarithms[left] + this.logarithms[right]]
        : 0;
    }

    multiplyPolynomials(left, right) {
      const result = new Uint8Array(left.length + right.length - 1);
      for (let leftIndex = 0; leftIndex < left.length; leftIndex++) {
        for (let rightIndex = 0; rightIndex < right.length; rightIndex++) {
          result[leftIndex + rightIndex] ^= this.multiply(
            left[leftIndex],
            right[rightIndex]
          );
        }
      }
      return result;
    }

    encode(data) {
      if (!(data instanceof Uint8Array)) {
        throw new TypeError("Reed-Solomon input must be a Uint8Array");
      }
      if (data.length < 1 || data.length > DATA_SYMBOLS) {
        throw new RangeError("Reed-Solomon blocks must contain 1 to 223 bytes");
      }

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

  class RoBCode2Encoder {
    constructor() {
      this.reedSolomon = new ReedSolomonEncoder(PARITY_SYMBOLS);
    }

    encodeText(text) {
      if (typeof text !== "string") throw new TypeError("Text payload must be a string");
      if (typeof TextEncoder !== "function") {
        throw new Error("This environment does not provide UTF-8 TextEncoder support");
      }
      return this.encodePayload(new TextEncoder().encode(text), TEXT_UTF8);
    }

    encodeBytes(input) {
      return this.encodePayload(this.copyBytes(input), 0);
    }

    encodePayload(payload, flags) {
      if (payload.length > 0xffffffff) {
        throw new RangeError("Payload exceeds the 32-bit RoBCode 2 length field");
      }

      const payloadCrc32 = this.crc32(payload);
      const header = this.createHeader(flags, payload.length, payloadCrc32);
      const headerCodeword = this.reedSolomon.encode(header);
      const payloadCodewords = [];

      for (let offset = 0; offset < payload.length; offset += DATA_SYMBOLS) {
        payloadCodewords.push(
          this.reedSolomon.encode(payload.slice(offset, offset + DATA_SYMBOLS))
        );
      }

      const codeStream = this.concatenate([headerCodeword].concat(payloadCodewords));
      const outerDataRing = this.findOuterDataRing(codeStream.length);
      const capacity = this.ringCapacity(outerDataRing);
      const paddingBytes = capacity - codeStream.length;
      const paddedCodeStream = new Uint8Array(capacity);
      paddedCodeStream.set(codeStream);
      const visibleBytes = this.whiten(paddedCodeStream);
      const cells = this.toCells(visibleBytes);

      return {
        version: 2,
        flags,
        payload: payload.slice(),
        payloadCrc32,
        header,
        headerCodeword,
        payloadCodewords,
        codeStream,
        outerDataRing,
        capacity,
        paddingBytes,
        paddedCodeStream,
        visibleBytes,
        cells,
        rings: this.createRings(visibleBytes, cells, outerDataRing)
      };
    }

    createHeader(flags, payloadLength, payloadCrc32) {
      const header = new Uint8Array(HEADER_LENGTH);
      header.set(MAGIC, 0);
      header[4] = flags;
      header[5] = EC_PROFILE;
      this.writeUint32BigEndian(header, 6, payloadLength);
      this.writeUint32BigEndian(header, 10, payloadCrc32);
      this.writeUint16BigEndian(header, 14, this.crc16CcittFalse(header.subarray(0, 14)));
      return header;
    }

    crc32(bytes) {
      let crc = 0xffffffff;
      for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
          crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
      }
      return (crc ^ 0xffffffff) >>> 0;
    }

    crc16CcittFalse(bytes) {
      let crc = 0xffff;
      for (const byte of bytes) {
        crc ^= byte << 8;
        for (let bit = 0; bit < 8; bit++) {
          crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
        }
      }
      return crc;
    }

    whiten(bytes) {
      return Uint8Array.from(bytes, byte => byte ^ WHITENING_MASK);
    }

    toCells(visibleBytes) {
      const cells = new Uint8Array(visibleBytes.length * 9);
      visibleBytes.forEach((byte, byteIndex) => {
        let parity = 0;
        for (let bit = 0; bit < 8; bit++) {
          const value = (byte >>> (7 - bit)) & 1;
          cells[byteIndex * 9 + bit] = value;
          parity ^= value;
        }
        cells[byteIndex * 9 + 8] = parity;
      });
      return cells;
    }

    createRings(visibleBytes, cells, outerDataRing) {
      const rings = [];
      let byteOffset = 0;
      for (let ring = 2; ring <= outerDataRing; ring++) {
        const byteCount = 2 * ring;
        rings.push({
          ring,
          byteOffset,
          byteCount,
          visibleBytes: visibleBytes.slice(byteOffset, byteOffset + byteCount),
          cells: cells.slice(byteOffset * 9, (byteOffset + byteCount) * 9)
        });
        byteOffset += byteCount;
      }
      return rings;
    }

    ringCapacity(ring) {
      return ring * (ring + 1) - 2;
    }

    findOuterDataRing(byteLength) {
      let ring = 2;
      while (this.ringCapacity(ring) < byteLength) ring += 1;
      return ring;
    }

    concatenate(parts) {
      const length = parts.reduce((total, part) => total + part.length, 0);
      const result = new Uint8Array(length);
      let offset = 0;
      for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
      }
      return result;
    }

    copyBytes(input) {
      if (input instanceof Uint8Array) return input.slice();
      if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0));
      if (ArrayBuffer.isView(input)) {
        return new Uint8Array(input.buffer, input.byteOffset, input.byteLength).slice();
      }
      if (Array.isArray(input)) {
        if (!input.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) {
          throw new RangeError("Byte arrays may contain only integers from 0 to 255");
        }
        return Uint8Array.from(input);
      }
      throw new TypeError("Binary payload must be a byte array, typed array, or ArrayBuffer");
    }

    writeUint32BigEndian(target, offset, value) {
      target[offset] = value >>> 24;
      target[offset + 1] = value >>> 16;
      target[offset + 2] = value >>> 8;
      target[offset + 3] = value;
    }

    writeUint16BigEndian(target, offset, value) {
      target[offset] = value >>> 8;
      target[offset + 1] = value;
    }
  }

  RoBCode2Encoder.constants = Object.freeze({
    magic: "ROB2",
    textUtf8Flag: TEXT_UTF8,
    ecProfile: EC_PROFILE,
    dataSymbols: DATA_SYMBOLS,
    paritySymbols: PARITY_SYMBOLS,
    whiteningMask: WHITENING_MASK
  });

  return RoBCode2Encoder;
});
