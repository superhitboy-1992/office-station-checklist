"""从素材生成全站毛玻璃背景（WebP）。

源：素材图片/2.jpg（1111x1500 竖版插画）
输出：
  assets/bg-desktop.webp  1600x900  桌面/平板（面部与花环构图）
  assets/bg-mobile.webp   1080x1920 手机（上半身构图）
两张图先填白左下角作者社交账号水印区，再裁切避开水印与签名，目标 <=350KB。
"""

import os

from PIL import Image, ImageDraw


SRC = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "素材图片", "2.jpg")
)
OUT_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
)
MAX_BYTES = 350_000
QUALITY = 80

# 左下角水印区域（源图比例坐标：x 0–50%，y 84%–98.5%），先填白再裁切
WATERMARK = (0.0, 0.84, 0.50, 0.985)

# (文件名, 源图裁切框, 目标尺寸)
TARGETS = [
    ("bg-desktop.webp", (0, 300, 1111, 925), (1600, 900)),
    ("bg-mobile.webp", (170, 0, 817, 1150), (1080, 1920)),
]


def main():
    im = Image.open(SRC).convert("RGB")
    w, h = im.size
    wx0 = round(w * WATERMARK[0])
    wy0 = round(h * WATERMARK[1])
    wx1 = round(w * WATERMARK[2])
    wy1 = round(h * WATERMARK[3])
    ImageDraw.Draw(im).rectangle([wx0, wy0, wx1, wy1], fill=(255, 255, 255))

    os.makedirs(OUT_DIR, exist_ok=True)
    for name, box, size in TARGETS:
        crop_w = box[2] - box[0]
        crop_h = box[3] - box[1]
        out = im.crop(box).resize(size, Image.LANCZOS)
        path = os.path.join(OUT_DIR, name)
        out.save(path, format="WEBP", quality=QUALITY, method=6)
        bytes_size = os.path.getsize(path)
        print(f"source {w}x{h} -> crop {crop_w}x{crop_h} -> {size[0]}x{size[1]}")
        print(f"output: {path} ({bytes_size} bytes, {bytes_size / 1024:.1f} KB)")
        if bytes_size > MAX_BYTES:
            raise SystemExit(f"output {bytes_size} bytes exceeds {MAX_BYTES}")
    print("OK")


if __name__ == "__main__":
    main()
