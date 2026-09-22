"""生成站点图标与分享图：assets/icon-*.png、apple-touch-icon、favicon、og.jpg。

幂等：python tools/gen_assets.py 直接重新生成。
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets"

ROOM = (31, 42, 36)  # --room
GILT = (201, 169, 106)  # --gilt
GILT_BRIGHT = (226, 201, 138)  # --gilt-bright
GILT_DARK = (138, 115, 72)  # --gilt-dark
IVORY_DIM = (207, 198, 176)  # --ivory-dim


def font(size: int) -> ImageFont.FreeTypeFont:
    # 宋体自带中英文形，统一用它避免豆腐块
    for name in ("simsun.ttc", "msyh.ttc"):
        p = Path(r"C:\Windows\Fonts") / name
        if p.exists():
            return ImageFont.truetype(str(p), size, index=0)
    return ImageFont.load_default()


def icon(size: int, *, border_ratio: float, glyph_ratio: float) -> Image.Image:
    img = Image.new("RGB", (size, size), ROOM)
    d = ImageDraw.Draw(img)
    if border_ratio > 0:
        inset = int(size * border_ratio)
        width = max(2, int(size * 0.03))
        d.rectangle(
            [inset, inset, size - inset - 1, size - inset - 1],
            outline=GILT,
            width=width,
        )
    f = font(int(size * glyph_ratio))
    d.text((size / 2, size / 2), "米", font=f, fill=GILT_BRIGHT, anchor="mm")
    return img


def og() -> Image.Image:
    w, h = 1200, 630
    img = Image.new("RGB", (w, h), ROOM)
    d = ImageDraw.Draw(img)
    # 双线画框
    d.rectangle([28, 28, w - 29, h - 29], outline=GILT, width=3)
    d.rectangle([40, 40, w - 41, h - 41], outline=GILT_DARK, width=1)
    d.text((w / 2, 245), "米兰美术馆", font=font(96), fill=GILT_BRIGHT, anchor="mm")
    d.text(
        (w / 2, 340),
        "油画展厅 · MILAN GALLERY",
        font=font(30),
        fill=IVORY_DIM,
        anchor="mm",
    )
    d.line([(w / 2 - 170, 400), (w / 2 + 170, 400)], fill=GILT_DARK, width=1)
    d.text(
        (w / 2, 445),
        "iloat20.github.io/milan-photos",
        font=font(22),
        fill=GILT,
        anchor="mm",
    )
    return img


def main() -> None:
    OUT.mkdir(exist_ok=True)
    icon(192, border_ratio=0.10, glyph_ratio=0.52).save(OUT / "icon-192.png")
    icon(512, border_ratio=0.10, glyph_ratio=0.52).save(OUT / "icon-512.png")
    # maskable：内容收进中央 80% 安全区，不画边框（边框会被系统裁切）
    icon(512, border_ratio=0, glyph_ratio=0.44).save(OUT / "icon-maskable-512.png")
    icon(180, border_ratio=0.11, glyph_ratio=0.52).save(OUT / "apple-touch-icon.png")
    icon(32, border_ratio=0, glyph_ratio=0.66).save(OUT / "favicon-32.png")
    og().save(OUT / "og.jpg", quality=88, optimize=True)
    for p in sorted(OUT.iterdir()):
        print(p.name, p.stat().st_size)


if __name__ == "__main__":
    main()
