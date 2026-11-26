import { test } from "node:test";
import assert from "node:assert/strict";
import { Q, InputError } from "../src/core/rational.js";
import { calculatePositionSize, effectiveBaseCurrency } from "../src/core/sizing.js";

// A USD account trading EURUSD. 1% of 10000 is 100. A 20 pip stop loses 200 per lot.
function base(over = {}) {
  const input = {
    accountCurrency: "USD",
    balance: "10000",
    risk: { mode: "percent", value: "1" },
    instrument: {
      symbol: "TESTPAIR",
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
  };
  for (const [key, value] of Object.entries(over)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Q)
        && ["instrument", "trade", "risk"].includes(key)) {
      input[key] = { ...input[key], ...value };
    } else {
      input[key] = value;
    }
  }
  return input;
}

function fr(q) {
  return q.toFraction();
}

function expectError(input, field, code) {
  assert.throws(
    () => calculatePositionSize(input),
    (e) => {
      assert.ok(e instanceof InputError, "expected an InputError, got " + e);
      assert.equal(e.field, field);
      assert.equal(e.code, code);
      assert.equal(typeof e.message, "string");
      assert.ok(e.message.length > 0 && !e.message.includes("\n"));
      return true;
    }
  );
}

test("basic long trade, USD account", () => {
  const r = calculatePositionSize(base());
  assert.equal(r.status, "ok");
  assert.equal(r.direction, "long");
  assert.equal(r.limitedBy, "risk");
  assert.equal(fr(r.riskAmount), "100/1");
  assert.equal(fr(r.riskBudget), "100/1");
  assert.equal(fr(r.rate), "1/1");
  assert.equal(fr(r.priceDistance), "1/500");
  assert.equal(fr(r.stopDistance), "1/500");
  assert.equal(fr(r.stopPips), "20/1");
  assert.equal(fr(r.lossPerLot), "200/1");
  assert.equal(fr(r.pipValuePerLot), "10/1");
  assert.equal(fr(r.rawLots), "1/2");
  assert.equal(fr(r.lots), "1/2");
  assert.equal(fr(r.actualRisk), "100/1");
  assert.equal(fr(r.actualRiskPercent), "1/1");
  assert.equal(fr(r.commissionTotal), "0/1");
  assert.equal(fr(r.lossAtMinLot), "2/1");
  assert.equal(fr(r.notional), "54250/1");
  assert.equal(r.margin, null);
  assert.deepEqual(r.notes, ["no-spread-entered", "no-commission-entered"]);
  assert.ok(r.lots instanceof Q);
});

test("short trade when the stop is above the entry", () => {
  const r = calculatePositionSize(base({ trade: { entry: "1.08300", stop: "1.08500" } }));
  assert.equal(r.direction, "short");
  assert.equal(fr(r.lots), "1/2");
});

test("lots round down to the step, never up", () => {
  // loss per lot 200, budget 100 -> use a stop that gives 0.4807...
  const r = calculatePositionSize(base({ commissionPerLot: "8" }));
  assert.equal(fr(r.lossPerLot), "208/1");
  assert.equal(fr(r.rawLots), "25/52");
  assert.equal(fr(r.lots), "12/25");
  assert.equal(fr(r.actualRisk), "2496/25");
  assert.ok(r.actualRisk.lte(r.riskBudget));
  assert.equal(fr(r.commissionTotal), "96/25");
  assert.deepEqual(r.notes, ["no-spread-entered"]);
});

test("extra distance widens the stop but not the pip count", () => {
  const r = calculatePositionSize(base({ trade: { extraDistance: "0.0002" } }));
  assert.equal(fr(r.priceDistance), "1/500");
  assert.equal(fr(r.stopDistance), "11/5000");
  assert.equal(fr(r.stopPips), "20/1");
  assert.equal(fr(r.lossPerLot), "220/1");
  assert.equal(fr(r.rawLots), "5/11");
  assert.equal(fr(r.lots), "9/20");
  assert.deepEqual(r.notes, ["no-commission-entered"]);
});

test("missing optional fields use their defaults", () => {
  const input = base();
  delete input.conversion;
  delete input.commissionPerLot;
  delete input.leverage;
  delete input.budgetCap;
  delete input.trade.extraDistance;
  delete input.instrument.maxLot;
  const r = calculatePositionSize(input);
  assert.equal(r.status, "ok");
  assert.equal(fr(r.lots), "1/2");
  assert.equal(r.margin, null);
  assert.equal(r.limitedBy, "risk");
});

test("risk by fixed amount", () => {
  const r = calculatePositionSize(base({ risk: { mode: "amount", value: "250" } }));
  assert.equal(fr(r.riskAmount), "250/1");
  assert.equal(fr(r.lots), "5/4");
  assert.equal(fr(r.actualRiskPercent), "5/2");
});

test("status below-minimum never rounds up", () => {
  const r = calculatePositionSize(base({ risk: { mode: "amount", value: "1" } }));
  assert.equal(r.status, "below-minimum");
  assert.equal(fr(r.rawLots), "1/200");
  assert.ok(r.lots.isZero());
  assert.ok(r.actualRisk.isZero());
  assert.equal(fr(r.lossAtMinLot), "2/1");
  assert.ok(r.lossAtMinLot.gt(r.riskBudget));
});

test("lossAtMinLot is always returned", () => {
  const r = calculatePositionSize(base());
  assert.equal(fr(r.lossAtMinLot), "2/1");
});

test("conversion: pair where the account currency is the base (EUR account)", () => {
  const r = calculatePositionSize(
    base({
      accountCurrency: "EUR",
      conversion: { base: "EUR", quote: "USD", price: "1.0850" },
    })
  );
  assert.equal(fr(r.rate), "200/217");
  assert.equal(fr(r.lossPerLot), "40000/217");
  assert.equal(fr(r.pipValuePerLot), "2000/217");
  assert.equal(r.status, "ok");
  assert.ok(r.actualRisk.lte(r.riskBudget));
});

