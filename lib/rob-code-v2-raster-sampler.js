(function (root, factory) {
  const Decoder = typeof module === "object" && module.exports
    ? require("./rob-code-v2-decoder.js")
    : root.RoBCode2Decoder;
  const RoBCode2RasterSampler = factory(Decoder);
  if (typeof module === "object" && module.exports) module.exports = RoBCode2RasterSampler;
  root.RoBCode2RasterSampler = RoBCode2RasterSampler;
})(typeof globalThis !== "undefined" ? globalThis : this, function (RoBCode2Decoder) {
  "use strict";

  const SYNC_BITS = Uint8Array.from("110111111010100000001111001100110010", Number);
  const MIN_OUTER_RING = 7;
  const QUIET_ZONE_RADIUS = 2.85;

  class RoBCode2RasterError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "RoBCode2RasterError";
      this.code = code;
    }
  }

  class RoBCode2RasterSampler {
    constructor(decoder) {
      if (!decoder && typeof RoBCode2Decoder !== "function") {
        throw new Error("RoBCode2Decoder must be loaded before the raster sampler");
      }
      this.decoder = decoder || new RoBCode2Decoder();
    }

    decodeImageData(imageData, options = {}) {
      this.validateImageData(imageData);
      const settings = this.normalizeOptions(options);
      const width = imageData.width;
      const center = width / 2;
      const background = this.estimateBackground(imageData);
      const centerColor = this.sampleColor(imageData, center, center);
      const contrast = this.colorDistance(centerColor, background);
      if (contrast < settings.minimumContrast) {
        throw new RoBCode2RasterError("CONTRAST", "Raster image does not contain a distinct dark center finder");
      }
      const threshold = Math.max(settings.minimumColorDistance, contrast * settings.thresholdRatio);
      const isDark = (x, y) => this.colorDistance(
        this.sampleColor(imageData, x, y),
        background
      ) >= threshold;

      const candidates = this.findCandidates(width, center, isDark, settings);
      if (candidates.length === 0) {
        throw new RoBCode2RasterError("FINDER", "No RoBCode 2 synchronization pattern was found");
      }

      let lastDecodeError = null;
      for (const candidate of candidates) {
        try {
          const cells = this.sampleDataCells(candidate, center, isDark);
          const decoded = this.decoder.decodeCells(cells);
          return {
            ...decoded,
            source: "raster",
            rasterMetadata: {
              width: imageData.width,
              height: imageData.height,
              moduleSize: candidate.moduleSize,
              centerX: center,
              centerY: center,
              rotationDegrees: candidate.rotationDegrees,
              mirrored: candidate.direction === -1,
              syncMismatches: candidate.syncMismatches,
              structureMismatches: candidate.structureMismatches,
              backgroundColor: background.map(value => Math.round(value)),
              contrast
            }
          };
        } catch (error) {
          lastDecodeError = error;
        }
      }

      const detail = lastDecodeError && lastDecodeError.message
        ? ` Last decoder error: ${lastDecodeError.message}`
        : "";
      throw new RoBCode2RasterError(
        "DECODE",
        `Synchronization was found, but no candidate produced a valid payload.${detail}`
      );
    }

    normalizeOptions(options) {
      const settings = {
        minimumModulePixels: options.minimumModulePixels === undefined
          ? 8
          : Number(options.minimumModulePixels),
        maximumOuterRing: options.maximumOuterRing === undefined
          ? 512
          : Number(options.maximumOuterRing),
        angleStepDegrees: options.angleStepDegrees === undefined
          ? 1
          : Number(options.angleStepDegrees),
        maximumSyncMismatches: options.maximumSyncMismatches === undefined
          ? 2
          : Number(options.maximumSyncMismatches),
        minimumContrast: options.minimumContrast === undefined
          ? 40
          : Number(options.minimumContrast),
        minimumColorDistance: options.minimumColorDistance === undefined
          ? 18
          : Number(options.minimumColorDistance),
        thresholdRatio: options.thresholdRatio === undefined
          ? 0.28
          : Number(options.thresholdRatio)
      };

      if (!Number.isFinite(settings.minimumModulePixels) || settings.minimumModulePixels < 4) {
        throw new RangeError("minimumModulePixels must be at least four");
      }
      if (!Number.isInteger(settings.maximumOuterRing) || settings.maximumOuterRing < MIN_OUTER_RING) {
        throw new RangeError("maximumOuterRing must be an integer of at least seven");
      }
      if (!Number.isFinite(settings.angleStepDegrees) || settings.angleStepDegrees <= 0 || settings.angleStepDegrees > 5) {
        throw new RangeError("angleStepDegrees must be greater than zero and at most five");
      }
      if (!Number.isInteger(settings.maximumSyncMismatches)
        || settings.maximumSyncMismatches < 0
        || settings.maximumSyncMismatches > 7) {
        throw new RangeError("maximumSyncMismatches must be an integer from zero to seven");
      }
      return settings;
    }

    validateImageData(imageData) {
      if (!imageData || !Number.isInteger(imageData.width) || !Number.isInteger(imageData.height)) {
        throw new TypeError("ImageData-like input with integer width and height is required");
      }
      if (imageData.width !== imageData.height || imageData.width < 64) {
        throw new RoBCode2RasterError("IMAGE_SHAPE", "Raster input must be a square of at least 64 pixels");
      }
      if (!(imageData.data instanceof Uint8Array) && !(imageData.data instanceof Uint8ClampedArray)) {
        throw new TypeError("Raster pixel data must be a Uint8Array or Uint8ClampedArray");
      }
      if (imageData.data.length !== imageData.width * imageData.height * 4) {
        throw new RoBCode2RasterError("PIXEL_LENGTH", "RGBA pixel data length does not match image dimensions");
      }
    }

    findCandidates(width, center, isDark, settings) {
      const candidates = [];
      const maximumByResolution = Math.floor(center / settings.minimumModulePixels - QUIET_ZONE_RADIUS);
      const maximumRing = Math.min(settings.maximumOuterRing, maximumByResolution);

      for (let outerDataRing = MIN_OUTER_RING; outerDataRing <= maximumRing; outerDataRing++) {
        const moduleSize = center / (outerDataRing + QUIET_ZONE_RADIUS);
        const structureMismatches = this.countStructureMismatches(
          outerDataRing,
          moduleSize,
          center,
          isDark
        );
        if (structureMismatches > 4) continue;

        const orientations = this.findOrientations(
          moduleSize,
          center,
          isDark,
          settings.angleStepDegrees,
          settings.maximumSyncMismatches
        );
        for (const orientation of orientations) {
          candidates.push({
            outerDataRing,
            moduleSize,
            structureMismatches,
            ...orientation
          });
        }
      }

      return candidates.sort((left, right) => (
        left.syncMismatches - right.syncMismatches
        || left.structureMismatches - right.structureMismatches
        || left.outerDataRing - right.outerDataRing
      ));
    }

    countStructureMismatches(outerDataRing, moduleSize, center, isDark) {
      const probes = [
        { radius: 0.25, dark: true },
        { radius: 0.60, dark: false },
        { radius: 0.80, dark: true },
        { radius: 0.95, dark: false },
        { radius: outerDataRing + 1.075, dark: false },
        { radius: outerDataRing + 1.25, dark: true },
        { radius: outerDataRing + 1.75, dark: false },
        { radius: outerDataRing + 2.5, dark: false }
      ];
      let mismatches = 0;
      for (const probe of probes) {
        for (let angle = 0; angle < 360; angle += 45) {
          const point = this.polarToCartesian(center, probe.radius * moduleSize, angle);
          if (isDark(point.x, point.y) !== probe.dark) mismatches += 1;
        }
      }
      return mismatches;
    }

    findOrientations(moduleSize, center, isDark, requestedStep, maximumMismatches) {
      const stepCount = Math.ceil(360 / requestedStep);
      const step = 360 / stepCount;
      const matches = [];

      for (const direction of [1, -1]) {
        for (let stepIndex = 0; stepIndex < stepCount; stepIndex++) {
          const rotationDegrees = stepIndex * step;
          let mismatches = 0;
          for (let cell = 0; cell < SYNC_BITS.length; cell++) {
            const angle = rotationDegrees + direction * (cell + 0.5) * 10;
            const point = this.polarToCartesian(center, 1.5 * moduleSize, angle);
            if (Number(isDark(point.x, point.y)) !== SYNC_BITS[cell]) mismatches += 1;
            if (mismatches > maximumMismatches) break;
          }
          if (mismatches <= maximumMismatches) {
            matches.push({ syncMismatches: mismatches, rotationDegrees, direction });
          }
        }
      }
      return matches;
    }

    sampleDataCells(candidate, center, isDark) {
      const capacity = this.ringCapacity(candidate.outerDataRing);
      const cells = new Uint8Array(capacity * 9);
      let offset = 0;
      for (let ring = 2; ring <= candidate.outerDataRing; ring++) {
        const cellCount = 18 * ring;
        for (let cell = 0; cell < cellCount; cell++) {
          const logicalAngle = (cell + 0.5) * 360 / cellCount;
          const imageAngle = candidate.rotationDegrees + candidate.direction * logicalAngle;
          const point = this.polarToCartesian(
            center,
            (ring + 0.5) * candidate.moduleSize,
            imageAngle
          );
          cells[offset + cell] = Number(isDark(point.x, point.y));
        }
        offset += cellCount;
      }
      return cells;
    }

    estimateBackground(imageData) {
      const inset = Math.max(1, Math.floor(imageData.width * 0.02));
      const points = [
        [inset, inset],
        [imageData.width - 1 - inset, inset],
        [inset, imageData.height - 1 - inset],
        [imageData.width - 1 - inset, imageData.height - 1 - inset]
      ];
      const colors = points.map(([x, y]) => this.sampleColor(imageData, x, y));
      return [0, 1, 2].map(channel => (
        colors.reduce((sum, color) => sum + color[channel], 0) / colors.length
      ));
    }

    sampleColor(imageData, x, y) {
      const pixelX = Math.max(0, Math.min(imageData.width - 1, Math.floor(x)));
      const pixelY = Math.max(0, Math.min(imageData.height - 1, Math.floor(y)));
      const offset = (pixelY * imageData.width + pixelX) * 4;
      const alpha = imageData.data[offset + 3] / 255;
      return [0, 1, 2].map(channel => (
        imageData.data[offset + channel] * alpha + 255 * (1 - alpha)
      ));
    }

    colorDistance(left, right) {
      return Math.sqrt(
        (left[0] - right[0]) ** 2
        + (left[1] - right[1]) ** 2
        + (left[2] - right[2]) ** 2
      );
    }

    polarToCartesian(center, radius, angleInDegrees) {
      const angle = (angleInDegrees - 90) * Math.PI / 180;
      return {
        x: center + radius * Math.cos(angle),
        y: center + radius * Math.sin(angle)
      };
    }

    ringCapacity(ring) {
      return ring * (ring + 1) - 2;
    }
  }

  RoBCode2RasterSampler.RasterError = RoBCode2RasterError;

  return RoBCode2RasterSampler;
});
