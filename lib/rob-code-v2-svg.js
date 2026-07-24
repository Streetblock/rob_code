(function (root, factory) {
  const Encoder = typeof module === "object" && module.exports
    ? require("./rob-code-v2.js")
    : root.RoBCode2Encoder;
  const RoBCode2SvgRenderer = factory(Encoder);
  if (typeof module === "object" && module.exports) module.exports = RoBCode2SvgRenderer;
  root.RoBCode2SvgRenderer = RoBCode2SvgRenderer;
})(typeof globalThis !== "undefined" ? globalThis : this, function (RoBCode2Encoder) {
  "use strict";

  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const SYNC_BITS = "110111111010100000001111001100110010";
  const QUIET_ZONE_OUTER_RADIUS = 2.85;

  class RoBCode2SvgRenderer {
    constructor(svgElement, encoder) {
      if (!svgElement || typeof svgElement.appendChild !== "function") {
        throw new TypeError("A writable SVG element is required");
      }
      if (!encoder && typeof RoBCode2Encoder !== "function") {
        throw new Error("RoBCode2Encoder must be loaded before the SVG renderer");
      }
      this.svg = svgElement;
      this.encoder = encoder || new RoBCode2Encoder();
    }

    renderText(text, options) {
      return this.renderEncoded(this.encoder.encodeText(text), options);
    }

    renderBytes(bytes, options) {
      return this.renderEncoded(this.encoder.encodeBytes(bytes), options);
    }

    renderEncoded(symbol, options = {}) {
      this.validateSymbol(symbol);
      const settings = this.normalizeOptions(options);
      const outerRadius = symbol.outerDataRing + QUIET_ZONE_OUTER_RADIUS;
      const size = 2 * outerRadius * settings.moduleSize;
      const center = size / 2;

      this.clear();
      this.setSvgAttributes(symbol, size);
      this.drawBackground(size, settings.lightColor);
      this.drawFinder(center, settings);
      this.drawSyncRing(center, settings);
      this.drawDataRings(symbol, center, settings);
      this.drawBoundingRing(symbol.outerDataRing, center, settings);

      return symbol;
    }

    normalizeOptions(options) {
      const moduleSize = options.moduleSize === undefined ? 20 : Number(options.moduleSize);
      if (!Number.isFinite(moduleSize) || moduleSize <= 0) {
        throw new RangeError("moduleSize must be a positive number");
      }

      let dataColors = null;
      if (options.dataColors !== undefined && options.dataColors !== null) {
        if (!Array.isArray(options.dataColors) || options.dataColors.length !== 9) {
          throw new RangeError("dataColors must contain exactly nine colors");
        }
        dataColors = options.dataColors.slice();
      }

      return {
        moduleSize,
        darkColor: options.darkColor || "#000000",
        lightColor: options.lightColor || "#ffffff",
        dataColors
      };
    }

    validateSymbol(symbol) {
      if (!symbol || symbol.version !== 2) {
        throw new TypeError("A RoBCode 2 encoded symbol is required");
      }
      if (!(symbol.cells instanceof Uint8Array) || !Array.isArray(symbol.rings)) {
        throw new TypeError("Encoded symbol does not contain ring cell data");
      }
      if (!Number.isInteger(symbol.outerDataRing) || symbol.outerDataRing < 2) {
        throw new RangeError("Encoded symbol has an invalid outer data ring");
      }
    }

    clear() {
      while (this.svg.lastChild) this.svg.removeChild(this.svg.lastChild);
    }

    setSvgAttributes(symbol, size) {
      this.svg.setAttribute("xmlns", SVG_NAMESPACE);
      this.svg.setAttribute("width", size);
      this.svg.setAttribute("height", size);
      this.svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
      this.svg.setAttribute("role", "img");
      this.svg.setAttribute("aria-label", `RoBCode 2, ${symbol.payload.length} payload bytes`);
      this.svg.setAttribute("data-format", "RoBCode-2");
      this.svg.setAttribute("data-outer-ring", symbol.outerDataRing);
      this.svg.setAttribute("data-payload-bytes", symbol.payload.length);
      this.svg.setAttribute("shape-rendering", "geometricPrecision");
    }

    createSvgElement(name) {
      return document.createElementNS(SVG_NAMESPACE, name);
    }

    drawBackground(size, color) {
      const background = this.createSvgElement("rect");
      background.setAttribute("x", 0);
      background.setAttribute("y", 0);
      background.setAttribute("width", size);
      background.setAttribute("height", size);
      background.setAttribute("fill", color);
      background.setAttribute("data-role", "quiet-zone");
      this.svg.appendChild(background);
    }

    drawFinder(center, settings) {
      this.drawDisc(
        center,
        0.5 * settings.moduleSize,
        settings.darkColor,
        "center-disc"
      );
      this.drawStrokeRing(
        center,
        0.8 * settings.moduleSize,
        0.2 * settings.moduleSize,
        settings.darkColor,
        "locator-ring"
      );
    }

    drawSyncRing(center, settings) {
      for (let index = 0; index < SYNC_BITS.length; index++) {
        if (SYNC_BITS[index] !== "1") continue;
        this.drawArcCell({
          center,
          innerRadius: settings.moduleSize,
          outerRadius: 2 * settings.moduleSize,
          startAngle: index * 10,
          endAngle: (index + 1) * 10,
          color: settings.darkColor,
          role: "sync-cell",
          cell: index
        });
      }
    }

    drawDataRings(symbol, center, settings) {
      for (const ring of symbol.rings) {
        const cellCount = ring.cells.length;
        for (let cell = 0; cell < cellCount; cell++) {
          if (ring.cells[cell] !== 1) continue;
          const color = settings.dataColors
            ? settings.dataColors[cell % 9]
            : settings.darkColor;
          this.drawArcCell({
            center,
            innerRadius: ring.ring * settings.moduleSize,
            outerRadius: (ring.ring + 1) * settings.moduleSize,
            startAngle: cell * 360 / cellCount,
            endAngle: (cell + 1) * 360 / cellCount,
            color,
            role: "data-cell",
            ring: ring.ring,
            cell
          });
        }
      }
    }

    drawBoundingRing(outerDataRing, center, settings) {
      this.drawStrokeRing(
        center,
        (outerDataRing + 1.25) * settings.moduleSize,
        0.2 * settings.moduleSize,
        settings.darkColor,
        "bounding-ring"
      );
    }

    drawDisc(center, radius, color, role) {
      const circle = this.createSvgElement("circle");
      circle.setAttribute("cx", center);
      circle.setAttribute("cy", center);
      circle.setAttribute("r", radius);
      circle.setAttribute("fill", color);
      circle.setAttribute("data-role", role);
      this.svg.appendChild(circle);
    }

    drawStrokeRing(center, radius, strokeWidth, color, role) {
      const circle = this.createSvgElement("circle");
      circle.setAttribute("cx", center);
      circle.setAttribute("cy", center);
      circle.setAttribute("r", radius);
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke", color);
      circle.setAttribute("stroke-width", strokeWidth);
      circle.setAttribute("data-role", role);
      this.svg.appendChild(circle);
    }

    drawArcCell(details) {
      const path = this.createSvgElement("path");
      path.setAttribute("d", this.describeArc(
        details.center,
        details.innerRadius,
        details.outerRadius,
        details.startAngle,
        details.endAngle
      ));
      path.setAttribute("fill", details.color);
      path.setAttribute("data-role", details.role);
      path.setAttribute("data-cell", details.cell);
      path.setAttribute("data-start-angle", details.startAngle);
      path.setAttribute("data-end-angle", details.endAngle);
      if (details.ring !== undefined) path.setAttribute("data-ring", details.ring);
      this.svg.appendChild(path);
    }

    describeArc(center, innerRadius, outerRadius, startAngle, endAngle) {
      const innerStart = this.polarToCartesian(center, innerRadius, endAngle);
      const innerEnd = this.polarToCartesian(center, innerRadius, startAngle);
      const outerStart = this.polarToCartesian(center, outerRadius, endAngle);
      const outerEnd = this.polarToCartesian(center, outerRadius, startAngle);
      const largeArc = endAngle - startAngle <= 180 ? 0 : 1;

      return [
        "M", outerStart.x, outerStart.y,
        "A", outerRadius, outerRadius, 0, largeArc, 0, outerEnd.x, outerEnd.y,
        "L", innerEnd.x, innerEnd.y,
        "A", innerRadius, innerRadius, 0, largeArc, 1, innerStart.x, innerStart.y,
        "Z"
      ].join(" ");
    }

    polarToCartesian(center, radius, angleInDegrees) {
      const angle = (angleInDegrees - 90) * Math.PI / 180;
      return {
        x: center + radius * Math.cos(angle),
        y: center + radius * Math.sin(angle)
      };
    }
  }

  RoBCode2SvgRenderer.syncBits = SYNC_BITS;

  return RoBCode2SvgRenderer;
});
