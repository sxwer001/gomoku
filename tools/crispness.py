"""量化棋盘画布的清晰度：检查网格线是否落在整设备像素上、是否被重采样。

用法: python tools/crispness.py build/electron-crop.png
"""
import sys
from PIL import Image

path = sys.argv[1] if len(sys.argv) > 1 else 'build/electron-crop.png'
im = Image.open(path).convert('L')
w, h = im.size
px = im.load()
print(f'image: {path}  {w}x{h}')

# 1) 找横向亮/暗结构：统计每一行的平均亮度，找网格线所在行
rowavg = [sum(px[x, y] for x in range(w)) / w for y in range(h)]
colavg = [sum(px[x, y] for y in range(h)) / h for x in range(w)]

def find_lines(avg, thresh_delta=6):
    m = sum(avg) / len(avg)
    out = []
    for i, v in enumerate(avg):
        if m - v > thresh_delta:
            out.append(i)
    # 合并相邻
    groups = []
    for i in out:
        if groups and i - groups[-1][-1] <= 1:
            groups[-1].append(i)
        else:
            groups.append([i])
    return m, groups

mbg, rows = find_lines(rowavg)
mbg2, cols = find_lines(colavg)
print(f'mean row lum {mbg:.1f} / col lum {mbg2:.1f}')
print(f'horizontal lines found: {len(rows)}  vertical lines found: {len(cols)}')
print('first 6 col groups (start,end,width,minval):')
for g in cols[:6]:
    vals = [min(px[x, h // 2] for x in g)]
    print('   ', g[0], g[-1], len(g), vals)
print('first 6 row groups:')
for g in rows[:6]:
    vals = [min(px[w // 2, y] for y in g)]
    print('   ', g[0], g[-1], len(g), vals)

# 2) 打印一条水平扫描线上、第一条竖线附近的原始像素，看是否为"硬边"
if cols:
    x0 = max(0, cols[0][0] - 4)
    seq = [px[x, h // 2] for x in range(x0, x0 + 12)]
    print(f'pixel profile around first vertical line (x={x0}..{x0+11}) at y={h//2}: {seq}')

# 3) 相邻网格线间距（设备像素）是否一致
if len(cols) > 3:
    centers = [sum(g) / len(g) for g in cols]
    diffs = [round(centers[i + 1] - centers[i], 2) for i in range(len(centers) - 1)]
    print('vertical line spacing:', diffs[:16])

# 4) 拉普拉斯方差的粗代理：相邻像素差均值（越大越锐）
import statistics
diffs = []
for y in range(0, h, 7):
    for x in range(1, w, 3):
        diffs.append(abs(px[x, y] - px[x - 1, y]))
print(f'adjacent-pixel |delta| mean={statistics.mean(diffs):.3f} max={max(diffs)}')
