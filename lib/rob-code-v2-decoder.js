(function (root, factory) {
  const RoBCode2Decoder = factory();
  if (typeof module === "object" && module.exports) module.exports = RoBCode2Decoder;
  root.RoBCode2Decoder = RoBCode2Decoder;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAGIC = Uint8Array.of(0x52, 0x4f, 0x42, 0x32);
  const TEXT_UTF8 = 0x01;
  const EC_PROFILE = 0x01;
  const HEADER_DATA_LENGTH = 16;
  const HEADER_CODEWORD_LENGTH = 48;
  const DATA_SYMBOLS = 223;
  const PARITY_SYMBOLS = 32;
  const WHITENING_MASK = 0xaa;

  class RoBCode2DecodeError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "RoBCode2DecodeError";
      this.code = code;
    }
  }

  class ReedSolomonDecoder {
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
    }

    decode(input, erasurePositions = []) {
      if (!(input instanceof Uint8Array)) {
        throw new TypeError("Reed-Solomon input must be a Uint8Array");
      }
      if (input.length <= this.paritySymbols || input.length > 255) {
        throw new RangeError("Invalid shortened Reed-Solomon codeword length");
      }
      if (!Array.isArray(erasurePositions)
        || erasurePositions.length > this.paritySymbols
        || new Set(erasurePositions).size !== erasurePositions.length
        || !erasurePositions.every(position => (
          Number.isInteger(position) && position >= 0 && position < input.length
        ))) {
        throw new RangeError("Reed-Solomon erasure positions must be unique valid codeword indices");
      }

      const corrected = input.slice();
      let syndromes = this.calculateSyndromes(corrected);
      if (syndromes.every(value => value === 0)) {
        return {
          data: corrected.slice(0, -this.paritySymbols),
          codeword: corrected,
          correctedSymbols: 0,
          correctedPositions: []
        };
      }

      const correctedPositions = [];
      if (erasurePositions.length) {
        const erasureMagnitudes = this.solveErrorMagnitudes(
          syndromes,
          erasurePositions,
          corrected.length
        );
        erasurePositions.forEach((position, index) => {
          if (erasureMagnitudes[index] === 0) return;
          corrected[position] ^= erasureMagnitudes[index];
          correctedPositions.push(position);
        });
        syndromes = this.calculateSyndromes(corrected);
        if (syndromes.every(value => value === 0)) {
          return {
            data: corrected.slice(0, -this.paritySymbols),
            codeword: corrected,
            correctedSymbols: correctedPositions.length,
            correctedPositions
          };
        }
      }

      const locator = this.findErrorLocator(syndromes);
      const errorCount = locator.length - 1;
      if (errorCount < 1 || errorCount * 2 > this.paritySymbols) {
        throw new RoBCode2DecodeError("RS_UNCORRECTABLE", "Reed-Solomon error count exceeds capacity");
      }
      const positions = this.findErrorPositions(locator, corrected.length);
      if (positions.length !== errorCount) {
        throw new RoBCode2DecodeError("RS_UNCORRECTABLE", "Could not locate all Reed-Solomon errors");
      }

      const magnitudes = this.solveErrorMagnitudes(syndromes, positions, corrected.length);
      positions.forEach((position, index) => {
        if (magnitudes[index] === 0) return;
        corrected[position] ^= magnitudes[index];
        if (!correctedPositions.includes(position)) correctedPositions.push(position);
      });
      syndromes = this.calculateSyndromes(corrected);
      if (!syndromes.every(value => value === 0)) {
        throw new RoBCode2DecodeError("RS_UNCORRECTABLE", "Reed-Solomon correction did not converge");
      }

      return {
        data: corrected.slice(0, -this.paritySymbols),
        codeword: corrected,
        correctedSymbols: correctedPositions.length,
        correctedPositions
      };
    }

    calculateSyndromes(codeword) {
      const syndromes = new Uint8Array(this.paritySymbols);
      for (let root = 0; root < this.paritySymbols; root++) {
        syndromes[root] = this.evaluatePolynomial(codeword, this.exponents[root]);
      }
      return syndromes;
    }

    findErrorLocator(syndromes) {
      let locator = Uint8Array.of(1);
      let previous = Uint8Array.of(1);

      for (let index = 0; index < this.paritySymbols; index++) {
        let discrepancy = syndromes[index];
        for (let term = 1; term < locator.length; term++) {
          discrepancy ^= this.multiply(
            locator[locator.length - 1 - term],
            syndromes[index - term]
          );
        }

        previous = this.appendZero(previous);
        if (discrepancy === 0) continue;

        if (previous.length > locator.length) {
          const replacement = this.scalePolynomial(previous, discrepancy);
          previous = this.scalePolynomial(locator, this.inverse(discrepancy));
          locator = replacement;
        }
        locator = this.addPolynomials(locator, this.scalePolynomial(previous, discrepancy));
      }

      return this.trimLeadingZeros(locator);
    }

    findErrorPositions(locator, messageLength) {
      const reversed = Uint8Array.from(locator).reverse();
      const positions = [];
      for (let index = 0; index < messageLength; index++) {
        if (this.evaluatePolynomial(reversed, this.exponents[index]) === 0) {
          positions.push(messageLength - 1 - index);
        }
      }
      return positions;
    }

    solveErrorMagnitudes(syndromes, positions, messageLength) {
      const count = positions.length;
      const matrix = Array.from({ length: count }, (_, row) => {
        const values = new Uint8Array(count + 1);
        positions.forEach((position, column) => {
          const degree = messageLength - 1 - position;
          values[column] = row === 0 ? 1 : this.exponents[(row * degree) % 255];
        });
        values[count] = syndromes[row];
        return values;
      });

      for (let column = 0; column < count; column++) {
        let pivot = column;
        while (pivot < count && matrix[pivot][column] === 0) pivot += 1;
        if (pivot === count) {
          throw new RoBCode2DecodeError("RS_UNCORRECTABLE", "Reed-Solomon magnitude matrix is singular");
        }
        if (pivot !== column) [matrix[pivot], matrix[column]] = [matrix[column], matrix[pivot]];

        const inversePivot = this.inverse(matrix[column][column]);
        for (let entry = column; entry <= count; entry++) {
          matrix[column][entry] = this.multiply(matrix[column][entry], inversePivot);
        }

        for (let row = 0; row < count; row++) {
          if (row === column || matrix[row][column] === 0) continue;
          const factor = matrix[row][column];
          for (let entry = column; entry <= count; entry++) {
            matrix[row][entry] ^= this.multiply(factor, matrix[column][entry]);
          }
        }
      }

      return Uint8Array.from(matrix, row => row[count]);
    }

    evaluatePolynomial(polynomial, value) {
      let result = polynomial[0];
      for (let index = 1; index < polynomial.length; index++) {
        result = this.multiply(result, value) ^ polynomial[index];
      }
      return result;
    }

    multiply(left, right) {
      return left && right
        ? this.exponents[this.logarithms[left] + this.logarithms[right]]
        : 0;
    }

    inverse(value) {
      if (value === 0) throw new RangeError("Zero has no multiplicative inverse in GF(256)");
      return this.exponents[255 - this.logarithms[value]];
    }

    scalePolynomial(polynomial, scalar) {
      return Uint8Array.from(polynomial, coefficient => this.multiply(coefficient, scalar));
    }

    addPolynomials(left, right) {
      const length = Math.max(left.length, right.length);
      const result = new Uint8Array(length);
      const leftOffset = length - left.length;
      const rightOffset = length - right.length;
      left.forEach((value, index) => { result[leftOffset + index] ^= value; });
      right.forEach((value, index) => { result[rightOffset + index] ^= value; });
      return result;
    }

    appendZero(polynomial) {
      const result = new Uint8Array(polynomial.length + 1);
      result.set(polynomial);
      return result;
    }

    trimLeadingZeros(polynomial) {
      let first = 0;
      while (first < polynomial.length - 1 && polynomial[first] === 0) first += 1;
      return polynomial.slice(first);
    }
  }

  class RoBCode2Decoder {
    constructor() {
      this.reedSolomon = new ReedSolomonDecoder(PARITY_SYMBOLS);
    }

    decodeSymbol(symbol) {
      if (!symbol || !(symbol.cells instanceof Uint8Array)) {
        throw new TypeError("Encoded symbol must contain a Uint8Array of cells");
      }
      return this.decodeCells(symbol.cells);
    }

    decodeRings(rings) {
      if (!Array.isArray(rings) || rings.length === 0) {
        throw new TypeError("At least one data ring is required");
      }
      const ordered = [...rings].sort((left, right) => left.ring - right.ring);
      let expectedRing = 2;
      const parts = [];
      for (const ring of ordered) {
        if (ring.ring !== expectedRing || !(ring.cells instanceof Uint8Array)) {
          throw new RoBCode2DecodeError("RING_SEQUENCE", "Data rings must be consecutive from ring 2");
        }
        if (ring.cells.length !== 18 * ring.ring) {
          throw new RoBCode2DecodeError("RING_LENGTH", `Ring ${ring.ring} has an invalid cell count`);
        }
        parts.push(ring.cells);
        expectedRing += 1;
      }
      return this.decodeCells(this.concatenate(parts));
    }

    decodeCells(input, erasureByteIndices = []) {
      const cells = this.copyCells(input);
      if (cells.length % 9 !== 0) {
        throw new RoBCode2DecodeError("CELL_LENGTH", "Cell count must be divisible by nine");
      }

      const byteCapacity = cells.length / 9;
      if (!Array.isArray(erasureByteIndices)
        || new Set(erasureByteIndices).size !== erasureByteIndices.length
        || !erasureByteIndices.every(index => (
          Number.isInteger(index) && index >= 0 && index < byteCapacity
        ))) {
        throw new RangeError("Erasure byte indices must be unique valid symbol positions");
      }
      const outerDataRing = this.outerRingForCapacity(byteCapacity);
      if (outerDataRing < 7) {
        throw new RoBCode2DecodeError("SYMBOL_TOO_SMALL", "Symbol cannot contain the fixed header codeword");
      }

      const visibleBytes = new Uint8Array(byteCapacity);
      const parityFailures = [];
      for (let byteIndex = 0; byteIndex < byteCapacity; byteIndex++) {
        let visibleByte = 0;
        let parity = 0;
        for (let bit = 0; bit < 8; bit++) {
          const value = cells[byteIndex * 9 + bit];
          visibleByte = (visibleByte << 1) | value;
          parity ^= value;
        }
        parity ^= cells[byteIndex * 9 + 8];
        if (parity !== 0) parityFailures.push(byteIndex);
        visibleBytes[byteIndex] = visibleByte;
      }

      const paddedCodeStream = Uint8Array.from(visibleBytes, byte => byte ^ WHITENING_MASK);
      const headerResult = this.reedSolomon.decode(
        paddedCodeStream.slice(0, HEADER_CODEWORD_LENGTH),
        erasureByteIndices.filter(index => index < HEADER_CODEWORD_LENGTH)
      );
      const header = headerResult.data;
      this.validateHeader(header);

      const flags = header[4];
      const payloadLength = this.readUint32BigEndian(header, 6);
      const expectedPayloadCrc32 = this.readUint32BigEndian(header, 10);
      const codeStreamLength = HEADER_CODEWORD_LENGTH + this.encodedPayloadLength(payloadLength);

      if (codeStreamLength > byteCapacity) {
        throw new RoBCode2DecodeError("TRUNCATED_SYMBOL", "Declared payload does not fit in the sampled rings");
      }
      if (outerDataRing > 2 && this.ringCapacity(outerDataRing - 1) >= codeStreamLength) {
        throw new RoBCode2DecodeError("NON_MINIMAL_RING", "Symbol contains an unnecessary outer data ring");
      }
      const payloadBlockLengths = this.payloadBlockLengths(payloadLength);

      const payloadParts = [];
      const correctedCodewords = [headerResult.codeword];
      let correctedSymbols = headerResult.correctedSymbols;
      let offset = HEADER_CODEWORD_LENGTH;
      for (const blockLength of payloadBlockLengths) {
        const result = this.reedSolomon.decode(
          paddedCodeStream.slice(offset, offset + blockLength),
          erasureByteIndices
            .filter(index => index >= offset && index < offset + blockLength)
            .map(index => index - offset)
        );
        payloadParts.push(result.data);
        correctedCodewords.push(result.codeword);
        correctedSymbols += result.correctedSymbols;
        offset += blockLength;
      }

      const payload = this.concatenate(payloadParts).slice(0, payloadLength);
      if (this.crc32(payload) !== expectedPayloadCrc32) {
        throw new RoBCode2DecodeError("PAYLOAD_CRC", "Payload CRC-32 validation failed");
      }

      const padding = paddedCodeStream.slice(codeStreamLength);
      if (!padding.every((byte, index) => (
        byte === 0 || erasureByteIndices.includes(codeStreamLength + index)
      ))) {
        throw new RoBCode2DecodeError("INVALID_PADDING", "Final ring padding is not zero");
      }

      let text = null;
      if (flags & TEXT_UTF8) text = this.decodeUtf8(payload);

      return {
        version: 2,
        flags,
        payload,
        text,
        payloadCrc32: expectedPayloadCrc32,
        header,
        correctedCodeStream: this.concatenate(correctedCodewords),
        correctedSymbols,
        erasureSymbols: erasureByteIndices.length,
        parityFailures,
        codeStreamLength,
        paddingBytes: byteCapacity - codeStreamLength,
        outerDataRing
      };
    }

    validateHeader(header) {
      if (header.length !== HEADER_DATA_LENGTH) {
        throw new RoBCode2DecodeError("HEADER_LENGTH", "Decoded header has an invalid length");
      }
      if (!MAGIC.every((byte, index) => header[index] === byte)) {
        throw new RoBCode2DecodeError("MAGIC", "RoBCode 2 magic bytes are missing");
      }
      if (header[4] & ~TEXT_UTF8) {
        throw new RoBCode2DecodeError("FLAGS", "Header contains unsupported flags");
      }
      if (header[5] !== EC_PROFILE) {
        throw new RoBCode2DecodeError("EC_PROFILE", "Header declares an unsupported error-correction profile");
      }
      const expected = this.readUint16BigEndian(header, 14);
      if (this.crc16CcittFalse(header.subarray(0, 14)) !== expected) {
        throw new RoBCode2DecodeError("HEADER_CRC", "Header CRC-16 validation failed");
      }
    }

    payloadBlockLengths(payloadLength) {
      const lengths = [];
      const fullBlocks = Math.floor(payloadLength / DATA_SYMBOLS);
      const remainder = payloadLength % DATA_SYMBOLS;
      for (let block = 0; block < fullBlocks; block++) lengths.push(255);
      if (remainder !== 0) lengths.push(remainder + PARITY_SYMBOLS);
      return lengths;
    }

    encodedPayloadLength(payloadLength) {
      const fullBlocks = Math.floor(payloadLength / DATA_SYMBOLS);
      const remainder = payloadLength % DATA_SYMBOLS;
      return fullBlocks * 255 + (remainder === 0 ? 0 : remainder + PARITY_SYMBOLS);
    }

    decodeUtf8(payload) {
      if (typeof TextDecoder !== "function") {
        throw new RoBCode2DecodeError("UTF8_UNAVAILABLE", "This environment cannot validate UTF-8");
      }
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(payload);
      } catch (_error) {
        throw new RoBCode2DecodeError("UTF8", "Text payload is not valid UTF-8");
      }
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

    ringCapacity(ring) {
      return ring * (ring + 1) - 2;
    }

    outerRingForCapacity(capacity) {
      const ring = (Math.sqrt(4 * capacity + 9) - 1) / 2;
      if (!Number.isInteger(ring) || this.ringCapacity(ring) !== capacity) {
        throw new RoBCode2DecodeError("RING_CAPACITY", "Cell data does not end on a complete data ring");
      }
      return ring;
    }

    copyCells(input) {
      let cells;
      if (input instanceof Uint8Array) cells = input.slice();
      else if (Array.isArray(input)) {
        if (!input.every(value => value === 0 || value === 1)) {
          throw new RangeError("Cells may contain only zero or one");
        }
        cells = Uint8Array.from(input);
      }
      else throw new TypeError("Cells must be a Uint8Array or array");
      if (!cells.every(value => value === 0 || value === 1)) {
        throw new RangeError("Cells may contain only zero or one");
      }
      return cells;
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

    readUint32BigEndian(bytes, offset) {
      return (
        bytes[offset] * 0x1000000
        + (bytes[offset + 1] << 16)
        + (bytes[offset + 2] << 8)
        + bytes[offset + 3]
      ) >>> 0;
    }

    readUint16BigEndian(bytes, offset) {
      return (bytes[offset] << 8) | bytes[offset + 1];
    }
  }

  RoBCode2Decoder.DecodeError = RoBCode2DecodeError;

  return RoBCode2Decoder;
});
