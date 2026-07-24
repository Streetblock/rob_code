const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const RoBCode2SvgImporter = require("../lib/rob-code-v2-svg-importer.js");

const repositoryRoot = path.join(__dirname, "..");
const assetPath = path.join(repositoryRoot, "docs", "robcode-2-example.svg");
const generatorPath = path.join(repositoryRoot, "scripts", "generate-readme-example.js");

test("keeps the visual README example reproducible and decodable", () => {
  const source = fs.readFileSync(assetPath, "utf8").trimEnd();
  const generated = execFileSync(process.execPath, [generatorPath], {
    encoding: "utf8"
  }).trimEnd();
  const decoded = new RoBCode2SvgImporter().importString(source);

  assert.equal(source, generated);
  assert.equal(decoded.text, "RoBCode 2");
  assert.equal(decoded.correctedSymbols, 0);
});
