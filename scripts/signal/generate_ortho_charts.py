#!/usr/bin/env python3
"""
Generate charts for OrthoSys v6.1 backtest results.
Reads scripts/signal/ortho_results.json and writes PNGs to scripts/signal/charts/ortho/.
"""

import json
import os
import matplotlib.font_manager as fm

# Register fonts for symbol fallback (charts are English-only)
fm.fontManager.addfont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')

import matplotlib.pyplot as plt
plt.rcParams['font.sans-serif'] = ['DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

# TrendScan color palette
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

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RESULTS_PATH = os.path.join(SCRIPT_DIR, 'ortho_results.json')
OUT_DIR = os.path.join(SCRIPT_DIR, 'charts', 'ortho')
os.makedirs(OUT_DIR, exist_ok=True)

with open(RESULTS_PATH) as f:
    d = json.load(f)

# ─── Chart 1: Threshold sweep on TRAIN ───────────────────────────────────────
fig, ax = plt.subplots(figsize=(10, 5), constrained_layout=True)
sweep = d['threshold_sweep_train']
taus = [s['tau'] for s in sweep]
pre_hits = [s['pre_hit_rate'] * 100 if s['pre_hit_rate'] else 0 for s in sweep]
post_hits = [s['post_hit_rate'] * 100 if s['post_hit_rate'] else 0 for s in sweep]
counts = [s['total'] for s in sweep]

ax2 = ax.twinx()
ax2.bar(taus, counts, width=0.05, alpha=0.2, color=COL_BLUE, label='Signal count')
ax2.set_ylabel('Signal count', color=COL_BLUE)
ax2.tick_params(colors=COL_BLUE, labelsize=9)
for spine in ax2.spines.values():
    spine.set_color(COL_BORDER)

ax.plot(taus, pre_hits, marker='o', color=COL_GREEN, linewidth=2, label='Pre-cost hit rate')
ax.plot(taus, post_hits, marker='s', color=COL_AMBER, linewidth=2, label='Post-cost hit rate')
ax.axhline(50, color=COL_TEXT, linestyle=':', alpha=0.5, label='Random (50%)')
best_tau = d['summary']['best_tau']
ax.axvline(best_tau, color=COL_RED, linestyle='--', alpha=0.7, label=f'Best τ = {best_tau}')

ax.set_xlabel('Threshold τ (composite z-score)')
ax.set_ylabel('Hit rate (%)')
ax.set_title('OrthoSys v6.1 — Threshold sweep on TRAIN (13 symbols, daily bars)')
ax.legend(loc='lower right', fontsize=9, facecolor=COL_BG2, edgecolor=COL_BORDER, labelcolor=COL_TEXT)
style_dark(ax)
plt.savefig(os.path.join(OUT_DIR, 'threshold_sweep.png'), dpi=120)
plt.close()
print(f'✓ threshold_sweep.png')

# ─── Chart 2: Period comparison (TRAIN vs VAL vs OOS) ────────────────────────
fig, ax = plt.subplots(figsize=(10, 5), constrained_layout=True)
periods = ['TRAIN', 'VALIDATION', 'OOS']
labels = ['TRAIN (tune)', 'VALIDATION (hold)', 'OOS (untouched)']
pre_hits = [hr['preHitRate'] * 100 if hr['preHitRate'] else 0 for hr in [d['period_hit_rates'][p]['combined'] for p in periods]]
post_hits = [hr['postHitRate'] * 100 if hr['postHitRate'] else 0 for hr in [d['period_hit_rates'][p]['combined'] for p in periods]]
counts = [d['period_hit_rates'][p]['combined']['count'] for p in periods]

x = range(len(periods))
width = 0.35
ax.bar([i - width/2 for i in x], pre_hits, width, color=COL_GREEN, label='Pre-cost hit rate')
ax.bar([i + width/2 for i in x], post_hits, width, color=COL_AMBER, label='Post-cost hit rate')
ax.axhline(50, color=COL_TEXT, linestyle=':', alpha=0.5, label='Random (50%)')

for i, (c, ph) in enumerate(zip(counts, pre_hits)):
    ax.text(i - width/2, ph + 1, f'{ph:.1f}%', ha='center', color=COL_TEXT, fontsize=9, fontweight='bold')
    ax.text(i, -8, f'n={c}', ha='center', color=COL_TEXT, fontsize=8)

ax.set_xticks(list(x))
ax.set_xticklabels(labels)
ax.set_ylabel('Combined hit rate (%)')
ax.set_title(f'OrthoSys v6.1 — Walk-forward validation (τ={best_tau}, 10-day forward, 20bps fees)')
ax.legend(loc='upper right', fontsize=9, facecolor=COL_BG2, edgecolor=COL_BORDER, labelcolor=COL_TEXT)
ax.set_ylim(0, 70)
style_dark(ax)
plt.savefig(os.path.join(OUT_DIR, 'period_comparison.png'), dpi=120)
plt.close()
print(f'✓ period_comparison.png')

# ─── Chart 3: Per-symbol OOS performance ─────────────────────────────────────
fig, ax = plt.subplots(figsize=(11, 6), constrained_layout=True)
per_sym = d['per_symbol_oos']
symbols = list(per_sym.keys())
pre_hits = [per_sym[s]['combined']['preHitRate'] * 100 if per_sym[s]['combined']['preHitRate'] else 0 for s in symbols]
post_hits = [per_sym[s]['combined']['postHitRate'] * 100 if per_sym[s]['combined']['postHitRate'] else 0 for s in symbols]
counts = [per_sym[s]['combined']['count'] for s in symbols]
avg_rets = [per_sym[s]['combined']['avgPreRetPct'] if per_sym[s]['combined']['avgPreRetPct'] else 0 for s in symbols]

# Sort by pre-hit rate descending
order = sorted(range(len(symbols)), key=lambda i: -pre_hits[i])
symbols = [symbols[i] for i in order]
pre_hits = [pre_hits[i] for i in order]
post_hits = [post_hits[i] for i in order]
counts = [counts[i] for i in order]
avg_rets = [avg_rets[i] for i in order]

colors = [COL_GREEN if h >= 55 else COL_AMBER if h >= 50 else COL_RED for h in pre_hits]
y = range(len(symbols))
ax.barh(list(y), pre_hits, color=colors, alpha=0.8)
ax.axvline(50, color=COL_TEXT, linestyle=':', alpha=0.5)

for i, (h, c, r) in enumerate(zip(pre_hits, counts, avg_rets)):
    ax.text(h + 1, i, f'{h:.1f}% (n={c}, ret={r:+.1f}%)', va='center', color=COL_TEXT, fontsize=8)

ax.set_yticks(list(y))
ax.set_yticklabels(symbols)
ax.set_xlabel('OOS pre-cost hit rate (%)')
ax.set_title('OrthoSys v6.1 — Per-symbol OOS performance (10-day forward, τ=0.4)')
ax.set_xlim(0, 100)
style_dark(ax)
plt.savefig(os.path.join(OUT_DIR, 'per_symbol_performance.png'), dpi=120)
plt.close()
print(f'✓ per_symbol_performance.png')

# ─── Chart 4: Ablation — each signal's marginal contribution ────────────────
fig, ax = plt.subplots(figsize=(11, 6), constrained_layout=True)
ablation = d['ablation']['ablations']
signal_names = list(ablation.keys())
train_deltas = [ablation[s]['TRAIN']['delta_preHit'] for s in signal_names]
oos_deltas = [ablation[s]['OOS']['delta_preHit'] for s in signal_names]

# Sort by OOS delta (most negative = most important signal)
order = sorted(range(len(signal_names)), key=lambda i: oos_deltas[i] if oos_deltas[i] is not None else 0)
signal_names = [signal_names[i] for i in order]
train_deltas = [train_deltas[i] for i in order]
oos_deltas = [oos_deltas[i] for i in order]

y = range(len(signal_names))
width = 0.35
ax.barh([i - width/2 for i in y], train_deltas, width, color=COL_BLUE, label='TRAIN Δ (in-sample)')
ax.barh([i + width/2 for i in y], oos_deltas, width, color=COL_AMBER, label='OOS Δ (out-of-sample)')
ax.axvline(0, color=COL_TEXT, linestyle='-', alpha=0.7)

for i, (td, od) in enumerate(zip(train_deltas, oos_deltas)):
    if td is not None:
        ax.text(td - 0.2 if td < 0 else td + 0.1, i - width/2, f'{td:+.2f}', va='center', color=COL_TEXT, fontsize=7, ha='right' if td < 0 else 'left')
    if od is not None:
        ax.text(od - 0.2 if od < 0 else od + 0.1, i + width/2, f'{od:+.2f}', va='center', color=COL_TEXT, fontsize=7, ha='right' if od < 0 else 'left')

ax.set_yticks(list(y))
ax.set_yticklabels(signal_names)
ax.set_xlabel('Δ pre-cost hit rate (pp) — negative = removing signal HURTS (signal is valuable)')
ax.set_title('OrthoSys v6.1 — Signal ablation (each signal disabled, weight=0)')
ax.legend(loc='lower right', fontsize=9, facecolor=COL_BG2, edgecolor=COL_BORDER, labelcolor=COL_TEXT)
style_dark(ax)
plt.savefig(os.path.join(OUT_DIR, 'ablation.png'), dpi=120)
plt.close()
print(f'✓ ablation.png')

# ─── Chart 5: Sensitivity sweeps (lb + zsc_len) ──────────────────────────────
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 5), constrained_layout=True)

