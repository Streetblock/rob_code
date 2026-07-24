(function (root, factory) {
  const Decoder = typeof module === "object" && module.exports
    ? require("./rob-code-v2-decoder.js")
    : root.RoBCode2Decoder;
  const RoBCode2SvgImporter = factory(Decoder);
  if (typeof module === "object" && module.exports) module.exports = RoBCode2SvgImporter;
  root.RoBCode2SvgImporter = RoBCode2SvgImporter;
})(typeof globalThis !== "undefined" ? globalThis : this, function (RoBCode2Decoder) {
  "use strict";

  const FORMAT = "RoBCode-2";
  const SYNC_BITS = "110111111010100000001111001100110010";
  const MAX_SOURCE_LENGTH = 64 * 1024 * 1024;
  const EPSILON = 1e-7;
  const KNOWN_ROLES = new Set([
    "quiet-zone",
    "center-disc",
    "locator-ring",
    "sync-cell",
    "data-cell",
    "bounding-ring"
  ]);

  class RoBCode2SvgImportError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "RoBCode2SvgImportError";
      this.code = code;
    }
  }

  class RoBCode2SvgImporter {
    constructor(decoder) {
      if (!decoder && typeof RoBCode2Decoder !== "function") {
        throw new Error("RoBCode2Decoder must be loaded before the SVG importer");
      }
      this.decoder = decoder || new RoBCode2Decoder();
    }

    importString(source) {
      if (typeof source !== "string") throw new TypeError("SVG source must be a string");
      if (source.length === 0 || source.length > MAX_SOURCE_LENGTH) {
        throw new RoBCode2SvgImportError("SOURCE_SIZE", "SVG source is empty or exceeds 64 MiB");
      }
      if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
        throw new RoBCode2SvgImportError("UNSAFE_XML", "DTD and entity declarations are not accepted");
      }
      return this.importModel(this.parseSvgString(source));
    }

    importElement(svgElement) {
      if (!svgElement || String(svgElement.localName || svgElement.tagName).toLowerCase() !== "svg") {
        throw new TypeError("An SVG root element is required");
      }
      if (typeof svgElement.getAttribute !== "function" || typeof svgElement.querySelectorAll !== "function") {
        throw new TypeError("SVG element must support attributes and queries");
      }

      const rootAttributes = this.readDomAttributes(svgElement);
      const elements = Array.from(svgElement.querySelectorAll("[data-role]"), element => ({
        name: String(element.localName || element.tagName).toLowerCase(),
        attributes: this.readDomAttributes(element)
      }));
      return this.importModel({ rootAttributes, elements });
    }

    importModel(model) {
      const outerDataRing = this.validateRoot(model.rootAttributes);
      const roles = this.groupByRole(model.elements);
      const moduleSize = this.validateFixedGeometry(model.rootAttributes, roles, outerDataRing);
      const center = this.numberAttribute(model.rootAttributes, "width", "ROOT_GEOMETRY") / 2;
      this.validateSyncRing(roles.get("sync-cell") || [], center, moduleSize);
      const cells = this.extractDataCells(
        roles.get("data-cell") || [],
        outerDataRing,
        center,
        moduleSize
      );
      const decoded = this.decoder.decodeCells(cells);

      const declaredPayloadBytes = this.integerAttribute(
        model.rootAttributes,
        "data-payload-bytes",
        "ROOT_METADATA"
      );
      if (declaredPayloadBytes !== decoded.payload.length) {
        throw new RoBCode2SvgImportError(
          "PAYLOAD_METADATA",
          "SVG payload metadata does not match the decoded header"
        );
      }

      return {
        ...decoded,
        source: "svg",
        moduleSize,
        svgMetadata: {
          format: FORMAT,
          outerDataRing,
          declaredPayloadBytes
        }
      };
    }

    validateRoot(attributes) {
      if (attributes["data-format"] !== FORMAT) {
        throw new RoBCode2SvgImportError("FORMAT", "SVG is not marked as RoBCode 2");
      }
      const outerDataRing = this.integerAttribute(attributes, "data-outer-ring", "ROOT_METADATA");
      if (outerDataRing < 7) {
        throw new RoBCode2SvgImportError("OUTER_RING", "RoBCode 2 requires at least outer data ring 7");
      }

      const width = this.numberAttribute(attributes, "width", "ROOT_GEOMETRY");
      const height = this.numberAttribute(attributes, "height", "ROOT_GEOMETRY");
      if (!this.equal(width, height) || width <= 0) {
        throw new RoBCode2SvgImportError("ROOT_GEOMETRY", "SVG width and height must form a positive square");
      }
      const viewBox = String(attributes.viewBox || "").trim().split(/[ ,]+/).map(Number);
      if (
        viewBox.length !== 4
        || viewBox.some(value => !Number.isFinite(value))
        || !this.equal(viewBox[0], 0)
        || !this.equal(viewBox[1], 0)
        || !this.equal(viewBox[2], width)
        || !this.equal(viewBox[3], height)
      ) {
        throw new RoBCode2SvgImportError("ROOT_GEOMETRY", "SVG viewBox must match its square dimensions");
      }
      return outerDataRing;
    }

    groupByRole(elements) {
      const roles = new Map();
      for (const element of elements) {
        const role = element.attributes["data-role"];
        if (!KNOWN_ROLES.has(role)) {
          throw new RoBCode2SvgImportError("UNKNOWN_ROLE", `Unknown RoBCode SVG role: ${role}`);
        }
        if (!roles.has(role)) roles.set(role, []);
        roles.get(role).push(element);
      }
      return roles;
    }

    validateFixedGeometry(root, roles, outerDataRing) {
      const quietZone = this.expectOne(roles, "quiet-zone", "rect");
      const centerDisc = this.expectOne(roles, "center-disc", "circle");
      const locatorRing = this.expectOne(roles, "locator-ring", "circle");
      const boundingRing = this.expectOne(roles, "bounding-ring", "circle");
      const size = this.numberAttribute(root, "width", "ROOT_GEOMETRY");
      const center = size / 2;
      const moduleSize = 2 * this.numberAttribute(centerDisc.attributes, "r", "FINDER_GEOMETRY");

      if (moduleSize <= 0 || !this.equal(size, 2 * (outerDataRing + 2.85) * moduleSize)) {
        throw new RoBCode2SvgImportError("QUIET_ZONE", "SVG dimensions do not provide the required quiet zone");
      }
      this.expectNumbers(quietZone.attributes, {
        x: 0,
        y: 0,
        width: size,
        height: size
      }, "QUIET_ZONE");
      this.expectNumbers(centerDisc.attributes, {
        cx: center,
        cy: center,
        r: 0.5 * moduleSize
      }, "FINDER_GEOMETRY");
      this.expectNumbers(locatorRing.attributes, {
        cx: center,
        cy: center,
        r: 0.8 * moduleSize,
        "stroke-width": 0.2 * moduleSize
      }, "FINDER_GEOMETRY");
      this.expectNumbers(boundingRing.attributes, {
        cx: center,
        cy: center,
        r: (outerDataRing + 1.25) * moduleSize,
        "stroke-width": 0.2 * moduleSize
      }, "BOUNDING_GEOMETRY");

      return moduleSize;
    }

    validateSyncRing(elements, center, moduleSize) {
      const expected = new Set(
        Array.from(SYNC_BITS, Number).flatMap((bit, index) => bit ? [index] : [])
      );
      const seen = new Set();
      for (const element of elements) {
        if (element.name !== "path") {
          throw new RoBCode2SvgImportError("SYNC_GEOMETRY", "Synchronization cells must be SVG paths");
        }
        const cell = this.integerAttribute(element.attributes, "data-cell", "SYNC_GEOMETRY");
        if (!expected.has(cell) || seen.has(cell)) {
          throw new RoBCode2SvgImportError("SYNC_PATTERN", "Synchronization pattern is invalid or duplicated");
        }
        this.expectNumbers(element.attributes, {
          "data-start-angle": cell * 10,
          "data-end-angle": (cell + 1) * 10
        }, "SYNC_GEOMETRY");
        this.expectArcPath(element.attributes, {
          center,
          innerRadius: moduleSize,
          outerRadius: 2 * moduleSize,
          startAngle: cell * 10,
          endAngle: (cell + 1) * 10
        }, "SYNC_GEOMETRY");
        seen.add(cell);
      }
      if (seen.size !== expected.size) {
        throw new RoBCode2SvgImportError("SYNC_PATTERN", "Synchronization pattern is incomplete");
      }
    }

    extractDataCells(elements, outerDataRing, center, moduleSize) {
      const capacity = this.ringCapacity(outerDataRing);
      const cells = new Uint8Array(capacity * 9);
      const seen = new Set();

      for (const element of elements) {
        if (element.name !== "path") {
          throw new RoBCode2SvgImportError("DATA_GEOMETRY", "Data cells must be SVG paths");
        }
        const ring = this.integerAttribute(element.attributes, "data-ring", "DATA_GEOMETRY");
        const cell = this.integerAttribute(element.attributes, "data-cell", "DATA_GEOMETRY");
        if (ring < 2 || ring > outerDataRing || cell < 0 || cell >= 18 * ring) {
          throw new RoBCode2SvgImportError("DATA_RANGE", "Data cell lies outside the declared rings");
        }
        const key = `${ring}:${cell}`;
        if (seen.has(key)) {
          throw new RoBCode2SvgImportError("DATA_DUPLICATE", "Data cell occurs more than once");
        }
        this.expectNumbers(element.attributes, {
          "data-start-angle": cell * 360 / (18 * ring),
          "data-end-angle": (cell + 1) * 360 / (18 * ring)
        }, "DATA_GEOMETRY");
        this.expectArcPath(element.attributes, {
          center,
          innerRadius: ring * moduleSize,
          outerRadius: (ring + 1) * moduleSize,
          startAngle: cell * 360 / (18 * ring),
          endAngle: (cell + 1) * 360 / (18 * ring)
        }, "DATA_GEOMETRY");

        const previousCapacity = ring === 2 ? 0 : this.ringCapacity(ring - 1);
        cells[previousCapacity * 9 + cell] = 1;
        seen.add(key);
      }
      return cells;
    }

    expectOne(roles, role, tagName) {
      const elements = roles.get(role) || [];
      if (elements.length !== 1 || elements[0].name !== tagName) {
        throw new RoBCode2SvgImportError("STRUCTURE", `Expected exactly one ${tagName} with role ${role}`);
      }
      return elements[0];
    }

    expectNumbers(attributes, expected, code) {
      for (const [name, value] of Object.entries(expected)) {
        if (!this.equal(this.numberAttribute(attributes, name, code), value)) {
          throw new RoBCode2SvgImportError(code, `SVG attribute ${name} has an invalid value`);
        }
      }
    }

    expectArcPath(attributes, geometry, code) {
      const actual = String(attributes.d || "").trim().replace(/\s+/g, " ");
      const expected = this.describeArc(geometry).replace(/\s+/g, " ");
      if (actual !== expected) {
        throw new RoBCode2SvgImportError(code, "SVG arc path does not match its declared cell geometry");
      }
    }

    describeArc(details) {
      const innerStart = this.polarToCartesian(details.center, details.innerRadius, details.endAngle);
      const innerEnd = this.polarToCartesian(details.center, details.innerRadius, details.startAngle);
      const outerStart = this.polarToCartesian(details.center, details.outerRadius, details.endAngle);
      const outerEnd = this.polarToCartesian(details.center, details.outerRadius, details.startAngle);
      const largeArc = details.endAngle - details.startAngle <= 180 ? 0 : 1;
      return [
        "M", outerStart.x, outerStart.y,
        "A", details.outerRadius, details.outerRadius, 0, largeArc, 0, outerEnd.x, outerEnd.y,
        "L", innerEnd.x, innerEnd.y,
        "A", details.innerRadius, details.innerRadius, 0, largeArc, 1, innerStart.x, innerStart.y,
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

    numberAttribute(attributes, name, code) {
      const value = Number(attributes[name]);
      if (attributes[name] === undefined || !Number.isFinite(value)) {
        throw new RoBCode2SvgImportError(code, `Missing or invalid numeric SVG attribute: ${name}`);
      }
      return value;
    }

    integerAttribute(attributes, name, code) {
      const value = this.numberAttribute(attributes, name, code);
      if (!Number.isInteger(value) || value < 0) {
        throw new RoBCode2SvgImportError(code, `SVG attribute ${name} must be a non-negative integer`);
      }
      return value;
    }

    equal(left, right) {
      return Math.abs(left - right) <= EPSILON * Math.max(1, Math.abs(left), Math.abs(right));
    }

    ringCapacity(ring) {
      return ring * (ring + 1) - 2;
    }

    parseSvgString(source) {
      const openingRoots = source.match(/<svg\b/gi) || [];
      const closingRoots = source.match(/<\/svg\s*>/gi) || [];
      if (openingRoots.length !== 1 || closingRoots.length !== 1) {
        throw new RoBCode2SvgImportError("XML", "SVG source must contain exactly one closed root element");
      }
      const rootMatch = source.match(/<svg\b([^>]*)>/i);
      if (!rootMatch) throw new RoBCode2SvgImportError("XML", "SVG root element is missing");
      const rootAttributes = this.parseAttributes(rootMatch[1]);
      const elements = [];
      const tagPattern = /<([A-Za-z][\w:-]*)\b([^<>]*?)\/?\s*>/g;
      let match;
      while ((match = tagPattern.exec(source)) !== null) {
        const name = match[1].toLowerCase();
        if (name === "svg") continue;
        const attributes = this.parseAttributes(match[2]);
        if (attributes["data-role"] !== undefined) elements.push({ name, attributes });
      }
      return { rootAttributes, elements };
    }

    parseAttributes(source) {
      const attributes = {};
      const attributePattern = /([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
      let match;
      while ((match = attributePattern.exec(source)) !== null) {
        if (attributes[match[1]] !== undefined) {
          throw new RoBCode2SvgImportError("XML", `Duplicate SVG attribute: ${match[1]}`);
        }
        attributes[match[1]] = this.decodeXmlEntities(match[3]);
      }
      return attributes;
    }

    decodeXmlEntities(value) {
      return value.replace(/&(quot|apos|amp|lt|gt);/g, entity => ({
        "&quot;": "\"",
        "&apos;": "'",
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">"
      })[entity]);
    }

    readDomAttributes(element) {
      const attributes = {};
      for (const attribute of Array.from(element.attributes || [])) {
        attributes[attribute.name] = attribute.value;
      }
      return attributes;
    }
  }

  RoBCode2SvgImporter.ImportError = RoBCode2SvgImportError;

  return RoBCode2SvgImporter;
});
