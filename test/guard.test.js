import { test } from "node:test";
import assert from "node:assert/strict";
import { Q, InputError } from "../src/core/rational.js";
import { calculatePositionSize } from "../src/core/sizing.js";
import { calculateLossRoom, sizeWithGuard } from "../src/core/guard.js";

const DAILY = { limitPercent: "5", percentOf: "10000", dayStartValue: "10000" }; // floor 9500
const STATIC = { type: "static", limitPercent: "10", initialBalance: "10000" }; // floor 9000
const TRAILING = {
  type: "trailing",
  limitPercent: "10",
  percentOf: "10000",
  highWaterMark: "10400",
  floorCap: null,
}; // floor 9400

function guardInput(over = {}) {
  return { currentEquity: "9800", daily: null, total: null, openRisk: "0", buffer: "0", ...over };
}

function fr(q) {
  return q === null ? null : q.toFraction();
}

function expectError(fn, field, code) {
  assert.throws(fn, (e) => {
    assert.ok(e instanceof InputError, "expected an InputError, got " + e);
    assert.equal(e.field, field);
    assert.equal(e.code, code);
    assert.ok(e.message.length > 0);
    return true;
  });
}

test("daily rule only", () => {
  const r = calculateLossRoom(guardInput({ daily: DAILY }));
  assert.equal(fr(r.dailyFloor), "9500/1");
  assert.equal(fr(r.dailyRoom), "300/1");
  assert.equal(r.totalFloor, null);
  assert.equal(r.totalRoom, null);
  assert.equal(fr(r.room), "300/1");
  assert.equal(r.bindingLimit, "daily");
  assert.equal(fr(r.openRisk), "0/1");
  assert.equal(fr(r.buffer), "0/1");
  assert.equal(fr(r.roomForNewTrade), "300/1");
  assert.equal(r.breached, false);
  assert.equal(r.status, "ok");
});

test("static total rule only", () => {
  const r = calculateLossRoom(guardInput({ total: STATIC }));
  assert.equal(r.dailyFloor, null);
  assert.equal(r.dailyRoom, null);
  assert.equal(fr(r.totalFloor), "9000/1");
  assert.equal(fr(r.totalRoom), "800/1");
  assert.equal(fr(r.room), "800/1");
  assert.equal(r.bindingLimit, "total");
  assert.equal(r.status, "ok");
});

test("trailing total rule without floorCap", () => {
  const r = calculateLossRoom(guardInput({ total: TRAILING }));
  assert.equal(fr(r.totalFloor), "9400/1");
  assert.equal(fr(r.totalRoom), "400/1");
  assert.equal(r.bindingLimit, "total");
});

test("trailing total rule with floorCap below the trailing floor lowers the floor", () => {
  const r = calculateLossRoom(guardInput({ total: { ...TRAILING, floorCap: "9300" } }));
  assert.equal(fr(r.totalFloor), "9300/1");
  assert.equal(fr(r.totalRoom), "500/1");
});

test("trailing total rule with floorCap above the trailing floor changes nothing", () => {
  const r = calculateLossRoom(guardInput({ total: { ...TRAILING, floorCap: "10000" } }));
  assert.equal(fr(r.totalFloor), "9400/1");
  assert.equal(fr(r.totalRoom), "400/1");
});

test("trailing floor follows the high-water mark", () => {
  const r = calculateLossRoom(
    guardInput({ currentEquity: "10300", total: { ...TRAILING, highWaterMark: "10400" } })
  );
  assert.equal(fr(r.totalFloor), "9400/1");
  assert.equal(fr(r.totalRoom), "900/1");
});

