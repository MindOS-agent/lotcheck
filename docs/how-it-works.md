# How Lotcheck works

This page explains every formula Lotcheck uses, with worked examples. All the maths is exact. There is no rounding until the very end, and every rounding step is listed below.

## The idea in one sentence

You decide how much you are willing to lose on one trade. Lotcheck finds the biggest position size whose loss, if your stop is hit, stays within that amount.

## Words used here

- **Lot**: the trade size. 1.00 lot is a fixed number of units, set by the instrument.
- **Contract size**: how many units are in 1.00 lot. For many forex pairs it is 100,000.
- **Pip or point**: a small price move you choose as a unit. Lotcheck calls its size the pip size or point size.
- **Quote currency**: the currency your profit and loss on the instrument is counted in. For EURUSD it is USD.
- **Lot step**: the smallest change in size your broker allows. 0.01 is common.
- **Minimum lot**: the smallest size your broker allows.

## Step 1: how much you risk

If you choose a percent:

```
riskAmount = balance x percent / 100
```

If you choose a fixed amount, that amount is `riskAmount`.

## Step 2: the stop distance

```
priceDistance = |entry - stop|
stopDistance  = priceDistance + extraDistance
```

`extraDistance` is optional. It is for spread or slippage. It is in the same price units as your entry and stop, for example 0.0002 for EURUSD. It makes the loss per lot larger, so the size gets smaller.

The direction is "long" if the stop is below the entry, and "short" if it is above. Lotcheck only reports this. It does not suggest a direction.

## Step 3: the currency rate

Profit and loss on the instrument is in the quote currency. Your risk is in your account currency. If they differ, Lotcheck needs to convert. It uses two numbers:

- `rate`: how many units of your account currency one unit of the quote currency is worth, today. It is used for the value of one pip and for the margin.
- `lossRate`: the rate used to convert the loss at your stop. It is the same as `rate` in two of the three cases below.

There are three cases. Lotcheck picks the first one that fits.

**Case 1: same currency ("none").** The quote currency is your account currency. For example a USD account trading EURUSD. `rate = 1` and `lossRate = 1`. No price is needed.

**Case 2: your account currency is the first currency of the pair ("instrument").** For example a USD account trading USDJPY, or a EUR account trading EURUSD. Here the instrument is itself the conversion pair, so you do not type a price. The catch is the price at which the loss happens. If you are long USDJPY and the price falls, your loss in yen is converted into dollars at the lower price, where the trade closes, not at today's price. A fixed rate would understate the loss. So:

```
exitPrice = stop - extraDistance   (long)
          = stop + extraDistance   (short)
rate      = 1 / entry
lossRate  = 1 / exitPrice
```

The exit price must be above 0. This applies to every instrument type, not only forex. For example, a BTC account trading BTCUSD is also the "instrument" case.

Lotcheck finds this case from the base currency you enter. For forex pairs the "Base currency" field is required, and no lot size is shown while it is empty. Without it, Lotcheck could not tell that the instrument is itself the conversion pair, and the loss could be understated. If the base currency is not given at all, Lotcheck looks at the symbol: when it starts with your account currency followed by the quote currency (for example "USDJPY", "usd/jpy" or "USDJPY.m" in a USD account with JPY as the quote), it uses the "instrument" case. A base currency you enter always wins over the symbol. If you type a conversion price for a pair that the instrument itself is, Lotcheck rejects it.

In this case you enter the first currency of the pair in the "Base currency" field (for forex pairs) and leave the conversion card empty. The page tells you: "Your account currency is the first currency of this pair, so Lotcheck converts the loss at your stop-loss price. No extra price is needed."

**Case 3: any other pair ("pair").** For example a USD account trading EURGBP. You type the market price of a currency pair made of exactly your account currency and the quote currency (here GBPUSD or USDGBP). A pair has a base (the first currency) and a quote (the second). The price tells you how many quote units one base unit costs.

- Pair base is the quote currency and pair quote is your account currency: `rate = price`.
- Pair base is your account currency and pair quote is the quote currency: `rate = 1 / price`.
- Any other pair is rejected.
- `lossRate = rate`.

The conversion price of a cross pair can move before your stop is hit, and the real loss moves with it. The page says so under the result: "The conversion price can move before your stop is hit. The real loss moves with it." In the "instrument" case the page says: "The loss is converted at your stop-loss price, so it is a little different from pips times pip value."

