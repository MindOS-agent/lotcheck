import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { build, transformModule, assertNoDuplicates, topLevelNames, checkSyntax } from "../scripts/build.js";
import { Q, calculatePositionSize } from "../src/core/index.js";
import * as app from "../src/ui/app.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// The built page
// ---------------------------------------------------------------------------

const built = build();
const html = built.html;

function inlineScript() {
  const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(match, "inline module script found");
  return match[1];
}

function inlineStyle() {
  const match = html.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(match, "inline style found");
  return match[1];
}

function base64Hash(text) {
  return createHash("sha256").update(text, "utf8").digest("base64");
}

// The markup without the inline script and style.
function markupOnly() {
  return html.replace(/<script[\s\S]*?<\/script>/, "").replace(/<style[\s\S]*?<\/style>/, "");
}

test("the CSP meta tag is the first element in head", () => {
  const head = html.slice(html.indexOf("<head>") + "<head>".length);
  assert.match(head.trimStart(), /^<meta http-equiv="Content-Security-Policy" content="/);
});

test("the CSP names the hashes of the inline script and style", () => {
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)[1];
  assert.ok(csp.includes("default-src 'none'"));
  assert.ok(csp.includes("script-src 'sha256-" + base64Hash(inlineScript()) + "'"));
  assert.ok(csp.includes("style-src 'sha256-" + base64Hash(inlineStyle()) + "'"));
  assert.ok(csp.includes("img-src data:"));
  assert.ok(csp.includes("base-uri 'none'"));
  assert.ok(csp.includes("form-action 'none'"));
  assert.ok(!csp.includes("unsafe-inline"));
});

test("exactly one script element and one style element", () => {
  assert.equal((html.match(/<script/gi) || []).length, 1);
  assert.equal((html.match(/<style/gi) || []).length, 1);
  assert.match(html, /<script type="module">/);
});

