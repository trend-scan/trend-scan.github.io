#!/usr/bin/env python3
"""
generate_charts.py — Render PNGs from walk_forward_results.json.

Reads scripts/signal/walk_forward_results.json (produced by
walk_forward_backtest.js) and writes 5 charts to scripts/signal/charts/:

  1. hit_rate_by_period.png        — STRONG/WEAK pre+post-cost hit rate per period
  2. threshold_heatmap.png         — STRONG × WEAK threshold → TRAIN combined pre-hit
  3. per_symbol_performance.png    — per-symbol OOS hit rates (STRONG vs WEAK)
  4. forward_window_comparison.png — hit rate vs forward window (1d, 3d, 5d, 10d, 20d)
  5. gate_ablation.png             — OOS STRONG hit-rate Δ when each gate is removed

Uses Noto Sans SC for CJK compatibility (per project convention).

Usage:
  python3 scripts/signal/generate_charts.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")  # headless
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
from matplotlib.patches import Patch
import numpy as np


# ─── Paths ───────────────────────────────────────────────────────────────────

HERE = Path(__file__).resolve().parent
RESULTS_JSON = HERE / "walk_forward_results.json"
OUT_DIR = HERE / "charts"
OUT_DIR.mkdir(parents=True, exist_ok=True)


# ─── Font setup (Noto Sans SC, per project convention) ───────────────────────

def setup_fonts():
    """Register a Noto Sans SC font (per project convention); fall back gracefully.

    Order of preference:
      1. Static Noto Sans SC OTF/TTF (best — sans-serif, CJK-supported)
      2. Noto Sans CJK SC (alternative packaging)
      3. Noto Serif SC (CJK-supported, serif style — same family)
      4. DejaVu Sans (matplotlib default; no CJK support)
    """
    candidates = [
        # Static Noto Sans SC releases
        "/usr/share/fonts/opentype/noto/NotoSansSC-Regular.otf",
        "/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf",
        "/usr/share/fonts/noto/NotoSansSC-Regular.otf",
        # Noto Sans CJK SC (alt packaging on some distros)
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJKsc-Regular.otf",
        # Noto Serif SC (CJK-supported fallback, serif style)
        "/usr/share/fonts/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            try:
                fm.fontManager.addfont(path)
                name = fm.FontProperties(fname=path).get_name()
                plt.rcParams["font.family"] = name
                plt.rcParams["axes.unicode_minus"] = False
                print(f"  ✓ Font: {name} ({path})")
                return
            except Exception as e:
                print(f"  ⚠ Font load failed for {path}: {e}")
                continue

    # Last resort: try the variable NotoSansSC[wght] via direct family name
    # (matplotlib will use fontconfig under the hood)
    variable_path = "/usr/share/fonts/truetype/chinese/NotoSansSC[wght].ttf"
    if Path(variable_path).exists():
        try:
            fm.fontManager.addfont(variable_path)
            name = fm.FontProperties(fname=variable_path).get_name()
            plt.rcParams["font.family"] = name
            plt.rcParams["axes.unicode_minus"] = False
            print(f"  ✓ Font (variable): {name} ({variable_path})")
            return
        except Exception:
            pass  # fall through to default

    print("  ⚠ Noto Sans SC not found; falling back to DejaVu Sans (no CJK support)")
    plt.rcParams["font.family"] = "DejaVu Sans"
    plt.rcParams["axes.unicode_minus"] = False


# ─── Color palette ───────────────────────────────────────────────────────────

# TrendScan-inspired palette (deep blue + accent gold + neutral grays)
COLOR_STRONG = "#1f6feb"        # strong blue
COLOR_WEAK   = "#d29922"        # warm gold
COLOR_TRAIN  = "#6e7681"        # neutral gray (TRAIN = baseline/tuning)
COLOR_VAL    = "#1f6feb"        # blue
COLOR_OOS    = "#2ea043"        # green (OOS = the real test)
COLOR_BASELINE = "#6e7681"
COLOR_HELPFUL  = "#2ea043"      # green = removing gate helped
COLOR_HARMFUL  = "#da3633"      # red   = removing gate hurt
COLOR_NEUTRAL  = "#6e7681"
COLOR_REF      = "#da3633"      # 50% reference line
COLOR_FLAG     = "#da3633"


# ─── Helpers ─────────────────────────────────────────────────────────────────

def pct(x, digits=1):
    if x is None:
        return None
    return x * 100

def safe(v):
    return 0.0 if v is None else float(v)


# ─── Chart 1: hit_rate_by_period.png ─────────────────────────────────────────

def chart_hit_rate_by_period(results):
    """Grouped bar chart: STRONG vs WEAK × TRAIN/VAL/OOS, pre & post cost."""
    periods = ["TRAIN", "VALIDATION", "OOS"]
    period_labels = ["TRAIN\n(2022-01 → 2023-06)", "VALIDATION\n(2023-07 → 2024-06)", "OOS\n(2024-07 → 2025-07)"]

    strong_pre = [pct(results["period_hit_rates"][p]["STRONG"]["preHitRate"]) for p in periods]
    strong_post = [pct(results["period_hit_rates"][p]["STRONG"]["postHitRate"]) for p in periods]
    weak_pre = [pct(results["period_hit_rates"][p]["WEAK"]["preHitRate"]) for p in periods]
    weak_post = [pct(results["period_hit_rates"][p]["WEAK"]["postHitRate"]) for p in periods]
    strong_counts = [results["period_hit_rates"][p]["STRONG"]["count"] for p in periods]
    weak_counts = [results["period_hit_rates"][p]["WEAK"]["count"] for p in periods]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 5.5), sharey=True)

    x = np.arange(len(periods))
    width = 0.35

    # STRONG panel
    b1 = ax1.bar(x - width/2, strong_pre, width, label="pre-cost", color=COLOR_STRONG, edgecolor="white", linewidth=0.8)
    b2 = ax1.bar(x + width/2, strong_post, width, label="post-cost", color=COLOR_STRONG, alpha=0.55, edgecolor="white", linewidth=0.8)
    ax1.axhline(50, color=COLOR_REF, linestyle="--", linewidth=1, alpha=0.7, label="50% (coin-flip)")
    ax1.set_title("STRONG signal hit rate by period", fontsize=13, fontweight="bold", pad=10)
    ax1.set_xticks(x)
    ax1.set_xticklabels(period_labels, fontsize=9)
    ax1.set_ylabel("Hit rate (%)")
    ax1.set_ylim(0, max(80, max(filter(None, strong_pre)) + 10))
    ax1.legend(loc="lower right", fontsize=9)
    ax1.grid(axis="y", alpha=0.25)
    for i, (v_pre, v_post, n) in enumerate(zip(strong_pre, strong_post, strong_counts)):
        if v_pre is not None:
            ax1.text(i - width/2, v_pre + 1, f"{v_pre:.1f}%", ha="center", va="bottom", fontsize=9, fontweight="bold")
        if v_post is not None:
            ax1.text(i + width/2, v_post + 1, f"{v_post:.1f}%", ha="center", va="bottom", fontsize=9, color="#444")
        ax1.text(i, -8, f"n={n}", ha="center", va="top", fontsize=8, color="#666")

    # WEAK panel
    b3 = ax2.bar(x - width/2, weak_pre, width, label="pre-cost", color=COLOR_WEAK, edgecolor="white", linewidth=0.8)
    b4 = ax2.bar(x + width/2, weak_post, width, label="post-cost", color=COLOR_WEAK, alpha=0.55, edgecolor="white", linewidth=0.8)
    ax2.axhline(50, color=COLOR_REF, linestyle="--", linewidth=1, alpha=0.7, label="50% (coin-flip)")
    ax2.set_title("WEAK signal hit rate by period", fontsize=13, fontweight="bold", pad=10)
    ax2.set_xticks(x)
    ax2.set_xticklabels(period_labels, fontsize=9)
    ax2.set_ylim(0, max(80, max(filter(None, weak_pre)) + 10))
    ax2.legend(loc="lower right", fontsize=9)
    ax2.grid(axis="y", alpha=0.25)
    for i, (v_pre, v_post, n) in enumerate(zip(weak_pre, weak_post, weak_counts)):
        if v_pre is not None:
            ax2.text(i - width/2, v_pre + 1, f"{v_pre:.1f}%", ha="center", va="bottom", fontsize=9, fontweight="bold")
        if v_post is not None:
            ax2.text(i + width/2, v_post + 1, f"{v_post:.1f}%", ha="center", va="bottom", fontsize=9, color="#444")
        ax2.text(i, -8, f"n={n}", ha="center", va="top", fontsize=8, color="#666")

    best = results["threshold_sweep_train"]["best"]
    fig.suptitle(
        f"Walk-Forward Hit Rates  —  thresholds STRONG={best['strong']}, WEAK={best['weak']}  (10d forward window)",
        fontsize=13, fontweight="bold", y=1.00
    )
    fig.text(0.5, -0.02,
             f"Costs: {results['config']['fees_bps_per_side']}bps/side round-trip + funding over hold. "
             "TRAIN = thresholds tuned here; VAL/OOS = thresholds applied unchanged.",
             ha="center", fontsize=9, color="#666")
    fig.tight_layout()
    out = OUT_DIR / "hit_rate_by_period.png"
    fig.savefig(out, dpi=140, bbox_inches="tight")
    plt.close(fig)
    print(f"  ✓ {out}")


# ─── Chart 2: threshold_heatmap.png ──────────────────────────────────────────

def chart_threshold_heatmap(results):
    """Heatmap: STRONG threshold × WEAK threshold → TRAIN combined pre-cost hit rate."""
    grid = results["threshold_sweep_train"]["grid"]
    best = results["threshold_sweep_train"]["best"]
    min_sig = results["config"]["min_signals_for_tune"]

    # Build matrix [strong_idx][weak_idx]
    thresholds = sorted({c["strong"] for c in grid})
    weaks = sorted({c["weak"] for c in grid})
    mat = np.full((len(thresholds), len(weaks)), np.nan)
    counts = np.zeros((len(thresholds), len(weaks)), dtype=int)
    eligible = np.zeros((len(thresholds), len(weaks)), dtype=bool)
    for c in grid:
        i = thresholds.index(c["strong"])
        j = weaks.index(c["weak"])
        if c["combinedPreHit"] is not None:
            mat[i, j] = c["combinedPreHit"] * 100
        counts[i, j] = c["strongCount"] + c["weakCount"]
        eligible[i, j] = c["strongCount"] >= min_sig and c["weakCount"] >= min_sig

    fig, ax = plt.subplots(figsize=(8.5, 6.5))
    # Use a diverging colormap centered on 50% (coin-flip baseline)
    cmap = plt.cm.RdYlGn.copy()
    cmap.set_bad(color="#f0f0f0")
    masked = np.ma.masked_invalid(mat)
    vmin, vmax = 35, 65
    im = ax.imshow(masked, cmap=cmap, vmin=vmin, vmax=vmax, aspect="auto", origin="lower")

    # Annotate each cell with hit rate + count + eligibility marker
    for i in range(len(thresholds)):
        for j in range(len(weaks)):
            v = mat[i, j]
            if np.isnan(v):
                txt = "—"
                color = "#999"
            else:
                txt = f"{v:.1f}%"
                color = "black" if 40 < v < 60 else ("white" if v <= 40 or v >= 60 else "black")
            n = counts[i, j]
            elig = "✓" if eligible[i, j] else "·"
            ax.text(j, i - 0.18, txt, ha="center", va="center", fontsize=10, fontweight="bold", color=color)
            ax.text(j, i + 0.22, f"n={n}{elig}", ha="center", va="center", fontsize=7.5, color=color)

    # Highlight best cell
    bi = thresholds.index(best["strong"])
    bj = weaks.index(best["weak"])
    ax.add_patch(plt.Rectangle((bj - 0.5, bi - 0.5), 1, 1, fill=False, edgecolor="black", linewidth=3))
    ax.text(bj, bi - 0.42, "BEST", ha="center", va="bottom", fontsize=8, fontweight="bold", color="black",
            bbox=dict(boxstyle="round,pad=0.2", facecolor="white", edgecolor="black", linewidth=0.8))

    ax.set_xticks(range(len(weaks)))
    ax.set_xticklabels([f"w={w}" for w in weaks])
    ax.set_yticks(range(len(thresholds)))
    ax.set_yticklabels([f"s={s}" for s in thresholds])
    ax.set_xlabel("WEAK threshold", fontsize=11)
    ax.set_ylabel("STRONG threshold", fontsize=11)
    ax.set_title(
        "Threshold Sweep on TRAIN (10d forward, combined pre-cost hit rate)\n"
        f"Cell = combined hit%  ·  ✓ eligible (≥{min_sig} STRONG & WEAK signals)  ·  · below threshold",
        fontsize=11, fontweight="bold", pad=12
    )

    cbar = fig.colorbar(im, ax=ax, shrink=0.85, label="Combined pre-cost hit rate (%)")
    cbar.ax.axhline(50, color="black", linewidth=1, linestyle="--", alpha=0.5)

    fig.text(0.5, -0.02,
             f"Best TRAIN thresholds: STRONG={best['strong']}, WEAK={best['weak']}  "
             f"({best['combinedPreHit']*100:.1f}% combined pre-cost hit, n={best['total']})",
             ha="center", fontsize=9, color="#666")
    fig.tight_layout()
    out = OUT_DIR / "threshold_heatmap.png"
    fig.savefig(out, dpi=140, bbox_inches="tight")
    plt.close(fig)
    print(f"  ✓ {out}")


# ─── Chart 3: per_symbol_performance.png ─────────────────────────────────────

def chart_per_symbol_performance(results):
    """Per-symbol OOS STRONG & WEAK hit rates, with 50% reference line and flag markers."""
    symbols = results["config"]["symbols"]
    oos = results["per_symbol"]["OOS"]

    strong_hits, weak_hits = [], []
    strong_counts, weak_counts = [], []
    flags = []
    for s in symbols:
        o = oos.get(s, {})
        sh = o.get("strong", {})
        wh = o.get("weak", {})
        strong_hits.append(pct(sh.get("preHit")))
        weak_hits.append(pct(wh.get("preHit")))
        strong_counts.append(sh.get("count", 0))
        weak_counts.append(wh.get("count", 0))
        flags.append(o.get("flaggedWeak", False))

    fig, ax = plt.subplots(figsize=(13, 6))
    x = np.arange(len(symbols))
    width = 0.38

    # Replace None with 0 for plotting (we'll annotate with — instead)
    strong_plot = [safe(v) for v in strong_hits]
    weak_plot = [safe(v) for v in weak_hits]

    bars_s = ax.bar(x - width/2, strong_plot, width, label="STRONG (long)", color=COLOR_STRONG, edgecolor="white", linewidth=0.6)
    bars_w = ax.bar(x + width/2, weak_plot, width, label="WEAK (short)", color=COLOR_WEAK, edgecolor="white", linewidth=0.6)

    ax.axhline(50, color=COLOR_REF, linestyle="--", linewidth=1.2, alpha=0.7, label="50% (coin-flip)")
    ax.set_xticks(x)
    ax.set_xticklabels(symbols, fontsize=10)
    ax.set_ylabel("Pre-cost hit rate (%)")
    ax.set_title(
        "Per-Symbol OOS Performance (10d forward, pre-cost)\n"
        "Red asterisk = verdict with ≥20 signals has hit rate < 50%",
        fontsize=12, fontweight="bold", pad=10
    )
    ax.set_ylim(0, max(90, max(strong_plot + weak_plot) + 10))
    ax.legend(loc="upper right", fontsize=9)
    ax.grid(axis="y", alpha=0.25)

    # Annotate bars with hit rate + count
    for i, (sv, wv, sc, wc) in enumerate(zip(strong_hits, weak_hits, strong_counts, weak_counts)):
        if sv is not None and sc > 0:
            ax.text(i - width/2, sv + 1.5, f"{sv:.0f}%", ha="center", va="bottom", fontsize=8, fontweight="bold", color=COLOR_STRONG)
            ax.text(i - width/2, -3, f"n={sc}", ha="center", va="top", fontsize=7, color="#666")
        if wv is not None and wc > 0:
            ax.text(i + width/2, wv + 1.5, f"{wv:.0f}%", ha="center", va="bottom", fontsize=8, fontweight="bold", color=COLOR_WEAK)
            ax.text(i + width/2, -3, f"n={wc}", ha="center", va="top", fontsize=7, color="#666")
        # Flag symbol with red asterisk above
        if flags[i]:
            ymax = max(safe(strong_hits[i]), safe(weak_hits[i]))
            ax.text(i, ymax + 6, "⚠", ha="center", va="bottom", fontsize=12, color=COLOR_FLAG, fontweight="bold")

    fig.text(0.5, -0.02,
             "OOS period: 2024-07 → 2025-07. "
             "STRONG counts are small per-symbol (15–48) — treat individual hit rates as noisy.",
             ha="center", fontsize=9, color="#666")
    fig.tight_layout()
    out = OUT_DIR / "per_symbol_performance.png"
    fig.savefig(out, dpi=140, bbox_inches="tight")
    plt.close(fig)
    print(f"  ✓ {out}")


# ─── Chart 4: forward_window_comparison.png ──────────────────────────────────

def chart_forward_window_comparison(results):
    """Line chart: hit rate vs forward window (1d, 3d, 5d, 10d, 20d), one line per period."""
    windows = [int(w) for w in results["config"]["forward_windows"]]
    periods = ["TRAIN", "VALIDATION", "OOS"]
    period_colors = {"TRAIN": COLOR_TRAIN, "VALIDATION": COLOR_VAL, "OOS": COLOR_OOS}
    period_labels = {"TRAIN": "TRAIN (tuned)", "VALIDATION": "VALIDATION (held out)", "OOS": "OOS (untouched)"}

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 5.5), sharey=True)

    # Panel 1: combined pre-cost hit rate
    for p in periods:
        ys = []
        for w in windows:
            v = results["forward_window_sweep"][str(w)][p]["combined"].get("preHitRate")
            ys.append(pct(v) if v is not None else None)
        # Plot, skipping None
        xs = [w for w, y in zip(windows, ys) if y is not None]
        ys_clean = [y for y in ys if y is not None]
        ax1.plot(xs, ys_clean, marker="o", linewidth=2, markersize=7, color=period_colors[p], label=period_labels[p])
        for x, y in zip(xs, ys_clean):
            ax1.text(x, y + 1.5, f"{y:.1f}%", ha="center", va="bottom", fontsize=8, color=period_colors[p])
    ax1.axhline(50, color=COLOR_REF, linestyle="--", linewidth=1, alpha=0.6)
    ax1.set_xlabel("Forward window (days)")
    ax1.set_ylabel("Combined pre-cost hit rate (%)")
    ax1.set_title("Combined (STRONG + WEAK) pre-cost hit rate", fontsize=11, fontweight="bold")
    ax1.set_xticks(windows)
    ax1.set_xticklabels([f"{w}d" for w in windows])
    ax1.set_ylim(35, 65)
    ax1.legend(loc="lower right", fontsize=9)
    ax1.grid(alpha=0.25)

    # Panel 2: STRONG pre-cost hit rate by window
    for p in periods:
        ys = []
        for w in windows:
            v = results["forward_window_sweep"][str(w)][p]["strong"].get("preHit")
            ys.append(pct(v) if v is not None else None)
        xs = [w for w, y in zip(windows, ys) if y is not None]
        ys_clean = [y for y in ys if y is not None]
        ax2.plot(xs, ys_clean, marker="s", linewidth=2, markersize=7, color=period_colors[p], label=period_labels[p])
        for x, y in zip(xs, ys_clean):
            ax2.text(x, y + 1.5, f"{y:.1f}%", ha="center", va="bottom", fontsize=8, color=period_colors[p])
    ax2.axhline(50, color=COLOR_REF, linestyle="--", linewidth=1, alpha=0.6)
    ax2.set_xlabel("Forward window (days)")
    ax2.set_title("STRONG-only pre-cost hit rate", fontsize=11, fontweight="bold")
    ax2.set_xticks(windows)
    ax2.set_xticklabels([f"{w}d" for w in windows])
    ax2.set_ylim(30, 65)
    ax2.legend(loc="lower right", fontsize=9)
    ax2.grid(alpha=0.25)

    best_window = results["config"].get("best_forward_window_train", 10)
    fig.suptitle(
        f"Forward Window Comparison (best TRAIN thresholds applied to all periods)  ·  best TRAIN window = {best_window}d",
        fontsize=12, fontweight="bold", y=1.00
    )
    fig.tight_layout()
    out = OUT_DIR / "forward_window_comparison.png"
    fig.savefig(out, dpi=140, bbox_inches="tight")
    plt.close(fig)
    print(f"  ✓ {out}")


# ─── Chart 5: gate_ablation.png ──────────────────────────────────────────────

def chart_gate_ablation(results):
    """Bar chart: OOS STRONG pre-hit Δ (pp) when each gate is removed."""
    abl = results["ablation"]
    gates = list(abl["ablations"].keys())
    # Compute deltas for TRAIN, VAL, OOS — STRONG pre-hit
    oos_strong_counts_base = abl["baseline"]["OOS"]["strong"]["count"]
    oos_strong_hit_base = abl["baseline"]["OOS"]["strong"]["preHit"] or 0

    train_deltas, val_deltas, oos_deltas = [], [], []
    oos_counts_after = []
    notes = []
    for g in gates:
        a = abl["ablations"][g]
        td = (a["TRAIN"]["delta_strong_preHit"] or 0) * 100
        vd = (a["VALIDATION"]["delta_strong_preHit"] or 0) * 100
        od = (a["OOS"]["delta_strong_preHit"] or 0) * 100
        train_deltas.append(td)
        val_deltas.append(vd)
        oos_deltas.append(od)
        oos_counts_after.append(a["OOS"]["strong"]["count"])
        # Annotate "core gate" when ablation zeros out STRONG signals
        if a["OOS"]["strong"]["count"] == 0 and oos_strong_counts_base > 0:
            notes.append("CORE — kills STRONG")
        elif abs(od) < 0.1 and abs(td) < 0.1 and abs(vd) < 0.1:
            notes.append("no impact")
        elif od > 1.0:
            notes.append("gate HURTS (remove?)")
        elif od < -1.0:
            notes.append("gate HELPS (keep)")
        else:
            notes.append("")

    # Sort by |OOS delta|, but always put "no impact" gates at the end
    order = sorted(
        range(len(gates)),
        key=lambda i: (notes[i] == "no impact", -abs(oos_deltas[i]))
    )
    gates_s = [gates[i] for i in order]
    train_d = [train_deltas[i] for i in order]
    val_d   = [val_deltas[i]   for i in order]
    oos_d   = [oos_deltas[i]   for i in order]
    counts_s = [oos_counts_after[i] for i in order]
    notes_s = [notes[i] for i in order]

    fig, ax = plt.subplots(figsize=(14, 7))
    x = np.arange(len(gates_s))
    width = 0.27

    bars_t = ax.bar(x - width, train_d, width, label="TRAIN Δ", color=COLOR_TRAIN, edgecolor="white", linewidth=0.6)
    bars_v = ax.bar(x,         val_d,   width, label="VALIDATION Δ", color=COLOR_VAL, edgecolor="white", linewidth=0.6)
    bars_o = ax.bar(x + width, oos_d,   width, label="OOS Δ", color=COLOR_OOS, edgecolor="white", linewidth=0.6)

    ax.axhline(0, color="black", linewidth=0.8)
    ax.set_xticks(x)
    ax.set_xticklabels(gates_s, rotation=20, ha="right", fontsize=10)
    ax.set_ylabel("Δ STRONG pre-cost hit rate (pp)")
    ax.set_title(
        f"Per-Gate Ablation — Δ STRONG hit rate when each gate is removed\n"
        f"Baseline OOS: {oos_strong_counts_base} STRONG signals at {oos_strong_hit_base*100:.1f}% hit",
        fontsize=12, fontweight="bold", pad=10
    )

    # Pick a y-range that comfortably contains all bars + room for labels
    all_vals = train_d + val_d + oos_d
    ymin = min(min(all_vals), -60) - 8
    ymax = max(max(all_vals), 12) + 12
    ax.set_ylim(ymin, ymax)

    ax.legend(loc="upper right", fontsize=9)
    ax.grid(axis="y", alpha=0.25)

    # Annotate OOS bars only (to reduce clutter)
    for i, (bar, d) in enumerate(zip(bars_o, oos_d)):
        h = bar.get_height()
        # Place label just past the end of the bar
        if h >= 0:
            y_label = h + 1
            va = "bottom"
        else:
            y_label = h - 1
            va = "top"
        ax.text(bar.get_x() + bar.get_width()/2, y_label,
                f"{d:+.1f}pp", ha="center", va=va,
                fontsize=8.5, fontweight="bold", color=COLOR_OOS)

    # Place note + OOS STRONG count below x-axis (in a fixed position)
    for i, (note, cnt) in enumerate(zip(notes_s, counts_s)):
        y_pos = ymin + 3  # near the bottom of the chart
        ax.text(x[i], y_pos, f"n={cnt}",
                ha="center", va="bottom", fontsize=7.5, color="#666")
        if note:
            ax.text(x[i], y_pos + 3, note,
                    ha="center", va="bottom", fontsize=7.5, color="#444", style="italic")

    fig.text(0.5, -0.04,
             "Positive Δ = removing gate IMPROVED hit rate (gate may be hurting). "
             "Negative Δ = removing gate HURT hit rate (gate is helping). "
             "adaptiveZ/atrExt50ma = CORE gates (ablation → 0 STRONG signals). "
             "returns = no impact on STRONG (only affects DEFENSIVE/WEAK path).",
             ha="center", fontsize=8.5, color="#666", wrap=True)
    fig.tight_layout()
    out = OUT_DIR / "gate_ablation.png"
    fig.savefig(out, dpi=140, bbox_inches="tight")
    plt.close(fig)
    print(f"  ✓ {out}")


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    print("━━━ Generating charts from walk_forward_results.json ━━━")
    if not RESULTS_JSON.exists():
        print(f"✗ Results not found at {RESULTS_JSON}", file=sys.stderr)
        print("  Run: node scripts/signal/walk_forward_backtest.js first", file=sys.stderr)
        sys.exit(1)

    with open(RESULTS_JSON) as f:
        results = json.load(f)

    print(f"  Loaded: {RESULTS_JSON}")
    print(f"  Best thresholds: STRONG={results['threshold_sweep_train']['best']['strong']}, "
          f"WEAK={results['threshold_sweep_train']['best']['weak']}")
    print(f"  Output dir: {OUT_DIR}")
    setup_fonts()
    print("")

    chart_hit_rate_by_period(results)
    chart_threshold_heatmap(results)
    chart_per_symbol_performance(results)
    chart_forward_window_comparison(results)
    if results["config"].get("ablation_enabled", True):
        chart_gate_ablation(results)
    else:
        print("  (skipping gate_ablation.png — ablation not enabled in results)")

    print(f"\n✓ All charts written to {OUT_DIR}")


if __name__ == "__main__":
    main()
