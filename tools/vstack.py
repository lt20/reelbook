#!/usr/bin/env python3
"""Stack images vertically into one JPEG.

    vstack.py <dst> <maxW> <img1> <img2> [...]

Each image is scaled to the same width (the smallest width, capped at maxW),
then they are stacked top to bottom. Used to rebuild a full 9:16 frame from
two half captures. Needs Pillow.
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
    if len(a) < 3:
        sys.exit(__doc__)
    dst, max_w, srcs = a[0], int(a[1]), a[2:]
    ims = [Image.open(s).convert("RGB") for s in srcs]
    w = min(min(i.width for i in ims), max_w)
    ims = [i if i.width == w else i.resize((w, round(i.height * w / i.width)), Image.LANCZOS) for i in ims]
    out = Image.new("RGB", (w, sum(i.height for i in ims)))
    y = 0
    for i in ims:
        out.paste(i, (0, y)); y += i.height
    out.save(dst, "JPEG", quality=88, optimize=True)
    print(f"{dst}: {out.width}x{out.height}")

if __name__ == "__main__":
    main(sys.argv[1:])
