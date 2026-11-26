# Golden cases

This folder holds the worked examples that the Lotcheck calculations are tested against.

- `cases.json`: the cases. Each one has an input, the expected result, and the working in plain words.
- `reference.py`: a second implementation of the formulas, in Python. It recomputes every case.

The written rules that both implementations follow are in [`docs/how-it-works.md`](../../docs/how-it-works.md).

## What a golden case is

A golden case is one calculation worked out step by step.
The `working` field shows every step: the risk amount, the conversion rate and its direction, the loss per lot, the raw lot size, the rounding down, and the actual risk.

There are four kinds:

- `size`: a position size.
- `room`: the room left under a daily or total loss limit.
- `guarded`: a position size limited by that room.
- `error`: an input that must be rejected, with the field and the error code.

Every number in `expected` is an exact fraction written as `"numerator/denominator"` in lowest terms. For example `"1/2"` is 0.5 and `"100/1"` is 100. Nothing is rounded.

Seven cases, with ids starting `worked-`, repeat simple worked examples of the kind found in beginner guides. Their `working` field shows the simple method and where Lotcheck differs: it rounds down to the lot step, and in some cases it converts the loss at the stop price. A case can also name a `source`. No case has one at the moment.

## What the cross-check proves

The JavaScript code and the Python reference share no code. Both are run on every case, and both must give the expected exact fractions.

- It proves that two implementations of the same written rules agree on every case.
- It does not prove that the rules match every broker or firm. Contract sizes, fees and loss-limit rules differ. Check your own numbers in your platform.

If a case fails, do not change the case to match the code. Find out which side is wrong first.

## Run the Python cross-check

From the repository root:

```
python3 test/golden/reference.py
```

It prints `PASS` or `FAIL` for each case. A failed case lists each field that differs. The exit code is 0 when every case agrees.

To see the full computed result of one case as fractions:

```
python3 test/golden/reference.py --print own-pair-usdjpy-long
```

The script needs Python 3 and nothing else. It uses exact fractions only. It makes no network calls.

The same cases are also run against the JavaScript code:

```
node --test test/golden.test.js
```

## Add a case

1. Pick the inputs. Write all numbers as strings with a decimal point, for example `"1.0850"`.
2. Work the case out by hand from `docs/how-it-works.md`. Write every step into `working` in plain words.
3. Write the expected result. Include every result field. Write each number as a fraction in lowest terms. Fields that do not apply are `null`.
4. Give the case a new `id`, a short `title` and a `kind`. An `error` case also needs `"call": "size"` or `"call": "room"`, and its expected result is `{"error": {"field": "...", "code": "..."}}`.
5. Set `source` to `null`, or to the address of the public page the numbers come from. Only use numbers you read on that page. Say in `working` what the page shows and the month you read it. Keep the wording neutral.
6. Run the Python cross-check. If it disagrees with your working, find out which one is wrong before you change anything.
7. Run `node --test test/golden.test.js`.

Keep one fault per `error` case, so the expected field and code are not open to doubt.
