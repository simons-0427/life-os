"""Launch Life OS in a local desktop window."""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import subprocess
import threading
import time
from urllib.parse import urlsplit

from connection import Connection


APP = Path(__file__).resolve().parent
WEB = APP / "web"
ASSETS = {
    "": ("index.html", "text/html"),
    "main.css": ("main.css", "text/css"),
    "app.js": ("app.js", "text/javascript"),
    "metrics.js": ("metrics.js", "text/javascript"),
    "charts.js": ("charts.js", "text/javascript"),
    "analysis.js": ("analysis.js", "text/javascript"),
    "connector.js": ("connector.js", "text/javascript"),
    "editor.js": ("editor.js", "text/javascript"),
}
IDLE_SECONDS = 600


class LiveServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self):
        super().__init__(("127.0.0.1", 0), Handler)
        profile = Path(os.environ.get("LOCALAPPDATA", APP)) / "Life OS Beta" / "connection.dpapi"
        self.connection = Connection(profile)
        self.token = secrets.token_urlsafe(32)
        self.host = f"127.0.0.1:{self.server_port}"
        self.last_seen = time.monotonic()
        self.mutation_lock = threading.Lock()

    @property
    def url(self):
        return f"http://{self.host}/{self.token}/"

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def relative_path(self):
        server = self.server
        path = urlsplit(self.path).path
        prefix = f"/{server.token}/"
        if self.headers.get("Host") != server.host or not path.startswith(prefix):
            self.send_error(404)
            return None
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            self.send_error(403)
            return None
        server.last_seen = time.monotonic()
        return path[len(prefix):]

    def do_GET(self):
        relative = self.relative_path()
        if relative is None:
            return
        if relative in ASSETS:
            filename, content_type = ASSETS[relative]
            self.reply((WEB / filename).read_bytes(), content_type)
        elif relative == "heartbeat":
            self.reply(b"ok", "text/plain")
        else:
            self.send_error(404)

    def do_POST(self):
        relative = self.relative_path()
        if relative is None:
            return
        if relative != "bridge" or self.headers.get("Origin") != "http://" + self.server.host:
            self.send_error(403)
            return
        if self.headers.get_content_type() != "application/json":
            self.send_error(415)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 100_000:
                raise ValueError("Die Eingaben sind zu groß.")
            payload = json.loads(self.rfile.read(length))
            action = payload.get("action")
            value = payload.get("value") or {}
            if action == "saveSettings" or (action == "call" and value.get("role") == "write"):
                with self.server.mutation_lock:
                    data = self.server.connection.handle(action, value)
            else:
                data = self.server.connection.handle(action, value)
            result = {"ok": True, "data": data}
        except (ValueError, TypeError, KeyError, AttributeError) as error:
            result = {"ok": False, "error": str(error)}
            if getattr(error, "status", None):
                result["status"] = error.status
        except OSError:
            result = {"ok": False, "error": "Die API oder der Windows-Anmeldespeicher ist nicht erreichbar."}
        self.reply(json.dumps(result, ensure_ascii=False, allow_nan=False).encode("utf-8"), "application/json")

    def reply(self, content, content_type):
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy",
                         "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; "
                         "img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
        self.end_headers()
        try:
            self.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError):
            pass


def browser_executable():
    roots = [os.getenv(name) for name in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA")]
    browsers = ("Microsoft/Edge/Application/msedge.exe", "Google/Chrome/Application/chrome.exe",
                "BraveSoftware/Brave-Browser/Application/brave.exe")
    return next((Path(root) / browser for browser in browsers for root in roots
                 if root and (Path(root) / browser).is_file()), None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-window", action="store_true")
    args = parser.parse_args()
    with LiveServer() as server:
        if args.no_window:
            print(server.url, flush=True)
        else:
            browser = browser_executable()
            if browser is None:
                parser.error("Für das App-Fenster wird Microsoft Edge, Chrome oder Brave benötigt.")
            subprocess.Popen([str(browser), f"--app={server.url}"])
        server.timeout = 1
        try:
            while time.monotonic() - server.last_seen < IDLE_SECONDS:
                server.handle_request()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
