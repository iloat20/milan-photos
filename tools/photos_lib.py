from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PHOTOS = ROOT / "photos"
THUMBS = PHOTOS / "thumbs"
META = PHOTOS / "meta.json"
MANIFEST = PHOTOS / "manifest.json"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}
THUMB_MAX_EDGE = 1200
THUMB_QUALITY = 82


def title_from_name(name: str) -> str:
    stem = Path(name).stem
    stem = re.sub(r"^\d+[-_\s]*", "", stem)
    stem = stem.replace("-", " ").replace("_", " ").strip()
    return stem or Path(name).stem


def file_date(path: Path) -> str:
    ts = path.stat().st_mtime
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d")


def image_size(path: Path) -> tuple[int, int] | None:
    try:
        from PIL import Image
    except ImportError:
        return None
    try:
        with Image.open(path) as im:
            return int(im.width), int(im.height)
    except Exception:
        return None


def ensure_thumb(src: Path) -> str | None:
    """Generate photos/thumbs/<stem>.webp if missing; return web path or None."""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        return None

    THUMBS.mkdir(parents=True, exist_ok=True)
    out = THUMBS / f"{src.stem}.webp"
    try:
        if out.exists() and out.stat().st_mtime >= src.stat().st_mtime:
            return f"photos/thumbs/{out.name}"
        with Image.open(src) as im:
            im = ImageOps.exif_transpose(im)
            im.thumbnail((THUMB_MAX_EDGE, THUMB_MAX_EDGE), Image.Resampling.LANCZOS)
            if im.mode not in ("RGB", "RGBA"):
                im = im.convert("RGB")
            im.save(out, "WEBP", quality=THUMB_QUALITY, method=6)
        return f"photos/thumbs/{out.name}"
    except Exception:
        return None


def list_photo_files() -> list[Path]:
    files = [
        p
        for p in PHOTOS.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS
    ]
    files.sort(key=lambda p: (p.stat().st_mtime, p.name), reverse=True)
    return files


def load_meta() -> dict:
    if not META.exists():
        return {}
    try:
        return json.loads(META.read_text(encoding="utf-8"))
    except Exception:
        return {}


def photo_item(path: Path, meta: dict) -> dict:
    name = path.name
    info = meta.get(name) or {}
    size = image_size(path)
    thumb = ensure_thumb(path)
    item = {
        "src": f"photos/{name}",
        "file": name,
        "title": info.get("title") or title_from_name(name),
        "caption": info.get("caption") or "",
        "date": info.get("date") or file_date(path),
    }
    if thumb:
        item["thumb"] = thumb
    if size:
        item["width"], item["height"] = size
    return item


def build_photos() -> list[dict]:
    meta = load_meta()
    return [photo_item(p, meta) for p in list_photo_files()]