test("conversion: pair where the quote currency is the base (USD account, GBP quote)", () => {
  const r = calculatePositionSize(
    base({
      instrument: { symbol: "EURGBP", quoteCurrency: "GBP" },
      conversion: { base: "GBP", quote: "USD", price: "1.2700" },
    })
  );
  assert.equal(fr(r.rate), "127/100");
  assert.equal(fr(r.lossPerLot), "254/1");
});

test("conversion: USD account, JPY quote, USDJPY at 150", () => {
  const r = calculatePositionSize(
    base({
      instrument: { symbol: "EURJPY", quoteCurrency: "JPY", pipSize: "0.01" },
      trade: { entry: "160.00", stop: "159.00" },
      conversion: { base: "USD", quote: "JPY", price: "150.00" },
    })
  );
  assert.equal(fr(r.rate), "1/150");
  // 1.00 yen move * 100000 / 150 = 666.67 per lot
  assert.equal(fr(r.lossPerLot), "2000/3");
  assert.equal(fr(r.stopPips), "100/1");
  assert.equal(fr(r.rawLots), "3/20");
  assert.equal(fr(r.lots), "3/20");
});

test("conversion error: not-needed", () => {
  expectError(
    base({ conversion: { base: "USD", quote: "USD", price: "1" } }),
    "conversion",
    "not-needed"
  );
});

test("conversion error: required", () => {
  expectError(base({ accountCurrency: "EUR", conversion: null }), "conversion", "required");
  const input = base({ accountCurrency: "EUR" });
  delete input.conversion;
  expectError(input, "conversion", "required");
});

test("conversion error: wrong-pair", () => {
  const eur = { accountCurrency: "EUR" };
  expectError(
    base({ ...eur, conversion: { base: "GBP", quote: "USD", price: "1.27" } }),
    "conversion",
    "wrong-pair"
  );
  expectError(
    base({ ...eur, conversion: { base: "USD", quote: "GBP", price: "0.79" } }),
    "conversion",
    "wrong-pair"
  );
  // The reversed pair (base is the quote currency, quote is the account currency) is valid.
  const ok = calculatePositionSize(
    base({ ...eur, conversion: { base: "USD", quote: "EUR", price: "0.92" } })
  );
  assert.equal(fr(ok.rate), "23/25");
  expectError(
    base({ ...eur, conversion: { base: "EUR", quote: "EUR", price: "1" } }),
    "conversion",
    "wrong-pair"
  );
});

test("conversion price must be above zero", () => {
  expectError(
    base({ accountCurrency: "EUR", conversion: { base: "EUR", quote: "USD", price: "0" } }),
    "conversion.price",
    "range"
  );
  expectError(
    base({ accountCurrency: "EUR", conversion: { base: "EUR", quote: "USD", price: "1,08" } }),
    "conversion.price",
    "comma"
  );
});

test("maxLot caps the size and adds a note", () => {
  const r = calculatePositionSize(
    base({ risk: { mode: "percent", value: "10" }, instrument: { maxLot: "2" } })
  );
  assert.equal(fr(r.rawLots), "5/1");
  assert.equal(fr(r.lots), "2/1");
  assert.equal(r.status, "ok");
  assert.deepEqual(r.notes, ["capped-at-max-lot", "risk-above-2-percent", "no-spread-entered", "no-commission-entered"]);
  assert.equal(fr(r.actualRisk), "400/1");
});

test("maxLot is floored to the lot step", () => {
  const r = calculatePositionSize(
    base({ risk: { mode: "percent", value: "10" }, instrument: { maxLot: "2.005" } })
  );
  assert.equal(fr(r.lots), "2/1");
  assert.ok(r.notes.includes("capped-at-max-lot"));
});

test("maxLot above the raw size does nothing", () => {
  const r = calculatePositionSize(base({ instrument: { maxLot: "100" } }));
  assert.equal(fr(r.lots), "1/2");
  assert.ok(!r.notes.includes("capped-at-max-lot"));
});

test("maxLot equal to the size is not a cap", () => {
  const r = calculatePositionSize(base({ instrument: { maxLot: "0.5" } }));
  assert.equal(fr(r.lots), "1/2");
  assert.ok(!r.notes.includes("capped-at-max-lot"));
});

test("an off-grid maxLot floors to the step and never falls below the minimum", () => {
  const r = calculatePositionSize(
    base({ instrument: { minLot: "0.1", lotStep: "0.1", maxLot: "0.19" } })
  );
  assert.equal(r.status, "ok");
  assert.equal(fr(r.lots), "1/10");
  assert.ok(r.notes.includes("capped-at-max-lot"));
});

test("budgetCap as a string limits the risk", () => {
  const r = calculatePositionSize(base({ budgetCap: { amount: "50", reason: "daily" } }));
  assert.equal(fr(r.riskAmount), "100/1");
  assert.equal(fr(r.riskBudget), "50/1");
  assert.equal(r.limitedBy, "daily");
  assert.equal(fr(r.lots), "1/4");
  assert.equal(fr(r.actualRisk), "50/1");
  assert.equal(fr(r.actualRiskPercent), "1/2");
});

test("budgetCap as a Q limits the risk", () => {
  const r = calculatePositionSize(base({ budgetCap: { amount: Q.of("50"), reason: "total" } }));
  assert.equal(fr(r.riskBudget), "50/1");
  assert.equal(r.limitedBy, "total");
  assert.equal(fr(r.lots), "1/4");
});

test("budgetCap above or equal to the risk amount does not limit", () => {
  let r = calculatePositionSize(base({ budgetCap: { amount: "500", reason: "daily" } }));
  assert.equal(fr(r.riskBudget), "100/1");
  assert.equal(r.limitedBy, "risk");
  r = calculatePositionSize(base({ budgetCap: { amount: "100", reason: "daily" } }));
  assert.equal(r.limitedBy, "risk");
  assert.equal(fr(r.lots), "1/2");
});

