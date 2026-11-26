#!/usr/bin/env python3
"""Cross-check for the Lotcheck golden cases.

This file is a second implementation of the Lotcheck formulas. The written
rules it follows are in docs/how-it-works.md. It shares no code with the
JavaScript implementation.
It uses exact fractions everywhere. There is no floating point in this file.

Usage (run from the repository root):

    python3 test/golden/reference.py              check every case in cases.json
    python3 test/golden/reference.py --print ID   print the computed result of one case

Exit code 0 means every case agrees. Exit code 1 means at least one case
differs. Exit code 2 means the script could not run (bad arguments or file).
"""

import json
import os
import re
import sys
from fractions import Fraction

CASES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cases.json")

DECIMAL_RE = re.compile(r"-?([0-9]+\.?[0-9]*|\.[0-9]+)")
CURRENCY_RE = re.compile(r"[A-Z0-9]{3,5}")
MAX_DECIMAL_LENGTH = 40
# Only these four characters are removed from the ends of a number, a symbol
# or a currency code: space, tab, line feed, carriage return.
WHITESPACE = " \t\n\r"

ZERO = Fraction(0)
HUNDRED = Fraction(100)

SIZE_FIELDS = [
    "status", "direction", "lots", "rawLots", "riskAmount", "riskBudget",
    "limitedBy", "rate", "lossRate", "conversionSource", "priceDistance",
    "stopDistance", "stopPips",
    "lossPerLot", "pipValuePerLot", "actualRisk", "actualRiskPercent",
    "commissionTotal", "lossAtMinLot", "notional", "margin", "notes",
]
ROOM_FIELDS = [
    "status", "breached", "dailyFloor", "dailyRoom", "totalFloor", "totalRoom",
    "room", "bindingLimit", "openRisk", "buffer", "roomForNewTrade", "notes",
]


class InputError(Exception):
    """A rejected input. `field` is a dotted path or None, `code` is a short word."""

    def __init__(self, field, code):
        super().__init__("%s: %s" % (field, code))
        self.field = field
        self.code = code


# ---------------------------------------------------------------------------
# Exact numbers
# ---------------------------------------------------------------------------

def parse_decimal(text, field):
    """Turn a decimal string such as "1.0850" into an exact Fraction."""
    if not isinstance(text, str):
        # The written rules only say that the value must be a string.
        # No golden case depends on the code used here.
        raise InputError(field, "format")
    # Any other character at either end, such as a no-break space or U+FEFF,
    # stays in the text and fails the pattern below.
    text = text.strip(WHITESPACE)
    if text == "":
        raise InputError(field, "empty")
    if "," in text:
        raise InputError(field, "comma")
    if len(text) > MAX_DECIMAL_LENGTH or DECIMAL_RE.fullmatch(text) is None:
        raise InputError(field, "format")
    negative = text.startswith("-")
    if negative:
        text = text[1:]
    whole, _, digits = text.partition(".")
    value = Fraction(int(whole + digits), 10 ** len(digits))
    return -value if negative else value


