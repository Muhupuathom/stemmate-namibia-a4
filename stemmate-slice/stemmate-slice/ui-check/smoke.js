// OPTIONAL UI check. Needs a one-off install:  npm install --no-save jsdom
// Run with:  node ui-check/smoke.js
// It loads the real page in a simulated browser (jsdom) and clicks through the workflow.
// jsdom is NOT a real browser: it cannot check keyboard use, screen readers or the service worker.
const { JSDOM } = require("jsdom");
const fs = require("fs"), os = require("os"), path = require("path");
const { createApp } = require(require("path").join(__dirname, "..", "server.js"));

const results = [];
function check(name, condition) { results.push((condition ? "PASS  " : "FAIL  ") + name); if (!condition) process.exitCode = 1; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 3000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(25); } return false; }

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stemmate-ui-"));
  const app = createApp({ plansFile: path.join(dir, "plans.json") });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + app.server.address().port;

  const dom = await JSDOM.fromURL(base + "/", {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
    beforeParse(window) { window.fetch = (u, o) => fetch(new URL(u, base), o); window.confirm = () => true; }
  });
  const w = dom.window, d = w.document, $ = (id) => d.getElementById(id);
  const fill = (id, v) => { $(id).value = v; };
  const submit = () => $("plan-form").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
  const cards = () => [...d.querySelectorAll("#plan-list .plan-card")];
  const badgeText = (i) => cards()[i].querySelector(".badge").textContent;

  check("page loads and activity list is filled from the server", await waitFor(() => $("activity").options.length > 5));
  check("connection banner says Online", /Online/.test($("connection").textContent));
  check("activities were cached in localStorage for offline use", JSON.parse(w.localStorage.getItem("stemmate.activities.v1")).length >= 5);

  // 1. validation
  submit();
  check("empty form: error summary is shown", !$("error-summary").hidden);
  check("empty form: errors listed for title, duration, steps, safety", d.querySelectorAll("#error-list li").length === 4);
  check("empty form: focus moves to the error summary", d.activeElement === $("error-summary"));
  check("empty form: fields marked aria-invalid", $("title").getAttribute("aria-invalid") === "true");
  check("empty form: nothing was saved", cards().length === 0);

  // 2. happy path online
  fill("title", "Balloon rocket race, Grade 6"); fill("duration", "30");
  fill("steps", "Tie the string\nRelease the balloon"); fill("safety", "Adults handle scissors.");
  submit();
  check("valid form: error summary is hidden again", $("error-summary").hidden);
  check("valid form: plan appears in the list", cards().length === 1);
  check("online: plan syncs automatically to Synced", await waitFor(() => /Synced/.test(badgeText(0))));
  check("server list shows the plan (persistent output)", await waitFor(() => /Balloon rocket race/.test($("server-list").textContent)));
  check("server really stored it", app.repo.list().length === 1);

  // 3. failure and recovery
  $("demo-fail").checked = true;
  fill("title", "Solar oven build"); fill("duration", "60"); fill("steps", "Line the box"); fill("safety", "Hot surfaces - supervise.");
  submit();
  check("failure: plan becomes Sync failed", await waitFor(() => /Sync failed/.test(badgeText(0))));
  check("failure: the plan data is still on the device", cards()[0].querySelector(".plan-title").textContent === "Solar oven build");
  check("failure: a 'Retry sync' button is offered", /Retry sync/.test(cards()[0].querySelector("button").textContent));
  check("failure: reason is shown in text", /Last problem/.test(cards()[0].textContent));
  check("failure: clearing the device is blocked", (() => { $("clear-device").click(); return /not synced/.test($("message").textContent) && JSON.parse(w.localStorage.getItem("stemmate.plans.v1")).length === 2; })());
  cards()[0].querySelector("button").click();
  check("recovery: after Retry the plan becomes Synced", await waitFor(() => /Synced/.test(badgeText(0))));
  check("recovery: server now has 2 plans", await waitFor(() => app.repo.list().length === 2));

  // 4. offline
  $("demo-offline").checked = true; $("demo-offline").dispatchEvent(new w.Event("change"));
  check("offline: banner says Offline", /Offline/.test($("connection").textContent));
  fill("title", "Offline plan"); fill("duration", "20"); fill("steps", "Do it"); fill("safety", "Be careful.");
  submit();
  check("offline: plan is saved on the device and NOT sent", /Saved on this device/.test(badgeText(0)) && app.repo.list().length === 2);
  check("offline: message explains it will sync later", /sync when you are back online/.test($("message").textContent));
  check("offline: plan is in localStorage (survives reload)", JSON.parse(w.localStorage.getItem("stemmate.plans.v1")).length === 3);
  $("demo-offline").checked = false; $("demo-offline").dispatchEvent(new w.Event("change"));
  check("back online: waiting plan syncs by itself", await waitFor(() => /Synced/.test(badgeText(0)) && app.repo.list().length === 3));

  // 5. privacy validation in the UI
  fill("title", "Plan for sam@example.com"); fill("duration", "20"); fill("steps", "x"); fill("safety", "Be careful.");
  submit();
  check("privacy: email in title is rejected with a message", !$("title-error").hidden && /personal details/.test($("title-error").textContent));

  // 6. clearing when everything is synced
  $("title").value = ""; submit();
  $("clear-device").click();
  check("shared device: when all plans are synced the device can be cleared", await waitFor(() => cards().length === 0));

  // 7. XSS: a script in a title is shown as text, not run
  fill("title", "<img src=x onerror=window.__hacked=1>"); fill("duration", "20"); fill("steps", "x"); fill("safety", "Be careful.");
  submit(); await sleep(300);
  check("security: HTML in a title is shown as plain text and not executed", w.__hacked === undefined && d.querySelectorAll("#plan-list img").length === 0);

  console.log(results.join("\n"));
  console.log("\n" + results.filter((r) => r.startsWith("PASS")).length + " passed, " + results.filter((r) => r.startsWith("FAIL")).length + " failed");
  w.close(); app.server.closeAllConnections(); app.server.close(); setTimeout(() => process.exit(process.exitCode || 0), 100);
})();
