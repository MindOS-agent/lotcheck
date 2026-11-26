// Loss room: how much more you can lose before you hit an account loss limit.
// Every calculation uses the exact Q type from rational.js.

import { Q, InputError, parseDecimal } from "./rational.js";
import { calculatePositionSize } from "./sizing.js";

function guardFail(message, field, code) {
  return new InputError(message, field, code);
}

function guardIsObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function guardIsMissing(value) {
  return value === undefined || value === null;
}

function guardRequireDecimal(value, path) {
  if (guardIsMissing(value)) {
    throw guardFail("This field is required.", path, "empty");
  }
  return parseDecimal(value, path);
}

function guardRequirePositive(value, path) {
  const q = guardRequireDecimal(value, path);
  if (!q.isPositive()) {
    throw guardFail("This must be more than zero.", path, "range");
  }
  return q;
}

function guardOptionalNonNegative(value, path) {
  if (guardIsMissing(value)) return Q.ZERO;
  const q = parseDecimal(value, path);
  if (q.isNegative()) {
    throw guardFail("This cannot be negative.", path, "range");
  }
  return q;
}

function guardRequirePercent(value, path) {
  const q = guardRequirePositive(value, path);
  if (q.gt(Q.HUNDRED)) {
    throw guardFail("A limit cannot be more than 100 percent.", path, "range");
  }
  return q;
}

function guardParseDaily(daily) {
  if (guardIsMissing(daily)) return null;
  if (!guardIsObject(daily)) {
    throw guardFail("This section must be an object.", "daily", "format");
  }
  return {
    limitPercent: guardRequirePercent(daily.limitPercent, "daily.limitPercent"),
    percentOf: guardRequirePositive(daily.percentOf, "daily.percentOf"),
    dayStartValue: guardRequirePositive(daily.dayStartValue, "daily.dayStartValue"),
  };
}

function guardParseTotal(total) {
  if (guardIsMissing(total)) return null;
  if (!guardIsObject(total)) {
    throw guardFail("This section must be an object.", "total", "format");
  }
  if (total.type !== "static" && total.type !== "trailing") {
    throw guardFail('The type must be "static" or "trailing".', "total.type", "format");
  }
  const limitPercent = guardRequirePercent(total.limitPercent, "total.limitPercent");
  const floorCap = guardIsMissing(total.floorCap)
    ? null
    : guardRequirePositive(total.floorCap, "total.floorCap");
  if (total.type === "static") {
    return {
      type: "static",
      limitPercent,
      initialBalance: guardRequirePositive(total.initialBalance, "total.initialBalance"),
      floorCap,
    };
  }
  return {
    type: "trailing",
    limitPercent,
    percentOf: guardRequirePositive(total.percentOf, "total.percentOf"),
    highWaterMark: guardRequirePositive(total.highWaterMark, "total.highWaterMark"),
    floorCap,
  };
}

export function calculateLossRoom(input) {
  if (!guardIsObject(input)) {
    throw guardFail("Loss room input is required.", null, "empty");
  }
  if (guardIsMissing(input.daily) && guardIsMissing(input.total)) {
    throw guardFail("Fill in at least one loss limit, daily or total.", null, "no-rule");
  }
  const currentEquity = guardRequirePositive(input.currentEquity, "currentEquity");
  const daily = guardParseDaily(input.daily);
  const total = guardParseTotal(input.total);
  const openRisk = guardOptionalNonNegative(input.openRisk, "openRisk");
  const buffer = guardOptionalNonNegative(input.buffer, "buffer");

  let dailyFloor = null;
  let dailyRoom = null;
  if (daily !== null) {
    dailyFloor = daily.dayStartValue.sub(daily.limitPercent.div(Q.HUNDRED).mul(daily.percentOf));
    dailyRoom = currentEquity.sub(dailyFloor);
  }

  let totalFloor = null;
  let totalRoom = null;
  if (total !== null) {
    if (total.type === "static") {
      totalFloor = total.initialBalance.sub(
        total.limitPercent.div(Q.HUNDRED).mul(total.initialBalance)
      );
    } else {
      totalFloor = total.highWaterMark.sub(
        total.limitPercent.div(Q.HUNDRED).mul(total.percentOf)
      );
    }
    if (total.floorCap !== null) totalFloor = Q.min(totalFloor, total.floorCap);
    totalRoom = currentEquity.sub(totalFloor);
  }

  let room;
  let bindingLimit;
  if (dailyRoom !== null && totalRoom !== null) {
    if (totalRoom.lt(dailyRoom)) {
      room = totalRoom;
      bindingLimit = "total";
    } else {
      room = dailyRoom;
      bindingLimit = "daily";
    }
  } else if (dailyRoom !== null) {
    room = dailyRoom;
    bindingLimit = "daily";
  } else {
    room = totalRoom;
    bindingLimit = "total";
  }

  const roomForNewTrade = room.sub(openRisk).sub(buffer);
  const breached =
    (dailyFloor !== null && currentEquity.lte(dailyFloor)) ||
    (totalFloor !== null && currentEquity.lte(totalFloor));
  const status = breached ? "breached" : roomForNewTrade.lte(Q.ZERO) ? "no-room" : "ok";

  const notes = [];
  if (total !== null && total.type === "trailing" && currentEquity.gt(total.highWaterMark)) {
    notes.push("equity-above-high-water-mark");
  }

  return {
    status,
    breached,
    dailyFloor,
    dailyRoom,
    totalFloor,
    totalRoom,
    room,
    bindingLimit,
    openRisk,
    buffer,
    roomForNewTrade,
    notes,
  };
}

export function sizeWithGuard(sizingInput, guardInput) {
  const room = calculateLossRoom(guardInput);
  const size = calculatePositionSize({
    ...sizingInput,
    budgetCap: { amount: room.roomForNewTrade, reason: room.bindingLimit },
  });
  return { room, size };
}
