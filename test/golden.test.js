import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Q, InputError } from "../src/core/rational.js";
import { calculatePositionSize } from "../src/core/sizing.js";
import { calculateLossRoom, sizeWithGuard } from "../src/core/guard.js";

const casesUrl = new URL("./golden/cases.json", import.meta.url);

// Turn a result into plain data: Q becomes its "num/den" string, null stays null.
function plain(value) {
  if (value instanceof Q) return value.toFraction();
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [key, inner] of Object.entries(value)) out[key] = plain(inner);
    return out;
  }
  return value;
}

function compare(id, expected, actual, path) {
  for (const key of Object.keys(expected)) {
    const where = path ? `${path}.${key}` : key;
    assert.ok(
      actual !== null && typeof actual === "object" && key in actual,
      `case "${id}": result has no field "${where}"`
    );
    const want = expected[key];
    const got = actual[key];
    if (want !== null && typeof want === "object" && !Array.isArray(want)) {
      compare(id, want, got, where);
    } else {
      assert.deepStrictEqual(
        got,
        want,
        `case "${id}": field "${where}" expected ${JSON.stringify(want)} but got ${JSON.stringify(got)}`
      );
    }
  }
}

// The keys in `expected` must equal the keys in the actual result, both ways.
function sameKeys(id, expected, actual, path) {
  const want = Object.keys(expected).sort();
  const got = Object.keys(actual).sort();
  const missing = got.filter((k) => !want.includes(k));
  const extra = want.filter((k) => !got.includes(k));
  assert.ok(
    missing.length === 0 && extra.length === 0,
    `case "${id}": ${path || "expected"} keys differ. ` +
      `Missing from expected: [${missing.join(", ")}]. Not in result: [${extra.join(", ")}].`
  );
}

function runCase(c) {
  if (c.kind === "error") {
    const fn = c.call === "room" ? calculateLossRoom : calculatePositionSize;
    assert.ok(c.call === "room" || c.call === "size", `case "${c.id}": unknown call "${c.call}"`);
    let thrown = null;
    try {
      fn(c.input);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown instanceof InputError, `case "${c.id}": expected an InputError, got ${thrown}`);
    assert.deepStrictEqual(
      { field: thrown.field, code: thrown.code },
      { field: c.expected.error.field, code: c.expected.error.code },
      `case "${c.id}": wrong error`
    );
    return;
  }
  let actual;
  if (c.kind === "size") {
    actual = plain(calculatePositionSize(c.input));
  } else if (c.kind === "room") {
    actual = plain(calculateLossRoom(c.input));
  } else if (c.kind === "guarded") {
    actual = plain(sizeWithGuard(c.input.sizing, c.input.guard));
  } else {
    assert.fail(`case "${c.id}": unknown kind "${c.kind}"`);
  }
  if (c.kind === "guarded") {
    sameKeys(c.id, c.expected, actual, "expected");
    sameKeys(c.id, c.expected.room, actual.room, "expected.room");
    sameKeys(c.id, c.expected.size, actual.size, "expected.size");
  } else {
    sameKeys(c.id, c.expected, actual, "expected");
  }
  compare(c.id, c.expected, actual, "");
}

let data = null;
let loadProblem = null;
try {
  data = JSON.parse(readFileSync(casesUrl, "utf8"));
  if (!data || !Array.isArray(data.cases) || data.cases.length === 0) {
    loadProblem = "test/golden/cases.json has no cases. Expected { \"cases\": [ ... ] }.";
  }
} catch (e) {
  loadProblem =
    e && e.code === "ENOENT"
      ? "test/golden/cases.json is missing. The golden cases have not been written yet."
      : `test/golden/cases.json could not be read: ${e && e.message}`;
}

if (loadProblem !== null) {
  test("golden cases file is present and valid", () => {
    assert.fail(loadProblem);
  });
} else {
  const ids = new Set();
  test("golden cases have unique ids", () => {
    for (const c of data.cases) {
      assert.ok(typeof c.id === "string" && c.id !== "", "every case needs an id");
      assert.ok(!ids.has(c.id), `duplicate case id "${c.id}"`);
      ids.add(c.id);
    }
  });
  for (const c of data.cases) {
    test(`golden: ${c.id}`, () => runCase(c));
  }
}
