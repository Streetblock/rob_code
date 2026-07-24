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
      const background = this.estimateBackground(imageData);
      const contrast = this.maximumColorDistance(imageData, background);
      if (contrast < settings.minimumContrast) {
        throw new RoBCode2RasterError("CONTRAST", "Raster image does not contain a distinct dark center finder");
      }
      const threshold = Math.max(settings.minimumColorDistance, contrast * settings.thresholdRatio);
      const localization = this.locateSymbol(imageData, background, threshold);
      const isDark = (x, y) => {
        if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) return false;
        return this.colorDistance(this.sampleColor(imageData, x, y), background) >= threshold;
      };
      if (!isDark(localization.centerX, localization.centerY)) {
        throw new RoBCode2RasterError("FINDER", "Localized symbol does not contain a dark center finder");
      }

      const candidates = this.findCandidates(localization, isDark, settings);
      if (candidates.length === 0) {
        throw new RoBCode2RasterError("FINDER", "No RoBCode 2 synchronization pattern was found");
      }

      let lastDecodeError = null;
      for (const candidate of candidates) {
        try {
          const cells = this.sampleDataCells(candidate, localization, isDark);
          const decoded = this.decoder.decodeCells(cells);
          return {
            ...decoded,
            source: "raster",
            rasterMetadata: {
              width: imageData.width,
              height: imageData.height,
              moduleSize: candidate.moduleSize,
              centerX: localization.centerX,
              centerY: localization.centerY,
              rotationDegrees: candidate.rotationDegrees,
              mirrored: candidate.direction === -1,
              syncMismatches: candidate.syncMismatches,
              structureMismatches: candidate.structureMismatches,
              backgroundColor: background.map(value => Math.round(value)),
              contrast,
              foregroundBounds: {
                left: localization.left,
                top: localization.top,
                right: localization.right,
                bottom: localization.bottom
              }
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
      if (imageData.width < 64 || imageData.height < 64) {
        throw new RoBCode2RasterError("IMAGE_SHAPE", "Raster input must be at least 64 pixels in both dimensions");
      }
      if (!(imageData.data instanceof Uint8Array) && !(imageData.data instanceof Uint8ClampedArray)) {
        throw new TypeError("Raster pixel data must be a Uint8Array or Uint8ClampedArray");
      }
      if (imageData.data.length !== imageData.width * imageData.height * 4) {
        throw new RoBCode2RasterError("PIXEL_LENGTH", "RGBA pixel data length does not match image dimensions");
      }
    }

    findCandidates(localization, isDark, settings) {
      const candidates = [];
      const maximumByResolution = Math.floor(
        localization.boundingRadius / settings.minimumModulePixels - 1.35
      );
      const maximumRing = Math.min(settings.maximumOuterRing, maximumByResolution);

      for (let outerDataRing = MIN_OUTER_RING; outerDataRing <= maximumRing; outerDataRing++) {
        const moduleSize = localization.boundingRadius / (outerDataRing + 1.35);
        const structureMismatches = this.countStructureMismatches(
          outerDataRing,
          moduleSize,
          localization,
          isDark
        );
        if (structureMismatches > 4) continue;

        const orientations = this.findOrientations(
          moduleSize,
          localization,
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

    countStructureMismatches(outerDataRing, moduleSize, localization, isDark) {
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
          const point = this.polarToCartesian(
            localization.centerX,
            localization.centerY,
            probe.radius * moduleSize,
            angle
          );
          if (isDark(point.x, point.y) !== probe.dark) mismatches += 1;
        }
      }
      return mismatches;
    }

    findOrientations(moduleSize, localization, isDark, requestedStep, maximumMismatches) {
      const stepCount = Math.ceil(360 / requestedStep);
      const step = 360 / stepCount;
      const matches = [];

      for (const direction of [1, -1]) {
        for (let stepIndex = 0; stepIndex < stepCount; stepIndex++) {
          const rotationDegrees = stepIndex * step;
          let mismatches = 0;
          for (let cell = 0; cell < SYNC_BITS.length; cell++) {
            const angle = rotationDegrees + direction * (cell + 0.5) * 10;
            const point = this.polarToCartesian(
              localization.centerX,
              localization.centerY,
              1.5 * moduleSize,
              angle
            );
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

    sampleDataCells(candidate, localization, isDark) {
      const capacity = this.ringCapacity(candidate.outerDataRing);
      const cells = new Uint8Array(capacity * 9);
      let offset = 0;
      for (let ring = 2; ring <= candidate.outerDataRing; ring++) {
        const cellCount = 18 * ring;
        for (let cell = 0; cell < cellCount; cell++) {
          const logicalAngle = (cell + 0.5) * 360 / cellCount;
          const imageAngle = candidate.rotationDegrees + candidate.direction * logicalAngle;
          const point = this.polarToCartesian(
            localization.centerX,
            localization.centerY,
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
      const inset = Math.max(1, Math.floor(Math.min(imageData.width, imageData.height) * 0.02));
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

    maximumColorDistance(imageData, background) {
      let maximumSquared = 0;
      for (let offset = 0; offset < imageData.data.length; offset += 4) {
        const color = this.compositedColorAtOffset(imageData.data, offset);
        const squared = this.colorDistanceSquared(color, background);
        if (squared > maximumSquared) maximumSquared = squared;
      }
      return Math.sqrt(maximumSquared);
    }

    locateSymbol(imageData, background, threshold) {
      const thresholdSquared = threshold * threshold;
      let left = imageData.width;
      let top = imageData.height;
      let right = -1;
      let bottom = -1;

      for (let y = 0; y < imageData.height; y++) {
        for (let x = 0; x < imageData.width; x++) {
          const offset = (y * imageData.width + x) * 4;
          const color = this.compositedColorAtOffset(imageData.data, offset);
          if (this.colorDistanceSquared(color, background) < thresholdSquared) continue;
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }

      if (right < left || bottom < top) {
        throw new RoBCode2RasterError("LOCALIZATION", "No foreground symbol could be localized");
      }
      const width = right - left + 1;
      const height = bottom - top + 1;
      const tolerance = Math.max(4, Math.max(width, height) * 0.03);
      if (Math.abs(width - height) > tolerance) {
        throw new RoBCode2RasterError(
          "LOCALIZATION",
          "Localized outer frame is incomplete or not circular"
        );
      }

      return {
        left,
        top,
        right,
        bottom,
        centerX: (left + right + 1) / 2,
        centerY: (top + bottom + 1) / 2,
        boundingRadius: (width + height) / 4
      };
    }

    sampleColor(imageData, x, y) {
      const pixelX = Math.max(0, Math.min(imageData.width - 1, Math.floor(x)));
      const pixelY = Math.max(0, Math.min(imageData.height - 1, Math.floor(y)));
      const offset = (pixelY * imageData.width + pixelX) * 4;
      return this.compositedColorAtOffset(imageData.data, offset);
    }

    compositedColorAtOffset(data, offset) {
      const alpha = data[offset + 3] / 255;
      return [0, 1, 2].map(channel => data[offset + channel] * alpha + 255 * (1 - alpha));
    }

    colorDistance(left, right) {
      return Math.sqrt(this.colorDistanceSquared(left, right));
    }

    colorDistanceSquared(left, right) {
      return (left[0] - right[0]) ** 2
        + (left[1] - right[1]) ** 2
        + (left[2] - right[2]) ** 2;
    }

    polarToCartesian(centerX, centerY, radius, angleInDegrees) {
      const angle = (angleInDegrees - 90) * Math.PI / 180;
      return {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle)
      };
    }

    ringCapacity(ring) {
      return ring * (ring + 1) - 2;
    }
  }

  RoBCode2RasterSampler.RasterError = RoBCode2RasterError;

  return RoBCode2RasterSampler;
});