test("zero budgetCap gives no-budget", () => {
  const r = calculatePositionSize(base({ budgetCap: { amount: "0", reason: "daily" } }));
  assert.equal(r.status, "no-budget");
  assert.equal(r.limitedBy, "daily");
  assert.ok(r.lots.isZero());
  assert.ok(r.rawLots.isZero());
  assert.ok(r.riskBudget.isZero());
  assert.ok(r.actualRisk.isZero());
  assert.ok(r.actualRiskPercent.isZero());
  assert.equal(fr(r.lossAtMinLot), "2/1");
});

test("negative budgetCap gives no-budget and keeps the negative budget", () => {
  const r = calculatePositionSize(base({ budgetCap: { amount: "-75", reason: "total" } }));
  assert.equal(r.status, "no-budget");
  assert.equal(r.limitedBy, "total");
  assert.equal(fr(r.riskBudget), "-75/1");
  assert.ok(r.lots.isZero());
  const q = calculatePositionSize(base({ budgetCap: { amount: Q.of("-75"), reason: "daily" } }));
  assert.equal(q.status, "no-budget");
  assert.equal(q.limitedBy, "daily");
});

test("commission is part of the loss per lot", () => {
  const r = calculatePositionSize(base({ commissionPerLot: "10" }));
  assert.equal(fr(r.lossPerLot), "210/1");
  assert.equal(fr(r.lots), "47/100");
  assert.equal(fr(r.commissionTotal), "47/10");
  assert.deepEqual(r.notes, ["no-spread-entered"]);
});

test("leverage gives margin", () => {
  const r = calculatePositionSize(base({ leverage: "30" }));
  assert.equal(fr(r.notional), "54250/1");
  assert.equal(fr(r.margin), "5425/3");
  assert.deepEqual(r.notes, ["no-spread-entered", "no-commission-entered"]);
});

test("notes: risk-above-2-percent boundary", () => {
  let r = calculatePositionSize(base({ risk: { mode: "percent", value: "2" } }));
  assert.ok(!r.notes.includes("risk-above-2-percent"));
  r = calculatePositionSize(base({ risk: { mode: "percent", value: "2.01" } }));
  assert.ok(r.notes.includes("risk-above-2-percent"));
  r = calculatePositionSize(base({ risk: { mode: "amount", value: "201" } }));
  assert.ok(r.notes.includes("risk-above-2-percent"));
  r = calculatePositionSize(base({ risk: { mode: "amount", value: "200" } }));
  assert.ok(!r.notes.includes("risk-above-2-percent"));
});

test("risk-above-2-percent uses the asked risk, not the capped budget", () => {
  const r = calculatePositionSize(
    base({ risk: { mode: "percent", value: "5" }, budgetCap: { amount: "50", reason: "daily" } })
  );
  assert.ok(r.notes.includes("risk-above-2-percent"));
});

test("notes: spread and commission notes are independent", () => {
  assert.deepEqual(calculatePositionSize(base()).notes, ["no-spread-entered", "no-commission-entered"]);
  assert.deepEqual(calculatePositionSize(base({ commissionPerLot: "1" })).notes, ["no-spread-entered"]);
  assert.deepEqual(
    calculatePositionSize(base({ trade: { extraDistance: "0.0001" } })).notes,
    ["no-commission-entered"]
  );
  assert.deepEqual(
    calculatePositionSize(base({ commissionPerLot: "1", trade: { extraDistance: "0.0001" } })).notes,
    []
  );
  assert.ok(!calculatePositionSize(base()).notes.includes("no-cost-entered"));
});

test("notes: margin-above-balance", () => {
  let r = calculatePositionSize(base({ leverage: "1" }));
  assert.ok(r.notes.includes("margin-above-balance"));
  r = calculatePositionSize(base({ leverage: "5.425" }));
  // margin is exactly 10000 = balance, which is not above
  assert.ok(!r.notes.includes("margin-above-balance"));
});

test("notes come in the documented order", () => {
  const r = calculatePositionSize(
    base({
      risk: { mode: "percent", value: "10" },
      instrument: { maxLot: "2" },
      leverage: "1",
    })
  );
  assert.deepEqual(r.notes, [
    "capped-at-max-lot",
    "risk-above-2-percent",
    "no-spread-entered",
    "no-commission-entered",
    "margin-above-balance",
  ]);
});

test("unusual lot step: 0.1", () => {
  const r = calculatePositionSize(
    base({ instrument: { minLot: "0.1", lotStep: "0.1" }, risk: { mode: "amount", value: "100" } })
  );
  assert.equal(fr(r.lots), "1/2");
  const r2 = calculatePositionSize(
    base({ instrument: { minLot: "0.1", lotStep: "0.1" }, risk: { mode: "amount", value: "99" } })
  );
  assert.equal(fr(r2.lots), "2/5");
});

test("a very large account stays exact", () => {
  const r = calculatePositionSize(base({ balance: "123456789012345678901234567890" }));
  assert.equal(r.status, "ok");
  assert.ok(r.actualRisk.lte(r.riskBudget));
});

test("input is not changed", () => {
  const input = base({ budgetCap: { amount: "50", reason: "daily" } });
  const copy = JSON.stringify(input);
  calculatePositionSize(input);
  assert.equal(JSON.stringify(input), copy);
});