def floor_to_step(value, step):
    """The largest multiple of `step` that is not above `value`."""
    return (value // step) * step


def need(value, ok, field):
    if not ok:
        raise InputError(field, "range")
    return value


def positive(source, key, field):
    value = parse_decimal(source.get(key), field)
    return need(value, value > 0, field)


def optional_non_negative(source, key, field):
    if source.get(key) is None:
        return ZERO
    value = parse_decimal(source[key], field)
    return need(value, value >= 0, field)


def currency(text, field):
    if not isinstance(text, str):
        raise InputError(field, "format")
    text = text.strip(WHITESPACE)
    if CURRENCY_RE.fullmatch(text) is None:
        raise InputError(field, "format")
    return text


def pair_code(text):
    """A currency code of the conversion pair, with outer whitespace removed."""
    return text.strip(WHITESPACE) if isinstance(text, str) else text


# ---------------------------------------------------------------------------
# Position size
# ---------------------------------------------------------------------------

ASCII_LOWER = "abcdefghijklmnopqrstuvwxyz"
ASCII_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
SYMBOL_CHARACTERS = ASCII_UPPER + "0123456789"


def symbol_names_own_pair(symbol, account_currency, quote_currency):
    """True when the symbol reads as account currency then quote currency.

    The symbol is read with ASCII letters in upper case and everything that is
    not A-Z or 0-9 removed, so "usd/jpy" and "USDJPY.m" both read as USDJPY.
    """
    normalised = ""
    for character in symbol:
        position = ASCII_LOWER.find(character)
        if position >= 0:
            character = ASCII_UPPER[position]
        if character in SYMBOL_CHARACTERS:
            normalised += character
    return normalised.startswith(account_currency + quote_currency)


def effective_base_currency(symbol, base_currency, account_currency, quote_currency):
    """The base currency used to spot an own-pair trade.

    A base currency that was given is used, but it must not contradict the
    symbol. Without one, the symbol decides: if it reads as the account
    currency followed by the quote currency, the base currency is the account
    currency.
    """
    own_pair = symbol_names_own_pair(symbol, account_currency, quote_currency)
    if base_currency is not None:
        if own_pair and base_currency != account_currency:
            raise InputError("instrument.baseCurrency", "conflict")
        return base_currency
    return account_currency if own_pair else None


def conversion_rates(account_currency, base_currency, quote_currency, conversion,
                     entry, stop, extra_distance):
    """Work out how the quote currency is turned into the account currency.

    Returns (rate, loss_rate, source). Both rates say how many units of account
    currency one unit of quote currency is worth. `rate` is used for the pip
    value and the notional. `loss_rate` is used for the loss per lot.
    """
    # Case 1: the instrument is quoted in the account currency.
    if quote_currency == account_currency:
        if conversion is not None:
            raise InputError("conversion", "not-needed")
        return Fraction(1), Fraction(1), "none"

    # Case 2: the instrument is itself the pair of account and quote currency.
    # Its own price is the conversion price. The loss is converted at the price
    # where the trade closes, which is the stop moved by the extra distance.
    if base_currency is not None and base_currency == account_currency:
        if conversion is not None:
            raise InputError("conversion", "not-needed")
        if stop < entry:
            exit_price = stop - extra_distance
        else:
            exit_price = stop + extra_distance
        if exit_price <= 0:
            raise InputError("trade.extraDistance", "range")
        return 1 / entry, 1 / exit_price, "instrument"

    # Case 3: a separate conversion pair is needed.
    if conversion is None:
        raise InputError("conversion", "required")
    pair = (pair_code(conversion.get("base")), pair_code(conversion.get("quote")))
    if pair == (quote_currency, account_currency):
        rate = positive(conversion, "price", "conversion.price")
    elif pair == (account_currency, quote_currency):
        rate = 1 / positive(conversion, "price", "conversion.price")
    else:
        raise InputError("conversion", "wrong-pair")
    return rate, rate, "pair"


def calculate_position_size(data):
    account_currency = currency(data.get("accountCurrency"), "accountCurrency")
    balance = positive(data, "balance", "balance")

    risk = data.get("risk") or {}
    if risk.get("mode") not in ("percent", "amount"):
        raise InputError("risk.mode", "format")
    risk_value = positive(risk, "value", "risk.value")
    if risk["mode"] == "percent":
        need(risk_value, risk_value <= 100, "risk.value")
        risk_amount = balance * risk_value / HUNDRED
    else:
        need(risk_value, risk_value <= balance, "risk.value")
        risk_amount = risk_value

    instrument = data.get("instrument") or {}
    symbol = instrument.get("symbol")
    if not isinstance(symbol, str):
        raise InputError("instrument.symbol", "format")
    symbol = symbol.strip(WHITESPACE)
    if symbol == "":
        raise InputError("instrument.symbol", "empty")
    # len() counts code points in Python. The limit is 20 code points.
    if len(symbol) > 20:
        raise InputError("instrument.symbol", "format")
    quote_currency = currency(instrument.get("quoteCurrency"), "instrument.quoteCurrency")
    base_currency = None
    if instrument.get("baseCurrency") is not None:
        base_currency = currency(instrument["baseCurrency"], "instrument.baseCurrency")
        need(base_currency, base_currency != quote_currency, "instrument.baseCurrency")
    base_currency = effective_base_currency(
        symbol, base_currency, account_currency, quote_currency)
    contract_size = positive(instrument, "contractSize", "instrument.contractSize")
    pip_size = positive(instrument, "pipSize", "instrument.pipSize")
    min_lot = positive(instrument, "minLot", "instrument.minLot")
    lot_step = positive(instrument, "lotStep", "instrument.lotStep")
    if (min_lot / lot_step).denominator != 1:
        raise InputError("instrument.minLot", "not-on-step")
    max_lot = None
    if instrument.get("maxLot") is not None:
        max_lot = parse_decimal(instrument["maxLot"], "instrument.maxLot")
        need(max_lot, max_lot >= min_lot, "instrument.maxLot")

    trade = data.get("trade") or {}
    entry = positive(trade, "entry", "trade.entry")
    stop = positive(trade, "stop", "trade.stop")
    need(stop, stop != entry, "trade.stop")
    extra_distance = optional_non_negative(trade, "extraDistance", "trade.extraDistance")

    rate, loss_rate, conversion_source = conversion_rates(
        account_currency, base_currency, quote_currency, data.get("conversion"),
        entry, stop, extra_distance)
    commission_per_lot = optional_non_negative(data, "commissionPerLot", "commissionPerLot")

    leverage = None
    if data.get("leverage") is not None:
        leverage = positive(data, "leverage", "leverage")

    risk_budget = risk_amount
    limited_by = "risk"
    cap = data.get("budgetCap")
    cap_amount = None
    if cap is not None:
        if cap.get("reason") not in ("daily", "total"):
            raise InputError("budgetCap.reason", "format")
        cap_amount = cap.get("amount")
        if not isinstance(cap_amount, Fraction):
            cap_amount = parse_decimal(cap_amount, "budgetCap.amount")
        if cap_amount < risk_amount:
            risk_budget = cap_amount
            limited_by = cap["reason"]

    price_distance = abs(entry - stop)
    stop_distance = price_distance + extra_distance
    direction = "long" if stop < entry else "short"
    loss_per_lot = stop_distance * contract_size * loss_rate + commission_per_lot
    pip_value_per_lot = pip_size * contract_size * rate
    stop_pips = price_distance / pip_size

    notes = []
    if risk_budget <= 0:
        status = "no-budget"
        raw_lots = ZERO
        lots = ZERO
    else:
        raw_lots = risk_budget / loss_per_lot
        lots = floor_to_step(raw_lots, lot_step)
        if max_lot is not None and lots > max_lot:
            lots = floor_to_step(max_lot, lot_step)
            notes.append("capped-at-max-lot")
        if lots < min_lot:
            status = "below-minimum"
            lots = ZERO
        else:
            status = "ok"

    actual_risk = lots * loss_per_lot
    notional = lots * contract_size * entry * rate
    margin = None if leverage is None else notional / leverage

    if risk_amount / balance * HUNDRED > 2:
        notes.append("risk-above-2-percent")
    if extra_distance == 0:
        notes.append("no-spread-entered")
    if commission_per_lot == 0:
        notes.append("no-commission-entered")
    if margin is not None and margin > balance:
        notes.append("margin-above-balance")
    # A loss equal to the cap would put the account exactly on the floor.
    # This also holds when the cap and the risk amount are the same number.
    if cap is not None and status == "ok" and actual_risk == cap_amount:
        notes.append("loss-equals-room")

    return {
        "status": status,
        "direction": direction,
        "lots": lots,
        "rawLots": raw_lots,
        "riskAmount": risk_amount,
        "riskBudget": risk_budget,
        "limitedBy": limited_by,
        "rate": rate,
        "lossRate": loss_rate,
        "conversionSource": conversion_source,
        "priceDistance": price_distance,
        "stopDistance": stop_distance,
        "stopPips": stop_pips,
        "lossPerLot": loss_per_lot,
        "pipValuePerLot": pip_value_per_lot,
        "actualRisk": actual_risk,
        "actualRiskPercent": actual_risk / balance * HUNDRED,
        "commissionTotal": lots * commission_per_lot,
        "lossAtMinLot": min_lot * loss_per_lot,
        "notional": notional,
        "margin": margin,
        "notes": notes,
    }


# ---------------------------------------------------------------------------
# Loss room
# ---------------------------------------------------------------------------

def limit_percent(rule, field):
    value = positive(rule, "limitPercent", field)
    return need(value, value <= 100, field)


def calculate_loss_room(data):
    equity = positive(data, "currentEquity", "currentEquity")
    daily = data.get("daily")
    total = data.get("total")
    if daily is None and total is None:
        raise InputError(None, "no-rule")

    daily_floor = daily_room = None
    if daily is not None:
        percent = limit_percent(daily, "daily.limitPercent")
        percent_of = positive(daily, "percentOf", "daily.percentOf")
        day_start = positive(daily, "dayStartValue", "daily.dayStartValue")
        daily_floor = day_start - percent / HUNDRED * percent_of
        daily_room = equity - daily_floor

    notes = []
    total_floor = total_room = None
    if total is not None:
        if total.get("type") == "static":
            percent = limit_percent(total, "total.limitPercent")
            initial = positive(total, "initialBalance", "total.initialBalance")
            total_floor = initial - percent / HUNDRED * initial
        elif total.get("type") == "trailing":
            percent = limit_percent(total, "total.limitPercent")
            percent_of = positive(total, "percentOf", "total.percentOf")
            high_water_mark = positive(total, "highWaterMark", "total.highWaterMark")
            total_floor = high_water_mark - percent / HUNDRED * percent_of
            if total.get("floorCap") is not None:
                floor_cap = positive(total, "floorCap", "total.floorCap")
                total_floor = min(total_floor, floor_cap)
            if equity > high_water_mark:
                notes.append("equity-above-high-water-mark")
        else:
            raise InputError("total.type", "format")
        total_room = equity - total_floor

    open_risk = optional_non_negative(data, "openRisk", "openRisk")
    buffer = optional_non_negative(data, "buffer", "buffer")

    if total_room is None or (daily_room is not None and daily_room <= total_room):
        room, binding = daily_room, "daily"
    else:
        room, binding = total_room, "total"
    room_for_new_trade = room - open_risk - buffer

    breached = (daily_floor is not None and equity <= daily_floor) or (
        total_floor is not None and equity <= total_floor)
    if breached:
        status = "breached"
    elif room_for_new_trade <= 0:
        status = "no-room"
    else:
        status = "ok"

    return {
        "status": status,
        "breached": breached,
        "dailyFloor": daily_floor,
        "dailyRoom": daily_room,
        "totalFloor": total_floor,
        "totalRoom": total_room,
        "room": room,
        "bindingLimit": binding,
        "openRisk": open_risk,
        "buffer": buffer,
        "roomForNewTrade": room_for_new_trade,
        "notes": notes,
    }


def size_with_guard(sizing, guard):
    room = calculate_loss_room(guard)
    capped = dict(sizing)
    capped["budgetCap"] = {"amount": room["roomForNewTrade"], "reason": room["bindingLimit"]}
    return {"room": room, "size": calculate_position_size(capped)}


# ---------------------------------------------------------------------------
# Running the golden cases
# ---------------------------------------------------------------------------

def as_text(value):
    """Fractions become "num/den" strings. Everything else stays as it is."""
    if isinstance(value, Fraction):
        return "%d/%d" % (value.numerator, value.denominator)
    if isinstance(value, dict):
        return {key: as_text(item) for key, item in value.items()}
    return value


def compute(case):
    """Run one case. Returns the result with numbers as "num/den" strings."""
    kind = case.get("kind")
    data = case.get("input")
    try:
        if kind == "size" or (kind == "error" and case.get("call") == "size"):
            result = calculate_position_size(data)
        elif kind == "room" or (kind == "error" and case.get("call") == "room"):
            result = calculate_loss_room(data)
        elif kind == "guarded":
            result = size_with_guard(data["sizing"], data["guard"])
        else:
            raise ValueError("unknown kind or call in case %r" % case.get("id"))
    except InputError as error:
        return {"error": {"field": error.field, "code": error.code}}
    return as_text(result)


def differences(expected, actual, path=""):
    """List every field where the expected and computed values differ."""
    if isinstance(expected, dict) and isinstance(actual, dict):
        found = []
        for key in list(expected) + [key for key in actual if key not in expected]:
            here = path + "." + key if path else key
            if key not in actual:
                found.append("%s: expected %s, but the result has no such field"
                             % (here, json.dumps(expected[key])))
            elif key not in expected:
                found.append("%s: missing from expected, computed %s"
                             % (here, json.dumps(actual[key])))
            else:
                found.extend(differences(expected[key], actual[key], here))
        return found
    if type(expected) is not type(actual) or expected != actual:
        return ["%s: expected %s, computed %s"
                % (path or "result", json.dumps(expected), json.dumps(actual))]
    return []


def invariant_problems(case, result):
    """Extra checks on a computed size result. They do not use `expected`."""
    if "error" in result:
        return []
    if case["kind"] == "size":
        size, instrument = result, case["input"]["instrument"]
    elif case["kind"] == "guarded":
        size, instrument = result["size"], case["input"]["sizing"]["instrument"]
    else:
        return []
    number = {key: Fraction(value) for key, value in size.items()
              if isinstance(value, str) and "/" in value}
    step = parse_decimal(instrument["lotStep"], "instrument.lotStep")
    min_lot = parse_decimal(instrument["minLot"], "instrument.minLot")
    problems = []
    if number["actualRisk"] > number["riskAmount"]:
        problems.append("invariant: actualRisk is above riskAmount")
    if number["riskBudget"] > 0 and number["actualRisk"] > number["riskBudget"]:
        problems.append("invariant: actualRisk is above riskBudget")
    if (number["lots"] / step).denominator != 1:
        problems.append("invariant: lots is not a multiple of lotStep")
    if number["lots"] != 0 and number["lots"] < min_lot:
        problems.append("invariant: lots is above zero but below minLot")
    if instrument.get("maxLot") is not None:
        if number["lots"] > parse_decimal(instrument["maxLot"], "instrument.maxLot"):
            problems.append("invariant: lots is above maxLot")
    return problems


def shape_problems(case, result):
    """Check that `expected` lists every result field, in a known shape."""
    expected = case.get("expected")
    if not isinstance(expected, dict):
        return ["expected is missing"]
    if case["kind"] == "error":
        if "error" not in result:
            return ["expected an error, but the calculation gave a result"]
        return []
    wanted = {"size": {"": SIZE_FIELDS}, "room": {"": ROOM_FIELDS},
              "guarded": {"room": ROOM_FIELDS, "size": SIZE_FIELDS}}[case["kind"]]
    problems = []
    for part, fields in wanted.items():
        block = expected.get(part, {}) if part else expected
        for field in fields:
            if not isinstance(block, dict) or field not in block:
                problems.append("expected%s has no field %s" % ("." + part if part else "", field))
    return problems


def load_cases():
    with open(CASES_FILE, encoding="utf-8") as handle:
        cases = json.load(handle)["cases"]
    seen = set()
    for case in cases:
        if case.get("id") in seen:
            raise ValueError("duplicate case id %r" % case.get("id"))
        if case.get("kind") not in ("size", "room", "guarded", "error"):
            raise ValueError("unknown kind in case %r" % case.get("id"))
        seen.add(case.get("id"))
    return cases


def main(arguments):
    if arguments and arguments[0] == "--print":
        if len(arguments) != 2:
            print("usage: reference.py [--print CASE_ID]")
            return 2
        for case in load_cases():
            if case["id"] == arguments[1]:
                print(json.dumps(compute(case), indent=2))
                return 0
        print("no case with id %r" % arguments[1])
        return 2
    if arguments:
        print("usage: reference.py [--print CASE_ID]")
        return 2

    cases = load_cases()
    failed = 0
    counts = {}
    for case in cases:
        counts[case["kind"]] = counts.get(case["kind"], 0) + 1
        result = compute(case)
        problems = shape_problems(case, result)
        problems += differences(case.get("expected", {}), result)
        problems += invariant_problems(case, result)
        if problems:
            failed += 1
            print("FAIL  %s" % case["id"])
            for problem in problems:
                print("      " + problem)
        else:
            print("PASS  %s" % case["id"])
    summary = ", ".join("%d %s" % (counts[kind], kind) for kind in sorted(counts))
    print("")
    print("%d cases (%s): %d passed, %d failed"
          % (len(cases), summary, len(cases) - failed, failed))
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except (OSError, ValueError, KeyError) as problem:
        print("could not run: %s" % problem)
        sys.exit(2)
