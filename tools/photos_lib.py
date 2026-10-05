from __future__ import annotations

import json
import math
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
THUMB_QUALITY = 78
MEDIUM_MAX_EDGE = 1280
MEDIUM_QUALITY = 78
# AVIF 同主观质量体积约为 WebP 的 60-70%，质量参数独立调
AVIF_THUMB_QUALITY = 55
AVIF_MEDIUM_QUALITY = 55


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


# ── 墙色调色板（P1-6）────────────────────────────────────────────────────────
# 原先由 app.js 的 sampleRoomColor() 在浏览器里逐张 <img> 做
# canvas 28×28 取色 + 饱和度打分 + 对比度迭代。三个问题：
#   1. 每次 renderGallery 对全部卡片重跑一遍（筛选切换 = 全量重采样）；
#   2. 采样必须等图解码，落地前 --card-wall 是初始值 → 首屏可见色跳；
#   3. **结果不确定**：采的是 srcset 里浏览器实际选中的那一档（400/800/1200）
#      与格式（AVIF/WebP），随时随设备而变 —— 同一张画在不同宽度下墙色不同。
# 改为在 sync 阶段用 Pillow 一次性算好写进 manifest，客户端只做样式赋值。
# 算法与 sampleRoomColor 逐行对齐（含 Math.round 的半数进位方向）。
PALETTE_EDGE = 28
_PALETTE_HALL = (31, 42, 36)
_PALETTE_DIM = (12, 16, 14)
_PALETTE_IVORY = (240, 234, 216)


def _js_round(v: float) -> int:
    """JS 的 Math.round 对 .5 恒向 +∞ 进位；Python round() 是银行家舍入，必须区分。"""
    return math.floor(v + 0.5)


def _mix(c: tuple, t: tuple, k: float) -> tuple:
    return tuple(c[i] * (1 - k) + t[i] * k for i in range(3))


def _rel_lum(c: tuple) -> float:
    def f(v: float) -> float:
        s = max(0.0, min(255.0, v)) / 255
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4

    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])


def _contrast_with(c: tuple, fg: tuple) -> float:
    l1, l2 = _rel_lum(c), _rel_lum(fg)
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def _darken_for_ui(c: tuple, fg: tuple, min_ratio: float) -> tuple:
    col = tuple(float(v) for v in c)
    for _ in range(20):
        if _contrast_with(col, fg) >= min_ratio:
            return col
        col = tuple(v * 0.9 for v in col)
    return col


def _css_rgba(c: tuple, a: float = 1) -> str:
    return f"rgba({_js_round(c[0])}, {_js_round(c[1])}, {_js_round(c[2])}, {a})"