Check the direction with the sentence the page shows, for example "1 USD = 0.90909 EUR" (a EUR account, a conversion price of 1.1000 for EURUSD, so `rate = 1/1.1`). The rate is shown with 6 significant digits, rounded down, with no padding. In the "instrument" case no rate sentence is shown, because there is no price to check. If the sentence looks wrong, the rate is upside down.

## Step 4: the loss per lot

```
lossPerLot = stopDistance x contractSize x lossRate + commissionPerLot
```

This is what 1.00 lot loses if the stop is hit, in your account currency, including commission if you entered it.

## Step 5: the lot size

```
rawLots = riskBudget / lossPerLot
lots    = rawLots rounded DOWN to the lot step
```

`riskBudget` is `riskAmount`, unless a loss-room cap is lower (see below).

Then, in this order:

1. If the budget is zero or less, there is no size (`no-budget`).
2. If you entered a maximum lot and the size is above it, the size is cut to the maximum (rounded down to the lot step).
3. If the size is below the minimum lot, there is no size (`below-minimum`). **Lotcheck never rounds up to the minimum lot.** Rounding up would risk more than you chose. The page says: "At this stop distance, no allowed size fits your risk. Lotcheck does not round up to the minimum."
4. Otherwise the size is fine (`ok`).

The minimum lot must be a whole number of lot steps. A minimum of 0.01 with a step of 0.01 is fine. A minimum of 0.05 with a step of 0.02 is rejected, because no size on the step grid would equal the minimum. The maximum lot may be off the grid. It is rounded down to the lot step.

## Step 6: what you really risk

Because the size is rounded down, the planned loss at your stop is a little less than, or equal to, your chosen risk. Gaps and slippage can still make the real loss larger.

```
actualRisk        = lots x lossPerLot
actualRiskPercent = actualRisk / balance x 100
commissionTotal   = lots x commissionPerLot
lossAtMinLot      = minLot x lossPerLot
```

`actualRisk` is never larger than the risk budget.

## Step 7: the check line

```
pipValuePerLot = pipSize x contractSize x rate
stopPips       = priceDistance / pipSize
```

`pipValuePerLot` is what 1.00 lot gains or loses when the price moves by one pip or point. Compare it with your platform. If it differs, a number you entered is wrong.

## Step 8: margin (optional)

```
notional = lots x contractSize x entry x rate
margin   = notional / leverage
```

Enter leverage as the number after the colon. For 1:30, enter 30. Margin is only shown if you enter leverage. Margin is an estimate from the one leverage figure you enter. Brokers may use a different margin rate for each instrument, so your platform's figure can differ.

## Step 9: the loss-room cap (optional)

If you trade an account with loss limits, Lotcheck can limit the risk to the room left under those limits.

```
dailyFloor  = dayStartValue - limitPercent / 100 x percentOf
dailyRoom   = currentEquity - dailyFloor

totalFloor  = initialBalance - limitPercent / 100 x initialBalance        (static)
            = highWaterMark  - limitPercent / 100 x percentOf             (trailing)
              if a floor cap is set: totalFloor = the smaller of totalFloor and floorCap
totalRoom   = currentEquity - totalFloor

room            = the smaller of the rooms that exist
roomForNewTrade = room - openRisk - buffer
```

The floor is the equity level at which the limit is broken. The room is how far above the floor you are. `openRisk` is the further loss if every open trade hits its stop. `buffer` is room you want to keep unused.

If a size uses all of the room (including when your own risk and the room are exactly equal), a stop-out ends exactly on the floor, and the limit counts as reached (equity at or below the floor is breached). Many firms count that as a breach. The page shows this note: "This size uses all of the room you entered. If the stop is hit, the account ends exactly on the limit, and many firms count that as a breach. Use "Room to keep unused" to stay clear of it."

For a trailing floor, if your current equity is above the highest value you entered, the page shows: "Your current equity is above the highest value you entered. If your firm's floor follows equity, the highest value must be at least your current equity, or the room shown here is too large." It is a note, not an error, because some firms trail on closed balance only.

If your equity is at or below a floor, the status is "breached" and no size is shown. If `roomForNewTrade` is zero or less, the status is "no room".

The size is then worked out with a budget of:

```
riskBudget = the smaller of riskAmount and roomForNewTrade
```

The result says which one limited it: "Your risk setting", "Your daily loss limit" or "Your total loss limit".

