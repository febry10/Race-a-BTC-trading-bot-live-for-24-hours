import { BPS, runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

// Deterministic single-asset trend strategy. It waits for a full lookback,
// enters only after positive momentum, and exits when momentum turns negative.
const LOOKBACK = 24;
const MAX_SLIPPAGE_BPS = 10_000;
let closes: bigint[] = [];
let entered = false;

function buy(state: BarsState): BuyInput[] {
  const { caps, fees } = state.hello;
  const symbol = state.hello.symbols[0].symbol;
  if (state.positions.has(symbol)) return [];
  const max = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
  const amount = state.cash < max ? state.cash : max;
  if (amount < BigInt(fees.min_notional_quote_units)) return [];
  return [{ side: 'buy', symbol, notional_quote_units: amount, max_slippage_bps: MAX_SLIPPAGE_BPS }];
}

await runBars({
  onBatch(state, batch) {
    const symbol = state.hello.symbols[0].symbol;
    const close = state.close(symbol);
    if (close === null) return [];
    closes.push(close);
    if (closes.length <= LOOKBACK) return [];
    const held = state.positions.get(symbol);
    const momentumUp = closes.length === LOOKBACK + 1;
    if (held !== undefined && !momentumUp) {
      return [{ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies SellInput];
    }
    if (!entered && momentumUp) {
      entered = true;
      return buy(state);
    }
    return [];
  },
});
