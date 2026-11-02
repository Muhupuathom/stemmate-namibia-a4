"use strict";
// server.js - a small web server with no outside libraries.
//   * serves the web page from /public
//   * GET  /api/activities  -> synthetic sample activities
//   * GET  /api/plans       -> plans that have reached the server
//   * POST /api/plans       -> receive one plan (validate, then save)

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("./public/core.js");
const { createPlanRepository } = require("./src/planRepository.js");

const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY_BYTES = 100 * 1024; // a plan is a few KB; 100 KB is generous

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'"
};

function createApp(options) {
  options = options || {};
  const plansFile = options.plansFile || path.join(__dirname, "data", "plans.json");
  const activitiesFile = options.activitiesFile || path.join(__dirname, "data", "activities.json");
  const repo = createPlanRepository(plansFile);

  // "failNext" lets the tests (and a demo) make the next N saves fail on purpose.
  const state = { failNext: 0 };

  function sendJson(res, status, body) {
    res.writeHead(
      status,
      Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, SECURITY_HEADERS)
    );
    res.end(JSON.stringify(body));
  }

  function sendText(res, status, text) {
    res.writeHead(status, Object.assign({ "Content-Type": "text/plain; charset=utf-8" }, SECURITY_HEADERS));
    res.end(text);
  }

  // Reads the request body. If it is too big we keep reading (and throw it away)
  // so we can still send a proper "413 too large" answer at the end.
  function readBody(req) {
    return new Promise(function (resolve, reject) {
      let size = 0;
      let tooBig = false;
      const chunks = [];
      req.on("data", function (chunk) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          tooBig = true;
        } else {
          chunks.push(chunk);
        }
      });
      req.on("end", function () {
        if (tooBig) {
          reject(Object.assign(new Error("Body too large"), { status: 413 }));
        } else {
          resolve(Buffer.concat(chunks).toString("utf8"));
        }
      });
      req.on("error", reject);
    });
  }

  async function handlePostPlan(req, res) {
    // Demo/test switch: pretend the server is having a problem.
    if (state.failNext > 0) {
      state.failNext -= 1;
      return sendJson(res, 503, { error: "Service temporarily unavailable. Please try again." });
    }

    let raw;
    try {
      raw = await readBody(req);
    } catch (err) {
      if (err.status === 413) {
        return sendJson(res, 413, { error: "The plan is too large." });
      }
      return sendJson(res, 400, { error: "Could not read the request." });
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch (err) {
      return sendJson(res, 400, { error: "The request was not valid JSON." });
    }

    // The server checks everything again. It never trusts the browser.
    const check = Core.validatePlan(body, { requireId: true });
    if (!check.ok) {
      return sendJson(res, 400, { error: "Validation failed.", errors: check.errors });
    }

    const stored = Object.assign(Core.toServerPayload(body), { receivedAt: new Date().toISOString() });
    const result = repo.save(stored);
    return sendJson(res, result.created ? 201 : 200, { plan: result.plan });
  }

  async function handleApi(req, res, url) {
    const route = req.method + " " + url.pathname;
    if (route === "GET /api/health") {
      return sendJson(res, 200, { ok: true });
    }
    if (route === "GET /api/activities") {
      return sendJson(res, 200, JSON.parse(fs.readFileSync(activitiesFile, "utf8")));
    }
    if (route === "GET /api/plans") {
      const plans = repo.list().sort(function (a, b) {
        return String(b.receivedAt).localeCompare(String(a.receivedAt));
      });
      return sendJson(res, 200, { plans: plans });
    }
    if (route === "POST /api/plans") {
      return handlePostPlan(req, res);
    }
    return sendJson(res, 404, { error: "Not found." });
  }

  function serveStatic(req, res, url) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      return res.end();
    }
    let relative;
    try {
      relative = decodeURIComponent(url.pathname);
    } catch (err) {
      return sendText(res, 400, "Bad request");
    }
    if (relative.indexOf("\0") !== -1) {
      return sendText(res, 400, "Bad request");
    }
    if (relative === "/") {
      relative = "/index.html";
    }
    const filePath = path.join(PUBLIC_DIR, relative);
    // Stop "../" tricks that try to read files outside /public.
    if (filePath.indexOf(PUBLIC_DIR + path.sep) !== 0) {
      return sendText(res, 403, "Forbidden");
    }
    fs.readFile(filePath, function (err, data) {
      if (err) {
        return sendText(res, 404, "Not found");
      }
      const type = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
      res.writeHead(200, Object.assign({ "Content-Type": type, "Cache-Control": "no-cache" }, SECURITY_HEADERS));
      res.end(req.method === "HEAD" ? undefined : data);
    });
  }

  async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.indexOf("/api/") === 0) {
      return handleApi(req, res, url);
    }
    return serveStatic(req, res, url);
  }

  const server = http.createServer(function (req, res) {
    handle(req, res).catch(function (err) {
      console.error(err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Something went wrong on the server." });
      } else {
        res.end();
      }
    });
  });

  return { server: server, state: state, repo: repo };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || "127.0.0.1";
  const app = createApp();
  app.server.listen(port, host, function () {
    console.log("STEMMate slice is running at http://" + host + ":" + port);
    console.log("Press Ctrl+C to stop.");
  });
}

module.exports = { createApp: createApp };
