import { test } from "node:test";
import assert from "node:assert/strict";
import { Q, parseDecimal, InputError } from "../src/core/rational.js";

function codeOf(text) {
  try {
    parseDecimal(text, "f");
  } catch (e) {
    assert.ok(e instanceof InputError);
    assert.equal(e.field, "f");
    return e.code;
  }
  return null;
}

test("parseDecimal accepts valid text", () => {
  const table = [
    ["0", "0/1"],
    ["12", "12/1"],
    ["0.1", "1/10"],
    ["-3.5", "-7/2"],
    [" 12.5 ", "25/2"],
    [".5", "1/2"],
    ["5.", "5/1"],
    ["-0", "0/1"],
    ["-.25", "-1/4"],
    ["007", "7/1"],
    ["1.08500", "217/200"],
    ["\t42\n", "42/1"],
  ];
  for (const [text, fraction] of table) {
    assert.equal(parseDecimal(text, "f").toFraction(), fraction, JSON.stringify(text));
  }
});

test("parseDecimal rejects invalid text with the right code", () => {
  const table = [
    ["", "empty"],
    ["   ", "empty"],
    ["1,5", "comma"],
    ["10,000", "comma"],
    ["1,000.50", "comma"],
    ["1e5", "format"],
    ["abc", "format"],
    ["1.2.3", "format"],
    ["+1", "format"],
    ["Infinity", "format"],
    ["NaN", "format"],
    ["1 2", "format"],
    ["--1", "format"],
    [".", "format"],
    ["-", "format"],
    ["1".repeat(41), "format"],
    ["0.".padEnd(41, "1"), "format"],
  ];
  for (const [text, code] of table) {
    assert.equal(codeOf(text), code, JSON.stringify(text));
  }
});

test("parseDecimal accepts exactly 40 characters", () => {
  assert.equal(codeOf("1".repeat(40)), null);
});

test("parseDecimal rejects non-strings and keeps the field", () => {
  for (const bad of [5, null, undefined, {}, 1n]) {
    assert.throws(
      () => parseDecimal(bad, "x.y"),
      (e) => e instanceof InputError && e.field === "x.y" && e.code === "format"
    );
  }
});

test("InputError carries field, code and a message", () => {
  const e = new InputError("Short sentence.", "a.b", "range");
  assert.equal(e.field, "a.b");
  assert.equal(e.code, "range");
  assert.equal(e.message, "Short sentence.");
  assert.ok(e instanceof Error);
});

test("arithmetic is exact: 0.1 + 0.2 equals 0.3", () => {
  const sum = Q.of("0.1").add("0.2");
  assert.ok(sum.eq("0.3"));
  assert.equal(sum.toFraction(), "3/10");
});

test("add, sub, mul, div, neg, abs", () => {
  const a = Q.of("1.5");
  assert.equal(a.add(Q.of("2.5")).toFraction(), "4/1");
  assert.equal(a.sub("2").toFraction(), "-1/2");
  assert.equal(a.mul("4").toFraction(), "6/1");
  assert.equal(a.div("3").toFraction(), "1/2");
  assert.equal(a.neg().toFraction(), "-3/2");
  assert.equal(a.neg().abs().toFraction(), "3/2");
  assert.equal(Q.of("1").div("3").mul("3").toFraction(), "1/1");
  assert.throws(() => a.div(Q.ZERO), RangeError);
  assert.throws(() => a.div("0"), RangeError);
});

test("Q.of accepts Q, bigint, safe integers and strings", () => {
  const q = Q.of("2.5");
  assert.equal(Q.of(q), q);
  assert.equal(Q.of(7n).toFraction(), "7/1");
  assert.equal(Q.of(-3).toFraction(), "-3/1");
  assert.equal(Q.of("0.25").toFraction(), "1/4");
  assert.throws(() => Q.of(1.5), TypeError);
  assert.throws(() => Q.of(Number.MAX_SAFE_INTEGER + 2), TypeError);
  assert.throws(() => Q.of(NaN), TypeError);
  assert.throws(() => Q.of(null), TypeError);
  assert.throws(() => Q.of({}), TypeError);
  assert.throws(() => Q.of("abc"), InputError);
});

