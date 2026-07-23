(function () {
  "use strict";

  class RoBCodeApp {
    constructor(documentRoot = document) {
      this.form = documentRoot.getElementById("the_form");
      this.svg = documentRoot.getElementById("thesvg");
      this.renderer = new RoBCodeRenderer(this.svg);
      this.colourInputs = Array.from(this.form.querySelectorAll("[data-bit-colour]"));
      this.bindEvents();
      this.draw();
    }

    bindEvents() {
      this.form.addEventListener("submit", event => {
        event.preventDefault();
        this.draw();
      });
      this.form.addEventListener("change", event => {
        if (event.target.matches("input, select, textarea")) this.draw();
      });
      this.form.querySelector("[data-action='reverse-colours']").addEventListener("click", () => {
        const values = this.colourInputs.slice(0, 8).map(input => input.value).reverse();
        this.colourInputs.slice(0, 8).forEach((input, index) => { input.value = values[index]; });
        this.draw();
      });
    }

    draw() {
      this.renderer.render(this.form.elements.the_text.value, this.readSettings());
    }

    readSettings() {
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

    integer(field, fallback) {
      const value = parseInt(field.value, 10);
      return Number.isFinite(value) ? value : fallback;
    }
  }

  window.addEventListener("DOMContentLoaded", () => new RoBCodeApp());
})();