See [loss-limits.md](loss-limits.md) for how to fill in these fields from your own firm's rules.

## Input rules

- **Numbers.** Use digits and one dot only, for example 0.5. No commas, no thousands separators, no percent sign. Type the number only, without the % sign.
- **Whitespace.** Spaces, tabs and line breaks at the start or end of a number, a symbol or a currency code are ignored. Any other invisible character there (for example a no-break space that came along when you copied a number from a web page) makes the number invalid. Retype it.
- **Base currency and symbol.** If you enter a base currency, and the symbol (letters and digits only, any case) starts with your account currency followed by the quote currency, the base currency must be your account currency. For a USD account trading USDJPY with JPY as the quote, a base currency of EUR is rejected: "The base currency does not match the symbol. For USDJPY the base currency is USD." In every other case a base currency you enter wins over the symbol.
- **Symbols with a prefix or suffix.** Lotcheck reads a plain symbol such as USDJPY, usd/jpy or USDJPY.m. A symbol with a letter in front, such as mUSDJPY, is not detected from the symbol, so enter the base currency yourself.

## Notes and cautions

The page shows these short notes under the result when they apply.

- "Spread and slippage are not included." This shows when the extra distance is zero.
- "Commission is not included." This shows when the commission is zero.
- Always, under the result: "Swaps, financing and fees charged as a percent of the trade are never included."
- "You are risking more than 2% of the account on one trade."
- "The margin for this size is more than your balance."
- "Limited to your broker's maximum lot size."
- "Your stop is less than one pip or point away from your entry. Check both prices."
- "This size uses all of the room you entered. If the stop is hit, the account ends exactly on the limit, and many firms count that as a breach. Use "Room to keep unused" to stay clear of it." This shows whenever a loss-room cap is on and the planned loss equals the room exactly. That includes the case where your own risk and the room are the same amount.

## Rounding rules

All maths is exact. Rounding happens only when a number is shown, or when the size is fitted to the lot step.

- **Lot size: down**, to the lot step.
- **Money you can lose: up.** Real risk, loss at the minimum lot, commission and margin are rounded up.
- **Money you have available: down.** Risk budget, loss-room figures and the value of one pip are rounded down.
- Money is shown with 2 decimals, or 0 for JPY accounts. If an amount above zero would print as 0.00, or with fewer than two significant digits (for example 0.0004 BTC), the page prints enough decimals to show its first two significant digits, with the same rounding direction. Percentages are shown with 2 decimals, rounded up. Pips are shown with 1 decimal, rounded down.

The aim is that a displayed loss is never smaller than the real one, and a displayed budget is never larger than the real one.

## Worked examples

All amounts are simple on purpose. Check them by hand.

### Example 1: EURUSD in a USD account

- Account currency USD, balance 10,000, risk 1%.
- EURUSD: quote currency USD, contract size 100,000, pip size 0.0001, minimum lot 0.01, lot step 0.01.
- Entry 1.0850, stop 1.0830. No commission, no extra distance.

Working:

1. `riskAmount = 10,000 x 1 / 100 = 100` USD.
2. `priceDistance = 1.0850 - 1.0830 = 0.0020`. The stop is below the entry, so the direction is long.
3. Quote currency equals account currency, so `rate = 1`.
4. `lossPerLot = 0.0020 x 100,000 x 1 = 200` USD.
5. `rawLots = 100 / 200 = 0.5`. Already on the 0.01 step, so `lots = 0.50`.
6. `actualRisk = 0.50 x 200 = 100` USD, which is 1.00% of the balance.

Check line: `pipValuePerLot = 0.0001 x 100,000 x 1 = 10` USD per pip. `stopPips = 0.0020 / 0.0001 = 20` pips. A 20-pip stop at 10 USD per pip is 200 USD per lot. Same as step 4.

With 30:1 leverage, `notional = 0.50 x 100,000 x 1.0850 = 54,250` USD, and `margin = 54,250 / 30 = 1,808.33...`, shown rounded up as 1,808.34.

**A wider stop shows the rounding.** Use a stop of 1.0820 instead. The distance is 0.0030 (30 pips) and `lossPerLot = 300`. Then `rawLots = 100 / 300 = 0.3333...`. Rounded down to the step, `lots = 0.33`. `actualRisk = 0.33 x 300 = 99` USD. It is a little under 100, never over.

