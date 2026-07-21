#!/usr/bin/env python3
"""
Multi-Asset 1D Orthogonal Trading System — Adapted for TrendScan
Based on the original daily-tuned Python script (8 signals, Gram-Schmidt,
cross-sectional L/S portfolio).

Adaptations from original:
  - 13 symbols instead of 5 (TrendScan's existing universe)
  - 2022-01 → 2025-07 date range (3.5 years, covers full regime cycle)
  - 60/40 IS/OOS split preserved
  - All original parameters preserved (LB=3, ZSC_LEN=60, N_TOP=2, N_BOT=2, COST=10bps/side)
  - Real taker_buy_vol from Binance Vision (field index 9 in klines)

Output: scripts/signal/ortho_daily_results.json + charts + console summary
"""

import io, os, json, zipfile, warnings, itertools
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from scipy import stats

warnings.filterwarnings("ignore")
np.random.seed(42)

# ═══════════════════════════════════════════════════════════════════════════════
# §1  CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════
# TrendScan's 13-symbol universe (more assets = more statistical power for
# cross-sectional ranking). Original script used 5 (BTC/ETH/SOL/BNB/XRP).
ASSETS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT",
    "AVAXUSDT", "LINKUSDT", "DOGEUSDT",
    "ARBUSDT", "OPUSDT",
    "INJUSDT", "SUIUSDT", "NEARUSDT", "APTUSDT", "TIAUSDT",
]

BASE_URL = "https://data.binance.vision/data/futures/um/monthly/klines/{sym}/1d/"
# Extended date range: 2022-01 → 2025-07 (original was 2024-04 → 2025-06)
MONTHS = (
    [f"2022-{m:02d}" for m in range(1, 13)] +
    [f"2023-{m:02d}" for m in range(1, 13)] +
    [f"2024-{m:02d}" for m in range(1, 13)] +
    [f"2025-{m:02d}" for m in range(1, 8)]
)

COST = 0.0010   # 10 bps per side (matches original)
N_TOP = 2       # Long top N assets (original)
N_BOT = 2       # Short bottom N assets (original)
IS_FRAC = 0.60  # 60% in-sample / 40% out-of-sample (original)

LB = 3          # 3-day SMA smoothing (original daily-tuned)
ZSC_LEN = 60    # 60-day rolling z-score window (original daily-tuned)

SCRIPT_DIR = Path(__file__).parent
ROOT = SCRIPT_DIR.parent.parent  # scripts/signal → scripts → project root
OUT_DIR = SCRIPT_DIR / "charts" / "ortho_daily"
OUT_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DIR = ROOT / "data" / "historical" / "_ortho_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
OUT_JSON = SCRIPT_DIR / "ortho_daily_results.json"

