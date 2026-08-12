#!/usr/bin/env python3
"""PhotoWall AI -- standalone server (no framework, no database).

Run:  python3 server.py
Env:  see .env.example
"""

import json
import mimetypes
import os
import re
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

import imagegen
import storage

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(ROOT, "public")
THEMES_PATH = os.path.join(ROOT, "themes.json")

MAX_BODY = 20 * 1024 * 1024  # a 12MB photo turns into ~16MB of base64


# ------------------------------------------------------------------ config

def load_dotenv(path=os.path.join(ROOT, ".env")):
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def config():
    return {
        "PUBLIC_BASE_URL": os.environ.get("PUBLIC_BASE_URL", ""),
        "ADMIN_TOKEN": os.environ.get("ADMIN_TOKEN", ""),
        "OPENAI_API_KEY": os.environ.get("OPENAI_API_KEY", ""),
        # only for testing against a stub; leave unset in production
        "OPENAI_BASE_URL": os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        "IMAGE_PROVIDER": os.environ.get("IMAGE_PROVIDER", "mock"),
        "IMAGE_MODEL": os.environ.get("IMAGE_MODEL", "gpt-image-2"),
        "IMAGE_SIZE": os.environ.get("IMAGE_SIZE", "1024x1536"),
        "IMAGE_QUALITY": os.environ.get("IMAGE_QUALITY", "medium"),
    }


_themes_cache = None


def themes():
    global _themes_cache
    if _themes_cache is None:
        with open(THEMES_PATH, "r", encoding="utf-8") as f:
            _themes_cache = json.load(f)
    return _themes_cache


def theme_by_id(theme_id):
    for t in themes():
        if t["id"] == theme_id:
            return t
    return None


SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,60}$")