test("the page contains no network or unsafe code", () => {
  assert.ok(!/https?:\/\//i.test(html), "no http:// or https://");
  assert.ok(!/http(?!-equiv)/i.test(html), "no other http text");
  assert.ok(!/(src|href|action|poster|srcset)\s*=\s*["']?\s*\/\//i.test(html), "no protocol-relative URL");
  assert.ok(!/url\(\s*["']?\s*\/\//i.test(html));
  assert.ok(!/@import/i.test(html));
  assert.ok(!/\burl\(/i.test(inlineStyle()), "no url() in the style");
  for (const text of [
    "fetch(",
    "XMLHttpRequest",
    "WebSocket",
    "sendBeacon",
    "innerHTML",
    "outerHTML",
    "insertAdjacentHTML",
    "eval(",
    "new Function",
    "document.write",
  ]) {
    assert.ok(!html.includes(text), "must not contain " + text);
  }
  assert.ok(!/\bimport\s*\(/.test(html), "no dynamic import");
});

test("no inline event-handler attributes and no src or href attributes", () => {
  const markup = markupOnly();
  assert.ok(!/\son[a-z]+\s*=/i.test(markup), "no on... attribute");
  assert.ok(!/\ssrc\s*=/i.test(markup));
  assert.ok(!/\shref\s*=/i.test(markup));
  assert.ok(!/<link\b/i.test(markup));
  assert.ok(!/\sstyle\s*=/i.test(markup), "no style attribute (the CSP would block it)");
});

test("building twice gives identical bytes", () => {
  const again = build();
  assert.equal(again.html, built.html);
  assert.equal(again.sha256, built.sha256);
});

test("dist/lotcheck.html and dist/SHA256SUMS match a fresh build", () => {
  const htmlPath = join(root, "dist", "lotcheck.html");
  const sumsPath = join(root, "dist", "SHA256SUMS");
  assert.ok(existsSync(htmlPath) && existsSync(sumsPath), "run npm run build first");
  const onDisk = readFileSync(htmlPath, "utf8");
  assert.equal(onDisk, built.html, "dist/lotcheck.html is out of date, run npm run build");
  const sums = readFileSync(sumsPath, "utf8");
  assert.equal(sums, createHash("sha256").update(onDisk, "utf8").digest("hex") + "  lotcheck.html\n");
  assert.equal(sums, built.sha256 + "  lotcheck.html\n");
});

test("the page has the required texts", () => {
  for (const text of [
    "Work out your position size before you trade. Runs on your device. Nothing is sent anywhere.",
    "Remember my inputs in this browser",
    "Forget saved inputs",
    "I have checked these numbers in my platform",
    "Does your account have loss limits?",
    "Rules differ between firms and change. Take every number from your own firm's current rules. Lotcheck ships no firm presets.",
    "typical value, check with your broker",
    "A stop-loss does not guarantee this loss. Gaps and slippage can make the real loss larger. Lotcheck does not give trading advice.",
    "Forex pair",
    "Metal or commodity",
  ]) {
    assert.ok(html.includes(text.replace(/'/g, "'")), "page text: " + text);
  }
  assert.ok(html.includes("Version " + JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version));
});

test("the inline script is built from the core and the app with no import or export left", () => {
  const script = inlineScript();
  assert.ok(!/^\s*import\b/m.test(script));
  assert.ok(!/^\s*export\b/m.test(script));
  assert.ok(script.includes("class Q"));
  assert.ok(script.includes("function calculatePositionSize"));
  assert.ok(script.includes("function calculateLossRoom"));
  assert.ok(script.includes("function evaluate"));
});

test("the page stores nothing except under the single lotcheck:v1 key", () => {
  const source = readFileSync(join(root, "src/ui/app.js"), "utf8");
  assert.equal(app.STORAGE_KEY, "lotcheck:v1");
  assert.equal((source.match(/localStorage/g) || []).length > 0, true);
  assert.ok(!/sessionStorage|indexedDB|document\.cookie/.test(source));
  const keys = source.match(/setItem\(([^,)]*)/g) || [];
  assert.deepEqual(keys, ["setItem(STORAGE_KEY"]);
});

// ---------------------------------------------------------------------------
// Markup: labels, descriptions, ids the script uses
// ---------------------------------------------------------------------------

function idsInMarkup() {
  return new Set([...markupOnly().matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
}

test("every text input and select has a label that points at it", () => {
  const markup = markupOnly();
  const ids = idsInMarkup();
  const controls = [...markup.matchAll(/<(input|select)\b[^>]*>/g)];
  assert.ok(controls.length > 20);
  for (const control of controls) {
    const tag = control[0];
    const id = tag.match(/\sid="([^"]+)"/);
    assert.ok(id, "control has an id: " + tag);
    assert.ok(
      new RegExp('<label[^>]*\\sfor="' + id[1] + '"').test(markup),
      "a label points at " + id[1]
    );
  }
  for (const label of markup.matchAll(/<label[^>]*\sfor="([^"]+)"/g)) {
    assert.ok(ids.has(label[1]), "label target exists: " + label[1]);
  }
});

test("every aria-describedby points at an existing id", () => {
  const ids = idsInMarkup();
  for (const match of markupOnly().matchAll(/aria-describedby="([^"]+)"/g)) {
    for (const id of match[1].split(/\s+/)) assert.ok(ids.has(id), "described by " + id);
  }
});

test("every error element has role alert", () => {
  const errors = [...markupOnly().matchAll(/<p class="error"[^>]*>/g)];
  assert.ok(errors.length > 20);
  for (const tag of errors) assert.match(tag[0], /role="alert"/);
});

test("the result card is a polite live region", () => {
  assert.match(markupOnly(), /<div class="result" id="result-region" aria-live="polite"/);
});

test("toggles are real radio inputs and the confirmation is a real checkbox", () => {
  const markup = markupOnly();
  assert.match(markup, /<input type="radio" id="risk-percent" name="riskMode" value="percent"/);
  assert.match(markup, /<input type="radio" id="risk-amount" name="riskMode" value="amount"/);
  assert.match(markup, /<input type="checkbox" id="f-checked"/);
  assert.match(markup, /<input type="checkbox" id="f-remember"/);
});

test("every id the script looks up exists in the page", () => {
  const ids = idsInMarkup();
  const source = readFileSync(join(root, "src/ui/app.js"), "utf8");
  for (const match of source.matchAll(/byId\("([^"]+)"\)/g)) {
    assert.ok(ids.has(match[1]), "id used by app.js: " + match[1]);
  }
  for (const key of app.PREFILL_KEYS) {
    assert.ok(ids.has("t-" + key), "tag element for " + key);
    assert.ok(ids.has("f-" + key));
  }
  // Every data-key in the page has a matching field in the state.
  const state = app.defaultState();
  for (const match of markupOnly().matchAll(/data-key="([^"]+)"/g)) {
    assert.ok(match[1] in state, "state has " + match[1]);
  }
  // Every error element belongs to a field.
  for (const match of markupOnly().matchAll(/id="e-([^"]+)"/g)) {
    // The pair choice, the loss limits as a whole and the tick have no text field
    // of their own named f-<key>; the pair choice is a group of radios.
    const own = match[1] === "guard" || match[1] === "convPair";
    assert.ok(own || ids.has("f-" + match[1]), "error element has a field: " + match[1]);
  }
});

test("input fields use text inputs with a decimal keyboard", () => {
  const markup = markupOnly();
  assert.match(markup, /<input id="f-balance"[^>]*type="text" inputmode="decimal" autocomplete="off"/);
  assert.ok(!/type="number"/.test(markup));
});

// ---------------------------------------------------------------------------
// The build step itself
// ---------------------------------------------------------------------------

test("transformModule removes imports and export keywords", () => {
  const source = [
    'import { Q } from "../core/rational.js";',
    'import {',
    "  a,",
    "  b",
    '} from "../core/sizing.js";',
    "export class Thing {}",
    "export function run() {}",
    "export const VALUE = 1;",
    "",
  ].join("\n");
  const out = transformModule(source, "src/ui/app.js");
  assert.ok(!out.includes("rational") && !out.includes("sizing"), "the import lines are gone");
  assert.ok(!/import|export/.test(out));
  assert.match(out, /^class Thing \{\}$/m);
  assert.match(out, /^function run\(\) \{\}$/m);
  assert.match(out, /^const VALUE = 1;$/m);
});

test("transformModule fails on a leftover import or export", () => {
  assert.throws(() => transformModule("export { a, b };\n", "x.js"), /leftover/);
  assert.throws(() => transformModule("export default function () {}\n", "x.js"), /leftover/);
  assert.throws(() => transformModule('export * from "../core/rational.js";\n', "src/ui/app.js"), /leftover/);
  assert.throws(() => transformModule('const a = await import("./x.js");\n', "x.js"), /dynamic import/);
  assert.throws(() => transformModule('import fs from "node:fs";\n', "x.js"), /unknown import/);
});

test("the build keeps comments in the script and the style", () => {
  const source = readFileSync(join(root, "src/ui/app.js"), "utf8");
  assert.ok(inlineScript().includes("// Lotcheck page logic."));
  const topComments = source.split("\n").filter((line) => /^\/\/ \S/.test(line));
  assert.ok(topComments.length > 5, "the page script has comments to check");
  for (const line of topComments) assert.ok(inlineScript().includes(line), "kept: " + line);
  assert.ok(inlineStyle().includes("/* Result */"));
  const text = transformModule("// keep me\nconst a = 1; // and me\n/* block */\nconst b = 2;\n", "x.js");
  assert.ok(text.includes("// keep me") && text.includes("// and me") && text.includes("/* block */"));
  assert.equal(
    transformModule("const s = '//';\nconst url = \"a /* b */ c\";\nconst n = 1;\n", "x.js"),
    "const s = '//';\nconst url = \"a /* b */ c\";\nconst n = 1;\n"
  );
});

test("the build sees every declarator of a multi-declarator statement", () => {
  assert.deepEqual(topLevelNames("const a = 1, b = (2, 3), c = [4, 5];\nlet d, e;\nconst f = 6;\n", "t"), [
    "a",
    "b",
    "c",
    "d",
    "e",
    "f",
  ]);
  assert.throws(
    () =>
      assertNoDuplicates([
        { name: "a.js", text: "function b() {}\n" },
        { name: "c.js", text: "const a = 1, b = 2;\n" },
      ]),
    /duplicate top-level name "b"/
  );
  assert.deepEqual(topLevelNames("const f = (x, y) => { return [x, y]; };\nconst g = 'a,b', h = `c,d`;\n", "t"), ["f", "g", "h"]);
});

test("a bundled file may not import from index.js", () => {
  assert.throws(() => transformModule('import { Q } from "../core/index.js";\n', "src/ui/app.js"), /unknown import/);
  assert.doesNotThrow(() => transformModule('import { Q } from "../core/rational.js";\n', "src/ui/app.js"));
  // The resolved path must match exactly, not just the file name.
  assert.throws(() => transformModule('import { Q } from "./evil/rational.js";\n', "src/ui/app.js"), /unknown import/);
  assert.throws(() => transformModule('import { Q } from "../core/sub/rational.js";\n', "src/ui/app.js"), /unknown import/);
  assert.doesNotThrow(() => transformModule('import { Q } from "./rational.js";\n', "src/core/sizing.js"));
});

test("the version in the page comes from package.json", () => {
  const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  assert.ok(html.includes("Version " + version));
  assert.ok(!html.includes("{{VERSION}}"));
});

test("the build fails on two top-level declarations with the same name", () => {
  const parts = [
    { name: "a.js", text: "function same() {}\n" },
    { name: "b.js", text: "const same = 1;\n" },
  ];
  assert.throws(() => assertNoDuplicates(parts), /duplicate top-level name "same"/);
  const fine = [
    { name: "a.js", text: "function one() {}\nclass Two {}\n" },
    { name: "b.js", text: "const three = 1;\nlet four;\n" },
  ];
  assert.doesNotThrow(() => assertNoDuplicates(fine));
  assert.deepEqual(topLevelNames("function one() {}\n  function inner() {}\nclass Two {}\nconst x = 1;\n", "t"), [
    "one",
    "Two",
    "x",
  ]);
  assert.throws(() => topLevelNames("const { a } = b;\n", "t"), /destructuring/);
});

// ---------------------------------------------------------------------------
// Rounding for display
// ---------------------------------------------------------------------------

test("money you can lose rounds up, money you have rounds down", () => {
  assert.equal(app.formatMoney(Q.of("100.001"), "USD", "up"), "100.01");
  assert.equal(app.formatMoney(Q.of("100.009"), "USD", "down"), "100.00");
  assert.equal(app.formatMoney(Q.of("100"), "USD", "up"), "100.00");
  assert.equal(app.formatMoney(Q.of("-0.001"), "USD", "down"), "-0.01");
});

test("a JPY account prints money with 0 decimals", () => {
  assert.equal(app.formatMoney(Q.of("100.5"), "JPY", "up"), "101");
  assert.equal(app.formatMoney(Q.of("100.5"), "JPY", "down"), "100");
  assert.equal(app.moneyText(Q.of("1000"), "JPY", "down"), "1000 JPY");
});

test("percentages round up to 2 decimals, pips round down to 1", () => {
  assert.equal(app.formatPercent(Q.of("1.001")), "1.01%");
  assert.equal(app.formatPercent(Q.of("1")), "1.00%");
  assert.equal(app.formatPips(Q.of("20.99")), "20.9");
  assert.equal(app.formatPips(Q.of("20")), "20.0");
});

test("lot sizes use the decimal places of the lot step, at least 2", () => {
  assert.equal(app.formatLots(Q.of("0.5"), Q.of("0.01")), "0.50");
  assert.equal(app.formatLots(Q.of("0.125"), Q.of("0.001")), "0.125");
  assert.equal(app.formatLots(Q.of("3"), Q.of("1")), "3.00");
  assert.equal(app.formatLots(Q.of("0.1"), Q.of("0.1")), "0.10");
});

test("exchange rates show up to 6 decimals, rounded down, at least 2 decimals", () => {
  assert.equal(app.formatRate(Q.ONE.div(Q.of("1.0850"))), "0.921658");
  assert.equal(app.formatRate(Q.of("0.9217")), "0.9217");
  assert.equal(app.formatRate(Q.of("1.27")), "1.27");
  assert.equal(app.formatRate(Q.of("2")), "2.00");
  assert.equal(app.formatRate(Q.ONE.div(Q.of("150"))), "0.00666666");
  assert.equal(app.formatRate(Q.of("123.456789")), "123.456");
  assert.equal(app.formatSignificant(Q.of("0.00666"), 2), "0.0066");
  assert.equal(app.formatSignificant(Q.of("0.000000000000000000001"), 2), "less than 0.00000000000000000001");
});

// ---------------------------------------------------------------------------
// Form state helpers
// ---------------------------------------------------------------------------

test("a 6-letter forex symbol pre-fills six fields and tags them", () => {
  let state = app.defaultState();
  state = app.editField(state, "symbol", "EURUSD");
  assert.equal(state.baseCurrency, "EUR");
  assert.equal(state.quoteCurrency, "USD");
  assert.equal(state.contractSize, "100000");
  assert.equal(state.pipSize, "0.0001");
  assert.equal(state.minLot, "0.01");
  assert.equal(state.lotStep, "0.01");
  for (const key of app.PREFILL_KEYS) assert.equal(state.tags[key], true, key + " is tagged");
  assert.equal(state.maxLot, "");
});

test("a JPY quote currency gets pip size 0.01", () => {
  const state = app.editField(app.defaultState(), "symbol", "usdjpy");
  assert.equal(state.quoteCurrency, "JPY");
  assert.equal(state.pipSize, "0.01");
});

test("editing a pre-filled field removes its tag and keeps the edit", () => {
  let state = app.editField(app.defaultState(), "symbol", "EURUSD");
  state = app.editField(state, "pipSize", "0.001");
  assert.equal(state.tags.pipSize, undefined);
  assert.equal(state.tags.minLot, true);
  state = app.editField(state, "symbol", "EURUSD.m");
  assert.equal(state.pipSize, "0.001", "an edited field is not overwritten on the same pair");
  state = app.editField(state, "symbol", "GBPJPY");
  assert.equal(state.pipSize, "0.01", "a new recognised pair replaces it");
  assert.equal(state.quoteCurrency, "JPY");
  assert.equal(state.tags.quoteCurrency, true);
  assert.equal(state.tags.pipSize, true);
});

test("a symbol that is not 6 letters clears fields that still carry a tag", () => {
  let state = app.editField(app.defaultState(), "symbol", "EURUSD");
  state = app.editField(state, "minLot", "0.1");
  state = app.editField(state, "symbol", "EURUS");
  assert.equal(state.quoteCurrency, "");
  assert.equal(state.contractSize, "");
  assert.equal(state.minLot, "0.1");
  assert.deepEqual(state.tags, {});
});

test("other instrument types are never pre-filled, and switching clears tagged values", () => {
  let state = app.setInstrumentType(app.defaultState(), "index");
  state = app.editField(state, "symbol", "EURUSD");
  assert.equal(state.contractSize, "");
  state = app.setInstrumentType(app.defaultState(), "forex");
  state = app.editField(state, "symbol", "EURUSD");
  state = app.setInstrumentType(state, "metal");
  assert.equal(state.contractSize, "");
  assert.deepEqual(state.tags, {});
});

test("changing any instrument field unticks the confirmation", () => {
  for (const key of ["symbol", "quoteCurrency", "contractSize", "pipSize", "minLot", "lotStep", "maxLot"]) {
    const state = app.editField({ ...app.defaultState(), checked: true }, key, "1");
    assert.equal(state.checked, false, key);
  }
  assert.equal(app.setInstrumentType({ ...app.defaultState(), checked: true }, "crypto").checked, false);
  assert.equal(app.editField({ ...app.defaultState(), checked: true }, "entry", "1").checked, true);
  // The account currency changes the value in the check line, so it unticks as well.
  assert.equal(app.editField({ ...app.defaultState(), accountCurrency: "EUR", checked: true }, "accountCurrency", "GBP").checked, false);
  assert.equal(app.editField({ ...app.defaultState(), accountCurrency: "EUR", checked: true }, "accountCurrency", "eur").checked, true);
  assert.equal(app.editField({ ...app.defaultState(), checked: true }, "balance", "5000").checked, true);
});

test("currency fields are uppercased as the user types", () => {
  const state = app.editField(app.editField(app.defaultState(), "accountCurrency", "eur"), "quoteCurrency", "usd");
  assert.equal(state.accountCurrency, "EUR");
  assert.equal(state.quoteCurrency, "USD");
});

test("saved state round-trips, and never stores the confirmation", () => {
  let state = app.editField(app.defaultState(), "symbol", "EURUSD");
  state = {
    ...state,
    accountCurrency: "USD",
    balance: "10000",
    entry: "1.1",
    stop: "1.0",
    extraDistance: "0.1",
    convPair: "account-quote",
    convPrice: "1.2",
    equity: "9000",
    dailyPercent: "5",
    guardOpen: true,
    commission: "7",
    leverage: "30",
    maxLot: "50",
    checked: true,
    riskMode: "amount",
    riskValue: "50",
  };
  const text = app.serializeState(state);
  assert.ok(!text.includes("checked"));
  const saved = JSON.parse(text);
  assert.deepEqual(
    Object.keys(saved).sort(),
    [...app.SAVED_KEYS, "tags"].sort(),
    "only the documented fields are saved"
  );
  assert.deepEqual(
    Object.keys(saved).sort(),
    [
      "accountCurrency",
      "baseCurrency",
      "contractSize",
      "instrumentType",
      "leverage",
      "lotStep",
      "maxLot",
      "minLot",
      "pipSize",
      "quoteCurrency",
      "riskMode",
      "riskValue",
      "symbol",
      "tags",
    ].sort(),
    "exactly the fields named in the hint under the checkbox"
  );
  for (const key of ["balance", "entry", "stop", "extraDistance", "commission", "convPair", "convPrice", "equity", "dailyPercent", "guardOpen", "checked"]) {
    assert.ok(!(key in saved), key + " is never saved");
  }
  const back = app.deserializeState(text);
  assert.equal(back.balance, "");
  assert.equal(back.commission, "", "commission is never restored");
  assert.equal(back.leverage, "30");
  assert.equal(back.baseCurrency, "EUR");
  assert.equal(back.riskMode, "amount");
  assert.equal(back.checked, false);
  assert.equal(back.tags.quoteCurrency, true);
});

test("restoring saved state drops unknown keys, wrong types and bad text", () => {
  assert.equal(app.deserializeState("not json"), null);
  assert.equal(app.deserializeState("[1,2]"), null);
  assert.equal(app.deserializeState("null"), null);
  const back = app.deserializeState(
    JSON.stringify({ accountCurrency: 5, balance: "1", commission: "1.2", leverage: "10", evil: "x", riskMode: "weird", instrumentType: "nope", tags: ["pipSize", "evil"] })
  );
  assert.equal(back.accountCurrency, "");
  assert.equal(back.balance, "", "balance is not a saved field");
  assert.equal(back.commission, "", "an older stored commission is ignored");
  assert.equal(back.leverage, "10");
  assert.equal(back.evil, undefined);
  assert.equal(back.riskMode, "percent");
  assert.equal(back.instrumentType, "forex");
  assert.deepEqual(back.tags, { pipSize: true });
});

// ---------------------------------------------------------------------------
// Reading the form into core inputs
// ---------------------------------------------------------------------------

function usdForex(extra) {
  const symbol = (extra && extra.symbol) || "EURUSD";
  return {
    ...app.editField(app.defaultState(), "symbol", symbol),
    accountCurrency: "USD",
    balance: "10000",
    riskValue: "1",
    entry: "1.08500",
    stop: "1.08300",
    checked: true,
    ...extra,
    symbol,
  };
}

test("the state maps to a core input with strings, nulls and defaults", () => {
  const input = app.buildSizingInput(usdForex({}));
  assert.deepEqual(input, {
    accountCurrency: "USD",
    balance: "10000",
    risk: { mode: "percent", value: "1" },
    instrument: {
      symbol: "EURUSD",
      baseCurrency: "EUR",
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
  });
  const full = app.buildSizingInput(
    usdForex({ maxLot: "50", extraDistance: "0.0002", commission: "7", leverage: "30", riskMode: "amount", riskValue: "75" })
  );
  assert.equal(full.instrument.maxLot, "50");
  assert.equal(full.trade.extraDistance, "0.0002");
  assert.equal(full.commissionPerLot, "7");
  assert.equal(full.leverage, "30");
  assert.deepEqual(full.risk, { mode: "amount", value: "75" });
});

test("a different account currency builds the conversion for either pair choice", () => {
  const eur = usdForex({ symbol: "GBPUSD", accountCurrency: "EUR", convPair: "account-quote", convPrice: "1.0850" });
  assert.deepEqual(app.buildSizingInput(eur).conversion, { base: "EUR", quote: "USD", price: "1.0850" });
  const other = usdForex({ symbol: "GBPUSD", accountCurrency: "EUR", convPair: "quote-account", convPrice: "0.9217" });
  assert.deepEqual(app.buildSizingInput(other).conversion, { base: "USD", quote: "EUR", price: "0.9217" });
});

test("the loss-limit input uses only rules that are filled in completely", () => {
  const base = usdForex({ guardOpen: true });
  // With the answer No the fields are ignored completely.
  const closed = { ...base, guardOpen: false, equity: "9800", dailyPercent: "5", dailyOf: "10000", dailyStart: "10000" };
  assert.equal(app.guardInfo(closed).active, false);
  assert.equal(app.guardInfo(closed).note, "Not applied: you answered No.");
  assert.equal(app.guardInfo(closed).block, null);
  assert.equal(app.guardInfo(base).active, false);
  assert.equal(app.guardInfo(base).note, "Not applied: no limit entered yet.");
  assert.equal(app.guardInfo(base).block, null);
  const daily = app.guardInfo({ ...base, equity: "9800", dailyPercent: "5", dailyOf: "10000", dailyStart: "10000" });
  assert.equal(daily.active, true);
  assert.equal(daily.note, "Applied: daily limit only.");
  assert.deepEqual(daily.input, {
    currentEquity: "9800",
    daily: { limitPercent: "5", percentOf: "10000", dayStartValue: "10000" },
    total: null,
    openRisk: "0",
    buffer: "0",
  });
  const trailing = app.guardInfo({
    ...base,
    equity: "9800",
    totalType: "trailing",
    totalPercent: "10",
    totalOf: "10000",
    totalHigh: "10400",
    totalFloorCap: "10000",
    openRisk: "20",
    buffer: "5",
  });
  assert.equal(trailing.note, "Applied: total limit only.");
  assert.deepEqual(trailing.input.total, {
    type: "trailing",
    limitPercent: "10",
    percentOf: "10000",
    highWaterMark: "10400",
    floorCap: "10000",
  });
  assert.equal(trailing.input.daily, null);
  assert.equal(trailing.input.openRisk, "20");
  const staticTotal = app.guardInfo({ ...base, equity: "9800", totalPercent: "10", totalInitial: "10000" });
  assert.deepEqual(staticTotal.input.total, { type: "static", limitPercent: "10", initialBalance: "10000" });
  const both = app.guardInfo({
    ...base,
    equity: "9800",
    dailyPercent: "5",
    dailyOf: "10000",
    dailyStart: "10000",
    totalPercent: "10",
    totalInitial: "10000",
  });
  assert.equal(both.note, "Applied: daily limit and total limit.");
});

test("a half-filled loss rule is never dropped silently", () => {
  const view = app.evaluate(
    usdForex({
      guardOpen: true,
      equity: "10000",
      dailyPercent: "5",
      dailyOf: "",
      dailyStart: "10000",
      totalPercent: "10",
      totalInitial: "10000",
    })
  );
  assert.equal(view.result.kind, "waiting");
  assert.equal(
    view.result.message,
    "Finish or clear the daily limit fields first. Still needed: Daily limit: percent of this amount."
  );
  assert.equal(view.result.headline, undefined);
  assert.equal(view.guard.note, "Applied: total limit only. The daily limit is not finished.");
  const noEquity = app.evaluate(usdForex({ guardOpen: true, totalPercent: "10", totalInitial: "10000" }));
  assert.equal(
    noEquity.result.message,
    "Finish or clear the total limit fields first. Still needed: Current equity."
  );
  const trailing = app.evaluate(
    usdForex({ guardOpen: true, equity: "9000", totalType: "trailing", totalPercent: "10", totalFloorCap: "9000" })
  );
  assert.equal(
    trailing.result.message,
    "Finish or clear the total limit fields first. Still needed: Total limit: percent of this amount, Highest value reached."
  );
  const bothHalf = app.evaluate(usdForex({ guardOpen: true, equity: "9000", dailyStart: "1", totalPercent: "5" }));
  assert.match(bothHalf.result.message, /daily limit fields first.*total limit fields first/);
  // Clearing the started fields makes the rule not started, and a lot size shows again.
  const cleared = app.evaluate(usdForex({ guardOpen: true, equity: "10000" }));
  assert.equal(cleared.result.kind, "ok");
  assert.equal(cleared.guard.note, "Not applied: no limit entered yet.");
  // With the answer No a started rule does not block.
  assert.equal(app.evaluate(usdForex({ guardOpen: false, dailyPercent: "5" })).result.kind, "ok");
});

// ---------------------------------------------------------------------------
// Results: every status, each text
// ---------------------------------------------------------------------------

test("an empty form waits and names what is missing", () => {
  const view = app.evaluate(app.defaultState());
  assert.equal(view.result.kind, "waiting");
  assert.match(view.result.message, /Still needed: Account currency, Account balance/);
  assert.deepEqual(view.errors, {});
  assert.equal(view.checkLine, null);
});

test("status ok: the lot size, the loss line, the table", () => {
  const view = app.evaluate(usdForex({}));
  const r = view.result;
  assert.equal(r.kind, "ok");
  assert.equal(r.headline, "0.50 lots");
  assert.equal(r.lossLine, "If your stop is hit you lose about 100.00 USD (1.00% of your balance)");
  const rows = Object.fromEntries(r.rows);
  assert.equal(rows["Risk you asked for"], "100.00 USD");
  assert.equal(rows["Limited by"], "Your risk setting");
  assert.equal(rows["Stop distance"], "20.0 pips (0.00200 in price)");
  assert.equal(rows["Value of one pip per 1.00 lot"], "10.00 USD");
  assert.equal(rows["Commission included"], undefined, "no commission row when the commission is 0");
  assert.equal(rows["Margin needed"], undefined);
  assert.deepEqual(r.notes, ["Spread and slippage are not included.", "Commission is not included."]);
  assert.equal(r.guard, null);
});

test("status ok with leverage, extra distance and commission", () => {
  const view = app.evaluate(usdForex({ leverage: "30", extraDistance: "0.0002", commission: "7" }));
  const r = view.result;
  assert.equal(r.kind, "ok");
  const rows = Object.fromEntries(r.rows);
  assert.match(rows["Margin needed"], /^\d+\.\d\d USD$/);
  assert.equal(rows["Stop distance"], "20.0 pips (0.00200 in price, plus 0.00020 extra)");
  assert.deepEqual(r.notes, []);
  const core = calculatePositionSize(app.buildSizingInput(usdForex({ leverage: "30", extraDistance: "0.0002", commission: "7" })));
  assert.equal(rows["Margin needed"], core.margin.toFixed(2, "up") + " USD");
  assert.equal(r.headline, core.lots.toFixed(2, "down") + " lots");
});

test("status below-minimum: no lot size, the exact text, never a suggestion to risk more", () => {
  const view = app.evaluate(usdForex({ balance: "1000", entry: "1.1", stop: "1.0" }));
  assert.equal(view.result.kind, "below-minimum");
  assert.equal(
    view.result.message,
    "This trade is too big for your risk. The smallest size your broker allows (0.01 lots) would lose about 100.00 USD, more than your limit of 10.00 USD. At this stop distance, no allowed size fits your risk. Lotcheck does not round up to the minimum."
  );
  assert.ok(!view.result.message.includes("closer stop"));
  assert.equal(view.result.headline, undefined);
  assert.ok(!/raise|increase|more risk/i.test(view.result.message));
});

test("status no-budget and breached use their texts and show no lot size", () => {
  const guardState = usdForex({
    guardOpen: true,
    equity: "9501",
    dailyPercent: "5",
    dailyOf: "10000",
    dailyStart: "10000",
    buffer: "1",
  });
  const noRoom = app.evaluate(guardState).result;
  assert.equal(noRoom.kind, "no-budget");
  assert.equal(noRoom.message, "No loss room left. Opening a new trade now could break your account rules.");
  assert.equal(noRoom.headline, undefined);
  const breached = app.evaluate({ ...guardState, equity: "9500", buffer: "" }).result;
  assert.equal(breached.kind, "breached");
  assert.equal(breached.message, "Your equity is at or below a loss limit you entered.");
  assert.equal(breached.headline, undefined);
  assert.ok(breached.guard, "room figures are still shown");
});

test("the loss-limit block shows each room and the room for a new trade", () => {
  const view = app.evaluate(
    usdForex({
      guardOpen: true,
      equity: "9800",
      dailyPercent: "5",
      dailyOf: "10000",
      dailyStart: "10000",
      totalPercent: "10",
      totalInitial: "10000",
      openRisk: "50.001",
      buffer: "25",
    })
  );
  assert.equal(view.result.kind, "ok");
  assert.deepEqual(view.result.guard.rows, [
    ["Daily room", "300.00 USD"],
    ["Total room", "800.00 USD"],
    ["Minus open risk", "50.01 USD"],
    ["Minus buffer", "25.00 USD"],
    ["Equals room for a new trade", "224.99 USD"],
  ]);
  const rows = Object.fromEntries(view.result.rows);
  assert.equal(rows["Limited by"], "Your risk setting");
});

test("a loss limit that binds is named, and the budget used is shown", () => {
  const view = app.evaluate(
    usdForex({ guardOpen: true, equity: "9550", dailyPercent: "5", dailyOf: "10000", dailyStart: "10000" })
  );
  assert.equal(view.result.kind, "ok");
  assert.equal(view.result.headline, "0.25 lots");
  const rows = Object.fromEntries(view.result.rows);
  assert.equal(rows["Limited by"], "Your daily loss limit");
  assert.equal(rows["Loss budget used"], "50.00 USD");
  const total = app.evaluate(
    usdForex({ guardOpen: true, equity: "9550", totalPercent: "10", totalInitial: "10000", buffer: "480" })
  );
  assert.equal(Object.fromEntries(total.result.rows)["Limited by"], "Your total loss limit");
});

test("each caution text appears for its note", () => {
  const risky = app.evaluate(usdForex({ riskValue: "3", maxLot: "0.5", leverage: "1", commission: "1" }));
  assert.equal(risky.result.kind, "ok");
  assert.deepEqual(risky.result.notes, [
    "Limited to your broker's maximum lot size.",
    "You are risking more than 2% of the account on one trade.",
    "Spread and slippage are not included.",
    "The margin for this size is more than your balance.",
  ]);
  assert.equal(app.NOTE_TEXTS["no-spread-entered"], "Spread and slippage are not included.");
  assert.equal(app.NOTE_TEXTS["no-commission-entered"], "Commission is not included.");
  assert.deepEqual(Object.keys(app.NOTE_TEXTS).filter((key) => key.includes("cost-entered")), []);
});

test("a JPY account shows whole numbers", () => {
  const state = {
    ...app.editField(app.defaultState(), "symbol", "USDJPY"),
    accountCurrency: "JPY",
    balance: "1000000",
    entry: "150.00",
    stop: "149.50",
    checked: true,
  };
  const view = app.evaluate(state);
  assert.equal(view.result.kind, "ok");
  assert.equal(view.result.headline, "0.20 lots");
  assert.equal(view.result.lossLine, "If your stop is hit you lose about 10000 JPY (1.00% of your balance)");
  assert.equal(Object.fromEntries(view.result.rows)["Value of one pip per 1.00 lot"], "1000 JPY");
  assert.equal(view.checkLine.includes("is worth 1000 JPY."), true);
});

test("non-forex types show no lot size until the numbers are confirmed", () => {
  let state = {
    ...app.setInstrumentType(app.defaultState(), "index"),
    accountCurrency: "USD",
    balance: "10000",
    symbol: "US500",
    quoteCurrency: "USD",
    contractSize: "1",
    pipSize: "1",
    minLot: "0.1",
    lotStep: "0.1",
    entry: "5000",
    stop: "4980",
  };
  let view = app.evaluate(state);
  assert.equal(view.result.kind, "need-check");
  assert.ok(view.checkLine, "the check line shows before the box is ticked");
  assert.equal(view.result.headline, undefined);
  state = { ...state, checked: true };
  view = app.evaluate(state);
  assert.equal(view.result.kind, "ok");
  assert.equal(view.result.headline, "5.00 lots");
  const rows = Object.fromEntries(view.result.rows);
  assert.equal(rows["Stop distance"], "20.0 points (20 in price)");
  assert.equal(rows["Value of one point per 1.00 lot"], "1.00 USD");
  state = app.editField(state, "contractSize", "2");
  assert.equal(app.evaluate(state).result.kind, "need-check");
});

test("the check line gives the pip value and uses the conversion rate", () => {
  const same = app.evaluate(usdForex({}));
  assert.equal(
    same.checkLine,
    "With these numbers, 1.00 lot moving 1 pip/point (0.0001) is worth 10.00 USD. Compare this with your platform before you trust the result."
  );
  const partial = { ...app.editField(app.defaultState(), "symbol", "EURUSD"), accountCurrency: "EUR" };
  assert.equal(app.evaluate(partial).checkLine, null, "needs the conversion first");
  const eur = usdForex({ accountCurrency: "EUR", convPair: "account-quote", convPrice: "1.0850" });
  const view = app.evaluate(eur);
  assert.match(view.checkLine, /is worth 9\.21 EUR\./);
  const core = calculatePositionSize(app.buildSizingInput(eur));
  assert.equal(view.checkLine.includes(core.pipValuePerLot.toFixed(2, "down") + " EUR"), true);
  assert.equal(app.evaluate(app.defaultState()).checkLine, null);
});

test("the conversion sentence points the right way for both pair choices", () => {
  const aq = app.conversionInfo(
    usdForex({ symbol: "GBPUSD", accountCurrency: "EUR", convPair: "account-quote", convPrice: "1.0850" })
  );
  assert.equal(aq.needed, true);
  assert.equal(aq.source, "pair");
  assert.equal(aq.sentence, "1 USD = 0.921658 EUR");
  const qa = app.conversionInfo(
    usdForex({ symbol: "GBPUSD", accountCurrency: "EUR", convPair: "quote-account", convPrice: "0.9217" })
  );
  assert.equal(qa.sentence, "1 USD = 0.9217 EUR");
  const gbp = app.conversionInfo({
    ...app.defaultState(),
    accountCurrency: "USD",
    quoteCurrency: "GBP",
    convPair: "quote-account",
    convPrice: "1.2700",
  });
  assert.equal(gbp.sentence, "1 GBP = 1.27 USD");
  const jpy = app.conversionInfo({
    ...app.defaultState(),
    accountCurrency: "USD",
    quoteCurrency: "JPY",
    convPair: "account-quote",
    convPrice: "150",
  });
  assert.equal(jpy.sentence, "1 JPY = 0.00666666 USD");
  const none = app.conversionInfo(usdForex({}));
  assert.equal(none.needed, false);
  assert.equal(none.source, "none");
  assert.equal(none.sentence, null);
  const early = app.conversionInfo(usdForex({ symbol: "GBPUSD", accountCurrency: "EUR" }));
  assert.equal(early.needed, true);
  assert.equal(early.sentence, null);
});

test("a pair that starts with the account currency converts at the instrument's own price", () => {
  const state = usdForex({ accountCurrency: "EUR" });
  const conv = app.conversionInfo(state);
  assert.equal(conv.source, "instrument");
  assert.equal(conv.needed, false);
  assert.equal(app.buildSizingInput(state).conversion, null);
  assert.equal(app.buildSizingInput(state).instrument.baseCurrency, "EUR");
  const view = app.evaluate(state);
  assert.equal(view.result.kind, "ok");
  // rate = 1 / entry: 1 pip per lot = 0.0001 * 100000 / 1.085 = 9.2165... EUR
  assert.match(view.checkLine, /is worth 9\.21 EUR\./);
  const core = calculatePositionSize(app.buildSizingInput(state));
  assert.equal(core.conversionSource, "instrument");
  assert.equal(view.result.lossLine.includes(core.actualRisk.toFixed(2, "up") + " EUR"), true);
  // The check line waits for the entry price.
  assert.equal(app.evaluate({ ...state, entry: "" }).checkLine, null);
  // The page text for this case is in the markup.
  assert.ok(
    html.includes(
      "Your account currency is the first currency of this pair, so Lotcheck converts the loss at your stop-loss price. No extra price is needed."
    )
  );
  // Non-forex types never pass a base currency.
  const index = { ...app.setInstrumentType(state, "index"), baseCurrency: "EUR", quoteCurrency: "USD", symbol: "US500" };
  assert.equal(app.buildSizingInput(index).instrument.baseCurrency, "EUR", "an optional base currency is passed on");
  assert.equal(app.conversionInfo(index).source, "instrument");
  assert.equal(app.buildSizingInput({ ...index, baseCurrency: "" }).instrument.baseCurrency, null);
  assert.equal(app.conversionInfo({ ...index, baseCurrency: "" }).source, "pair");
});

test("a USDJPY trade in a USD account sizes with the stop-loss price", () => {
  const state = {
    ...app.editField(app.defaultState(), "symbol", "USDJPY"),
    accountCurrency: "USD",
    balance: "10000",
    entry: "150.00",
    stop: "145.00",
    checked: true,
  };
  const view = app.evaluate(state);
  assert.equal(view.result.kind, "ok");
  assert.equal(view.result.headline, "0.02 lots");
  assert.equal(view.result.lossLine, "If your stop is hit you lose about 68.97 USD (0.69% of your balance)");
});

test("the conversion card names the pair to look up", () => {
  const labels = app.conversionLabels(usdForex({ symbol: "GBPUSD", accountCurrency: "EUR" }));
  assert.equal(labels.lookup, "Look up the price of EURUSD or USDEUR in your platform.");
  assert.equal(labels.priceLabel, "Price of the pair");
  assert.equal(app.conversionLabels(usdForex({})), null);
  const chosen = app.conversionLabels(usdForex({ symbol: "GBPUSD", accountCurrency: "EUR", convPair: "quote-account" }));
  assert.equal(chosen.priceLabel, "Price of USDEUR");
});

test("with a conversion, the result uses the converted loss", () => {
  const state = usdForex({ symbol: "GBPUSD", accountCurrency: "EUR", convPair: "account-quote", convPrice: "1.0850" });
  const view = app.evaluate(state);
  assert.equal(view.result.kind, "ok");
  assert.equal(view.result.headline, "0.54 lots");
  assert.equal(view.result.lossLine.startsWith("If your stop is hit you lose about 99."), true);
  const missing = app.evaluate(usdForex({ symbol: "GBPUSD", accountCurrency: "EUR" }));
  assert.equal(missing.result.kind, "waiting");
  assert.match(missing.result.message, /Conversion price type, Conversion price/);
});

// ---------------------------------------------------------------------------
// Stale values and pre-fill
// ---------------------------------------------------------------------------

test("a conversion price typed for one pair is never used for another", () => {
  let state = app.editField(app.defaultState(), "accountCurrency", "EUR");
  state = app.editField(state, "balance", "10000");
  state = app.editField(state, "symbol", "USDCAD");
  state = app.editField(app.editField(state, "entry", "1.3800"), "stop", "1.3780");
  state = { ...state, convPair: "quote-account", convPrice: "0.6800" };
  const first = app.evaluate({ ...state, checked: true });
  assert.equal(first.result.kind, "ok");
  assert.equal(first.conversion.sentence, "1 CAD = 0.68 EUR");
  // Retype the symbol: the quote currency changes, so the price is dropped.
  state = app.editField(state, "symbol", "GBPJPY");
  assert.equal(state.quoteCurrency, "JPY");
  assert.equal(state.convPrice, "");
  assert.equal(state.convPair, "");
  assert.equal(state.entry, "", "entry is cleared with the symbol");
  assert.equal(state.stop, "");
  assert.equal(state.extraDistance, "");
  state = app.editField(app.editField(state, "entry", "190.00"), "stop", "189.80");
  const second = app.evaluate(state);
  assert.equal(second.conversion.sentence, null);
  assert.equal(second.result.kind, "waiting");
});

test("a USD account moving from one symbol to another drops the old conversion price", () => {
  let state = app.editField(app.defaultState(), "accountCurrency", "USD");
  state = app.editField(state, "balance", "10000");
  state = app.editField(state, "symbol", "EURCHF");
  state = { ...state, convPair: "quote-account", convPrice: "1.1100" };
  state = app.editField(app.editField(state, "entry", "0.9400"), "stop", "0.9380");
  assert.equal(app.evaluate({ ...state, checked: true }).result.kind, "ok");
  state = app.editField(state, "symbol", "USDCAD");
  assert.equal(state.entry, "");
  assert.equal(state.convPrice, "", "the pair key changed (quote CHF to CAD), so the price is cleared");
  state = app.editField(state, "symbol", "EURCHF");
  assert.equal(state.convPrice, "", "and it stays cleared when the symbol goes back");
  const view = app.evaluate(state);
  assert.equal(view.result.kind, "waiting");
  assert.equal(view.conversion.sentence, null);
});

test("changing the account currency or the type also clears stale values", () => {
  let state = usdForex({ symbol: "GBPUSD", accountCurrency: "EUR", convPair: "account-quote", convPrice: "1.0850" });
  const keep = app.editField(state, "balance", "9000");
  assert.equal(keep.convPrice, "1.0850", "an unrelated edit keeps the price");
  assert.equal(keep.entry, "1.08500");
  const other = app.editField(state, "accountCurrency", "GBP");
  assert.equal(other.convPrice, "");
  assert.equal(other.convPair, "");
  assert.equal(other.entry, "1.08500", "a new account currency keeps the trade prices");
  const viaQuote = app.editField(state, "quoteCurrency", "CHF");
  assert.equal(viaQuote.convPrice, "");
  const typed = app.setInstrumentType({ ...state, checked: true }, "index");
  assert.equal(typed.entry, "");
  assert.equal(typed.stop, "");
  assert.equal(typed.extraDistance, "");
  assert.equal(typed.checked, false);
  const same = app.setInstrumentType(state, "forex");
  assert.equal(same.entry, "1.08500", "picking the same type changes nothing");
  assert.equal(app.editField(state, "symbol", "GBPUSD").entry, "1.08500", "same symbol keeps the prices");
});

test("metal, crypto and index symbols are not pre-filled as forex", () => {
  for (const symbol of ["XAUUSD", "XAGUSD", "XPTUSD", "XPDUSD", "BTCUSD", "ETHUSD", "US500", "GER40", "xauusd"]) {
    const state = app.editField(app.defaultState(), "symbol", symbol);
    assert.equal(state.contractSize, "", symbol + " contract size");
    assert.equal(state.quoteCurrency, "", symbol + " quote");
    assert.equal(state.baseCurrency, "", symbol + " base");
    assert.deepEqual(state.tags, {});
    assert.equal(app.symbolCaution(state), app.SYMBOL_CAUTION, symbol + " caution");
  }
  assert.equal(
    app.SYMBOL_CAUTION,
    "This looks like a metal, crypto or index symbol. Choose that instrument type and enter the numbers from your platform."
  );
  const forex = app.editField(app.defaultState(), "symbol", "EURUSD");
  assert.equal(app.symbolCaution(forex), null);
  const index = app.editField(app.setInstrumentType(app.defaultState(), "index"), "symbol", "XAUUSD");
  assert.equal(app.symbolCaution(index), null, "the caution only shows for the forex type");
  assert.equal(forex.baseCurrency, "EUR");
  assert.ok(html.includes('id="c-symbol"'));
});

test("error and range messages", () => {
  const zeroConv = app.evaluate(
    usdForex({ symbol: "GBPUSD", accountCurrency: "EUR", convPair: "account-quote", convPrice: "0" })
  );
  assert.equal(zeroConv.errors.convPrice, "Enter a number above 0.");
  assert.equal(app.evaluate(usdForex({ entry: "0" })).errors.entry, "Enter a number above 0.");
  assert.equal(app.evaluate(usdForex({ stop: "-1" })).errors.stop, "Enter a number above 0.");
  assert.equal(app.evaluate(usdForex({ extraDistance: "-1" })).errors.extraDistance, "Enter 0 or more.");
  assert.equal(
    app.messageForError("minLot", "not-on-step", app.defaultState()),
    "The minimum lot must be a whole number of lot steps."
  );
  const offGrid = app.evaluate(usdForex({ minLot: "0.015" }));
  assert.equal(offGrid.errors.minLot, "The minimum lot must be a whole number of lot steps.");
});

test("the check line never prints a zero pip value", () => {
  const tiny = {
    ...app.setInstrumentType(app.defaultState(), "crypto"),
    accountCurrency: "USD",
    quoteCurrency: "USD",
    contractSize: "1",
    pipSize: "0.0001",
  };
  assert.match(app.checkLineText(tiny), /is worth 0\.00010 USD\./);
  const jpy = { ...tiny, accountCurrency: "JPY", quoteCurrency: "JPY", contractSize: "1", pipSize: "0.0012" };
  assert.match(app.checkLineText(jpy), /is worth 0\.0012 JPY\./);
  assert.match(app.checkLineText({ ...tiny, pipSize: "0.5" }), /is worth 0\.50 USD\./);
});

test("base currency errors and the optional base currency field", () => {
  const same = app.evaluate(usdForex({ baseCurrency: "USD" }));
  assert.equal(same.errors.baseCurrency, "The base currency must differ from the quote currency.");
  assert.match(app.evaluate(usdForex({ baseCurrency: "E" })).errors.baseCurrency, /3 to 5/);
  const empty = app.evaluate(usdForex({ baseCurrency: "" }));
  assert.match(empty.result.message, /Base currency/);
  const index = {
    ...app.setInstrumentType(usdForex({}), "index"),
    baseCurrency: "x",
    quoteCurrency: "USD",
    contractSize: "1",
    pipSize: "1",
    minLot: "0.1",
    lotStep: "0.1",
    symbol: "US500",
    entry: "5000",
    stop: "4990",
  };
  assert.equal(app.evaluate(index).errors.baseCurrency, "Use 3 to 5 capital letters or digits, for example EUR.");
  assert.equal(app.evaluate({ ...index, baseCurrency: "" }).errors.baseCurrency, undefined, "optional when empty");
});

test("field labels and hints on the page are exact", () => {
  for (const label of [
    "Current equity",
    "Daily limit (percent)",
    "Daily limit: percent of this amount",
    "Value at the start of the trading day",
    "Total limit (percent)",
    "Starting balance of the account",
    "Total limit: percent of this amount",
    "Highest value reached",
    "Floor stops rising at (optional)",
    "Open risk on trades you already have",
    "Room to keep unused",
    "Fixed floor",
    "Trailing floor",
    "Base currency",
    "Saves your account currency, risk setting, instrument type, symbol, currencies, contract size, pip size, lot sizes and leverage in this browser only. Balance, prices, commission and loss-limit values are never saved, because they change.",
  ]) {
    assert.ok(markupOnly().includes(">" + label + "<") || markupOnly().includes(">" + label + "</"), label);
  }
  assert.match(markupOnly(), /id="f-checked"[^>]*aria-describedby="h-checked e-checked"/);
  assert.match(markupOnly(), /id="f-remember"[^>]*aria-describedby="h-remember"/);
});

test("an error element is only rewritten when its text changes", () => {
  const source = readFileSync(join(root, "src/ui/app.js"), "utf8");
  assert.match(source, /if \(node\.textContent !== message\) node\.textContent = message;/);
});

// ---------------------------------------------------------------------------
// Errors in plain words, next to the field
// ---------------------------------------------------------------------------

test("a comma gets the dot message", () => {
  const view = app.evaluate(usdForex({ balance: "10,000" }));
  assert.equal(view.errors.balance, "Use a dot for decimals and no thousands separators, for example 10000.50");
  assert.equal(view.result.kind, "waiting");
});

test("format errors name the field and the result waits", () => {
  const view = app.evaluate(usdForex({ entry: "1e5", stop: "abc", minLot: "0.0.1" }));
  assert.ok(view.errors.entry && view.errors.stop && view.errors.minLot);
  assert.match(view.errors.entry, /digits and one dot/);
  assert.equal(view.result.kind, "waiting");
  assert.equal(app.evaluate(usdForex({ accountCurrency: "EU" })).errors.accountCurrency.includes("3 to 5"), true);
});

test("range errors from the core are shown next to the right field", () => {
  assert.match(app.evaluate(usdForex({ stop: "1.08500" })).errors.stop, /different from the entry/);
  assert.match(app.evaluate(usdForex({ riskValue: "150" })).errors.riskValue, /up to 100/);
  assert.match(
    app.evaluate(usdForex({ riskMode: "amount", riskValue: "20000" })).errors.riskValue,
    /not more than your balance/
  );
  assert.match(app.evaluate(usdForex({ lotStep: "0" })).errors.lotStep, /above 0/);
  assert.match(app.evaluate(usdForex({ maxLot: "0.001" })).errors.maxLot, /minimum lot/);
  assert.match(app.evaluate(usdForex({ commission: "-1" })).errors.commission, /0 or more/);
  const guard = app.evaluate(
    usdForex({ guardOpen: true, equity: "9800", dailyPercent: "500", dailyOf: "10000", dailyStart: "10000" })
  );
  assert.match(guard.errors.dailyPercent, /up to 100/);
});

test("hidden loss-limit fields are not checked", () => {
  const view = app.evaluate(
    usdForex({ guardOpen: true, equity: "9800", totalPercent: "10", totalInitial: "10000", totalHigh: "x" })
  );
  assert.deepEqual(view.errors, {});
});

test("every message code has plain words", () => {
  for (const code of ["empty", "format", "range", "comma", "wrong-pair", "not-needed", "required", "other"]) {
    const text = app.messageForError("balance", code, app.defaultState());
    assert.ok(text.length > 5 && !/undefined/.test(text), code);
  }
});

test("the page never gives advice words", () => {
  const source = readFileSync(join(root, "src/ui/app.js"), "utf8") + html;
  const plain = source.replace(/safe integers?/gi, "").replace(/env\(safe-area-inset-bottom\)/g, "");
  assert.ok(!/\bsafe\b/i.test(plain), "never calls a trade safe");
  assert.ok(!/\b(buy now|sell now|signal)\b/i.test(source));
});

// ---------------------------------------------------------------------------
// Stale values, pre-fill, loss rules, build checks
// ---------------------------------------------------------------------------

test("picking the other conversion pair clears the price", () => {
  let state = app.editField(app.defaultState(), "accountCurrency", "USD");
  state = app.editField(state, "balance", "10000");
  state = app.editField(state, "symbol", "EURGBP");
  state = app.editField(app.editField(state, "entry", "0.85000"), "stop", "0.84800");
  state = app.setChoice(state, "convPair", "account-quote");
  state = app.editField(state, "convPrice", "0.787");
  const first = app.evaluate({ ...state, checked: true });
  assert.equal(first.result.kind, "ok");
  assert.equal(first.result.headline, "0.39 lots");
  const flipped = app.setChoice(state, "convPair", "quote-account");
  assert.equal(flipped.convPair, "quote-account");
  assert.equal(flipped.convPrice, "");
  const view = app.evaluate(flipped);
  assert.equal(view.result.kind, "waiting");
  assert.match(view.result.message, /Conversion price/);
  // Picking the same option again keeps the price.
  assert.equal(app.setChoice(state, "convPair", "account-quote").convPrice, "0.787");
});

test("switching the risk mode resets the number", () => {
  let state = usdForex({ riskMode: "amount", riskValue: "100", balance: "10000", entry: "1.0850", stop: "1.0830" });
  assert.equal(app.evaluate(state).result.headline, "0.50 lots");
  const percent = app.setChoice(state, "riskMode", "percent");
  assert.equal(percent.riskMode, "percent");
  assert.equal(percent.riskValue, "1");
  assert.equal(app.evaluate(percent).result.headline, "0.50 lots");
  const amount = app.setChoice(percent, "riskMode", "amount");
  assert.equal(amount.riskValue, "");
  assert.equal(app.evaluate(amount).result.kind, "waiting");
  assert.equal(app.setChoice(state, "riskMode", "amount").riskValue, "100", "same mode keeps the number");
  assert.equal(app.setChoice(state, "totalType", "trailing").riskValue, "100", "other radios do not touch it");
});

test("an instrument that is the account currency pair is found for every instrument type", () => {
  const crypto = {
    ...app.setInstrumentType(app.defaultState(), "crypto"),
    accountCurrency: "BTC",
    balance: "1",
    symbol: "BTCUSD",
    quoteCurrency: "USD",
    contractSize: "1",
    pipSize: "1",
    minLot: "0.01",
    lotStep: "0.01",
    entry: "60000",
    stop: "54000",
    checked: true,
  };
  const conv = app.conversionInfo(crypto);
  assert.equal(conv.source, "instrument");
  assert.equal(conv.needed, false);
  assert.equal(app.buildSizingInput(crypto).conversion, null);
  const view = app.evaluate(crypto);
  assert.equal(view.result.kind, "ok");
  assert.equal(view.result.headline, "0.09 lots");
  assert.ok(view.result.lossLine.includes("BTC"));
  const core = calculatePositionSize(app.buildSizingInput(crypto));
  assert.equal(core.conversionSource, "instrument");
  // A plain symbol with separators or a suffix is found too.
  assert.equal(app.conversionInfo({ ...crypto, symbol: "btc/usd.m" }).source, "instrument");
  assert.equal(app.conversionInfo({ ...crypto, symbol: "ETHUSD" }).source, "pair");
  assert.ok(html.includes("Your account currency is what this instrument is priced from, so Lotcheck converts the loss at your stop-loss price. No extra price is needed."));
});

test("pre-fill only for two known currency codes", () => {
  for (const symbol of ["GERMAN", "SPXUSD", "XRPUSD", "SOLUSD", "XTIUSD", "XAUUSD", "BTCUSD", "US500"]) {
    const state = app.editField(app.defaultState(), "symbol", symbol);
    assert.equal(state.contractSize, "", symbol);
    assert.equal(state.baseCurrency, "", symbol);
    assert.notEqual(app.symbolCaution(state), null, symbol + " shows a caution");
  }
  assert.equal(app.symbolCaution(app.editField(app.defaultState(), "symbol", "GERMAN")), app.UNKNOWN_PAIR_CAUTION);
  // Under six characters the unknown-pair caution waits; the metal and crypto one does not.
  assert.equal(app.symbolCaution(app.editField(app.defaultState(), "symbol", "EUR")), null);
  assert.equal(app.symbolCaution(app.editField(app.defaultState(), "symbol", "GER")), null);
  assert.equal(app.symbolCaution(app.editField(app.defaultState(), "symbol", "XAU")), app.SYMBOL_CAUTION);
  assert.equal(
    app.UNKNOWN_PAIR_CAUTION,
    "Lotcheck does not recognise this as a currency pair, so nothing is filled in for you. Check the instrument type and enter the numbers from your platform."
  );
  assert.equal(app.symbolCaution(app.editField(app.defaultState(), "symbol", "XAUUSD")), app.SYMBOL_CAUTION);
  assert.equal(app.symbolCaution(app.editField(app.defaultState(), "symbol", "US500")), app.SYMBOL_CAUTION);
  assert.equal(app.symbolCaution(app.defaultState()), null, "an empty symbol shows no caution");
  for (const [symbol, base, quote] of [
    ["EURUSD", "EUR", "USD"],
    ["usd/jpy", "USD", "JPY"],
    ["GBPCHF.m", "GBP", "CHF"],
    ["USDCNH", "USD", "CNH"],
    ["EURPLN", "EUR", "PLN"],
  ]) {
    const state = app.editField(app.defaultState(), "symbol", symbol);
    assert.equal(state.baseCurrency, base, symbol);
    assert.equal(state.quoteCurrency, quote, symbol);
    assert.equal(state.contractSize, "100000");
    assert.equal(app.symbolCaution(state), null, symbol + " shows no caution");
  }
  for (const code of app.KNOWN_CURRENCIES) assert.match(code, /^[A-Z]{3}$/);
  assert.equal(app.KNOWN_CURRENCIES.length, 21);
});

test("the status line matches the state of each rule", () => {
  const full = { guardOpen: true, equity: "10000" };
  const daily = { dailyPercent: "5", dailyOf: "10000", dailyStart: "10000" };
  const total = { totalPercent: "10", totalInitial: "10000" };
  const note = (extra) => app.guardInfo(usdForex({ ...full, ...extra })).note;
  assert.equal(note({}), "Not applied: no limit entered yet.");
  assert.equal(note({ ...daily, ...total }), "Applied: daily limit and total limit.");
  assert.equal(note(daily), "Applied: daily limit only.");
  assert.equal(note(total), "Applied: total limit only.");
  assert.equal(note({ ...daily, totalPercent: "10" }), "Applied: daily limit only. The total limit is not finished.");
  assert.equal(note({ ...total, dailyPercent: "5" }), "Applied: total limit only. The daily limit is not finished.");
  assert.equal(note({ dailyPercent: "5" }), "Not applied yet: the daily limit is not finished.");
  assert.equal(note({ totalPercent: "10" }), "Not applied yet: the total limit is not finished.");
  assert.equal(
    note({ dailyPercent: "5", totalPercent: "10" }),
    "Not applied yet: the daily limit and the total limit are not finished."
  );
  // A field holding "5%" or "0" is not complete, so the status never says Applied.
  assert.equal(note({ ...daily, dailyPercent: "5%" }), "Not applied yet: the daily limit is not finished.");
  assert.equal(note({ ...daily, dailyPercent: "0" }), "Not applied yet: the daily limit is not finished.");
  assert.equal(app.guardInfo(usdForex({ ...full, ...daily, dailyPercent: "5%" })).active, false);
  assert.match(app.guardInfo(usdForex({ ...full, ...daily, dailyPercent: "0" })).block, /Daily limit \(percent\)/);
  // No equity: rules cannot apply.
  assert.equal(app.guardInfo(usdForex({ guardOpen: true, ...daily, ...total })).note, "Not applied yet: the daily limit and the total limit are not finished.");
  // The answer No overrides every other state.
  assert.equal(note({ guardOpen: false, ...daily, ...total }), "Not applied: you answered No.");
  // The page says it: the status line sits above the limit fields.
  const m = markupOnly();
  assert.ok(m.indexOf('id="guard-status"') < m.indexOf('id="w-equity"'));
});

test("with the answer No, loss rules are ignored: complete, half-filled or wrong", () => {
  const rule = { equity: "10000", dailyPercent: "1", dailyOf: "10000", dailyStart: "10000", buffer: "0" };
  const none = app.evaluate(usdForex({ riskValue: "5" }));
  const no = app.evaluate(usdForex({ ...rule, guardOpen: false, riskValue: "5" }));
  assert.equal(no.result.headline, none.result.headline);
  assert.equal(no.result.headline, "2.50 lots");
  assert.equal(no.guard.active, false);
  assert.equal(no.guard.note, "Not applied: you answered No.");
  assert.equal(no.result.guard, null, "no room block");
  assert.deepEqual(no.result.rows.find((r) => r[0] === "Loss limits"), ["Loss limits", "Not applied"]);
  const yes = app.evaluate(usdForex({ ...rule, guardOpen: true, riskValue: "5" }));
  assert.equal(yes.result.headline, "0.50 lots");
  assert.equal(yes.guard.active, true);
  assert.ok(yes.result.guard, "the room table is shown");
  assert.equal(yes.result.rows.find((r) => r[0] === "Loss limits"), undefined);
  assert.equal(yes.result.rows.find((r) => r[0] === "Limited by")[1], "Your daily loss limit");
  // A half-filled rule neither blocks nor reports an error with No, and blocks with Yes.
  const half = { equity: "9000", dailyStart: "1", dailyPercent: "5%", totalPercent: "5" };
  const halfNo = app.evaluate(usdForex({ ...half, guardOpen: false }));
  assert.equal(halfNo.result.kind, "ok");
  assert.deepEqual(halfNo.errors, {});
  const halfYes = app.evaluate(usdForex({ ...half, guardOpen: true }));
  assert.equal(halfYes.result.kind, "waiting");
  assert.ok(halfYes.errors.dailyPercent);
});

test("switching No, Yes, No keeps the typed limit values", () => {
  let state = usdForex({ equity: "10000", dailyPercent: "1", dailyOf: "10000", dailyStart: "10000" });
  assert.equal(state.guardOpen, false);
  state = app.setChoice(state, "guardOpen", true);
  assert.equal(state.guardOpen, true);
  assert.equal(app.evaluate(state).guard.active, true);
  state = app.setChoice(state, "guardOpen", false);
  assert.equal(state.dailyPercent, "1");
  assert.equal(state.equity, "10000");
  assert.equal(app.evaluate(state).guard.active, false);
  state = app.setChoice(state, "guardOpen", true);
  assert.equal(app.evaluate(state).guard.active, true);
  assert.equal(app.defaultState().guardOpen, false, "the default answer is No");
  assert.ok(!app.SAVED_KEYS.includes("guardOpen"), "the answer is not saved");
});

test("the build scanner and syntax check", () => {
  assert.deepEqual(topLevelNames("const r = /[(]/, dup = 1;\nconst z = 2;\n", "t"), ["r", "dup", "z"]);
  assert.deepEqual(topLevelNames("const a = 4 / 2, b = 1;\n", "t"), ["a", "b"]);
  assert.throws(
    () => assertNoDuplicates([{ name: "a.js", text: "const r = /[(]/, dup = 1;\n" }, { name: "b.js", text: "function dup() {}\n" }]),
    /duplicate top-level name "dup"/
  );
  // node --check is the final word: a duplicate is a syntax error in a module.
  assert.throws(() => checkSyntax("const a = 1;\nconst a = 2;\n"), /syntax check/);
  assert.throws(() => checkSyntax("const = ;\n"), /syntax check/);
  assert.doesNotThrow(() => checkSyntax("const a = 1;\nfunction f() { return a; }\n"));
});

test("the base currency is required for forex pairs", () => {
  const view = app.evaluate(usdForex({ baseCurrency: "" }));
  assert.equal(view.result.kind, "waiting");
  assert.match(view.result.message, /Still needed: Base currency/);
  assert.equal(app.buildSizingInput(usdForex({ baseCurrency: "" })).instrument.baseCurrency, null);
});

test("the loss-room notes have their exact texts", () => {
  assert.equal(
    app.NOTE_TEXTS["loss-equals-room"],
    "This size uses all of the room you entered. If the stop is hit, the account ends exactly on the limit, and many firms count that as a breach. Use \"Room to keep unused\" to stay clear of it."
  );
  assert.equal(
    app.NOTE_TEXTS["equity-above-high-water-mark"],
    "Your current equity is above the highest value you entered. If your firm's floor follows equity, the highest value must be at least your current equity, or the room shown here is too large."
  );
  const view = app.evaluate(
    usdForex({
      guardOpen: true,
      equity: "10500",
      totalType: "trailing",
      totalPercent: "10",
      totalOf: "10000",
      totalHigh: "10000",
      balance: "10500",
    })
  );
  assert.equal(view.result.kind, "ok");
  assert.ok(view.result.notes.includes(app.NOTE_TEXTS["equity-above-high-water-mark"]));
  const equals = app.evaluate(
    usdForex({ guardOpen: true, equity: "10000", totalPercent: "10", totalInitial: "10000", buffer: "0", riskValue: "5", entry: "1.0850", stop: "1.0830", minLot: "0.01", lotStep: "0.01" })
  );
  assert.equal(equals.result.kind, "ok");
});

test("conversion lines under the result", () => {
  const own = app.evaluate(usdForex({ accountCurrency: "EUR" }));
  assert.equal(own.result.conversionNote, app.INSTRUMENT_NOTE);
  assert.equal(
    app.INSTRUMENT_NOTE,
    "The loss is converted at your stop-loss price, so it is a little different from pips times pip value."
  );
  const pair = app.evaluate(usdForex({ symbol: "GBPUSD", accountCurrency: "EUR", convPair: "account-quote", convPrice: "1.0850" }));
  assert.equal(pair.result.conversionNote, "The conversion price can move before your stop is hit. The real loss moves with it.");
  assert.equal(app.evaluate(usdForex({})).result.conversionNote, null);
});

test("the commission row shows only above 0", () => {
  const withCommission = app.evaluate(usdForex({ commission: "7" }));
  assert.equal(withCommission.result.rows.find((r) => r[0] === "Commission included")[1], "3.36 USD");
  const none = app.evaluate(usdForex({ commission: "0" }));
  assert.equal(none.result.rows.find((r) => r[0] === "Commission included"), undefined);
});

test("the loss-limits intro makes no promise", () => {
  const m = markupOnly();
  assert.ok(!m.includes("never sizes a trade bigger"));
  assert.ok(m.includes("sizes the trade so that the planned loss at your stop stays inside that room. Gaps and slippage can still make the loss larger."));
});

test("the comment above serializeState describes the saved scope", () => {
  const source = readFileSync(join(root, "src/ui/app.js"), "utf8");
  assert.ok(!source.includes('The "checked" box is never stored, so a'));
  assert.ok(source.includes("Balance, prices, loss-limit fields"));
});

// ---------------------------------------------------------------------------
// Static checks on the built page
// ---------------------------------------------------------------------------

test("the built page asks for the confirmation tick for every instrument type", () => {
  assert.ok(html.includes("I have checked these numbers in my platform"));
  assert.ok(html.includes("Required before any lot size is shown. Changing the account currency or any instrument field unticks it."));
  assert.ok(!/id="confirm-wrap"[^>]*hidden/.test(html), "the confirmation is never hidden");
  assert.ok(!inlineScript().includes("confirm-wrap\").hidden"), "the script never hides the confirmation");
});

test("the built page carries the below-minimum ending", () => {
  const script = inlineScript();
  assert.ok(script.includes("This trade is too big for your risk."));
  assert.ok(script.includes("Lotcheck does not round up to the minimum."));
});

test("the result card repeats the symbol caution above the lot size", () => {
  const script = inlineScript();
  assert.ok(script.includes("This looks like a metal, crypto or index symbol."));
  const cautionAt = script.indexOf('makeNode("p", "symbol-caution", model.caution)');
  assert.ok(cautionAt > 0, "the card adds the caution");
  assert.ok(html.includes('id="c-symbol"'), "the caution also sits under the symbol field");
});

// ---------------------------------------------------------------------------
// A new recognised pair replaces typed values; a base conflict shows at once
// ---------------------------------------------------------------------------

test("moving the symbol to another recognised pair replaces every typical value", () => {
  let state = app.editField(app.defaultState(), "symbol", "XAUUSD");
  assert.equal(state.baseCurrency, "");
  for (const [key, value] of [
    ["baseCurrency", "XAU"],
    ["quoteCurrency", "USD"],
    ["contractSize", "100"],
    ["pipSize", "0.01"],
    ["minLot", "0.01"],
    ["lotStep", "0.01"],
    ["maxLot", "50"],
  ]) {
    state = app.editField(state, key, value);
  }
  state = { ...state, checked: true };
  state = app.editField(state, "symbol", "EURUSD");
  assert.equal(state.baseCurrency, "EUR");
  assert.equal(state.quoteCurrency, "USD");
  assert.equal(state.contractSize, "100000");
  assert.equal(state.pipSize, "0.0001");
  assert.equal(state.maxLot, "");
  assert.equal(state.checked, false);
  for (const key of app.PREFILL_KEYS) assert.equal(state.tags[key], true, key + " is tagged");
});

test("the same recognised pair keeps typed values", () => {
  let state = app.editField(app.defaultState(), "symbol", "EURUSD");
  state = app.editField(state, "contractSize", "50000");
  state = app.editField(state, "maxLot", "10");
  state = app.editField(state, "symbol", "EURUSD.m");
  assert.equal(state.contractSize, "50000");
  assert.equal(state.maxLot, "10");
  state = app.editField(state, "symbol", "eurusd");
  assert.equal(state.contractSize, "50000");
  assert.equal(app.recognisedPairKey("EUR/USD.m"), "EURUSD");
  assert.equal(app.recognisedPairKey("XAUUSD"), null);
});

test("an unrecognised symbol changes nothing and keeps the caution", () => {
  let state = app.editField(app.defaultState(), "symbol", "EURUSD");
  state = app.editField(state, "contractSize", "50000");
  state = app.editField(state, "symbol", "XAUUSD");
  assert.equal(state.contractSize, "50000");
  assert.equal(app.symbolCaution(state), app.SYMBOL_CAUTION);
});

test("a base currency that contradicts the symbol is an error at once", () => {
  const state = usdForex({ symbol: "USDJPY" });
  assert.equal(state.baseCurrency, "USD");
  assert.equal(state.quoteCurrency, "JPY");
  const edited = { ...app.editField(state, "baseCurrency", "EUR"), checked: true };
  assert.equal(app.baseConflict(edited), true);
  const view = app.evaluate(edited);
  assert.equal(
    view.errors.baseCurrency,
    "The base currency does not match the symbol. For USDJPY the base currency is USD."
  );
  assert.equal(view.result.message, "Fix the fields marked above to see your lot size.");
  assert.equal(view.conversion.needed, false);
  assert.equal(view.checkLine, null);
  assert.equal(app.baseConflict(state), false);
  assert.equal(app.baseConflict({ ...edited, baseCurrency: "" }), false);
  assert.equal(app.baseConflict({ ...edited, symbol: "EURJPY" }), false);
});

// ---------------------------------------------------------------------------
// The six screens: which exist, what blocks them, where Next goes
// ---------------------------------------------------------------------------

function complete(extra) {
  return usdForex(extra);
}
function viewOf(state) {
  return app.evaluate(state);
}
function eurGbp(extra) {
  const base = app.editField(app.defaultState(), "symbol", "EURGBP");
  return { ...base, accountCurrency: "USD", balance: "10000", riskValue: "1", entry: "0.85500", stop: "0.85300", checked: true, ...extra };
}

test("the screens that exist follow the conversion and the loss-limit answer", () => {
  assert.deepEqual(app.screensFor(complete({})), ["account", "instrument", "trade", "result"]);
  assert.deepEqual(app.screensFor(complete({ guardOpen: true })), ["account", "instrument", "trade", "limits", "result"]);
  assert.deepEqual(app.screensFor(eurGbp({})), ["account", "instrument", "conversion", "trade", "result"]);
  assert.deepEqual(app.screensFor(eurGbp({ guardOpen: true })), ["account", "instrument", "conversion", "trade", "limits", "result"]);
});

test("next and previous screens", () => {
  const s = eurGbp({ guardOpen: true });
  assert.equal(app.nextScreen(s, "account"), "instrument");
  assert.equal(app.nextScreen(s, "instrument"), "conversion");
  assert.equal(app.nextScreen(s, "trade"), "limits");
  assert.equal(app.nextScreen(s, "result"), null);
  assert.equal(app.prevScreen(s, "account"), null);
  assert.equal(app.prevScreen(s, "result"), "limits");
  assert.equal(app.prevScreen(complete({}), "result"), "trade");
});

test("empty required fields give 'Enter the <label>.' and are not live", () => {
  const blank = app.defaultState();
  const problems = app.screenProblems(blank, viewOf(blank), "account");
  assert.deepEqual(problems.map((p) => p.key), ["accountCurrency", "balance"]);
  assert.equal(problems[0].message, "Enter the account currency.");
  assert.ok(problems.every((p) => p.live === false));
  assert.equal(app.emptyMessage("balance"), "Enter the account balance.");
  assert.equal(app.emptyMessage("convPair"), "Choose which price you are entering.");
  const trade = app.screenProblems(blank, viewOf(blank), "trade");
  assert.deepEqual(trade.map((p) => p.key), ["entry", "stop"]);
});

test("format errors are live problems", () => {
  const s = complete({ balance: "10 000" });
  const problems = app.screenProblems(s, viewOf(s), "account");
  assert.equal(problems.length, 1);
  assert.equal(problems[0].key, "balance");
  assert.equal(problems[0].live, true);
});

test("the tick is a problem on the instrument screen until it is set", () => {
  const s = complete({ checked: false });
  const problems = app.screenProblems(s, viewOf(s), "instrument");
  assert.deepEqual(problems, [{ key: "checked", message: "Tick the box once you have compared the numbers.", live: false }]);
  assert.deepEqual(app.screenProblems(complete({}), viewOf(complete({})), "instrument"), []);
});

test("the conversion screen needs the pair choice and the price", () => {
  const s = eurGbp({});
  const keys = app.screenProblems(s, viewOf(s), "conversion").map((p) => p.key);
  assert.deepEqual(keys, ["convPair", "convPrice"]);
  assert.equal(app.focusIdFor("convPair"), "conv-aq");
  assert.equal(app.focusIdFor("guard"), "f-equity");
  assert.equal(app.focusIdFor("entry"), "f-entry");
});

test("the limits screen blocks on empty and half-filled rules, only for Yes", () => {
  const yes = complete({ guardOpen: true });
  const empty = app.screenProblems(yes, viewOf(yes), "limits");
  assert.deepEqual(empty, [{ key: "guard", message: "Enter at least one complete limit, or go back and answer No.", live: false }]);
  const half = complete({ guardOpen: true, equity: "9000", dailyPercent: "5" });
  assert.ok(app.screenProblems(half, viewOf(half), "limits").some((p) => p.key === "guard"));
  const done = complete({ guardOpen: true, equity: "10000", dailyPercent: "1", dailyOf: "10000", dailyStart: "10000" });
  assert.deepEqual(app.screenProblems(done, viewOf(done), "limits"), []);
  const no = complete({ guardOpen: false });
  assert.deepEqual(app.screenProblems(no, viewOf(no), "limits"), []);
});

test("the result screen has no problems of its own", () => {
  assert.deepEqual(app.screenProblems(complete({}), viewOf(complete({})), "result"), []);
  assert.deepEqual(app.screenProblems(complete({}), viewOf(complete({})), "nowhere"), []);
});

test("the first screen with a problem is found in page order", () => {
  const s = complete({ balance: "", checked: false });
  assert.equal(app.firstScreenWithProblem(s, viewOf(s), null), "account");
  const t = complete({ checked: false });
  assert.equal(app.firstScreenWithProblem(t, viewOf(t), null), "instrument");
  assert.equal(app.firstScreenWithProblem(t, viewOf(t), "instrument"), null);
  assert.equal(app.firstScreenWithProblem(complete({}), viewOf(complete({})), null), null);
});

test("footer buttons", () => {
  const s = complete({});
  assert.deepEqual(app.footerFor(s, "account"), { showBack: false, nextLabel: "Next" });
  assert.deepEqual(app.footerFor(s, "instrument"), { showBack: true, nextLabel: "Next" });
  assert.deepEqual(app.footerFor(s, "trade"), { showBack: true, nextLabel: "Show result" });
  assert.deepEqual(app.footerFor(complete({ guardOpen: true }), "trade"), { showBack: true, nextLabel: "Next" });
  assert.deepEqual(app.footerFor(complete({ guardOpen: true }), "limits"), { showBack: true, nextLabel: "Show result" });
  assert.deepEqual(app.footerFor(s, "result"), { showBack: true, nextLabel: "New trade" });
});

test("the progress line has four steps and the right ones can be clicked", () => {
  const s = complete({});
  const steps = app.progressSteps(s, viewOf(s), "instrument");
  assert.deepEqual(steps.map((x) => x.label), ["Account", "Instrument", "Trade", "Result"]);
  assert.deepEqual(steps.map((x) => x.status), ["done", "now", "todo", "todo"]);
  assert.deepEqual(steps.map((x) => x.clickable), [true, false, true, true]);
  // A conversion screen belongs to the Instrument step, limits to Trade.
  assert.equal(app.progressSteps(eurGbp({}), viewOf(eurGbp({})), "conversion")[1].status, "now");
  const g = complete({ guardOpen: true, equity: "10000", dailyPercent: "1", dailyOf: "10000", dailyStart: "10000" });
  assert.equal(app.progressSteps(g, viewOf(g), "limits")[2].status, "now");
  // With a problem on an earlier screen, later steps cannot be opened.
  const bad = complete({ balance: "" });
  const gated = app.progressSteps(bad, viewOf(bad), "account");
  assert.deepEqual(gated.map((x) => x.clickable), [false, false, false, false]);
});

test("Next stays on a screen with a problem and moves on without one", () => {
  const bad = complete({ checked: false });
  const stay = app.advance(bad, viewOf(bad), "instrument");
  assert.equal(stay.target, "instrument");
  assert.equal(stay.problems[0].key, "checked");
  const good = complete({});
  assert.deepEqual(app.advance(good, viewOf(good), "instrument"), { target: "trade", problems: [] });
  assert.deepEqual(app.advance(good, viewOf(good), "trade"), { target: "result", problems: [] });
  assert.deepEqual(app.advance(good, viewOf(good), "result", "trade"), { target: "trade", problems: [] });
});

test("the result is gated: a jump from the progress line stops at the first problem", () => {
  const s = complete({ balance: "" });
  const jump = app.advance(s, viewOf(s), "instrument", "result");
  assert.equal(jump.target, "account");
  assert.equal(jump.problems[0].key, "balance");
  // Going back is never blocked.
  assert.deepEqual(app.advance(s, viewOf(s), "trade", "account"), { target: "account", problems: [] });
});

test("settling the screen after a change", () => {
  const good = complete({});
  assert.equal(app.settleScreen(good, viewOf(good), "result"), "result");
  const bad = complete({ stop: "" });
  assert.equal(app.settleScreen(bad, viewOf(bad), "result"), "trade");
  assert.equal(app.settleScreen(good, viewOf(good), "limits"), "trade");
  assert.equal(app.settleScreen(good, viewOf(good), "conversion"), "instrument");
  assert.equal(app.settleScreen(good, viewOf(good), "trade"), "trade");
});

test("New trade clears entry, stop and conversion price and keeps the rest", () => {
  const s = eurGbp({ convPair: "quote-account", convPrice: "1.25000", commission: "3", guardOpen: true, equity: "10000" });
  const out = app.startNewTrade(s);
  assert.equal(out.state.entry, "");
  assert.equal(out.state.stop, "");
  assert.equal(out.state.convPrice, "");
  assert.equal(out.state.checked, true, "the tick stays");
  assert.equal(out.state.balance, "10000");
  assert.equal(out.state.commission, "3");
  assert.equal(out.state.guardOpen, true);
  assert.equal(out.screen, "conversion");
  assert.equal(app.startNewTrade(complete({})).screen, "trade");
});

test("no screen problem means the result is not the waiting kind, for both answers", () => {
  const rule = { equity: "10000", dailyPercent: "1", dailyOf: "10000", dailyStart: "10000" };
  const symbols = ["EURUSD", "EURGBP", "XAUUSD", "US30", "BTCUSD"];
  const mutations = [
    {},
    { balance: "" },
    { entry: "" },
    { stop: "" },
    { checked: false },
    { riskValue: "" },
    { entry: "abc" },
    { stop: "1.08500" },
    { convPrice: "1.25" },
    { convPair: "quote-account", convPrice: "1.25" },
    { convPair: "quote-account", convPrice: "x" },
    { minLot: "" },
    { lotStep: "0" },
    { maxLot: "abc" },
    { equity: "9000", dailyPercent: "5" },
    { ...rule },
    { symbol: "", baseCurrency: "", quoteCurrency: "", contractSize: "", pipSize: "", minLot: "", lotStep: "", maxLot: "" },
    { symbol: "", baseCurrency: "", quoteCurrency: "", contractSize: "", pipSize: "", minLot: "", lotStep: "", maxLot: "", instrumentType: "index" },
  ];
  let checked = 0;
  const seen = new Set();
  for (const symbol of symbols) {
    for (const guardOpen of [false, true]) {
      for (const mutation of mutations) {
        let s = app.editField(app.defaultState(), "symbol", symbol);
        if (symbol !== "EURUSD" && symbol !== "EURGBP") {
          s = app.setInstrumentType(s, symbol === "BTCUSD" ? "crypto" : symbol === "US30" ? "index" : "metal");
          s = { ...s, quoteCurrency: "USD", contractSize: "100", pipSize: "0.01", minLot: "0.01", lotStep: "0.01" };
        }
        s = { ...s, accountCurrency: "USD", balance: "10000", riskValue: "1", entry: "1.08500", stop: "1.08300", checked: true, guardOpen, ...(symbol === "EURGBP" ? { convPair: "quote-account", convPrice: "1.25" } : {}), ...mutation };
        const view = viewOf(s);
        const none = app.screensFor(s).filter((id) => id !== "result").every((id) => app.screenProblems(s, view, id).length === 0);
        if (none) {
          checked += 1;
          seen.add(view.result.kind);
          assert.notEqual(view.result.kind, "waiting", JSON.stringify({ symbol, guardOpen, mutation }));
        }
      }
    }
  }
  assert.ok(checked > 20, "the property was exercised: " + checked);
  assert.ok(seen.has("ok"));
});

test("numbers intro, plain sentences and the toggle", () => {
  const s = complete({});
  assert.equal(app.numbersIntro(s), "Typical values for EURUSD. Brokers differ.");
  const edited = app.editField(s, "contractSize", "50000");
  assert.equal(app.numbersIntro(edited), "Your numbers for EURUSD.");
  const [first, second] = app.plainNumberLines(s);
  assert.deepEqual(first, [{ text: "1.00 lot is " }, { text: "100000 EUR", strong: true }]);
  assert.equal(second.map((p) => p.text).join(""), "Sizes start at 0.01 lot, in steps of 0.01");
  const withMax = app.plainNumberLines(complete({ maxLot: "50" }))[1];
  assert.equal(withMax.map((p) => p.text).join(""), "Sizes start at 0.01 lot, in steps of 0.01, up to 50");
  assert.deepEqual(app.numbersView(s, viewOf(s), null), { open: false, forced: false, canToggle: true, hidden: false });
  assert.equal(app.numbersView(s, viewOf(s), true).open, true);
  assert.equal(app.numbersView(edited, viewOf(edited), null).open, true);
  const missing = complete({ minLot: "" });
  assert.deepEqual(app.numbersView(missing, viewOf(missing), false), { open: true, forced: true, canToggle: false, hidden: false });
});

// ---------------------------------------------------------------------------
// The built page
// ---------------------------------------------------------------------------

test("the page has six screens, one heading each, four type radios and no select", () => {
  const m = markupOnly();
  for (const id of ["account", "instrument", "conversion", "trade", "limits", "result"]) {
    const start = m.indexOf('<section class="screen" id="' + id + '"');
    assert.ok(start >= 0, "screen " + id);
    const rest = m.slice(start + 10);
    const stop = rest.search(/<section class="screen"|<footer/);
    const block = rest.slice(0, stop < 0 ? undefined : stop);
    assert.equal((block.match(/<h1[\s>]/g) || []).length, 1, "one h1 in " + id);
  }
  assert.equal((m.match(/type="radio"[^>]*name="instrumentType"/g) || []).length, 4);
  assert.ok(!/<select/.test(m));
  assert.ok(m.includes("Check this first"));
  assert.ok(m.includes("Show result") || inlineScript().includes("Show result"));
  assert.ok(m.includes("Does your account have loss limits?"));
  assert.ok(m.includes("For example a prop-firm challenge."));
  assert.ok(m.includes("Version "));
});

test("the page has no inline style attributes and the script never uses innerHTML", () => {
  assert.ok(!/\sstyle=/.test(markupOnly()));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|eval\(/.test(inlineScript()));
  assert.equal((html.match(/<style[\s>]/g) || []).length, 1);
  assert.equal((html.match(/<script[\s>]/g) || []).length, 1);
});

// ---------------------------------------------------------------------------
// First view of the instrument screen, loss-limit focus, headline, styles
// ---------------------------------------------------------------------------

function blankForex(extra) {
  return { ...app.defaultState(), accountCurrency: "USD", balance: "10000", riskValue: "1", ...extra };
}

test("an empty forex instrument screen hides the check panel and has one problem", () => {
  const s = blankForex({});
  assert.equal(app.instrumentIsBlank(s), true);
  assert.equal(app.numbersView(s, viewOf(s), null).hidden, true);
  assert.deepEqual(app.screenProblems(s, viewOf(s), "instrument"), [
    { key: "symbol", message: "Enter a symbol, for example EURUSD.", live: false },
  ]);
  assert.equal(app.focusIdFor("symbol"), "f-symbol");
  // A symbol that normalises to nothing counts as empty.
  assert.equal(app.instrumentIsBlank({ ...s, symbol: " -/ " }), true);
});

test("the check panel comes back with a symbol, any filled field or another type", () => {
  const s = blankForex({});
  const typed = app.editField(s, "symbol", "EURUSD");
  assert.equal(app.instrumentIsBlank(typed), false);
  assert.equal(app.numbersView(typed, viewOf(typed), null).hidden, false);
  for (const key of ["baseCurrency", "quoteCurrency", "contractSize", "pipSize", "minLot", "lotStep", "maxLot"]) {
    const t = { ...s, [key]: "1" };
    assert.equal(app.instrumentIsBlank(t), false, key);
    assert.equal(app.numbersView(t, viewOf(t), null).hidden, false, key);
  }
  const index = app.setInstrumentType(s, "index");
  assert.equal(app.instrumentIsBlank(index), false);
  const keys = app.screenProblems(index, viewOf(index), "instrument").map((p) => p.key);
  assert.ok(keys.includes("quoteCurrency") && keys.includes("checked") && !keys.includes("symbol"));
  // With a symbol but nothing else the old behaviour holds.
  const partial = { ...blankForex({}), symbol: "ZZZZZZ" };
  assert.ok(app.screenProblems(partial, viewOf(partial), "instrument").length > 1);
});

test("a blocked loss-limit screen points at the first field still needed", () => {
  const daily = { dailyPercent: "5", dailyOf: "10000" };
  const half = complete({ guardOpen: true, equity: "10000", ...daily });
  const problem = app.screenProblems(half, viewOf(half), "limits")[0];
  assert.equal(problem.key, "guard");
  assert.equal(app.focusIdFor(problem.focus), "f-dailyStart");
  const noEquity = complete({ guardOpen: true, ...daily, dailyStart: "10000" });
  assert.equal(app.screenProblems(noEquity, viewOf(noEquity), "limits")[0].focus, "equity");
  const total = complete({ guardOpen: true, equity: "10000", totalPercent: "10" });
  assert.equal(app.screenProblems(total, viewOf(total), "limits")[0].focus, "totalInitial");
  // Nothing entered: no focus override, so the page focuses Current equity.
  const empty = complete({ guardOpen: true });
  const none = app.screenProblems(empty, viewOf(empty), "limits")[0];
  assert.equal(none.focus, undefined);
  assert.equal(app.focusIdFor(none.key), "f-equity");
});

test("the layout fixes are in the page and the style", () => {
  const m = markupOnly();
  const css = inlineStyle();
  // Non-forex help is a closed details element.
  assert.match(m, /<details class="more" id="nonforex-help" hidden>\s*<summary>Where to find these numbers<\/summary>/);
  // Trade order: costs, loss-limit question, What is this? last.
  const trade = m.slice(m.indexOf('id="trade"'), m.indexOf('id="limits"'));
  assert.ok(trade.indexOf('id="costs"') < trade.indexOf('id="fs-guardOpen"'));
  assert.ok(trade.indexOf('id="fs-guardOpen"') < trade.indexOf("<summary>What is this?</summary>"));
  assert.match(css, /\.guard-question\s*\{[^}]*margin-top:\s*(2[4-9]|[3-9]\d)px/);
  // The remember row has its own class, and nothing else uses the panel class.
  assert.match(m, /<label class="remember" for="f-remember">/);
  assert.equal((m.match(/class="check"/g) || []).length, 1);
  // Notes are not boxed like fields.
  assert.match(css, /\.lookup,\s*\.rate-line\s*\{[^}]*border-left:\s*2px solid var\(--accent\)/);
  // Subgrid rows line the inputs up, only where supported.
  assert.ok(css.includes("@supports (grid-template-rows: subgrid)"));
  assert.ok(css.includes("clamp("));
  assert.ok(css.includes("@media (max-width: 379px)"));
});

test("the headline is one phrase made of a number node and a unit node", () => {
  const script = inlineScript();
  assert.ok(script.includes('"lots-number"') && script.includes('"lots-unit"'));
  assert.ok(!script.includes('makeNode("p", "lots", model.headline)'));
  assert.match(app.evaluate(usdForex({})).result.headline, /^\d+\.\d\d lots$/);
});

test("a tiny pip value never prints as zero in the result row", () => {
  const state = {
    ...app.setInstrumentType(app.defaultState(), "crypto"),
    accountCurrency: "USD",
    balance: "10000",
    symbol: "SHIBUSD",
    quoteCurrency: "USD",
    contractSize: "1",
    pipSize: "0.00000001",
    minLot: "1",
    lotStep: "1",
    entry: "0.00002",
    stop: "0.00001",
    checked: true,
  };
  const view = app.evaluate(state);
  assert.equal(view.result.kind, "ok");
  const row = view.result.rows.find((r) => r[0].startsWith("Value of one"));
  assert.equal(row[1], "0.000000010 USD");
  assert.notEqual(row[1], "0.00 USD");
  assert.equal(app.pipValueText(Q.of("0.004"), "USD"), "0.0040");
  assert.equal(app.pipValueText(Q.of("12.349"), "USD"), "12.34");
  assert.equal(app.pipValueText(Q.of("0.4"), "JPY"), "0.40");
});

test("the account screen has a note and a forget button, hidden in the markup", () => {
  const m = markupOnly();
  assert.match(m, /<div class="saved-note" id="saved-note" hidden>/);
  assert.ok(m.includes("Inputs saved in this browser were filled in."));
  assert.match(m, /<button type="button" class="plain-button" id="b-forget-account">Forget saved inputs<\/button>/);
  assert.match(m, /id="forget-status-account" role="status"/);
  const account = m.slice(m.indexOf('id="account"'), m.indexOf('id="instrument"'));
  assert.ok(account.indexOf('id="saved-note"') < account.indexOf("<summary>What is this?</summary>"));
  // The result screen keeps its own block.
  assert.ok(m.includes('id="b-forget"'));
  const script = inlineScript();
  assert.ok(script.includes("b-forget-account") && script.includes("saved-note"));
});

test("the tag keeps its full caution text on all six pre-filled fields", () => {
  const m = markupOnly();
  for (const key of ["baseCurrency", "quoteCurrency", "contractSize", "pipSize", "minLot", "lotStep"]) {
    assert.ok(m.includes('id="t-' + key + '" hidden>typical value, check with your broker</p>'), key);
  }
  assert.ok(!m.includes(">typical value</p>"));
});

test("the current step opens its main screen from conversion and limits", () => {
  const conv = eurGbp({ convPair: "quote-account", convPrice: "1.25" });
  const onConv = app.progressSteps(conv, viewOf(conv), "conversion");
  assert.equal(onConv[1].status, "now");
  assert.equal(onConv[1].clickable, true);
  assert.equal(onConv[1].screen, "instrument");
  const onInstrument = app.progressSteps(conv, viewOf(conv), "instrument");
  assert.equal(onInstrument[1].clickable, false);
  const g = complete({ guardOpen: true, equity: "10000", dailyPercent: "1", dailyOf: "10000", dailyStart: "10000" });
  const onLimits = app.progressSteps(g, viewOf(g), "limits");
  assert.equal(onLimits[2].clickable, true);
  assert.equal(app.progressSteps(g, viewOf(g), "trade")[2].clickable, false);
  assert.equal(app.progressSteps(g, viewOf(g), "account")[0].clickable, false);
  assert.equal(app.progressSteps(complete({}), viewOf(complete({})), "result")[3].clickable, false);
});

test("a forward move stops at the first screen with a problem before the target", () => {
  const s = complete({ checked: false });
  const out = app.advance(s, viewOf(s), "account", "trade");
  assert.equal(out.target, "instrument");
  assert.equal(out.problems[0].key, "checked");
  // Without a problem on the way the target is reached.
  const ok = complete({});
  assert.deepEqual(app.advance(ok, viewOf(ok), "account", "trade"), { target: "trade", problems: [] });
  // A problem on the current screen comes first.
  const bad = complete({ balance: "", checked: false });
  assert.equal(app.advance(bad, viewOf(bad), "account", "trade").target, "account");
  // A problem on the target itself does not stop the move.
  const noStop = complete({ stop: "" });
  assert.equal(app.advance(noStop, viewOf(noStop), "instrument", "trade").target, "trade");
  // Screens before the current one are not looked at, except for the result.
  assert.equal(app.advance(noStop, viewOf(noStop), "trade", "result").target, "trade");
});

test("a format error in a limit field takes the focus after a blocked Next", () => {
  const s = complete({ guardOpen: true, equity: "10000", dailyPercent: "5%", dailyOf: "10000", dailyStart: "10000" });
  const view = viewOf(s);
  assert.ok(view.errors.dailyPercent, "the format error is live");
  const problems = app.screenProblems(s, view, "limits");
  const first = problems[0];
  assert.equal(app.focusIdFor(first.focus || first.key), "f-dailyPercent");
  // A format error in a later field, with the earlier rule complete.
  const later = complete({ guardOpen: true, equity: "10000", dailyPercent: "1", dailyOf: "10000", dailyStart: "10000", buffer: "1,5" });
  const p2 = app.screenProblems(later, viewOf(later), "limits");
  assert.equal(p2.length, 1);
  assert.equal(app.focusIdFor(p2[0].focus || p2[0].key), "f-buffer");
});
