import { test } from "node:test";
import assert from "node:assert/strict";
import { Q } from "../src/core/rational.js";
import { calculatePositionSize } from "../src/core/sizing.js";

// A small seeded integer LCG (64 bit, BigInt state). Fully deterministic.
function makeRng(seed) {
  let state = BigInt(seed) & 0xffffffffffffffffn;
  const mask = 0xffffffffffffffffn;
  function next() {
    state = (state * 6364136223846793005n + 1442695040888963407n) & mask;
    return state >> 11n; // 53 usable bits
  }
  return {
    // integer in [lo, hi] inclusive
    int(lo, hi) {
      const span = BigInt(hi - lo + 1);
      return lo + Number(next() % span);
    },
    pick(list) {
      return list[this.int(0, list.length - 1)];
    },
    chance(percent) {
      return this.int(0, 99) < percent;
    },
  };
}

const TICK_DIGITS = 5; // prices are whole numbers of 0.00001

function ticksToText(ticks) {
  return Q.of(BigInt(ticks)).div(10n ** BigInt(TICK_DIGITS)).toFixed(TICK_DIGITS, "down");
}

const CONTRACT_SIZES = ["1", "10", "100", "1000", "100000"];
// [pipSize text, pip size in ticks]
const PIPS = [
  ["0.00001", 1],
  ["0.0001", 10],
  ["0.01", 1000],
  ["0.1", 10000],
  ["1", 100000],
];
const STEPS = ["0.001", "0.01", "0.05", "0.1", "0.25", "1"];

function makeCase(rng, allowInstrument = true) {
  const accountCurrency = rng.pick(["USD", "EUR", "GBP", "JPY"]);
  const ownPair = allowInstrument && rng.chance(25);
  const needsConversion = !ownPair && rng.chance(40);
  const quoteCurrency = ownPair
    ? rng.pick(["USD", "EUR", "GBP", "JPY", "CHF"].filter((c) => c !== accountCurrency))
    : needsConversion
    ? rng.pick(["USD", "EUR", "GBP", "JPY", "CHF"].filter((c) => c !== accountCurrency))
    : accountCurrency;

  const balanceCents = rng.int(10000, 500000000); // 100.00 .. 5,000,000.00
  const balance = Q.of(BigInt(balanceCents)).div(100n).toFixed(2, "down");

  let risk;
  if (rng.chance(70)) {
    const hundredths = rng.int(1, 1000); // 0.01% .. 10%
    risk = { mode: "percent", value: Q.of(BigInt(hundredths)).div(100n).toFixed(2, "down") };
  } else {
    const cents = rng.int(100, balanceCents);
    risk = { mode: "amount", value: Q.of(BigInt(cents)).div(100n).toFixed(2, "down") };
  }

  const lotStep = rng.pick(STEPS);
  const minMultiple = rng.int(1, 5);
  const minLotQ = Q.of(lotStep).mul(BigInt(minMultiple));
  const minLot = minLotQ.toFixed(minLotQ.decimalPlaces(), "down");
  let maxLot = null;
  if (rng.chance(35)) {
    const m = rng.int(1, 300);
    const maxQ = minLotQ.mul(BigInt(m)).add(Q.of(lotStep).div(3n)); // not always a step multiple
    maxLot = maxQ.toFixed(6, "down");
  }
  const [pipSize, pipTicks] = rng.pick(PIPS);

  const entryTicks = rng.int(50000, 200000000);
  const distanceTicks = rng.int(1, 3000) * pipTicks;
  let direction = rng.chance(50) ? "long" : "short";
  if (direction === "long" && entryTicks - distanceTicks <= 0) direction = "short";
  const stopTicks = direction === "long" ? entryTicks - distanceTicks : entryTicks + distanceTicks;

  let extraTicks = rng.chance(40) ? rng.int(1, 50) * pipTicks : 0;
  if (ownPair && direction === "long" && stopTicks - extraTicks <= 0) extraTicks = 0;

  const omitBase = ownPair && rng.chance(50); // rely on the symbol instead
  const input = {
    accountCurrency,
    balance,
    risk,
    instrument: {
      symbol: omitBase ? `${accountCurrency}${quoteCurrency}`.toLowerCase() + ".m" : "TEST",
      baseCurrency: ownPair && !omitBase ? accountCurrency : null,
      quoteCurrency,
      contractSize: rng.pick(CONTRACT_SIZES),
      pipSize,
      minLot,
      lotStep,
      maxLot,
    },
    trade: {
      entry: ticksToText(entryTicks),
      stop: ticksToText(stopTicks),
      extraDistance: extraTicks > 0 ? ticksToText(extraTicks) : "0",
    },
    conversion: needsConversion
      ? rng.chance(50)
        ? { base: accountCurrency, quote: quoteCurrency, price: ticksToText(rng.int(50000, 20000000)) }
        : { base: quoteCurrency, quote: accountCurrency, price: ticksToText(rng.int(50000, 20000000)) }
      : null,
    commissionPerLot: rng.chance(40) ? Q.of(BigInt(rng.int(1, 2000))).div(100n).toFixed(2, "down") : "0",
    leverage: rng.chance(50) ? String(rng.int(1, 500)) : null,
    budgetCap: rng.chance(25)
      ? {
          amount: Q.of(BigInt(rng.int(-5000, 200000))).div(100n).toFixed(2, "down"),
          reason: rng.pick(["daily", "total"]),
        }
      : null,
  };
  let expectedSource = "pair";
  if (quoteCurrency === accountCurrency) expectedSource = "none";
  else if (ownPair) expectedSource = "instrument";
  return { input, entryTicks, stopTicks, pipTicks, direction, expectedSource };
}

