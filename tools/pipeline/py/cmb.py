"""Reproject the Planck PR3 SMICA CMB temperature map (HEALPix, galactic
coordinates, K_CMB) to an equirectangular image in galactic coordinates.

Pixel column j covers galactic longitude l = (j + 0.5) * 360 / W (l increasing
to the right from l = 0 at the left edge); row i covers latitude
b = 90 - (i + 0.5) * 180 / H (north at the top).

The temperature fluctuations (about ±300 μK; the 2.7255 K mean and the
dipole are already removed in SMICA) are shown in false color. The Planck team's
inpainted field is used so the masked Galactic plane is filled, as in the
published images.

usage: uv run python cmb.py <map.fits> <out.png> <width>
"""

import sys

import healpy as hp
import numpy as np
from PIL import Image


def main() -> None:
    src, out, width = sys.argv[1], sys.argv[2], int(sys.argv[3])
    height = width // 2
    # Fields in the no-SZ file: 0 = I_STOKES, 1 = I_STOKES_INP (inpainted).
    try:
        m = hp.read_map(src, field=1)
        label = "I_STOKES_INP"
    except Exception:  # noqa: BLE001 - older files have only I_STOKES
        m = hp.read_map(src, field=0)
        label = "I_STOKES"
    nside = hp.get_nside(m)
    bad = ~np.isfinite(m) | (m < -1e20)
    m = np.where(bad, 0.0, m)
    # The PR3 no-SZ file's inpainted column is in μK although its header says
    # K_CMB (its rms is ~108, vs 1.09e-4 for I_STOKES): rescale to kelvin.
    if np.std(m) > 1.0:
        m = m * 1e-6
    print(f"read {label}, nside {nside}, rms {np.std(m[~bad]) * 1e6:.1f} uK")

    l = (np.arange(width) + 0.5) * 360.0 / width
    b = 90.0 - (np.arange(height) + 0.5) * 180.0 / height
    L, B = np.meshgrid(l, b)
    theta = np.radians(90.0 - B)
    phi = np.radians(L)
    t = hp.get_interp_val(m, theta, phi)  # K_CMB

    # False-color scale: ±300 μK, cold blue → cream → hot orange/red.
    x = np.clip(t / 300e-6, -1.0, 1.0)
    stops = np.array([-1.0, -0.5, 0.0, 0.5, 1.0])
    colors = np.array(
        [
            [0, 20, 110],
            [40, 120, 220],
            [240, 232, 214],
            [255, 150, 40],
            [150, 25, 5],
        ],
        dtype=np.float64,
    )
    rgb = np.stack([np.interp(x, stops, colors[:, k]) for k in range(3)], axis=-1)
    Image.fromarray(rgb.astype(np.uint8), "RGB").save(out)
    print(f"wrote {out} ({width}x{height})")


if __name__ == "__main__":
    main()