test("both rules: the smaller room binds", () => {
  const r = calculateLossRoom(guardInput({ daily: DAILY, total: STATIC }));
  assert.equal(fr(r.dailyRoom), "300/1");
  assert.equal(fr(r.totalRoom), "800/1");
  assert.equal(fr(r.room), "300/1");
  assert.equal(r.bindingLimit, "daily");

  const t = calculateLossRoom(
    guardInput({
      daily: { limitPercent: "10", percentOf: "10000", dayStartValue: "10000" },
      total: { type: "static", limitPercent: "5", initialBalance: "10000" },
    })
  );
  assert.equal(fr(t.dailyRoom), "800/1");
  assert.equal(fr(t.totalRoom), "300/1");
  assert.equal(fr(t.room), "300/1");
  assert.equal(t.bindingLimit, "total");
});

test("tie between daily and total goes to daily", () => {
  const r = calculateLossRoom(
    guardInput({ daily: DAILY, total: { type: "static", limitPercent: "5", initialBalance: "10000" } })
  );
  assert.equal(fr(r.dailyRoom), fr(r.totalRoom));
  assert.equal(r.bindingLimit, "daily");
});

test("open risk and buffer reduce the room for a new trade", () => {
  const r = calculateLossRoom(guardInput({ daily: DAILY, openRisk: "100", buffer: "50" }));
  assert.equal(fr(r.room), "300/1");
  assert.equal(fr(r.openRisk), "100/1");
  assert.equal(fr(r.buffer), "50/1");
  assert.equal(fr(r.roomForNewTrade), "150/1");
  assert.equal(r.status, "ok");
});

test("optional openRisk and buffer default to zero", () => {
  const input = guardInput({ daily: DAILY });
  delete input.openRisk;
  delete input.buffer;
  const r = calculateLossRoom(input);
  assert.equal(fr(r.roomForNewTrade), "300/1");
});

test("status no-room when room for a new trade is zero", () => {
  const r = calculateLossRoom(guardInput({ daily: DAILY, openRisk: "200", buffer: "100" }));
  assert.equal(fr(r.roomForNewTrade), "0/1");
  assert.equal(r.breached, false);
  assert.equal(r.status, "no-room");
});

test("status no-room when room for a new trade is negative", () => {
  const r = calculateLossRoom(guardInput({ daily: DAILY, openRisk: "250", buffer: "100" }));
  assert.equal(fr(r.roomForNewTrade), "-50/1");
  assert.equal(r.status, "no-room");
});

test("status breached when equity equals the floor", () => {
  const r = calculateLossRoom(guardInput({ currentEquity: "9500", daily: DAILY }));
  assert.equal(r.breached, true);
  assert.equal(r.status, "breached");
  assert.equal(fr(r.room), "0/1");
});

test("status breached when equity is below a floor", () => {
  const r = calculateLossRoom(guardInput({ currentEquity: "9400", daily: DAILY }));
  assert.equal(r.breached, true);
  assert.equal(r.status, "breached");
  assert.equal(fr(r.room), "-100/1");
});

test("breached by the total rule even when the daily rule has room", () => {
  const r = calculateLossRoom(
    guardInput({
      currentEquity: "9000",
      daily: { limitPercent: "50", percentOf: "10000", dayStartValue: "10000" },
      total: STATIC,
    })
  );
  assert.equal(r.breached, true);
  assert.equal(r.status, "breached");
  assert.equal(r.bindingLimit, "total");
});

test("one cent above the floor is not breached", () => {
  const r = calculateLossRoom(guardInput({ currentEquity: "9500.01", daily: DAILY }));
  assert.equal(r.breached, false);
  assert.equal(r.status, "ok");
  assert.equal(fr(r.room), "1/100");
});

test("accepts Q-free decimal strings with spaces", () => {
  const r = calculateLossRoom(guardInput({ currentEquity: " 9800 ", daily: DAILY }));
  assert.equal(fr(r.room), "300/1");
});

test("all numeric result fields are Q or null", () => {
  const r = calculateLossRoom(guardInput({ daily: DAILY }));
  for (const key of [
    "dailyFloor",
    "dailyRoom",
    "room",
    "openRisk",
    "buffer",
    "roomForNewTrade",
  ]) {
    assert.ok(r[key] instanceof Q, key);
  }
  assert.equal(r.totalFloor, null);
});

