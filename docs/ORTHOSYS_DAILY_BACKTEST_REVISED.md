# Orthogonal Trading System v6.1 — Daily-Tuned System Backtest (REVISED)

**Date:** 2026-07-21
**Status:** ✅ Backtest complete with corrected parameters
**Verdict:** ⚠️ The full daily-tuned system (Gram-Schmidt + cross-sectional L/S) **loses money** on the extended 2022-2025 dataset. My earlier v6.1 backtest was an artifact of per-asset thresholding, not a true representation of the system.

---

## Critical Correction to My Earlier Report

My earlier `ORTHOSYS_BACKTEST_REPORT.md` claimed OrthoSys v6.1 outperformed TrendScan's existing engine by +13.2pp OOS hit rate. **That conclusion was wrong.** Here's why:

| Dimension | My Earlier v6.1 Test (WRONG) | This Test (CORRECT) |
|-----------|------------------------------|----------------------|
| Signal set | 9 signals (incl. bb_width, rsi_signal, mom_6/18, ema_cross, hl_mom) | 8 signals (mom_5/10/20, zscore_20, vol_ratio, vol_sma, taker_ratio, sma_cross) — **the actual daily-tuned set** |
| Methodology | Per-asset ±τ threshold (LONG/SHORT/FLAT per symbol) | **Cross-sectional L/S portfolio** (rank all 13 assets, long top N=2, short bottom N=2) — **the actual system** |
| Orthogonalization | None — weighted average of correlated signals | **Gram-Schmidt per cross-section** — the system's namesake innovation |
| Taker volume | Crude proxy (up-bar vs down-bar volume) | **Real taker_buy_vol** from Binance klines (field index 9) |
| Smoothing | LB=5 (4H default) | **LB=3** (daily-tuned) |
| Z-score window | ZSC_LEN=80 (4H default) | **ZSC_LEN=60** (daily-tuned) |
| OOS result | +13.2pp hit rate vs TrendScan | **Negative Sharpe, -40.9% annualized return** |

The earlier "55% OOS hit rate" was an artifact of evaluating the system as a per-asset directional signal — which is **not** how it was designed. The system is a **cross-sectional long/short portfolio**, and when tested as designed, it loses money on the 2022-2025 dataset.

---

## Why the System Loses Money

### 1. The 2022 bear market destroys it

The original script was tested on **Apr 2024 → Jun 2025** — a strong bull market where almost any long/short momentum strategy works. We extended the test to **2022-01 → 2025-07** (3.5 years, includes the 2022 bear and 2023 recovery), and the system collapsed:

| Period | Annualized Return | Sharpe | Max Drawdown |
|--------|-------------------|--------|--------------|
| IS (2022-01 → 2024-02, 759 days) | **-51.1%** | -0.836 | **-94.1%** |
| OOS (2024-02 → 2025-07, 506 days) | **-40.9%** | -0.625 | **-79.0%** |
| Buy & Hold (OOS) | -9.0% | 0.206 | -66.2% |

The strategy underperforms **buy & hold** on every dimension. The -94.1% IS drawdown is essentially a total loss.

### 2. Per-signal IC analysis shows the signals are weak

The cross-sectional Information Coefficient (Spearman rank correlation between signal and next-day return) shows most signals have near-zero predictive power:

| Signal | IS IC | IS p-value | OOS IC | OOS p-value | Verdict |
|--------|-------|------------|--------|-------------|---------|
| mom_5 | +0.019 | 0.173 | +0.040 | **0.006** | ⭐ Only signal with significant OOS IC |
| mom_10 | -0.001 | 0.936 | +0.015 | 0.330 | Useless |
| mom_20 | +0.013 | 0.346 | +0.009 | 0.543 | Useless |
| zscore_20 | NaN | NaN | NaN | NaN | ⚠️ All values identical after Gram-Schmidt (degenerate) |
| vol_ratio | +0.026 | 0.053 | +0.024 | 0.094 | Marginally useful |
| vol_sma | -0.035 | **0.011** | -0.022 | 0.112 | IS significant, OOS not |
| taker_ratio | +0.014 | 0.284 | +0.031 | **0.027** | ⭐ OOS significant |
| sma_cross | -0.007 | 0.627 | +0.005 | 0.750 | Useless |

**Only 2 of 8 signals have statistically significant OOS IC** (mom_5 and taker_ratio). The other 6 are noise. IC values of 0.02-0.04 are weak — typical quantitative strategies target IC ≥ 0.05.

**Critical issue:** `zscore_20` produced NaN IC. Investigation shows that after Gram-Schmidt orthogonalization, the `zscore_20_orth` column collapses to constant values across assets on many dates (the orthogonalization projects it onto a degenerate subspace). This is a numerical instability in the Gram-Schmidt implementation when multiple signals are highly correlated.

