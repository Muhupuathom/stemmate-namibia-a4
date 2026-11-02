"use strict";
// planRepository.js - the ONLY place that reads and writes the server's plan data.
// Plans are kept in one JSON file so the slice needs no database to install.
// Everything else in the server asks this module for data (list, get, save).

const fs = require("node:fs");
const path = require("node:path");

function createPlanRepository(filePath) {
  function readAll() {
    let text;
    try {
      text = fs.readFileSync(filePath, "utf8");
    } catch (err) {
      if (err.code === "ENOENT") {
        return []; // no file yet = no plans yet
      }
      throw err;
    }
    try {
      const data = JSON.parse(text);
      if (!Array.isArray(data)) {
        throw new Error("not a list");
      }
      return data;
    } catch (err) {
      throw new Error("The plan data file is damaged: " + filePath);
    }
  }

  function writeAll(plans) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // Write to a temporary file first, then swap it in.
    // If the power goes off mid-write, the old file is still complete.
    const tempPath = filePath + ".tmp";
    fs.writeFileSync(tempPath, JSON.stringify(plans, null, 2));
    fs.renameSync(tempPath, filePath);
  }

  return {
    list() {
      return readAll();
    },

    get(id) {
      return readAll().find(function (plan) { return plan.id === id; }) || null;
    },

    // Saves a plan. If a plan with the same id exists it is replaced,
    // so sending the same plan twice never creates a duplicate.
    save(plan) {
      const plans = readAll();
      const index = plans.findIndex(function (p) { return p.id === plan.id; });
      let created = true;
      if (index >= 0) {
        plans[index] = plan;
        created = false;
      } else {
        plans.push(plan);
      }
      writeAll(plans);
      return { plan: plan, created: created };
    }
  };
}

module.exports = { createPlanRepository };
