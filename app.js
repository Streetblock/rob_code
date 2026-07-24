(function (root, factory) {
  const RoBCodeApp = factory();
  if (typeof module === "object" && module.exports) module.exports = RoBCodeApp;
  root.RoBCodeApp = RoBCodeApp;

  if (root.window && root.document) {
    root.window.addEventListener("DOMContentLoaded", () => new RoBCodeApp(root.document));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  class RoBCodeApp {
    constructor(documentRoot) {
      this.document = documentRoot;
      this.form = documentRoot.getElementById("the_form");
      this.svg = documentRoot.getElementById("thesvg");
      this.previewShell = documentRoot.querySelector(".preview-shell");
      this.previewTitle = documentRoot.getElementById("preview_title");
      this.previewNote = documentRoot.getElementById("preview_note");
      this.symbolStats = documentRoot.getElementById("symbol_stats");
      this.inputCount = documentRoot.getElementById("input_count");
      this.downloadButton = this.form.querySelector("[data-action='download']");
      this.svgUpload = documentRoot.getElementById("svg_upload");
      this.decodePanel = documentRoot.querySelector(".decode-panel");
      this.decodeBadge = documentRoot.getElementById("decode_badge");
      this.decodeStatus = documentRoot.getElementById("decode_status");
      this.decodeResult = documentRoot.getElementById("decode_result");
      this.decodeSummary = documentRoot.getElementById("decode_summary");
      this.decodedPayload = documentRoot.getElementById("decoded_payload");
      this.decodePreviewNote = documentRoot.getElementById("decode_preview_note");
      this.useDecodedButton = this.form.querySelector("[data-action='use-decoded']");
      this.colourInputs = Array.from(this.form.querySelectorAll("[data-bit-colour]"));
      this.legacyRenderer = new RoBCodeRenderer(this.svg);
      this.v2Renderer = new RoBCode2SvgRenderer(this.svg);
      this.svgImporter = new RoBCode2SvgImporter();
      this.lastDecoded = null;
      this.drawTimer = null;
      this.bindEvents();
      this.syncMode();
      this.draw();
    }

    bindEvents() {
      this.form.addEventListener("submit", event => {
        event.preventDefault();
        this.cancelScheduledDraw();
        this.draw();
      });
      this.form.addEventListener("change", event => {
        if (!event.target.matches("input, select, textarea")) return;
        if (event.target === this.svgUpload) return;
        if (event.target.name === "mode") this.syncMode();
        this.draw();
      });
      this.form.elements.the_text.addEventListener("input", () => this.scheduleDraw());
      this.form.querySelector("[data-action='reverse-colours']").addEventListener("click", () => {
        const values = this.colourInputs.slice(0, 8).map(input => input.value).reverse();
        this.colourInputs.slice(0, 8).forEach((input, index) => { input.value = values[index]; });
        this.draw();
      });
      this.downloadButton.addEventListener("click", () => this.downloadSvg());
      this.svgUpload.addEventListener("change", () => {
        const file = this.svgUpload.files && this.svgUpload.files[0];
        if (file) this.decodeSvgFile(file);
      });
      this.useDecodedButton.addEventListener("click", () => this.useDecodedText());
    }

    get mode() {
      return this.form.elements.mode.value;
    }

    syncMode() {
      const mode = this.mode;
      this.document.querySelectorAll("[data-mode-section]").forEach(section => {
        section.hidden = section.dataset.modeSection !== mode;
      });
      this.document.querySelectorAll("[data-mode-copy]").forEach(copy => {
        copy.hidden = copy.dataset.modeCopy !== mode;
      });
      this.previewTitle.textContent = mode === "v2" ? "RoBCode 2" : "Legacy RoBCode";
      this.previewNote.textContent = mode === "v2"
        ? "Finder, orientation, length, checksums and error correction are embedded in the symbol."
        : "Legacy mode preserves the original visual experiment and is not self-describing.";
    }

    scheduleDraw() {
      this.cancelScheduledDraw();
      this.drawTimer = setTimeout(() => this.draw(), 120);
    }

    cancelScheduledDraw() {
      if (this.drawTimer !== null) clearTimeout(this.drawTimer);
      this.drawTimer = null;
    }

    draw() {
      this.cancelScheduledDraw();
      const text = this.form.elements.the_text.value;
      this.updateInputCount(text);

      try {
        if (this.mode === "v2") this.drawVersion2(text);
        else this.drawLegacy(text);
        this.previewShell.dataset.state = "ready";
        this.downloadButton.disabled = false;
      } catch (error) {
        this.previewShell.dataset.state = "error";
        this.symbolStats.textContent = `Could not draw symbol: ${error.message}`;
        this.downloadButton.disabled = true;
      }
    }

    drawVersion2(text) {
      const settings = this.readVersion2Settings();
      const symbol = this.v2Renderer.renderText(text, settings);
      const ringCount = symbol.outerDataRing - 1;
      this.symbolStats.textContent = [
        `${symbol.payload.length} payload bytes`,
        `${symbol.codeStream.length} protected bytes`,
        `${ringCount} data rings`,
        `${symbol.paddingBytes} pad bytes`
      ].join(" · ");
    }

    drawLegacy(text) {
      this.resetVersion2SvgAttributes();
      this.legacyRenderer.render(text, this.readLegacySettings());
      this.svg.setAttribute("aria-label", `Legacy RoBCode, ${text.length} characters`);
      this.symbolStats.textContent = `${text.length} characters · configurable legacy layout · no decoder metadata`;
    }

    readVersion2Settings() {
      const fields = this.form.elements;
      return {
        moduleSize: this.integer(fields.module_size, 18),
        darkColor: fields.dark_color.value,
        lightColor: fields.light_color.value,
        dataColors: fields.v2_heritage.checked
          ? this.colourInputs.map(input => input.value)
          : null
      };
    }

    readLegacySettings() {
      const fields = this.form.elements;
      return {
        exponential: fields.exponential.checked,
        stepSize: this.integer(fields.step_size, 2),
        startRing: this.integer(fields.start_ring, 1),
        xorEnabled: fields.xor.checked,
        xorValue: fields.xor_text.value,
        centerX: this.integer(fields.center_x, 250),
        centerY: this.integer(fields.center_y, 250),
        ringWidth: this.integer(fields.ring_width, 20),
        bytesPerSector: Math.max(1, this.integer(fields.bytes_per_sector, 1)),
        centerType: fields.center.value,
        centerByte: fields.center_byte_text.value,
        bitOrder: fields.bit_order.value,
        parity: fields.parity.value,
        counterClockwise: fields.counter_clockwise.checked,
        boundingCircle: fields.bounding_circle.checked,
        colourEnabled: fields.colour.checked,
        unrolled: fields.unroll.checked,
        colours: this.colourInputs.map(input => input.value)
      };
    }

    resetVersion2SvgAttributes() {
      ["viewBox", "data-format", "data-outer-ring", "data-payload-bytes", "shape-rendering"]
        .forEach(attribute => this.svg.removeAttribute(attribute));
      this.svg.setAttribute("width", "100%");
      this.svg.setAttribute("height", "100%");
    }

    updateInputCount(text) {
      const byteCount = typeof TextEncoder === "function"
        ? new TextEncoder().encode(text).length
        : text.length;
      this.inputCount.textContent = `${byteCount} ${byteCount === 1 ? "byte" : "bytes"}`;
    }

    downloadSvg() {
      const source = new XMLSerializer().serializeToString(this.svg);
      const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = this.document.createElement("a");
      link.href = url;
      link.download = this.mode === "v2" ? "robcode-2.svg" : "robcode-legacy.svg";
      link.hidden = true;
      this.document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    async decodeSvgFile(file) {
      const maximumSize = 64 * 1024 * 1024;
      this.lastDecoded = null;
      this.decodeResult.hidden = true;
      this.useDecodedButton.hidden = true;
      this.decodePanel.dataset.state = "loading";
      this.decodeBadge.textContent = "Checking";
      this.decodeStatus.textContent = `Reading ${file.name || "SVG file"}…`;

      try {
        if (file.size > maximumSize) throw new Error("SVG file exceeds the 64 MiB limit");
        if (file.type && file.type !== "image/svg+xml" && !String(file.name).toLowerCase().endsWith(".svg")) {
          throw new Error("Selected file is not an SVG");
        }
        const source = await file.text();
        const decoded = this.svgImporter.importString(source);
        this.showDecodedResult(decoded, file.name || "SVG file");
      } catch (error) {
        const code = error && error.code ? `${error.code}: ` : "";
        this.decodePanel.dataset.state = "error";
        this.decodeBadge.textContent = "Rejected";
        this.decodeStatus.textContent = `${code}${error.message || "Could not decode SVG"}`;
        this.decodeResult.hidden = true;
      }
    }

    showDecodedResult(decoded, fileName) {
      this.lastDecoded = decoded;
      const correctionLabel = decoded.correctedSymbols === 1 ? "symbol corrected" : "symbols corrected";
      const parityLabel = decoded.parityFailures.length === 1 ? "parity warning" : "parity warnings";
      this.decodePanel.dataset.state = "success";
      this.decodeBadge.textContent = "Verified";
      this.decodeStatus.textContent = `${fileName} is a valid RoBCode 2 SVG.`;
      this.decodeSummary.textContent = [
        `${decoded.payload.length} payload bytes`,
        `${decoded.correctedSymbols} ${correctionLabel}`,
        `${decoded.parityFailures.length} ${parityLabel}`,
        `outer ring ${decoded.outerDataRing}`
      ].join(" · ");

      const preview = this.formatDecodedPayload(decoded);
      this.decodedPayload.value = preview.value;
      this.decodePreviewNote.textContent = preview.note;
      this.useDecodedButton.hidden = decoded.text === null;
      this.decodeResult.hidden = false;
    }

    formatDecodedPayload(decoded) {
      const previewLimit = 10000;
      if (decoded.text !== null) {
        const truncated = decoded.text.length > previewLimit;
        return {
          value: truncated ? `${decoded.text.slice(0, previewLimit)}\n…` : decoded.text,
          note: truncated
            ? `Text preview is limited to ${previewLimit.toLocaleString()} characters; validation used the complete payload.`
            : "Validated UTF-8 text payload."
        };
      }

      const bytes = decoded.payload.slice(0, 4096);
      const value = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(" ");
      const truncated = decoded.payload.length > bytes.length;
      return {
        value: truncated ? `${value}\n…` : value,
        note: truncated
          ? "Binary preview is limited to 4,096 bytes; validation used the complete payload."
          : "Binary payload shown as hexadecimal bytes."
      };
    }

    useDecodedText() {
      if (!this.lastDecoded || this.lastDecoded.text === null) return;
      this.form.elements.the_text.value = this.lastDecoded.text;
      this.updateInputCount(this.lastDecoded.text);
      this.draw();
      this.form.elements.the_text.focus();
    }

    integer(field, fallback) {
      const value = parseInt(field.value, 10);
      return Number.isFinite(value) ? value : fallback;
    }
  }

  return RoBCodeApp;
});
