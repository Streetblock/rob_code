const RoBCode2SvgRenderer = require("../lib/rob-code-v2-svg.js");

function createSvgRoot() {
  return {
    attributes: {},
    children: [],
    setAttribute(name, value) { this.attributes[name] = String(value); },
    appendChild(element) { this.children.push(element); },
    removeChild(element) { this.children.splice(this.children.indexOf(element), 1); },
    get lastChild() { return this.children.at(-1) || null; }
  };
}

global.document = {
  createElementNS(namespace, name) {
    return {
      namespace,
      name,
      attributes: {},
      setAttribute(key, value) { this.attributes[key] = String(value); }
    };
  }
};

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function serializeAttributes(attributes) {
  return Object.entries(attributes)
    .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
    .join("");
}

const svg = createSvgRoot();
new RoBCode2SvgRenderer(svg).renderText("RoBCode 2", {
  moduleSize: 16,
  darkColor: "#111713",
  lightColor: "#ffffff",
  dataColors: [
    "#e94b35",
    "#f6a21a",
    "#e8d62c",
    "#45a85a",
    "#2bb7a9",
    "#347cc4",
    "#7356b7",
    "#d24b8f",
    "#111713"
  ]
});
delete svg.attributes["aria-label"];
svg.setAttribute("aria-labelledby", "robcode-title robcode-description");

const lines = [
  `<svg${serializeAttributes(svg.attributes)}>`,
  "  <title id=\"robcode-title\">A decodable RoBCode 2 symbol</title>",
  "  <desc id=\"robcode-description\">The UTF-8 text RoBCode 2 encoded as colored concentric data rings.</desc>",
  ...svg.children.map(element => (
    `  <${element.name}${serializeAttributes(element.attributes)} />`
  )),
  "</svg>"
];

process.stdout.write(lines.join("\n"));
