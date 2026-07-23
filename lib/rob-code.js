(function (root, factory) {
  const RoBCodeRenderer = factory();
  if (typeof module === "object" && module.exports) module.exports = RoBCodeRenderer;
  root.RoBCodeRenderer = RoBCodeRenderer;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  class RoBCodeRenderer {
    constructor(svgElement) {
      this.svg = svgElement;
    }

    render(text, settings) {
      this.clear();
      const params = {
        centerX: settings.centerX,
        centerY: settings.centerY,
        startRing: settings.startRing,
        bytesPerSector: settings.bytesPerSector,
        ringIncrement: settings.stepSize,
        firstRingOffset: this.firstSectorForRing(
          settings.startRing,
          settings.stepSize,
          settings.exponential
        ),
        ringWidth: settings.ringWidth,
        counterClockwise: settings.counterClockwise,
        bitOrder: settings.bitOrder,
        parity: settings.parity,
        bitsPerByte: settings.parity === "none" ? 8 : 9,
        xorValue: settings.xorEnabled ? this.parseNumber(settings.xorValue) : 0,
        exponential: settings.exponential,
        colours: settings.colourEnabled ? settings.colours : Array(9).fill("black"),
        unrolled: settings.unrolled,
        boundingCircle: settings.boundingCircle && !settings.unrolled
      };

      this.drawCenter(params, settings.centerType, settings.centerByte);
      this.renderBytes(this.encodeString(text), params);
    }

    clear() {
      while (this.svg.lastChild) this.svg.removeChild(this.svg.lastChild);
    }

    createSvgElement(name) {
      return document.createElementNS("http://www.w3.org/2000/svg", name);
    }

    polarToCartesian(centerX, centerY, radius, angleInDegrees) {
      const angleInRadians = (angleInDegrees - 90) * Math.PI / 180;
      return {
        x: centerX + radius * Math.cos(angleInRadians),
        y: centerY + radius * Math.sin(angleInRadians)
      };
    }

    describeArc(centerX, centerY, innerRadius, outerRadius, startAngle, endAngle) {
      const innerStart = this.polarToCartesian(centerX, centerY, innerRadius, endAngle);
      const innerEnd = this.polarToCartesian(centerX, centerY, innerRadius, startAngle);
      const outerStart = this.polarToCartesian(centerX, centerY, outerRadius, endAngle);
      const outerEnd = this.polarToCartesian(centerX, centerY, outerRadius, startAngle);
      const arcSweep = endAngle - startAngle <= 180 ? "0" : "1";

      return [
        "M", outerStart.x, outerStart.y,
        "A", outerRadius, outerRadius, 0, arcSweep, 0, outerEnd.x, outerEnd.y,
        "L", innerEnd.x, innerEnd.y,
        "A", innerRadius, innerRadius, 0, arcSweep, 1, innerStart.x, innerStart.y,
        "L", outerStart.x, outerStart.y
      ].join(" ");
    }

    drawCircleArc(params, innerRadius, outerRadius, startAngle, endAngle, colour) {
      if (params.counterClockwise) {
        const originalStart = startAngle;
        startAngle = 360 - endAngle;
        endAngle = 360 - originalStart;
      }
      const path = this.createSvgElement("path");
      path.setAttribute("d", this.describeArc(
        params.centerX,
        params.centerY,
        innerRadius,
        outerRadius,
        startAngle,
        endAngle
      ));
      path.style.stroke = colour;
      path.style.fill = colour;
      path.style.strokeWidth = "0.25";
      this.svg.appendChild(path);
    }

    drawCircleBit(params, ring, sectorsInRing, bitIndex, colour) {
      const radius = params.ringWidth * ring;
      const arcAngle = 360 / (params.bytesPerSector * sectorsInRing * params.bitsPerByte);
      const startAngle = arcAngle * bitIndex;
      this.drawCircleArc(params, radius, radius + params.ringWidth, startAngle, startAngle + arcAngle, colour);
    }

    drawRectBit(ring, rectWidth, bitIndex, colour) {
      const rect = this.createSvgElement("rect");
      rect.setAttribute("x", rectWidth / 1.6 * bitIndex);
      rect.setAttribute("y", rectWidth * ring);
      rect.setAttribute("width", rectWidth / 1.6);
      rect.setAttribute("height", rectWidth);
      rect.style.fill = colour;
      rect.style.stroke = "black";
      rect.style.strokeWidth = "0.25";
      this.svg.appendChild(rect);
    }

    drawCircle(centerX, centerY, radius, strokeWidth, colour) {
      const circle = this.createSvgElement("circle");
      circle.setAttribute("cx", centerX);
      circle.setAttribute("cy", centerY);
      circle.setAttribute("r", radius);
      circle.style.fill = strokeWidth === 0 ? colour : "none";
      circle.style.stroke = colour;
      circle.style.strokeWidth = strokeWidth === 0 ? "0.25" : strokeWidth;
      this.svg.appendChild(circle);
    }

    drawRing(centerX, centerY, outerRadius, strokeWidth, colour) {
      this.drawCircle(centerX, centerY, outerRadius, strokeWidth, colour);
    }

    drawDoubleCircle(centerX, centerY, ringWidth, colour) {
      this.drawCircle(centerX, centerY, ringWidth / 2, 0, colour);
      this.drawRing(centerX, centerY, ringWidth * 0.7, ringWidth * 0.15, colour);
    }

    encodeString(text) {
      const bytes = [];
      for (let index = 0; index < text.length; index++) {
        bytes.push(text.charCodeAt(index) & 0xff);
      }
      return bytes;
    }

    firstSectorForRing(ring, ringIncrement, exponential) {
      if (ring <= 0) return 0;
      if (ringIncrement === 0) return ring;
      ring -= 1;
      if (exponential) {
        return ringIncrement === 1
          ? ring
          : ((1 - Math.pow(ringIncrement, ring)) / (1 - ringIncrement)) * ringIncrement + 1;
      }
      return ringIncrement / 2 * (ring * ring + ring) + 1;
    }

    bitIndex(sectorInRing, bytesPerSector, byteInSector, bitsPerByte, bitInByte) {
      return (sectorInRing * bytesPerSector + byteInSector) * bitsPerByte + bitInByte;
    }

    renderByte(byte, params, ring, sectorsInRing, sectorInRing, byteInSector) {
      let parity = params.parity === "even" ? 0 : 1;
      let mask = params.bitOrder === "lsb" ? 1 : 0x80;
      const lsb = params.bitOrder === "lsb";

      for (let bit = 0; bit < 8; bit++) {
        const index = this.bitIndex(
          sectorInRing,
          params.bytesPerSector,
          byteInSector,
          params.bitsPerByte,
          bit
        );
        const isSet = (byte & mask) === mask;
        if (isSet) parity ^= 1;
        if (params.unrolled) {
          this.drawRectBit(ring, params.ringWidth, index, isSet ? params.colours[bit] : "white");
        } else if (isSet) {
          this.drawCircleBit(params, ring, sectorsInRing, index, params.colours[bit]);
        }
        if (lsb) byte >>>= 1;
        else mask >>>= 1;
      }

      if (params.parity === "none") return;
      if (params.parity === "space") parity = 0;
      else if (params.parity === "mark") parity = 1;
      const index = this.bitIndex(
        sectorInRing,
        params.bytesPerSector,
        byteInSector,
        params.bitsPerByte,
        8
      );
      if (params.unrolled) {
        this.drawRectBit(ring, params.ringWidth, index, parity ? params.colours[8] : "white");
      } else if (parity && ring !== null) {
        this.drawCircleBit(params, ring, sectorsInRing, index, params.colours[8]);
      }
    }

    sectorsInRing(ring, params) {
      if (params.ringIncrement === 0 || ring === 0) return 1;
      return params.exponential
        ? Math.pow(params.ringIncrement, ring)
        : params.ringIncrement * ring;
    }

    renderBytes(bytes, params) {
      let byteInSector = 0;
      let sectorInRing = 0;
      let ring = params.startRing;
      let sectorsInThisRing = this.sectorsInRing(ring, params);

      for (const byte of bytes) {
        this.renderByte(
          byte ^ params.xorValue,
          params,
          ring,
          sectorsInThisRing,
          sectorInRing,
          byteInSector
        );
        byteInSector += 1;
        if (byteInSector === params.bytesPerSector) {
          sectorInRing += 1;
          if (sectorInRing === sectorsInThisRing) {
            ring += 1;
            sectorsInThisRing = this.sectorsInRing(ring, params);
            sectorInRing = 0;
          }
          byteInSector = 0;
        }
      }

      const newRing = byteInSector === 0 && sectorInRing === 0;
      if (params.xorValue !== 0 && !newRing) {
        while (byteInSector < params.bytesPerSector) {
          this.renderByte(params.xorValue, params, ring, sectorsInThisRing, sectorInRing, byteInSector++);
        }
        sectorInRing += 1;
        while (sectorInRing < sectorsInThisRing) {
          for (byteInSector = 0; byteInSector < params.bytesPerSector; byteInSector++) {
            this.renderByte(params.xorValue, params, ring, sectorsInThisRing, sectorInRing, byteInSector);
          }
          sectorInRing += 1;
        }
      }

      if (params.boundingCircle) {
        if (newRing) ring -= 1;
        this.drawRing(
          params.centerX,
          params.centerY,
          params.ringWidth * (ring + 1.2),
          params.ringWidth * 0.2,
          "black"
        );
      }
    }

    renderCenterByte(params, byte) {
      let parity = params.parity === "even" ? 0 : 1;
      let mask = params.bitOrder === "lsb" ? 1 : 0x80;
      const lsb = params.bitOrder === "lsb";
      for (let bit = 0; bit < 8; bit++) {
        if ((byte & mask) === mask) {
          parity ^= 1;
          this.drawCircleArc(
            params,
            0,
            params.ringWidth,
            360 / params.bitsPerByte * bit,
            360 / params.bitsPerByte * (bit + 1),
            params.colours[bit]
          );
        }
        if (lsb) byte >>>= 1;
        else mask >>>= 1;
      }
      if (parity) {
        this.drawCircleArc(params, 0, params.ringWidth, 360 / params.bitsPerByte * 8, 360, params.colours[8]);
      }
    }

    drawCenter(params, centerType, centerByte) {
      if (params.unrolled) return;
      switch (centerType) {
        case "double_circle":
          this.drawDoubleCircle(params.centerX, params.centerY, params.ringWidth, "black");
          break;
        case "center_circle":
          this.drawCircle(params.centerX, params.centerY, params.ringWidth, 0, "black");
          break;
        case "ring":
          this.drawRing(params.centerX, params.centerY, params.ringWidth * 0.9, params.ringWidth * 0.2, "black");
          break;
        case "center_byte":
          this.renderCenterByte(params, this.parseNumber(centerByte));
          break;
      }
    }

    parseNumber(value) {
      const text = String(value).trim();
      if (text.startsWith("0b")) return parseInt(text.slice(2), 2);
      if (text.startsWith("0a")) return text.slice(2, 3).charCodeAt(0) & 0xff;
      return parseInt(text);
    }
  }

  return RoBCodeRenderer;
});