def slugify(value):
    value = (value or "").strip().lower()
    value = re.sub(r"[^a-z0-9฀-๿]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return value


# ------------------------------------------------------------- generation

def run_generation(sub_id):
    """Runs off the request thread; mirrors the Netlify background function."""
    try:
        sub = storage.get_submission(sub_id)
        if not sub:
            return
        campaign = storage.get_campaign(sub["campaign_slug"]) or {"title": sub["campaign_slug"]}
        theme = theme_by_id(sub.get("theme_id")) or themes()[0]
        photo = storage.read_media(sub["photo_path"])
        ext = (sub.get("photo_path") or "").rsplit(".", 1)[-1] or "jpg"
        img, status, error = imagegen.generate(
            photo_bytes=photo, photo_ext=ext, campaign=campaign,
            theme=theme, sub=sub, config=config(),
        )
        rel = f"generated/{sub_id}.png"
        storage.save_media(rel, img)
        storage.update_submission(sub_id, status=status, error=error, image_path=rel)
    except Exception:
        storage.update_submission(sub_id, status="error", error=traceback.format_exc()[-500:])


def public_sub(sub):
    out = {
        "id": sub["id"],
        "campaign_slug": sub["campaign_slug"],
        "student_name": sub.get("student_name", ""),
        "learnings": sub.get("learnings", []),
        "commitments": sub.get("commitments", []),
        "theme_id": sub.get("theme_id", ""),
        "status": sub.get("status", "processing"),
        "error": sub.get("error", ""),
        "created_at": sub.get("created_at", ""),
        "imageUrl": None,
    }
    if sub.get("image_path"):
        out["imageUrl"] = "/media/" + sub["image_path"]
    return out


# ---------------------------------------------------------------- handler

class Handler(BaseHTTPRequestHandler):
    server_version = "PhotoWall/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    # ---- helpers
    def send_json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_bytes(self, code, body, content_type, cache="public, max-age=300"):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > MAX_BODY:
            raise ValueError("payload ใหญ่เกินไป")
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def admin_ok(self):
        expected = config()["ADMIN_TOKEN"]
        if not expected:
            return False
        return self.headers.get("X-Admin-Token", "") == expected

    # ---- routing
    def do_GET(self):
        try:
            self.route_get()
        except BrokenPipeError:
            pass
        except Exception:
            traceback.print_exc()
            self.send_json(500, {"error": "internal error"})

    do_HEAD = do_GET

    def do_POST(self):
        try:
            self.route_post()
        except ValueError as e:
            self.send_json(400, {"error": str(e)})
        except BrokenPipeError:
            pass
        except Exception:
            traceback.print_exc()
            self.send_json(500, {"error": "internal error"})

    def route_get(self):
        u = urlparse(self.path)
        path = unquote(u.path)
        q = parse_qs(u.query)
        cfg = config()

        if path == "/healthz":
            return self.send_json(200, {
                "ok": True,
                "storage": "file",
                "db_path": storage.DB_PATH,
                "image_provider": cfg["IMAGE_PROVIDER"],
                "has_openai_key": bool(cfg["OPENAI_API_KEY"]),
                "admin_token_set": bool(cfg["ADMIN_TOKEN"]),
                "campaigns": len(storage.list_campaigns()),
                "submissions": len(storage.list_submissions()),
                "time": storage.now_iso(),
            })

        if path == "/api/themes":
            return self.send_json(200, {"themes": themes()})

        if path == "/api/campaigns":
            if not self.admin_ok():
                return self.send_json(401, {"error": "unauthorized"})
            return self.send_json(200, {"campaigns": storage.list_campaigns()})

        m = re.match(r"^/api/campaigns/([^/]+)$", path)
        if m:
            c = storage.get_campaign(m.group(1))
            if not c:
                return self.send_json(404, {"error": "ไม่พบงานนี้"})
            return self.send_json(200, {"campaign": c})

        m = re.match(r"^/api/submissions/([^/]+)$", path)
        if m:
            sub = storage.get_submission(m.group(1))
            if not sub:
                return self.send_json(404, {"error": "ไม่พบ submission"})
            return self.send_json(200, public_sub(sub))

        if path == "/api/submissions":
            slug = (q.get("campaign") or [""])[0]
            if not slug:
                return self.send_json(400, {"error": "ต้องระบุ ?campaign="})
            subs = storage.list_submissions(slug, only_done=True)
            return self.send_json(200, {"submissions": [public_sub(s) for s in subs]})

        if path.startswith("/media/"):
            rel = path[len("/media/"):]
            data = storage.read_media(rel)
            if data is None:
                return self.send_json(404, {"error": "not found"})
            ctype = mimetypes.guess_type(rel)[0] or "application/octet-stream"
            return self.send_bytes(200, data, ctype, cache="public, max-age=31536000, immutable")

        return self.serve_static(path)

    def route_post(self):
        u = urlparse(self.path)
        path = unquote(u.path)

        if path == "/api/campaigns":
            if not self.admin_ok():
                return self.send_json(401, {"error": "unauthorized: ต้องส่ง X-Admin-Token ให้ถูกต้อง"})
            body = self.read_json()
            title = (body.get("title") or "").strip()
            if not title:
                return self.send_json(400, {"error": "ต้องมีชื่องาน (title)"})
            slug = slugify(body.get("slug") or title)
            if not slug:
                return self.send_json(400, {"error": "slug ไม่ถูกต้อง"})
            c = storage.add_campaign(slug, title, (body.get("description") or "").strip())
            if c is None:
                return self.send_json(409, {"error": "มีงานชื่อนี้อยู่แล้ว"})
            return self.send_json(201, {"campaign": c})

        if path == "/api/submissions":
            return self.create_submission()

        return self.send_json(404, {"error": "not found"})

    def create_submission(self):
        body = self.read_json()
        slug = (body.get("campaign_slug") or "").strip()
        campaign = storage.get_campaign(slug)
        if not campaign:
            return self.send_json(404, {"error": "ไม่พบงานนี้ (campaign_slug)"})

        theme = theme_by_id((body.get("theme_id") or "").strip())
        if not theme:
            return self.send_json(400, {"error": "ต้องเลือกธีมที่มีอยู่จริง (theme_id)"})

        def clean_list(v):
            if isinstance(v, str):
                v = v.split("\n")
            return [str(x).strip()[:300] for x in (v or []) if str(x).strip()][:6]

        learnings = clean_list(body.get("learnings"))
        commitments = clean_list(body.get("commitments"))
        if not learnings:
            return self.send_json(400, {"error": "ต้องเขียนว่าได้เรียนรู้อะไรอย่างน้อย 1 ข้อ"})
        if not commitments:
            return self.send_json(400, {"error": "ต้องเขียนว่าจะเอาไปทำอะไรต่ออย่างน้อย 1 ข้อ"})

        try:
            photo_bytes, ext = imagegen.decode_photo(body.get("photoData"))
        except imagegen.PhotoError as e:
            return self.send_json(400, {"error": str(e)})

        sub_id = storage.new_id("sub")
        photo_rel = f"uploads/{sub_id}.{ext}"
        storage.save_media(photo_rel, photo_bytes)

        sub = {
            "id": sub_id,
            "campaign_slug": slug,
            "student_name": (body.get("student_name") or "").strip()[:80],
            "learnings": learnings,
            "commitments": commitments,
            "theme_id": theme["id"],
            "image_path": "",
            "photo_path": photo_rel,
            "status": "processing",
            "error": "",
            "created_at": storage.now_iso(),
        }
        storage.add_submission(sub)
        threading.Thread(target=run_generation, args=(sub_id,), daemon=True).start()
        return self.send_json(201, {"id": sub_id, "status": "processing",
                                    "pollUrl": f"/api/submissions/{sub_id}"})

    # ---- static files
    def serve_static(self, path):
        if path == "/":
            path = "/index.html"
        elif path == "/admin" or path == "/admin/":
            path = "/admin.html"
        elif path.startswith("/c/"):
            path = "/c.html"

        rel = path.lstrip("/")
        full = os.path.normpath(os.path.join(PUBLIC_DIR, rel))
        if not full.startswith(PUBLIC_DIR) or not os.path.isfile(full):
            return self.send_json(404, {"error": "not found"})
        with open(full, "rb") as f:
            data = f.read()
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        return self.send_bytes(200, data, ctype, cache="no-cache")


def main():
    load_dotenv()
    port = int(os.environ.get("PORT", "8080"))
    host = os.environ.get("HOST", "0.0.0.0")
    cfg = config()
    storage.load_db()
    print(f"PhotoWall AI on http://localhost:{port}")
    print(f"  provider={cfg['IMAGE_PROVIDER']} openai_key={'yes' if cfg['OPENAI_API_KEY'] else 'no'} "
          f"admin_token={'set' if cfg['ADMIN_TOKEN'] else 'MISSING'}")
    print(f"  data: {storage.DB_PATH}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
