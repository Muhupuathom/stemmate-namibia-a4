// core.js - the business logic of the STEMMate slice.
// The SAME file runs in the browser (as window.StemCore) and in Node (require),
// so the rules are identical on both sides and can be tested without a browser.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.StemCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // The four states of a plan. These match the sync states in the A3 prototype.
  var STATUS = { DRAFT: "draft", PENDING: "pending", SYNCED: "synced", FAILED: "failed" };

  // Each state has an icon AND a text label, so state is never shown by colour alone (QR-03).
  var STATUS_LABELS = {
    draft: { icon: "\u270E", text: "Saved on this device" },
    pending: { icon: "\u27F3", text: "Syncing\u2026" },
    synced: { icon: "\u2713", text: "Synced" },
    failed: { icon: "\u26A0", text: "Sync failed \u2013 will retry" }
  };

  var PRIVACY_MESSAGE = "Remove phone numbers and email addresses. Plans must not contain personal details.";

  // ---------- small helpers ----------

  function trimText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  // One item per line (used for the steps box).
  function parseLines(text) {
    return String(text || "").split(/\r?\n/).map(trimText).filter(Boolean);
  }

  // Items split by commas or new lines (used for the materials box).
  function parseList(text) {
    return String(text || "").split(/[,\r\n]+/).map(trimText).filter(Boolean);
  }

  // Looks for email addresses and long numbers (phone numbers). QR-02 / PR-01.
  // It cannot detect a person's NAME - that is a known limit, see README.
  function containsContactDetails(text) {
    var email = /[^\s@]+@[^\s@]+\.[^\s@]+/;
    var longNumber = /(\+?\d[\s-]?){7,}/;
    return email.test(text) || longNumber.test(text);
  }

  function makeId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return "plan-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  // ---------- validation (FR-04, QR-02) ----------

  // Returns { ok: true/false, errors: { fieldName: "message" } }.
  function validatePlan(input, options) {
    options = options || {};
    var plan = input && typeof input === "object" ? input : {};
    var errors = {};

    var title = trimText(plan.title);
    if (title.length < 3 || title.length > 80) {
      errors.title = "Enter a title between 3 and 80 characters.";
    } else if (containsContactDetails(title)) {
      errors.title = PRIVACY_MESSAGE;
    }

    var duration = Number(plan.durationMinutes);
    if (!Number.isInteger(duration) || duration < 5 || duration > 240) {
      errors.durationMinutes = "Enter a whole number of minutes from 5 to 240.";
    }

    var steps = Array.isArray(plan.steps) ? plan.steps.map(trimText).filter(Boolean) : [];
    if (steps.length < 1 || steps.length > 20) {
      errors.steps = "Add between 1 and 20 steps, one step per line.";
    } else if (steps.some(function (s) { return s.length > 200; })) {
      errors.steps = "Each step must be 200 characters or fewer.";
    } else if (steps.some(containsContactDetails)) {
      errors.steps = PRIVACY_MESSAGE;
    }

    var safety = trimText(plan.safetyNote);
    if (safety.length < 3 || safety.length > 300) {
      errors.safetyNote = "Enter a safety note between 3 and 300 characters.";
    } else if (containsContactDetails(safety)) {
      errors.safetyNote = PRIVACY_MESSAGE;
    }

    if (plan.materials !== undefined) {
      var materials = Array.isArray(plan.materials) ? plan.materials.map(trimText).filter(Boolean) : null;
      if (materials === null || materials.length > 30 || materials.some(function (m) { return m.length > 60; })) {
        errors.materials = "List up to 30 materials, each 60 characters or fewer.";
      } else if (materials.some(containsContactDetails)) {
        errors.materials = PRIVACY_MESSAGE;
      }
    }

    if (plan.activityId !== undefined && plan.activityId !== "") {
      if (typeof plan.activityId !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(plan.activityId)) {
        errors.activityId = "Choose an activity from the list.";
      }
    }

    if (options.requireId || plan.id !== undefined) {
      if (typeof plan.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(plan.id)) {
        errors.id = "The plan needs a valid id.";
      }
    }

    return { ok: Object.keys(errors).length === 0, errors: errors };
  }

  // ---------- creating and syncing plans (FR-04, FR-05, QR-01) ----------

  // Turns validated form input into a new plan. New plans always start as "draft".
  function buildPlan(input, options) {
    options = options || {};
    var now = options.now || new Date().toISOString();
    return {
      id: options.id || makeId(),
      title: trimText(input.title),
      activityId: input.activityId || "",
      durationMinutes: Number(input.durationMinutes),
      steps: input.steps.map(trimText).filter(Boolean),
      materials: (input.materials || []).map(trimText).filter(Boolean),
      safetyNote: trimText(input.safetyNote),
      status: STATUS.DRAFT,
      version: 1,
      createdAt: now,
      updatedAt: now,
      lastError: null
    };
  }

  // Only the fields the server needs are sent. Status and error text stay on the device.
  // This is data minimisation (QR-02).
  function toServerPayload(plan) {
    return {
      id: plan.id,
      title: trimText(plan.title),
      activityId: plan.activityId || "",
      durationMinutes: Number(plan.durationMinutes),
      steps: (plan.steps || []).map(trimText).filter(Boolean),
      materials: (plan.materials || []).map(trimText).filter(Boolean),
      safetyNote: trimText(plan.safetyNote),
      version: plan.version || 1,
      createdAt: plan.createdAt
    };
  }

  function markPending(plan) {
    return Object.assign({}, plan, { status: STATUS.PENDING, lastError: null });
  }

  // Tries to send one plan. It never throws: the result is always a plan
  // that is either "synced" or "failed" (with a message), so nothing is lost.
  // "send" is a function that does the real network call (or a fake one in tests).
  async function syncPlan(plan, send, options) {
    var now = (options && options.now) || new Date().toISOString();
    var pending = markPending(plan);
    try {
      await send(toServerPayload(plan));
      return Object.assign({}, pending, { status: STATUS.SYNCED, syncedAt: now, lastError: null });
    } catch (err) {
      var message = err && err.message ? err.message : "Unknown problem.";
      return Object.assign({}, pending, { status: STATUS.FAILED, lastError: message });
    }
  }

  // If the page was closed in the middle of a sync, a plan can be stuck on "pending".
  // On start-up we put those back to "draft" so they are retried.
  function recoverInterrupted(plans) {
    return plans.map(function (plan) {
      return plan.status === STATUS.PENDING ? Object.assign({}, plan, { status: STATUS.DRAFT }) : plan;
    });
  }

  function needsSync(plan) {
    return plan.status === STATUS.DRAFT || plan.status === STATUS.FAILED;
  }

  // Shared-device safety: do not allow clearing the device while plans are unsynced.
  function canClearDevice(plans) {
    var unsynced = plans.filter(function (p) { return p.status !== STATUS.SYNCED; }).length;
    return { ok: unsynced === 0, unsynced: unsynced };
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || { icon: "?", text: "Unknown" };
  }

  function countByStatus(plans) {
    var counts = { draft: 0, pending: 0, synced: 0, failed: 0 };
    plans.forEach(function (p) {
      if (counts[p.status] !== undefined) {
        counts[p.status] += 1;
      }
    });
    return counts;
  }

  return {
    STATUS: STATUS,
    parseLines: parseLines,
    parseList: parseList,
    containsContactDetails: containsContactDetails,
    validatePlan: validatePlan,
    buildPlan: buildPlan,
    toServerPayload: toServerPayload,
    markPending: markPending,
    syncPlan: syncPlan,
    recoverInterrupted: recoverInterrupted,
    needsSync: needsSync,
    canClearDevice: canClearDevice,
    statusLabel: statusLabel,
    countByStatus: countByStatus
  };
});
