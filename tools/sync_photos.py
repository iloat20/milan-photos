from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from photos_lib import MANIFEST, ROOT, build_photos, hero_file  # noqa: E402


def main() -> None:
    photos = build_photos()
    data: dict = {"photos": photos}
    # 序厅首张（= 解析期 preload 的目标）的 file 指针（F-3）：与 src/util.js 的
    # selectHeroPhotos 同口径，一致性由 tests/unit/util.test.mjs 的真清单契约对拍。
    hero = hero_file(photos)
    if hero:
        data["hero"] = hero
    MANIFEST.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {MANIFEST.relative_to(ROOT)} ({len(photos)} photos, hero={hero})")


if __name__ == "__main__":
    main()
