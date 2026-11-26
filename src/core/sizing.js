// Position size: how many lots can you trade for a given risk and stop.
// Every calculation uses the exact Q type from rational.js.

import { Q, InputError, parseDecimal, trimInputText } from "./rational.js";

const sizingCurrencyPattern = /^[A-Z0-9]{3,5}$/;

// Trim blanks, upper-case ASCII letters, drop everything that is not A-Z or 0-9.
function sizingNormaliseSymbol(symbol) {
  return trimInputText(symbol)
    .replace(/[a-z]/g, (c) => c.toUpperCase())
    .replace(/[^A-Z0-9]/g, "");
}

function sizingFail(message, field, code) {
  return new InputError(message, field, code);
}

function sizingIsObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sizingIsMissing(value) {
  return value === undefined || value === null;
}

// Parse a required decimal string. Missing -> code "empty".
function sizingRequireDecimal(value, path) {
  if (sizingIsMissing(value)) {
    throw sizingFail("This field is required.", path, "empty");
  }
  return parseDecimal(value, path);
}

// Parse an optional decimal string. Missing -> fallback (a Q or null).
function sizingOptionalDecimal(value, path, fallback) {
  if (sizingIsMissing(value)) return fallback;
  return parseDecimal(value, path);
}

function sizingRequirePositive(value, path) {
  const q = sizingRequireDecimal(value, path);
  if (!q.isPositive()) {
    throw sizingFail("This must be more than zero.", path, "range");
  }
  return q;
}

function sizingRequireNonNegative(q, path) {
  if (q.isNegative()) {
    throw sizingFail("This cannot be negative.", path, "range");
  }
  return q;
}

// Trim blanks (space, tab, LF, CR), then check the pattern. Returns the trimmed code.
function sizingRequireCurrency(value, path) {
  if (sizingIsMissing(value)) {
    throw sizingFail("This field is required.", path, "empty");
  }
  const code = typeof value === "string" ? trimInputText(value) : value;
  if (typeof code !== "string" || !sizingCurrencyPattern.test(code)) {
    throw sizingFail(
      "Use 3 to 5 capital letters or digits, for example EUR.",
      path,
      "format"
    );
  }
  return code;
}

function sizingRequireObject(value, path) {
  if (!sizingIsObject(value)) {
    throw sizingFail("This section is required.", path, "empty");
  }
  return value;
}

function sizingParseRisk(risk, balance) {
  const r = sizingRequireObject(risk, "risk");
  if (r.mode !== "percent" && r.mode !== "amount") {
    throw sizingFail('Risk mode must be "percent" or "amount".', "risk.mode", "format");
  }
  const value = sizingRequireDecimal(r.value, "risk.value");
  if (!value.isPositive()) {
    throw sizingFail("Risk must be more than zero.", "risk.value", "range");
  }
  if (r.mode === "percent" && value.gt(Q.HUNDRED)) {
    throw sizingFail("Risk cannot be more than 100 percent.", "risk.value", "range");
  }
  if (r.mode === "amount" && value.gt(balance)) {
    throw sizingFail("Risk cannot be more than your balance.", "risk.value", "range");
  }
  return { mode: r.mode, value };
}

function sizingParseInstrument(ins, accountCurrency) {
  const i = sizingRequireObject(ins, "instrument");
  const symbol = typeof i.symbol === "string" ? trimInputText(i.symbol) : "";
  if (symbol === "") {
    throw sizingFail("Enter a symbol or name.", "instrument.symbol", "empty");
  }
  if ([...symbol].length > 20) {
    throw sizingFail("Use 20 characters or fewer.", "instrument.symbol", "range");
  }
  const quoteCurrency = sizingRequireCurrency(i.quoteCurrency, "instrument.quoteCurrency");
  const contractSize = sizingRequirePositive(i.contractSize, "instrument.contractSize");
  const pipSize = sizingRequirePositive(i.pipSize, "instrument.pipSize");
  const minLot = sizingRequirePositive(i.minLot, "instrument.minLot");
  const lotStep = sizingRequirePositive(i.lotStep, "instrument.lotStep");
  if (!minLot.floorToStep(lotStep).eq(minLot)) {
    throw sizingFail(
      "The minimum lot must be a whole number of lot steps.",
      "instrument.minLot",
      "not-on-step"
    );
  }
  const maxLot = sizingOptionalDecimal(i.maxLot, "instrument.maxLot", null);
  if (maxLot !== null && maxLot.lt(minLot)) {
    throw sizingFail(
      "The maximum lot cannot be smaller than the minimum lot.",
      "instrument.maxLot",
      "range"
    );
  }
  let baseCurrency = null;
  if (!sizingIsMissing(i.baseCurrency)) {
    baseCurrency = sizingRequireCurrency(i.baseCurrency, "instrument.baseCurrency");
    if (baseCurrency === quoteCurrency) {
      throw sizingFail(
        "The base currency must differ from the quote currency.",
        "instrument.baseCurrency",
        "range"
      );
    }
    if (baseCurrency !== accountCurrency && sizingNormaliseSymbol(symbol).startsWith(accountCurrency + quoteCurrency)) {
      throw sizingFail("The base currency does not match the symbol.", "instrument.baseCurrency", "conflict");
    }
  }
  return { symbol, baseCurrency, quoteCurrency, contractSize, pipSize, minLot, lotStep, maxLot };
}

