# Finding your numbers

Lotcheck needs a few facts about the instrument you trade. They are different for every broker and every symbol. This page says where to find them. Names differ between platforms, so the words below are general.

## Where to look

Most trading platforms have a window with the details of an instrument. It may be called symbol information, instrument information, contract specification or something close. Look for it in the market watch list or the symbol's right-click menu, or on your broker's website under the instrument's specification.

| What Lotcheck asks | What it may be called in the platform | Notes |
|---|---|---|
| Contract size | Contract size, lot size, units per lot, multiplier | How many units 1.00 lot contains. |
| Pip or point size | Pip size, point, tick size, minimum price change | See "Pip, point and tick" below. |
| Minimum lot | Minimum volume, minimum lot, min size | The smallest trade size. |
| Lot step | Volume step, step lot, size increment | The smallest change in trade size. |
| Maximum lot | Maximum volume, maximum lot | Optional. |
| Base currency (forex pairs only) | Base currency, first currency of the pair | For EURUSD it is EUR. Required for forex pairs: no lot size is shown while it is empty. Without it, Lotcheck cannot tell when your account currency is the first currency of the pair, and the loss could be understated. |
| Quote currency | Profit currency, quote currency, currency of profit | The currency your profit and loss is counted in. |
| Commission | Commission, fee per lot, round turn | Check if it is per side or round trip. Lotcheck wants the round trip for 1.00 lot, in your account currency. |
| Leverage | Leverage, margin rate | Optional. Enter the second number: for 1:30, enter 30. Your account's leverage may differ from the instrument's. Margin is an estimate from this one figure. Brokers may use a different margin rate for each instrument. |

## Base currency for other instruments

For index, metal and crypto types the field is "Base currency (optional)". Leave it empty in most cases. Fill it in only when the instrument is priced from your account currency under a different name. The page hint says: "Only needed when the instrument is priced from your account currency under a different name, for example XBTUSD in a BTC account. Otherwise leave it empty."

Example: your account is in BTC and you trade a symbol called XBTUSD. Its base currency is BTC, which is your account currency, so the loss must be converted at your stop-loss price. Lotcheck cannot know that XBTUSD means BTC against USD, so you enter BTC as the base currency. A symbol with a letter in front or behind, such as mUSDJPY, is not detected from the symbol either. Enter the base currency yourself.

## Pre-filled values

For the "Forex pair" type only, Lotcheck pre-fills the base currency, quote currency, contract size, pip size, minimum lot and lot step, but only when the first six characters of the symbol (letters and digits only, any case) are two known currency codes, such as EURUSD or usd/jpy. The Instrument step then shows them as two short sentences under the line "Typical values for EURUSD. Brokers differ." (with your own symbol). Press "Change numbers" to see and edit all seven fields. Each pre-filled field is tagged "typical value, check with your broker". Editing a field removes its tag.

For any other symbol nothing is pre-filled, and the fields are shown for you to fill in. If the symbol starts with XAU, XAG, XPT, XPD, BTC or ETH, or contains a digit, you see: "This looks like a metal, crypto or index symbol. Choose that instrument type and enter the numbers from your platform." For any other unrecognised symbol you see: "Lotcheck does not recognise this as a currency pair, so nothing is filled in for you. Check the instrument type and enter the numbers from your platform."

Metals, commodities, indices and crypto never get pre-filled values.

The minimum lot must be a whole number of lot steps. A minimum of 0.01 with a step of 0.01 is fine. A minimum of 0.05 with a step of 0.02 is not.

## Pip, point and tick

Platforms use these words in different ways.

- A **tick** or **point** in a platform is often the smallest possible price move. On many forex symbols that is 0.00001, a tenth of what traders call a pip.
- A **pip** on most forex pairs is 0.0001. On pairs with the Japanese yen it is 0.01.

Lotcheck does not care what you call it. It uses the size you type as its unit, and it counts the stop distance and the value of one move in that unit. What matters is that the number you type for pip or point size is the same unit you compare in the check line. Pick one unit and keep to it.

