// localserver.js - a stand-in for the real server, used ONLY when the page is opened
// by double-clicking index.html (no Node needed). It follows the same rules as
// server.js: validate the plan, then save it by id (so sending twice never duplicates).
// Its data lives in the browser's localStorage, so it survives closing the browser.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./core.js"));
  } else {
    root.StemLocalServer = factory(root.StemCore);
  }
})(typeof self !== "undefined" ? self : this, function (Core) {
  "use strict";

  function createLocalServer(storage, key) {
    key = key || "stemmate.fakeserver.v1";

    function readAll() {
      try {
        var raw = storage.getItem(key);
        var data = raw ? JSON.parse(raw) : [];
        return Array.isArray(data) ? data : [];
      } catch (err) {
        return [];
      }
    }

    return {
      // Throws an Error (like a failed request would) if the plan is not accepted.
      save: function (payload) {
        var check = Core.validatePlan(payload, { requireId: true });
        if (!check.ok) {
          throw new Error("The server could not save this plan (code 400).");
        }
        var stored = Object.assign(Core.toServerPayload(payload), { receivedAt: new Date().toISOString() });
        var list = readAll();
        var created = true;
        var found = -1;
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === stored.id) { found = i; }
        }
        if (found >= 0) { list[found] = stored; created = false; } else { list.push(stored); }
        try {
          storage.setItem(key, JSON.stringify(list));
        } catch (err) {
          throw new Error("The simulated server has no space left.");
        }
        return { plan: stored, created: created };
      },

      list: function () {
        return readAll().sort(function (a, b) {
          return String(b.receivedAt).localeCompare(String(a.receivedAt));
        });
      }
    };
  }

  return { createLocalServer: createLocalServer };
});
