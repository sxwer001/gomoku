#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
生成应用图标：
  · Android  mipmap-*/ic_launcher.png
  · Windows  desktop/build/icon.ico
思路：先在 1024×1024 上以 4 倍超采样绘制，再缩到目标尺寸，边缘更干净。
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANDROID_RES = os.path.join(ROOT, 'android', 'res')
DESKTOP_BUILD = os.path.join(ROOT, 'desktop', 'build')

SS = 4               # 超采样倍数
BASE = 256           # 逻辑尺寸
S = BASE * SS        # 实际绘制尺寸

# 配色（与界面同一套）
CREAM = (246, 244, 240, 255)
GRID = (185, 164, 128, 255)
GRID_STRONG = (156, 130, 89, 255)
BLACK_A, BLACK_B = (110, 110, 110, 255), (20, 20, 20, 255)
WHITE_A, WHITE_B = (255, 255, 255, 255), (205, 205, 205, 255)


def rounded_bg(size, radius_ratio=0.22):
    """圆角方形底：暖木色渐变"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    grad = Image.new('RGBA', (size, size))
    d = ImageDraw.Draw(grad)
    top, bottom = (233, 206, 166, 255), (203, 168, 118, 255)
    for y in range(size):
        t = y / max(1, size - 1)
        d.line([(0, y), (size, y)], fill=(
            int(top[0] + (bottom[0] - top[0]) * t),
            int(top[1] + (bottom[1] - top[1]) * t),
            int(top[2] + (bottom[2] - top[2]) * t),
            255))
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1],
                                           radius=int(size * radius_ratio), fill=255)
    img.paste(grad, (0, 0), mask)
    return img


def draw_grid(img, size):
    """九宫格线 + 星位"""
    d = ImageDraw.Draw(img)
    pad = size * 0.175
    step = (size - pad * 2) / 4.0
    lw = max(2, int(size * 0.019))
    for i in range(5):
        p = pad + step * i
        d.line([(pad, p), (size - pad, p)], fill=GRID, width=lw)
        d.line([(p, pad), (p, size - pad)], fill=GRID, width=lw)
    # 星位
    r = max(2, int(size * 0.022))
    cx, cy = pad + step * 2, pad + step * 2
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GRID_STRONG)


def draw_stone(img, size, gx, gy, color_a, color_b, outline=None):
    """在网格交点 (gx,gy) 上画一颗棋子"""
    pad = size * 0.175
    step = (size - pad * 2) / 4.0
    cx, cy = pad + step * gx, pad + step * gy
    r = step * 0.56
    # 阴影
    sh = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse(
        [cx - r * 0.98, cy - r * 0.82, cx + r * 1.02, cy + r * 1.18],
        fill=(0, 0, 0, 90))
    from PIL import ImageFilter
    sh = sh.filter(ImageFilter.GaussianBlur(radius=max(1, int(size * 0.012))))
    img.alpha_composite(sh)
    # 球体：多层同心圆模拟径向渐变
    layers = 48
    for i in range(layers, 0, -1):
        t = i / layers
        rr = r * t
        col = tuple(int(color_a[k] + (color_b[k] - color_a[k]) * (1 - t) ** 0.7) for k in range(3)) + (255,)
        ox = -r * 0.30 * (1 - t)
        oy = -r * 0.32 * (1 - t)
        ImageDraw.Draw(img).ellipse([cx + ox - rr, cy + oy - rr, cx + ox + rr, cy + oy + rr], fill=col)
    # 高光
    hl = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(hl).ellipse(
        [cx - r * 0.62, cy - r * 0.72, cx - r * 0.06, cy - r * 0.30],
        fill=(255, 255, 255, 110))
    from PIL import ImageFilter
    hl = hl.filter(ImageFilter.GaussianBlur(radius=max(1, int(size * 0.018))))
    img.alpha_composite(hl)
    # 描边：浅色棋子在浅底上需要一点轮廓
    if outline:
        ImageDraw.Draw(img).ellipse(
            [cx - r, cy - r, cx + r, cy + r],
            outline=outline, width=max(2, int(size * 0.012)))


def make_icon():
    img = rounded_bg(S)
    draw_grid(img, S)
    draw_stone(img, S, 1, 1, BLACK_A, BLACK_B)                        # 左上黑子
    draw_stone(img, S, 3, 3, WHITE_A, WHITE_B, outline=(150, 126, 88, 200))  # 右下白子
    return img.resize((BASE, BASE), Image.LANCZOS)


def main():
    icon = make_icon()

    # ---- Android mipmaps ----
    densities = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
    for name, px in densities.items():
        d = os.path.join(ANDROID_RES, 'mipmap-' + name)
        os.makedirs(d, exist_ok=True)
        icon.resize((px, px), Image.LANCZOS).save(os.path.join(d, 'ic_launcher.png'))
        print('android  mipmap-%-8s %3dpx  ic_launcher.png' % (name, px))

    # 圆形图标（部分启动器使用）
    circle = Image.new('RGBA', (BASE, BASE), (0, 0, 0, 0))
    circle.paste(icon, (0, 0), Image.new('L', (BASE, BASE), 0).point(lambda _: 0))
    mask = Image.new('L', (BASE, BASE), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, BASE - 1, BASE - 1], fill=255)
    circle.paste(icon, (0, 0), mask)
    for name, px in densities.items():
        d = os.path.join(ANDROID_RES, 'mipmap-' + name)
        circle.resize((px, px), Image.LANCZOS).save(os.path.join(d, 'ic_launcher_round.png'))

    # ---- Windows .ico ----
    os.makedirs(DESKTOP_BUILD, exist_ok=True)
    ico = os.path.join(DESKTOP_BUILD, 'icon.ico')
    icon.save(ico, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print('windows  %s  (256/128/64/48/32/24/16)' % ico)

    # 顺便留一张预览图
    icon.resize((256, 256), Image.LANCZOS).save(os.path.join(ROOT, 'shots', 'icon-preview.png'))
    print('preview  shots/icon-preview.png')


if __name__ == '__main__':
    main()
