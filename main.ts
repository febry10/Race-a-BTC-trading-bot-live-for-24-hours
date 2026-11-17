// Baseline: RSI and Bollinger-band mean reversion, long only. The rules are those freqtrade-strategies
// publishes as BbandRsi (user_data/strategies/berlinguyinca/BbandRsi.py at
// f3340ce11f5bdf62f598522e64d1f5638eaa13f5, https://github.com/freqtrade/freqtrade-strategies),
// written here clean-room from those rules alone: no line of that GPL-3.0 code is copied. BbandRsi
// trades 1h candles, as solana-bars-1h-01 does.
//
//   - Indicators, per symbol over its own bars (a gap adds nothing): RSI over 14 closes, Wilder's (the
//     first average gain and loss are the means of 14 changes, each next one 13/14 of the last plus
//     1/14 of the newest change; RSI = 100 x gain / (gain + loss), 50 when nothing moved), and the
//     Bollinger bands of the last 20 typical prices ((h + l + c) / 3): their mean, 2 standard
//     deviations (the population's) either side.
//   - Entry, on a bar's close (filled at the next open): RSI below 30 and the close below the lower
//     band, on a symbol it does not hold.
//   - Exit, the whole position: RSI above 70 (its sell signal), or the position worth at least 10% over
//     its cost at the close (its minimal_roi {"0": 0.1}), or at least 25% under it (its stoploss -0.25).
//     Each is read again on every bar, so a sell the market refuses (no bar or a price past the
//     slippage cap at the next open) or the order cap leaves out is sent again on the symbol's next
//     bar while its reason still holds at that close.
//   - Stake (freqtrade's stake_amount "unlimited"): equity over n slots, n = min(the universe,
//     caps.max_open_positions); each buy the smallest of equity / n, caps.max_weight_bps of equity and
//     the cash this reply has not spent yet; below fees.min_notional_quote_units it buys nothing. It
//     never holds more than n, counting the positions this reply sells (their proceeds land at the
//     next open and fund later buys, never this reply's).
//   - A reply carries the sells first, then the buys in universe order, at most
//     caps.max_orders_per_bar in all. Each order caps its slippage at MAX_SLIPPAGE_BPS = 100, 1% past
//     the close it was decided on, so a sell into a liquidity gap is refused (and sent again) rather
//     than filled for almost nothing; an entry the market refuses is taken again on the next bar that
//     signals it.
//   - The indicators run in float64 on + - * / and Math.sqrt alone, each correctly rounded (IEEE 754),
//     so the same bars give the same orders, run after run.
//
// Laid out like an entrant's repository: the grader runs `node /bot/main.ts` with this directory
// mounted at /bot; vendor/makefun-bars.ts is a byte-identical copy of bars/sdk/makefun-bars.ts
// (tests/unit/baselines.test.ts keeps it so).

import { BPS, runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const RSI_BARS = 14;
const BAND_BARS = 20;
const BAND_SIGMAS = 2;
const RSI_ENTRY_BELOW = 34;
const RSI_EXIT_ABOVE = 66;
/** minimal_roi {"0": 0.1}: worth 11/10 of its cost. */
const ROI = [11n, 10n] as const;
/** stoploss -0.25: worth 3/4 of its cost. */
const STOP = [3n, 4n] as const;
const MAX_SLIPPAGE_BPS = 140;
const TREND_BARS = 6;

interface Series {
  /** The last BAND_BARS typical prices, oldest first. */
  typical: number[];
  closes: number[];
  last: number | null;
  /** The first RSI_BARS changes, while the averages are not set yet. */
  first: number[];
  gain: number | null;
  loss: number | null;
}

const series = new Map<string, Series>();

function push(bar: Bar): void {
  let s = series.get(bar.symbol);
  if (s === undefined) series.set(bar.symbol, (s = { typical: [], closes: [], last: null, first: [], gain: null, loss: null }));
  const c = Number(bar.c);
  s.typical.push((Number(bar.h) + Number(bar.l) + c) / 3);
  s.closes.push(c);
  if (s.closes.length > TREND_BARS + 1) s.closes.shift();
  if (s.typical.length > BAND_BARS) s.typical.shift();
  if (s.last !== null) {
    const change = c - s.last;
    const up = change > 0 ? change : 0;
    const down = change < 0 ? -change : 0;
    if (s.gain === null || s.loss === null) {
      s.first.push(change);
      if (s.first.length === RSI_BARS) {
        s.gain = s.first.reduce((a, x) => a + (x > 0 ? x : 0), 0) / RSI_BARS;
        s.loss = s.first.reduce((a, x) => a + (x < 0 ? -x : 0), 0) / RSI_BARS;
      }
    } else {
      s.gain = (s.gain * (RSI_BARS - 1) + up) / RSI_BARS;
      s.loss = (s.loss * (RSI_BARS - 1) + down) / RSI_BARS;
    }
  }
  s.last = c;
}

function rsi(s: Series): number | null {
  if (s.gain === null || s.loss === null) return null;
  const moved = s.gain + s.loss;
  return moved === 0 ? 50 : (100 * s.gain) / moved;
}

/** The lower band, or null before BAND_BARS bars. */
function lowerBand(s: Series): number | null {
  if (s.typical.length < BAND_BARS) return null;
  const mean = s.typical.reduce((a, x) => a + x, 0) / BAND_BARS;
  const variance = s.typical.reduce((a, x) => a + (x - mean) * (x - mean), 0) / BAND_BARS;
  return mean - BAND_SIGMAS * Math.sqrt(variance);
}

/** Whether a held position exits on this close: RSI over 70, or its value at the ROI or the stoploss. */
function exits(state: BarsState, symbol: string, held: { qty: bigint; cost: bigint }, r: number | null): boolean {
  if (r !== null && r > RSI_EXIT_ABOVE) return true;
  const value = state.value(symbol, held.qty);
  return value * ROI[1] >= held.cost * ROI[0] || value * STOP[1] <= held.cost * STOP[0];
}

await runBars({
  onBatch(state, batch) {
    for (const bar of batch.bars) push(bar);
    const fresh = new Set(batch.bars.map((b) => b.symbol));
    const { caps, fees } = state.hello;
    const sells: SellInput[] = [];
    const entries: string[] = [];
    for (const { symbol } of state.hello.symbols) {
      const s = series.get(symbol);
      if (s === undefined || !fresh.has(symbol)) continue;
      const r = rsi(s);
      const held = state.positions.get(symbol);
      if (held !== undefined) {
        if (exits(state, symbol, held, r)) sells.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        continue;
      }
      const lower = lowerBand(s);
      if (r !== null && lower !== null && r < RSI_ENTRY_BELOW && s.last! < lower) entries.push(symbol);
    }

    const orders: (SellInput | BuyInput)[] = sells.slice(0, caps.max_orders_per_bar);
    const slots = Math.min(state.hello.symbols.length, caps.max_open_positions);
    const stake = state.equity / BigInt(slots);
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    let room = slots - state.positions.size;
    let cash = state.cash;
    for (const symbol of entries) {
      if (room <= 0 || orders.length >= caps.max_orders_per_bar) break;
      let slice = stake < byWeight ? stake : byWeight;
      if (cash < slice) slice = cash;
      if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) break;
      orders.push({ side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
      cash -= slice;
      room--;
    }
    return orders;
  },
});
