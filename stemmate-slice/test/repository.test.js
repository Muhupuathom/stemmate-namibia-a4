"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createPlanRepository } = require("../src/planRepository.js");

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stemmate-repo-"));
  return path.join(dir, "plans.json");
}

test("QR-01: saved plans are still there when the repository is opened again (persistent data)", function () {
  const file = tempFile();
  createPlanRepository(file).save({ id: "p1", title: "First" });
  const reopened = createPlanRepository(file);
  assert.equal(reopened.list().length, 1);
  assert.equal(reopened.get("p1").title, "First");
});

test("FR-05: saving the same plan id twice replaces it and does not create a duplicate", function () {
  const repo = createPlanRepository(tempFile());
  assert.equal(repo.save({ id: "p1", title: "A" }).created, true);
  assert.equal(repo.save({ id: "p1", title: "B" }).created, false);
  assert.equal(repo.list().length, 1);
  assert.equal(repo.get("p1").title, "B");
});

test("QR-01: with no data file yet, the list is simply empty", function () {
  assert.deepEqual(createPlanRepository(tempFile()).list(), []);
});

test("FR-05: a damaged data file gives a clear error instead of silently losing data", function () {
  const file = tempFile();
  fs.writeFileSync(file, "{ this is not json");
  assert.throws(function () { createPlanRepository(file).list(); }, /damaged/);
  assert.equal(fs.readFileSync(file, "utf8"), "{ this is not json"); // file was not overwritten
});