// Errors
const errorCases = [
  ["no rule", () => guardInput(), null, "no-rule"],
  ["no rule, explicit nulls", () => guardInput({ daily: null, total: null }), null, "no-rule"],
  ["no input", () => null, null, "empty"],
  ["equity zero", () => guardInput({ currentEquity: "0", daily: DAILY }), "currentEquity", "range"],
  ["equity empty", () => guardInput({ currentEquity: "", daily: DAILY }), "currentEquity", "empty"],
  ["equity comma", () => guardInput({ currentEquity: "9,800", daily: DAILY }), "currentEquity", "comma"],
  ["equity format", () => guardInput({ currentEquity: "x", daily: DAILY }), "currentEquity", "format"],
  ["openRisk negative", () => guardInput({ daily: DAILY, openRisk: "-1" }), "openRisk", "range"],
  ["openRisk format", () => guardInput({ daily: DAILY, openRisk: "a" }), "openRisk", "format"],
  ["buffer negative", () => guardInput({ daily: DAILY, buffer: "-1" }), "buffer", "range"],
  ["daily limit zero", () => guardInput({ daily: { ...DAILY, limitPercent: "0" } }), "daily.limitPercent", "range"],
  ["daily limit above 100", () => guardInput({ daily: { ...DAILY, limitPercent: "100.1" } }), "daily.limitPercent", "range"],
  ["daily limit format", () => guardInput({ daily: { ...DAILY, limitPercent: "five" } }), "daily.limitPercent", "format"],
  ["daily percentOf zero", () => guardInput({ daily: { ...DAILY, percentOf: "0" } }), "daily.percentOf", "range"],
  ["daily dayStartValue zero", () => guardInput({ daily: { ...DAILY, dayStartValue: "0" } }), "daily.dayStartValue", "range"],
  ["daily dayStartValue missing", () => guardInput({ daily: { limitPercent: "5", percentOf: "10000" } }), "daily.dayStartValue", "empty"],
  ["total type unknown", () => guardInput({ total: { ...STATIC, type: "rolling" } }), "total.type", "format"],
  ["total type missing", () => guardInput({ total: { limitPercent: "10", initialBalance: "10000" } }), "total.type", "format"],
  ["total limit zero", () => guardInput({ total: { ...STATIC, limitPercent: "0" } }), "total.limitPercent", "range"],
  ["total limit above 100", () => guardInput({ total: { ...STATIC, limitPercent: "101" } }), "total.limitPercent", "range"],
  ["static initialBalance zero", () => guardInput({ total: { ...STATIC, initialBalance: "0" } }), "total.initialBalance", "range"],
  ["trailing percentOf zero", () => guardInput({ total: { ...TRAILING, percentOf: "0" } }), "total.percentOf", "range"],
  ["trailing highWaterMark zero", () => guardInput({ total: { ...TRAILING, highWaterMark: "0" } }), "total.highWaterMark", "range"],
  ["trailing floorCap zero", () => guardInput({ total: { ...TRAILING, floorCap: "0" } }), "total.floorCap", "range"],
  ["trailing floorCap negative", () => guardInput({ total: { ...TRAILING, floorCap: "-5" } }), "total.floorCap", "range"],
];

for (const [name, make, field, code] of errorCases) {
  test(`error: ${name}`, () => {
    expectError(() => calculateLossRoom(make()), field, code);
  });
}

// sizeWithGuard
function sizingInput(over = {}) {
  return {
    accountCurrency: "USD",
    balance: "10000",
    risk: { mode: "percent", value: "5" }, // asks for 500
    instrument: {
      symbol: "EURUSD",
      quoteCurrency: "USD",
      contractSize: "100000",
      pipSize: "0.0001",
      minLot: "0.01",
      lotStep: "0.01",
      maxLot: null,
    },
    trade: { entry: "1.08500", stop: "1.08300", extraDistance: "0" },
    conversion: null,
    commissionPerLot: "0",
    leverage: null,
    budgetCap: null,
    ...over,
  };
}