// Error table: every field path and code.
const errorCases = [
  // top level
  ["no input", () => null, null, "empty"],
  ["accountCurrency lower case", () => base({ accountCurrency: "usd" }), "accountCurrency", "format"],
  ["accountCurrency too short", () => base({ accountCurrency: "US" }), "accountCurrency", "format"],
  ["accountCurrency too long", () => base({ accountCurrency: "USDOLR" }), "accountCurrency", "format"],
  ["accountCurrency missing", () => base({ accountCurrency: undefined }), "accountCurrency", "empty"],
  ["balance empty", () => base({ balance: "" }), "balance", "empty"],
  ["balance missing", () => base({ balance: undefined }), "balance", "empty"],
  ["balance comma", () => base({ balance: "10,000" }), "balance", "comma"],
  ["balance format", () => base({ balance: "1e4" }), "balance", "format"],
  ["balance zero", () => base({ balance: "0" }), "balance", "range"],
  ["balance negative", () => base({ balance: "-5" }), "balance", "range"],
  ["balance not a string", () => base({ balance: 10000 }), "balance", "format"],
  // risk
  ["risk missing", () => base({ risk: undefined }), "risk", "empty"],
  ["risk mode unknown", () => base({ risk: { mode: "lots" } }), "risk.mode", "format"],
  ["risk value format", () => base({ risk: { value: "one" } }), "risk.value", "format"],
  ["risk value comma", () => base({ risk: { value: "1,5" } }), "risk.value", "comma"],
  ["risk value zero", () => base({ risk: { value: "0" } }), "risk.value", "range"],
  ["risk value negative", () => base({ risk: { value: "-1" } }), "risk.value", "range"],
  ["risk percent above 100", () => base({ risk: { value: "100.5" } }), "risk.value", "range"],
  ["risk amount above balance", () => base({ risk: { mode: "amount", value: "10001" } }), "risk.value", "range"],
  // instrument
  ["instrument missing", () => base({ instrument: undefined }), "instrument", "empty"],
  ["symbol empty", () => base({ instrument: { symbol: "" } }), "instrument.symbol", "empty"],
  ["symbol too long", () => base({ instrument: { symbol: "A".repeat(21) } }), "instrument.symbol", "range"],
  ["quoteCurrency bad", () => base({ instrument: { quoteCurrency: "u" } }), "instrument.quoteCurrency", "format"],
  ["contractSize zero", () => base({ instrument: { contractSize: "0" } }), "instrument.contractSize", "range"],
  ["contractSize format", () => base({ instrument: { contractSize: "x" } }), "instrument.contractSize", "format"],
  ["pipSize zero", () => base({ instrument: { pipSize: "0" } }), "instrument.pipSize", "range"],
  ["pipSize negative", () => base({ instrument: { pipSize: "-0.0001" } }), "instrument.pipSize", "range"],
  ["minLot zero", () => base({ instrument: { minLot: "0" } }), "instrument.minLot", "range"],
  ["minLot empty", () => base({ instrument: { minLot: "" } }), "instrument.minLot", "empty"],
  ["lotStep zero", () => base({ instrument: { lotStep: "0" } }), "instrument.lotStep", "range"],
  ["lotStep comma", () => base({ instrument: { lotStep: "0,01" } }), "instrument.lotStep", "comma"],
  ["maxLot below minLot", () => base({ instrument: { maxLot: "0.001" } }), "instrument.maxLot", "range"],
  ["maxLot format", () => base({ instrument: { maxLot: "big" } }), "instrument.maxLot", "format"],
  // trade
  ["trade missing", () => base({ trade: undefined }), "trade", "empty"],
  ["entry zero", () => base({ trade: { entry: "0" } }), "trade.entry", "range"],
  ["entry missing", () => base({ trade: { entry: undefined } }), "trade.entry", "empty"],
  ["stop zero", () => base({ trade: { stop: "0" } }), "trade.stop", "range"],
  ["stop equals entry", () => base({ trade: { stop: "1.085" } }), "trade.stop", "range"],
  ["stop format", () => base({ trade: { stop: "1.2.3" } }), "trade.stop", "format"],
  ["extraDistance negative", () => base({ trade: { extraDistance: "-0.1" } }), "trade.extraDistance", "range"],
  ["extraDistance comma", () => base({ trade: { extraDistance: "0,1" } }), "trade.extraDistance", "comma"],
  // optional top-level numbers
  ["commission negative", () => base({ commissionPerLot: "-1" }), "commissionPerLot", "range"],
  ["commission format", () => base({ commissionPerLot: "abc" }), "commissionPerLot", "format"],
  ["leverage zero", () => base({ leverage: "0" }), "leverage", "range"],
  ["leverage negative", () => base({ leverage: "-30" }), "leverage", "range"],
  ["leverage format", () => base({ leverage: "1:30" }), "leverage", "format"],
  // budgetCap
  ["budgetCap reason unknown", () => base({ budgetCap: { amount: "5", reason: "weekly" } }), "budgetCap.reason", "format"],
  ["budgetCap reason missing", () => base({ budgetCap: { amount: "5" } }), "budgetCap.reason", "format"],
  ["budgetCap amount empty", () => base({ budgetCap: { amount: "", reason: "daily" } }), "budgetCap.amount", "empty"],
  ["budgetCap amount format", () => base({ budgetCap: { amount: "x", reason: "daily" } }), "budgetCap.amount", "format"],
  // conversion currencies
  ["conversion base bad", () => base({ accountCurrency: "EUR", conversion: { base: "eu", quote: "USD", price: "1" } }), "conversion.base", "format"],
  ["conversion quote bad", () => base({ accountCurrency: "EUR", conversion: { base: "EUR", quote: "", price: "1" } }), "conversion.quote", "format"],
];

for (const [name, make, field, code] of errorCases) {
  test(`error: ${name}`, () => {
    expectError(make(), field, code);
  });
}

