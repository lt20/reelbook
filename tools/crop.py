#!/usr/bin/env python3
"""Crop an image and optionally scale it down.

    crop.py <src> <dst> <x> <y> <w> <h> [maxW]

Pixels are taken from the source at (x, y) with the given size; the result is
resized so its width is at most maxW (default 960), keeping the aspect ratio.
JPEG output at quality 88. Needs Pillow (pip install pillow).
"""
import os, sys
try:
    from PIL import Image
except ImportError:
    _root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for _py in (os.path.join(_root, ".venv", "bin", "python"), os.path.join(_root, ".venv", "Scripts", "python.exe")):
        if os.path.exists(_py) and os.path.abspath(sys.executable) != os.path.abspath(_py):
            os.execv(_py, [_py] + sys.argv)
    sys.exit("Pillow is missing: run the installer (install.sh / install.ps1) or `python3 -m pip install pillow`")

def main(a):
    if len(a) < 6:
        sys.exit(__doc__)
    src, dst = a[0], a[1]
    x, y, w, h = (int(v) for v in a[2:6])
    max_w = int(a[6]) if len(a) > 6 else 960
    im = Image.open(src).convert("RGB")
    box = (max(0, x), max(0, y), min(im.width, x + w), min(im.height, y + h))
    out = im.crop(box)
    if out.width > max_w:
        out = out.resize((max_w, round(out.height * max_w / out.width)), Image.LANCZOS)
    out.save(dst, "JPEG", quality=88, optimize=True)
    print(f"{dst}: {out.width}x{out.height}")

if __name__ == "__main__":
    main(sys.argv[1:])
