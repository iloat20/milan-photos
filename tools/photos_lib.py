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
# 列表用多档缩略图：小屏 400、常规 800、回退 1200
THUMB_STEPS = (400, 800, 1200)
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


def is_animated(path: Path) -> bool:
    """GIF / 动图 WebP / APNG 等多帧图。"""
    try:
        from PIL import Image
    except ImportError:
        return path.suffix.lower() == ".gif"
    try:
        with Image.open(path) as im:
            n = getattr(im, "n_frames", 1)
            return int(n) > 1
    except Exception:
        return path.suffix.lower() == ".gif"


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


def ensure_thumb_set(src: Path) -> dict[str, tuple[str, int]]:
    """生成 400/800/1200 档缩略图；返回 {档位: (相对路径, 实际像素宽)}。

    小图不放大，三档可能同尺寸——srcset 必须按实际宽度声明，
    虚报 400w/800w/1200w 会让浏览器选错档、把小图放大到模糊。
    """
    out: dict[str, tuple[str, int]] = {}
    try:
        from PIL import Image, ImageOps
    except ImportError:
        # 无 Pillow 时同样生成不了缩略图，等同无输出
        return out

    THUMBS.mkdir(parents=True, exist_ok=True)
    for edge in THUMB_STEPS:
        name = f"{src.stem}.webp" if edge == THUMB_MAX_EDGE else f"{src.stem}-{edge}.webp"
        out_path = THUMBS / name
        try:
            if not (out_path.exists() and out_path.stat().st_mtime >= src.stat().st_mtime):
                with Image.open(src) as im:
                    im = ImageOps.exif_transpose(im)
                    if max(im.size) > edge:
                        im.thumbnail((edge, edge), Image.Resampling.LANCZOS)
                    if im.mode not in ("RGB", "RGBA"):
                        im = im.convert("RGB")
                    im.save(out_path, "WEBP", quality=THUMB_QUALITY, method=6)
                    out[str(edge)] = (out_path.relative_to(ROOT).as_posix(), int(im.width))
            else:
                size = image_size(out_path)
                if size:
                    out[str(edge)] = (out_path.relative_to(ROOT).as_posix(), int(size[0]))
        except Exception:
            continue
    return out


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


def load_prev_dates() -> dict[str, str]:
    """读取已有 manifest 的 file→date，保证入馆照片日期不再漂移。

    git 不保存 mtime，CI 每次 checkout 都把文件 mtime 变成当天；
    无 EXIF 的图若每次都从 mtime 重新推导 date，就会被改成跑 CI 的日期。
    """
    if not MANIFEST.exists():
        return {}
    try:
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except Exception:
        return {}
    dates: dict[str, str] = {}
    for entry in data.get("photos", []):
        name, day = entry.get("file"), entry.get("date")
        if isinstance(name, str) and isinstance(day, str):
            dates[name] = day
    return dates


def photo_item(path: Path, meta: dict, prev_dates: dict[str, str] | None = None) -> dict:
    name = path.name
    info = meta.get(name) or {}
    size = image_size(path)
    animated = is_animated(path)
    thumbs = ensure_thumb_set(path)
    # 动图不生成 medium：灯箱直接用原文件，避免冻成静帧
    medium = None if animated else ensure_medium(path)
    item = {
        "src": f"photos/{name}",
        "file": name,
        "title": info.get("title") or title_from_name(name),
        "caption": info.get("caption") or "",
        # 回退链：手写 meta > 已入馆日期（防 CI/本机 mtime 漂移）> EXIF > mtime
        "date": info.get("date") or (prev_dates or {}).get(name) or photo_date(path),
    }
    if animated:
        item["animated"] = True
    if thumbs.get("1200"):
        item["thumb"] = thumbs["1200"][0]
        # srcset 按每档实际像素宽声明并同宽去重（小图三档内容相同）
        seen: dict[int, str] = {}
        for edge in sorted(thumbs, key=int):
            rel, width = thumbs[edge]
            if width > 0 and width not in seen:
                seen[width] = rel
        if seen:
            item["thumbSrcset"] = ", ".join(
                f"{rel} {width}w" for width, rel in sorted(seen.items())
            )
    if medium:
        item["medium"] = medium
    if size:
        item["width"], item["height"] = size
    return item


def build_photos() -> list[dict]:
    meta = load_meta()
    prev_dates = load_prev_dates()
    return [photo_item(p, meta, prev_dates) for p in list_photo_files()]
