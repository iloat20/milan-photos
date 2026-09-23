"""本地预览服务：访问 /photos/manifest.json 时实时扫描目录，无需手动 sync。"""
from __future__ import annotations

import json
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from photos_lib import PHOTOS, ROOT, build_photos  # noqa: E402

# build_photos 全量 freshness 检查对并发请求不友好：mtime 戳未变时直接回缓存
_lock = threading.Lock()
_cache: dict = {"stamp": None, "body": None}


def _tree_stamp() -> float:
    latest = 0.0
    for p in PHOTOS.rglob("*"):
        try:
            latest = max(latest, p.stat().st_mtime)
        except OSError:
            pass
    return latest


def build_manifest() -> bytes:
    stamp = _tree_stamp()
    with _lock:
        if _cache["body"] is None or _cache["stamp"] != stamp:
            payload = json.dumps({"photos": build_photos()}, ensure_ascii=False, indent=2)
            _cache["body"] = payload.encode("utf-8")
            # build 可能写出新缩略图，落缓存后重取 mtime 戳
            _cache["stamp"] = _tree_stamp()
        return _cache["body"]


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


class Server(ThreadingHTTPServer):
    # 默认 backlog=5：manifest 缓存后首页资源瞬间并发会溢出 accept 队列（ERR_CONNECTION_REFUSED）
    request_queue_size = 128
    daemon_threads = True


def main() -> None:
    port = 8080
    handler = partial(Handler, directory=str(ROOT))
    with Server(("127.0.0.1", port), handler) as httpd:
        print(f"米兰本地预览: http://127.0.0.1:{port}/")
        print("把图片放进 photos/ 后直接刷新页面，无需同步脚本。Ctrl+C 停止。")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")


if __name__ == "__main__":
    main()