function sizingParseTrade(trade) {
  const t = sizingRequireObject(trade, "trade");
  const entry = sizingRequirePositive(t.entry, "trade.entry");
  const stop = sizingRequirePositive(t.stop, "trade.stop");
  if (stop.eq(entry)) {
    throw sizingFail("The stop must be different from the entry.", "trade.stop", "range");
  }
  const extraDistance = sizingRequireNonNegative(
    sizingOptionalDecimal(t.extraDistance, "trade.extraDistance", Q.ZERO),
    "trade.extraDistance"
  );
  return { entry, stop, extraDistance };
}

/**
 * The base currency used to detect an instrument that is itself the pair of
 * account currency and quote currency (rules in docs/how-it-works.md).
 *
 * Takes plain values: instrument = { symbol, quoteCurrency, baseCurrency }.
 * Never throws. Returns a string or null.
 *  - An explicit baseCurrency (not null/undefined) always wins.
 *  - Otherwise the symbol is normalised: trimmed, ASCII letters upper-cased,
 *    everything that is not A-Z or 0-9 removed. If the result starts with
 *    accountCurrency + quoteCurrency, the account currency is the base.
 *  - Otherwise null.
 */
export function effectiveBaseCurrency(accountCurrency, instrument) {
  if (!sizingIsObject(instrument)) return null;
  if (!sizingIsMissing(instrument.baseCurrency)) {
    return typeof instrument.baseCurrency === "string" ? instrument.baseCurrency : null;
  }
  if (
    typeof accountCurrency !== "string" ||
    typeof instrument.quoteCurrency !== "string" ||
    typeof instrument.symbol !== "string"
  ) {
    return null;
  }
  const norm = sizingNormaliseSymbol(instrument.symbol);
  return norm.startsWith(accountCurrency + instrument.quoteCurrency) ? accountCurrency : null;
}

// Returns { rate, lossRate, conversionSource }.
function sizingParseConversion(conversion, accountCurrency, instrument, trade) {
  const quoteCurrency = instrument.quoteCurrency;
  if (quoteCurrency === accountCurrency) {
    if (!sizingIsMissing(conversion)) {
      throw sizingFail(
        "No conversion is needed when the quote currency is your account currency.",
        "conversion",
        "not-needed"
      );
    }
    return { rate: Q.ONE, lossRate: Q.ONE, conversionSource: "none" };
  }
  if (effectiveBaseCurrency(accountCurrency, instrument) === accountCurrency) {
    if (!sizingIsMissing(conversion)) {
      throw sizingFail(
        "No conversion is needed when the instrument starts with your account currency.",
        "conversion",
        "not-needed"
      );
    }
    const long = trade.stop.lt(trade.entry);
    const exitPrice = long
      ? trade.stop.sub(trade.extraDistance)
      : trade.stop.add(trade.extraDistance);
    if (!exitPrice.isPositive()) {
      throw sizingFail(
        "The stop minus the extra distance must stay above zero.",
        "trade.extraDistance",
        "range"
      );
    }
    return {
      rate: Q.ONE.div(trade.entry),
      lossRate: Q.ONE.div(exitPrice),
      conversionSource: "instrument",
    };
  }
  if (sizingIsMissing(conversion)) {
    throw sizingFail(
      "A currency conversion price is needed because the quote currency differs from your account currency.",
      "conversion",
      "required"
    );
  }
  const c = sizingRequireObject(conversion, "conversion");
  const base = sizingRequireCurrency(c.base, "conversion.base");
  const quote = sizingRequireCurrency(c.quote, "conversion.quote");
  const price = sizingRequirePositive(c.price, "conversion.price");
  let rate;
  if (base === quoteCurrency && quote === accountCurrency) rate = price;
  else if (base === accountCurrency && quote === quoteCurrency) rate = Q.ONE.div(price);
  else {
    throw sizingFail(
      "The pair must be made of your account currency and the quote currency.",
      "conversion",
      "wrong-pair"
    );
  }
  return { rate, lossRate: rate, conversionSource: "pair" };
}

