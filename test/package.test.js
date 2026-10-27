import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

function read(relativePath) {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

describe("package metadata", () => {
  it("matches the package contract", () => {
    const pkg = JSON.parse(read("../package.json"));
    assert.equal(pkg.name, "@aneron/idle-kick");
    assert.equal(pkg.license, "MIT");
    assert.equal(pkg.author, "Vadim Gubin");
    assert.equal(pkg.type, "module");
    assert.equal(pkg.repository.type, "git");
    assert.equal(
      pkg.repository.url,
      "git+https://github.com/ANERON-GAMES/idle-kick.git",
    );
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.exports["."], "./src/index.js");
  });

  it("names Vadim Gubin on the license", () => {
    const license = read("../LICENSE");
    assert.match(license, /Copyright \(c\) 2026 Vadim Gubin/);
    assert.equal(license.includes("anerongames"), false);
  });
});
