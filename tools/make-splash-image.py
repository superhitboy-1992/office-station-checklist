"""从高清素材生成启动页竖版背景（WebP）。

源：素材图片/1.jpg（1900x3200 流萤微笑半身竖图）
输出：assets/splash-firefly.webp（1440x2560，9:16 中心裁切，目标 <=700KB）
"""

import os
from PIL import Image


SRC = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "素材图片", "1.jpg")
)
OUT = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "splash-firefly.webp")
)
TARGET_W, TARGET_H = 1440, 2560  # 9:16
MAX_BYTES = 700_000
QUALITY = 80


def main():
    im = Image.open(SRC).convert("RGB")
    w, h = im.size
    # 中心裁 9:16（优先占满高度，宽度居中）
    crop_h = h
    crop_w = round(crop_h * TARGET_W / TARGET_H)
    if crop_w > w:
        crop_w = w
        crop_h = round(crop_w * TARGET_H / TARGET_W)
    x0 = (w - crop_w) // 2
    y0 = (h - crop_h) // 2
    im = im.crop((x0, y0, x0 + crop_w, y0 + crop_h))
    im = im.resize((TARGET_W, TARGET_H), Image.LANCZOS)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    im.save(OUT, format="WEBP", quality=QUALITY, method=6)
    size = os.path.getsize(OUT)
    print(f"source {w}x{h} -> crop {crop_w}x{crop_h} -> {TARGET_W}x{TARGET_H}")
    print(f"output: {OUT} ({size} bytes, {size / 1024:.1f} KB)")
    if size > MAX_BYTES:
        raise SystemExit(f"output {size} bytes exceeds {MAX_BYTES}")
    print("OK")


if __name__ == "__main__":
    main()