test("sizeWithGuard limits the size by the daily room", () => {
  const { room, size } = sizeWithGuard(sizingInput(), guardInput({ daily: DAILY }));
  assert.equal(fr(room.roomForNewTrade), "300/1");
  assert.equal(size.status, "ok");
  assert.equal(fr(size.riskAmount), "500/1");
  assert.equal(fr(size.riskBudget), "300/1");
  assert.equal(size.limitedBy, "daily");
  assert.equal(fr(size.lots), "3/2");
  assert.ok(size.actualRisk.lte(room.roomForNewTrade));
});

test("sizeWithGuard limits the size by the total room", () => {
  const { room, size } = sizeWithGuard(
    sizingInput(),
    guardInput({
      daily: { limitPercent: "10", percentOf: "10000", dayStartValue: "10000" },
      total: { type: "static", limitPercent: "5", initialBalance: "10000" },
    })
  );
  assert.equal(room.bindingLimit, "total");
  assert.equal(size.limitedBy, "total");
  assert.equal(fr(size.riskBudget), "300/1");
});

test("sizeWithGuard uses room after open risk and buffer", () => {
  const { room, size } = sizeWithGuard(
    sizingInput(),
    guardInput({ daily: DAILY, openRisk: "100", buffer: "50" })
  );
  assert.equal(fr(room.roomForNewTrade), "150/1");
  assert.equal(fr(size.riskBudget), "150/1");
  assert.equal(fr(size.lots), "3/4");
});

test("sizeWithGuard when the room is larger than the risk does not limit", () => {
  const { size } = sizeWithGuard(
    sizingInput({ risk: { mode: "percent", value: "1" } }),
    guardInput({ daily: DAILY })
  );
  assert.equal(size.limitedBy, "risk");
  assert.equal(fr(size.riskBudget), "100/1");
  assert.equal(fr(size.lots), "1/2");
});

test("sizeWithGuard ignores a budgetCap on the sizing input", () => {
  const input = sizingInput({ budgetCap: { amount: "1", reason: "total" } });
  const { size } = sizeWithGuard(input, guardInput({ daily: DAILY }));
  assert.equal(fr(size.riskBudget), "300/1");
  assert.equal(size.limitedBy, "daily");
  // and does not change the caller's object
  assert.deepEqual(input.budgetCap, { amount: "1", reason: "total" });
});

test("sizeWithGuard with no room gives no-budget", () => {
  const { room, size } = sizeWithGuard(
    sizingInput(),
    guardInput({ daily: DAILY, openRisk: "300" })
  );
  assert.equal(room.status, "no-room");
  assert.equal(size.status, "no-budget");
  assert.equal(size.limitedBy, "daily");
  assert.ok(size.lots.isZero());
});

test("sizeWithGuard when breached gives no-budget", () => {
  const { room, size } = sizeWithGuard(
    sizingInput(),
    guardInput({ currentEquity: "9400", daily: DAILY })
  );
  assert.equal(room.status, "breached");
  assert.equal(size.status, "no-budget");
  assert.ok(size.lots.isZero());
  assert.ok(size.riskBudget.isNegative());
});

test("sizeWithGuard matches calculatePositionSize with the same cap", () => {
  const guard = guardInput({ daily: DAILY, openRisk: "40" });
  const { room, size } = sizeWithGuard(sizingInput(), guard);
  const direct = calculatePositionSize(
    sizingInput({ budgetCap: { amount: room.roomForNewTrade, reason: room.bindingLimit } })
  );
  assert.equal(fr(size.lots), fr(direct.lots));
  assert.equal(fr(size.actualRisk), fr(direct.actualRisk));
});

