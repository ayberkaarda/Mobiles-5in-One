"""Crop the status bar, resize to a fixed width and write small palette PNGs.

Usage: python postprocess.py <input-dir> <output-dir> <status-bar-px> [width] [suffix]
The suffix (for example `-dark`) is added to each file name before `.png`. Needs Pillow. Prints one line per file and the total size.
"""

import os
import sys

from PIL import Image


def main() -> None:
    src, dst, top = sys.argv[1], sys.argv[2], int(sys.argv[3])
    width = int(sys.argv[4]) if len(sys.argv) > 4 else 540
    suffix = sys.argv[5] if len(sys.argv) > 5 else ''
    os.makedirs(dst, exist_ok=True)
    total = 0
    for name in sorted(os.listdir(src)):
        if not name.endswith('.png'):
            continue
        image = Image.open(os.path.join(src, name)).convert('RGB')
        w, h = image.size
        image = image.crop((0, top, w, h))
        height = round(image.size[1] * width / w)
        image = image.resize((width, height), Image.LANCZOS)
        palette = image.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        out_name = f'{name[:-4]}{suffix}.png'
        out = os.path.join(dst, out_name)
        palette.save(out, optimize=True)
        size = os.path.getsize(out)
        total += size
        print(f'{out_name}\t{width}x{height}\t{size // 1024} KB')
    print(f'total {total // 1024} KB')


if __name__ == '__main__':
    main()
