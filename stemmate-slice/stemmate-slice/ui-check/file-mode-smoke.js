// OPTIONAL UI check of the double-click ("file") mode. One-off install:  npm install --no-save jsdom
// Run with:  node ui-check/file-mode-smoke.js
// jsdom is NOT a real browser. It cannot test keyboard use, screen readers or real localStorage rules.
const { JSDOM } = require("jsdom");
const root = require("path").join(__dirname, "..", "public") + require("path").sep;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 4000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(25); } return false; }
const out = []; const check = (n, c) => { out.push((c ? "PASS  " : "FAIL  ") + n); if (!c) process.exitCode = 1; };

function makeStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _map: m }; }
async function open(storage) {
  return JSDOM.fromFile(root + "index.html", { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
    beforeParse(w) { w.confirm = () => true; if (storage) Object.defineProperty(w, "localStorage", { value: storage, configurable: true }); } });
}
function helpers(w) {
  const d = w.document, $ = (id) => d.getElementById(id);
  return { d, $, fill: (id, v) => { $(id).value = v; }, submit: () => $("plan-form").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true })),
    cards: () => [...d.querySelectorAll("#plan-list .plan-card")], badge: (i) => d.querySelectorAll("#plan-list .plan-card")[i].querySelector(".badge").textContent };
}

(async () => {
  // A) storage BLOCKED (jsdom blocks localStorage on file://): app must not crash, must warn
  let dom = await open(null); let w = dom.window; let h = helpers(w);
  check("A: opened as a file", w.location.protocol === "file:");
  check("A: page still starts when storage is blocked (activity list filled)", await waitFor(() => h.$("activity").options.length > 5));
  check("A: user is warned that plans will be lost", await waitFor(() => /LOST/.test(h.$("message").textContent)));
  h.fill("title", "Plan while blocked"); h.fill("duration", "30"); h.fill("steps", "One"); h.fill("safety", "Be careful."); h.submit();
  check("A: the workflow still works for this session (Synced)", await waitFor(() => /Synced/.test(h.badge(0))));
  w.close();

  // B) storage works: full workflow, then a "reload" with the same storage
  const storage = makeStorage();
  dom = await open(storage); w = dom.window; h = helpers(w);
  check("B: simple-mode note is shown", await waitFor(() => !h.$("mode-note").hidden));
  check("B: no storage warning when storage works", h.$("message").hidden);
  h.submit();
  check("B: empty form shows the error summary", !h.$("error-summary").hidden);
  h.fill("title", "Offline demo plan"); h.fill("duration", "30"); h.fill("steps", "Step one\nStep two"); h.fill("safety", "Adults handle scissors."); h.submit();
  check("B: valid plan syncs to the simulated server -> Synced", await waitFor(() => /Synced/.test(h.badge(0))));
  check("B: simulated server list shows the plan and says 'simulated'", await waitFor(() => /Offline demo plan/.test(h.$("server-list").textContent)) && /simulated/.test(h.$("server-note").textContent));
  h.$("demo-fail").checked = true;
  h.fill("title", "Failing plan"); h.fill("duration", "20"); h.fill("steps", "x"); h.fill("safety", "Be careful."); h.submit();
  check("B: failure -> Sync failed + Retry button", await waitFor(() => /Sync failed/.test(h.badge(0)) && /Retry sync/.test(h.cards()[0].textContent)));
  h.cards()[0].querySelector("button").click();
  check("B: Retry -> Synced (recovery)", await waitFor(() => /Synced/.test(h.badge(0))));
  h.$("demo-offline").checked = true; h.$("demo-offline").dispatchEvent(new w.Event("change"));
  h.fill("title", "Plan made offline"); h.fill("duration", "20"); h.fill("steps", "x"); h.fill("safety", "Be careful."); h.submit();
  check("B: offline -> plan waits on the device", /Saved on this device/.test(h.badge(0)));
  w.close();

  // C) close the page and open it again with the same storage = plans must still be there, offline plan still waiting
  dom = await open(storage); w = dom.window; h = helpers(w);
  check("C: after closing and reopening, all 3 plans are still on the device", await waitFor(() => h.cards().length === 3));
  check("C: the plan made offline is picked up and synced on the next start", await waitFor(() => h.cards().every((c) => /Synced/.test(c.textContent)) , 5000));
  check("C: simulated server holds 3 plans", JSON.parse(storage.getItem("stemmate.fakeserver.v1")).length === 3);
  w.close();

  console.log(out.join("\n"));
  console.log("\n" + out.filter((r) => r.startsWith("PASS")).length + " passed, " + out.filter((r) => r.startsWith("FAIL")).length + " failed");
  setTimeout(() => process.exit(process.exitCode || 0), 100);
})();
