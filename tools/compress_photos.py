from pathlib import Path

from PIL import Image

MAX_EDGE = 2048
QUALITY = 85
photos = Path("photos")
targets = [
    "IMG20260817155446.jpg",
    "IMG20260817164045.jpg",
    "IMG20260817164949_01.jpg",
    "mmexport1788447848472.jpg",
    "IMG20260916193647.jpg",
]
for name in targets:
    p = photos / name
    if not p.exists():
        print("skip missing", name)
        continue
    before = p.stat().st_size
    im = Image.open(p)
    im = im.convert("RGB")
    w, h = im.size
    scale = min(1.0, MAX_EDGE / max(w, h))
    if scale < 1.0:
        im = im.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
    im.save(p, "JPEG", quality=QUALITY, optimize=True, progressive=True)
    after = p.stat().st_size
    print(f"{name}: {before // 1024}KB -> {after // 1024}KB {im.size}")