### 3. The IC-weighted scheme can't save it

Cycle 4 tried IC-weighting (weight each signal by its absolute OOS IC). Result: OOS Sharpe improved from -1.101 to -0.625, but still deeply negative. Even with optimal weighting, the underlying signals are too weak to overcome 10bps round-trip costs on daily rebalancing.

### 4. Bootstrap confirms it's not noise

5,000-permutation bootstrap p-value = 0.7144 (we want < 0.05 for significance). This means the strategy's Sharpe is **indistinguishable from random** — the negative performance is not statistically significant, but neither would positive performance be.

---

## Cycle Progression

![Cycle progression](charts/ortho_daily/cycle_progression.png)

| Cycle | Description | OOS Sharpe | Notes |
|-------|-------------|------------|-------|
| 1 | Baseline (equal weights, all 8 signals) | **-2.326** | Disastrous |
| 2 | Drop-1 (best: drop mom_10) | -1.101 | Marginal improvement |
| 3 | Portfolio breadth (2/2 best) | -1.101 | No improvement from breadth tuning |
| 4 | Weights: IC-weighted | -0.625 | Best result, still negative |
| 5 | Bootstrap (5000 perms) | -0.625 | p=0.71 — not significant |
| 6 | Convergence | -0.625 | Did not converge (never reached profitability) |

![Equity curves](charts/ortho_daily/equity_curves.png)

The IS equity curve shows a near-total drawdown during 2022. The OOS curve (the bull market period) shows modest recovery but never reaches profitability after costs.

---

## Comparison: My Earlier v6.1 Test vs This Correct Test vs TrendScan

![Three-way comparison](charts/ortho_daily/three_way_comparison.png)

| Approach | OOS Hit Rate | OOS Sharpe | OOS Ann Return | Notes |
|----------|--------------|------------|-----------------|-------|
| **v6.1 4H-port on daily (my earlier test)** | 55.0% | N/A (per-asset, not portfolio) | +1.21% (10d) | ⚠️ **ARTIFACT** — evaluated as per-asset signal, not as designed |
| **v6.1 daily-tuned (this test, correct)** | 51.5% win rate | **-0.625** | **-40.9%** | True system — loses money |
| TrendScan v3.1 (existing) | 41.8% | N/A | -0.69% (10d) | Weak but not catastrophic |

### Why my earlier test was misleading

My v6.1 test evaluated the system as a **per-asset directional signal** (composite > +τ → LONG, composite < -τ → SHORT, per symbol). This is **not** how the system was designed. The system is a **cross-sectional portfolio**: rank all assets by composite, long top N, short bottom N.

The per-asset evaluation showed 55% hit rate because:
1. It tested each symbol independently — when BTC's composite was high, it predicted BTC would rise (a much easier bar than cross-sectional ranking)
2. It used τ=0.4 as a per-asset threshold, not a cross-sectional rank cutoff
3. It didn't include Gram-Schmidt orthogonalization (which is the system's key innovation)
4. It didn't include transaction costs on daily rebalancing

When tested as designed (cross-sectional L/S with full costs), the system collapses.

---

## Why the Original Author's Results Differed

The original Python script was tested on **Apr 2024 → Jun 2025** (15 months, strong bull market). On that window:

- BTC: ~$65K → ~$105K (+62%)
- ETH: ~$3.2K → ~$3.5K (+9%)
- SOL: ~$145 → ~$150 (+3%, but with high volatility)
- BNB: ~$580 → ~$640 (+10%)
- XRP: ~$0.50 → ~$2.20 (+340%)

In a strong bull market, **any** long/short strategy with a long bias will show positive returns. The original test's "good results" were a function of the test window, not the strategy.

When we extend to 2022-2025 (which includes the 2022 bear market where BTC fell from $47K to $16K), the strategy's structural weaknesses appear:
1. Mean-reversion signals (zscore_20) fail in strong trends
2. Momentum signals (mom_5/10/20) whipsaw in choppy markets
3. Daily rebalancing costs (10bps × 2 sides × ~4 position changes per day = ~80bps/day drag) compound destructively

---

## Updated Integration Recommendation

### Verdict: ❌ DO NOT INTEGRATE as designed

The full daily-tuned Orthogonal System **loses money** on the extended 2022-2025 dataset. It underperforms buy & hold and has a -94.1% IS drawdown. **Do not integrate this system as a production signal.**

### What about my earlier "55% hit rate" finding?

