"""生成站点图标与分享图：assets/icon-*.png、apple-touch-icon、favicon、og.jpg。

幂等：python tools/gen_assets.py 直接重新生成。

配色取当前视觉语言的 token（2026-10-16 重绘：Apple 式中性表面 + 金色实体画框）：
黑底是暗色主题的 --bg（styles.css 的 `--bg: light-dark(#fff, #000)`），
金框取画框色（.card-media / .lightbox-frame 的 `#d4af37`），字色是暗色侧的
--text。**不要**写回旧的墨绿（`#1f2a24` 系列）——那是已退役的「油画馆」时期的配色。
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets"

INK = (0, 0, 0)  # 底色：暗色主题的 --bg
GOLD = (212, 175, 55)  # 金框 #d4af37（画框的实体金边）
GOLD_DARK = (138, 111, 42)  # 双线内框（og 分享图用）
IVORY = (245, 245, 247)  # 题名字色：暗色侧的 --text
GRAY = (161, 161, 166)  # 副题色：暗色侧的 --text-2


def font(size: int) -> ImageFont.FreeTypeFont:
    # 宋体自带中英文形，统一用它避免豆腐块
    for name in ("simsun.ttc", "msyh.ttc"):
        p = Path(r"C:\Windows\Fonts") / name
        if p.exists():
            return ImageFont.truetype(str(p), size, index=0)
    return ImageFont.load_default()


def icon(size: int, *, border_ratio: float, glyph_ratio: float) -> Image.Image:
    img = Image.new("RGB", (size, size), INK)
    d = ImageDraw.Draw(img)
    if border_ratio > 0:
        inset = int(size * border_ratio)
        width = max(2, int(size * 0.03))
        d.rectangle(
            [inset, inset, size - inset - 1, size - inset - 1],
            outline=GOLD,
            width=width,
        )
    f = font(int(size * glyph_ratio))
    d.text((size / 2, size / 2), "米", font=f, fill=IVORY, anchor="mm")
    return img


def og() -> Image.Image:
    w, h = 1200, 630
    img = Image.new("RGB", (w, h), INK)
    d = ImageDraw.Draw(img)
    # 双线画框（外金内暗金，与灯箱的半透明金底同构）
    d.rectangle([28, 28, w - 29, h - 29], outline=GOLD, width=3)
    d.rectangle([40, 40, w - 41, h - 41], outline=GOLD_DARK, width=1)
    d.text((w / 2, 245), "米兰美术馆", font=font(96), fill=IVORY, anchor="mm")
    d.text(
        (w / 2, 340),
        "油画展厅 · MILAN GALLERY",
        font=font(30),
        fill=GRAY,
        anchor="mm",
    )
    d.line([(w / 2 - 170, 400), (w / 2 + 170, 400)], fill=GOLD_DARK, width=1)
    d.text(
        (w / 2, 445),
        "iloat20.github.io/milan-photos",
        font=font(22),
        fill=GOLD,
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
