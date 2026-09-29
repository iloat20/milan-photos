"""移除 JPEG EXIF 中的 GPS 指针与 GPS IFD，不重新压缩图像像素。

用法：
  python tools/sanitize_photos.py            # 就地清理 photos/ 下的 JPEG
  python tools/sanitize_photos.py --check    # 只检查，发现 GPS 时返回非零

EXIF 的其它字段（方向、拍摄时间等）会尽量保留；manifest 还会以已提交日期
作为稳定回退，因此清理不会改变照片在展厅中的日期。
"""
from __future__ import annotations

import argparse
import os
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PHOTOS = ROOT / "photos"
EXIF_HEADER = b"Exif\x00\x00"


def _u16(data: bytes, offset: int, endian: str) -> int | None:
    if offset < 0 or offset + 2 > len(data):
        return None
    return int.from_bytes(data[offset : offset + 2], endian)


def _u32(data: bytes, offset: int, endian: str) -> int | None:
    if offset < 0 or offset + 4 > len(data):
        return None
    return int.from_bytes(data[offset : offset + 4], endian)


def _put_u16(data: bytearray, offset: int, value: int, endian: str) -> None:
    data[offset : offset + 2] = value.to_bytes(2, endian)


def _gps_ifd_end(tiff: bytes, offset: int, endian: str) -> int:
    """返回 GPS IFD 及其直接指向数据的末端，不触碰其它 EXIF 区域。"""
    count = _u16(tiff, offset, endian)
    if count is None or count > 256:
        return len(tiff)
    end = offset + 2 + count * 12 + 4
    unit_size = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4}
    for index in range(count):
        entry = offset + 2 + index * 12
        if entry + 12 > len(tiff):
            return len(tiff)
        field_type = _u16(tiff, entry + 2, endian)
        value_count = _u32(tiff, entry + 4, endian)
        if value_count is None:
            continue
        width = unit_size.get(field_type)
        if width and value_count * width > 4:
            pointed = _u32(tiff, entry + 8, endian)
            if pointed is not None:
                end = max(end, pointed + value_count * width)
    return min(len(tiff), max(end, offset + 2))


def _strip_exif_payload(payload: bytes) -> bytes | None:
    if not payload.startswith(EXIF_HEADER):
        return None
    tiff = bytearray(payload[len(EXIF_HEADER) :])
    if len(tiff) < 8:
        return None
    byte_order = tiff[:2]
    if byte_order == b"II":
        endian = "little"
    elif byte_order == b"MM":
        endian = "big"
    else:
        return None
    if _u16(tiff, 2, endian) != 42:
        return None
    ifd0 = _u32(tiff, 4, endian)
    if ifd0 is None or ifd0 + 2 > len(tiff):
        return None
    count = _u16(tiff, ifd0, endian)
    if count is None or count > 256:
        return None
    ifd_end = ifd0 + 2 + count * 12 + 4
    if ifd_end > len(tiff):
        return None

    gps_entry = None
    gps_offset = None
    for index in range(count):
        entry = ifd0 + 2 + index * 12
        if _u16(tiff, entry, endian) == 0x8825:
            gps_entry = entry
            gps_offset = _u32(tiff, entry + 8, endian)
            break
    if gps_entry is None:
        return None

    if gps_offset is not None and 0 <= gps_offset < len(tiff):
        # 只清零 GPS IFD 及其指向的数据，保留同一 EXIF 块里的方向/日期字段。
        gps_end = _gps_ifd_end(bytes(tiff), gps_offset, endian)
        tiff[gps_offset:gps_end] = b"\x00" * (gps_end - gps_offset)

    # 删除 IFD0 中的 GPS 指针（原地缩短目录，填充 12 字节空洞以保持 APP1 长度）。
    body_start = ifd0 + 2
    next_ifd = bytes(tiff[ifd0 + 2 + count * 12 : ifd_end])
    entries = bytes(tiff[body_start : ifd0 + 2 + count * 12])
    relative = gps_entry - body_start
    entries = entries[:relative] + entries[relative + 12 :] + b"\x00" * 12
    new_ifd = entries + next_ifd
    _put_u16(tiff, ifd0, count - 1, endian)
    tiff[body_start:ifd_end] = new_ifd
    return EXIF_HEADER + bytes(tiff)


def sanitize_bytes(data: bytes) -> bytes:
    """返回清理后的 JPEG；没有可定位的 GPS 时原样返回。"""
    if not data.startswith(b"\xff\xd8"):
        return data
    output = bytearray()
    pos = 0
    while pos < len(data):
        if data[pos] != 0xFF:
            output.extend(data[pos:])
            break
        if pos + 1 >= len(data):
            output.extend(data[pos:])
            break
        marker = data[pos + 1]
        output.extend(data[pos : pos + 2])
        pos += 2
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
            continue
        if pos + 2 > len(data):
            break
        length = int.from_bytes(data[pos : pos + 2], "big")
        if length < 2 or pos + length > len(data):
            output.extend(data[pos:])
            break
        segment_end = pos + length
        payload = data[pos + 2 : segment_end]
        if marker == 0xE1:
            cleaned = _strip_exif_payload(payload)
            if cleaned is not None:
                payload = cleaned
        output.extend((len(payload) + 2).to_bytes(2, "big"))
        output.extend(payload)
        pos = segment_end
        if marker == 0xDA:
            output.extend(data[pos:])
            break
    return bytes(output)


def _atomic_write(path: Path, data: bytes, mtime_ns: int | None = None) -> None:
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(temp_name, path)
        if mtime_ns is not None:
            os.utime(path, ns=(mtime_ns, mtime_ns))
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="只检查，不写入")
    args = parser.parse_args()
    changed: list[str] = []
    for path in sorted(PHOTOS.iterdir()):
        if (
            path.suffix.lower() not in {".jpg", ".jpeg"}
            or not path.is_file()
            or path.is_symlink()
        ):
            continue
        original_stat = path.stat()
        original = path.read_bytes()
        cleaned = sanitize_bytes(original)
        if cleaned == original:
            continue
        changed.append(path.name)
        if not args.check:
            _atomic_write(path, cleaned, original_stat.st_mtime_ns)
    if changed:
        action = "发现" if args.check else "已清理"
        print(f"{action} GPS EXIF: {', '.join(changed)}")
        return 1 if args.check else 0
    print("未发现 JPEG GPS EXIF")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