test("validation runs before any calculation and reports the first bad field in order", () => {
  // balance is checked before risk, risk before instrument, instrument before trade.
  expectError(base({ balance: "0", risk: { value: "0" } }), "balance", "range");
  expectError(base({ risk: { value: "0" }, instrument: { pipSize: "0" } }), "risk.value", "range");
  expectError(base({ instrument: { pipSize: "0" }, trade: { stop: "0" } }), "instrument.pipSize", "range");
  expectError(base({ trade: { stop: "0" }, commissionPerLot: "-1" }), "trade.stop", "range");
});

test("rawLots exactly equal to minLot gives ok with lots = minLot", () => {
  const r = calculatePositionSize(
    base({ risk: { mode: "amount", value: "2" }, instrument: { minLot: "0.01" } })
  );
  assert.equal(fr(r.rawLots), "1/100");
  assert.equal(r.status, "ok");
  assert.equal(fr(r.lots), "1/100");
  assert.equal(fr(r.actualRisk), "2/1");
});

test("rawLots just under minLot gives below-minimum", () => {
  const r = calculatePositionSize(base({ risk: { mode: "amount", value: "1.99" } }));
  assert.equal(r.status, "below-minimum");
});

test("notional and margin: USD account", () => {
  const r = calculatePositionSize(base({ leverage: "5" }));
  assert.equal(fr(r.notional), "54250/1");
  assert.equal(fr(r.margin), "10850/1");
  assert.ok(r.notes.includes("margin-above-balance"));
});

test("notional and margin use the conversion rate: EUR account EURUSD", () => {
  const r = calculatePositionSize(
    base({
      accountCurrency: "EUR",
      instrument: { baseCurrency: "EUR" },
      trade: { entry: "1.08500", stop: "1.08300" },
      leverage: "30",
    })
  );
  // conversionSource instrument: rate = 1/entry, so notional is in EUR: lots * 100000 * entry / entry
  assert.equal(r.conversionSource, "instrument");
  assert.equal(fr(r.rate), "200/217");
  assert.equal(fr(r.notional), fr(r.lots.mul("100000")));
  assert.equal(fr(r.margin), fr(r.lots.mul("100000").div("30")));
});

test("notional and margin use the rate: EUR account, USD quote, pair conversion", () => {
  const r = calculatePositionSize(
    base({
      accountCurrency: "EUR",
      conversion: { base: "EUR", quote: "USD", price: "1.25" },
      leverage: "2",
    })
  );
  assert.equal(r.conversionSource, "pair");
  assert.equal(fr(r.rate), "4/5");
  // lossPerLot = 0.002 * 100000 * 0.8 = 160; budget 100 -> 0.625 -> 0.62 lots
  assert.equal(fr(r.lots), "31/50");
  // notional = 0.62 * 100000 * 1.085 * 0.8 = 53816
  assert.equal(fr(r.notional), "53816/1");
  assert.equal(fr(r.margin), "26908/1");
  assert.ok(r.notes.includes("margin-above-balance"));
});

test("JPY account: notional, margin and note", () => {
  const r = calculatePositionSize({
    accountCurrency: "JPY",
    balance: "1000000",
    risk: { mode: "percent", value: "1" },
    instrument: {
      symbol: "USDJPY",
      baseCurrency: "USD",
      quoteCurrency: "JPY",
      contractSize: "100000",
      pipSize: "0.01",
      minLot: "0.01",
      lotStep: "0.01",
    },
    trade: { entry: "150.00", stop: "149.00" },
    leverage: "25",
  });
  // quote is the account currency: rate 1. lossPerLot = 1 * 100000 = 100000. budget 10000 -> 0.1 lots.
  assert.equal(r.conversionSource, "none");
  assert.equal(fr(r.lots), "1/10");
  assert.equal(fr(r.notional), "1500000/1");
  assert.equal(fr(r.margin), "60000/1");
  assert.ok(!r.notes.includes("margin-above-balance"));
  const r2 = calculatePositionSize({
    accountCurrency: "JPY",
    balance: "1000000",
    risk: { mode: "percent", value: "1" },
    instrument: {
      symbol: "USDJPY",
      quoteCurrency: "JPY",
      contractSize: "100000",
      pipSize: "0.01",
      minLot: "0.01",
      lotStep: "0.01",
    },
    trade: { entry: "150.00", stop: "149.00" },
    leverage: "1",
  });
  assert.ok(r2.notes.includes("margin-above-balance"));
});

function usdjpy(over = {}) {
  return base({
    instrument: {
      symbol: "USDJPY",
      baseCurrency: "USD",
      quoteCurrency: "JPY",
      pipSize: "0.01",
    },
    trade: { entry: "150.00", stop: "145.00", extraDistance: "0" },
    ...over,
  });
}

test("own pair, long: USDJPY 150 to 145 converts at the stop price", () => {
  const r = calculatePositionSize(usdjpy());
  assert.equal(r.conversionSource, "instrument");
  assert.equal(r.direction, "long");
  assert.equal(fr(r.rate), "1/150");
  assert.equal(fr(r.lossRate), "1/145");
  assert.equal(fr(r.lossPerLot), "100000/29");
  assert.equal(fr(r.rawLots), "29/1000");
  assert.equal(fr(r.lots), "1/50");
  assert.equal(fr(r.actualRisk), "2000/29");
  assert.ok(r.actualRisk.lte(r.riskBudget));
  assert.equal(fr(r.pipValuePerLot), "20/3");
});

test("own pair, short mirror: entry 145, stop 150", () => {
  const r = calculatePositionSize(
    usdjpy({ trade: { entry: "145.00", stop: "150.00", extraDistance: "0" } })
  );
  assert.equal(r.direction, "short");
  assert.equal(fr(r.rate), "1/145");
  assert.equal(fr(r.lossRate), "1/150");
  assert.equal(fr(r.lossPerLot), "10000/3");
  assert.equal(fr(r.rawLots), "3/100");
  assert.equal(fr(r.lots), "3/100");
});

