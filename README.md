# Deterministic cbBTC Momentum Rotation Bot

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/febry10/Race-a-BTC-trading-bot-live-for-24-hours/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/febry10/Race-a-BTC-trading-bot-live-for-24-hours/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

Deterministic cross-sectional momentum rotation bot for the [make.fun BTC race bounty](https://make.fun/bounty/btc-race-24h-20261117-0603).

## Run

```bash
node main.ts
```

The bot uses a fixed 18-bar return lookback, rotates into the two strongest symbols, and applies bounded order slippage. It uses only completed bars and contains no credentials or live-trading code.
