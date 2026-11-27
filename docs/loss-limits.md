# Loss limits

Some accounts have rules that stop you if your account falls too far. Prop-firm challenges often have them. Lotcheck can limit the size of a trade so that the planned loss at your stop stays inside the room you entered. Gaps and slippage can still make the loss larger. This page explains the terms and where each answer goes in Lotcheck.

Lotcheck ships no firm rules and quotes no firm's numbers. Rules differ between firms and they change. Take every number from your own firm's current rule page, and re-check it if the rules are updated.

## Common names

Firms use different words for the same ideas.

- **Max daily loss** is the daily loss limit.
- **Max drawdown** is usually a fixed (static) total limit.
- **Trailing drawdown** is a trailing total limit.
- **The floor** is the account value you must stay above. A limit is broken when your account falls to the floor.

In Lotcheck the total limit toggle has "Fixed floor" and "Trailing floor". The page hints at the same names: "Often called max daily loss." for the daily limit, and "Firms often call these max drawdown (fixed) and trailing drawdown. The floor is the account value you must stay above." for the total limit.

## The two kinds of limit

**Daily loss limit.** The most the account may fall within one trading day. It is measured from a reference value at the start of the day. If equity falls to the limit, the rule is broken.

**Total loss limit.** The most the account may fall in total. There are two common kinds:

- **Static.** The floor is fixed. It is the initial balance minus a percent of it. It never moves.
- **Trailing.** The floor follows your best value. When your account sets a new high, the floor rises. It does not fall back when your account falls. Some firms stop the floor from rising above a fixed level.

## Answer these from your firm's rules first

The page shows a short list with this title on the Loss limits screen:

- Is the daily limit a percent of the starting balance or of the day-start value?
- Is the day-start value the balance or the equity, and at what time does the day reset?
- Is the total limit fixed (often called max drawdown) or trailing (trailing drawdown)?
- Does a trailing floor follow balance or equity, and does it stop rising at some point?

More detail on each question:

Answer these before you fill in Lotcheck. If the rule page does not say clearly, ask the firm. Do not guess.

1. **Is the daily limit a percent of the starting balance, or of the day's start value?** This sets the "of" amount and the "value at the start of the day". They can be the same number, or different.
2. **Is the limit based on balance or on equity?** Equity includes the floating profit or loss of open trades. Balance does not. Lotcheck measures against equity, so it fits an equity rule. If your firm counts balance only, your real room may be bigger, but check it with the firm.
3. **When does the day reset, and in which time zone?** The day-start value is the value at that moment. A time zone mistake gives you the wrong day-start value.
4. **Does floating loss count?** If it does, open trades that are down already use up room. Enter your current equity (which includes them) and your open risk.
5. **Is the total limit static or trailing?** This decides which fields you fill in.
6. **For a trailing limit: what is the high-water mark, what is it a percent of, and does the floor stop rising at some level?** Is the high-water mark based on balance or equity? Does it update on closed trades only, or on floating profit as well?
7. **Does the firm add other rules** (for example a maximum number of lots, or no trading around news)? Lotcheck does not cover these.

## Where each answer goes in Lotcheck

On the Trade step, answer Yes to "Does your account have loss limits?". Next then opens the Loss limits screen. The field labels below are the ones on that screen.

| Your answer | Lotcheck field |
|---|---|
| Your account's equity right now (balance plus floating profit or loss) | Current equity |
| Daily limit as a percent | Daily limit (percent) |
| The amount the daily percent is taken from | Daily limit: percent of this amount |
| Account value at the start of the trading day | Value at the start of the trading day |
| Total limit as a percent | Total limit (percent) |
| Fixed floor: the initial balance | Starting balance of the account |
| Trailing floor: the amount the percent is taken from | Total limit: percent of this amount |
| Trailing floor: your highest value so far, as the firm counts it | Highest value reached |
| Trailing floor: a level where the floor stops rising | Floor stops rising at (optional) |
| How much more you would lose if every open trade hit its stop | Open risk on trades you already have |
| Room you want to keep unused | Room to keep unused |