test("own pair with extra distance: long exit price is stop minus extra", () => {
  const r = calculatePositionSize(
    usdjpy({ trade: { entry: "150.00", stop: "145.00", extraDistance: "1.00" } })
  );
  assert.equal(fr(r.lossRate), "1/144");
  assert.equal(fr(r.rate), "1/150");
  // stopDistance 6 * 100000 / 144 = 12500/3
  assert.equal(fr(r.lossPerLot), "12500/3");
});

test("own pair with extra distance: short exit price is stop plus extra", () => {
  const r = calculatePositionSize(
    usdjpy({ trade: { entry: "145.00", stop: "150.00", extraDistance: "1.00" } })
  );
  assert.equal(fr(r.lossRate), "1/151");
  assert.equal(fr(r.rate), "1/145");
  assert.equal(fr(r.lossPerLot), "600000/151");
});

test("own pair: exit price must be above zero", () => {
  expectError(
    usdjpy({ trade: { entry: "10", stop: "5", extraDistance: "5" } }),
    "trade.extraDistance",
    "range"
  );
  expectError(
    usdjpy({ trade: { entry: "10", stop: "5", extraDistance: "6" } }),
    "trade.extraDistance",
    "range"
  );
  const ok = calculatePositionSize(usdjpy({ trade: { entry: "10", stop: "5", extraDistance: "4" } }));
  assert.equal(fr(ok.lossRate), "1/1");
});

test("own pair: a conversion object is not needed", () => {
  expectError(
    usdjpy({ conversion: { base: "USD", quote: "JPY", price: "150" } }),
    "conversion",
    "not-needed"
  );
});

test("quote currency equal to account currency needs no conversion, whatever the base is", () => {
  const r = calculatePositionSize(
    base({ instrument: { baseCurrency: "EUR" } })
  );
  assert.equal(r.conversionSource, "none");
  assert.equal(fr(r.rate), "1/1");
  assert.equal(fr(r.lossRate), "1/1");
});

test("pair conversion has lossRate equal to rate", () => {
  const r = calculatePositionSize(
    base({
      instrument: { baseCurrency: "EUR", quoteCurrency: "GBP" },
      conversion: { base: "GBP", quote: "USD", price: "1.27" },
    })
  );
  assert.equal(r.conversionSource, "pair");
  assert.equal(fr(r.rate), fr(r.lossRate));
});

test("base currency validation", () => {
  expectError(base({ instrument: { baseCurrency: "USD" } }), "instrument.baseCurrency", "range");
  expectError(base({ instrument: { baseCurrency: "eur" } }), "instrument.baseCurrency", "format");
  const a = calculatePositionSize(base({ instrument: { baseCurrency: null } }));
  assert.equal(a.status, "ok");
});

test("minLot must sit on the step grid", () => {
  expectError(
    base({ instrument: { minLot: "0.015", lotStep: "0.01" } }),
    "instrument.minLot",
    "not-on-step"
  );
  expectError(
    base({ instrument: { minLot: "0.05", lotStep: "0.1" } }),
    "instrument.minLot",
    "not-on-step"
  );
  assert.throws(
    () => calculatePositionSize(base({ instrument: { minLot: "0.05", lotStep: "0.1" } })),
    (e) => e.message === "The minimum lot must be a whole number of lot steps."
  );
  const ok = calculatePositionSize(base({ instrument: { minLot: "0.05", lotStep: "0.01" } }));
  assert.equal(ok.status, "ok");
});

test("maxLot may be off the step grid", () => {
  const r = calculatePositionSize(
    base({ risk: { mode: "percent", value: "10" }, instrument: { maxLot: "2.005" } })
  );
  assert.equal(fr(r.lots), "2/1");
});

test("symbol is trimmed and counted in code points", () => {
  expectError(base({ instrument: { symbol: "   " } }), "instrument.symbol", "empty");
  assert.equal(calculatePositionSize(base({ instrument: { symbol: "  EURUSD  " } })).status, "ok");
  assert.equal(calculatePositionSize(base({ instrument: { symbol: "A".repeat(20) } })).status, "ok");
  expectError(base({ instrument: { symbol: "A".repeat(21) } }), "instrument.symbol", "range");
  // 20 emoji are 40 UTF-16 units but 20 code points
  assert.equal(calculatePositionSize(base({ instrument: { symbol: "\u{1F600}".repeat(20) } })).status, "ok");
  expectError(base({ instrument: { symbol: "\u{1F600}".repeat(21) } }), "instrument.symbol", "range");
  // spaces around a 20 character symbol do not count
  assert.equal(
    calculatePositionSize(base({ instrument: { symbol: " " + "A".repeat(20) + " " } })).status,
    "ok"
  );
});

test("Q constants are locked and instances are frozen", () => {
  for (const name of ["ZERO", "ONE", "HUNDRED"]) {
    const d = Object.getOwnPropertyDescriptor(Q, name);
    assert.equal(d.writable, false);
    assert.equal(d.configurable, false);
    assert.throws(() => {
      "use strict";
      Q[name] = Q.of(7n);
    }, TypeError);
  }
  assert.equal(Q.ZERO.toFraction(), "0/1");
  assert.ok(Object.isFrozen(Q.ONE));
  assert.ok(Object.isFrozen(Q.of("1.5")));
});

test("fixed risk amount equal to the balance is accepted, just above is rejected", () => {
  const ok = calculatePositionSize(base({ risk: { mode: "amount", value: "10000" } }));
  assert.equal(fr(ok.riskAmount), "10000/1");
  expectError(base({ risk: { mode: "amount", value: "10000.01" } }), "risk.value", "range");
});

test("percent risk of exactly 100 is accepted, just above is rejected", () => {
  const ok = calculatePositionSize(base({ risk: { mode: "percent", value: "100" } }));
  assert.equal(fr(ok.riskAmount), "10000/1");
  expectError(base({ risk: { mode: "percent", value: "100.01" } }), "risk.value", "range");
});

