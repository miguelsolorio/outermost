"""Tangent-space normal maps from global elevation models.

usage: relief.py <input> <format> <meters_per_unit> <radius_km> <lon_shift> <out.png> <out_width> [smooth_px]

  format      tif | png8 | msb16:<width>x<height>   (raw big-endian int16, PDS)
  lon_shift   0 if the map is centered on 0° longitude, 1 if it starts at 0°E
  smooth_px   Gaussian sigma applied before differencing (hides 8-bit terraces)

The output encodes the surface normal in the local (east, north, up) frame
as RGB = 0.5 + 0.5·n, rows from the north pole, longitude -180..180 east.
Slopes are true (no vertical exaggeration).
"""

import sys

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None


def load(path: str, fmt: str) -> np.ndarray:
    if fmt.startswith("msb16:"):
        w, h = (int(x) for x in fmt.split(":")[1].split("x"))
        return np.fromfile(path, dtype=">i2").reshape(h, w).astype(np.float32)
    im = Image.open(path)
    if fmt == "png8":
        im = im.convert("L")
    return np.asarray(im).astype(np.float32)


def blur(a: np.ndarray, sigma: float) -> np.ndarray:
    if sigma <= 0:
        return a
    r = int(3 * sigma + 0.5)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    # Separable: wrap in longitude, clamp in latitude.
    a = sum(np.roll(a, i, axis=1) * k[i + r] for i in range(-r, r + 1))
    padded = np.pad(a, ((r, r), (0, 0)), mode="edge")
    return sum(padded[r + i : r + i + a.shape[0]] * k[i + r] for i in range(-r, r + 1))


def main() -> None:
    src, fmt, scale, radius_km, lon_shift, out, out_w = sys.argv[1:8]
    smooth = float(sys.argv[8]) if len(sys.argv) > 8 else 0.0
    h = load(src, fmt) * float(scale)
    if lon_shift == "1":
        h = np.roll(h, h.shape[1] // 2, axis=1)
    h = blur(h, smooth)
    H, W = h.shape
    R = float(radius_km) * 1000.0
    lat = np.pi / 2 - (np.arange(H) + 0.5) * np.pi / H
    dx = (2 * np.pi * R * np.maximum(np.cos(lat), 1e-3) / W)[:, None]
    dy = np.pi * R / H
    gx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) / (2 * dx)
    north = np.vstack([h[:1], h[:-1]])
    south = np.vstack([h[1:], h[-1:]])
    gy = (north - south) / (2 * dy)
    n = np.stack([-gx, -gy, np.ones_like(h)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    rgb = np.clip((n * 0.5 + 0.5) * 255 + 0.5, 0, 255).astype(np.uint8)
    img = Image.fromarray(rgb, "RGB")
    w = int(out_w)
    if w != W:
        img = img.resize((w, w // 2), Image.Resampling.LANCZOS)
    img.save(out)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    print(f"{W}x{H} -> {w}x{w // 2}; slope p50 {np.percentile(slope, 50):.2f}°, p99 {np.percentile(slope, 99):.1f}°, max {slope.max():.1f}°")


if __name__ == "__main__":
    main()