## Use the check line

When the fields are filled in, Lotcheck shows a check line:

"With these numbers, 1.00 lot moving 1 pip/point (PIPSIZE) is worth PIPVALUE ACCOUNTCCY. Compare this with your platform before you trust the result."

Here PIPSIZE is your pip or point size, PIPVALUE is the value, and ACCOUNTCCY is your account currency.

How to check it:

1. In your platform, find the value of one pip or point for 1.00 lot. Some platforms show it in the symbol information. Others show it in a calculator tool, or you can open a pending order form and watch the profit change for a price move.
2. Make sure the platform's figure is in the same currency as the account, and for the same move size (one pip, or one point, the same as your pip size).
3. If the two figures are the same, the numbers fit together.
4. If they differ, stop. One of the numbers is wrong. The usual cause is the contract size, the pip size or the quote currency.

A difference of a few cents can come from the conversion rate. A difference of a factor of 10 or 100 is a wrong contract size or pip size.

Tick the box "I have checked these numbers in my platform" only after you have done this. It is required for every instrument type, forex included. No lot size is shown until it is ticked. The hint under it says: "Required before any lot size is shown. Changing the account currency or any instrument field unticks it." Next does not leave the Instrument step until the box is ticked. If a symbol caution is showing, the Result step repeats it above the lot size.

## Extra distance and commission

- **Extra distance** is in the same price units as your entry and stop, for example 0.0002 for EURUSD. It is added to the stop distance.
- **Commission** is cleared when you change the symbol or the instrument type, and it is never saved. Type it again for each instrument.

## Remember my inputs

If you tick "Remember my inputs in this browser" on the Result step, the page keeps some fields in this browser only. The hint says: "Saves your account currency, risk setting, instrument type, symbol, currencies, contract size, pip size, lot sizes and leverage in this browser only. Balance, prices, commission and loss-limit values are never saved, because they change."

While the box is ticked, the Account step shows the line "Inputs saved in this browser were filled in." with a "Forget saved inputs" button. The same button sits on the Result step. Either one removes the saved inputs from this browser and unticks the box.

## Common traps

- **Cent accounts.** Some platforms show the balance in cents (for example USC). Enter the account currency and the balance in the real currency: USD, with the balance divided by 100. Cent accounts often use a different contract size, so confirm it with the check line.
- **Index contract sizes of 1, 10 or 100.** The same index can be offered with different contract sizes by different brokers, or even in different account types at one broker. A wrong value changes the size by 10 or 100 times. Always read it from your own platform.
- **Gold contract of 100 ounces.** On many platforms 1.00 lot of gold is 100 ounces. Some use other sizes. A price move of 1.00 then moves your position by 100 account-currency units (if it is quoted in that currency). Read the contract size and the minimum lot.
- **JPY pairs with a pip of 0.01.** If the quote currency is JPY, the pip is usually 0.01, not 0.0001. Profit is counted in yen, so you also need a conversion rate to your account currency. For a JPY account, money is shown with no decimals.
- **Mini and micro symbols.** Some brokers list the same pair as a standard, mini or micro symbol with a contract size of 100,000, 10,000 or 1,000. The symbol name may be nearly the same. Do not assume 100,000.
- **Crypto contract sizes.** Contract sizes for crypto symbols vary a lot: 1 coin, 0.1 coin, 0.01 coin or other values. Some are quoted in a stablecoin or in a currency that is not your account currency. Check the quote currency and the contract size.
- **Minimum lot larger than you expect.** Some symbols have a minimum lot of 0.1 or 1. If your risk is small and the stop is wide, Lotcheck may show that even the minimum size is too big. That is the correct answer. It does not round up.
- **Commission per side or round trip.** Some brokers list the commission for one side. Lotcheck wants the round trip. Double a per-side commission.

## If the numbers will not match

Do not rely on a figure you cannot reproduce. Ask your broker for the contract specification of the symbol in writing. If you think Lotcheck is wrong, see [CONTRIBUTING.md](../CONTRIBUTING.md) for how to report a wrong number.