test("maxLot equal to minLot is accepted", () => {
  const r = calculatePositionSize(base({ instrument: { minLot: "0.01", maxLot: "0.01" } }));
  assert.equal(r.status, "ok");
  assert.equal(fr(r.lots), "1/100");
  assert.ok(r.notes.includes("capped-at-max-lot"));
  expectError(base({ instrument: { minLot: "0.02", maxLot: "0.019" } }), "instrument.maxLot", "range");
});

function ownPair(over = {}) {
  // USD account, USDJPY, no explicit baseCurrency.
  return base({
    instrument: { symbol: "USDJPY", baseCurrency: undefined, quoteCurrency: "JPY", pipSize: "0.01" },
    trade: { entry: "150.00", stop: "145.00", extraDistance: "0" },
    ...over,
  });
}

test("own pair is found from the symbol", () => {
  for (const symbol of ["USDJPY", "usd/jpy", "USDJPY.m", " usdjpy ", "USD-JPY.pro", "USD JPY"]) {
    const input = ownPair();
    input.instrument.symbol = symbol;
    const r = calculatePositionSize(input);
    assert.equal(r.conversionSource, "instrument", symbol);
    assert.equal(fr(r.lossRate), "1/145", symbol);
    assert.equal(fr(r.actualRisk), "2000/29", symbol);
    const withConv = ownPair({ conversion: { base: "USD", quote: "JPY", price: "150" } });
    withConv.instrument.symbol = symbol;
    expectError(withConv, "conversion", "not-needed");
  }
});

test("crypto account trading BTCUSD is an own pair", () => {
  const r = calculatePositionSize({
    accountCurrency: "BTC",
    balance: "10",
    risk: { mode: "percent", value: "1" },
    instrument: {
      symbol: "BTCUSD",
      quoteCurrency: "USD",
      contractSize: "1",
      pipSize: "1",
      minLot: "0.01",
      lotStep: "0.01",
    },
    trade: { entry: "50000", stop: "49000" },
  });
  assert.equal(r.conversionSource, "instrument");
  assert.equal(fr(r.lossRate), "1/49000");
});

test("a symbol that does not start with the pair uses the pair conversion", () => {
  const input = ownPair({ conversion: { base: "USD", quote: "JPY", price: "150" } });
  input.instrument.symbol = "EURJPY";
  assert.equal(calculatePositionSize(input).conversionSource, "pair");
  const noConv = ownPair();
  noConv.instrument.symbol = "EURJPY";
  expectError(noConv, "conversion", "required");
  const mid = ownPair();
  mid.instrument.symbol = "XUSDJPY";
  expectError(mid, "conversion", "required");
});

test("an explicit baseCurrency that agrees or says nothing new is used as given", () => {
  const a = ownPair();
  a.instrument.symbol = "EURJPY";
  a.instrument.baseCurrency = "EUR";
  expectError(a, "conversion", "required");
  const b = ownPair();
  b.instrument.symbol = "MYINDEX";
  b.instrument.baseCurrency = "USD";
  assert.equal(calculatePositionSize(b).conversionSource, "instrument");
  const c = ownPair();
  c.instrument.baseCurrency = null;
  assert.equal(calculatePositionSize(c).conversionSource, "instrument");
});

test("effectiveBaseCurrency helper", () => {
  const ins = (symbol, quoteCurrency, baseCurrency) => ({ symbol, quoteCurrency, baseCurrency });
  assert.equal(effectiveBaseCurrency("USD", ins("usd/jpy", "JPY")), "USD");
  assert.equal(effectiveBaseCurrency("USD", ins("EURJPY", "JPY")), null);
  assert.equal(effectiveBaseCurrency("USD", ins("EURJPY", "JPY", "GBP")), "GBP");
  assert.equal(effectiveBaseCurrency("USD", ins("USDJPY", "JPY", null)), "USD");
  assert.equal(effectiveBaseCurrency("USD", ins("USDJP", "JPY")), null);
  for (const odd of [null, undefined, 5, {}, { symbol: 5 }, { symbol: "USDJPY" }, { symbol: "\u{1F600}", quoteCurrency: "JPY" }]) {
    assert.doesNotThrow(() => effectiveBaseCurrency("USD", odd));
  }
  assert.doesNotThrow(() => effectiveBaseCurrency(null, ins("USDJPY", "JPY")));
  assert.equal(effectiveBaseCurrency("USD", { symbol: "USDJPY" }), null);
});

test("loss-equals-room when the loss uses the whole cap", () => {
  const r = calculatePositionSize(base({ budgetCap: { amount: "50", reason: "daily" } }));
  assert.equal(fr(r.actualRisk), "50/1");
  assert.deepEqual(r.notes, ["no-spread-entered", "no-commission-entered", "loss-equals-room"]);
  const t = calculatePositionSize(base({ budgetCap: { amount: Q.of("50"), reason: "total" } }));
  assert.ok(t.notes.includes("loss-equals-room"));
});

test("no loss-equals-room when the loss is below the cap", () => {
  const r = calculatePositionSize(base({ budgetCap: { amount: "55", reason: "daily" } }));
  assert.equal(fr(r.actualRisk), "54/1");
  assert.ok(!r.notes.includes("loss-equals-room"));
});

test("loss-equals-room only with a cap that the loss reaches", () => {
  assert.ok(!calculatePositionSize(base()).notes.includes("loss-equals-room"));
  // a cap equal to the risk amount is a tie: the account still ends on the floor
  const eq = calculatePositionSize(base({ budgetCap: { amount: "100", reason: "daily" } }));
  assert.equal(eq.limitedBy, "risk");
  assert.ok(eq.notes.includes("loss-equals-room"));
  const eqQ = calculatePositionSize(base({ budgetCap: { amount: Q.of("100"), reason: "total" } }));
  assert.ok(eqQ.notes.includes("loss-equals-room"));
  const above = calculatePositionSize(base({ budgetCap: { amount: "500", reason: "daily" } }));
  assert.ok(!above.notes.includes("loss-equals-room"));
});

