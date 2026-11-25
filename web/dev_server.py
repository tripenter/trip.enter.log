#!/usr/bin/env python3
"""Local web server (port 8888): static files + /rest/* → Go API (port 10000).

Mirrors production nginx:
  - static from this directory (web/)
  - location /rest/ → proxy_pass http://127.0.0.1:10000

Usage (from repo root or anywhere):
  python3 web/dev_server.py
  python3 web/dev_server.py --port 8888 --api http://127.0.0.1:10000
"""

from __future__ import annotations

import argparse
import http.client
import http.server
import os
import socketserver
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit


WEB_ROOT = Path(__file__).resolve().parent
DEFAULT_PORT = 8888
DEFAULT_API = "http://127.0.0.1:10000"


class RestProxyHandler(http.server.SimpleHTTPRequestHandler):
    api_base = DEFAULT_API

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def do_GET(self) -> None:
        if self.path.startswith("/rest/") or self.path == "/rest":
            self._proxy()
            return
        super().do_GET()

    def do_HEAD(self) -> None:
        if self.path.startswith("/rest/") or self.path == "/rest":
            self._proxy()
            return
        super().do_HEAD()

    def do_POST(self) -> None:
        if self.path.startswith("/rest/") or self.path == "/rest":
            self._proxy()
            return
        self.send_error(http.HTTPStatus.METHOD_NOT_ALLOWED, "POST only for /rest/")

    def do_PUT(self) -> None:
        if self.path.startswith("/rest/") or self.path == "/rest":
            self._proxy()
            return
        self.send_error(http.HTTPStatus.METHOD_NOT_ALLOWED)

    def do_PATCH(self) -> None:
        if self.path.startswith("/rest/") or self.path == "/rest":
            self._proxy()
            return
        self.send_error(http.HTTPStatus.METHOD_NOT_ALLOWED)

    def do_DELETE(self) -> None:
        if self.path.startswith("/rest/") or self.path == "/rest":
            self._proxy()
            return
        self.send_error(http.HTTPStatus.METHOD_NOT_ALLOWED)

    def do_OPTIONS(self) -> None:
        # Same-origin proxy; still answer preflight if a tool sends it.
        if self.path.startswith("/rest/") or self.path == "/rest":
            self.send_response(http.HTTPStatus.NO_CONTENT)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
            self.send_header(
                "Access-Control-Allow-Headers",
                self.headers.get("Access-Control-Request-Headers", "Content-Type"),
            )
            self.end_headers()
            return
        self.send_error(http.HTTPStatus.METHOD_NOT_ALLOWED)

    def _proxy(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length > 0 else None
        target = self.api_base.rstrip("/") + self.path
        req = urllib.request.Request(target, data=body, method=self.command)
        # Forward useful headers; skip hop-by-hop.
        skip = {
            "host",
            "content-length",
            "connection",
            "transfer-encoding",
            "keep-alive",
            "proxy-authenticate",
            "proxy-authorization",
            "te",
            "trailers",
            "upgrade",
        }
        for key, value in self.headers.items():
            if key.lower() in skip:
                continue
            req.add_header(key, value)

        # Do not follow upstream redirects (OAuth Set-Cookie + Location must reach the browser).
        class _NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
                return None

        opener = urllib.request.build_opener(_NoRedirect)
        try:
            with opener.open(req, timeout=60) as resp:
                self._write_proxied(resp.status, resp.headers, resp.read())
        except urllib.error.HTTPError as err:
            # 3xx with no-redirect lands here; forward Location / Set-Cookie intact.
            self._write_proxied(err.code, err.headers, err.read() or b"")
        except Exception as err:  # noqa: BLE001 — surface upstream failure to browser
            msg = f"Bad Gateway: cannot reach Go API at {self.api_base} ({err})".encode()
            self.send_response(http.HTTPStatus.BAD_GATEWAY)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(msg)

    def _write_proxied(self, status: int, headers, data: bytes) -> None:  # noqa: ANN001
        self.send_response(status)
        for key, value in headers.items():
            if key.lower() in {"transfer-encoding", "connection", "content-encoding", "content-length"}:
                continue
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD" and data:
            self.wfile.write(data)


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> int:
    parser = argparse.ArgumentParser(description="Local web :8888 with /rest → Go :10000 proxy")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--api", default=DEFAULT_API, help="Go API base URL")
    args = parser.parse_args()

    parsed = urlsplit(args.api)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        print(f"Invalid --api URL: {args.api}", file=sys.stderr)
        return 2

    RestProxyHandler.api_base = args.api.rstrip("/")
    os.chdir(WEB_ROOT)

    server = ThreadedHTTPServer(("0.0.0.0", args.port), RestProxyHandler)
    print(
        f"Serving {WEB_ROOT} on http://127.0.0.1:{args.port}/  "
        f"(proxy /rest/* → {RestProxyHandler.api_base})",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