**Commission.** Go back to the 20-pip stop and add a commission of 7 USD per lot, round trip. `lossPerLot = 200 + 7 = 207`. `rawLots = 100 / 207 = 0.4831...`, so `lots = 0.48`. `commissionTotal = 0.48 x 7 = 3.36`. `actualRisk = 0.48 x 207 = 99.36` USD. The commission is part of the loss, so the size is smaller.

### Example 2: EURUSD in a EUR account (account currency is the first currency)

- Account currency EUR, balance 10,000, risk 1%.
- Same EURUSD contract. Base currency EUR, quote currency USD. The base currency is your account currency, so this is the "instrument" case. No conversion price is typed.
- Entry 1.1000, stop 1.0980, long. No extra distance.

Working:

1. `riskAmount = 10,000 x 1 / 100 = 100` EUR.
2. `priceDistance = 1.1000 - 1.0980 = 0.0020`.
3. `exitPrice = stop = 1.0980`. `rate = 1 / 1.1000 = 10/11` (about 0.90909) and `lossRate = 1 / 1.0980 = 1000/1098`, about 0.910747. One USD is worth about 0.9091 EUR today, but about 0.9107 EUR at the stop price. The loss is converted at the stop price.
4. `lossPerLot = 0.0020 x 100,000 x 1/1.0980 = 200 / 1.0980 = 100000/549`, about 182.15 EUR.
5. `rawLots = 100 / (100000/549) = 549/1000 = 0.549`. Rounded down to the step, `lots = 0.54`.
6. `actualRisk = 0.54 x 100000/549 = 6000/61`, about 98.36 EUR, which is 0.99% of the balance (rounded up).

Check line: `pipValuePerLot = 0.0001 x 100,000 x 10/11 = 100/11`, about 9.09 EUR per pip (rounded down). The check line uses `rate`, today's price.

**Why the stop price matters.** If Lotcheck had used the fixed rate 10/11 for the loss, `lossPerLot` would be 200 x 10/11 = 181.82 and the size would be 0.55 lots. At 0.55 lots the real loss at the stop is `0.55 x 100000/549 = 100.18` EUR, a little over the 100 you chose. The stop-price conversion gives 0.54 lots instead.

### Example 2b: USDJPY in a USD account (the same effect, larger)

- Account currency USD, balance 10,000, risk 1%, so `riskAmount = 100` USD.
- USDJPY: base currency USD, quote currency JPY, contract size 100,000, minimum lot 0.01, lot step 0.01.
- Entry 150.00, stop 145.00, long. No extra distance.

Working:

1. `priceDistance = 5.00` yen per USD.
2. Base currency equals the account currency, so this is the "instrument" case. `exitPrice = 145.00`, `lossRate = 1/145`.
3. `lossPerLot = 5 x 100,000 / 145 = 100000/29`, about 3,448.28 USD.
4. `rawLots = 100 x 29 / 100,000 = 0.029`. Rounded down, `lots = 0.02`.
5. `actualRisk = 0.02 x 100000/29 = 2000/29`, about 68.97 USD.