test("no loss-equals-room for below-minimum or no-budget", () => {
  const low = calculatePositionSize(base({ budgetCap: { amount: "1", reason: "daily" } }));
  assert.equal(low.status, "below-minimum");
  assert.ok(!low.notes.includes("loss-equals-room"));
  const none = calculatePositionSize(base({ budgetCap: { amount: "0", reason: "daily" } }));
  assert.equal(none.status, "no-budget");
  assert.ok(!none.notes.includes("loss-equals-room"));
});

test("loss-equals-room comes last in the notes order (it never meets capped-at-max-lot)", () => {
  const r = calculatePositionSize(
    base({
      risk: { mode: "percent", value: "10" },
      instrument: { maxLot: "2" },
      leverage: "1",
      budgetCap: { amount: "400", reason: "total" },
    })
  );
  assert.equal(fr(r.actualRisk), "400/1");
  assert.deepEqual(r.notes, [
    "risk-above-2-percent",
    "no-spread-entered",
    "no-commission-entered",
    "margin-above-balance",
    "loss-equals-room",
  ]);
});

test("explicit baseCurrency that contradicts the symbol is a conflict", () => {
  const bad = ownPair();
  bad.instrument.baseCurrency = "EUR";
  expectError(bad, "instrument.baseCurrency", "conflict");
  assert.throws(
    () => calculatePositionSize(bad),
    (e) => e.message === "The base currency does not match the symbol."
  );
  const lower = ownPair();
  lower.instrument.symbol = "usd/jpy.m";
  lower.instrument.baseCurrency = "GBP";
  expectError(lower, "instrument.baseCurrency", "conflict");
});

test("explicit baseCurrency that agrees, or a symbol without information, is accepted", () => {
  const agree = ownPair();
  agree.instrument.baseCurrency = "USD";
  assert.equal(calculatePositionSize(agree).conversionSource, "instrument");
  // symbol gives no information about the pair
  const other = ownPair({ conversion: { base: "USD", quote: "JPY", price: "150" } });
  other.instrument.symbol = "MYINDEX";
  other.instrument.baseCurrency = "GBP";
  assert.equal(calculatePositionSize(other).conversionSource, "pair");
  // a prefix before the pair hides it, so nothing conflicts
  const prefixed = ownPair({ conversion: { base: "USD", quote: "JPY", price: "150" } });
  prefixed.instrument.symbol = "mUSDJPY";
  prefixed.instrument.baseCurrency = "EUR";
  assert.equal(calculatePositionSize(prefixed).conversionSource, "pair");
});

// Whitespace: only space, tab, LF and CR are trimmed.
test("numbers: only space, tab, LF and CR are trimmed at the ends", () => {
  assert.equal(fr(calculatePositionSize(base({ balance: " \t\r\n10000\n " })).riskAmount), "100/1");
  for (const bad of ["\uFEFF10000", "10000\uFEFF", "\u00A010000", "10000\u00A0", "\u200B10000", "\u200310000", "\v10000", "\f10000"]) {
    expectError(base({ balance: bad }), "balance", "format");
  }
});

test("symbol: only space, tab, LF and CR are trimmed before the empty check", () => {
  expectError(base({ instrument: { symbol: " \t\r\n " } }), "instrument.symbol", "empty");
  assert.equal(calculatePositionSize(base({ instrument: { symbol: "\uFEFF" } })).status, "ok");
  assert.equal(calculatePositionSize(base({ instrument: { symbol: "\u00A0" } })).status, "ok");
});

test("currency codes are trimmed of space, tab, LF and CR, then validated", () => {
  const r = calculatePositionSize(
    base({
      accountCurrency: " \tUSD\r\n",
      instrument: { quoteCurrency: "\tUSD " },
    })
  );
  assert.equal(r.status, "ok");
  assert.equal(r.conversionSource, "none");
  for (const bad of ["\u00A0USD", "USD\u00A0", "\uFEFFUSD", "U SD", "US D", "usd", " "]) {
    expectError(base({ accountCurrency: bad }), "accountCurrency", "format");
  }
  expectError(base({ instrument: { quoteCurrency: "\u00A0USD" } }), "instrument.quoteCurrency", "format");
  expectError(base({ instrument: { baseCurrency: "E UR" } }), "instrument.baseCurrency", "format");
});

test("trimmed currency codes are used for own-pair detection, conflicts and conversion", () => {
  const own = ownPair();
  own.accountCurrency = " USD ";
  own.instrument.quoteCurrency = "\tJPY";
  assert.equal(calculatePositionSize(own).conversionSource, "instrument");
  const conflict = ownPair();
  conflict.accountCurrency = " USD";
  conflict.instrument.baseCurrency = " EUR ";
  expectError(conflict, "instrument.baseCurrency", "conflict");
  const agree = ownPair();
  agree.instrument.baseCurrency = "\tUSD\n";
  assert.equal(calculatePositionSize(agree).conversionSource, "instrument");
  const pair = base({
    accountCurrency: "EUR ",
    conversion: { base: " EUR", quote: "USD\t", price: "1.25" },
  });
  const r = calculatePositionSize(pair);
  assert.equal(r.conversionSource, "pair");
  assert.equal(fr(r.rate), "4/5");
  expectError(
    base({ accountCurrency: "EUR", conversion: { base: "\u00A0EUR", quote: "USD", price: "1.25" } }),
    "conversion.base",
    "format"
  );
});

test("VERSION equals the version in package.json", async () => {
  const { readFileSync } = await import("node:fs");
  const { VERSION } = await import("../src/core/index.js");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(VERSION, pkg.version);
});