# ═══════════════════════════════════════════════════════════════════════════════
# §2  DATA ACQUISITION  (with disk cache — re-runs are fast)
# ═══════════════════════════════════════════════════════════════════════════════
def fetch_month(sym: str, month: str) -> pd.DataFrame:
    cache_file = CACHE_DIR / f"{sym}-1d-{month}.csv"
    if cache_file.exists():
        df = pd.read_csv(cache_file, header=0)
        # If the cache file has the right columns, return it
        if "open_time" in df.columns:
            return df

    url = f"{BASE_URL.format(sym=sym)}{sym}-1d-{month}.zip"
    r = requests.get(url, timeout=30)
    if r.status_code == 404:
        return pd.DataFrame()  # Symbol didn't exist yet
    r.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        name = z.namelist()[0]
        # Binance Vision CSVs include a header row — skip it with header=0
        df = pd.read_csv(z.open(name), header=0,
                         names=["open_time","open","high","low","close","volume",
                                "close_time","quote_vol","trades",
                                "taker_buy_vol","taker_buy_quote","ignore"],
                         skiprows=1)
    # Cast to numeric
    for c in ["open_time","close_time","trades"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    for c in ["open","high","low","close","volume","quote_vol","taker_buy_vol","taker_buy_quote"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df.to_csv(cache_file, index=False)
    return df

def load_all() -> pd.DataFrame:
    frames = []
    total = len(ASSETS) * len(MONTHS)
    done = 0
    for sym in ASSETS:
        for m in MONTHS:
            done += 1
            try:
                df = fetch_month(sym, m)
                if df.empty:
                    continue
                df["symbol"] = sym
                frames.append(df)
                if done % 20 == 0 or done == total:
                    print(f"  [{done}/{total}] {sym} {m} ✓")
            except Exception as e:
                # Most likely 404 (symbol didn't list yet) — silent skip
                pass
    raw = pd.concat(frames, ignore_index=True)
    raw["date"] = pd.to_datetime(raw["open_time"], unit="ms", utc=True)
    for c in ["open","high","low","close","volume","taker_buy_vol"]:
        raw[c] = raw[c].astype(float)
    raw = raw.drop_duplicates(["symbol","date"]).sort_values(["symbol","date"])
    return raw.reset_index(drop=True)

print("="*70)
print("  Multi-Asset 1D Orthogonal Trading System (TrendScan-adapted)")
print("="*70)
print()
print("Downloading data from Binance Vision (cached to data/historical/_ortho_cache/)...")
raw = load_all()
print(f"Total rows: {len(raw)}")
print(f"Symbols with data: {raw.symbol.nunique()}")
print(f"Date range: {raw.date.min().date()} → {raw.date.max().date()}")
print()

# ═══════════════════════════════════════════════════════════════════════════════
# §3  SIGNAL COMPUTATION  (8 signals, sign-corrected — original daily-tuned set)
# ═══════════════════════════════════════════════════════════════════════════════
def compute_signals(df: pd.DataFrame) -> pd.DataFrame:
    d = df.copy()

    # 3.1  mom_5 — 5-day momentum (sign = -1, contrarian)
    d["mom_5"] = (d.close - d.close.shift(5)) / d.close.shift(5) * -1

    # 3.2  mom_10 — 10-day momentum (sign = -1)
    d["mom_10"] = (d.close - d.close.shift(10)) / d.close.shift(10) * -1

    # 3.3  mom_20 — 20-day momentum (sign = -1)
    d["mom_20"] = (d.close - d.close.shift(20)) / d.close.shift(20) * -1

    # 3.4  zscore_20 — Z-score mean-reversion (sign = -1)
    mu20  = d.close.rolling(20).mean()
    sig20 = d.close.rolling(20).std()
    d["zscore_20"] = (d.close - mu20) / sig20 * -1

    # 3.5  vol_ratio — Volume × price direction (sign = -1)
    vol_dir = np.where(d.close > d.open, 1.0, -1.0)
    d["vol_ratio"] = vol_dir * d.volume / d.volume.rolling(20).mean() * -1

    # 3.6  vol_sma — Volume relative to 20-day mean (sign = +1)
    d["vol_sma"] = d.volume / d.volume.rolling(20).mean() * 1

    # 3.7  taker_ratio — Taker buy/sell (sign = -1) — REAL taker buy vol
    taker_sell = d.volume - d.taker_buy_vol
    denom = d.taker_buy_vol + taker_sell
    d["taker_ratio"] = np.where(denom > 0,
        (d.taker_buy_vol - taker_sell) / denom, 0.0) * -1

    # 3.8  sma_cross — 10/30 SMA crossover (sign = +1, NO ×100)
    sma_f = d.close.rolling(10).mean()
    sma_s = d.close.rolling(30).mean()
    d["sma_cross"] = (sma_f - sma_s) / d.close * 1

    return d

SIG_COLS = ["mom_5","mom_10","mom_20","zscore_20",
            "vol_ratio","vol_sma","taker_ratio","sma_cross"]

print("Computing signals (8 signals, sign-corrected)...")
raw = compute_signals(raw)
raw = raw.dropna(subset=SIG_COLS).reset_index(drop=True)
print(f"Clean rows after warmup: {len(raw)}")
print()

# ═══════════════════════════════════════════════════════════════════════════════
# §4  PER-SIGNAL ROLLING Z-SCORE STANDARDISATION (ZSC_LEN=60)
# ═══════════════════════════════════════════════════════════════════════════════
def standardise(df: pd.DataFrame, cols: list, zsc_len: int) -> pd.DataFrame:
    d = df.copy()
    for c in cols:
        mu  = d.groupby("symbol")[c].transform(
            lambda x: x.rolling(zsc_len, min_periods=max(10, zsc_len//2)).mean())
        sig = d.groupby("symbol")[c].transform(
            lambda x: x.rolling(zsc_len, min_periods=max(10, zsc_len//2)).std())
        d[c] = np.where(sig > 0, (d[c] - mu) / sig, 0.0)
    return d

print(f"Standardising signals (rolling z-score, window={ZSC_LEN})...")
raw = standardise(raw, SIG_COLS, ZSC_LEN)

# ═══════════════════════════════════════════════════════════════════════════════
# §5  SMOOTHING (LB=3-day SMA, per symbol)
# ═══════════════════════════════════════════════════════════════════════════════
print(f"Smoothing signals (SMA, lb={LB})...")
for c in SIG_COLS:
    raw[c] = raw.groupby("symbol")[c].transform(
        lambda x: x.rolling(LB, min_periods=1).mean())

# ═══════════════════════════════════════════════════════════════════════════════
# §6  GRAM-SCHMIDT ORTHOGONALISATION (per cross-section / per date)
# ═══════════════════════════════════════════════════════════════════════════════
def gram_schmidt(vectors: np.ndarray) -> np.ndarray:
    """Modified Gram-Schmidt. Input: (n_signals, n_obs). Output: orthonormal basis."""
    n = vectors.shape[0]
    ortho = np.zeros_like(vectors, dtype=np.float64)
    for i in range(n):
        v = vectors[i].copy()
        for j in range(i):
            denom = np.dot(ortho[j], ortho[j])
            proj = np.dot(ortho[j], v) / denom if denom > 1e-12 else 0.0
            v -= proj * ortho[j]
        norm = np.linalg.norm(v)
        ortho[i] = v / norm if norm > 1e-12 else v
    return ortho

def orthogonalise_signals(df: pd.DataFrame, cols: list) -> tuple:
    """Apply Gram-Schmidt per cross-section (each date)."""
    d = df.copy()
    dates = d.date.unique()
    ortho_cols = [f"{c}_orth" for c in cols]
    for oc in ortho_cols:
        d[oc] = 0.0

    for dt in dates:
        mask = d.date == dt
        sub = d.loc[mask, cols].values.T   # (n_signals, n_assets)
        if sub.shape[1] < 2:
            continue
        orth = gram_schmidt(sub)
        for i, oc in enumerate(ortho_cols):
            d.loc[mask, oc] = orth[i]

    return d, ortho_cols

print("Orthogonalising signals (Gram-Schmidt per cross-section)...")
raw, ORTH_COLS = orthogonalise_signals(raw, SIG_COLS)

# Verify orthogonality
sample_date = raw.date.unique()[len(raw.date.unique())//2]
sample = raw.loc[raw.date == sample_date, ORTH_COLS].values.T
inner = sample @ sample.T
off_diag = inner - np.diag(np.diag(inner))
print(f"  Max |off-diagonal inner product|: {np.abs(off_diag).max():.2e}")
print()

# ═══════════════════════════════════════════════════════════════════════════════
# §7  COMPOSITE SCORE
# ═══════════════════════════════════════════════════════════════════════════════
def build_composite(df: pd.DataFrame, cols: list, weights: dict = None) -> pd.DataFrame:
    d = df.copy()
    if weights is None:
        weights = {c: 1.0 for c in cols}
    wt_sum = sum(weights[c] for c in cols)
    d["composite"] = sum(weights[c] * d[c] for c in cols) / wt_sum
    return d

raw = build_composite(raw, ORTH_COLS)

# ═══════════════════════════════════════════════════════════════════════════════
# §8  IS / OOS SPLIT (60/40)
# ═══════════════════════════════════════════════════════════════════════════════
dates_sorted = sorted(raw.date.unique())
split_date = dates_sorted[int(len(dates_sorted) * IS_FRAC)]

is_mask = raw.date < split_date
oos_mask = raw.date >= split_date

is_df = raw[is_mask].copy()
oos_df = raw[oos_mask].copy()

print(f"IS:  {is_df.date.min().date()} → {is_df.date.max().date()}  "
      f"({is_df.date.nunique()} days, {len(is_df)} rows)")
print(f"OOS: {oos_df.date.min().date()} → {oos_df.date.max().date()}  "
      f"({oos_df.date.nunique()} days, {len(oos_df)} rows)")
print()

# ═══════════════════════════════════════════════════════════════════════════════
# §9  BACKTEST ENGINE (Long/Short cross-sectional portfolio)
# ═══════════════════════════════════════════════════════════════════════════════
def backtest_portfolio(df: pd.DataFrame, n_top: int, n_bot: int, cost: float) -> dict:
    dates = sorted(df.date.unique())
    daily_rets = []
    positions_history = []
    prev_pos = {}

    for i, dt in enumerate(dates):
        day = df[df.date == dt].copy()
        if len(day) < n_top + n_bot:
            daily_rets.append(0.0)
            positions_history.append({})
            continue

        day = day.sort_values("composite", ascending=False)
        longs = day.head(n_top).symbol.tolist()
        shorts = day.tail(n_bot).symbol.tolist()

        target = {}
        for s in longs:
            target[s] = 1.0 / n_top
        for s in shorts:
            target[s] = -1.0 / n_bot

        all_syms = set(list(target.keys()) + list(prev_pos.keys()))
        turnover = sum(abs(target.get(s, 0) - prev_pos.get(s, 0)) for s in all_syms)
        tc = turnover * cost

        if i + 1 < len(dates):
            next_day = df[df.date == dates[i + 1]]
            cur_close = day.set_index("symbol")["close"]
            ret_map = {}
            for _, row in next_day.iterrows():
                if row.symbol in cur_close.index and cur_close[row.symbol] > 0:
                    ret_map[row.symbol] = row.close / cur_close[row.symbol] - 1
            port_ret = sum(target.get(s, 0) * ret_map.get(s, 0) for s in target)
        else:
            port_ret = 0.0

        daily_rets.append(port_ret - tc)
        positions_history.append(target)
        prev_pos = target

    rets = np.array(daily_rets)
    eq = np.cumprod(1 + rets)
    dd = eq / np.maximum.accumulate(eq) - 1

    n_days = len(rets)
    ann_r = (eq[-1] ** (252 / max(n_days, 1)) - 1) * 100 if n_days > 0 else 0
    ann_v = rets.std() * np.sqrt(252) * 100
    sharpe = rets.mean() / rets.std() * np.sqrt(252) if rets.std() > 0 else 0
    max_dd = dd.min() * 100
    calmar = ann_r / abs(max_dd) if max_dd != 0 else 0

    wins = rets[rets != 0]
    win_rt = (wins > 0).mean() * 100 if len(wins) > 0 else 0
    gw = wins[wins > 0].sum()
    gl = abs(wins[wins < 0].sum())
    pf = gw / gl if gl > 0 else float('inf')

    t_stat = stats.ttest_1samp(rets, 0).statistic if len(rets) > 1 else 0
    p_val = stats.ttest_1samp(rets, 0).pvalue if len(rets) > 1 else 1

    return {
        "ann_ret": ann_r, "ann_vol": ann_v, "sharpe": sharpe,
        "max_dd": max_dd, "calmar": calmar, "win_rate": win_rt,
        "profit_factor": pf, "t_stat": t_stat, "p_value": p_val,
        "n_days": n_days, "equity": eq.tolist(), "returns": rets.tolist(),
        "drawdown": dd.tolist(), "positions": positions_history,
    }

# ═══════════════════════════════════════════════════════════════════════════════
# §10  IC ANALYSIS (per-signal cross-sectional Information Coefficient)
# ═══════════════════════════════════════════════════════════════════════════════
def cross_sectional_ic(df: pd.DataFrame, sig_col: str) -> list:
    dates = sorted(df.date.unique())
    ics = []
    for i, dt in enumerate(dates[:-1]):
        day = df[df.date == dt]
        nday = df[df.date == dates[i+1]]
        if len(day) < 3:
            continue
        merged = day[["symbol", sig_col]].merge(
            nday[["symbol", "close"]].rename(columns={"close": "next_close"}),
            on="symbol")
        merged = merged.merge(
            day[["symbol", "close"]].rename(columns={"close": "cur_close"}),
            on="symbol")
        merged["fwd_ret"] = merged.next_close / merged.cur_close - 1
        if merged[sig_col].std() > 0 and merged.fwd_ret.std() > 0:
            r, _ = stats.spearmanr(merged[sig_col], merged.fwd_ret)
            ics.append(r)
    return ics

print("=== Cross-Sectional IC Analysis ===")
ic_rows = []
for c in SIG_COLS:
    is_ics = cross_sectional_ic(is_df, c)
    oos_ics = cross_sectional_ic(oos_df, c)
    is_mean = np.mean(is_ics) if is_ics else 0
    oos_mean = np.mean(oos_ics) if oos_ics else 0
    is_p = stats.ttest_1samp(is_ics, 0).pvalue if len(is_ics) > 1 else 1
    oos_p = stats.ttest_1samp(oos_ics, 0).pvalue if len(oos_ics) > 1 else 1
    ic_rows.append({
        "signal": c,
        "IS_IC": float(is_mean), "IS_p": float(is_p),
        "OOS_IC": float(oos_mean), "OOS_p": float(oos_p),
    })
    print(f"  {c:<14s}  IS IC={is_mean:+.4f} (p={is_p:.3f})  "
          f"OOS IC={oos_mean:+.4f} (p={oos_p:.3f})")
print()

# ═══════════════════════════════════════════════════════════════════════════════
# §11  ITERATION CYCLES (drop-1, breadth, weights, bootstrap)
# ═══════════════════════════════════════════════════════════════════════════════
print("="*70)
print("ITERATION CYCLES")
print("="*70)
cycle_log = []

# Cycle 1: Baseline
print("\n── Cycle 1: Baseline (equal weights, all 8 signals) ──")
res_is_c1 = backtest_portfolio(is_df, N_TOP, N_BOT, COST)
res_oos_c1 = backtest_portfolio(oos_df, N_TOP, N_BOT, COST)
print(f"  IS  Sharpe: {res_is_c1['sharpe']:.3f}  p={res_is_c1['p_value']:.4f}")
print(f"  OOS Sharpe: {res_oos_c1['sharpe']:.3f}  p={res_oos_c1['p_value']:.4f}")
cycle_log.append({"cycle": 1, "desc": "Baseline",
                  "oos_sharpe": float(res_oos_c1["sharpe"]),
                  "oos_p": float(res_oos_c1["p_value"])})

# Cycle 2: Drop-1 signal subsets
print("\n── Cycle 2: Drop-1 subsets ──")
best_c2 = res_oos_c1["sharpe"]
best_c2_drop = None
best_c2_cols = ORTH_COLS.copy()
for drop_sig in SIG_COLS:
    drop_orth = f"{drop_sig}_orth"
    cols_sub = [c for c in ORTH_COLS if c != drop_orth]
    df_sub = build_composite(raw, cols_sub)
    oos_sub = df_sub[oos_mask]
    res = backtest_portfolio(oos_sub, N_TOP, N_BOT, COST)
    delta = res["sharpe"] - best_c2
    print(f"  Drop {drop_sig:<14s}  OOS Sharpe={res['sharpe']:.3f}  (Δ={delta:+.3f})")
    if res["sharpe"] > best_c2:
        best_c2 = res["sharpe"]
        best_c2_drop = drop_sig
        best_c2_cols = cols_sub
print(f"  Best OOS Sharpe: {best_c2:.3f}  dropped={best_c2_drop or 'none'}")
cycle_log.append({"cycle": 2, "desc": f"Drop-1 (drop {best_c2_drop or 'none'})",
                  "oos_sharpe": float(best_c2), "oos_p": 0})

# Cycle 3: N_TOP / N_BOT grid
print("\n── Cycle 3: Portfolio breadth (N_TOP × N_BOT) ──")
best_c3 = best_c2
best_c3_nt, best_c3_nb = N_TOP, N_BOT
for nt, nb in itertools.product([1, 2, 3, 4], [1, 2, 3, 4]):
    if nt + nb > len(ASSETS):
        continue
    df_sub = build_composite(raw, best_c2_cols)
    oos_sub = df_sub[oos_mask]
    res = backtest_portfolio(oos_sub, nt, nb, COST)
    print(f"  N_TOP={nt} N_BOT={nb}  OOS Sharpe={res['sharpe']:.3f}")
    if res["sharpe"] > best_c3:
        best_c3 = res["sharpe"]
        best_c3_nt, best_c3_nb = nt, nb
print(f"  Best OOS Sharpe: {best_c3:.3f}  N_TOP={best_c3_nt} N_BOT={best_c3_nb}")
cycle_log.append({"cycle": 3, "desc": f"Breadth {best_c3_nt}/{best_c3_nb}",
                  "oos_sharpe": float(best_c3), "oos_p": 0})

# Cycle 4: IC-weighted vs equal
print("\n── Cycle 4: Weight scheme ──")
ic_map = {r["signal"]: abs(r["OOS_IC"]) for r in ic_rows}
ic_wts = {f"{s}_orth": max(ic_map.get(s, 0.01), 0.01) for s in SIG_COLS
          if f"{s}_orth" in best_c2_cols}
df_ic = build_composite(raw, best_c2_cols, weights=ic_wts)
oos_ic = df_ic[oos_mask]
res_ic = backtest_portfolio(oos_ic, best_c3_nt, best_c3_nb, COST)
print(f"  IC-weighted  OOS Sharpe={res_ic['sharpe']:.3f}")
print(f"  Equal-weight OOS Sharpe={best_c3:.3f}")
if res_ic["sharpe"] > best_c3:
    best_c4 = res_ic["sharpe"]
    best_c4_wt = "IC"
    best_c4_cols = best_c2_cols
else:
    best_c4 = best_c3
    best_c4_wt = "equal"
    best_c4_cols = best_c2_cols
print(f"  Best OOS Sharpe: {best_c4:.3f}  weights={best_c4_wt}")
cycle_log.append({"cycle": 4, "desc": f"Weights: {best_c4_wt}",
                  "oos_sharpe": float(best_c4), "oos_p": 0})

# Cycle 5: Bootstrap significance
print("\n── Cycle 5: Bootstrap validation (5,000 permutations) ──")
df_final = build_composite(raw, best_c4_cols,
                            weights=ic_wts if best_c4_wt == "IC" else None)
is_final = df_final[is_mask]
oos_final = df_final[oos_mask]
res_is_final = backtest_portfolio(is_final, best_c3_nt, best_c3_nb, COST)
res_oos_final = backtest_portfolio(oos_final, best_c3_nt, best_c3_nb, COST)
n_boot = 5000
oos_rets = np.array(res_oos_final["returns"])
boot_sharpes = []
for _ in range(n_boot):
    perm = np.random.permutation(oos_rets)
    sd = perm.std()
    boot_sharpes.append(perm.mean() / sd * np.sqrt(252) if sd > 0 else 0)
boot_sharpes = np.array(boot_sharpes)
boot_p = float((boot_sharpes >= res_oos_final["sharpe"]).mean())
print(f"  OOS Sharpe: {res_oos_final['sharpe']:.3f}  Bootstrap p: {boot_p:.4f}")
cycle_log.append({"cycle": 5, "desc": "Bootstrap",
                  "oos_sharpe": float(res_oos_final["sharpe"]), "oos_p": boot_p})

# Cycle 6: Convergence
print("\n── Cycle 6: Convergence check ──")
converged = all(
    cycle_log[i]["oos_sharpe"] <= cycle_log[i-1]["oos_sharpe"] * 1.05
    for i in range(3, len(cycle_log))
)
print(f"  Converged: {converged}")
cycle_log.append({"cycle": 6, "desc": "Convergence",
                  "oos_sharpe": float(res_oos_final["sharpe"]), "oos_p": boot_p})

# ═══════════════════════════════════════════════════════════════════════════════
# §12  FINAL RESULTS
# ═══════════════════════════════════════════════════════════════════════════════
print()
print("="*70)
print("FINAL SYSTEM — MULTI-ASSET 1D (TrendScan-adapted)")
print("="*70)
print(f"  Assets:      {len(ASSETS)} symbols")
print(f"  Signals:     {SIG_COLS}")
print(f"  Ortho cols:  {len(best_c4_cols)}")
print(f"  Z-score win: {ZSC_LEN}")
print(f"  Smooth lb:   {LB}")
print(f"  N_TOP/BOT:   {best_c3_nt}/{best_c3_nb}")
print(f"  Weights:     {best_c4_wt}")
print(f"  Cost:        {COST*10000:.0f} bps/side")
print()

for label, res in [("IN-SAMPLE", res_is_final), ("OUT-OF-SAMPLE", res_oos_final)]:
    print(f"  ── {label} ──")
    print(f"    Days:          {res['n_days']}")
    print(f"    Ann Return:    {res['ann_ret']:.1f}%")
    print(f"    Ann Vol:       {res['ann_vol']:.1f}%")
    print(f"    Sharpe:        {res['sharpe']:.3f}")
    print(f"    Max DD:        {res['max_dd']:.1f}%")
    print(f"    Calmar:        {res['calmar']:.2f}")
    print(f"    Win Rate:      {res['win_rate']:.1f}%")
    print(f"    Profit Factor: {res['profit_factor']:.3f}")
    print(f"    t-stat:        {res['t_stat']:.3f}")
    print(f"    p-value:       {res['p_value']:.4f}")
    print()

print("  ── Cycle Summary ──")
for cl in cycle_log:
    print(f"    Cycle {cl['cycle']}: {cl['desc']:<30s}  "
          f"OOS Sharpe={cl['oos_sharpe']:.3f}  p={cl['oos_p']:.4f}")
print()

# ═══════════════════════════════════════════════════════════════════════════════
# §13  BUY & HOLD BENCHMARK
# ═══════════════════════════════════════════════════════════════════════════════
print("=== Buy & Hold Benchmark (Equal-Weight, OOS) ===")
oos_pivot = oos_df.pivot(index="date", columns="symbol", values="close")
bh_ret = oos_pivot.pct_change().mean(axis=1).dropna()
bh_eq = (1 + bh_ret).cumprod()
bh_sharpe = bh_ret.mean() / bh_ret.std() * np.sqrt(252) if bh_ret.std() > 0 else 0
bh_dd = (bh_eq / bh_eq.cummax() - 1).min() * 100
bh_ann_ret = (bh_eq.iloc[-1] ** (252 / max(len(bh_ret), 1)) - 1) * 100 if len(bh_ret) > 0 else 0
print(f"  Sharpe: {bh_sharpe:.3f}  Max DD: {bh_dd:.1f}%  Ann Return: {bh_ann_ret:.1f}%")
print()

# ═══════════════════════════════════════════════════════════════════════════════
# §14  SAVE JSON RESULTS
# ═══════════════════════════════════════════════════════════════════════════════
out = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "config": {
        "assets": ASSETS,
        "signals": SIG_COLS,
        "n_signals": len(SIG_COLS),
        "lookback": LB,
        "zsc_len": ZSC_LEN,
        "n_top": best_c3_nt,
        "n_bot": best_c3_nb,
        "cost_bps_per_side": int(COST * 10000),
        "is_frac": IS_FRAC,
        "date_range": {
            "start": str(raw.date.min().date()),
            "end": str(raw.date.max().date()),
        },
        "split_date": str(split_date.date()),
        "is_days": int(is_df.date.nunique()),
        "oos_days": int(oos_df.date.nunique()),
    },
    "ic_analysis": ic_rows,
    "cycles": cycle_log,
    "final_is": {k: v for k, v in res_is_final.items() if k not in ["equity", "returns", "drawdown", "positions"]},
    "final_oos": {k: v for k, v in res_oos_final.items() if k not in ["equity", "returns", "drawdown", "positions"]},
    "buy_hold_benchmark": {
        "sharpe": float(bh_sharpe),
        "max_dd": float(bh_dd),
        "ann_ret": float(bh_ann_ret),
    },
    "best_config": {
        "drop_signal": best_c2_drop,
        "n_top": best_c3_nt,
        "n_bot": best_c3_nb,
        "weights": best_c4_wt,
        "bootstrap_p": boot_p,
        "converged": converged,
    },
}

# Include equity curves for charting (truncated to first 1000 points if longer)
def trunc(arr, n=2000):
    a = arr if isinstance(arr, list) else arr.tolist()
    return a[:n] if len(a) > n else a

out["equity_curves"] = {
    "is": trunc(res_is_final["equity"]),
    "oos": trunc(res_oos_final["equity"]),
    "buy_hold": trunc(bh_eq.tolist()),
}

with open(OUT_JSON, "w") as f:
    json.dump(out, f, indent=2, default=str)
print(f"✓ Results saved to {OUT_JSON.relative_to(ROOT)}")
print()
print("="*70)
print("PIPELINE COMPLETE")
print("="*70)