test("constants", () => {
  assert.equal(Q.ZERO.toFraction(), "0/1");
  assert.equal(Q.ONE.toFraction(), "1/1");
  assert.equal(Q.HUNDRED.toFraction(), "100/1");
});

test("values are always reduced with a positive denominator", () => {
  assert.equal(new Q(46n, 100n).toFraction(), "23/50");
  assert.equal(new Q(5n, 1n).toFraction(), "5/1");
  assert.equal(new Q(1n, -2n).toFraction(), "-1/2");
  assert.equal(new Q(0n, 7n).toFraction(), "0/1");
  assert.throws(() => new Q(1n, 0n), RangeError);
});

test("comparisons and sign checks", () => {
  const a = Q.of("1.1");
  const b = Q.of("1.10");
  assert.equal(a.cmp(b), 0);
  assert.equal(a.cmp("2"), -1);
  assert.equal(a.cmp("1"), 1);
  assert.ok(a.eq(b) && a.lte(b) && a.gte(b));
  assert.ok(a.lt("1.2") && a.gt("1.0"));
  assert.ok(!a.lt(b) && !a.gt(b));
  assert.ok(Q.ZERO.isZero());
  assert.ok(Q.of("-1").isNegative());
  assert.ok(Q.of("1").isPositive());
  assert.ok(!Q.ZERO.isPositive() && !Q.ZERO.isNegative());
});

test("Q.min and Q.max", () => {
  assert.equal(Q.min(Q.of("3"), "1.5", 2n).toFraction(), "3/2");
  assert.equal(Q.max(Q.of("3"), "1.5", 2n).toFraction(), "3/1");
  assert.equal(Q.min("5").toFraction(), "5/1");
  assert.throws(() => Q.min(), RangeError);
  assert.throws(() => Q.max(), RangeError);
});

test("floorToStep is exact", () => {
  assert.equal(Q.of("0.3").floorToStep("0.1").toFraction(), "3/10");
  assert.ok(Q.of("0.3").floorToStep("0.1").eq("0.3"));
  assert.equal(Q.of("0.29999").floorToStep("0.01").toFraction(), "29/100");
  assert.equal(Q.of("0.009").floorToStep("0.01").toFraction(), "0/1");
  assert.equal(Q.of("0.01").floorToStep("0.01").toFraction(), "1/100");
  assert.equal(Q.of("7").floorToStep("2").toFraction(), "6/1");
  assert.equal(Q.of("0").floorToStep("0.01").toFraction(), "0/1");
  assert.equal(Q.of("1").floorToStep("0.3").toFraction(), "9/10");
});

test("floorToStep rejects bad input", () => {
  assert.throws(() => Q.of("-0.1").floorToStep("0.01"), RangeError);
  assert.throws(() => Q.of("1").floorToStep("0"), RangeError);
  assert.throws(() => Q.of("1").floorToStep("-0.1"), RangeError);
});

test("toFraction is in lowest terms", () => {
  assert.equal(Q.of("0.46").toFraction(), "23/50");
  assert.equal(Q.of("5").toFraction(), "5/1");
  assert.equal(Q.of("-0.5").toFraction(), "-1/2");
  assert.equal(Q.of("0").toFraction(), "0/1");
});

test("toFixed down", () => {
  assert.equal(Q.of("1.239").toFixed(2, "down"), "1.23");
  assert.equal(Q.of("1.231").toFixed(2, "down"), "1.23");
  assert.equal(Q.of("-1.231").toFixed(2, "down"), "-1.24");
  assert.equal(Q.of("2").toFixed(2, "down"), "2.00");
  assert.equal(Q.of("0.5").toFixed(0, "down"), "0");
  assert.equal(Q.of("-0.5").toFixed(0, "down"), "-1");
  assert.equal(Q.of("1.9").toFixed(0, "down"), "1");
  assert.equal(Q.of("0.05").toFixed(3, "down"), "0.050");
  assert.equal(Q.of("1").div("3").toFixed(4, "down"), "0.3333");
});