# lb sweep
lb_sweep = d['sensitivity']['lb']
lbs = [s['lb'] for s in lb_sweep]
train_hits = [s['trainHit'] * 100 if s['trainHit'] else 0 for s in lb_sweep]
oos_hits = [s['oosHit'] * 100 if s['oosHit'] else 0 for s in lb_sweep]
ax1.plot(lbs, train_hits, marker='o', color=COL_BLUE, linewidth=2, label='TRAIN')
ax1.plot(lbs, oos_hits, marker='s', color=COL_GREEN, linewidth=2, label='OOS')
ax1.axhline(50, color=COL_TEXT, linestyle=':', alpha=0.5)
ax1.axvline(5, color=COL_RED, linestyle='--', alpha=0.5, label='Default lb=5')
ax1.set_xlabel('Smoothing lookback (lb)')
ax1.set_ylabel('Pre-cost hit rate (%)')
ax1.set_title('Sensitivity: smoothing lookback')
ax1.legend(fontsize=9, facecolor=COL_BG2, edgecolor=COL_BORDER, labelcolor=COL_TEXT)
style_dark(ax1)

# zsc_len sweep
zsc_sweep = d['sensitivity']['zsc_len']
zscs = [s['zsc'] for s in zsc_sweep]
train_hits = [s['trainHit'] * 100 if s['trainHit'] else 0 for s in zsc_sweep]
oos_hits = [s['oosHit'] * 100 if s['oosHit'] else 0 for s in zsc_sweep]
ax2.plot(zscs, train_hits, marker='o', color=COL_BLUE, linewidth=2, label='TRAIN')
ax2.plot(zscs, oos_hits, marker='s', color=COL_GREEN, linewidth=2, label='OOS')
ax2.axhline(50, color=COL_TEXT, linestyle=':', alpha=0.5)
ax2.axvline(80, color=COL_RED, linestyle='--', alpha=0.5, label='Default zsc_len=80')
ax2.set_xlabel('Standardisation window (zsc_len)')
ax2.set_ylabel('Pre-cost hit rate (%)')
ax2.set_title('Sensitivity: standardisation window')
ax2.legend(fontsize=9, facecolor=COL_BG2, edgecolor=COL_BORDER, labelcolor=COL_TEXT)
style_dark(ax2)

