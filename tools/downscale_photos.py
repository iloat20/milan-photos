"""把 photos/ 下的母版限制在长边上限内（默认 2560），避免手机原图（6000–8000px）
以数十 MB 的体积进入公开仓库与 Pages 产物——而站内展示用的 medium 只有 1280px，
原图从不被访客请求（见 src/util.js 的 heroSrc / lightboxSrc）。

用法：
  python tools/downscale_photos.py            # 就地降采样超限的母版
  python tools/downscale_photos.py --check    # 只检查，存在超限文件时返回非零
  python tools/downscale_photos.py --max 3200 # 覆盖上限

⚠️ 上限必须 > photos_lib.MEDIUM_MAX_EDGE(=1280)。低于或等于该值时
   ensure_medium() 会直接不生成 medium，灯箱将回落原文件、反而更糊。

副作用（有意为之）：JPEG 重新编码会丢弃全部 EXIF，包括 GPS。
因此本脚本同时承担「去定位」职责；对不超限的文件请改用
tools/sanitize_photos.py（字节级剥离 GPS、零像素改动、保留方向）。
"""
from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
PHOTOS = ROOT / "photos"
JPEG_SUFFIXES = {".jpg", ".jpeg"}
DEFAULT_MAX = 2560
QUALITY = 85

# medium 的生成阈值只有**一处**：photos_lib.MEDIUM_MAX_EDGE。
# 本文件曾自带第三份拷贝 `MEDIUM_MAX_EDGE = 1600`，在 8f0117e 把 medium 降到 1280
# 之后它没跟着改 —— 后果是 `--max 1400`（合法上限）被拒，且报错信息里印着错阈值。
# 就地 import（同 sync_photos.py 的写法）让两边不可能再漂。
sys.path.insert(0, str(Path(__file__).resolve().parent))
from photos_lib import MEDIUM_MAX_EDGE  # noqa: E402


def jpeg_masters() -> list[Path]:
    return sorted(p for p in PHOTOS.iterdir() if p.suffix.lower() in JPEG_SUFFIXES)


def load_transposed(path: Path) -> Image.Image:
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im)
        if im.mode not in ("RGB", "RGBA"):
            im = im.convert("RGB")
        return im.copy()


def oversized(path: Path, cap: int) -> tuple[int, int] | None:
    """只读 header 判尺寸，不解码像素。"""
    with Image.open(path) as im:
        size = im.size
    return size if max(size) > cap else None


def downscale(path: Path, cap: int) -> tuple[tuple[int, int], tuple[int, int], int]:
    before = oversized(path, cap)
    assert before is not None
    im = load_transposed(path)
    im.thumbnail((cap, cap), Image.Resampling.LANCZOS)
    fd, tmp_name = tempfile.mkstemp(suffix=".jpg", dir=str(path.parent))
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        im.save(tmp, "JPEG", quality=QUALITY, optimize=True, subsampling=0)
        if tmp.stat().st_size <= 0:
            raise RuntimeError("empty output")
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)
    return before, im.size, path.stat().st_size


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="只检查，不写入")
    parser.add_argument("--max", type=int, default=DEFAULT_MAX, help="长边上限")
    args = parser.parse_args()

    if args.max <= MEDIUM_MAX_EDGE:
        print(f"--max 必须 > {MEDIUM_MAX_EDGE}（medium 生成阈值），否则灯箱会回落原文件")
        return 2

    targets = jpeg_masters()
    over = [(p, oversized(p, args.max)) for p in targets]
    over = [(p, s) for p, s in over if s]

    if args.check:
        if over:
            for p, size in over:
                print(f"超限 {size[0]}x{size[1]} (>{args.max}): {p.name}")
            return 1
        print(f"全部母版长边 <= {args.max}px（共 {len(targets)} 张）")
        return 0

    if not over:
        print(f"无需处理：{len(targets)} 张母版均 <= {args.max}px")
        return 0

    total_before = sum(p.stat().st_size for p, _ in over)
    for p, _ in over:
        before_size = p.stat().st_size
        before, after, after_size = downscale(p, args.max)
        print(
            f"{p.name}: {before[0]}x{before[1]} -> {after[0]}x{after[1]}  "
            f"{before_size / 1048576:.2f} MB -> {after_size / 1048576:.2f} MB"
        )
    total_after = sum(p.stat().st_size for p, _ in over)
    print(
        f"\n{len(over)} 张合计 {total_before / 1048576:.2f} MB -> "
        f"{total_after / 1048576:.2f} MB"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
