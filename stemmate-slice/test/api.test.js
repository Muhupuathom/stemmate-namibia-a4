"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server.js");

const goodPlan = {
  id: "plan-1",
  title: "Balloon rocket race",
  activityId: "act-rocket",
  durationMinutes: 30,
  steps: ["Tie the string", "Release the balloon"],
  materials: ["balloons"],
  safetyNote: "Adults handle scissors.",
  version: 1,
  createdAt: "2026-10-27T10:00:00.000Z"
};

async function startServer(plansFile) {
  const file = plansFile || path.join(fs.mkdtempSync(path.join(os.tmpdir(), "stemmate-api-")), "plans.json");
  const app = createApp({ plansFile: file });
  await new Promise(function (resolve) { app.server.listen(0, "127.0.0.1", resolve); });
  return {
    app: app,
    file: file,
    base: "http://127.0.0.1:" + app.server.address().port,
    close: function () {
      if (app.server.closeAllConnections) { app.server.closeAllConnections(); }
      return new Promise(function (resolve) { app.server.close(resolve); });
    }
  };
}

function post(base, body) {
  return fetch(base + "/api/plans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

test("FR-05: POST a valid plan -> 201, and it appears in GET /api/plans", async function () {
  const s = await startServer();
  try {
    const response = await post(s.base, goodPlan);
    assert.equal(response.status, 201);
    const list = await (await fetch(s.base + "/api/plans")).json();
    assert.equal(list.plans.length, 1);
    assert.equal(list.plans[0].title, "Balloon rocket race");
    assert.ok(list.plans[0].receivedAt);
  } finally { await s.close(); }
});

test("FR-04: POST an invalid plan -> 400 with field errors, and nothing is stored", async function () {
  const s = await startServer();
  try {
    const response = await post(s.base, Object.assign({}, goodPlan, { title: "", steps: [] }));
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.ok(body.errors.title);
    assert.ok(body.errors.steps);
    assert.equal((await (await fetch(s.base + "/api/plans")).json()).plans.length, 0);
  } finally { await s.close(); }
});

test("QR-02: the server rejects a plan that contains an email address", async function () {
  const s = await startServer();
  try {
    const response = await post(s.base, Object.assign({}, goodPlan, { steps: ["Email sam@example.com"] }));
    assert.equal(response.status, 400);
    assert.ok((await response.json()).errors.steps);
  } finally { await s.close(); }
});

test("FR-05: sending the same plan twice -> 201 then 200, and only one copy is stored (safe to retry)", async function () {
  const s = await startServer();
  try {
    assert.equal((await post(s.base, goodPlan)).status, 201);
    assert.equal((await post(s.base, goodPlan)).status, 200);
    assert.equal((await (await fetch(s.base + "/api/plans")).json()).plans.length, 1);
  } finally { await s.close(); }
});

test("QR-01: plans are still on the server after it is stopped and started again", async function () {
  const first = await startServer();
  await post(first.base, goodPlan);
  await first.close();
  const second = await startServer(first.file);
  try {
    const list = await (await fetch(second.base + "/api/plans")).json();
    assert.equal(list.plans.length, 1);
    assert.equal(list.plans[0].id, "plan-1");
  } finally { await second.close(); }
});

test("FR-05 recovery: when the server fails once (503) the same plan can be sent again and is accepted", async function () {
  const s = await startServer();
  try {
    s.app.state.failNext = 1;
    assert.equal((await post(s.base, goodPlan)).status, 503);
    assert.equal((await (await fetch(s.base + "/api/plans")).json()).plans.length, 0);
    assert.equal((await post(s.base, goodPlan)).status, 201);
  } finally { await s.close(); }
});

test("Security: a request that is not valid JSON -> 400", async function () {
  const s = await startServer();
  try {
    assert.equal((await post(s.base, "{ not json")).status, 400);
  } finally { await s.close(); }
});

test("Security: a very large request body -> 413 and nothing is stored", async function () {
  const s = await startServer();
  try {
    const huge = Object.assign({}, goodPlan, { safetyNote: "x".repeat(200 * 1024) });
    assert.equal((await post(s.base, huge)).status, 413);
    assert.equal((await (await fetch(s.base + "/api/plans")).json()).plans.length, 0);
  } finally { await s.close(); }
});

test("Security: a '../' path cannot read files outside the public folder", async function () {
  const s = await startServer();
  try {
    const port = s.app.server.address().port;
    const result = await new Promise(function (resolve, reject) {
      http.get({ host: "127.0.0.1", port: port, path: "/..%2fserver.js" }, function (res) {
        let text = "";
        res.on("data", function (c) { text += c; });
        res.on("end", function () { resolve({ status: res.statusCode, text: text }); });
      }).on("error", reject);
    });
    assert.equal(result.status, 403);
    assert.ok(result.text.indexOf("createApp") === -1);
  } finally { await s.close(); }
});

test("Security: responses carry a Content-Security-Policy and nosniff header", async function () {
  const s = await startServer();
  try {
    const response = await fetch(s.base + "/");
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("content-security-policy").indexOf("default-src 'self'") >= 0);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  } finally { await s.close(); }
});

test("FR-02 (supporting): the activity list is available and clearly marked as synthetic", async function () {
  const s = await startServer();
  try {
    const data = await (await fetch(s.base + "/api/activities")).json();
    assert.ok(data.activities.length >= 5);
    assert.ok(/synthetic/i.test(data.note));
  } finally { await s.close(); }
});

test("Unknown API routes return 404", async function () {
  const s = await startServer();
  try {
    assert.equal((await fetch(s.base + "/api/nothing")).status, 404);
  } finally { await s.close(); }
});
