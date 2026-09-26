"""Where a global mosaic has real fine detail, and where it was stretched up
from distant, low-resolution frames (e.g. Pluto's far side).

usage: sharpness.py <input.png> <out.png> <out_width>

The input is the albedo map at 4096 × 2048. The output is a greyscale mask,
255 = sharp source imagery, 0 = blurry or no data. The renderer adds
synthetic small-scale relief where the mask is low.
"""

import sys

import numpy as np
from PIL import Image

from relief import blur

Image.MAX_IMAGE_PIXELS = None


def rank(a: np.ndarray, r: int, fn) -> np.ndarray:
    """Separable square max/min filter: wrap in longitude, clamp in latitude."""
    out = a.copy()
    for i in range(-r, r + 1):
        out = fn(out, np.roll(a, i, axis=1))
    padded = np.pad(out, ((r, r), (0, 0)), mode="edge")
    res = out.copy()
    for i in range(-r, r + 1):
        res = fn(res, padded[r + i : r + i + out.shape[0]])
    return res


def main() -> None:
    src, out, out_w = sys.argv[1:4]
    a = np.asarray(Image.open(src).convert("L")).astype(np.float32)
    # No-data fill is black; ignore a margin around it so its edge is not "detail".
    valid = rank((a > 3).astype(np.float32), 6, np.minimum)
    # Fine-scale contrast relative to local brightness.
    hp = (a - blur(a, 1.0)) * valid
    e = np.sqrt(blur(hp * hp, 8)) / np.maximum(blur(a, 8), 8)
    w = int(out_w)
    e = np.asarray(Image.fromarray(e).resize((w, w // 2), Image.Resampling.BOX))
    # Relative contrast 0.008 (smeared) -> 0, 0.08 (resolved terrain) -> 1.
    s = np.clip((np.log10(np.maximum(e, 1e-4)) + 2.1) / 1.0, 0, 1)
    # Closing: genuinely smooth plains inside sharp coverage (Sputnik Planitia) stay sharp.
    k = w / 1024
    s = rank(s, int(40 * k), np.maximum)
    s = rank(s, int(34 * k), np.minimum)
    s = np.clip(blur(s, 6 * k), 0, 1)
    Image.fromarray((s * 255 + 0.5).astype(np.uint8), "L").save(out)
    print(f"sharp coverage {100 * (s > 0.5).mean():.0f}% of map area")


if __name__ == "__main__":
    main()
