# Changelog

All notable changes to this project are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

First version.

### Added
- Position-size calculator as one self-contained offline page, `dist/lotcheck.html`.
- Size from account balance, risk (percent or fixed amount), entry and stop. Sizes are rounded down to the lot step and never rounded up to the minimum lot. The minimum lot must be a whole number of lot steps.
- A check line showing the value of one pip or point per 1.00 lot. A confirmation tick box is required for every instrument type before a lot size is shown.
- Pre-fill of typical values only for recognised currency pairs, never for metals, commodities, indices or crypto.
- Account-currency conversion. For a cross pair you type a price and the page shows the rate back to you. When the instrument is itself the pair of your account currency and the quote currency, the loss is converted at your stop-loss price and no price is typed. The base currency is required for forex pairs and optional for other types. The own-pair case is also detected from a plain symbol, and a base currency that contradicts the symbol is rejected.
- Optional extra distance for spread or slippage, optional commission per lot, optional leverage with an estimated margin. Notes say when spread or commission is left at zero, and that swaps, financing and percentage fees are never included.
- Optional loss-room cap for accounts with daily and total (fixed or trailing) loss limits. Rules count whether the card is open or collapsed, and a half-filled rule blocks the lot size. A status line says which rules are applied.
- Notes for a size that uses all of the loss room, for equity above the highest value entered, and for a trailing floor that is treated as a snapshot.
- Honest lines under the result about conversion at the stop price, a conversion price that can move, and a stop closer than one pip or point.
- Exact arithmetic core with an exact rational number type. No floating-point maths. Numbers are trimmed of spaces, tabs and line breaks only.
- Unit tests, property tests and hand-worked golden cases, with a second implementation in Python that follows the same written rules.
- Reproducible build with a strict Content-Security-Policy using script and style hashes, and `dist/SHA256SUMS`.
- Optional, off-by-default local storage of account-setting and instrument inputs under one key. Balance, prices, commission and loss-limit values are never saved.
- Documentation: how the formulas work, how to find your numbers, loss limits, toolkit plan.
