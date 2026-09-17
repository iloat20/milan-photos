from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from photos_lib import MANIFEST, ROOT, build_photos  # noqa: E402


def main() -> None:
    photos = build_photos()
    MANIFEST.write_text(
        json.dumps({"photos": photos}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {MANIFEST.relative_to(ROOT)} ({len(photos)} photos)")


if __name__ == "__main__":
    main()
