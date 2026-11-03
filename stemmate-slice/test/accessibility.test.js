"use strict";
// Automated accessibility checks. These catch common mistakes early.
// They do NOT replace manual keyboard and screen-reader testing (see README).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

// --- WCAG contrast calculation ---
function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function contrast(hexA, hexB) {
  const a = luminance(hexA);
  const b = luminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
function colours() {
  const map = {};
  const pattern = /--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g;
  let m;
  while ((m = pattern.exec(css)) !== null) { map[m[1]] = m[2]; }
  return map;
}

test("QR-03: text colours meet WCAG AA contrast (4.5:1) on the backgrounds they are used on", function () {
  const c = colours();
  const pairs = [
    ["text", "bg"], ["text", "surface"], ["muted", "surface"], ["muted", "bg"],
    ["primary-text", "primary"], ["error", "surface"], ["error", "bg"],
    ["draft-text", "draft-bg"], ["pending-text", "pending-bg"],
    ["synced-text", "synced-bg"], ["failed-text", "failed-bg"],
    ["failed-text", "surface"]
  ];
  pairs.forEach(function (pair) {
    assert.ok(c[pair[0]] && c[pair[1]], "missing colour variable for " + pair.join("/"));
    const ratio = contrast(c[pair[0]], c[pair[1]]);
    assert.ok(ratio >= 4.5, pair.join(" on ") + " is only " + ratio.toFixed(2) + ":1");
  });
});

test("QR-03: borders and the focus outline meet the 3:1 contrast needed for interface parts", function () {
  const c = colours();
  [["border", "surface"], ["focus", "surface"], ["focus", "bg"]].forEach(function (pair) {
    const ratio = contrast(c[pair[0]], c[pair[1]]);
    assert.ok(ratio >= 3, pair.join(" on ") + " is only " + ratio.toFixed(2) + ":1");
  });
});

test("QR-03: every form field in the page has a label that points at it", function () {
  const fieldIds = [];
  const fieldPattern = /<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g;
  let m;
  while ((m = fieldPattern.exec(html)) !== null) { fieldIds.push(m[1]); }
  assert.ok(fieldIds.length >= 6);
  fieldIds.forEach(function (id) {
    const hasLabel = new RegExp('<label[^>]*\\bfor="' + id + '"').test(html) ||
      new RegExp('<label[^>]*>[^<]*<input[^>]*\\bid="' + id + '"').test(html);
    assert.ok(hasLabel, "field '" + id + "' has no label");
  });
});

test("QR-03: the page declares its language, has one h1, a skip link and a main landmark", function () {
  assert.ok(/<html[^>]*\blang="en"/.test(html));
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.ok(/class="skip-link"[^>]*href="#main"|href="#main"[^>]*class="skip-link"/.test(html));
  assert.ok(/<main\b[^>]*id="main"/.test(html));
});

test("QR-03: the page allows zooming (no maximum-scale or user-scalable=no)", function () {
  assert.ok(!/maximum-scale|user-scalable\s*=\s*no/i.test(html));
});

test("QR-03: a visible keyboard focus style is defined and buttons are at least 44px tall", function () {
  assert.ok(/:focus-visible\s*\{[^}]*outline:\s*3px/.test(css));
  assert.ok(/\.btn\s*\{[^}]*min-height:\s*2\.75rem/.test(css)); // 2.75rem = 44px at default size
});
