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
      const localization = this.locateSymbol(
        imageData,
        background,
        threshold,
        settings.minimumAxisRatio
      );
      const classifyPoint = (x, y) => {
        if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) return false;
        return this.colorDistance(this.sampleColor(imageData, x, y), background) >= threshold;
      };
      const isDark = (x, y, sampleRadius = 0) => {
        if (sampleRadius <= 0.5) return classifyPoint(x, y);
        const radius = Math.max(0.75, Math.min(2.5, sampleRadius));
        const diagonal = radius * 0.7071067811865476;
        const offsets = [
          [0, 0],
          [radius, 0],
          [-radius, 0],
          [0, radius],
          [0, -radius],
          [diagonal, diagonal],
          [diagonal, -diagonal],
          [-diagonal, diagonal],
          [-diagonal, -diagonal]
        ];
        let votes = 0;
        for (const [offsetX, offsetY] of offsets) {
          if (classifyPoint(x + offsetX, y + offsetY)) votes += 1;
        }
        return votes >= 5;
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
              moduleSizeMajor: candidate.moduleSizeMajor,
              moduleSizeMinor: candidate.moduleSizeMinor,
              centerX: localization.centerX,
              centerY: localization.centerY,
              ellipseRotationDegrees: localization.ellipseRotationDegrees,
              axisRatio: localization.minorRadius / localization.majorRadius,
              perspectiveStrength: localization.perspectiveStrength,
              projectionModel: localization.perspectiveStrength > 0.01
                ? "projective"
                : "affine",
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
          : Number(options.thresholdRatio),
        minimumAxisRatio: options.minimumAxisRatio === undefined
          ? 0.35
          : Number(options.minimumAxisRatio)
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
      if (!Number.isFinite(settings.minimumAxisRatio)
        || settings.minimumAxisRatio <= 0
        || settings.minimumAxisRatio > 1) {
        throw new RangeError("minimumAxisRatio must be greater than zero and at most one");
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
        localization.minorRadius / (settings.minimumModulePixels * 0.95) - 1.35
      );
      const maximumRing = Math.min(settings.maximumOuterRing, maximumByResolution);

      for (let outerDataRing = MIN_OUTER_RING; outerDataRing <= maximumRing; outerDataRing++) {
        const candidate = {
          outerDataRing,
          moduleSizeMajor: localization.majorRadius / (outerDataRing + 1.35),
          moduleSizeMinor: localization.minorRadius / (outerDataRing + 1.35)
        };
        candidate.moduleSize = Math.sqrt(candidate.moduleSizeMajor * candidate.moduleSizeMinor);
        const structureMismatches = this.countStructureMismatches(
          candidate,
          localization,
          isDark
        );
        if (structureMismatches > 4) continue;

        const orientations = this.findOrientations(
          candidate,
          localization,
          isDark,
          settings.angleStepDegrees,
          settings.maximumSyncMismatches
        );
        for (const orientation of orientations) {
          candidates.push({
            ...candidate,
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

    countStructureMismatches(candidate, localization, isDark) {
      const sampleRadius = candidate.moduleSize * 0.04;
      const probes = [
        { radius: 0.25, dark: true },
        { radius: 0.60, dark: false },
        { radius: 0.80, dark: true },
        { radius: 0.95, dark: false },
        { radius: candidate.outerDataRing + 1.075, dark: false },
        { radius: candidate.outerDataRing + 1.25, dark: true },
        { radius: candidate.outerDataRing + 1.75, dark: false },
        { radius: candidate.outerDataRing + 2.5, dark: false }
      ];
      let mismatches = 0;
      for (const probe of probes) {
        for (let angle = 0; angle < 360; angle += 45) {
          const point = this.mapEllipsePoint(localization, candidate, probe.radius, angle);
          if (isDark(point.x, point.y, sampleRadius) !== probe.dark) mismatches += 1;
        }
      }
      return mismatches;
    }

    findOrientations(candidate, localization, isDark, requestedStep, maximumMismatches) {
      const stepCount = Math.ceil(360 / requestedStep);
      const step = 360 / stepCount;
      const matches = [];
      const sampleRadius = candidate.moduleSize * 0.04;

      for (const direction of [1, -1]) {
        for (let stepIndex = 0; stepIndex < stepCount; stepIndex++) {
          const rotationDegrees = stepIndex * step;
          let mismatches = 0;
          for (let cell = 0; cell < SYNC_BITS.length; cell++) {
            const angle = rotationDegrees + direction * (cell + 0.5) * 10;
            const point = this.mapEllipsePoint(localization, candidate, 1.5, angle);
            if (Number(isDark(point.x, point.y, sampleRadius)) !== SYNC_BITS[cell]) mismatches += 1;
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
      const sampleRadius = candidate.moduleSize * 0.04;
      for (let ring = 2; ring <= candidate.outerDataRing; ring++) {
        const cellCount = 18 * ring;
        for (let cell = 0; cell < cellCount; cell++) {
          const logicalAngle = (cell + 0.5) * 360 / cellCount;
          const imageAngle = candidate.rotationDegrees + candidate.direction * logicalAngle;
          const point = this.mapEllipsePoint(localization, candidate, ring + 0.5, imageAngle);
          cells[offset + cell] = Number(isDark(point.x, point.y, sampleRadius));
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

    locateSymbol(imageData, background, threshold, minimumAxisRatio) {
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
      const bounds = {
        left,
        top,
        right,
        bottom,
        centerX: (left + right + 1) / 2,
        centerY: (top + bottom + 1) / 2
      };
      const ellipse = this.fitOuterEllipse(
        imageData,
        background,
        thresholdSquared,
        bounds,
        Math.sqrt(width * width + height * height)
      );
      if (ellipse.minorRadius / ellipse.majorRadius < minimumAxisRatio) {
        throw new RoBCode2RasterError("PERSPECTIVE", "Outer frame is too compressed to sample reliably");
      }
      const centerFinder = this.locateCenterFinder(
        imageData,
        background,
        thresholdSquared,
        ellipse
      );
      const centerInEllipse = this.toEllipseCoordinates(ellipse, centerFinder.x, centerFinder.y);
      const perspectiveStrength = Math.hypot(centerInEllipse.x, centerInEllipse.y);
      if (perspectiveStrength >= 0.82) {
        throw new RoBCode2RasterError("PERSPECTIVE", "Perspective is too strong to rectify reliably");
      }
      return {
        ...bounds,
        ...ellipse,
        centerX: centerFinder.x,
        centerY: centerFinder.y,
        projectiveCenter: centerInEllipse,
        perspectiveStrength
      };
    }

    fitOuterEllipse(imageData, background, thresholdSquared, bounds, maximumRadius) {
      const points = [];
      for (let angle = 0; angle < 360; angle += 2) {
        const radians = angle * Math.PI / 180;
        const directionX = Math.cos(radians);
        const directionY = Math.sin(radians);
        let farthest = null;
        for (let radius = 0; radius <= maximumRadius; radius += 0.5) {
          const x = bounds.centerX + directionX * radius;
          const y = bounds.centerY + directionY * radius;
          if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) break;
          const color = this.sampleColor(imageData, x, y);
          if (this.colorDistanceSquared(color, background) >= thresholdSquared) {
            farthest = { x: x - bounds.centerX, y: y - bounds.centerY };
          }
        }
        if (farthest) points.push(farthest);
      }
      if (points.length < 120) {
        throw new RoBCode2RasterError("LOCALIZATION", "Continuous outer frame could not be traced");
      }

      const normal = Array.from({ length: 5 }, () => Array(5).fill(0));
      const target = Array(5).fill(0);
      const coordinateScale = Math.max(1, maximumRadius);
      for (const point of points) {
        const normalizedPointX = point.x / coordinateScale;
        const normalizedPointY = point.y / coordinateScale;
        const row = [
          normalizedPointX * normalizedPointX,
          normalizedPointX * normalizedPointY,
          normalizedPointY * normalizedPointY,
          normalizedPointX,
          normalizedPointY
        ];
        for (let leftIndex = 0; leftIndex < row.length; leftIndex++) {
          target[leftIndex] += row[leftIndex];
          for (let rightIndex = 0; rightIndex < row.length; rightIndex++) {
            normal[leftIndex][rightIndex] += row[leftIndex] * row[rightIndex];
          }
        }
      }
      const [coefficientX, coefficientXY, coefficientY, coefficientLinearX, coefficientLinearY]
        = this.solveLinearSystem(normal, target);
      const [localEllipseCenterX, localEllipseCenterY] = this.solveLinearSystem(
        [[2 * coefficientX, coefficientXY], [coefficientXY, 2 * coefficientY]],
        [-coefficientLinearX, -coefficientLinearY]
      );
      const ellipseCenterX = bounds.centerX + localEllipseCenterX * coordinateScale;
      const ellipseCenterY = bounds.centerY + localEllipseCenterY * coordinateScale;
      const centerValue = coefficientX * localEllipseCenterX ** 2
        + coefficientXY * localEllipseCenterX * localEllipseCenterY
        + coefficientY * localEllipseCenterY ** 2
        + coefficientLinearX * localEllipseCenterX
        + coefficientLinearY * localEllipseCenterY;
      const scale = 1 - centerValue;
      if (!(scale > 0)) {
        throw new RoBCode2RasterError("LOCALIZATION", "Outer frame did not produce a bounded ellipse");
      }
      const normalizedX = coefficientX / scale;
      const normalizedXY = coefficientXY / scale;
      const normalizedY = coefficientY / scale;
      const discriminant = Math.sqrt(
        (normalizedX - normalizedY) ** 2 + normalizedXY ** 2
      );
      const largerEigenvalue = (normalizedX + normalizedY + discriminant) / 2;
      const smallerEigenvalue = (normalizedX + normalizedY - discriminant) / 2;
      if (!(largerEigenvalue > 0) || !(smallerEigenvalue > 0)) {
        throw new RoBCode2RasterError("LOCALIZATION", "Outer frame did not produce a valid ellipse");
      }

      const majorRadius = coordinateScale / Math.sqrt(smallerEigenvalue);
      const minorRadius = coordinateScale / Math.sqrt(largerEigenvalue);
      let majorVector;
      if (Math.abs(normalizedXY) < 1e-12) {
        majorVector = normalizedX <= normalizedY ? [1, 0] : [0, 1];
      } else {
        majorVector = [
          -normalizedXY / 2,
          normalizedX - smallerEigenvalue
        ];
        const length = Math.hypot(majorVector[0], majorVector[1]);
        majorVector = majorVector.map(value => value / length);
      }
      if (majorRadius / minorRadius < 1.01) majorVector = [1, 0];

      const residual = Math.sqrt(points.reduce((sum, point) => {
        const dx = point.x / coordinateScale - localEllipseCenterX;
        const dy = point.y / coordinateScale - localEllipseCenterY;
        const value = normalizedX * dx * dx + normalizedXY * dx * dy + normalizedY * dy * dy;
        return sum + (value - 1) ** 2;
      }, 0) / points.length);
      if (residual > 0.08) {
        throw new RoBCode2RasterError("LOCALIZATION", "Outer frame is incomplete or not elliptical");
      }

      return {
        ellipseCenterX,
        ellipseCenterY,
        majorRadius,
        minorRadius,
        majorVector,
        ellipseRotationDegrees: (
          Math.atan2(majorVector[1], majorVector[0]) * 180 / Math.PI + 360
        ) % 180,
        ellipseResidual: residual
      };
    }

    locateCenterFinder(imageData, background, thresholdSquared, ellipse) {
      const width = imageData.width;
      const height = imageData.height;
      const visited = new Uint8Array(width * height);
      const candidates = [];
      const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const startIndex = y * width + x;
          if (visited[startIndex]) continue;
          visited[startIndex] = 1;
          const ellipsePoint = this.toEllipseCoordinates(ellipse, x + 0.5, y + 0.5);
          if (Math.hypot(ellipsePoint.x, ellipsePoint.y) > 0.78
            || this.colorDistanceSquared(this.sampleColor(imageData, x, y), background) < thresholdSquared) {
            continue;
          }

          const queue = [[x, y]];
          let head = 0;
          let area = 0;
          let sumX = 0;
          let sumY = 0;
          let sumXX = 0;
          let sumXY = 0;
          let sumYY = 0;
          let perimeter = 0;
          let maximumNormalizedRadius = 0;
          while (head < queue.length) {
            const [currentX, currentY] = queue[head++];
            const normalized = this.toEllipseCoordinates(ellipse, currentX + 0.5, currentY + 0.5);
            maximumNormalizedRadius = Math.max(maximumNormalizedRadius, Math.hypot(normalized.x, normalized.y));
            area += 1;
            sumX += normalized.x;
            sumY += normalized.y;
            sumXX += normalized.x * normalized.x;
            sumXY += normalized.x * normalized.y;
            sumYY += normalized.y * normalized.y;
            for (const [offsetX, offsetY] of directions) {
              const nextX = currentX + offsetX;
              const nextY = currentY + offsetY;
              if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
                perimeter += 1;
                continue;
              }
              const nextIndex = nextY * width + nextX;
              const nextNormalized = this.toEllipseCoordinates(ellipse, nextX + 0.5, nextY + 0.5);
              const isInside = Math.hypot(nextNormalized.x, nextNormalized.y) <= 0.78;
              const isForeground = isInside
                && this.colorDistanceSquared(this.sampleColor(imageData, nextX, nextY), background) >= thresholdSquared;
              if (!isForeground) {
                perimeter += 1;
              } else if (!visited[nextIndex]) {
                visited[nextIndex] = 1;
                queue.push([nextX, nextY]);
              }
            }
          }
          if (area < 12 || maximumNormalizedRadius > 0.72) continue;
          const meanX = sumX / area;
          const meanY = sumY / area;
          const varianceX = Math.max(0, sumXX / area - meanX * meanX);
          const covariance = sumXY / area - meanX * meanY;
          const varianceY = Math.max(0, sumYY / area - meanY * meanY);
          const covarianceDiscriminant = Math.sqrt((varianceX - varianceY) ** 2 + 4 * covariance ** 2);
          const largerVariance = (varianceX + varianceY + covarianceDiscriminant) / 2;
          const smallerVariance = (varianceX + varianceY - covarianceDiscriminant) / 2;
          const isotropy = largerVariance > 0 ? Math.max(0, smallerVariance / largerVariance) : 0;
          const circularity = perimeter > 0 ? 4 * Math.PI * area / (perimeter * perimeter) : 0;
          candidates.push({
            x: ellipse.ellipseCenterX + ellipse.majorVector[0] * meanX * ellipse.majorRadius
              - ellipse.majorVector[1] * meanY * ellipse.minorRadius,
            y: ellipse.ellipseCenterY + ellipse.majorVector[1] * meanX * ellipse.majorRadius
              + ellipse.majorVector[0] * meanY * ellipse.minorRadius,
            score: isotropy * circularity * Math.sqrt(area),
            isotropy,
            circularity,
            area
          });
        }
      }
      candidates.sort((left, right) => right.score - left.score);
      if (!candidates.length || candidates[0].isotropy < 0.18) {
        throw new RoBCode2RasterError("FINDER", "The projected center finder could not be localized");
      }
      return candidates[0];
    }

    toEllipseCoordinates(ellipse, x, y) {
      const dx = x - ellipse.ellipseCenterX;
      const dy = y - ellipse.ellipseCenterY;
      return {
        x: (ellipse.majorVector[0] * dx + ellipse.majorVector[1] * dy) / ellipse.majorRadius,
        y: (-ellipse.majorVector[1] * dx + ellipse.majorVector[0] * dy) / ellipse.minorRadius
      };
    }

    solveLinearSystem(matrix, vector) {
      const rows = matrix.map((row, index) => [...row, vector[index]]);
      const size = matrix.length;
      for (let column = 0; column < size; column++) {
        let pivot = column;
        for (let row = column + 1; row < size; row++) {
          if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
        }
        if (Math.abs(rows[pivot][column]) < 1e-12) {
          throw new RoBCode2RasterError("LOCALIZATION", "Ellipse fit is numerically singular");
        }
        if (pivot !== column) [rows[pivot], rows[column]] = [rows[column], rows[pivot]];
        const divisor = rows[column][column];
        for (let entry = column; entry <= size; entry++) rows[column][entry] /= divisor;
        for (let row = 0; row < size; row++) {
          if (row === column) continue;
          const factor = rows[row][column];
          for (let entry = column; entry <= size; entry++) {
            rows[row][entry] -= factor * rows[column][entry];
          }
        }
      }
      return rows.map(row => row[size]);
    }

    mapEllipsePoint(localization, candidate, radius, angleInDegrees) {
      const angle = (angleInDegrees - 90) * Math.PI / 180;
      const normalizedRadius = radius / (candidate.outerDataRing + 1.35);
      const logicalX = normalizedRadius * Math.cos(angle);
      const logicalY = normalizedRadius * Math.sin(angle);
      const center = localization.projectiveCenter || { x: 0, y: 0 };
      const centerLengthSquared = center.x * center.x + center.y * center.y;
      let normalizedX = logicalX;
      let normalizedY = logicalY;
      if (centerLengthSquared > 1e-12) {
        const gamma = 1 / Math.sqrt(1 - centerLengthSquared);
        const scale = (gamma - 1) / centerLengthSquared;
        const dot = center.x * logicalX + center.y * logicalY;
        const denominator = gamma * (1 + dot);
        normalizedX = (
          logicalX + scale * center.x * dot + gamma * center.x
        ) / denominator;
        normalizedY = (
          logicalY + scale * center.y * dot + gamma * center.y
        ) / denominator;
      }
      const majorX = localization.majorVector[0];
      const majorY = localization.majorVector[1];
      return {
        x: localization.ellipseCenterX
          + majorX * normalizedX * localization.majorRadius
          - majorY * normalizedY * localization.minorRadius,
        y: localization.ellipseCenterY
          + majorY * normalizedX * localization.majorRadius
          + majorX * normalizedY * localization.minorRadius
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

    ringCapacity(ring) {
      return ring * (ring + 1) - 2;
    }
  }

  RoBCode2RasterSampler.RasterError = RoBCode2RasterError;

  return RoBCode2RasterSampler;
});