test("toFixed up", () => {
  assert.equal(Q.of("1.231").toFixed(2, "up"), "1.24");
  assert.equal(Q.of("1.23").toFixed(2, "up"), "1.23");
  assert.equal(Q.of("-1.239").toFixed(2, "up"), "-1.23");
  assert.equal(Q.of("0.5").toFixed(0, "up"), "1");
  assert.equal(Q.of("-0.5").toFixed(0, "up"), "0");
  assert.equal(Q.of("1").div("3").toFixed(4, "up"), "0.3334");
  assert.equal(Q.of("1000000").toFixed(2, "up"), "1000000.00");
});

test("toFixed never prints -0", () => {
  assert.equal(Q.of("-0.001").toFixed(2, "up"), "0.00");
  assert.equal(Q.of("-0.4").toFixed(0, "up"), "0");
  assert.equal(Q.of("0").toFixed(2, "down"), "0.00");
  assert.equal(Q.of("-0").toFixed(1, "up"), "0.0");
  assert.equal(Q.of("-0.001").toFixed(2, "down"), "-0.01");
});

test("toFixed keeps small values and large dp exact", () => {
  assert.equal(Q.of("0.000001").toFixed(6, "down"), "0.000001");
  assert.equal(Q.of("0.0000001").toFixed(6, "down"), "0.000000");
  assert.equal(Q.of("0.0000001").toFixed(6, "up"), "0.000001");
  assert.equal(Q.of("1").toFixed(20, "down"), "1.00000000000000000000");
});

test("toFixed validates its arguments", () => {
  assert.throws(() => Q.of("1").toFixed(2), RangeError);
  assert.throws(() => Q.of("1").toFixed(2, "nearest"), RangeError);
  assert.throws(() => Q.of("1").toFixed(-1, "down"), RangeError);
  assert.throws(() => Q.of("1").toFixed(21, "down"), RangeError);
  assert.throws(() => Q.of("1").toFixed(1.5, "down"), RangeError);
});

test("decimalPlaces", () => {
  assert.equal(Q.of("5").decimalPlaces(), 0);
  assert.equal(Q.of("0.01").decimalPlaces(), 2);
  assert.equal(Q.of("0.5").decimalPlaces(), 1);
  assert.equal(Q.of("1.2500").decimalPlaces(), 2);
  assert.equal(Q.of("0.0001").decimalPlaces(), 4);
  assert.equal(new Q(1n, 8n).decimalPlaces(), 3);
  assert.equal(new Q(1n, 3n).decimalPlaces(), null);
  assert.equal(new Q(1n, 6n).decimalPlaces(), null);
  assert.equal(Q.of("-0.25").decimalPlaces(), 2);
  assert.equal(Q.ZERO.decimalPlaces(), 0);
});

test("Q is immutable", () => {
  const q = Q.of("1.5");
  assert.ok(Object.isFrozen(q));
  q.add("1");
  assert.equal(q.toFraction(), "3/2");
});

test("parseDecimal trims only space, tab, line feed and carriage return", () => {
  for (const ok of [" 1", "1 ", "\t1\n", "\r\n 1.5 \r\n"]) {
    assert.equal(codeOf(ok), null, JSON.stringify(ok));
  }
  for (const bad of ["\uFEFF1", "1\uFEFF", "\u00A01", "1\u00A0", "\u20281", "1\u2003", "\u200B1", "\v1", "1\f"]) {
    assert.equal(codeOf(bad), "format", JSON.stringify(bad));
  }
  // whitespace-only is empty only when it is made of the four trimmed characters
  assert.equal(codeOf(" \t\r\n"), "empty");
  assert.equal(codeOf("\u00A0"), "format");
});
