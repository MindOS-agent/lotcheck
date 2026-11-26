# The toolkit

Lotcheck is the first module of a planned toolkit of small, honest tools for people who are learning to trade. **Only Lotcheck exists today.** Everything else on this page is a plan.

## The idea

Beginners often meet three problems: they size trades by feel, they judge themselves on a handful of trades, and they do not understand how fast a losing run can empty an account. Each module in the toolkit addresses one of these, with plain language and no promises about results.

## Design rules for every module

1. **Offline first.** Each module is a single file that runs in a browser with no connection.
2. **No data leaves the device.** No analytics, no tracking, no accounts on a server.
3. **Exact maths.** Money is never calculated with floating-point numbers. The shared core uses exact rational numbers.
4. **Golden cases with a cross-check.** Every formula has hand-worked cases. A second program, written in another language, follows the same written rules in `docs/how-it-works.md`. The cross-check shows that two implementations of the same written rules agree on every case. It does not prove that the rules match every broker or firm.
5. **Plain language.** A beginner can read every screen. Short sentences, no jargon without an explanation.
6. **No advice.** No signals, no direction, no promises about any trade.
7. **No dependencies and no third-party code.** What runs is what is in the repository.
8. **Checkable downloads.** Each release has a checksum.

## Planned modules

None of these are built yet.

- **Statement reader.** Reads a trade-history export from a trading platform and turns it into a clean list of trades, locally in the browser.
- **Honest stats report.** Works out win rate, average win and loss, drawdown and similar figures from a trade list. It warns when there are too few trades for the numbers to mean much.
- **Risk-of-ruin explainer.** Shows, with simple simulations and exact examples, how risk per trade and losing runs relate to the chance of losing a large part of an account.
- **Optional read-only account import.** For users who register their own application with a broker's API, an optional way to bring trade history in without exporting a file. It would be read-only, would use the user's own credentials stored only on their device, and would be off unless the user turns it on. It would not place orders.

## The shared core

The calculation core in `src/core` is plain JavaScript with no dependencies. It has:

- an exact rational number type, `Q`, with strict decimal parsing,
- the position-size formulas,
- the loss-room formulas.

New modules are meant to reuse the exact number type and to follow the same testing rules: a hand-worked golden case for every formula, agreed by two implementations of the same written rules. See [CONTRIBUTING.md](../CONTRIBUTING.md).

## Module layout

Each future module is one folder with its own page and script. It reuses `src/core` and gets its own single-file build. The build script will take a module name when the second module arrives. Until then there is one module, Lotcheck, and one build.

## What the toolkit will not become

It will not place trades, sell signals, rank brokers or firms, or hold your account details on a server.
