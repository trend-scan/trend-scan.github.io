#!/usr/bin/env python3
"""Generate charts for the daily-tuned Ortho System backtest."""

import json
import os
from pathlib import Path
import matplotlib.font_manager as fm
fm.fontManager.addfont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
import matplotlib.pyplot as plt
plt.rcParams['font.sans-serif'] = ['DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

# TrendScan palette
COL_GREEN = '#00e676'
COL_AMBER = '#f5c842'
COL_RED = '#ff4444'
COL_BLUE = '#4d9fff'
COL_TEXT = '#d0d0c4'
COL_BG = '#07070a'
COL_BG1 = '#0c0c10'
COL_BG2 = '#111118'
COL_BORDER = '#22222d'

def style_dark(ax):
    ax.set_facecolor(COL_BG1)
    ax.figure.set_facecolor(COL_BG)
    ax.tick_params(colors=COL_TEXT, labelsize=9)
    for spine in ax.spines.values():
        spine.set_color(COL_BORDER)
    ax.title.set_color(COL_TEXT)
    ax.xaxis.label.set_color(COL_TEXT)
    ax.yaxis.label.set_color(COL_TEXT)
    ax.grid(True, color=COL_BORDER, alpha=0.3, linestyle='--')

SCRIPT_DIR = Path(__file__).parent
RESULTS_PATH = SCRIPT_DIR / 'ortho_daily_results.json'
OUT_DIR = SCRIPT_DIR / 'charts' / 'ortho_daily'
OUT_DIR.mkdir(parents=True, exist_ok=True)

with open(RESULTS_PATH) as f:
    d = json.load(f)

# ─── Chart 1: Equity curves (IS vs OOS vs Buy&Hold) ──────────────────────────
fig, ax = plt.subplots(figsize=(12, 6), constrained_layout=True)
eq_is = d['equity_curves']['is']
eq_oos = d['equity_curves']['oos']
eq_bh = d['equity_curves']['buy_hold']

# Normalize each to start at 1.0
def normalize(arr):
    if not arr or arr[0] == 0:
        return arr
    return [v / arr[0] for v in arr]

ax.plot(range(len(eq_is)), normalize(eq_is), color=COL_BLUE, linewidth=2, label=f"IS (Strategy)")
# Trim to equal lengths (BH may have 1 less due to pct_change dropna)
n_oos = min(len(eq_oos), len(eq_bh))
oos_x = range(len(eq_is), len(eq_is) + n_oos)
ax.plot(oos_x, normalize(eq_oos[:n_oos]), color=COL_AMBER, linewidth=2, label=f"OOS (Strategy)")
ax.plot(oos_x, normalize(eq_bh[:n_oos]), color=COL_GREEN, linewidth=2, linestyle='--', label=f"OOS (Buy & Hold)")

# Mark IS/OOS split
ax.axvline(len(eq_is), color=COL_TEXT, linestyle=':', alpha=0.5)
ax.text(len(eq_is) + 5, ax.get_ylim()[1] * 0.9, 'OOS →', color=COL_TEXT, fontsize=10)

ax.set_xlabel('Trading days')
ax.set_ylabel('Equity (normalized to 1.0)')
ax.set_title('Ortho System v6.1 (daily-tuned) — Equity Curves\n13 symbols, 2022-01 → 2025-07, 60/40 IS/OOS split')
ax.legend(loc='upper left', fontsize=10, facecolor=COL_BG2, edgecolor=COL_BORDER, labelcolor=COL_TEXT)
style_dark(ax)
plt.savefig(OUT_DIR / 'equity_curves.png', dpi=120)
plt.close()
print('✓ equity_curves.png')

# ─── Chart 2: IC Analysis (per-signal Information Coefficient) ───────────────
fig, ax = plt.subplots(figsize=(11, 6), constrained_layout=True)
ic_data = d['ic_analysis']
signals = [r['signal'] for r in ic_data]
is_ics = [r['IS_IC'] for r in ic_data]
oos_ics = [r['OOS_IC'] for r in ic_data]

# Handle NaN values
is_ics = [v if v is not None and not (isinstance(v, float) and v != v) else 0 for v in is_ics]
oos_ics = [v if v is not None and not (isinstance(v, float) and v != v) else 0 for v in oos_ics]

y = range(len(signals))
width = 0.35
ax.barh([i - width/2 for i in y], is_ics, width, color=COL_BLUE, label='IS IC')
ax.barh([i + width/2 for i in y], oos_ics, width, color=COL_GREEN, label='OOS IC')
ax.axvline(0, color=COL_TEXT, linestyle='-', alpha=0.7)
ax.axvline(0.05, color=COL_GREEN, linestyle=':', alpha=0.4, label='Strong IC threshold (0.05)')
ax.axvline(-0.05, color=COL_RED, linestyle=':', alpha=0.4)

for i, (iv, ov) in enumerate(zip(is_ics, oos_ics)):
    ax.text(iv + 0.001 if iv >= 0 else iv - 0.001, i - width/2,
            f'{iv:+.4f}', va='center', color=COL_TEXT, fontsize=8,
            ha='left' if iv >= 0 else 'right')
    ax.text(ov + 0.001 if ov >= 0 else ov - 0.001, i + width/2,
            f'{ov:+.4f}', va='center', color=COL_TEXT, fontsize=8,
            ha='left' if ov >= 0 else 'right')

ax.set_yticks(list(y))
ax.set_yticklabels(signals)
ax.set_xlabel('Spearman Rank IC (per-signal, cross-sectional)')
ax.set_title('Ortho System v6.1 — Per-Signal Information Coefficient (IC)\nPositive IC = signal predicts next-day return in the predicted direction')
ax.legend(loc='lower right', fontsize=9, facecolor=COL_BG2, edgecolor=COL_BORDER, labelcolor=COL_TEXT)
style_dark(ax)
plt.savefig(OUT_DIR / 'ic_analysis.png', dpi=120)
plt.close()
print('✓ ic_analysis.png')

# ─── Chart 3: Cycle progression ─────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(11, 5), constrained_layout=True)
cycles = d['cycles']
cycle_nums = [c['cycle'] for c in cycles]
cycle_sharpes = [c['oos_sharpe'] for c in cycles]
cycle_labels = [c['desc'] for c in cycles]

colors = [COL_RED if s < 0 else COL_GREEN for s in cycle_sharpes]
bars = ax.bar(cycle_nums, cycle_sharpes, color=colors, alpha=0.8)
ax.axhline(0, color=COL_TEXT, linestyle='-', alpha=0.7)
ax.axhline(1, color=COL_GREEN, linestyle=':', alpha=0.4, label='Acceptable Sharpe = 1.0')
ax.axhline(-1, color=COL_RED, linestyle=':', alpha=0.4, label='Unacceptable Sharpe = -1.0')

for i, (n, s, lbl) in enumerate(zip(cycle_nums, cycle_sharpes, cycle_labels)):
    ax.text(n, s - 0.15 if s < 0 else s + 0.05, f'{s:+.2f}',
            ha='center', color=COL_TEXT, fontsize=10, fontweight='bold')
    ax.text(n, -2.6, lbl, ha='center', color=COL_TEXT, fontsize=8, rotation=0,
            wrap=True)

ax.set_xticks(cycle_nums)
ax.set_xticklabels([f'Cycle {n}' for n in cycle_nums])
ax.set_ylabel('OOS Sharpe Ratio')
ax.set_title('Ortho System v6.1 — Iteration Cycle Progression\n(All cycles produce negative OOS Sharpe = strategy loses money)')
ax.set_ylim(-3, 1.5)
ax.legend(loc='upper right', fontsize=9, facecolor=COL_BG2, edgecolor=COL_BORDER, labelcolor=COL_TEXT)
style_dark(ax)
plt.savefig(OUT_DIR / 'cycle_progression.png', dpi=120)
plt.close()
print('✓ cycle_progression.png')

# ─── Chart 4: Final metrics comparison ───────────────────────────────────────
fig, ax = plt.subplots(figsize=(11, 6), constrained_layout=True)
metrics_is = d['final_is']
metrics_oos = d['final_oos']
metrics_bh = d['buy_hold_benchmark']

categories = ['Sharpe', 'Ann Return %', 'Max DD %', 'Win Rate %']
is_vals = [metrics_is['sharpe'], metrics_is['ann_ret'], metrics_is['max_dd'], metrics_is['win_rate']]
oos_vals = [metrics_oos['sharpe'], metrics_oos['ann_ret'], metrics_oos['max_dd'], metrics_oos['win_rate']]
bh_vals = [metrics_bh['sharpe'], metrics_bh['ann_ret'], metrics_bh['max_dd'], 50]  # BH win rate ~50

x = range(len(categories))
width = 0.27
ax.bar([i - width for i in x], is_vals, width, color=COL_BLUE, label='IS (Strategy)')
ax.bar([i for i in x], oos_vals, width, color=COL_AMBER, label='OOS (Strategy)')
ax.bar([i + width for i in x], bh_vals, width, color=COL_GREEN, label='OOS (Buy & Hold)', alpha=0.7)
ax.axhline(0, color=COL_TEXT, linestyle='-', alpha=0.7)

for i, (iv, ov, bv) in enumerate(zip(is_vals, oos_vals, bh_vals)):
    ax.text(i - width, iv + 1 if iv >= 0 else iv - 3, f'{iv:+.1f}', ha='center', color=COL_TEXT, fontsize=9)
    ax.text(i, ov + 1 if ov >= 0 else ov - 3, f'{ov:+.1f}', ha='center', color=COL_TEXT, fontsize=9)
    ax.text(i + width, bv + 1 if bv >= 0 else bv - 3, f'{bv:+.1f}', ha='center', color=COL_TEXT, fontsize=9)

ax.set_xticks(list(x))
ax.set_xticklabels(categories)
ax.set_ylabel('Value')
ax.set_title('Ortho System v6.1 — Final Metrics vs Buy & Hold Benchmark\n(Strategy underperforms B&H on Sharpe, return, AND drawdown)')
ax.legend(loc='upper right', fontsize=9, facecolor=COL_BG2, edgecolor=COL_BORDER, labelcolor=COL_TEXT)
style_dark(ax)
plt.savefig(OUT_DIR / 'metrics_comparison.png', dpi=120)
plt.close()
print('✓ metrics_comparison.png')

# ─── Chart 5: Comparison vs my earlier v6.1 4H-port (daily data) ─────────────
fig, ax = plt.subplots(figsize=(11, 6), constrained_layout=True)
# v6.1 4H-port results (from ortho_results.json)
v61_results = {
    'OOS pre-hit': 55.0,
    'OOS post-hit': 54.1,
    'OOS avg return (10d)': 1.21,
}
# Daily-tuned system results (this run)
daily_results = {
    'OOS pre-hit': metrics_oos['win_rate'],
    'OOS post-hit': None,  # not directly comparable
    'OOS avg return (10d)': metrics_oos['ann_ret'] / 25,  # approx daily avg
}
# TrendScan v3.1 results
ts_results = {
    'OOS pre-hit': 41.8,
    'OOS post-hit': 41.3,
    'OOS avg return (10d)': -0.69,
}

labels = list(v61_results.keys())
x = range(len(labels))
width = 0.27
v61_vals = [v61_results[l] for l in labels]
daily_vals = [daily_results.get(l, 0) or 0 for l in labels]
ts_vals = [ts_results[l] for l in labels]

ax.bar([i - width for i in x], v61_vals, width, color=COL_GREEN,
       label='v6.1 4H-port on daily (my earlier test)')
ax.bar([i for i in x], daily_vals, width, color=COL_RED,
       label='v6.1 daily-tuned (this run, full system)')
ax.bar([i + width for i in x], ts_vals, width, color=COL_BLUE,
       label='TrendScan v3.1 (existing)', alpha=0.7)

ax.axhline(50, color=COL_TEXT, linestyle=':', alpha=0.5, label='Random (50%)')
ax.set_xticks(list(x))
ax.set_xticklabels(labels, fontsize=9)
ax.set_ylabel('Value (%)')
ax.set_title('Three-Way Comparison: Which Signal Approach Wins?\n(v6.1 4H-port was an artifact of per-asset thresholding — full system underperforms)')
ax.legend(loc='upper right', fontsize=9, facecolor=COL_BG2, edgecolor=COL_BORDER, labelcolor=COL_TEXT)
style_dark(ax)
plt.savefig(OUT_DIR / 'three_way_comparison.png', dpi=120)
plt.close()
print('✓ three_way_comparison.png')

print()
print(f'All charts saved to: {OUT_DIR}')