def photo_palette(path: Path) -> dict | None:
    """从原图算「展厅墙色」，输出与 sampleRoomColor 同形的四个 CSS 颜色。

    取自**原图**而非缩略图：一次算好即与展示档位解耦，同一张画在卡片／序厅／
    灯箱三处共用一套墙色（原先三处各采各的，同画三色）。
    EXIF 旋转不必处理——旋转是像素集合的双射，均值与最饱和像素都不变。
    无 Pillow 或解码失败返回 None，客户端会自动回落到采样路径。
    """
    try:
        from PIL import Image
    except ImportError:
        return None
    try:
        with Image.open(path) as im:
            # 采样源取**原图**：调色板是画作的属性，不该随我们 WebP/AVIF 编码档位漂移。
            # 滤波选 BILINEAR 是实测结果——与浏览器 drawImage 的缩放在同一张图上的
            # 输出最接近：最大通道差 18（BOX 36 / BICUBIC 49 / LANCZOS 50 / NEAREST 42），
            # 因为 accent 是「最饱和的单像素」argmax，滤波稍有不同就会翻转成另一个像素。
            small = im.convert("RGBA").resize(
                (PALETTE_EDGE, PALETTE_EDGE), Image.Resampling.BILINEAR
            )
            data = small.tobytes()
    except Exception:
        return None

    total_r = total_g = total_b = 0
    count = 0
    best_score = 0.0
    accent = (0, 0, 0)
    for i in range(0, len(data), 4):
        pr, pg, pb, pa = data[i], data[i + 1], data[i + 2], data[i + 3]
        if pa < 32:
            continue
        total_r += pr
        total_g += pg
        total_b += pb
        count += 1
        mx = max(pr, pg, pb)
        mn = min(pr, pg, pb)
        sat = 0.0 if mx == 0 else (mx - mn) / mx
        score = sat * (mx / 255)
        if score > best_score:
            best_score = score
            accent = (pr, pg, pb)
    if not count:
        return None

    avg = (total_r / count, total_g / count, total_b / count)
    accent_rgb = accent if best_score > 0.08 else avg

    # 画作色压进展厅深绿，保持油画馆气质。混合度取高（墙 0.72 / 光晕 0.45）：
    # 采样只贡献明暗与色相差，否则亮米色画作会把序厅/观画室的墙拉成发灰的棕墙。
    wall = _mix(_mix(avg, accent_rgb, 0.35), _PALETTE_HALL, 0.72)
    glow = _mix(_mix(avg, accent_rgb, 0.55), _PALETTE_HALL, 0.45)
    deep = _mix(wall, _PALETTE_DIM, 0.52)
    # 采样墙再亮也不牺牲 chrome 文字对比（对照象牙字）
    wall = _darken_for_ui(wall, _PALETTE_IVORY, 4.5)
    deep = _darken_for_ui(deep, _PALETTE_IVORY, 4.5)
    glow = _darken_for_ui(glow, _PALETTE_IVORY, 3)
    return {
        "wall": _css_rgba(wall),
        "deep": _css_rgba(deep),
        "glow": _css_rgba(glow, 0.55),
        "accent": _css_rgba(_mix(accent_rgb, _PALETTE_HALL, 0.4), 0.75),
    }


def _try_save_avif(im, out: Path, quality: int) -> bool:
    """尽力写 AVIF；无 AVIF 编解码的 Pillow 静默跳过，WebP 仍是权威回退。"""
    try:
        im.save(out, "AVIF", quality=quality)
        return True
    except Exception:
        return False


def _write_webp_variant(
    src: Path, out_dir: Path, max_edge: int, quality: int
) -> tuple[str, str | None] | None:
    """生成 out_dir/<stem>.webp + 同尺寸 .avif（尽力）；返回 (webp, avif|None)。"""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        return None

    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{src.stem}.webp"
    out_avif = out_dir / f"{src.stem}.avif"
    webp_rel = out.relative_to(ROOT).as_posix()
    avif_rel = out_avif.relative_to(ROOT).as_posix()
    try:
        fresh_webp = out.exists() and out.stat().st_mtime >= src.stat().st_mtime
        fresh_avif = out_avif.exists() and out_avif.stat().st_mtime >= src.stat().st_mtime
        if fresh_webp and fresh_avif:
            return webp_rel, avif_rel
        made_avif = fresh_avif
        with Image.open(src) as im:
            im = ImageOps.exif_transpose(im)
            if max(im.size) > max_edge:
                im.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
            if im.mode not in ("RGB", "RGBA"):
                im = im.convert("RGB")
            if not fresh_webp:
                im.save(out, "WEBP", quality=quality, method=6)
            if not fresh_avif:
                made_avif = _try_save_avif(im, out_avif, AVIF_MEDIUM_QUALITY)
        return webp_rel, (avif_rel if made_avif else None)
    except Exception:
        return None


