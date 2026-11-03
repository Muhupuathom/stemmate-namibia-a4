// tests.js - automated tests that run inside the browser (no Node needed).
// Open tests.html (or double-click Run-tests.html). Results are repeatable: same code, same result.
(function () {
  "use strict";

  var Core = window.StemCore;
  var Local = window.StemLocalServer;
  var tests = [];

  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(condition, message) { if (!condition) { throw new Error(message || "Assertion failed"); } }
  function equal(actual, expected, message) {
    if (actual !== expected) {
      throw new Error((message ? message + ": " : "") + "expected " + JSON.stringify(expected) + " but got " + JSON.stringify(actual));
    }
  }

  var goodInput = {
    title: "Balloon rocket race, Grade 6",
    activityId: "act-rocket",
    durationMinutes: 30,
    steps: ["Tie string between two chairs", "Release the balloon"],
    materials: ["balloons", "string"],
    safetyNote: "Adults handle scissors."
  };
  function withChange(change) { return Object.assign({}, goodInput, change); }

  function memoryStorage() {
    var data = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[k] = String(v); }
    };
  }

  // ---------- core rules ----------

  test("FR-04: a complete plan passes validation", function () {
    equal(Core.validatePlan(goodInput).ok, true);
  });

  test("FR-04: a plan with no title, no steps and no safety note is rejected with a message for each", function () {
    var r = Core.validatePlan({ title: "", durationMinutes: 30, steps: [], safetyNote: "" });
    assert(!r.ok && r.errors.title && r.errors.steps && r.errors.safetyNote);
  });

  test("FR-04: duration must be a whole number from 5 to 240", function () {
    [0, 4, 241, 12.5, "abc", ""].forEach(function (bad) {
      assert(!Core.validatePlan(withChange({ durationMinutes: bad })).ok, "should reject " + JSON.stringify(bad));
    });
    [5, 240, "45"].forEach(function (good) {
      assert(Core.validatePlan(withChange({ durationMinutes: good })).ok, "should accept " + JSON.stringify(good));
    });
  });

  test("QR-02: email addresses and phone numbers are rejected in every text field", function () {
    assert(Core.validatePlan(withChange({ title: "Plan for sam@example.com" })).errors.title);
    assert(Core.validatePlan(withChange({ steps: ["Call 0812345678 first"] })).errors.steps);
    assert(Core.validatePlan(withChange({ safetyNote: "Phone +264 81 234 5678" })).errors.safetyNote);
    assert(Core.validatePlan(withChange({ materials: ["a@b.com"] })).errors.materials);
  });

  test("QR-02: normal numbers (30 minutes, 12 straws) are not mistaken for phone numbers", function () {
    assert(Core.validatePlan(withChange({ steps: ["Cut 12 straws to 15 cm", "Wait 30 minutes"] })).ok);
  });

  test("QR-02: only plan fields are sent to the server (no status or error text)", function () {
    var plan = Core.buildPlan(goodInput, { id: "p1" });
    plan.status = "failed";
    plan.lastError = "local note";
    var payload = Core.toServerPayload(plan);
    assert(payload.status === undefined && payload.lastError === undefined);
  });

  test("QR-01: a new plan starts as a draft on the device", function () {
    var plan = Core.buildPlan(goodInput, { id: "p1" });
    equal(plan.status, "draft");
  });

  test("FR-05: a successful sync moves a plan to 'synced'", async function () {
    var result = await Core.syncPlan(Core.buildPlan(goodInput, { id: "p1" }), async function () { return {}; });
    equal(result.status, "synced");
  });

  test("FR-05: a failed sync moves a plan to 'failed', keeps the data and records the reason", async function () {
    var plan = Core.buildPlan(goodInput, { id: "p1" });
    var result = await Core.syncPlan(plan, async function () { throw new Error("Could not reach the server."); });
    equal(result.status, "failed");
    equal(result.lastError, "Could not reach the server.");
    equal(result.title, plan.title);
  });

  test("FR-05: a failed plan can be retried and then succeeds (recovery)", async function () {
    var failed = await Core.syncPlan(Core.buildPlan(goodInput, { id: "p1" }), async function () { throw new Error("down"); });
    assert(Core.needsSync(failed));
    var recovered = await Core.syncPlan(failed, async function () { return {}; });
    equal(recovered.status, "synced");
  });

  test("QR-01: a plan stuck on 'pending' after the page was closed goes back to 'draft'", function () {
    var stuck = Object.assign(Core.buildPlan(goodInput, { id: "p1" }), { status: "pending" });
    var done = Object.assign(Core.buildPlan(goodInput, { id: "p2" }), { status: "synced" });
    var recovered = Core.recoverInterrupted([stuck, done]);
    equal(recovered[0].status, "draft");
    equal(recovered[1].status, "synced");
  });

  test("QR-04 (partial): the device cannot be cleared while any plan is unsynced", function () {
    var synced = Object.assign(Core.buildPlan(goodInput, { id: "a" }), { status: "synced" });
    var draft = Core.buildPlan(goodInput, { id: "b" });
    equal(Core.canClearDevice([synced, draft]).ok, false);
    equal(Core.canClearDevice([synced]).ok, true);
  });

  test("QR-03: every plan state has its own icon and text, so state is not shown by colour alone", function () {
    var labels = ["draft", "pending", "synced", "failed"].map(Core.statusLabel);
    equal(new Set(labels.map(function (l) { return l.text; })).size, 4);
    equal(new Set(labels.map(function (l) { return l.icon; })).size, 4);
  });

  // ---------- simulated server (simple mode) ----------

  function payloadFor(id) { return Core.toServerPayload(Core.buildPlan(goodInput, { id: id })); }

  test("QR-01: plans saved on the simulated server are still there after a 'restart'", function () {
    var storage = memoryStorage();
    Local.createLocalServer(storage).save(payloadFor("p1"));
    equal(Local.createLocalServer(storage).list().length, 1);
  });

  test("FR-05: sending the same plan twice does not create a duplicate", function () {
    var server = Local.createLocalServer(memoryStorage());
    equal(server.save(payloadFor("p1")).created, true);
    equal(server.save(payloadFor("p1")).created, false);
    equal(server.list().length, 1);
  });

  test("FR-04: the simulated server rejects an invalid plan and stores nothing", function () {
    var server = Local.createLocalServer(memoryStorage());
    var threw = false;
    try { server.save(Object.assign(payloadFor("p1"), { title: "" })); } catch (e) { threw = true; }
    assert(threw, "expected an error");
    equal(server.list().length, 0);
  });

  test("QR-01: if the browser has no space left, saving reports an error instead of pretending it worked", function () {
    var full = { getItem: function () { return null; }, setItem: function () { throw new Error("quota"); } };
    var threw = false;
    try { Local.createLocalServer(full).save(payloadFor("p1")); } catch (e) { threw = true; }
    assert(threw, "expected an error");
  });

  // ---------- accessibility: colour contrast of the real stylesheet ----------

  function channel(v) { var c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function luminance(hex) {
    var n = parseInt(hex.slice(1), 16);
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  }
  function contrast(a, b) {
    var x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function cssColour(name) {
    return getComputedStyle(document.documentElement).getPropertyValue("--" + name).trim();
  }

  test("QR-03: text colours meet WCAG AA contrast (4.5:1)", function () {
    [["text", "bg"], ["text", "surface"], ["muted", "surface"], ["muted", "bg"], ["primary-text", "primary"],
     ["error", "surface"], ["error", "bg"], ["draft-text", "draft-bg"], ["pending-text", "pending-bg"],
     ["synced-text", "synced-bg"], ["failed-text", "failed-bg"], ["failed-text", "surface"]].forEach(function (pair) {
      var a = cssColour(pair[0]), b = cssColour(pair[1]);
      assert(/^#[0-9a-fA-F]{6}$/.test(a) && /^#[0-9a-fA-F]{6}$/.test(b), "could not read colours for " + pair.join("/"));
      var ratio = contrast(a, b);
      assert(ratio >= 4.5, pair.join(" on ") + " is only " + ratio.toFixed(2) + ":1");
    });
  });

  test("QR-03: borders and the focus outline meet 3:1 contrast", function () {
    [["border", "surface"], ["focus", "surface"], ["focus", "bg"]].forEach(function (pair) {
      var ratio = contrast(cssColour(pair[0]), cssColour(pair[1]));
      assert(ratio >= 3, pair.join(" on ") + " is only " + ratio.toFixed(2) + ":1");
    });
  });

  // ---------- run and show ----------

  function addRow(body, result, name, detail) {
    var tr = document.createElement("tr");
    [result, name, detail].forEach(function (text, i) {
      var cell = document.createElement(i === 0 ? "th" : "td");
      if (i === 0) { cell.scope = "row"; }
      cell.textContent = text;
      tr.appendChild(cell);
    });
    body.appendChild(tr);
  }

  async function runAll() {
    var body = document.querySelector("#results tbody");
    var passed = 0;
    var failed = 0;
    for (var i = 0; i < tests.length; i++) {
      try {
        await tests[i].fn();
        passed += 1;
        addRow(body, "\u2713 PASS", tests[i].name, "");
      } catch (err) {
        failed += 1;
        addRow(body, "\u2717 FAIL", tests[i].name, err.message);
      }
    }
    var text = passed + " passed, " + failed + " failed (" + tests.length + " tests)";
    document.getElementById("summary").textContent = text;
    document.title = (failed === 0 ? "PASS – " : "FAIL – ") + text;
    window.__testResults = { passed: passed, failed: failed, total: tests.length };
  }

  runAll();
})();