const RUNS = 2500;

test("property: generated inputs keep the sizing invariants", () => {
  const rng = makeRng(20240229);
  const seen = { instrument: 0, inferred: 0, ok: 0, "below-minimum": 0, "no-budget": 0, capped: 0, long: 0, short: 0 };

  for (let i = 0; i < RUNS; i++) {
    const c = makeCase(rng);
    const label = `case ${i}: ${JSON.stringify(c.input)}`;
    const r = calculatePositionSize(c.input);
    const step = Q.of(c.input.instrument.lotStep);
    const minLot = Q.of(c.input.instrument.minLot);
    seen[r.status]++;
    seen[r.direction]++;
    if (r.conversionSource === "instrument") {
      seen.instrument++;
      if (c.input.instrument.baseCurrency === null) seen.inferred++;
    }

    // Loss per lot worked out here, without the implementation's own numbers:
    // price move (stop distance plus extra) times contract size, converted at the
    // price the loss is realised at, plus commission.
    {
      const t = c.input.trade;
      const extra = Q.of(t.extraDistance);
      const move = Q.of(t.entry).sub(t.stop).abs().add(extra).mul(c.input.instrument.contractSize);
      const exit = c.direction === "long" ? Q.of(t.stop).sub(extra) : Q.of(t.stop).add(extra);
      const cv = c.input.conversion;
      const acct = c.input.accountCurrency;
      let inAccount;
      if (c.input.instrument.quoteCurrency === acct) inAccount = move;
      else if (c.expectedSource === "instrument") inAccount = move.div(exit);
      else if (cv.base === acct) inAccount = move.div(cv.price);
      else inAccount = move.mul(cv.price);
      const expectedLoss = inAccount.add(Q.of(c.input.commissionPerLot));
      assert.equal(r.lossPerLot.toFraction(), expectedLoss.toFraction(), "loss per lot; " + label);
      assert.equal(r.actualRisk.toFraction(), r.lots.mul(expectedLoss).toFraction(), "actual risk; " + label);
      assert.equal(r.conversionSource, c.expectedSource, "conversion source; " + label);
      if (r.riskBudget.isPositive()) {
        assert.ok(r.lots.mul(expectedLoss).lte(r.riskBudget), "loss at the exit price within budget; " + label);
      }
    }
    if (r.notes.includes("capped-at-max-lot")) seen.capped++;

    // Risk invariants.
    if (r.riskBudget.isPositive()) {
      assert.ok(r.actualRisk.lte(r.riskBudget), "actualRisk <= riskBudget; " + label);
    }
    assert.ok(r.actualRisk.lte(r.riskAmount), "actualRisk <= riskAmount; " + label);

    // Lot shape.
    assert.ok(r.lots.floorToStep(step).eq(r.lots), "lots is a multiple of lotStep; " + label);
    assert.ok(r.lots.isZero() || r.lots.gte(minLot), "lots is 0 or >= minLot; " + label);
    if (c.input.instrument.maxLot !== null) {
      assert.ok(r.lots.lte(Q.of(c.input.instrument.maxLot)), "lots <= maxLot; " + label);
    }
    assert.equal(r.status === "ok", r.lots.isPositive(), "ok means lots above zero; " + label);

    // Minimum-lot rule: with a positive budget and no max-lot cap, the floor decides.
    if (r.riskBudget.isPositive() && !r.notes.includes("capped-at-max-lot")) {
      const floored = r.rawLots.floorToStep(step);
      assert.equal(r.status === "ok", floored.gte(minLot), "status follows floor vs minLot; " + label);
      if (floored.gte(minLot)) assert.ok(r.lots.eq(floored), label);
    }

    // Direction matches the prices.
    assert.equal(r.direction, c.direction, label);

    // The size is the largest allowed one.
    if (r.status === "ok") {
      const next = r.lots.add(step);
      const overBudget = next.mul(r.lossPerLot).gt(r.riskBudget);
      const overMax =
        c.input.instrument.maxLot !== null && next.gt(Q.of(c.input.instrument.maxLot));
      assert.ok(overBudget || overMax, "one more step would not be allowed; " + label);
    }
  }

  // The generator must cover every status, so the checks above mean something.
  assert.ok(seen.ok > 500, "enough ok cases: " + JSON.stringify(seen));
  assert.ok(seen["below-minimum"] > 20, "enough below-minimum cases: " + JSON.stringify(seen));
  assert.ok(seen["no-budget"] > 5, "enough no-budget cases: " + JSON.stringify(seen));
  assert.ok(seen.instrument > 300, "enough own-pair cases: " + JSON.stringify(seen));
  assert.ok(seen.inferred > 100, "enough inferred own-pair cases: " + JSON.stringify(seen));
  assert.ok(seen.capped > 20, "enough capped cases: " + JSON.stringify(seen));
  assert.ok(seen.long > 500 && seen.short > 500, "both directions: " + JSON.stringify(seen));
});

