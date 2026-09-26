"""本地预览服务：访问 /photos/manifest.json 时实时扫描目录，无需手动 sync。

端口默认 8080，可用 `--port` 或环境变量 `MILAN_PORT` 覆盖（e2e 与 CI 走同一变量）。
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from photos_lib import PHOTOS, ROOT, build_photos  # noqa: E402

DEFAULT_PORT = 8080

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
        try:
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
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            # 页面切换、懒加载和测试结束都会主动取消在途图片请求；这是正常断连。
            return

    def log_message(self, fmt: str, *args) -> None:
        print("%s - %s" % (self.address_string(), fmt % args))


class Server(ThreadingHTTPServer):
    # 默认 backlog=5：manifest 缓存后首页资源瞬间并发会溢出 accept 队列（ERR_CONNECTION_REFUSED）
    request_queue_size = 128
    daemon_threads = True

    def server_bind(self) -> None:
        # Windows 的 SO_REUSEADDR 语义与 POSIX 不同：它允许**第二个进程绑定同一个
        # 端口**，两边都进入 LISTENING，请求被随机分发。于是「8080 上到底是谁」变得
        # 不确定 —— 本机曾出现 opencode 的工作树服务占用 8080，e2e 静默跑在**另一个
        # 仓库**的资产上，失败信息却指向被测代码。
        # 改用 SO_EXCLUSIVEADDRUSE：端口被占用时 bind 直接抛错，宁可启动失败也不静默串味。
        if sys.platform == "win32" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.allow_reuse_address = False
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, True)
        super().server_bind()


def _resolve_port() -> int:
    parser = argparse.ArgumentParser(description="米兰照片墙本地预览服务")
    parser.add_argument(
        "--port",
        "-p",
        type=int,
        default=None,
        help=f"监听端口（也可用环境变量 MILAN_PORT，默认 {DEFAULT_PORT}）",
    )
    args = parser.parse_args()
    raw = args.port if args.port is not None else os.environ.get("MILAN_PORT", DEFAULT_PORT)
    try:
        port = int(raw)
    except (TypeError, ValueError):
        raise SystemExit(f"[serve] 端口无效：{raw!r}")
    if not 1 <= port <= 65535:
        raise SystemExit(f"[serve] 端口越界：{port}")
    return port


def main() -> None:
    port = _resolve_port()
    # 冷启动时先完成一次清单扫描；否则并行 E2E worker 会同时等同一把锁，
    # 首个页面可能在默认 5s 断言窗口内仍拿不到卡片。
    build_manifest()
    handler = partial(Handler, directory=str(ROOT))
    try:
        server = Server(("127.0.0.1", port), handler)
    except OSError as exc:
        raise SystemExit(
            f"[serve] 无法监听 127.0.0.1:{port}（{exc}）。\n"
            f"        该端口已被其它进程占用。请先停止占用进程，"
            f"或换端口：python tools/serve.py --port 8099"
        )
    with server as httpd:
        print(f"米兰本地预览: http://127.0.0.1:{port}/")
        print("把图片放进 photos/ 后直接刷新页面，无需同步脚本。Ctrl+C 停止。")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")


if __name__ == "__main__":
    main()
