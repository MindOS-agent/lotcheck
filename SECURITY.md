# Security

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | Yes |

## Security model

Lotcheck is one offline file. In plain words:

- It is a single HTML page. It needs no server.
- It has a strict Content-Security-Policy. Only the page's own script and style are allowed to run, and they are identified by hashes. Everything else is blocked.
- It has no network access. The page contains no code that sends or fetches anything.
- It uses no third-party code and has no dependencies.
- What you type is never inserted into the page as HTML. Output is written as plain text only.
- It can optionally remember some inputs in your browser's local storage, under one key (`lotcheck:v1`), if you tick "Remember my inputs". This is off by default. Saved: account currency, risk mode and value, instrument type, symbol, base currency, quote currency, contract size, pip size, minimum lot, lot step, maximum lot and leverage. Never saved: balance, conversion pair choice and price, entry, stop, extra distance, commission, every loss-limits field, the answer to the loss-limits question, and the "I have checked" box. Nothing else is stored. A button removes the saved inputs.

## Reporting a vulnerability

Use GitHub private vulnerability reporting: open the repository's **Security** tab and choose "Report a vulnerability". Please do not open a public issue for a security problem.

Include the steps to reproduce, the browser and the Lotcheck version.

## What counts

We treat these as vulnerabilities:

- A way to make the page send data anywhere.
- A way to run injected script in the page.
- A way to make the page show a lot size larger than the risk allows.

Wrong numbers that are not a security problem (for example a different figure from your platform) go in a normal "Wrong number" issue.

## Use only checked copies

Only use a copy of `lotcheck.html` whose checksum matches `dist/SHA256SUMS`. See "Verify your download" in the README.