plt.savefig(os.path.join(OUT_DIR, 'sensitivity.png'), dpi=120)
plt.close()
print(f'✓ sensitivity.png')

# ─── Chart 6: Forward window comparison ──────────────────────────────────────
fig, ax = plt.subplots(figsize=(10, 5), constrained_layout=True)
fwd_sweep = d['forward_window_sweep_oos']
windows = [f"{w}d" for w in [1, 3, 5, 10, 20]]
pre_hits = [fwd_sweep[str(w)]['combined']['preHitRate'] * 100 if fwd_sweep[str(w)]['combined']['preHitRate'] else 0 for w in [1, 3, 5, 10, 20]]
post_hits = [fwd_sweep[str(w)]['combined']['postHitRate'] * 100 if fwd_sweep[str(w)]['combined']['postHitRate'] else 0 for w in [1, 3, 5, 10, 20]]

x = range(len(windows))
width = 0.35
ax.bar([i - width/2 for i in x], pre_hits, width, color=COL_GREEN, label='Pre-cost hit rate')
ax.bar([i + width/2 for i in x], post_hits, width, color=COL_AMBER, label='Post-cost hit rate')
ax.axhline(50, color=COL_TEXT, linestyle=':', alpha=0.5, label='Random (50%)')

for i, (ph, po) in enumerate(zip(pre_hits, post_hits)):
    ax.text(i - width/2, ph + 0.5, f'{ph:.1f}%', ha='center', color=COL_TEXT, fontsize=9, fontweight='bold')
    ax.text(i + width/2, po + 0.5, f'{po:.1f}%', ha='center', color=COL_TEXT, fontsize=9, fontweight='bold')

ax.set_xticks(list(x))
ax.set_xticklabels(windows)
ax.set_xlabel('Forward window')
ax.set_ylabel('OOS hit rate (%)')
ax.set_title('OrthoSys v6.1 — Forward window comparison (OOS, τ=0.4)')
ax.legend(loc='upper right', fontsize=9, facecolor=COL_BG2, edgecolor=COL_BORDER, labelcolor=COL_TEXT)
ax.set_ylim(0, 65)
style_dark(ax)
plt.savefig(os.path.join(OUT_DIR, 'forward_window_comparison.png'), dpi=120)
plt.close()
print(f'✓ forward_window_comparison.png')

print()
print(f'All charts saved to: {OUT_DIR}')