test("sizeWithGuard passes guard and sizing errors through", () => {
  expectError(() => sizeWithGuard(sizingInput(), guardInput()), null, "no-rule");
  expectError(
    () => sizeWithGuard(sizingInput({ balance: "0" }), guardInput({ daily: DAILY })),
    "balance",
    "range"
  );
});

test("a 100 percent limit is accepted, just above is rejected", () => {
  const d = calculateLossRoom(guardInput({ daily: { ...DAILY, limitPercent: "100" } }));
  assert.equal(fr(d.dailyFloor), "0/1");
  assert.equal(fr(d.dailyRoom), "9800/1");
  const t = calculateLossRoom(guardInput({ total: { ...STATIC, limitPercent: "100" } }));
  assert.equal(fr(t.totalFloor), "0/1");
  const tr = calculateLossRoom(guardInput({ total: { ...TRAILING, limitPercent: "100" } }));
  assert.equal(fr(tr.totalFloor), "400/1");
  expectError(() => calculateLossRoom(guardInput({ daily: { ...DAILY, limitPercent: "100.01" } })), "daily.limitPercent", "range");
  expectError(() => calculateLossRoom(guardInput({ total: { ...STATIC, limitPercent: "100.01" } })), "total.limitPercent", "range");
});

test("daily floor: percent of percentOf, taken from dayStartValue", () => {
  const r = calculateLossRoom(
    guardInput({
      currentEquity: "96000",
      daily: { limitPercent: "5", percentOf: "100000", dayStartValue: "98000" },
    })
  );
  assert.equal(fr(r.dailyFloor), "93000/1");
  assert.equal(fr(r.dailyRoom), "3000/1");
});

test("trailing floor uses percentOf, not the high-water mark", () => {
  const r = calculateLossRoom(
    guardInput({
      currentEquity: "96000",
      total: { type: "trailing", limitPercent: "5", percentOf: "100000", highWaterMark: "98000", floorCap: null },
    })
  );
  assert.equal(fr(r.totalFloor), "93000/1");
});

test("notes is always present and last", () => {
  const r = calculateLossRoom(guardInput({ daily: DAILY }));
  assert.deepEqual(r.notes, []);
  assert.equal(Object.keys(r).at(-1), "notes");
  assert.deepEqual(calculateLossRoom(guardInput({ total: STATIC })).notes, []);
});

test("equity-above-high-water-mark only for trailing and only when above", () => {
  const trail = (equity, hwm) =>
    calculateLossRoom(guardInput({ currentEquity: equity, total: { ...TRAILING, highWaterMark: hwm } }));
  assert.deepEqual(trail("10400.01", "10400").notes, ["equity-above-high-water-mark"]);
  assert.deepEqual(trail("10400", "10400").notes, []);
  assert.deepEqual(trail("10399.99", "10400").notes, []);
  // static rule with high equity: no note
  assert.deepEqual(calculateLossRoom(guardInput({ currentEquity: "99999", total: STATIC })).notes, []);
  // daily-only: no note
  assert.deepEqual(calculateLossRoom(guardInput({ currentEquity: "99999", daily: DAILY })).notes, []);
  // still a normal result, not an error
  assert.equal(trail("11000", "10400").status, "ok");
});

test("sizeWithGuard room carries notes; guarded size can end on the floor", () => {
  const { room, size } = sizeWithGuard(
    sizingInput(),
    guardInput({ currentEquity: "10500", total: { ...TRAILING, highWaterMark: "10400" } })
  );
  assert.deepEqual(room.notes, ["equity-above-high-water-mark"]);
  assert.ok(size.notes !== room.notes);
  // room 300 -> 1.5 lots uses it all
  const g = sizeWithGuard(sizingInput(), guardInput({ daily: DAILY }));
  assert.equal(fr(g.size.actualRisk), "300/1");
  assert.ok(g.size.notes.includes("loss-equals-room"));
  assert.deepEqual(g.room.notes, []);
});
