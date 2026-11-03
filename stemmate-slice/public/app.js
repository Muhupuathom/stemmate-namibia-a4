// app.js - connects the page to the logic in core.js.
// Plans are kept in the browser (localStorage) so they survive going offline,
// closing the page and restarting the device. They are sent to the server when
// a connection is available.
(function () {
  "use strict";

  var Core = window.StemCore;
  // Some browsers block storage (private mode, strict settings). We test it first, and if it
  // is blocked we keep data in memory only and WARN the user, instead of crashing.
  var storageWorks = true;
  var memoryData = {};
  var storage = (function () {
    try {
      var real = window.localStorage;
      real.setItem("stemmate.check", "1");
      real.removeItem("stemmate.check");
      return real;
    } catch (err) {
      storageWorks = false;
      return {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(memoryData, k) ? memoryData[k] : null; },
        setItem: function (k, v) { memoryData[k] = String(v); },
        removeItem: function (k) { delete memoryData[k]; }
      };
    }
  })();

  // If the page was opened by double-clicking the file (no web server), use a simulated server.
  var LOCAL_MODE = window.location.protocol === "file:";
  var localServer = LOCAL_MODE ? window.StemLocalServer.createLocalServer(storage) : null;
  var PLANS_KEY = "stemmate.plans.v1";
  var ACTIVITIES_KEY = "stemmate.activities.v1";

  // All sentences the page shows are here, so they are easy to translate later.
  var TEXT = {
    online: "Online \u2013 plans sync automatically.",
    offline: "Offline \u2013 plans are saved on this device and will sync later.",
    savedOnline: "Plan saved on this device. Syncing now\u2026",
    savedOffline: "Plan saved on this device. It will sync when you are back online.",
    storageFull: "Problem: this device could not save the plan (storage may be full). The plan was NOT saved. Free some space and try again.",
    syncNothing: "Nothing to sync. All plans are up to date.",
    syncOffline: "You are offline. Plans will sync automatically when you are back online.",
    syncBlockedByDemo: "Nothing was sent: the demo switch \u201CPretend there is no connection\u201D is ON. Untick it in Demo controls, then try again.",
    emptyServerList: "No plans have reached the server yet.",
    serverOffline: "The server list cannot be shown while offline.",
    serverUnreachable: "Problem: could not reach the server.",
    clearConfirm: "Remove all saved plans from this device? They are already synced to the server.",
    cleared: "Saved plans were removed from this device.",
    noStorage: "Problem: this browser is blocking storage, so plans will be LOST when you close this page. Try Chrome or Edge, or turn off private browsing."
  };

  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; } // textContent, never innerHTML
    return node;
  }

  // ---------- storage ----------

  function loadList(key) {
    try {
      var raw = storage.getItem(key);
      var data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data : [];
    } catch (err) {
      return [];
    }
  }

  function saveList(key, list) {
    try {
      storage.setItem(key, JSON.stringify(list));
      return true;
    } catch (err) {
      return false; // storage full or blocked - the caller must tell the user
    }
  }

  var plans = Core.recoverInterrupted(loadList(PLANS_KEY));
  saveList(PLANS_KEY, plans);
  var activities = loadList(ACTIVITIES_KEY);
  var syncing = false;

  // ---------- messages and connection ----------

  function say(text, isProblem) {
    var box = $("message");
    box.textContent = (isProblem && text.indexOf("Problem") !== 0 ? "Problem: " : "") + text;
    box.hidden = false;
  }

  function isOnline() {
    return navigator.onLine !== false && !$("demo-offline").checked;
  }

  function updateConnection() {
    var text = isOnline() ? TEXT.online : TEXT.offline;
    if ($("demo-offline").checked) { text += " (demo switch is ON)"; }
    $("connection").textContent = text;
  }

  // ---------- showing plans ----------

  function activityName(id) {
    for (var i = 0; i < activities.length; i++) {
      if (activities[i].id === id) { return activities[i].name; }
    }
    return "";
  }

  function renderPlans() {
    var list = $("plan-list");
    list.textContent = "";
    $("empty-state").hidden = plans.length > 0;
    $("sync-all").hidden = plans.length === 0;

    plans.forEach(function (plan) {
      var li = el("li", "plan-card");
      li.appendChild(el("h3", "plan-title", plan.title));

      var label = Core.statusLabel(plan.status);
      var badge = el("p", "badge badge-" + plan.status);
      var icon = el("span", "", label.icon);
      icon.setAttribute("aria-hidden", "true");
      badge.appendChild(icon);
      badge.appendChild(el("span", "", label.text));
      li.appendChild(badge);

      var parts = [];
      var name = activityName(plan.activityId);
      if (name) { parts.push(name); }
      parts.push(plan.durationMinutes + " minutes");
      parts.push(plan.steps.length + (plan.steps.length === 1 ? " step" : " steps"));
      li.appendChild(el("p", "plan-meta", parts.join(" \u00B7 ")));

      if (plan.status === "failed" && plan.lastError) {
        li.appendChild(el("p", "plan-error", "Last problem: " + plan.lastError + " The plan is still safe on this device."));
      }

      if (Core.needsSync(plan)) {
        var buttonText = plan.status === "failed" ? "Retry sync" : "Sync now";
        var button = el("button", "btn", buttonText);
        button.type = "button";
        button.setAttribute("aria-label", buttonText + ": " + plan.title);
        button.addEventListener("click", function () { syncFromButton(plan.id); });
        li.appendChild(button);
      }
      list.appendChild(li);
    });

    var counts = Core.countByStatus(plans);
    $("plans-summary").textContent = plans.length === 0 ? "" :
      plans.length + " plan(s): " + counts.synced + " synced, " + counts.draft + " waiting to sync, " +
      counts.pending + " syncing, " + counts.failed + " failed.";
  }

  function showServerPlans(serverPlans) {
    var note = $("server-note");
    var list = $("server-list");
    list.textContent = "";
    note.textContent = serverPlans.length === 0 ? TEXT.emptyServerList :
      serverPlans.length + " plan(s) stored on the " + (LOCAL_MODE ? "simulated " : "") + "server.";
    serverPlans.forEach(function (plan) {
      list.appendChild(el("li", "", plan.title + " \u2013 received " + new Date(plan.receivedAt).toLocaleString()));
    });
  }

  async function refreshServerList() {
    var note = $("server-note");
    $("server-list").textContent = "";
    if (!isOnline()) {
      note.textContent = TEXT.serverOffline;
      return;
    }
    if (LOCAL_MODE) {
      showServerPlans(localServer.list());
      return;
    }
    try {
      var response = await fetch("/api/plans");
      if (!response.ok) { throw new Error("bad response"); }
      var data = await response.json();
      showServerPlans(data.plans);
    } catch (err) {
      note.textContent = TEXT.serverUnreachable;
    }
  }

  // ---------- syncing ----------

  // The real network call. It turns every kind of failure into a plain message.
  async function sendToServer(payload) {
    if ($("demo-fail").checked) {
      $("demo-fail").checked = false; // fail once only
      throw new Error("Demo: a failure was simulated.");
    }
    if (LOCAL_MODE) {
      return localServer.save(payload);
    }
    var response;
    try {
      response = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      throw new Error("Could not reach the server. Check that it is running.");
    }
    if (!response.ok) {
      throw new Error("The server could not save this plan (code " + response.status + ").");
    }
    return response.json();
  }

  function setPlan(updated) {
    for (var i = 0; i < plans.length; i++) {
      if (plans[i].id === updated.id) { plans[i] = updated; }
    }
    if (!saveList(PLANS_KEY, plans)) {
      say(TEXT.storageFull, true);
    }
  }

  function findPlan(id) {
    for (var i = 0; i < plans.length; i++) {
      if (plans[i].id === id) { return plans[i]; }
    }
    return null;
  }

  async function syncOne(id) {
    var plan = findPlan(id);
    if (!plan || !Core.needsSync(plan)) { return null; }
    if (!isOnline()) {
      say($("demo-offline").checked ? TEXT.syncBlockedByDemo : TEXT.syncOffline, true);
      return null;
    }
    setPlan(Core.markPending(plan));
    renderPlans();
    var result = await Core.syncPlan(plan, sendToServer);
    setPlan(result);
    renderPlans();
    if (result.status === "synced") { refreshServerList(); }
    return result;
  }

  async function syncFromButton(id) {
    var result = await syncOne(id);
    if (!result) { return; }
    if (result.status === "synced") {
      say("\u201C" + result.title + "\u201D synced.");
    } else {
      say("\u201C" + result.title + "\u201D could not sync: " + result.lastError + " It is still saved on this device.", true);
    }
  }

  async function syncAll(quiet) {
    if (syncing) { return; }
    var todo = plans.filter(Core.needsSync);
    if (todo.length === 0) {
      if (!quiet) { say(TEXT.syncNothing); }
      return;
    }
    if (!isOnline()) {
      if (!quiet) { say(TEXT.syncOffline); }
      return;
    }
    syncing = true;
    var ok = 0;
    var bad = 0;
    for (var i = 0; i < todo.length; i++) {
      var result = await syncOne(todo[i].id);
      if (result && result.status === "synced") { ok += 1; }
      else if (result) { bad += 1; }
    }
    syncing = false;
    say("Sync finished: " + ok + " synced, " + bad + " failed.", bad > 0);
  }

  // ---------- the form ----------

  var FIELD_IDS = {
    title: "title", activityId: "activity", durationMinutes: "duration",
    steps: "steps", materials: "materials", safetyNote: "safety"
  };
  var FIELD_NAMES = {
    title: "Plan title", activityId: "Linked activity", durationMinutes: "Duration",
    steps: "Steps", materials: "Materials", safetyNote: "Safety note"
  };

  function showErrors(errors) {
    var summary = $("error-summary");
    var list = $("error-list");
    var firstField = null;
    list.textContent = "";

    Object.keys(FIELD_IDS).forEach(function (key) {
      var fieldId = FIELD_IDS[key];
      var input = $(fieldId);
      var messageBox = $(fieldId + "-error");
      var message = errors[key];
      if (message) {
        messageBox.textContent = "Error: " + message;
        messageBox.hidden = false;
        input.setAttribute("aria-invalid", "true");
        var item = el("li");
        var link = el("a", "", FIELD_NAMES[key] + ": " + message);
        link.href = "#" + fieldId;
        link.addEventListener("click", function (event) {
          event.preventDefault();
          input.focus();
        });
        item.appendChild(link);
        list.appendChild(item);
        if (!firstField) { firstField = input; }
      } else {
        messageBox.textContent = "";
        messageBox.hidden = true;
        input.removeAttribute("aria-invalid");
      }
    });

    if (firstField) {
      summary.hidden = false;
      summary.focus();
    } else {
      summary.hidden = true;
    }
  }

  $("plan-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var input = {
      title: $("title").value,
      activityId: $("activity").value,
      durationMinutes: $("duration").value,
      steps: Core.parseLines($("steps").value),
      materials: Core.parseList($("materials").value),
      safetyNote: $("safety").value
    };
    var check = Core.validatePlan(input);
    showErrors(check.errors);
    if (!check.ok) { return; }

    var plan = Core.buildPlan(input);
    plans.unshift(plan);
    if (!saveList(PLANS_KEY, plans)) {
      plans.shift();
      say(TEXT.storageFull, true);
      return;
    }
    $("plan-form").reset();
    renderPlans();
    if (isOnline()) {
      say(TEXT.savedOnline);
      syncOne(plan.id);
    } else {
      say(TEXT.savedOffline);
    }
  });

  // Choosing an activity pre-fills empty duration and materials boxes.
  $("activity").addEventListener("change", function () {
    var id = $("activity").value;
    for (var i = 0; i < activities.length; i++) {
      if (activities[i].id === id) {
        if (!$("duration").value) { $("duration").value = activities[i].durationMinutes; }
        if (!$("materials").value) { $("materials").value = activities[i].materials.join(", "); }
      }
    }
  });

  function fillActivityList() {
    var select = $("activity");
    while (select.options.length > 1) { select.remove(1); }
    activities.forEach(function (activity) {
      var option = el("option", "", activity.name + " (" + activity.level + ")");
      option.value = activity.id;
      select.appendChild(option);
    });
  }

  async function loadActivities() {
    if (LOCAL_MODE) {
      activities = window.STEMMATE_ACTIVITIES.activities;
      saveList(ACTIVITIES_KEY, activities);
    } else if (isOnline()) {
      try {
        var response = await fetch("/api/activities");
        if (response.ok) {
          var data = await response.json();
          activities = data.activities;
          saveList(ACTIVITIES_KEY, activities);
        }
      } catch (err) {
        // offline or server down: keep the saved copy
      }
    }
    fillActivityList();
    renderPlans();
  }

  // ---------- buttons and events ----------

  $("sync-all").addEventListener("click", function () { syncAll(false); });
  $("refresh-server").addEventListener("click", refreshServerList);

  $("clear-device").addEventListener("click", function () {
    var check = Core.canClearDevice(plans);
    if (!check.ok) {
      say(check.unsynced + " plan(s) have not synced yet. Sync them first so nothing is lost.", true);
      return;
    }
    if (window.confirm(TEXT.clearConfirm)) {
      plans = [];
      saveList(PLANS_KEY, plans);
      renderPlans();
      say(TEXT.cleared);
    }
  });

  function connectionChanged() {
    updateConnection();
    if (isOnline()) {
      say("You are back online. Syncing waiting plans\u2026");
      loadActivities();
      syncAll(true);
      refreshServerList();
    } else {
      refreshServerList();
    }
  }

  window.addEventListener("online", connectionChanged);
  window.addEventListener("offline", connectionChanged);
  $("demo-offline").addEventListener("change", connectionChanged);

  // Try again every minute while online (this is the "will retry" promise).
  setInterval(function () { if (isOnline()) { syncAll(true); } }, 60000);

  // ---------- start-up ----------

  if (LOCAL_MODE) { $("mode-note").hidden = false; }
  if (!storageWorks) { say(TEXT.noStorage, true); }
  updateConnection();
  fillActivityList();
  renderPlans();
  loadActivities();
  refreshServerList();
  if (isOnline()) { syncAll(true); }

  // The service worker keeps the page itself available when offline.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function () {
      // Not available (for example on plain http over a network). The app still works while the page is open.
    });
  }
})();
