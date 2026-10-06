import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SECRET = os.environ["TURN_SECRET"].encode()
HOST = os.environ.get("TURN_HOST", "5.57.39.42")
TTL = max(300, min(int(os.environ.get("TURN_TTL", "3600")), 86400))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/turn-credentials":
            self.send_error(404)
            return
        expires_at = int(time.time()) + TTL
        username = f"{expires_at}:doodle-{secrets.token_hex(6)}"
        credential = base64.b64encode(hmac.new(SECRET, username.encode(), hashlib.sha1).digest()).decode()
        body = json.dumps({
            "urls": [
                f"turn:{HOST}:3478?transport=udp",
                f"turn:{HOST}:3478?transport=tcp",
            ],
            "username": username,
            "credential": credential,
            "expiresAt": expires_at,
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f"turn-credentials: {self.address_string()} {fmt % args}", flush=True)


ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