function sizingParseBudgetCap(cap) {
  if (sizingIsMissing(cap)) return null;
  const c = sizingRequireObject(cap, "budgetCap");
  if (c.reason !== "daily" && c.reason !== "total") {
    throw sizingFail('The reason must be "daily" or "total".', "budgetCap.reason", "format");
  }
  let amount;
  if (c.amount instanceof Q) {
    amount = c.amount;
  } else {
    amount = sizingRequireDecimal(c.amount, "budgetCap.amount");
  }
  return { amount, reason: c.reason };
}

export function calculatePositionSize(input) {
  // 1. Parse and range-check every field.
  const inp = sizingRequireObject(input, null);
  const accountCurrency = sizingRequireCurrency(inp.accountCurrency, "accountCurrency");
  const balance = sizingRequirePositive(inp.balance, "balance");
  const risk = sizingParseRisk(inp.risk, balance);
  const instrument = sizingParseInstrument(inp.instrument, accountCurrency);
  const trade = sizingParseTrade(inp.trade);
  const { rate, lossRate, conversionSource } = sizingParseConversion(
    inp.conversion,
    accountCurrency,
    instrument,
    trade
  );
  const commissionPerLot = sizingRequireNonNegative(
    sizingOptionalDecimal(inp.commissionPerLot, "commissionPerLot", Q.ZERO),
    "commissionPerLot"
  );
  const leverageRaw = sizingOptionalDecimal(inp.leverage, "leverage", null);
  if (leverageRaw !== null && !leverageRaw.isPositive()) {
    throw sizingFail("Leverage must be more than zero.", "leverage", "range");
  }
  const leverage = leverageRaw;
  const budgetCap = sizingParseBudgetCap(inp.budgetCap);

  // 2. Compute.
  const riskAmount =
    risk.mode === "amount" ? risk.value : balance.mul(risk.value).div(Q.HUNDRED);

  let riskBudget = riskAmount;
  let limitedBy = "risk";
  if (budgetCap !== null) {
    riskBudget = Q.min(riskAmount, budgetCap.amount);
    if (budgetCap.amount.lt(riskAmount)) limitedBy = budgetCap.reason;
  }

  const priceDistance = trade.entry.sub(trade.stop).abs();
  const stopDistance = priceDistance.add(trade.extraDistance);
  const direction = trade.stop.lt(trade.entry) ? "long" : "short";
  const lossPerLot = stopDistance.mul(instrument.contractSize).mul(lossRate).add(commissionPerLot);
  const pipValuePerLot = instrument.pipSize.mul(instrument.contractSize).mul(rate);
  const stopPips = priceDistance.div(instrument.pipSize);

  const notes = [];
  let status;
  let rawLots;
  let lots;

  if (!riskBudget.isPositive()) {
    status = "no-budget";
    rawLots = Q.ZERO;
    lots = Q.ZERO;
  } else {
    rawLots = riskBudget.div(lossPerLot);
    lots = rawLots.floorToStep(instrument.lotStep);
    if (instrument.maxLot !== null && lots.gt(instrument.maxLot)) {
      lots = instrument.maxLot.floorToStep(instrument.lotStep);
      notes.push("capped-at-max-lot");
    }
    if (lots.lt(instrument.minLot)) {
      status = "below-minimum";
      lots = Q.ZERO;
    } else {
      status = "ok";
    }
  }

  const actualRisk = lots.mul(lossPerLot);
  const actualRiskPercent = actualRisk.div(balance).mul(Q.HUNDRED);
  const commissionTotal = lots.mul(commissionPerLot);
  const lossAtMinLot = instrument.minLot.mul(lossPerLot);
  const notional = lots.mul(instrument.contractSize).mul(trade.entry).mul(rate);
  const margin = leverage === null ? null : notional.div(leverage);

  if (riskAmount.div(balance).mul(Q.HUNDRED).gt(2n)) notes.push("risk-above-2-percent");
  if (trade.extraDistance.isZero()) notes.push("no-spread-entered");
  if (commissionPerLot.isZero()) notes.push("no-commission-entered");
  if (margin !== null && margin.gt(balance)) notes.push("margin-above-balance");
  if (budgetCap !== null && status === "ok" && actualRisk.eq(budgetCap.amount)) {
    notes.push("loss-equals-room");
  }

  return {
    status,
    direction,
    lots,
    rawLots,
    riskAmount,
    riskBudget,
    limitedBy,
    rate,
    lossRate,
    conversionSource,
    priceDistance,
    stopDistance,
    stopPips,
    lossPerLot,
    pipValuePerLot,
    actualRisk,
    actualRiskPercent,
    commissionTotal,
    lossAtMinLot,
    notional,
    margin,
    notes,
  };
}
