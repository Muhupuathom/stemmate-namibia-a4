"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../public/core.js");

const goodInput = {
  title: "Balloon rocket race, Grade 6",
  activityId: "act-rocket",
  durationMinutes: 30,
  steps: ["Tie string between two chairs", "Release the balloon"],
  materials: ["balloons", "string"],
  safetyNote: "Adults handle scissors."
};

test("FR-04: a complete plan passes validation", function () {
  const result = Core.validatePlan(goodInput);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, {});
});

test("FR-04: a plan with no title, no steps and no safety note is rejected with a message for each", function () {
  const result = Core.validatePlan({ title: "", durationMinutes: 30, steps: [], safetyNote: "" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.title);
  assert.ok(result.errors.steps);
  assert.ok(result.errors.safetyNote);
});

test("FR-04: duration must be a whole number from 5 to 240", function () {
  [0, 4, 241, 12.5, "abc", ""].forEach(function (bad) {
    const result = Core.validatePlan(Object.assign({}, goodInput, { durationMinutes: bad }));
    assert.equal(result.ok, false, "should reject " + JSON.stringify(bad));
    assert.ok(result.errors.durationMinutes);
  });
  [5, 240, "45"].forEach(function (good) {
    assert.equal(Core.validatePlan(Object.assign({}, goodInput, { durationMinutes: good })).ok, true);
  });
});

test("QR-02: email addresses and phone numbers are rejected in every text field", function () {
  const withEmail = Core.validatePlan(Object.assign({}, goodInput, { title: "Plan for sam@example.com" }));
  assert.ok(withEmail.errors.title);
  const withPhone = Core.validatePlan(Object.assign({}, goodInput, { steps: ["Call 0812345678 first"] }));
  assert.ok(withPhone.errors.steps);
  const inSafety = Core.validatePlan(Object.assign({}, goodInput, { safetyNote: "Phone +264 81 234 5678" }));
  assert.ok(inSafety.errors.safetyNote);
  const inMaterials = Core.validatePlan(Object.assign({}, goodInput, { materials: ["a@b.com"] }));
  assert.ok(inMaterials.errors.materials);
});

test("QR-02: normal numbers in a plan (30 minutes, 12 straws) are not mistaken for phone numbers", function () {
  const result = Core.validatePlan(Object.assign({}, goodInput, { steps: ["Cut 12 straws to 15 cm", "Wait 30 minutes"] }));
  assert.equal(result.ok, true);
});

test("QR-02: the data sent to the server contains only the plan fields, not status or error text", function () {
  const plan = Core.buildPlan(goodInput, { id: "p1", now: "2026-10-27T10:00:00.000Z" });
  plan.status = "failed";
  plan.lastError = "secret local note";
  const payload = Core.toServerPayload(plan);
  assert.equal(payload.status, undefined);
  assert.equal(payload.lastError, undefined);
  assert.equal(payload.title, goodInput.title);
});

test("QR-01: a new plan starts as a draft on the device", function () {
  const plan = Core.buildPlan(goodInput, { id: "p1", now: "2026-10-27T10:00:00.000Z" });
  assert.equal(plan.status, "draft");
  assert.equal(plan.version, 1);
  assert.equal(plan.id, "p1");
});

test("FR-05: a successful sync moves a plan to 'synced'", async function () {
  const plan = Core.buildPlan(goodInput, { id: "p1" });
  const result = await Core.syncPlan(plan, async function () { return { ok: true }; });
  assert.equal(result.status, "synced");
  assert.equal(result.lastError, null);
});

test("FR-05: a failed sync moves a plan to 'failed', keeps the plan data and records the reason", async function () {
  const plan = Core.buildPlan(goodInput, { id: "p1" });
  const result = await Core.syncPlan(plan, async function () { throw new Error("Could not reach the server."); });
  assert.equal(result.status, "failed");
  assert.equal(result.lastError, "Could not reach the server.");
  assert.equal(result.title, plan.title);
  assert.deepEqual(result.steps, plan.steps);
});

test("FR-05: a failed plan can be retried and then succeeds (recovery)", async function () {
  const plan = Core.buildPlan(goodInput, { id: "p1" });
  const failed = await Core.syncPlan(plan, async function () { throw new Error("down"); });
  assert.equal(Core.needsSync(failed), true);
  const recovered = await Core.syncPlan(failed, async function () { return {}; });
  assert.equal(recovered.status, "synced");
});

test("QR-01: a plan stuck on 'pending' after the page was closed goes back to 'draft'", function () {
  const stuck = Object.assign(Core.buildPlan(goodInput, { id: "p1" }), { status: "pending" });
  const done = Object.assign(Core.buildPlan(goodInput, { id: "p2" }), { status: "synced" });
  const recovered = Core.recoverInterrupted([stuck, done]);
  assert.equal(recovered[0].status, "draft");
  assert.equal(recovered[1].status, "synced");
});

test("QR-04 (partial): the device cannot be cleared while any plan is unsynced", function () {
  const synced = Object.assign(Core.buildPlan(goodInput, { id: "a" }), { status: "synced" });
  const draft = Core.buildPlan(goodInput, { id: "b" });
  assert.deepEqual(Core.canClearDevice([synced, draft]), { ok: false, unsynced: 1 });
  assert.deepEqual(Core.canClearDevice([synced]), { ok: true, unsynced: 0 });
  assert.deepEqual(Core.canClearDevice([]), { ok: true, unsynced: 0 });
});

test("QR-03: every plan state has its own icon and text, so state is not shown by colour alone", function () {
  const labels = ["draft", "pending", "synced", "failed"].map(Core.statusLabel);
  labels.forEach(function (label) {
    assert.ok(label.icon.length > 0);
    assert.ok(label.text.length > 0);
  });
  assert.equal(new Set(labels.map(function (l) { return l.text; })).size, 4);
  assert.equal(new Set(labels.map(function (l) { return l.icon; })).size, 4);
});
