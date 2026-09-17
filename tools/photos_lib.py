from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PHOTOS = ROOT / "photos"
THUMBS = PHOTOS / "thumbs"
MEDIUM = PHOTOS / "medium"
META = PHOTOS / "meta.json"
MANIFEST = PHOTOS / "manifest.json"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}
THUMB_MAX_EDGE = 1200
THUMB_QUALITY = 82
MEDIUM_MAX_EDGE = 1600
MEDIUM_QUALITY = 85


def title_from_name(name: str) -> str:
    stem = Path(name).stem
    stem = re.sub(r"^\d+[-_\s]*", "", stem)
    stem = stem.replace("-", " ").replace("_", " ").strip()
    return stem or Path(name).stem


def file_date(path: Path) -> str:
    ts = path.stat().st_mtime
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d")


def photo_date(path: Path) -> str:
    """优先 EXIF DateTimeOriginal / DateTime，否则文件 mtime。"""
    try:
        from PIL import Image
    except ImportError:
        return file_date(path)
    try:
        with Image.open(path) as im:
            exif = im.getexif()
            if not exif:
                return file_date(path)
            # 36867 DateTimeOriginal, 306 DateTime
            raw = exif.get(36867) or exif.get(306)
            if not raw:
                return file_date(path)
            day = str(raw).strip().split(" ")[0].replace(":", "-")
            datetime.strptime(day, "%Y-%m-%d")
            return day
    except Exception:
        return file_date(path)


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


def _write_webp_variant(src: Path, out_dir: Path, max_edge: int, quality: int) -> str | None:
    """Generate out_dir/<stem>.webp capped at max_edge; return web path or None."""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        return None

    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{src.stem}.webp"
    try:
        if out.exists() and out.stat().st_mtime >= src.stat().st_mtime:
            rel = out.relative_to(ROOT).as_posix()
            return rel
        with Image.open(src) as im:
            im = ImageOps.exif_transpose(im)
            if max(im.size) > max_edge:
                im.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
            if im.mode not in ("RGB", "RGBA"):
                im = im.convert("RGB")
            im.save(out, "WEBP", quality=quality, method=6)
        return out.relative_to(ROOT).as_posix()
    except Exception:
        return None


def ensure_thumb(src: Path) -> str | None:
    """Generate photos/thumbs/<stem>.webp if missing; return web path or None."""
    return _write_webp_variant(src, THUMBS, THUMB_MAX_EDGE, THUMB_QUALITY)


def ensure_medium(src: Path) -> str | None:
    """Generate photos/medium/<stem>.webp (~1600px) for lightbox; skip upscale."""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        return None

    try:
        with Image.open(src) as im:
            im = ImageOps.exif_transpose(im)
            # 原图已不大于 medium 上限时不必另存
            if max(im.size) <= MEDIUM_MAX_EDGE:
                return None
    except Exception:
        return None
    return _write_webp_variant(src, MEDIUM, MEDIUM_MAX_EDGE, MEDIUM_QUALITY)


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
    medium = ensure_medium(path)
    item = {
        "src": f"photos/{name}",
        "file": name,
        "title": info.get("title") or title_from_name(name),
        "caption": info.get("caption") or "",
        "date": info.get("date") or photo_date(path),
    }
    if thumb:
        item["thumb"] = thumb
    if medium:
        item["medium"] = medium
    if size:
        item["width"], item["height"] = size
    return item


def build_photos() -> list[dict]:
    meta = load_meta()
    return [photo_item(p, meta) for p in list_photo_files()]
