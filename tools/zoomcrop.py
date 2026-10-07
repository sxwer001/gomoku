"""把棋盘截图的指定区域放大保存，用于人眼判断网格线是否锐利。

用法: python tools/zoomcrop.py build/electron-crop.png 400 400 160 3
"""
import sys
from PIL import Image

src = sys.argv[1]
x, y, size, z = (int(v) for v in sys.argv[2:6])
im = Image.open(src).convert('RGB')
box = im.crop((x, y, x + size, y + size))
out = box.resize((size * z, size * z), Image.NEAREST)
dst = src.replace('.png', f'-zoom{x}-{y}.png')
out.save(dst)
print(f'{src} {im.size} -> crop({x},{y},{size}x{size}) x{z} -> {dst} {out.size}')