def ensure_thumb_set(src: Path) -> dict[str, tuple[str, int, str | None]]:
    """生成 400/800/1200 档缩略图（WebP 必产 + AVIF 尽力）；返回 {档: (webp路径, 实际像素宽, avif路径|None)}。

    小图不放大，三档可能同尺寸——srcset 必须按实际宽度声明，
    虚报 400w/800w/1200w 会让浏览器选错档、把小图放大到模糊。
    """
    out: dict[str, tuple[str, int, str | None]] = {}
    try:
        from PIL import Image, ImageOps
    except ImportError:
        # 无 Pillow 时同样生成不了缩略图，等同无输出
        return out

    THUMBS.mkdir(parents=True, exist_ok=True)
    for edge in THUMB_STEPS:
        name = f"{src.stem}.webp" if edge == THUMB_MAX_EDGE else f"{src.stem}-{edge}.webp"
        out_path = THUMBS / name
        avif_path = out_path.with_suffix(".avif")
        webp_rel = out_path.relative_to(ROOT).as_posix()
        avif_rel = avif_path.relative_to(ROOT).as_posix()
        try:
            fresh_webp = out_path.exists() and out_path.stat().st_mtime >= src.stat().st_mtime
            fresh_avif = avif_path.exists() and avif_path.stat().st_mtime >= src.stat().st_mtime
            if fresh_webp and fresh_avif:
                size = image_size(out_path)
                if size:
                    out[str(edge)] = (webp_rel, int(size[0]), avif_rel)
                continue
            made_avif = fresh_avif
            width = 0
            with Image.open(src) as im:
                im = ImageOps.exif_transpose(im)
                if max(im.size) > edge:
                    im.thumbnail((edge, edge), Image.Resampling.LANCZOS)
                if im.mode not in ("RGB", "RGBA"):
                    im = im.convert("RGB")
                if not fresh_webp:
                    im.save(out_path, "WEBP", quality=THUMB_QUALITY, method=6)
                if not fresh_avif:
                    made_avif = _try_save_avif(im, avif_path, AVIF_THUMB_QUALITY)
                width = int(im.width)
            out[str(edge)] = (webp_rel, width, (avif_rel if made_avif else None))
        except Exception:
            continue
    return out


def ensure_medium(src: Path) -> tuple[str, str | None] | None:
    """生成 photos/medium/<stem>.webp + .avif（长边 ~1280px）；原图不大于上限时不另存。"""
    try:
        from PIL import Image
    except ImportError:
        return None

    try:
        # 只读 header 判尺寸，不解码像素（exif 转置只交换宽高，max(size) 不变）
        with Image.open(src) as im:
            if max(im.size) <= MEDIUM_MAX_EDGE:
                return None
    except Exception:
        return None
    return _write_webp_variant(src, MEDIUM, MEDIUM_MAX_EDGE, MEDIUM_QUALITY)


def medium_width(item: dict) -> int:
    """按长边上限反推中图的像素宽（中图尺寸本身不进 manifest）。

    与 ``src/util.js`` 的 ``mediumWidth()`` 是**同一条规则的两份实现**——前者给
    Python 侧用（下面组 heroSrcset），后者给无 manifest 条目的本机上传图兜底。
    两份漂移会让序厅预载选中与 ``<picture>`` 不同的候选（白下一次图），
    由 ``tests/unit/hero-srcset.test.mjs`` 拿提交的 manifest 逐条钉住。

    取整刻意用 floor(x + 0.5) 而不是内置 ``round()``：Python 的 round 是
    银行家舍入（round(0.5) == 0），JS 的 Math.round 是四舍五入（0.5 → 1）。
    """
    w, h = item.get("width"), item.get("height")
    if not isinstance(w, int) or not isinstance(h, int) or w <= 0 or h <= 0:
        return 0
    long_edge = max(w, h)
    if long_edge <= MEDIUM_MAX_EDGE:
        return w
    return int(math.floor(w * MEDIUM_MAX_EDGE / long_edge + 0.5))