test("property: a wider stop never gives a larger lot size", () => {
  const rng = makeRng(777);
  let compared = 0;
  for (let i = 0; i < RUNS; i++) {
    const c = makeCase(rng);
    const extraTicks = rng.int(1, 2000) * c.pipTicks;
    const widerStopTicks =
      c.direction === "long" ? c.stopTicks - extraTicks : c.stopTicks + extraTicks;
    if (widerStopTicks <= 0) continue;
    const wider = structuredClone(c.input);
    wider.trade.stop = ticksToText(widerStopTicks);
    const a = calculatePositionSize(c.input);
    let b;
    try {
      b = calculatePositionSize(wider);
    } catch (e) {
      if (e.code === "range" && e.field === "trade.extraDistance") continue; // exit price not above zero
      throw e;
    }
    compared++;
    assert.ok(b.lots.lte(a.lots), `wider stop gave more lots; ${JSON.stringify(c.input)}`);
    assert.ok(b.stopPips.gt(a.stopPips));
  }
  assert.ok(compared > 2000, "compared " + compared);
});

test("property: swapping entry and stop flips direction and keeps the lots", () => {
  const rng = makeRng(31337);
  for (let i = 0; i < RUNS; i++) {
    const c = makeCase(rng, false); // inputs that convert at entry and exit prices can give different lots
    const swapped = structuredClone(c.input);
    swapped.trade.entry = c.input.trade.stop;
    swapped.trade.stop = c.input.trade.entry;
    const a = calculatePositionSize(c.input);
    const b = calculatePositionSize(swapped);
    assert.notEqual(a.direction, b.direction);
    assert.equal(a.lots.toFraction(), b.lots.toFraction(), JSON.stringify(c.input));
    assert.equal(a.status, b.status);
    assert.equal(a.lossPerLot.toFraction(), b.lossPerLot.toFraction());
  }
});

test("property: the generator is deterministic", () => {
  const a = makeCase(makeRng(5));
  const b = makeCase(makeRng(5));
  assert.deepEqual(a.input, b.input);
});
