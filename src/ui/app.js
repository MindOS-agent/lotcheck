// Lotcheck page logic.
//
// The first half of this file is pure: plain objects in, plain objects out,
// no DOM. That part is unit-tested in test/build.test.js. The second half
// attaches the pure parts to the page and only runs when a document exists.
//
// All maths goes through the exact Q type from the core. This file never does
// arithmetic on JavaScript numbers for money.

import { Q, InputError, parseDecimal, trimInputText } from "../core/rational.js";
import { calculatePositionSize, effectiveBaseCurrency } from "../core/sizing.js";
import { sizeWithGuard } from "../core/guard.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STORAGE_KEY = "lotcheck:v1";

export const DISCLAIMER =
  "A stop-loss does not guarantee this loss. Gaps and slippage can make the real loss larger. Lotcheck does not give trading advice.";

export const NOTE_TEXTS = {
  "risk-above-2-percent": "You are risking more than 2% of the account on one trade.",
  "no-spread-entered": "Spread and slippage are not included.",
  "no-commission-entered": "Commission is not included.",
  "margin-above-balance": "The margin for this size is more than your balance.",
  "capped-at-max-lot": "Limited to your broker's maximum lot size.",
  "loss-equals-room":
    "This size uses all of the room you entered. If the stop is hit, the account ends exactly on the limit, and many firms count that as a breach. Use \"Room to keep unused\" to stay clear of it.",
  "equity-above-high-water-mark":
    "Your current equity is above the highest value you entered. If your firm's floor follows equity, the highest value must be at least your current equity, or the room shown here is too large.",
};

export const BASE_HINT_FOREX = "The first currency of the pair. For EURUSD it is EUR.";
export const BASE_HINT_OTHER =
  "Only needed when the instrument is priced from your account currency under a different name, for example XBTUSD in a BTC account. Otherwise leave it empty.";

export const COSTS_LINE = "Swaps, financing and fees charged as a percent of the trade are never included.";

export const TRAILING_NOTE =
  "This room assumes the floor does not move while the trade is open. If your firm's floor follows equity, profit made before the stop raises the floor, and the stop can then break the limit.";

export const STOP_CLOSE_NOTE = "Your stop is less than one pip or point away from your entry. Check both prices.";

export const PERCENT_SIGN_MESSAGE = "Type the number only, without the % sign.";

export const INSTRUMENT_NOTE =
  "The loss is converted at your stop-loss price, so it is a little different from pips times pip value.";
export const PAIR_NOTE = "The conversion price can move before your stop is hit. The real loss moves with it.";

export const LIMITED_BY_TEXTS = {
  risk: "Your risk setting",
  daily: "Your daily loss limit",
  total: "Your total loss limit",
};

export const COMMA_MESSAGE =
  "Use a dot for decimals and no thousands separators, for example 10000.50";

const CURRENCY_PATTERN = /^[A-Z0-9]{3,5}$/;

const CURRENCY_KEYS = ["accountCurrency", "baseCurrency", "quoteCurrency"];

// Fields that hold a decimal number in the main form.
const MAIN_NUMBER_KEYS = [
  "balance",
  "riskValue",
  "contractSize",
  "pipSize",
  "minLot",
  "lotStep",
  "maxLot",
  "entry",
  "stop",
  "extraDistance",
  "commission",
  "leverage",
];

// Fields that hold a decimal number on the loss-limits screen.
const GUARD_NUMBER_KEYS = [
  "equity",
  "dailyPercent",
  "dailyOf",
  "dailyStart",
  "totalPercent",
  "totalInitial",
  "totalOf",
  "totalHigh",
  "totalFloorCap",
  "openRisk",
  "buffer",
];

// Prices: these keep the price example in the format message.
const PRICE_KEYS = ["entry", "stop", "convPrice", "extraDistance"];

// Numbers that may be zero. Every other number must be above zero.
const NON_NEGATIVE_KEYS = ["extraDistance", "commission", "openRisk", "buffer"];

// Fields that can be pre-filled for a forex pair.
export const PREFILL_KEYS = ["baseCurrency", "quoteCurrency", "contractSize", "pipSize", "minLot", "lotStep"];

// Changing one of these unticks "I have checked these numbers".
const INSTRUMENT_KEYS = [
  "instrumentType",
  "symbol",
  "baseCurrency",
  "quoteCurrency",
  "contractSize",
  "pipSize",
  "minLot",
  "lotStep",
  "maxLot",
];

// The only fields saved when the user ticks "Remember my inputs".
export const SAVED_KEYS = [
  "accountCurrency",
  "riskMode",
  "riskValue",
  "instrumentType",
  "symbol",
  "baseCurrency",
  "quoteCurrency",
  "contractSize",
  "pipSize",
  "minLot",
  "lotStep",
  "maxLot",
  "leverage",
];

export const FIELD_LABELS = {
  accountCurrency: "Account currency",
  balance: "Account balance",
  riskValue: "Risk per trade",
  symbol: "Symbol",
  baseCurrency: "Base currency",
  quoteCurrency: "Quote currency",
  contractSize: "Contract size",
  pipSize: "Pip or point size",
  minLot: "Minimum lot",
  lotStep: "Lot step",
  maxLot: "Maximum lot",
  convPair: "Conversion price type",
  convPrice: "Conversion price",
  entry: "Entry price",
  stop: "Stop-loss price",
  extraDistance: "Extra distance",
  commission: "Commission",
  leverage: "Leverage",
  equity: "Current equity",
  dailyPercent: "Daily limit (percent)",
  dailyOf: "Daily limit: percent of this amount",
  dailyStart: "Value at the start of the trading day",
  totalPercent: "Total limit (percent)",
  totalInitial: "Starting balance of the account",
  totalOf: "Total limit: percent of this amount",
  totalHigh: "Highest value reached",
  totalFloorCap: "Floor stops rising at (optional)",
  openRisk: "Open risk on trades you already have",
  buffer: "Room to keep unused",
};

// Maps the field path an InputError carries to the key of a form field.
const CORE_FIELD_TO_KEY = {
  accountCurrency: "accountCurrency",
  balance: "balance",
  "risk.mode": "riskValue",
  "risk.value": "riskValue",
  "instrument.symbol": "symbol",
  "instrument.baseCurrency": "baseCurrency",
  "instrument.quoteCurrency": "quoteCurrency",
  "instrument.contractSize": "contractSize",
  "instrument.pipSize": "pipSize",
  "instrument.minLot": "minLot",
  "instrument.lotStep": "lotStep",
  "instrument.maxLot": "maxLot",
  "trade.entry": "entry",
  "trade.stop": "stop",
  "trade.extraDistance": "extraDistance",
  conversion: "convPrice",
  "conversion.price": "convPrice",
  "conversion.base": "convPrice",
  "conversion.quote": "convPrice",
  commissionPerLot: "commission",
  leverage: "leverage",
  currentEquity: "equity",
  "daily.limitPercent": "dailyPercent",
  "daily.percentOf": "dailyOf",
  "daily.dayStartValue": "dailyStart",
  "total.limitPercent": "totalPercent",
  "total.initialBalance": "totalInitial",
  "total.percentOf": "totalOf",
  "total.highWaterMark": "totalHigh",
  "total.floorCap": "totalFloorCap",
  openRisk: "openRisk",
  buffer: "buffer",
};

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

export function defaultState() {
  return {
    accountCurrency: "",
    balance: "",
    riskMode: "percent",
    riskValue: "1",
    instrumentType: "forex",
    symbol: "",
    baseCurrency: "",
    quoteCurrency: "",
    contractSize: "",
    pipSize: "",
    minLot: "",
    lotStep: "",
    maxLot: "",
    tags: {},
    checked: false,
    convPair: "",
    convPrice: "",
    entry: "",
    stop: "",
    extraDistance: "",
    commission: "",
    leverage: "",
    guardOpen: false,
    equity: "",
    dailyPercent: "",
    dailyOf: "",
    dailyStart: "",
    totalType: "static",
    totalPercent: "",
    totalInitial: "",
    totalOf: "",
    totalHigh: "",
    totalFloorCap: "",
    openRisk: "",
    buffer: "",
  };
}

// A trimmed copy of the state, with currency codes in capitals.
export function cleanState(raw) {
  const merged = { ...defaultState(), ...(raw || {}) };
  const out = { ...merged };
  for (const key of Object.keys(out)) {
    if (typeof out[key] === "string") out[key] = trimInputText(out[key]);
  }
  for (const key of CURRENCY_KEYS) out[key] = out[key].toUpperCase();
  if (out.riskMode !== "amount") out.riskMode = "percent";
  if (out.totalType !== "trailing") out.totalType = "static";
  out.tags = { ...(merged.tags || {}) };
  return out;
}