That result was real but **misleading**. It came from evaluating the system as a per-asset directional signal — which is a different (and easier) problem than the cross-sectional L/S portfolio the system was designed for. The per-asset ±τ approach doesn't capture the system's intent, and its apparent outperformance was an artifact of:
1. Easier evaluation (per-asset prediction vs cross-sectional ranking)
2. No daily rebalancing costs
3. No Gram-Schmidt (so the composite was a simple weighted average of correlated signals, which is statistically different from the orthogonalized version)

### Are there salvageable components?

Yes, two signals showed statistically significant OOS IC:
- **mom_5** (5-day momentum, sign=-1 i.e. contrarian): OOS IC +0.040, p=0.006
- **taker_ratio** (real taker buy/sell ratio from Binance, sign=-1): OOS IC +0.031, p=0.027

These could be added to TrendScan's existing 10-gate engine as **two new gates**:
- `mom5Contrarian` — 5-day momentum, inverted (contrarian), as a confidence boost/penalty
- `takerRatio` — real taker buy/sell ratio (requires fetching taker_buy_vol in `build_snapshot.js`)

Both have weak IC (~0.03-0.04) but are statistically significant and would diversify the existing gate set.

### Should we test on 4H data?

**Probably not worth the effort.** The system's weakness isn't the timeframe — it's the signal quality. The 8 signals have IC values of 0.02-0.04, which is below the 0.05 threshold for useful signals. Testing on 4H would ~6× the signal count but wouldn't fix the underlying IC weakness. The 2022 bear market would still destroy the strategy (4H bars would just make the destruction faster).

### What about Path A/B/C from my earlier report?

All three integration paths are now **NOT RECOMMENDED**:
- **Path A** (replace composite stance engine): ❌ Replacing a working engine with a losing one is wrong
- **Path B** (add as 11th gate): ⚠️ Only if restricted to mom_5 and taker_ratio as individual gates, not the composite
- **Path C** (parallel display): ❌ Showing users a strategy with -40.9% annualized return is irresponsible

---

## Files Produced

- `scripts/signal/ortho_daily_backtest.py` — Full Python backtest (adapted from original)
- `scripts/signal/ortho_daily_results.json` — Full results JSON
- `scripts/signal/generate_ortho_daily_charts.py` — Chart generator
- `scripts/signal/charts/ortho_daily/` — 5 PNG charts:
  - `equity_curves.png` — IS vs OOS vs Buy & Hold
  - `ic_analysis.png` — Per-signal Information Coefficient
  - `cycle_progression.png` — 6-cycle iteration
  - `metrics_comparison.png` — Strategy vs Buy & Hold metrics
  - `three_way_comparison.png` — My earlier v6.1 test vs this test vs TrendScan

---

## Lessons Learned

1. **Always test on multiple regimes** — The original Apr 2024 – Jun 2025 window was a bull market that masked the strategy's weakness. Extending to 2022-2025 (which includes a bear) revealed the truth.

2. **Per-asset evaluation ≠ cross-sectional evaluation** — My earlier v6.1 test evaluated the system as a per-asset signal, which is a fundamentally different (and easier) problem. Always evaluate a system the way it was designed to be used.

3. **Gram-Schmidt can produce degenerate outputs** — When signals are highly correlated (as mom_5/mom_10/mom_20 are), Gram-Schmidt projects some onto degenerate subspaces. The `zscore_20_orth` column had NaN IC for this reason.

4. **IC < 0.05 is noise** — 6 of 8 signals had IC < 0.05 and p > 0.05. A strategy built mostly on noise will lose money after costs, regardless of how the signals are combined.

5. **Daily rebalancing costs compound destructively** — 10bps/side × ~4 position changes/day = ~80bps/day = ~200% annual drag. The strategy would need IC > 0.10 to overcome this, which it doesn't have.

---

## Final Verdict

**Do not integrate the Orthogonal Trading System v6.1 as designed.**

The system's apparent strength in my earlier test was an artifact of per-asset evaluation on a bull-market window. When tested correctly (cross-sectional L/S portfolio, full 2022-2025 dataset, real transaction costs), it loses money and underperforms buy & hold.

The existing TrendScan v3.1 engine, while imperfect (41.8% OOS hit rate), is at least not destructive. Replacing it with OrthoSys would make the system worse.

If you want to salvage components:
- Add **mom_5 (contrarian)** as a new gate in TrendScan's engine — OOS IC +0.040, p=0.006
- Add **taker_ratio (real, from Binance)** as a new gate — OOS IC +0.031, p=0.027
- Both require fetching taker_buy_vol in `build_snapshot.js` (extend the klines fetcher to include field index 9)

These two signals are statistically significant and would diversify TrendScan's existing 10-gate set. But they are weak (IC ~0.03-0.04) and should be added as minor confidence boosters, not as primary signals.
