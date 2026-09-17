"""本地预览服务：访问 /photos/manifest.json 时实时扫描目录，无需手动 sync。"""
from __future__ import annotations

import json
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from photos_lib import ROOT, build_photos  # noqa: E402


def build_manifest() -> bytes:
    payload = json.dumps({"photos": build_photos()}, ensure_ascii=False, indent=2)
    return payload.encode("utf-8")


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path in ("/photos/manifest.json", "photos/manifest.json"):
            body = build_manifest()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, fmt: str, *args) -> None:
        print("%s - %s" % (self.address_string(), fmt % args))


def main() -> None:
    port = 8080
    handler = partial(Handler, directory=str(ROOT))
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"米兰本地预览: http://127.0.0.1:{port}/")
        print("把图片放进 photos/ 后直接刷新页面，无需同步脚本。Ctrl+C 停止。")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")


if __name__ == "__main__":
    main()