def hero_srcsets(item: dict) -> dict:
    """序厅首图（= LCP 元素）的响应式候选，供 HTML 解析期直接预载。

    为什么预算在 sync 而不是留给前端算：``index.html`` 的内联脚本要在 app.js
    执行**之前**发出预载，而它没法 import ``src/util.js``。把规则留在前端就等于
    在 HTML 里抄一份 —— 这里预算好，内联脚本只搬运字符串，规则仍只有一份
    （本函数），前端只在「清单是旧/降级版」时用 ``heroSrcset()`` 兜底。

    与 ``src/util.js`` 的 ``heroSrcset`` / ``heroAvifSrcset`` 同构：
    缩略图各档 + 中图（大屏兜底）；动图没有中图，因此自然只剩缩略图。
    """
    out: dict[str, str] = {}
    width = medium_width(item)
    for key, width_key in (("heroSrcset", "thumbSrcset"), ("heroAvifSrcset", "thumbAvifSrcset")):
        parts = []
        if item.get(width_key):
            parts.append(item[width_key])
        medium_key = "medium" if key == "heroSrcset" else "mediumAvif"
        if item.get(medium_key) and width:
            parts.append(f"{item[medium_key]} {width}w")
        if parts:
            out[key] = ", ".join(parts)
    return out


def list_photo_files() -> list[Path]:
    """列出 photos/ 下的图片文件。

    ⚠️ 这里的排序**不是**展厅陈列顺序的来源（见 build_photos 的显式排序）。
    它只提供一个稳定的枚举起点；mtime 只是本机可见量，git 不保存它，
    因此绝不能拿它当顺序键。
    """
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
        # srcset 按每档实际像素宽声明并同宽去重（小图三档内容相同）；AVIF 与 WebP 同宽
        seen: dict[int, str] = {}
        seen_avif: dict[int, str] = {}
        for edge in sorted(thumbs, key=int):
            rel, width, avif_rel = thumbs[edge]
            if width > 0 and width not in seen:
                seen[width] = rel
            if width > 0 and avif_rel and width not in seen_avif:
                seen_avif[width] = avif_rel
        if seen:
            item["thumbSrcset"] = ", ".join(
                f"{rel} {width}w" for width, rel in sorted(seen.items())
            )
        if seen_avif:
            item["thumbAvifSrcset"] = ", ".join(
                f"{rel} {width}w" for width, rel in sorted(seen_avif.items())
            )
    if medium:
        item["medium"] = medium[0]
        if medium[1]:
            item["mediumAvif"] = medium[1]
    if size:
        item["width"], item["height"] = size
    # 序厅首图的预载候选：必须在 width/height 之后组（中图宽度由原图宽高反推）
    item.update(hero_srcsets(item))
    palette = photo_palette(path)
    if palette:
        # 客户端只做样式赋值；缺失（无 Pillow / 解码失败）时回落浏览器采样
        item["palette"] = palette
    return item


def manifest_order_key(item: dict) -> tuple[str, str]:
    """展厅陈列顺序键：date 倒序，同日按文件名倒序。

    为什么不能用 mtime：git 不保留文件 mtime。本机按「真实上传时间」排，
    CI checkout 后所有照片 mtime 相同、退化成「文件名倒序」——同一批图在两处
    排布完全不同，导致
      · 本地预览无法复现线上的策展观感；
      · 「每 7 张独占一面墙」的重点墙落在不同作品上；
      · index.html 的序厅首图 preload 会指向与线上不同的那张（白拉一次高优先级图）。
    date 的回退链（手写 meta > 已入馆日期 prev_dates > EXIF > mtime）里，
    prev_dates 直接来自已提交的 manifest，因此对「已入馆」的照片是完全环境无关的；
    新入馆照片在首次 CI 跑完后也会被 prev_dates 钉住。
    """
    return (item.get("date") or "", item.get("file") or "")


def build_photos() -> list[dict]:
    meta = load_meta()
    prev_dates = load_prev_dates()
    items = [photo_item(p, meta, prev_dates) for p in list_photo_files()]
    # 显式排序：顺序是策展结果，必须环境无关（见 manifest_order_key）
    items.sort(key=manifest_order_key, reverse=True)
    return items
