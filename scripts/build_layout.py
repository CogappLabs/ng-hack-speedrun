# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "scipy"]
# ///
"""Snap artworks' continuous (visual_x, visual_y) positions onto a non-overlapping grid.

Each artwork is assigned to exactly one grid cell, minimising the total squared
distance between where it "wants" to be and the cell it gets (Hungarian algorithm).
The grid has some slack (more cells than artworks), so empty cells appear in the
gaps between clusters rather than everything being forced into a solid block.

A high SLACK (several cells per artwork) keeps the overall outline close to the
original scatter plot: sparse regions stay sparse, leaving gaps between tiles.

Usage: uv run scripts/build_layout.py [--slack N] [--preview] [input.tsv] [output.json]
"""

import argparse
import csv
import json
import math
from pathlib import Path

import numpy as np
from scipy.optimize import linear_sum_assignment

root = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("--slack", type=float, default=3.0, help="grid cells per artwork")
ap.add_argument("--preview", action="store_true", help="print an ASCII occupancy map")
ap.add_argument("src", nargs="?", type=Path, default=root / "input" / "vectors_2d.tsv")
ap.add_argument("dst", nargs="?", type=Path, default=root / "public" / "layout.json")
args = ap.parse_args()
SLACK, src, dst = args.slack, args.src, args.dst

with src.open(newline="") as f:
    rows = [
        r
        for r in csv.DictReader(f, delimiter="\t")
        if r["image_mid_url"] and r["visual_x"] and r["visual_y"]
    ]

pts = np.array([[float(r["visual_x"]), float(r["visual_y"])] for r in rows])
# Screen y grows downward; flip so "up" in the embedding is up on screen.
pts[:, 1] *= -1

lo, hi = pts.min(axis=0), pts.max(axis=0)
span = hi - lo
n = len(pts)
aspect = span[0] / span[1]
cols = math.ceil(math.sqrt(n * SLACK * aspect))
rows_n = math.ceil(n * SLACK / cols)

# Map points into grid-cell units, so cell (c, r) has its centre at (c, r).
scaled = (pts - lo) / span * np.array([cols - 1, rows_n - 1])

cc, rr = np.meshgrid(np.arange(cols), np.arange(rows_n))
cells = np.stack([cc.ravel(), rr.ravel()], axis=1)

cost = ((scaled[:, None, :] - cells[None, :, :]) ** 2).sum(axis=2)
item_idx, cell_idx = linear_sum_assignment(cost)

displacement = np.sqrt(cost[item_idx, cell_idx])
print(
    f"{n} artworks -> {cols}x{rows_n} grid ({cols * rows_n} cells); "
    f"mean shift {displacement.mean():.2f} cells, max {displacement.max():.2f}"
)

tiles = [
    {
        "id": rows[i]["uid"],
        "acc": rows[i]["accession_number"],
        "title": rows[i]["title"],
        "url": rows[i]["image_mid_url"],
        "col": int(cells[c][0]),
        "row": int(cells[c][1]),
    }
    for i, c in zip(item_idx, cell_idx)
]

if args.preview:
    occ = np.zeros((rows_n, cols), dtype=bool)
    for c in cell_idx:
        occ[cells[c][1], cells[c][0]] = True
    print("\n".join("".join("#" if v else "." for v in line) for line in occ))

dst.parent.mkdir(parents=True, exist_ok=True)
dst.write_text(json.dumps({"cols": cols, "rows": rows_n, "tiles": tiles}))
print(f"wrote {dst}")
