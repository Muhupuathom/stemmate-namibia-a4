"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Core = require("../public/core.js");
const { createLocalServer } = require("../public/localserver.js");

function memoryStorage() {
  const data = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); }
  };
}
const input = { title: "Plan", durationMinutes: 20, steps: ["Do it"], safetyNote: "Be careful." };
const payload = (id) => Core.toServerPayload(Core.buildPlan(input, { id }));

test("QR-01: simulated server keeps plans after a 'restart'", () => {
  const storage = memoryStorage();
  createLocalServer(storage).save(payload("p1"));
  assert.equal(createLocalServer(storage).list().length, 1);
});

test("FR-05: simulated server does not duplicate a plan sent twice", () => {
  const server = createLocalServer(memoryStorage());
  assert.equal(server.save(payload("p1")).created, true);
  assert.equal(server.save(payload("p1")).created, false);
  assert.equal(server.list().length, 1);
});

test("FR-04: simulated server rejects an invalid plan", () => {
  const server = createLocalServer(memoryStorage());
  assert.throws(() => server.save(Object.assign(payload("p1"), { title: "" })), /code 400/);
  assert.equal(server.list().length, 0);
});

test("QR-01: simulated server reports 'no space' instead of pretending to save", () => {
  const full = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  assert.throws(() => createLocalServer(full).save(payload("p1")), /no space/);
});

test("The offline copy of the activities (activities-data.js) matches data/activities.json", () => {
  const json = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "activities.json"), "utf8"));
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "public", "activities-data.js"), "utf8"), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.STEMMATE_ACTIVITIES)), json);
});
