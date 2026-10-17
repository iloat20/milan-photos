"""生成站点图标与分享图：assets/icon-*.png、apple-touch-icon、favicon、og.jpg。

幂等：python tools/gen_assets.py 直接重新生成。

配色取当前视觉语言的 token（2026-10-17 重绘：画框去金化，品牌图随之一并去框）：
黑底是暗色主题的 --bg（styles.css 的 `--bg: light-dark(#fff, #000)`），
字色是暗色侧的 --text（IVORY），副题与分隔线走中性灰。
**不要**写回旧的墨绿（`#1f2a24` 系列）或 2026-10-16 的金框（`#d4af37`）——
两者都是已退役的时期配色（金框随 2026-10-17 的画框重设计一起退役）。
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets"

INK = (0, 0, 0)  # 底色：暗色主题的 --bg
IVORY = (245, 245, 247)  # 题名字色：暗色侧的 --text
GRAY = (161, 161, 166)  # 副题色：暗色侧的 --text-2
LINE = (110, 110, 115)  # 分隔线：中性灰（画框去金后不再有金色点缀）


def font(size: int) -> ImageFont.FreeTypeFont:
    # 宋体自带中英文形，统一用它避免豆腐块
    for name in ("simsun.ttc", "msyh.ttc"):
        p = Path(r"C:\Windows\Fonts") / name
        if p.exists():
            return ImageFont.truetype(str(p), size, index=0)
    return ImageFont.load_default()


def icon(size: int, *, glyph_ratio: float) -> Image.Image:
    """纯字形图标：黑底 + 米字。不再画框 —— 边框曾是金框时期的呼应，
    已随画框「去框化」退役（画框 = 圆角 + 投影，没有边框可呼应）。"""
    img = Image.new("RGB", (size, size), INK)
    d = ImageDraw.Draw(img)
    f = font(int(size * glyph_ratio))
    d.text((size / 2, size / 2), "米", font=f, fill=IVORY, anchor="mm")
    return img


def og() -> Image.Image:
    w, h = 1200, 630
    img = Image.new("RGB", (w, h), INK)
    d = ImageDraw.Draw(img)
    # 无框分享图（2026-10-17 去金化）：只有字与一条中性分隔线
    d.text((w / 2, 245), "米兰美术馆", font=font(96), fill=IVORY, anchor="mm")
    d.text(
        (w / 2, 340),
        "油画展厅 · MILAN GALLERY",
        font=font(30),
        fill=GRAY,
        anchor="mm",
    )
    d.line([(w / 2 - 170, 400), (w / 2 + 170, 400)], fill=LINE, width=1)
    d.text(
        (w / 2, 445),
        "iloat20.github.io/milan-photos",
        font=font(22),
        fill=GRAY,
        anchor="mm",
    )
    return img


def main() -> None:
    OUT.mkdir(exist_ok=True)
    icon(192, glyph_ratio=0.56).save(OUT / "icon-192.png")
    icon(512, glyph_ratio=0.56).save(OUT / "icon-512.png")
    # maskable：内容收进中央 80% 安全区
    icon(512, glyph_ratio=0.44).save(OUT / "icon-maskable-512.png")
    icon(180, glyph_ratio=0.56).save(OUT / "apple-touch-icon.png")
    icon(32, glyph_ratio=0.66).save(OUT / "favicon-32.png")
    og().save(OUT / "og.jpg", quality=88, optimize=True)
    for p in sorted(OUT.iterdir()):
        print(p.name, p.stat().st_size)


if __name__ == "__main__":
    main()