The total limit has a toggle with two options: "Fixed floor" (a static limit) and "Trailing floor".

## No half-filled rules

A rule (daily or total) counts as started when any of its own fields has text. It counts as complete when all of its required fields hold a valid number above 0. A field holding "5%" or "0" leaves the rule unfinished, and the field shows its own error text.

Loss limits are applied only while the answer to "Does your account have loss limits?" is Yes. If you answer No, the numbers you typed stay in the fields but are ignored, and the result shows "Loss limits: Not applied". Answer Yes again and they count again.

With Yes, Next does not leave the Loss limits screen until at least one rule is complete. The message is: "Enter at least one complete limit, or go back and answer No."

While any rule is started but not complete, Lotcheck shows no lot size and Next does not open the result. The Loss limits screen says: "Finish or clear the daily limit fields first. Still needed: ..." (or "total limit"), and lists the missing fields. If a rule is started and "Current equity" is empty, equity is listed as needed.

A status line sits at the top of the Loss limits screen. It shows exactly one of these:

- "Not applied: no limit entered yet."
- "Applied: daily limit and total limit."
- "Applied: daily limit only."
- "Applied: total limit only."
- "Applied: daily limit only. The total limit is not finished."
- "Applied: total limit only. The daily limit is not finished."
- "Not applied yet: the daily limit is not finished."
- "Not applied yet: the total limit is not finished."
- "Not applied yet: the daily limit and the total limit are not finished."

You can fill in only the daily limit, only the total limit, or both. If both are complete, Lotcheck uses the one with less room.

## The trailing floor is a snapshot

Lotcheck calculates the room from the floor as it is right now. When the total limit is "Trailing floor", the page shows this line on the Loss limits screen and under the room table in the result: "This room assumes the floor does not move while the trade is open. If your firm's floor follows equity, profit made before the stop raises the floor, and the stop can then break the limit."

A small example. The total limit is 10% of 10,000, and the highest value reached is 10,400, which is also your current equity.

1. The floor is 10,400 - 1,000 = 9,400. The room is 10,400 - 9,400 = 1,000.
2. You size a trade whose planned loss at the stop is 800. That is inside the room of 1,000.
3. Say the trade first gains 500, so equity is 10,900. If the firm's floor follows equity, the floor is now 10,900 - 1,000 = 9,900.
4. The price then falls to your stop. The loss from your entry is 800, so equity is 10,400 - 800 = 9,600.
5. 9,600 is below the new floor of 9,900. The limit is broken, although the planned loss was inside the room you saw.

Use "Room to keep unused" to leave more space, and check how your firm's floor moves.

## What Lotcheck shows

- The daily room and the total room, in money.
- Minus open risk, minus buffer, equals the room for a new trade.
- A lot size that stays inside that room, and which limit held it back ("Your daily loss limit" or "Your total loss limit", or "Your risk setting" when the room is not what limits the size).

If your equity is at or below a limit, no size is shown. If there is no room left, no size is shown.

**A size equal to the room ends exactly on the limit.** If the size uses all of the room, a hit stop puts the account exactly on the floor, and many firms count that as a breach. The page then shows: "This size uses all of the room you entered. If the stop is hit, the account ends exactly on the limit, and many firms count that as a breach. Use "Room to keep unused" to stay clear of it."

**Equity above the highest value.** With a trailing floor, if your current equity is above "Highest value reached", the page shows: "Your current equity is above the highest value you entered. If your firm's floor follows equity, the highest value must be at least your current equity, or the room shown here is too large." Check which value your firm trails on.

## Things to keep in mind

- A stop-loss does not guarantee the loss. A gap or slippage can make the real loss larger than the room. Use "Room to keep unused" for a margin of your own.
- Spread and commission count. Enter them under "Add costs" on the Trade step.
- The numbers you enter are only as good as your reading of the rules. A wrong day-start value or limit gives a wrong room. For the formulas, see [how-it-works.md](how-it-works.md), step 9.
