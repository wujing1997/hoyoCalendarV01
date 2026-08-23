#!/usr/bin/env python3
"""HoYoCalendar 管理后台静态服务与 API 代理。

- 只绑定 127.0.0.1:8080，必须通过 SSH 隧道访问。
- 静态文件与本脚本同目录（index.html / styles.css / app.js）。
- /api/* 一律转发到本机管理 API（默认 127.0.0.1:8001）。
- 仅依赖 Python 标准库，无需 pip 安装。

用法：
    python3 server.py [--port 8080] [--api-port 8001]
"""
import argparse
import http.client
import http.server
import json
import os
import sys
import urllib.parse

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.BaseHTTPRequestHandler):
    api_port = 8001

    def log_message(self, fmt, *args):
        sys.stderr.write("[admin-web] %s\n" % (fmt % args))

    def _proxy_api(self):
        parsed = urllib.parse.urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        try:
            conn = http.client.HTTPConnection("127.0.0.1", self.api_port, timeout=60)
            headers = {k: v for k, v in self.headers.items() if k.lower() not in ("host", "content-length")}
            conn.request(self.command, parsed.path, body=body, headers=headers)
            response = conn.getresponse()
            payload = response.read()
            self.send_response(response.status)
            for key, value in response.getheaders():
                if key.lower() in ("content-length", "transfer-encoding"):
                    continue
                self.send_header(key, value)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            conn.close()
        except Exception as error:  # noqa: BLE001 - 代理失败给出可读错误
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            body = json.dumps({"detail": "管理 API 不可达：%s" % error}).encode("utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def _serve_static(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/":
            path = "/index.html"
        safe = os.path.normpath(path.lstrip("/"))
        if safe.startswith(".."):
            self.send_error(403)
            return
        file_path = os.path.join(SCRIPT_DIR, safe)
        if not os.path.isfile(file_path):
            self.send_error(404)
            return
        content_types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".svg": "image/svg+xml",
        }
        extension = os.path.splitext(file_path)[1].lower()
        content_type = content_types.get(extension, "application/octet-stream")
        with open(file_path, "rb") as handle:
            payload = handle.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path.startswith("/api/"):
            self._proxy_api()
        else:
            self._serve_static()

    do_POST = do_GET
    do_PUT = do_GET
    do_PATCH = do_GET
    do_DELETE = do_GET


def main():
    parser = argparse.ArgumentParser(description="HoYoCalendar admin web console")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--api-port", type=int, default=8001)
    args = parser.parse_args()
    Handler.api_port = args.api_port
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print("管理后台已启动： http://127.0.0.1:%d （仅本机，请通过 SSH 隧道访问）" % args.port)
    print("管理 API 代理： http://127.0.0.1:%d -> http://127.0.0.1:%d" % (args.port, args.api_port))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
