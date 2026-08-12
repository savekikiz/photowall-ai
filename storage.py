"""Single place that touches persistence.

Everything else in the app calls these functions; nothing else opens
data/db.json or the media directory directly.  Swapping this module out is
all it takes to move to another backend (the Netlify build swaps it for
Netlify Blobs -- see netlify/functions/_storage.mjs).
"""

import json
import os
import secrets
import tempfile
import threading
from datetime import datetime, timezone

DATA_DIR = os.environ.get("DATA_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
DB_PATH = os.path.join(DATA_DIR, "db.json")
MEDIA_DIR = os.path.join(DATA_DIR, "media")

DB_LOCK = threading.RLock()

EMPTY_DB = {"campaigns": [], "submissions": []}


def _ensure_dirs():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(os.path.join(MEDIA_DIR, "uploads"), exist_ok=True)
    os.makedirs(os.path.join(MEDIA_DIR, "generated"), exist_ok=True)


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_id(prefix="sub"):
    return f"{prefix}_{secrets.token_hex(4)}"


def load_db():
    """Read db.json, creating an empty one the first time."""
    _ensure_dirs()
    if not os.path.exists(DB_PATH):
        save_db(dict(EMPTY_DB, campaigns=[], submissions=[]))
        return {"campaigns": [], "submissions": []}
    try:
        with open(DB_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        # A corrupt file must not take the whole event down.
        return {"campaigns": [], "submissions": []}
    data.setdefault("campaigns", [])
    data.setdefault("submissions", [])
    return data


def save_db(data, path=None):
    """Atomic write: temp file in the same dir, fsync, then os.replace."""
    path = path or DB_PATH
    _ensure_dirs()
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


# ---------------------------------------------------------------- campaigns

def list_campaigns():
    with DB_LOCK:
        return list(load_db()["campaigns"])


def get_campaign(slug):
    with DB_LOCK:
        for c in load_db()["campaigns"]:
            if c["slug"] == slug:
                return c
    return None


def add_campaign(slug, title, description=""):
    with DB_LOCK:
        db = load_db()
        if any(c["slug"] == slug for c in db["campaigns"]):
            return None
        campaign = {
            "slug": slug,
            "title": title,
            "description": description or "",
            "created_at": now_iso(),
        }
        db["campaigns"].append(campaign)
        save_db(db)
        return campaign


# -------------------------------------------------------------- submissions

def add_submission(sub):
    with DB_LOCK:
        db = load_db()
        db["submissions"].append(sub)
        save_db(db)
        return sub


def update_submission(sub_id, **fields):
    with DB_LOCK:
        db = load_db()
        for sub in db["submissions"]:
            if sub["id"] == sub_id:
                sub.update(fields)
                save_db(db)
                return sub
    return None


def get_submission(sub_id):
    with DB_LOCK:
        for sub in load_db()["submissions"]:
            if sub["id"] == sub_id:
                return sub
    return None


def list_submissions(campaign_slug=None, only_done=False):
    with DB_LOCK:
        subs = load_db()["submissions"]
    if campaign_slug:
        subs = [s for s in subs if s.get("campaign_slug") == campaign_slug]
    if only_done:
        subs = [s for s in subs if s.get("status") in ("done", "fallback_mock")]
    return sorted(subs, key=lambda s: s.get("created_at", ""), reverse=True)


# ------------------------------------------------------------------- media

def save_media(rel_path, data: bytes):
    """rel_path looks like 'generated/sub_x.png'.  Returns the same rel_path."""
    _ensure_dirs()
    full = os.path.join(MEDIA_DIR, rel_path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(full), suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, full)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    return rel_path


def read_media(rel_path):
    full = os.path.normpath(os.path.join(MEDIA_DIR, rel_path))
    if not full.startswith(os.path.normpath(MEDIA_DIR) + os.sep):
        return None  # path traversal attempt
    if not os.path.isfile(full):
        return None
    with open(full, "rb") as f:
        return f.read()
