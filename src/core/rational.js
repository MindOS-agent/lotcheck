// Exact numbers for Lotcheck.
//
// All money maths goes through the Q type below: a fraction of two BigInts.
// Nothing here uses floating point, so 0.1 + 0.2 is exactly 0.3.

export class InputError extends Error {
  constructor(message, field, code) {
    super(message);
    this.name = "InputError";
    this.field = field === undefined ? null : field;
    this.code = code;
  }
}

const rationalDecimalPattern = /^-?(\d+\.?\d*|\.\d+)$/;
const rationalMaxLength = 40;
const rationalEdgeBlanks = /^[ \t\n\r]+|[ \t\n\r]+$/g;

/**
 * Remove leading and trailing space, tab, line feed and carriage return.
 * Nothing else is removed (a no-break space or a byte-order mark stays).
 */
export function trimInputText(text) {
  return text.replace(rationalEdgeBlanks, "");
}

function rationalGcd(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

// Division that rounds toward negative infinity (BigInt "/" truncates toward zero).
function rationalFloorDiv(a, b) {
  const q = a / b;
  const r = a % b;
  return r !== 0n && (r < 0n) !== (b < 0n) ? q - 1n : q;
}

function rationalCeilDiv(a, b) {
  return -rationalFloorDiv(-a, b);
}

/**
 * Parse a plain decimal string into an exact Q.
 * Accepts "12", "-3.5", ".5", "5.". Rejects commas, exponents, signs other
 * than a leading minus, and anything longer than 40 characters.
 */
export function parseDecimal(text, field) {
  const where = field === undefined ? null : field;
  if (typeof text !== "string") {
    throw new InputError("Enter a number.", where, "format");
  }
  const s = trimInputText(text);
  if (s === "") {
    throw new InputError("Enter a number.", where, "empty");
  }
  if (s.includes(",")) {
    throw new InputError(
      "Use a dot for decimals and no thousands separators, for example 10000.50.",
      where,
      "comma"
    );
  }
  if (s.length > rationalMaxLength || !rationalDecimalPattern.test(s)) {
    throw new InputError("This is not a valid number.", where, "format");
  }
  const negative = s.startsWith("-");
  const body = negative ? s.slice(1) : s;
  const dot = body.indexOf(".");
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const fracPart = dot === -1 ? "" : body.slice(dot + 1);
  let num = BigInt((intPart + fracPart) || "0");
  const den = 10n ** BigInt(fracPart.length);
  if (negative) num = -num;
  return new Q(num, den);
}

export class Q {
  #n;
  #d;

  constructor(num, den = 1n) {
    if (typeof num !== "bigint" || typeof den !== "bigint") {
      throw new TypeError("Q needs BigInt parts. Use Q.of() for other values.");
    }
    if (den === 0n) throw new RangeError("Denominator cannot be zero.");
    if (den < 0n) {
      num = -num;
      den = -den;
    }
    const g = rationalGcd(num, den);
    if (g > 1n) {
      num /= g;
      den /= g;
    }
    this.#n = num;
    this.#d = den;
    Object.freeze(this);
  }

  static of(x) {
    if (x instanceof Q) return x;
    if (typeof x === "bigint") return new Q(x, 1n);
    if (typeof x === "number") {
      if (!Number.isSafeInteger(x)) {
        throw new TypeError("Q.of accepts only safe integers as numbers. Pass a decimal string instead.");
      }
      return new Q(BigInt(x), 1n);
    }
    if (typeof x === "string") return parseDecimal(x, null);
    throw new TypeError("Cannot make a Q from this value.");
  }

  static min(...qs) {
    if (qs.length === 0) throw new RangeError("Q.min needs at least one value.");
    let best = Q.of(qs[0]);
    for (let i = 1; i < qs.length; i++) {
      const q = Q.of(qs[i]);
      if (q.lt(best)) best = q;
    }
    return best;
  }

  static max(...qs) {
    if (qs.length === 0) throw new RangeError("Q.max needs at least one value.");
    let best = Q.of(qs[0]);
    for (let i = 1; i < qs.length; i++) {
      const q = Q.of(qs[i]);
      if (q.gt(best)) best = q;
    }
    return best;
  }

  add(o) {
    const b = Q.of(o);
    return new Q(this.#n * b.#d + b.#n * this.#d, this.#d * b.#d);
  }

  sub(o) {
    const b = Q.of(o);
    return new Q(this.#n * b.#d - b.#n * this.#d, this.#d * b.#d);
  }

  mul(o) {
    const b = Q.of(o);
    return new Q(this.#n * b.#n, this.#d * b.#d);
  }

  div(o) {
    const b = Q.of(o);
    if (b.#n === 0n) throw new RangeError("Division by zero.");
    return new Q(this.#n * b.#d, this.#d * b.#n);
  }

  neg() {
    return new Q(-this.#n, this.#d);
  }

  abs() {
    return this.#n < 0n ? this.neg() : this;
  }

  cmp(o) {
    const b = Q.of(o);
    const left = this.#n * b.#d;
    const right = b.#n * this.#d;
    return left < right ? -1 : left > right ? 1 : 0;
  }

  eq(o) {
    return this.cmp(o) === 0;
  }
  lt(o) {
    return this.cmp(o) < 0;
  }
  lte(o) {
    return this.cmp(o) <= 0;
  }
  gt(o) {
    return this.cmp(o) > 0;
  }
  gte(o) {
    return this.cmp(o) >= 0;
  }

  isZero() {
    return this.#n === 0n;
  }
  isNegative() {
    return this.#n < 0n;
  }
  isPositive() {
    return this.#n > 0n;
  }

  /** Largest multiple of step that is <= this. Needs this >= 0 and step > 0. */
  floorToStep(step) {
    const s = Q.of(step);
    if (this.#n < 0n) throw new RangeError("floorToStep needs a value of zero or more.");
    if (s.#n <= 0n) throw new RangeError("floorToStep needs a step above zero.");
    const count = (this.#n * s.#d) / (this.#d * s.#n);
    return s.mul(count);
  }

  /** "num/den" in lowest terms. Always shows the denominator. */
  toFraction() {
    return `${this.#n}/${this.#d}`;
  }

  /** Decimal string with exactly dp digits after the point. mode is "down" or "up". */
  toFixed(dp, mode) {
    if (!Number.isInteger(dp) || dp < 0 || dp > 20) {
      throw new RangeError("dp must be a whole number from 0 to 20.");
    }
    if (mode !== "down" && mode !== "up") {
      throw new RangeError('mode must be "down" or "up".');
    }
    const scale = 10n ** BigInt(dp);
    const scaled =
      mode === "down"
        ? rationalFloorDiv(this.#n * scale, this.#d)
        : rationalCeilDiv(this.#n * scale, this.#d);
    const negative = scaled < 0n;
    const digits = (negative ? -scaled : scaled).toString().padStart(dp + 1, "0");
    const intText = dp === 0 ? digits : digits.slice(0, digits.length - dp);
    const text = dp === 0 ? intText : `${intText}.${digits.slice(digits.length - dp)}`;
    return negative ? `-${text}` : text;
  }

  /** Digits after the point if this is a finite decimal, else null. */
  decimalPlaces() {
    let d = this.#d;
    let twos = 0;
    let fives = 0;
    while (d % 2n === 0n) {
      d /= 2n;
      twos++;
    }
    while (d % 5n === 0n) {
      d /= 5n;
      fives++;
    }
    if (d !== 1n) return null;
    return twos > fives ? twos : fives;
  }
}

function rationalDefineConstant(name, value) {
  Object.defineProperty(Q, name, {
    value: Q.of(value),
    writable: false,
    configurable: false,
    enumerable: true,
  });
}

rationalDefineConstant("ZERO", 0n);
rationalDefineConstant("ONE", 1n);
rationalDefineConstant("HUNDRED", 100n);
