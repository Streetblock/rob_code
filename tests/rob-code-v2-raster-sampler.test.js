const test = require("node:test");
const assert = require("node:assert/strict");
const RoBCode2Encoder = require("../lib/rob-code-v2.js");
const RoBCode2RasterSampler = require("../lib/rob-code-v2-raster-sampler.js");

const SYNC_BITS = "110111111010100000001111001100110010";

function createRaster(symbol, options = {}) {
  const moduleSize = options.moduleSize || 20;
  const rotation = options.rotation || 0;
  const direction = options.mirrored ? -1 : 1;
  const ellipseScaleX = options.ellipseScaleX || 1;
  const ellipseScaleY = options.ellipseScaleY || 1;
  const ellipseRotation = (options.ellipseRotation || 0) * Math.PI / 180;
  const background = options.background || [255, 254, 248];
  const ink = options.ink || [17, 23, 19];
  const dataInk = options.dataInk || ink;
  const flippedCells = options.flippedCells || new Set();
  const size = Math.round(2 * (symbol.outerDataRing + 2.85) * moduleSize);
  const center = size / 2;
  const data = new Uint8ClampedArray(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      const localX = Math.cos(ellipseRotation) * dx + Math.sin(ellipseRotation) * dy;
      const localY = -Math.sin(ellipseRotation) * dx + Math.cos(ellipseRotation) * dy;
      const normalizedX = localX / ellipseScaleX;
      const normalizedY = localY / ellipseScaleY;
      const radius = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY) / moduleSize;
      const imageAngle = (Math.atan2(normalizedX, -normalizedY) * 180 / Math.PI + 360) % 360;
      const logicalAngle = ((direction * (imageAngle - rotation)) % 360 + 360) % 360;
      const sample = logicalSample(symbol, radius, logicalAngle, flippedCells);
      const color = sample === "data" ? dataInk : sample === "dark" ? ink : background;
      const offset = (y * size + x) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

function reframeRaster(source, options = {}) {
  const cropLeft = options.cropLeft || 0;
  const cropRight = options.cropRight || 0;
  const cropTop = options.cropTop || 0;
  const cropBottom = options.cropBottom || 0;
  const marginLeft = options.marginLeft || 0;
  const marginRight = options.marginRight || 0;
  const marginTop = options.marginTop || 0;
  const marginBottom = options.marginBottom || 0;
  const background = options.background || [255, 255, 255];
  const copiedWidth = source.width - cropLeft - cropRight;
  const copiedHeight = source.height - cropTop - cropBottom;
  const width = marginLeft + copiedWidth + marginRight;
  const height = marginTop + copiedHeight + marginBottom;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = background[0];
    data[offset + 1] = background[1];
    data[offset + 2] = background[2];
    data[offset + 3] = 255;
  }
  for (let y = 0; y < copiedHeight; y++) {
    for (let x = 0; x < copiedWidth; x++) {
      const sourceOffset = ((y + cropTop) * source.width + x + cropLeft) * 4;
      const targetOffset = ((y + marginTop) * width + x + marginLeft) * 4;
      data.set(source.data.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
  return { width, height, data };
}

function logicalSample(symbol, radius, angle, flippedCells) {
  if (radius < 0.5 || (radius >= 0.7 && radius < 0.9)) return "dark";
  if (radius >= 1 && radius < 2) {
    return SYNC_BITS[Math.floor(angle / 10)] === "1" ? "dark" : "light";
  }
  if (radius >= 2 && radius < symbol.outerDataRing + 1) {
    const ring = Math.floor(radius);
    if (ring >= 2 && ring <= symbol.outerDataRing) {
      const ringData = symbol.rings[ring - 2];
      const cell = Math.floor(angle / 360 * ringData.cells.length);
      const globalCell = ringData.byteOffset * 9 + cell;
      const value = ringData.cells[cell] ^ Number(flippedCells.has(globalCell));
      return value ? "data" : "light";
    }
  }
  if (radius >= symbol.outerDataRing + 1.15 && radius < symbol.outerDataRing + 1.35) {
    return "dark";
  }
  return "light";
}

test("decodes a lossless square raster export", () => {
  const symbol = new RoBCode2Encoder().encodeText("Raster roundtrip");
  const decoded = new RoBCode2RasterSampler().decodeImageData(createRaster(symbol));

  assert.equal(decoded.text, "Raster roundtrip");
  assert.equal(decoded.source, "raster");
  assert.ok(Math.abs(decoded.rasterMetadata.moduleSize - 20) < 0.1);
  assert.equal(decoded.rasterMetadata.rotationDegrees, 0);
  assert.equal(decoded.rasterMetadata.mirrored, false);
  assert.equal(decoded.rasterMetadata.syncMismatches, 0);
});

test("decodes the smallest supported eight-pixel module raster", () => {
  const symbol = new RoBCode2Encoder().encodeBytes([]);
  const decoded = new RoBCode2RasterSampler().decodeImageData(
    createRaster(symbol, { moduleSize: 8 })
  );

  assert.equal(decoded.payload.length, 0);
  assert.equal(decoded.outerDataRing, 7);
  assert.ok(decoded.rasterMetadata.moduleSize >= 7.8);
});

test("finds arbitrary rotation from the synchronization ring", () => {
  const symbol = new RoBCode2Encoder().encodeText("rotated raster");
  const decoded = new RoBCode2RasterSampler().decodeImageData(
    createRaster(symbol, { rotation: 73 })
  );

  assert.equal(decoded.text, "rotated raster");
  assert.ok(Math.abs(decoded.rasterMetadata.rotationDegrees - 73) <= 1);
  assert.equal(decoded.rasterMetadata.mirrored, false);
});

test("detects and reverses a mirrored raster", () => {
  const symbol = new RoBCode2Encoder().encodeText("mirrored raster");
  const decoded = new RoBCode2RasterSampler().decodeImageData(
    createRaster(symbol, { rotation: 121, mirrored: true })
  );

  assert.equal(decoded.text, "mirrored raster");
  assert.ok(Math.abs(decoded.rasterMetadata.rotationDegrees - 121) <= 1);
  assert.equal(decoded.rasterMetadata.mirrored, true);
});

test("rectifies a rotated affine ellipse before sampling", () => {
  const symbol = new RoBCode2Encoder().encodeText("elliptical perspective");
  const decoded = new RoBCode2RasterSampler().decodeImageData(createRaster(symbol, {
    moduleSize: 24,
    rotation: 47,
    ellipseScaleY: 0.62,
    ellipseRotation: 31
  }));

  assert.equal(decoded.text, "elliptical perspective");
  assert.ok(Math.abs(decoded.rasterMetadata.axisRatio - 0.62) < 0.03);
  const ellipseAngleError = Math.min(
    Math.abs(decoded.rasterMetadata.ellipseRotationDegrees - 31),
    Math.abs(decoded.rasterMetadata.ellipseRotationDegrees - 31 + 180),
    Math.abs(decoded.rasterMetadata.ellipseRotationDegrees - 31 - 180)
  );
  assert.ok(ellipseAngleError < 2);
});

test("rectifies a mirrored and rotated ellipse", () => {
  const symbol = new RoBCode2Encoder().encodeText("mirrored ellipse");
  const decoded = new RoBCode2RasterSampler().decodeImageData(createRaster(symbol, {
    moduleSize: 24,
    rotation: 133,
    mirrored: true,
    ellipseScaleY: 0.7,
    ellipseRotation: 68
  }));

  assert.equal(decoded.text, "mirrored ellipse");
  assert.equal(decoded.rasterMetadata.mirrored, true);
  assert.ok(Math.abs(decoded.rasterMetadata.axisRatio - 0.7) < 0.03);
});

test("rejects an ellipse compressed beyond the configured limit", () => {
  const symbol = new RoBCode2Encoder().encodeText("too flat");
  const flattened = createRaster(symbol, {
    moduleSize: 30,
    ellipseScaleY: 0.3,
    ellipseRotation: 20
  });

  assert.throws(
    () => new RoBCode2RasterSampler().decodeImageData(flattened),
    error => error instanceof RoBCode2RasterSampler.RasterError && error.code === "PERSPECTIVE"
  );
});

test("classifies colored data cells by distance from the paper color", () => {
  const symbol = new RoBCode2Encoder().encodeText("yellow data");
  const decoded = new RoBCode2RasterSampler().decodeImageData(createRaster(symbol, {
    dataInk: [232, 214, 44]
  }));

  assert.equal(decoded.text, "yellow data");
});

test("passes a damaged raster cell to Reed-Solomon correction", () => {
  const symbol = new RoBCode2Encoder().encodeText("correct raster damage");
  const flippedCells = new Set([48 * 9]);
  const decoded = new RoBCode2RasterSampler().decodeImageData(
    createRaster(symbol, { flippedCells })
  );

  assert.equal(decoded.text, "correct raster damage");
  assert.equal(decoded.correctedSymbols, 1);
  assert.deepEqual(decoded.parityFailures, [48]);
});

test("localizes an off-center symbol on a rectangular canvas", () => {
  const symbol = new RoBCode2Encoder().encodeText("off-center canvas");
  const source = createRaster(symbol);
  const framed = reframeRaster(source, {
    marginLeft: 120,
    marginRight: 20,
    marginTop: 35,
    marginBottom: 95
  });
  const decoded = new RoBCode2RasterSampler().decodeImageData(framed);

  assert.equal(decoded.text, "off-center canvas");
  assert.ok(framed.width !== framed.height);
  assert.ok(decoded.rasterMetadata.centerX > framed.width / 2);
  assert.ok(decoded.rasterMetadata.centerY < framed.height / 2);
});

test("decodes after asymmetric cropping removes most of the quiet zone", () => {
  const symbol = new RoBCode2Encoder().encodeText("cropped quiet zone");
  const source = createRaster(symbol);
  const cropped = reframeRaster(source, {
    cropLeft: 24,
    cropRight: 10,
    cropTop: 28,
    cropBottom: 5
  });
  const decoded = new RoBCode2RasterSampler().decodeImageData(cropped);

  assert.equal(decoded.text, "cropped quiet zone");
  assert.ok(decoded.rasterMetadata.foregroundBounds.left < 10);
  assert.ok(decoded.rasterMetadata.foregroundBounds.top < 10);
});

test("rejects cropping that cuts through the continuous outer frame", () => {
  const symbol = new RoBCode2Encoder().encodeText("damaged frame");
  const source = createRaster(symbol);
  const cutFrame = reframeRaster(source, { cropLeft: 45 });

  assert.throws(
    () => new RoBCode2RasterSampler().decodeImageData(cutFrame),
    error => error instanceof RoBCode2RasterSampler.RasterError
  );
});

test("rejects blank and undersized raster input", () => {
  const sampler = new RoBCode2RasterSampler();
  const blank = {
    width: 100,
    height: 100,
    data: new Uint8ClampedArray(100 * 100 * 4).fill(255)
  };
  assert.throws(
    () => sampler.decodeImageData(blank),
    error => error instanceof RoBCode2RasterSampler.RasterError && error.code === "CONTRAST"
  );
  assert.throws(
    () => sampler.decodeImageData({ width: 32, height: 32, data: new Uint8ClampedArray(4096) }),
    /at least 64 pixels/
  );
});