const INSTRUMENT_TYPES = ["forex", "index", "metal", "crypto"];

// Currency codes Lotcheck recognises when it fills in a forex pair.
export const KNOWN_CURRENCIES = [
  "USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD", "SEK", "NOK", "DKK",
  "PLN", "CZK", "HUF", "TRY", "ZAR", "MXN", "SGD", "HKD", "CNH", "CNY",
];

const NON_FOREX_PREFIXES = ["XAU", "XAG", "XPT", "XPD", "BTC", "ETH"];

// The symbol in capitals, with everything that is not a letter or digit removed.
export function normalizeSymbol(symbol) {
  return String(symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// True when the symbol looks like a metal, crypto or index, not a forex pair.
export function looksNonForex(symbol) {
  const text = trimInputText(String(symbol || "")).toUpperCase();
  if (text === "") return false;
  if (/\d/.test(text)) return true;
  return NON_FOREX_PREFIXES.some((prefix) => text.startsWith(prefix));
}

export const SYMBOL_CAUTION =
  "This looks like a metal, crypto or index symbol. Choose that instrument type and enter the numbers from your platform.";

export const UNKNOWN_PAIR_CAUTION =
  "Lotcheck does not recognise this as a currency pair, so nothing is filled in for you. Check the instrument type and enter the numbers from your platform.";

// Typical values for a forex pair, only when the symbol starts with two known
// currency codes. Null otherwise.
export function forexDefaults(symbol) {
  const text = normalizeSymbol(symbol);
  const base = text.slice(0, 3);
  const quote = text.slice(3, 6);
  if (text.length < 6 || !KNOWN_CURRENCIES.includes(base) || !KNOWN_CURRENCIES.includes(quote)) return null;
  return {
    baseCurrency: base,
    quoteCurrency: quote,
    contractSize: "100000",
    pipSize: quote === "JPY" ? "0.01" : "0.0001",
    minLot: "0.01",
    lotStep: "0.01",
  };
}

// The caution shown under the symbol field, or null.
export function symbolCaution(state) {
  if (state.instrumentType !== "forex") return null;
  if (trimInputText(String(state.symbol || "")) === "") return null;
  if (forexDefaults(state.symbol) !== null) return null;
  if (looksNonForex(state.symbol)) return SYMBOL_CAUTION;
  return normalizeSymbol(state.symbol).length >= 6 ? UNKNOWN_PAIR_CAUTION : null;
}

// Fills the five forex fields from the symbol. A field the user has edited
// (no tag, not empty) is never overwritten. When the symbol stops being a
// 6-letter pair, fields that still carry a tag are cleared again.
export function applyForexPrefill(state) {
  const next = { ...state, tags: { ...(state.tags || {}) } };
  if (next.instrumentType !== "forex") return next;
  const defaults = forexDefaults(next.symbol);
  for (const key of PREFILL_KEYS) {
    const mayWrite = next.tags[key] === true || trimInputText(String(next[key])) === "";
    if (!mayWrite) continue;
    if (defaults) {
      next[key] = defaults[key];
      next.tags[key] = true;
    } else if (next.tags[key]) {
      next[key] = "";
      delete next.tags[key];
    }
  }
  return next;
}

// The conversion price and the pair choice belong to one pair of currencies.
export function pairKey(state) {
  return (
    trimInputText(String(state.accountCurrency || "")).toUpperCase() +
    "/" +
    trimInputText(String(state.quoteCurrency || "")).toUpperCase()
  );
}

// Clears what no longer belongs after a change: a conversion price typed for
// another pair, and trade prices and commission typed for another instrument.
function clearStale(prev, next, instrumentChanged) {
  const out = { ...next };
  if (pairKey(prev) !== pairKey(out)) {
    out.convPair = "";
    out.convPrice = "";
  }
  if (instrumentChanged) {
    out.entry = "";
    out.stop = "";
    out.extraDistance = "";
    out.commission = "";
    out.checked = false;
  }
  return out;
}

// The recognised pair of a symbol: its first six characters when they are
// two known currency codes, otherwise null. Changing from one recognised
// pair to another replaces every typical value, typed ones included.
export function recognisedPairKey(symbol) {
  const defaults = forexDefaults(symbol);
  return defaults ? defaults.baseCurrency + defaults.quoteCurrency : null;
}

// Replaces all typical values with those of the pair now in the symbol and
// clears the maximum lot, when the symbol moved to another recognised pair.
function replaceForNewPair(prev, next) {
  if (next.instrumentType !== "forex") return next;
  const key = recognisedPairKey(next.symbol);
  if (key === null || key === recognisedPairKey(prev.symbol)) return next;
  const defaults = forexDefaults(next.symbol);
  const out = { ...next, tags: { ...(next.tags || {}) } };
  for (const field of PREFILL_KEYS) {
    out[field] = defaults[field];
    out.tags[field] = true;
  }
  out.maxLot = "";
  delete out.tags.maxLot;
  return out;
}

// The user typed in a text field.
export function editField(state, key, value) {
  const next = { ...state, tags: { ...(state.tags || {}) } };
  let text = String(value);
  if (CURRENCY_KEYS.includes(key)) text = text.toUpperCase();
  next[key] = text;
  delete next.tags[key];
  // The account currency changes what the check line shows, so it unticks too.
  if (INSTRUMENT_KEYS.includes(key) || (key === "accountCurrency" && text !== state.accountCurrency)) next.checked = false;
  const symbolChanged = key === "symbol" && text !== state.symbol;
  const filled = key === "symbol" ? replaceForNewPair(state, applyForexPrefill(next)) : next;
  return clearStale(state, filled, symbolChanged);
}

// The user picked one of the radio options: the conversion pair, the risk
// mode or the type of total limit. A changed pair choice clears the price
// (a price typed for one pair is wrong for the other). A changed risk mode
// resets the number: "1" for percent of balance, empty for a fixed amount.
export function setChoice(state, key, value) {
  if (state[key] === value) return { ...state };
  const next = { ...state, tags: { ...(state.tags || {}) }, [key]: value };
  if (key === "convPair") next.convPrice = "";
  if (key === "riskMode") next.riskValue = value === "amount" ? "" : "1";
  return next;
}

// The user picked another instrument type.
export function setInstrumentType(state, type) {
  const next = { ...state, tags: { ...(state.tags || {}) } };
  next.instrumentType = INSTRUMENT_TYPES.includes(type) ? type : "forex";
  next.checked = false;
  const changed = next.instrumentType !== state.instrumentType;
  if (next.instrumentType === "forex") return clearStale(state, applyForexPrefill(next), changed);
  for (const key of PREFILL_KEYS) {
    if (next.tags[key]) {
      next[key] = "";
      delete next.tags[key];
    }
  }
  return clearStale(state, next, changed);
}

// ---------------------------------------------------------------------------
// Saving (only used when the user ticks "Remember my inputs")
// ---------------------------------------------------------------------------

// The text stored under STORAGE_KEY: only the fields in SAVED_KEYS (account
// currency, risk setting and instrument numbers) and the names of the
// pre-filled fields. Balance, prices, loss-limit fields and the "checked" box
// are never stored.
export function serializeState(state) {
  const copy = { ...defaultState(), ...state };
  const data = {};
  for (const key of SAVED_KEYS) data[key] = copy[key];
  const tags = [];
  for (const key of PREFILL_KEYS) if (copy.tags && copy.tags[key] === true) tags.push(key);
  data.tags = tags;
  return JSON.stringify(data);
}

// Reads stored text back into a state. Unknown keys and wrong types are
// dropped. Returns null when the text is not usable.
export function deserializeState(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return null;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const base = defaultState();
  const next = { ...base };
  for (const key of SAVED_KEYS) {
    if (!(key in data)) continue;
    if (typeof data[key] === typeof base[key]) next[key] = data[key];
  }
  if (!INSTRUMENT_TYPES.includes(next.instrumentType)) next.instrumentType = "forex";
  if (next.riskMode !== "amount") next.riskMode = "percent";
  next.tags = {};
  if (Array.isArray(data.tags)) {
    for (const key of data.tags) if (PREFILL_KEYS.includes(key)) next.tags[key] = true;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Formatting (Q.toFixed only; the direction of rounding is chosen per figure)
// ---------------------------------------------------------------------------

function decimalPlacesOf(q, fallback) {
  const dp = q.decimalPlaces();
  if (dp === null) return fallback;
  return Math.min(dp, 20);
}

// How many digits the user typed after the dot ("1.08500" is 5).
export function typedDecimals(text) {
  const dot = String(text).indexOf(".");
  return dot < 0 ? 0 : String(text).length - dot - 1;
}

// Money has 2 decimals, or 0 when the account currency is JPY.
export function formatMoney(q, currency, mode) {
  return q.toFixed(currency === "JPY" ? 0 : 2, mode);
}

// A money amount in text. An amount above 0 and below 1 that would show fewer
// than two significant digits (0.00, or 0.01 for 0.0100) shows its first two
// significant digits instead, rounded in the direction given.
export function moneyDisplay(q, currency, mode) {
  const shown = formatMoney(q, currency, mode);
  if (q.isPositive() && q.lt(Q.ONE)) {
    const digits = shown.replace(".", "").replace(/^0+/, "");
    if (digits.length < 2) return formatSignificant(q, 2, mode);
  }
  return shown;
}

export function moneyText(q, currency, mode) {
  return moneyDisplay(q, currency, mode) + " " + currency;
}

// Percentages: 2 decimals, rounded up.
export function formatPercent(q) {
  return q.toFixed(2, "up") + "%";
}

// Pips and points: 1 decimal, rounded down.
export function formatPips(q) {
  return q.toFixed(1, "down");
}

// A lot size is printed with the decimal places of the lot step, at least 2.
export function formatLots(q, stepQ) {
  const dp = Math.max(2, decimalPlacesOf(stepQ, 2));
  return q.toFixed(Math.min(dp, 20), "down");
}

// Decimal places needed to show `digits` significant digits of a positive
// value (0.00666 with 2 digits needs 4 places, 123.4 with 4 digits needs 1).
function placesForDigits(q, digits) {
  let places = digits;
  let scaled = q;
  const one = Q.of(1);
  if (q.gte(one)) {
    places = digits - 1;
    let limit = Q.of(10);
    while (q.gte(limit) && places > 0) {
      places -= 1;
      limit = limit.mul(10);
    }
    return places;
  }
  const tenth = Q.of("0.1");
  while (scaled.lt(tenth)) {
    scaled = scaled.mul(10);
    places += 1;
  }
  return places;
}

// A positive value rounded down to `digits` significant digits. It never
// prints as zero (a value too small for 20 places prints as "less than").
export function formatSignificant(q, digits, mode) {
  const places = placesForDigits(q, digits);
  if (places > 20) return "less than 0.00000000000000000001";
  return q.toFixed(places, mode || "down");
}

// An exchange rate: 6 significant digits, rounded down. Trailing zeros are
// trimmed, but never below 2 decimals.
export function formatRate(q) {
  const text = formatSignificant(q, 6);
  const dot = text.indexOf(".");
  if (dot < 0) return text;
  let end = text.length;
  while (end > dot + 3 && text[end - 1] === "0") end -= 1;
  return text.slice(0, end);
}

// ---------------------------------------------------------------------------
// Error messages in plain words
// ---------------------------------------------------------------------------

function rangeMessage(key, state) {
  switch (key) {
    case "riskValue":
      return state.riskMode === "amount"
        ? "Enter an amount above 0 and not more than your balance."
        : "Enter a percent above 0 and up to 100.";
    case "stop":
      return "The stop-loss must be above 0 and different from the entry price.";
    case "maxLot":
      return "The maximum lot must not be smaller than the minimum lot.";
    case "extraDistance":
      return "The extra distance is too large: the price after the stop would be 0 or less.";
    case "commission":
    case "openRisk":
    case "buffer":
      return "Enter 0 or more.";
    case "dailyPercent":
    case "totalPercent":
      return "Enter a percent above 0 and up to 100.";
    case "symbol":
      return "Use 1 to 20 characters.";
    case "accountCurrency":
    case "quoteCurrency":
      return "Use 3 to 5 capital letters or digits, for example EUR.";
    case "baseCurrency":
      return "The base currency must differ from the quote currency.";
    default:
      return "Enter a number above 0.";
  }
}

// Turns an InputError (or a parse problem) for one field into plain words.
export function messageForError(key, code, state) {
  if (code === "comma") return COMMA_MESSAGE;
  if (code === "empty") return "Enter a number.";
  if (code === "format") {
    if (key === "accountCurrency" || key === "quoteCurrency" || key === "baseCurrency") {
      return "Use 3 to 5 capital letters or digits, for example EUR.";
    }
    return PRICE_KEYS.includes(key)
      ? "Use digits and one dot only, for example 1.0850."
      : "Use digits and one dot only, for example 0.5.";
  }
  if (code === "range") return rangeMessage(key, state || defaultState());
  if (code === "not-on-step") return "The minimum lot must be a whole number of lot steps.";
  if (code === "conflict") {
    const plain = "The base currency does not match the symbol.";
    const s = state || defaultState();
    if (isCurrency(s.accountCurrency) && isCurrency(s.quoteCurrency)) {
      return plain + " For " + s.accountCurrency + s.quoteCurrency + " the base currency is " + s.accountCurrency + ".";
    }
    return plain;
  }
  if (code === "wrong-pair") return "That pair does not match your account and quote currencies.";
  if (code === "not-needed") return "No conversion is needed when both currencies are the same.";
  if (code === "required") return "Enter the conversion price.";
  return "Check this value.";
}

function keyForCoreField(field) {
  if (typeof field !== "string") return null;
  if (Object.prototype.hasOwnProperty.call(CORE_FIELD_TO_KEY, field)) return CORE_FIELD_TO_KEY[field];
  return null;
}

// ---------------------------------------------------------------------------
// Reading the form into core inputs
// ---------------------------------------------------------------------------

export function isCurrency(text) {
  return CURRENCY_PATTERN.test(text);
}

// True when the traded instrument is itself the pair of account currency and
// quote currency. The core decides this for every instrument type; the page
// asks the same helper with the same values it will send.
function ownPair(s) {
  return effectiveBaseCurrency(s.accountCurrency, instrumentValues(s)) === s.accountCurrency;
}

// The instrument values the core reads, from the form.
function instrumentValues(s) {
  return {
    symbol: s.symbol === "" ? "Instrument" : s.symbol,
    baseCurrency: nonEmpty(s.baseCurrency) ? s.baseCurrency : null,
    quoteCurrency: s.quoteCurrency,
  };
}

// True when the base currency is filled, differs from the account currency,
// and the symbol starts with account currency + quote currency.
export function baseConflict(state) {
  const s = cleanState(state);
  if (!isCurrency(s.accountCurrency) || !isCurrency(s.quoteCurrency) || !isCurrency(s.baseCurrency)) return false;
  if (s.baseCurrency === s.accountCurrency || s.baseCurrency === s.quoteCurrency) return false;
  if (s.accountCurrency === s.quoteCurrency) return false;
  return normalizeSymbol(s.symbol).startsWith(s.accountCurrency + s.quoteCurrency);
}

// Everything about the currency conversion that can be known from the form.
// source is "none" (same currency), "instrument" (the traded pair starts with
// the account currency, so the core uses its own prices) or "pair" (the user
// enters the price of a conversion pair).
export function conversionInfo(state) {
  const s = cleanState(state);
  const info = {
    source: "none",
    needed: false,
    accountQuote: null,
    quoteAccount: null,
    rate: null,
    sentence: null,
    input: null,
    complete: false,
  };
  if (!isCurrency(s.accountCurrency) || !isCurrency(s.quoteCurrency)) return info;
  if (s.accountCurrency === s.quoteCurrency) return info;
  if (baseConflict(s)) return info;
  if (ownPair(s)) {
    info.source = "instrument";
    return info;
  }
  info.source = "pair";
  info.needed = true;
  info.accountQuote = s.accountCurrency + s.quoteCurrency;
  info.quoteAccount = s.quoteCurrency + s.accountCurrency;
  if (s.convPair !== "account-quote" && s.convPair !== "quote-account") return info;
  if (s.convPrice === "") return info;
  let price;
  try {
    price = parseDecimal(s.convPrice, "convPrice");
  } catch (error) {
    return info;
  }
  if (!price.isPositive()) return info;
  if (s.convPair === "account-quote") {
    info.rate = Q.ONE.div(price);
    info.input = { base: s.accountCurrency, quote: s.quoteCurrency, price: s.convPrice };
  } else {
    info.rate = price;
    info.input = { base: s.quoteCurrency, quote: s.accountCurrency, price: s.convPrice };
  }
  info.sentence = "1 " + s.quoteCurrency + " = " + formatRate(info.rate) + " " + s.accountCurrency;
  info.complete = true;
  return info;
}

function nonEmpty(text) {
  return text !== "";
}

const DAILY_KEYS = ["dailyPercent", "dailyOf", "dailyStart"];

// The fields a total limit needs, and the ones that only start it.
function totalKeys(s) {
  return s.totalType === "trailing"
    ? { needed: ["totalPercent", "totalOf", "totalHigh"], optional: ["totalFloorCap"] }
    : { needed: ["totalPercent", "totalInitial"], optional: [] };
}

// True when the text is a number above 0.
function isAboveZero(text) {
  try {
    return parseDecimal(text, "x").isPositive();
  } catch (error) {
    return false;
  }
}

// A rule is "started" when any of its own fields has text, and "complete"
// when every required field parses and is above 0 (and an optional field that
// has text does too).
function ruleState(s, needed, optional) {
  const started = needed.concat(optional).some((key) => nonEmpty(s[key]));
  const missingKeys = needed.filter((key) => !nonEmpty(s[key]) || !isAboveZero(s[key]));
  for (const key of optional) if (nonEmpty(s[key]) && !isAboveZero(s[key])) missingKeys.push(key);
  const missing = missingKeys.map((key) => FIELD_LABELS[key]);
  return { started, complete: started && missing.length === 0, missing, missingKeys };
}

const UNFINISHED = {
  daily: "the daily limit",
  total: "the total limit",
};

// The status line of the loss-limits card (one of a fixed set of texts),
// from the state of the two rules: "none", "unfinished" or "complete".
export function guardStatusText(daily, total) {
  if (daily === "none" && total === "none") return "Not applied: no limit entered yet.";
  if (daily !== "unfinished" && total !== "unfinished") {
    if (daily === "complete" && total === "complete") return "Applied: daily limit and total limit.";
    return daily === "complete" ? "Applied: daily limit only." : "Applied: total limit only.";
  }
  if (daily === "complete") return "Applied: daily limit only. The total limit is not finished.";
  if (total === "complete") return "Applied: total limit only. The daily limit is not finished.";
  if (daily === "unfinished" && total === "unfinished") {
    return "Not applied yet: the daily limit and the total limit are not finished.";
  }
  return "Not applied yet: " + (daily === "unfinished" ? UNFINISHED.daily : UNFINISHED.total) + " is not finished.";
}

export const GUARD_NO_TEXT = "Not applied: you answered No.";

// Which loss-limit rules are started, which are complete, and what the
// screen and the result say about them. Loss limits count only when the
// answer to "Does your account have loss limits?" is Yes. With No, whatever
// is typed in the limit fields is kept but ignored completely.
export function guardInfo(state) {
  const s = cleanState(state);
  const info = { open: s.guardOpen, active: false, input: null, note: null, block: null };
  if (s.guardOpen !== true) {
    info.note = GUARD_NO_TEXT;
    return info;
  }
  const total = totalKeys(s);
  const daily = ruleState(s, DAILY_KEYS, []);
  const totalRule = ruleState(s, total.needed, total.optional);
  const equityMissing = !nonEmpty(s.equity);

  const sentences = [];
  for (const [name, rule] of [["daily", daily], ["total", totalRule]]) {
    if (!rule.started) continue;
    const list = rule.missing.slice();
    if (equityMissing) list.push(FIELD_LABELS.equity);
    if (list.length > 0) {
      if (info.focusKey === undefined) info.focusKey = equityMissing ? "equity" : rule.missingKeys[0];
      sentences.push("Finish or clear the " + name + " limit fields first. Still needed: " + list.join(", ") + ".");
    }
  }
  if (sentences.length > 0) info.block = sentences.join(" ");

  const stateOf = (rule) => (!rule.started ? "none" : rule.complete && !equityMissing ? "complete" : "unfinished");
  const dailyState = stateOf(daily);
  const totalState = stateOf(totalRule);
  info.note = guardStatusText(dailyState, totalState);

  const useDaily = dailyState === "complete";
  const useTotal = totalState === "complete";
  if (!useDaily && !useTotal) return info;
  let dailyInput = null;
  if (useDaily) {
    dailyInput = { limitPercent: s.dailyPercent, percentOf: s.dailyOf, dayStartValue: s.dailyStart };
  }
  let totalInput = null;
  if (useTotal) {
    if (s.totalType === "trailing") {
      totalInput = {
        type: "trailing",
        limitPercent: s.totalPercent,
        percentOf: s.totalOf,
        highWaterMark: s.totalHigh,
        floorCap: nonEmpty(s.totalFloorCap) ? s.totalFloorCap : null,
      };
    } else {
      totalInput = { type: "static", limitPercent: s.totalPercent, initialBalance: s.totalInitial };
    }
  }
  info.active = true;
  info.input = {
    currentEquity: s.equity,
    daily: dailyInput,
    total: totalInput,
    openRisk: nonEmpty(s.openRisk) ? s.openRisk : "0",
    buffer: nonEmpty(s.buffer) ? s.buffer : "0",
  };
  return info;
}

// The input object for calculatePositionSize. Values stay strings; the core
// does all parsing and range checks.
export function buildSizingInput(state) {
  const s = cleanState(state);
  const conv = conversionInfo(s);
  return {
    accountCurrency: s.accountCurrency,
    balance: s.balance,
    risk: { mode: s.riskMode, value: s.riskValue },
    instrument: {
      ...instrumentValues(s),
      contractSize: s.contractSize,
      pipSize: s.pipSize,
      minLot: s.minLot,
      lotStep: s.lotStep,
      maxLot: nonEmpty(s.maxLot) ? s.maxLot : null,
    },
    trade: {
      entry: s.entry,
      stop: s.stop,
      extraDistance: nonEmpty(s.extraDistance) ? s.extraDistance : "0",
    },
    conversion: conv.needed ? conv.input : null,
    commissionPerLot: nonEmpty(s.commission) ? s.commission : "0",
    leverage: nonEmpty(s.leverage) ? s.leverage : null,
    budgetCap: null,
  };
}

// The words for a missing-field message, in form order.
function missingLabels(s, conv) {
  const missing = [];
  const required = ["accountCurrency", "balance", "riskValue"];
  if (s.instrumentType === "forex") required.push("baseCurrency");
  required.push("quoteCurrency", "contractSize", "pipSize", "minLot", "lotStep");
  for (const key of required) if (s[key] === "") missing.push(FIELD_LABELS[key]);
  if (conv.needed) {
    if (s.convPair !== "account-quote" && s.convPair !== "quote-account") {
      missing.push(FIELD_LABELS.convPair);
    }
    if (s.convPrice === "") missing.push(FIELD_LABELS.convPrice);
  }
  for (const key of ["entry", "stop"]) if (s[key] === "") missing.push(FIELD_LABELS[key]);
  return missing;
}

// A pip or point value rounded down, never printed as zero.
export function pipValueText(q, currency) {
  return moneyDisplay(q, currency, "down");
}

// The check line in three parts: what 1 pip or point is worth for 1.00 lot.
// The value is shown large on the page. Null while it cannot be worked out.
export function checkLineParts(state) {
  const s = cleanState(state);
  if (!isCurrency(s.accountCurrency) || !isCurrency(s.quoteCurrency)) return null;
  if (baseConflict(s)) return null;
  let pip;
  let contract;
  try {
    pip = parseDecimal(s.pipSize, "pipSize");
    contract = parseDecimal(s.contractSize, "contractSize");
  } catch (error) {
    return null;
  }
  if (!pip.isPositive() || !contract.isPositive()) return null;
  let rate = Q.ONE;
  const conv = conversionInfo(s);
  if (conv.source === "pair") {
    if (!conv.complete) return null;
    rate = conv.rate;
  } else if (conv.source === "instrument") {
    // The instrument's own price is the conversion price: rate = 1 / entry.
    let entry;
    try {
      entry = parseDecimal(s.entry, "entry");
    } catch (error) {
      return null;
    }
    if (!entry.isPositive()) return null;
    rate = Q.ONE.div(entry);
  }
  const shown = pipValueText(pip.mul(contract).mul(rate), s.accountCurrency);
  return {
    lead: "With these numbers, 1.00 lot moving 1 pip/point (" + s.pipSize + ") is worth",
    value: shown + " " + s.accountCurrency,
    tail: "Compare this with your platform before you trust the result.",
  };
}

// The check line as one sentence.
export function checkLineText(state) {
  const parts = checkLineParts(state);
  if (parts === null) return null;
  return parts.lead + " " + parts.value + ". " + parts.tail;
}

// ---------------------------------------------------------------------------
// Building the result
// ---------------------------------------------------------------------------

function guardRows(room, currency) {
  const rows = [];
  if (room.dailyRoom !== null) rows.push(["Daily room", moneyText(room.dailyRoom, currency, "down")]);
  if (room.totalRoom !== null) rows.push(["Total room", moneyText(room.totalRoom, currency, "down")]);
  rows.push(["Minus open risk", moneyText(room.openRisk, currency, "up")]);
  rows.push(["Minus buffer", moneyText(room.buffer, currency, "up")]);
  rows.push(["Equals room for a new trade", moneyText(room.roomForNewTrade, currency, "down")]);
  return rows;
}

function noteTexts(notes, roomNotes) {
  const out = [];
  for (const code of (notes || []).concat(roomNotes || [])) if (NOTE_TEXTS[code]) out.push(NOTE_TEXTS[code]);
  return out;
}

// Turns the core's answer into the texts the page shows.
export function buildResultModel(state, size, room) {
  const s = cleanState(state);
  const currency = s.accountCurrency;
  const unit = s.instrumentType === "forex" ? "pips" : "points";
  const unitOne = s.instrumentType === "forex" ? "pip" : "point";
  const guard = room ? { rows: guardRows(room, currency) } : null;

  if (room && room.status === "breached") {
    return {
      kind: "breached",
      message: "Your equity is at or below a loss limit you entered.",
      rows: [],
      notes: noteTexts([], room.notes),
      guard,
    };
  }
  if (size.status === "no-budget") {
    return {
      kind: "no-budget",
      message: "No loss room left. Opening a new trade now could break your account rules.",
      rows: [],
      notes: noteTexts([], room && room.notes),
      guard,
    };
  }

  const minLot = parseDecimal(s.minLot, "minLot");
  const lotStep = parseDecimal(s.lotStep, "lotStep");

  if (size.status === "below-minimum") {
    const minText = minLot.toFixed(Math.min(20, Math.max(2, decimalPlacesOf(minLot, 2))), "down");
    return {
      kind: "below-minimum",
      message:
        "This trade is too big for your risk. The smallest size your broker allows (" +
        minText +
        " lots) would lose about " +
        moneyText(size.lossAtMinLot, currency, "up") +
        ", more than your limit of " +
        moneyText(size.riskBudget, currency, "down") +
        ". At this stop distance, no allowed size fits your risk. Lotcheck does not round up to the minimum.",
      rows: [],
      notes: noteTexts(size.notes, room && room.notes),
      guard,
    };
  }

  const priceDp = Math.min(
    20,
    Math.max(typedDecimals(s.entry), typedDecimals(s.stop), typedDecimals(s.extraDistance))
  );
  let pipsShown = formatPips(size.stopPips);
  if (/^0\.0$/.test(pipsShown) && size.stopPips.isPositive()) pipsShown = formatSignificant(size.stopPips, 2);
  let distance =
    pipsShown +
    " " +
    unit +
    " (" +
    size.priceDistance.toFixed(priceDp, "down") +
    " in price";
  const extra = size.stopDistance.sub(size.priceDistance);
  if (!extra.isZero()) distance += ", plus " + extra.toFixed(priceDp, "down") + " extra";
  distance += ")";

  const rows = [["Risk you asked for", moneyText(size.riskAmount, currency, "down")]];
  if (size.limitedBy !== "risk") {
    rows.push(["Loss budget used", moneyText(size.riskBudget, currency, "down")]);
  }
  rows.push(["Limited by", LIMITED_BY_TEXTS[size.limitedBy] || LIMITED_BY_TEXTS.risk]);
  if (s.guardOpen !== true) rows.push(["Loss limits", "Not applied"]);
  rows.push(["Stop distance", distance]);
  rows.push([
    "Value of one " + unitOne + " per 1.00 lot",
    pipValueText(size.pipValuePerLot, currency) + " " + currency,
  ]);
  if (size.commissionTotal.isPositive()) {
    rows.push(["Commission included", moneyText(size.commissionTotal, currency, "up")]);
  }
  if (size.margin !== null) rows.push(["Margin needed", moneyText(size.margin, currency, "up")]);

  return {
    kind: "ok",
    headline: formatLots(size.lots, lotStep) + " lots",
    lossLine:
      "If your stop is hit you lose about " +
      moneyText(size.actualRisk, currency, "up") +
      " (" +
      formatPercent(size.actualRiskPercent) +
      " of your balance)",
    rows,
    conversionNote:
      size.conversionSource === "instrument" ? INSTRUMENT_NOTE : size.conversionSource === "pair" ? PAIR_NOTE : null,
    notes: (size.stopPips.lt(Q.ONE) ? [STOP_CLOSE_NOTE] : []).concat(noteTexts(size.notes, room && room.notes)),
    guard,
  };
}

// ---------------------------------------------------------------------------
// The whole evaluation: form state in, everything the page shows out.
// ---------------------------------------------------------------------------

export function evaluate(state) {
  const s = cleanState(state);
  const errors = {};
  const conv = conversionInfo(s);
  const guard = guardInfo(s);
  const view = {
    errors,
    checkLine: checkLineText(s),
    checkParts: checkLineParts(s),
    conversion: conv,
    guard,
    result: null,
  };

  // Format problems are shown next to the field as soon as they appear.
  for (const key of CURRENCY_KEYS) {
    if (s[key] !== "" && !isCurrency(s[key])) errors[key] = messageForError(key, "format", s);
  }
  if (baseConflict(s)) errors.baseCurrency = messageForError("baseCurrency", "conflict", s);
  const numberKeys = MAIN_NUMBER_KEYS.slice();
  if (conv.needed) numberKeys.push("convPrice");
  if (s.guardOpen === true) {
    // The loss-limit fields are checked only when the answer is Yes. The
    // fields of the other kind of total limit are not checked.
    const hiddenKeys =
      s.totalType === "trailing" ? ["totalInitial"] : ["totalOf", "totalHigh", "totalFloorCap"];
    for (const key of GUARD_NUMBER_KEYS) if (!hiddenKeys.includes(key)) numberKeys.push(key);
  }
  for (const key of numberKeys) {
    if (s[key] === "") continue;
    if (s[key].includes("%")) {
      errors[key] = PERCENT_SIGN_MESSAGE;
      continue;
    }
    try {
      const value = parseDecimal(s[key], key);
      if (NON_NEGATIVE_KEYS.includes(key)) {
        if (value.isNegative()) errors[key] = "Enter 0 or more.";
      } else if (!value.isPositive()) {
        errors[key] = "Enter a number above 0.";
      }
    } catch (error) {
      if (error instanceof InputError) errors[key] = messageForError(key, error.code, s);
      else throw error;
    }
  }
  if ([...s.symbol].length > 20) errors.symbol = messageForError("symbol", "range", s);

  if (Object.keys(errors).length > 0) {
    view.result = {
      kind: "waiting",
      message: "Fix the fields marked above to see your lot size.",
      rows: [],
      notes: [],
      guard: null,
    };
    return view;
  }

  const missing = missingLabels(s, conv);
  if (missing.length > 0) {
    view.result = {
      kind: "waiting",
      message: "Your lot size will appear here. Still needed: " + missing.join(", ") + ".",
      rows: [],
      notes: [],
      guard: null,
    };
    return view;
  }

  if (!s.checked) {
    view.result = {
      kind: "need-check",
      message:
        "Check the numbers above in your platform, then tick \"I have checked these numbers in my platform\" to see a lot size.",
      rows: [],
      notes: [],
      guard: null,
    };
    return view;
  }

  if (guard.block) {
    view.result = { kind: "waiting", message: guard.block, rows: [], notes: [], guard: null };
    return view;
  }

  const sizingInput = buildSizingInput(s);
  try {
    let size;
    let room = null;
    if (guard.active) {
      const both = sizeWithGuard(sizingInput, guard.input);
      size = both.size;
      room = both.room;
    } else {
      size = calculatePositionSize(sizingInput);
    }
    view.result = buildResultModel(s, size, room);
    if (view.result.kind === "ok") view.result.caution = symbolCaution(s);
    if (view.result.guard && guard.active && guard.input.total && guard.input.total.type === "trailing") {
      view.result.guard.trailingNote = TRAILING_NOTE;
    }
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    const key = keyForCoreField(error.field);
    if (key !== null) {
      errors[key] = messageForError(key, error.code, s);
      view.result = {
        kind: "waiting",
        message: "Fix the fields marked above to see your lot size.",
        rows: [],
        notes: [],
        guard: null,
      };
    } else {
      view.result = {
        kind: "problem",
        message: "Lotcheck cannot work this out: " + error.message,
        rows: [],
        notes: [],
        guard: null,
      };
    }
  }
  return view;
}

// The labels the page shows for the conversion pair, from the form state.
export function conversionLabels(state) {
  const s = cleanState(state);
  const conv = conversionInfo(s);
  if (!conv.needed) return null;
  const chosen =
    s.convPair === "account-quote" ? conv.accountQuote : s.convPair === "quote-account" ? conv.quoteAccount : null;
  return {
    explain:
      "Your account is in " +
      s.accountCurrency +
      " but this instrument is paid in " +
      s.quoteCurrency +
      ". To turn " +
      s.quoteCurrency +
      " into " +
      s.accountCurrency +
      ", Lotcheck needs one exchange rate.",
    lookup: "Look up the price of " + conv.accountQuote + " or " + conv.quoteAccount + " in your platform.",
    accountQuote: conv.accountQuote + " (the price of 1 " + s.accountCurrency + " in " + s.quoteCurrency + ")",
    quoteAccount: conv.quoteAccount + " (the price of 1 " + s.quoteCurrency + " in " + s.accountCurrency + ")",
    priceLabel: chosen === null ? "Price of the pair" : "Price of " + chosen,
  };
}

export function riskLabel(state) {
  return state.riskMode === "amount"
    ? "Risk per trade (amount in your account currency)"
    : "Risk per trade (percent of balance)";
}

// ---------------------------------------------------------------------------
// The screens: which exist, what blocks leaving one, what the sentences say.
// Everything here is pure; the page only wires it to the document.
// ---------------------------------------------------------------------------

export const SCREEN_TITLES = {
  account: "Your account",
  instrument: "What you trade",
  conversion: "Currency conversion",
  trade: "Your trade",
  limits: "Loss limits",
  result: "Result",
};

// The four numbered steps, each opening on its first screen.
export const STEPS = [
  { screen: "account", label: "Account" },
  { screen: "instrument", label: "Instrument" },
  { screen: "trade", label: "Trade" },
  { screen: "result", label: "Result" },
];

// The step each screen belongs to (1 to 4).
const SCREEN_STEP = { account: 1, instrument: 2, conversion: 2, trade: 3, limits: 3, result: 4 };

export const TICK_MESSAGE = "Tick the box once you have compared the numbers.";
export const CONV_CHOICE_MESSAGE = "Choose which price you are entering.";
export const GUARD_EMPTY_MESSAGE = "Enter at least one complete limit, or go back and answer No.";

// The keys on each screen, in the order they appear on the page. "checked" is
// the tick, "convPair" the pair choice and "guard" the message about the
// limits as a whole.
const SCREEN_KEYS = {
  account: ["accountCurrency", "balance", "riskValue"],
  instrument: ["symbol", "baseCurrency", "quoteCurrency", "contractSize", "pipSize", "minLot", "lotStep", "maxLot", "checked"],
  conversion: ["convPair", "convPrice"],
  trade: ["entry", "stop", "extraDistance", "commission", "leverage"],
  limits: [
    "guard",
    "equity",
    "dailyPercent",
    "dailyOf",
    "dailyStart",
    "totalPercent",
    "totalInitial",
    "totalOf",
    "totalHigh",
    "totalFloorCap",
    "openRisk",
    "buffer",
  ],
};

// The instrument numbers behind "Change numbers".
const NUMBER_FIELD_KEYS = ["baseCurrency", "quoteCurrency", "contractSize", "pipSize", "minLot", "lotStep", "maxLot"];

// The screens that exist for this state, in order.
export function screensFor(state) {
  const screens = ["account", "instrument"];
  if (conversionLabels(state) !== null) screens.push("conversion");
  screens.push("trade");
  if (state.guardOpen === true) screens.push("limits");
  screens.push("result");
  return screens;
}

// The fields on a screen that must not be empty.
function requiredKeys(s, id) {
  if (id === "account") return ["accountCurrency", "balance", "riskValue"];
  if (id === "instrument") {
    const list = s.instrumentType === "forex" ? ["baseCurrency"] : [];
    return list.concat(["quoteCurrency", "contractSize", "pipSize", "minLot", "lotStep"]);
  }
  if (id === "conversion") return ["convPair", "convPrice"];
  if (id === "trade") return ["entry", "stop"];
  return [];
}

export function emptyMessage(key) {
  if (key === "convPair") return CONV_CHOICE_MESSAGE;
  return "Enter the " + FIELD_LABELS[key].toLowerCase() + ".";
}

export const SYMBOL_MESSAGE = "Enter a symbol, for example EURUSD.";

// True for a forex pair with no symbol and none of the seven instrument
// fields filled in: the first view of the instrument screen.
export function instrumentIsBlank(state) {
  const s = cleanState(state);
  return s.instrumentType === "forex" && normalizeSymbol(s.symbol) === "" && NUMBER_FIELD_KEYS.every((key) => s[key] === "");
}

// What stops the user from leaving a screen: a list of { key, message, live }
// in page order. "live" problems come from view.errors and show while typing;
// the others (an empty field, the tick, unfinished limits) show once Next was
// pressed on that screen. The result screen has no problems of its own.
export function screenProblems(state, view, id) {
  const keys = SCREEN_KEYS[id];
  if (!keys) return [];
  const s = cleanState(state);
  const errors = (view && view.errors) || {};
  if (id === "instrument" && instrumentIsBlank(s)) return [{ key: "symbol", message: SYMBOL_MESSAGE, live: false }];
  const required = requiredKeys(s, id);
  const out = [];
  for (const key of keys) {
    if (key === "checked") {
      if (errors.checked) out.push({ key, message: errors.checked, live: true });
      else if (!s.checked) out.push({ key, message: TICK_MESSAGE, live: false });
    } else if (key === "guard") {
      if (s.guardOpen !== true) continue;
      const info = guardInfo(s);
      if (info.block) out.push({ key, message: info.block, live: false, focus: info.focusKey });
      else if (!info.active) out.push({ key, message: GUARD_EMPTY_MESSAGE, live: false });
    } else if (errors[key]) {
      out.push({ key, message: errors[key], live: true });
    } else if (required.includes(key) && s[key] === "") {
      out.push({ key, message: emptyMessage(key), live: false });
    }
  }
  return out;
}

// The first screen before `before` (or before the result when `before` is
// null) that has a problem, or null.
export function firstScreenWithProblem(state, view, before) {
  for (const id of screensFor(state)) {
    if (id === before || id === "result") return null;
    if (screenProblems(state, view, id).length > 0) return id;
  }
  return null;
}

export function nextScreen(state, current) {
  const screens = screensFor(state);
  const at = screens.indexOf(current);
  return at >= 0 && at + 1 < screens.length ? screens[at + 1] : null;
}

export function prevScreen(state, current) {
  const screens = screensFor(state);
  const at = screens.indexOf(current);
  return at > 0 ? screens[at - 1] : null;
}

// The Back and Next buttons for a screen.
export function footerFor(state, current) {
  const next = nextScreen(state, current);
  return {
    showBack: current !== "account",
    nextLabel: current === "result" ? "New trade" : next === "result" ? "Show result" : "Next",
  };
}

// The four steps of the progress line: its state ("done", "now" or "todo"),
// whether it can be clicked, and the screen it opens. A step can be opened
// when it is before the current one, or when no screen before it has a problem.
export function progressSteps(state, view, current) {
  const now = SCREEN_STEP[current] || 1;
  return STEPS.map((step, index) => {
    const number = index + 1;
    const status = number < now ? "done" : number === now ? "now" : "todo";
    // The current step opens its main screen when another of its screens
    // (conversion, limits) is showing.
    let clickable = status === "done" || (status === "now" && current !== step.screen);
    if (status === "todo") clickable = firstScreenWithProblem(state, view, step.screen) === null;
    return { label: step.label, screen: step.screen, status, clickable };
  });
}

// What pressing Next (or a step in the progress line) does: the screen to
// show and the problems to show on it. A move towards the result is held
// until no earlier screen has a problem.
export function advance(state, view, current, target) {
  if (target === undefined) target = nextScreen(state, current);
  if (target === null) return { target: current, problems: screenProblems(state, view, current) };
  const screens = screensFor(state);
  const from = screens.indexOf(current);
  const to = screens.indexOf(target);
  if (to > from) {
    // A forward move stops at the first screen from here up to the target
    // that has a problem.
    for (let i = from; i < to; i++) {
      const problems = screenProblems(state, view, screens[i]);
      if (problems.length > 0) return { target: screens[i], problems };
    }
  }
  if (target === "result") {
    const blocked = firstScreenWithProblem(state, view, null);
    if (blocked !== null) return { target: blocked, problems: screenProblems(state, view, blocked) };
  }
  return { target, problems: [] };
}

// The screen to show after the state changed: the result gives way to an
// earlier screen that has a problem, and a screen that no longer exists gives
// way to a neighbour.
export function settleScreen(state, view, current) {
  if (current === "result") {
    const blocked = firstScreenWithProblem(state, view, null);
    return blocked === null ? "result" : blocked;
  }
  if (screensFor(state).includes(current)) return current;
  if (current === "limits") return "trade";
  if (current === "conversion") return "instrument";
  return "account";
}

// "New trade": clears the entry, the stop and the conversion price and keeps
// everything else, the tick included. Returns the new state and the screen to
// open.
export function startNewTrade(state) {
  let next = state;
  for (const key of ["entry", "stop", "convPrice"]) next = editField(next, key, "");
  return { state: next, screen: screensFor(next).includes("conversion") ? "conversion" : "trade" };
}

// The id of the control to focus for a problem key.
export function focusIdFor(key) {
  if (key === "convPair") return "conv-aq";
  if (key === "guard") return "f-equity";
  return "f-" + key;
}

// ---------------------------------------------------------------------------
// The instrument numbers: sentences and whether they are shown
// ---------------------------------------------------------------------------

// The line above the numbers.
export function numbersIntro(state) {
  const s = cleanState(state);
  const symbol = s.symbol.toUpperCase();
  const typical = PREFILL_KEYS.every((key) => s.tags[key] === true);
  if (typical) return "Typical values for " + symbol + ". Brokers differ.";
  return symbol === "" ? "Your numbers." : "Your numbers for " + symbol + ".";
}

// The two plain sentences, as lists of pieces. A piece with strong set is
// shown emphasised. The values are the typed text, not reformatted.
export function plainNumberLines(state) {
  const s = cleanState(state);
  const show = (text) => (text === "" ? "?" : text);
  const first = [
    { text: "1.00 lot is " },
    { text: show(s.contractSize) + " " + (s.baseCurrency === "" ? "units" : s.baseCurrency), strong: true },
  ];
  const second = [
    { text: "Sizes start at " },
    { text: show(s.minLot), strong: true },
    { text: " lot, in steps of " },
    { text: show(s.lotStep), strong: true },
  ];
  if (s.maxLot !== "") {
    second.push({ text: ", up to " });
    second.push({ text: s.maxLot, strong: true });
  }
  return [first, second];
}

// Whether the number fields are shown. They are forced open (and the toggle
// is hidden) when a number is missing or wrong or the base currency
// contradicts the symbol. Otherwise they are folded by default when every
// pre-filled number is still a typical value, and `choice` (true, false or
// null for none) is the user's last toggle.
export function numbersView(state, view, choice) {
  const s = cleanState(state);
  const errors = (view && view.errors) || {};
  const incomplete = requiredKeys(s, "instrument").some((key) => s[key] === "");
  const wrong = NUMBER_FIELD_KEYS.some((key) => errors[key]) || baseConflict(s);
  const forced = incomplete || wrong;
  const typical = PREFILL_KEYS.every((key) => s.tags[key] === true);
  const open = forced ? true : typeof choice === "boolean" ? choice : !typical;
  return { open, forced, canToggle: !forced, hidden: instrumentIsBlank(s) };
}

// ---------------------------------------------------------------------------
// The page. Everything below only runs when a document exists.
// ---------------------------------------------------------------------------

function byId(id) {
  return document.getElementById(id);
}

function makeNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function makeTable(rows) {
  const table = makeNode("table", "figures");
  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    const th = makeNode("th", "", row[0]);
    th.setAttribute("scope", "row");
    tr.appendChild(th);
    tr.appendChild(makeNode("td", "", row[1]));
    body.appendChild(tr);
  }
  table.appendChild(body);
  return table;
}

function renderResultInto(model) {
  const region = byId("result-region");
  const body = byId("result-body");
  body.replaceChildren();
  if (model === null) return;
  const stop = model.kind === "below-minimum" || model.kind === "no-budget" || model.kind === "breached";
  region.className = "result" + (stop ? " is-stop" : "") + (model.kind === "ok" ? " is-ok" : "");

  if (model.kind === "ok") {
    if (model.caution) body.appendChild(makeNode("p", "symbol-caution", model.caution));
    const headline = makeNode("p", "lots");
    const at = model.headline.lastIndexOf(" ");
    headline.appendChild(makeNode("span", "lots-number", model.headline.slice(0, at)));
    headline.appendChild(document.createTextNode(" "));
    headline.appendChild(makeNode("span", "lots-unit", model.headline.slice(at + 1)));
    body.appendChild(headline);
    body.appendChild(makeNode("p", "loss-line", model.lossLine));
    body.appendChild(makeTable(model.rows));
    if (model.conversionNote) body.appendChild(makeNode("p", "explain", model.conversionNote));
  } else if (stop) {
    body.appendChild(makeNode("p", "stop-box", model.message));
  } else {
    body.appendChild(makeNode("p", "waiting", model.message));
  }
  if (model.notes.length > 0) {
    const list = makeNode("ul", "cautions");
    for (const text of model.notes) list.appendChild(makeNode("li", "", text));
    body.appendChild(list);
  }
  if (model.guard) {
    body.appendChild(makeNode("p", "block-title", "Room under your loss limits"));
    body.appendChild(makeTable(model.guard.rows));
    if (model.guard.trailingNote) body.appendChild(makeNode("p", "explain", model.guard.trailingNote));
  }
}

function setHidden(id, hidden) {
  const node = byId(id);
  if (node) node.hidden = hidden;
}

function syncControls(state) {
  const nodes = document.querySelectorAll("[data-key]");
  for (const node of nodes) {
    const key = node.getAttribute("data-key");
    if (node.type === "radio") {
      node.checked = String(state[key]) === node.value;
    } else if (node.type === "checkbox") {
      node.checked = state[key] === true;
    } else if (node.value !== state[key]) {
      const at = node.selectionStart;
      node.value = state[key];
      if (document.activeElement === node && at !== null && node.setSelectionRange) {
        try {
          node.setSelectionRange(at, at);
        } catch (error) {
          // Some input types do not support selection. Nothing to do.
        }
      }
    }
  }
}

// The messages to show under fields: format and range errors always, and the
// "empty" kind of problem on every screen where Next was pressed.
function visibleMessages(state, view, ui) {
  const messages = {};
  for (const id of screensFor(state)) {
    if (!ui.attempted[id]) continue;
    for (const problem of screenProblems(state, view, id)) messages[problem.key] = problem.message;
  }
  return Object.assign(messages, view.errors);
}

function renderErrors(messages) {
  for (const node of document.querySelectorAll(".error")) {
    const key = node.id.slice(2);
    const message = messages[key];
    const input = byId("f-" + key);
    // Only rewrite the text when it changed, so a screen reader does not
    // announce the same error again on every keystroke.
    if (message) {
      if (node.textContent !== message) node.textContent = message;
      node.hidden = false;
      if (input) input.setAttribute("aria-invalid", "true");
    } else {
      if (node.textContent !== "") node.textContent = "";
      node.hidden = true;
      if (input) input.removeAttribute("aria-invalid");
    }
  }
}

function renderNumbers(state, view, ui) {
  byId("numbers-intro").textContent = numbersIntro(state);
  const list = byId("numbers-plain");
  list.replaceChildren();
  for (const line of plainNumberLines(state)) {
    const item = document.createElement("li");
    for (const piece of line) item.appendChild(piece.strong ? makeNode("b", "", piece.text) : document.createTextNode(piece.text));
    list.appendChild(item);
  }
  const shown = numbersView(state, view, ui.numbersChoice);
  byId("check-panel").hidden = shown.hidden;
  byId("numbers-edit").hidden = !shown.open;
  list.hidden = shown.open;
  const toggle = byId("b-numbers");
  toggle.hidden = !shown.canToggle;
  toggle.textContent = shown.open ? "Hide numbers" : "Change numbers";
  toggle.setAttribute("aria-expanded", shown.open ? "true" : "false");
}

function renderCheckLine(parts) {
  const box = byId("check-line");
  if (parts) {
    byId("check-lead").textContent = parts.lead;
    byId("check-value").textContent = parts.value;
    byId("check-tail").textContent = parts.tail;
    box.hidden = false;
  } else {
    byId("check-lead").textContent = "";
    byId("check-value").textContent = "";
    byId("check-tail").textContent = "";
    box.hidden = true;
  }
}

function renderProgress(state, view, ui) {
  const steps = progressSteps(state, view, ui.current);
  const buttons = document.querySelectorAll("#progress button");
  steps.forEach((step, index) => {
    const button = buttons[index];
    button.parentNode.className = step.status === "todo" ? "" : step.status;
    button.disabled = !step.clickable;
    if (step.status === "now") button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  });
  const number = SCREEN_STEP[ui.current];
  byId("step-count").textContent = "Step " + number + " of 4";
}

function renderPage(state, view, ui) {
  syncControls(state);
  renderErrors(visibleMessages(state, view, ui));

  // "typical value" tags.
  for (const key of PREFILL_KEYS) setHidden("t-" + key, state.tags[key] !== true);

  // Instrument type: help and confirmation.
  const forex = state.instrumentType === "forex";
  setHidden("nonforex-help", forex);
  byId("l-baseCurrency").textContent = forex ? "Base currency" : "Base currency (optional)";
  byId("h-baseCurrency").textContent = forex ? BASE_HINT_FOREX : BASE_HINT_OTHER;
  const caution = symbolCaution(state);
  const cautionNode = byId("c-symbol");
  cautionNode.textContent = caution || "";
  cautionNode.hidden = caution === null;
  renderNumbers(state, view, ui);
  renderCheckLine(view.checkParts);

  // Risk label.
  byId("l-riskValue").textContent = riskLabel(state);

  // Conversion.
  const labels = conversionLabels(state);
  const instrumentSource = view.conversion.source === "instrument";
  setHidden("conversion-instrument", !instrumentSource || state.instrumentType !== "forex");
  setHidden("conversion-instrument-other", !instrumentSource || state.instrumentType === "forex");
  if (labels !== null) {
    byId("conversion-explain").textContent = labels.explain;
    byId("conversion-lookup").textContent = labels.lookup;
    byId("conv-aq-text").textContent = labels.accountQuote;
    byId("conv-qa-text").textContent = labels.quoteAccount;
    byId("l-convPrice").textContent = labels.priceLabel;
  }
  const rate = byId("rate-line");
  if (view.conversion.sentence) {
    rate.textContent = view.conversion.sentence;
    rate.hidden = false;
  } else {
    rate.textContent = "";
    rate.hidden = true;
  }

  // Costs open by themselves when they hold a value or a mistake.
  const costs = byId("costs");
  if (!costs.open && ["extraDistance", "commission", "leverage"].some((key) => state[key] !== "" || view.errors[key])) {
    costs.open = true;
  }

  // Loss limits.
  const trailing = state.totalType === "trailing";
  setHidden("w-totalInitial", trailing);
  setHidden("w-totalOf", !trailing);
  setHidden("w-totalHigh", !trailing);
  setHidden("w-totalFloorCap", !trailing);
  setHidden("trailing-note", !trailing);
  byId("guard-status").textContent = view.guard.note || "";

  // Screens, header, footer bar.
  for (const node of document.querySelectorAll(".screen")) node.hidden = node.id !== ui.current;
  renderProgress(state, view, ui);
  const footer = footerFor(state, ui.current);
  byId("b-back").hidden = !footer.showBack;
  byId("b-next").textContent = footer.nextLabel;
  document.title = SCREEN_TITLES[ui.current] + " \u00b7 Lotcheck";

  // The lot size exists in the page only while the result screen is shown.
  renderResultInto(ui.current === "result" ? view.result : null);
}

function storageAvailable() {
  try {
    const store = window.localStorage;
    store.getItem(STORAGE_KEY);
    return true;
  } catch (error) {
    return false;
  }
}

function prefersReducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function startPage() {
  let state = defaultState();
  // Navigation is never saved: the page always opens on the first screen.
  const ui = { current: "account", attempted: {}, numbersChoice: null };
  const canStore = storageAvailable();
  const remember = byId("f-remember");
  const forget = byId("b-forget");
  const forgetStatus = byId("forget-status");
  const forgetStatusAccount = byId("forget-status-account");
  const savedNote = byId("saved-note");
  const forgetAccount = byId("b-forget-account");

  // The note on the first screen shows exactly while saving is on; the status
  // lines of both places always say the same.
  function syncSaved(message) {
    savedNote.hidden = !remember.checked;
    if (message !== undefined) {
      forgetStatus.textContent = message;
      forgetStatusAccount.textContent = message;
    }
  }

  if (!canStore) {
    remember.disabled = true;
    forget.disabled = true;
    forgetAccount.disabled = true;
    byId("remember-unavailable").hidden = false;
  } else {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved !== null) {
        const restored = deserializeState(saved);
        if (restored !== null) {
          state = restored;
          remember.checked = true;
        }
      }
    } catch (error) {
      // Reading failed. Start with an empty form.
    }
  }

  function save() {
    if (!canStore || !remember.checked) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, serializeState(state));
    } catch (error) {
      // Storage is full or blocked. The page keeps working in memory.
    }
  }

  function refresh() {
    let view = evaluate(state);
    // If a change made an earlier screen invalid, show that screen.
    const settled = settleScreen(state, view, ui.current);
    if (settled !== ui.current) {
      ui.attempted[settled] = true;
      ui.current = settled;
      view = evaluate(state);
    }
    renderPage(state, view, ui);
    save();
  }

  function clearSaved() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      // Nothing to remove.
    }
  }

  // Shows a screen. With problems, the first field with a problem is scrolled
  // into the middle and focused; otherwise the page scrolls to the top and the
  // heading of the screen gets the focus.
  function show(id, problems) {
    const changed = id !== ui.current;
    ui.current = id;
    if (problems.length > 0) ui.attempted[id] = true;
    refresh();
    const screen = byId(id);
    if (changed) {
      screen.classList.remove("enter");
      void screen.offsetWidth;
      screen.classList.add("enter");
    }
    const calm = prefersReducedMotion();
    const target = problems.length > 0 ? byId(focusIdFor(problems[0].focus || problems[0].key)) : null;
    if (target) {
      target.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
      target.focus({ preventScroll: true });
    } else if (changed) {
      window.scrollTo(0, 0);
      screen.querySelector("h1").focus({ preventScroll: true });
    }
  }

  function go(target) {
    const view = evaluate(state);
    const outcome = advance(state, view, ui.current, target);
    show(outcome.target, outcome.problems);
  }

  function onNext() {
    if (ui.current === "result") {
      const fresh = startNewTrade(state);
      state = fresh.state;
      ui.attempted = {};
      show(fresh.screen, []);
      return;
    }
    go(undefined);
  }

  function onBack() {
    const before = prevScreen(state, ui.current);
    if (before !== null) show(before, []);
  }

  const controls = document.querySelectorAll("[data-key]");
  for (const node of controls) {
    const key = node.getAttribute("data-key");
    if (node.type === "radio") {
      node.addEventListener("change", () => {
        if (!node.checked) return;
        if (key === "instrumentType") {
          state = setInstrumentType(state, node.value);
          ui.numbersChoice = null;
        } else if (key === "guardOpen") {
          state = setChoice(state, key, node.value === "true");
        } else {
          state = setChoice(state, key, node.value);
        }
        refresh();
      });
    } else if (node.type === "checkbox") {
      node.addEventListener("change", () => {
        state = { ...state, [key]: node.checked };
        refresh();
      });
    } else {
      node.addEventListener("input", () => {
        state = editField(state, key, node.value);
        if (key === "symbol") ui.numbersChoice = null;
        refresh();
      });
      node.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.isComposing) return;
        event.preventDefault();
        onNext();
      });
    }
  }

  byId("b-next").addEventListener("click", onNext);
  byId("b-back").addEventListener("click", onBack);
  byId("b-numbers").addEventListener("click", () => {
    const shown = numbersView(state, evaluate(state), ui.numbersChoice);
    ui.numbersChoice = !shown.open;
    refresh();
  });
  document.querySelectorAll("#progress button").forEach((button) => {
    button.addEventListener("click", () => go(button.getAttribute("data-go")));
  });

  remember.addEventListener("change", () => {
    syncSaved("");
    if (remember.checked) {
      save();
    } else {
      clearSaved();
    }
  });

  function forgetAll() {
    clearSaved();
    remember.checked = false;
    syncSaved("Saved inputs removed from this browser.");
  }
  forget.addEventListener("click", forgetAll);
  forgetAccount.addEventListener("click", forgetAll);

  syncSaved();
  refresh();
}

if (typeof document !== "undefined") {
  startPage();
}