With the old fixed rate (`1/150`, today's price), `lossPerLot` would be 3,333.33 and the size would be 0.03 lots. At the stop, 0.03 lots lose 0.03 x 100,000 x 5.00 = 15,000 yen. At the stop price of 145.00 that is 15,000 / 145, which is `0.03 x 100000/29 = 103.45` USD. That is more than the 100 USD chosen. Converting at the stop price gives 0.02 lots, which stays inside the risk.

### Example 2c: EURGBP in a USD account (a conversion price is typed)

- Account currency USD, balance 10,000, risk 1%, so `riskAmount = 100` USD.
- EURGBP: base EUR, quote GBP, contract size 100,000, pip size 0.0001. Neither currency is USD, so this is the "pair" case.
- Entry 0.8500, stop 0.8480, so `priceDistance = 0.0020`.
- You look up GBPUSD. Its price is 1.2500, meaning 1 GBP costs 1.2500 USD.

Working:

1. The pair's base (GBP) is the quote currency, and its quote (USD) is your account currency. So `rate = price = 1.2500`, and `lossRate = rate`. The page shows "1 GBP = 1.25 USD".
2. `lossPerLot = 0.0020 x 100,000 x 1.2500 = 250` USD.
3. `rawLots = 100 / 250 = 0.4`, so `lots = 0.40`. `actualRisk = 0.40 x 250 = 100` USD.
4. `pipValuePerLot = 0.0001 x 100,000 x 1.2500 = 12.5` USD per pip.

If you typed the price upside down (0.8 instead of 1.25), the size would be about 55% too big (the page would show 0.62 lots instead of 0.40). Always read the "1 GBP = ..." sentence and ask whether it is plausible.

### Example 3: an index, and why contract size matters

- Account currency USD, balance 10,000, risk 1%, so `riskAmount = 100` USD.
- An index whose quote currency is USD. Pip (point) size 1. Minimum lot 0.01, lot step 0.01.
- Entry 5,000, stop 4,990. `priceDistance = 10` points. `rate = 1`.

The only thing that changes below is the contract size, which means "units per point per lot".

| Contract size | lossPerLot = 10 x size | rawLots = 100 / lossPerLot | lots | Value of 1 point per lot |
|---|---|---|---|---|
| 1 | 10 | 10 | 10.00 | 1 USD |
| 10 | 100 | 1 | 1.00 | 10 USD |
| 100 | 1,000 | 0.1 | 0.10 | 100 USD |

Each row risks exactly 100 USD. But the lot sizes are 10.00, 1.00 and 0.10. If your broker's contract size is 100 and you enter 1, Lotcheck would say 10.00 lots, which is 100 times too big. That trade would lose 10,000 USD at the stop, not 100. This is why Lotcheck shows the check line and asks you to tick the confirmation box for indices.

**When the minimum lot is too big.** Take contract size 100 and a minimum lot of 0.50. The size is 0.10, which is below 0.50, so the status is "below minimum" and no size is shown. `lossAtMinLot = 0.50 x 1,000 = 500` USD, which is more than the 100 USD you chose. Lotcheck does not round up to 0.50. The page says: "At this stop distance, no allowed size fits your risk. Lotcheck does not round up to the minimum."

### Example 4: a loss-room example with the daily limit binding

The account rules you enter, taken from your own firm's rules:

- Starting balance and day-start value: 10,000 USD.
- Daily limit: 5% of 10,000.
- Total limit (static): 10% of 10,000.

Right now:

- Current equity is 9,700 USD. The balance is also 9,700.
- Open risk: 30 USD (an open trade would lose 30 USD more if its stop is hit).
- Buffer: 50 USD that you want to keep unused.
- Risk setting: 2% of the balance. Trade: EURUSD as in Example 1 (20-pip stop, `lossPerLot = 200`), USD account.

Working:

1. `dailyFloor = 10,000 - 5 / 100 x 10,000 = 9,500`. `dailyRoom = 9,700 - 9,500 = 200`.
2. `totalFloor = 10,000 - 10 / 100 x 10,000 = 9,000`. `totalRoom = 9,700 - 9,000 = 700`.
3. `room = the smaller of 200 and 700 = 200`. The binding limit is the daily limit.
4. `roomForNewTrade = 200 - 30 - 50 = 120` USD.
5. `riskAmount = 9,700 x 2 / 100 = 194` USD. That is more than 120, so `riskBudget = 120` and the result row "Limited by" says "Your daily loss limit".
6. `rawLots = 120 / 200 = 0.6`, so `lots = 0.60`.
7. `actualRisk = 0.60 x 200 = 120` USD. As a percent of the balance: `120 / 9,700 x 100 = 1.2371...`, shown rounded up as 1.24%.

Without the loss limits, the same trade would risk 194 USD and the size would be 0.97 lots. The daily limit cuts it to 0.60 lots, so that the planned loss at your stop stays inside the room you entered. Gaps and slippage can still make the loss larger.

**Trailing floor.** The room assumes the floor does not move while the trade is open. See [loss-limits.md](loss-limits.md). For a trailing total limit with a high-water mark of 10,400, a limit of 10% and "percent of" 10,000, `totalFloor = 10,400 - 10 / 100 x 10,000 = 9,400`. The floor rises when the high-water mark rises. If your firm stops the floor at a fixed level, enter that level as the floor cap. The floor is then the smaller of the two numbers.

## What these formulas do not know

- They do not know your broker's real fees, swaps or slippage beyond what you enter.
- A stop-loss does not guarantee the loss. A gap can fill you past your stop.
- Margin rules differ between brokers.
- Your firm's rules may count things differently from the way you entered them. Check the questions in [loss-limits.md](loss-limits.md).
