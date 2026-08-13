"""Stands in for api.openai.com/v1/images/edits so the real provider code path
can be exercised: /ok returns b64_json, /url returns a url, /fail returns 401,
/slow stalls past the client timeout, /429 rate-limits then succeeds on retry."""
import base64, json, os, sys, threading, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import mockimage
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PNG = mockimage.make_poster(width=300, height=400, campaign_title="FROM OPENAI STUB", theme_id="stub")

class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a): pass
    def _send(self, code, body, ctype="application/json"):
        self.send_response(code); self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        if self.path == "/hosted.png": return self._send(200, PNG, "image/png")
        self._send(404, b"{}")
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n)
        auth = self.headers.get("Authorization", "")
        # prove the request really is multipart with the required fields
        need = [b'name="model"', b'name="prompt"', b'name="size"', b'name="quality"',
                b'name="n"', b'name="image"; filename=']
        missing = [x.decode() for x in need if x not in raw]
        if missing:
            return self._send(400, json.dumps({"error": {"message": "missing fields: " + ",".join(missing)}}).encode())
        if not auth.startswith("Bearer "):
            return self._send(401, b'{"error":{"message":"no bearer token"}}')
        if "/fail/" in self.path:
            return self._send(401, b'{"error":{"message":"Incorrect API key provided: sk-bad"}}')
        if "/slow/" in self.path:
            # Outlast the caller's per-attempt timeout so the abort path runs.
            time.sleep(float(os.environ.get("STUB_SLOW_SECONDS", "6")))
            return self._send(200, json.dumps({"data": [{"b64_json": base64.b64encode(PNG).decode()}]}).encode())
        if "/429/" in self.path:
            # First call of each pair is rate-limited; the retry gets through.
            with LOCK:
                RATE["n"] += 1
                first = RATE["n"] % 2 == 1
            if first:
                self.send_response(429)
                self.send_header("Content-Type", "application/json")
                self.send_header("Retry-After", "1")
                body = b'{"error":{"message":"Rate limit reached for images"}}'
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                return self.wfile.write(body)
            return self._send(200, json.dumps({"data": [{"b64_json": base64.b64encode(PNG).decode()}]}).encode())
        if "/500/" in self.path:
            return self._send(500, b'{"error":{"message":"upstream boom"}}')
        if "/url/" in self.path:
            return self._send(200, json.dumps({"data": [{"url": f"http://localhost:{PORT}/hosted.png"}]}).encode())
        return self._send(200, json.dumps({"data": [{"b64_json": base64.b64encode(PNG).decode()}]}).encode())

RATE = {"n": 0}
LOCK = threading.Lock()
PORT = int(os.environ.get("STUB_PORT", "8099"))
print("stub on", PORT, flush=True)
ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
