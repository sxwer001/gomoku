#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
组装 APK —— 把 classes.dex 合进 aapt2 产出的基础包。

为什么不用 .NET ZipArchive：
  1) ZipFile(Update) 会整体重写压缩包，可能改变已有条目的压缩方式，
     而 Android 11+ 要求 resources.arsc 必须 STORED（不压缩）且 4 字节对齐；
  2) 在 Windows PowerShell 5.1 下它可能静默失败（非终止错误），
     结果产出一个「没有 classes.dex 的 APK」——真机安装必报「安装包异常」。

本脚本用 Python zipfile 从头写出干净的 APK：
    resources.arsc            → 强制 ZIP_STORED
    其余已有条目              → 沿用 aapt2 原本的压缩方式
    classes.dex               → ZIP_DEFLATED
写完立刻重新打开自检：CRC、条目齐全（尤其 classes.dex）、resources.arsc 不压缩。

用法：
    python tools/build-apk.py <base.apk> <classes.dex> <输出.apk>
"""
import io
import os
import sys
import zipfile

REQUIRED = ('AndroidManifest.xml', 'resources.arsc', 'classes.dex')

# 控制台可能是 GBK，统一改成 UTF-8，避免中文/符号导致 UnicodeEncodeError
try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
except Exception:
    pass


def build(base_apk, dex_file, out_apk):
    for p in (base_apk, dex_file):
        if not os.path.exists(p):
            sys.exit('找不到文件: %s' % p)

    with zipfile.ZipFile(base_apk, 'r') as zin:
        infos = zin.infolist()
        payload = {i.filename: zin.read(i.filename) for i in infos}
        methods = {i.filename: i.compress_type for i in infos}

    if not payload:
        sys.exit('base.apk 是空的，aapt2 link 可能失败了')

    with open(dex_file, 'rb') as f:
        payload['classes.dex'] = f.read()
    methods['classes.dex'] = zipfile.ZIP_DEFLATED

    names = [i.filename for i in infos]
    if 'classes.dex' not in names:
        names.append('classes.dex')

    # resources.arsc 必须不压缩（Android 11+ 硬性要求）
    methods['resources.arsc'] = zipfile.ZIP_STORED

    if os.path.exists(out_apk):
        os.remove(out_apk)

    with zipfile.ZipFile(out_apk, 'w') as zout:
        for name in names:
            info = zipfile.ZipInfo(name, date_time=(2024, 1, 1, 0, 0, 0))
            info.external_attr = 0o100644 << 16
            info.compress_type = methods[name]
            if info.compress_type == zipfile.ZIP_STORED:
                zout.writestr(info, payload[name])
            else:
                zout.writestr(info, payload[name], compresslevel=9)

    # ---------- 自检 ----------
    problems = []
    print('%-44s %-9s %10s %10s' % ('entry', 'method', 'packed', 'raw'))
    with zipfile.ZipFile(out_apk, 'r') as z:
        got = {}
        for info in z.infolist():
            method = 'STORED' if info.compress_type == zipfile.ZIP_STORED else 'DEFLATE'
            print('%-44s %-9s %10d %10d' % (info.filename, method, info.compress_size, info.file_size))
            got[info.filename] = info
        if z.testzip() is not None:
            problems.append('CRC check failed')
        for name in REQUIRED:
            if name not in got:
                problems.append('missing %s' % name)
        arsc = got.get('resources.arsc')
        if arsc is not None and arsc.compress_type != zipfile.ZIP_STORED:
            problems.append('resources.arsc is compressed (must be STORED)')
        dex = got.get('classes.dex')
        if dex is not None and dex.file_size < 100:
            problems.append('classes.dex size looks wrong: %d' % dex.file_size)

    if problems:
        sys.exit('\nAPK self-check FAILED: ' + '; '.join(problems))

    print('\n[OK] APK assembled, classes.dex=%d bytes, output=%s (%d bytes)'
          % (got['classes.dex'].file_size, out_apk, os.path.getsize(out_apk)))


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    build(sys.argv[1], sys.argv[2], sys.argv[3])
