"""Photo validation, prompt building, and the OpenAI image-edit call.

Never raises to the caller: if anything goes wrong we hand back a mock
poster plus the error string, so a submission can never be lost.
"""

import base64
import binascii
import json
import mimetypes
import os
import re
import urllib.error
import urllib.request
import uuid

import mockimage

ALLOWED_MIME = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
}
MIN_BYTES = 1024              # 1KB
MAX_BYTES = 12 * 1024 * 1024  # 12MB

DATA_URL_RE = re.compile(r"^data:(?P<mime>[-\w.+/]+);base64,(?P<b64>.+)$", re.S)


class PhotoError(ValueError):
    pass


def decode_photo(photo_data):
    """data URL -> (bytes, ext).  Raises PhotoError with a human message.

    This runs on the server, not just in the browser, because anyone can POST
    straight at the API.
    """
    if not photo_data or not isinstance(photo_data, str):
        raise PhotoError("ต้องแนบรูปถ่าย (photoData) ก่อนจึงจะสร้างภาพได้")
    m = DATA_URL_RE.match(photo_data.strip())
    if not m:
        raise PhotoError("รูปต้องส่งมาเป็น data URL เช่น data:image/jpeg;base64,...")
    mime = m.group("mime").lower()
    if mime not in ALLOWED_MIME:
        raise PhotoError("รับเฉพาะไฟล์ png, jpeg, jpg, webp เท่านั้น")
    try:
        raw = base64.b64decode(m.group("b64"), validate=True)
    except (binascii.Error, ValueError):
        raise PhotoError("ถอดรหัสรูปไม่สำเร็จ ไฟล์อาจเสียหาย")
    if len(raw) < MIN_BYTES:
        raise PhotoError("ไฟล์รูปเล็กเกินไป (ต้องมากกว่า 1KB)")
    if len(raw) > MAX_BYTES:
        raise PhotoError("ไฟล์รูปใหญ่เกินไป (ต้องไม่เกิน 12MB)")
    sniffed = sniff(raw)
    if sniffed is None:
        raise PhotoError("ไฟล์ที่ส่งมาไม่ใช่รูปภาพจริง")
    return raw, sniffed


def sniff(raw: bytes):
    """Magic-byte check -- the declared mime type is not trusted."""
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if raw[:3] == b"\xff\xd8\xff":
        return "jpg"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "webp"
    return None


def mime_for(ext):
    return {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}.get(ext, "application/octet-stream")


PROMPT_TEMPLATE = """Create a vertical 3:4 commemorative closing-class poster for a workshop campaign named "{campaign_title}".
Style direction: {theme_prompt}.
Learner name: {student_name}

The poster must visually communicate a proud end-of-class moment, practical learning, and a personal commitment to apply what they learned at work.

Incorporate these learning takeaways as short visual notes, but do not overfill the image:
{learning_items}

Incorporate these commitments as future action cards:
{commitment_items}

Use the uploaded learner photo as an identity/appearance reference for the main person in the poster; preserve recognisable facial identity while transforming into the chosen theme.

Composition requirements:
- portrait poster, 3:4 aspect ratio
- premium memorable class keepsake
- expressive and impressive
- clean space for Thai/English short text
- no real brand logos
- no QR code
- no tiny unreadable text
- no distorted hands
- no watermark

Mood: inspiring, celebratory, practical, warm, high-impact."""


def build_prompt(campaign_title, theme_prompt, student_name, learnings, commitments):
    def bullets(items):
        items = [str(i).strip() for i in (items or []) if str(i).strip()]
        return "\n".join("- " + i for i in items) or "- (none provided)"

    return PROMPT_TEMPLATE.format(
        campaign_title=campaign_title or "Workshop",
        theme_prompt=theme_prompt or "clean modern celebratory poster",
        student_name=student_name or "Anonymous learner",
        learning_items=bullets(learnings),
        commitment_items=bullets(commitments),
    )


def _multipart(fields, file_field, filename, file_bytes, file_mime):
    boundary = "----photowall" + uuid.uuid4().hex
    out = bytearray()
    for k, v in fields.items():
        out += f"--{boundary}\r\n".encode()
        out += f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode()
        out += f"{v}\r\n".encode()
    out += f"--{boundary}\r\n".encode()
    out += (f'Content-Disposition: form-data; name="{file_field}"; '
            f'filename="{filename}"\r\n').encode()
    out += f"Content-Type: {file_mime}\r\n\r\n".encode()
    out += file_bytes + b"\r\n"
    out += f"--{boundary}--\r\n".encode()
    return bytes(out), f"multipart/form-data; boundary={boundary}"


def call_openai_edit(photo_bytes, photo_ext, prompt, *, api_key, model, size, quality,
                     base_url="https://api.openai.com/v1", timeout=300):
    body, content_type = _multipart(
        {"model": model, "prompt": prompt, "size": size, "quality": quality, "n": "1"},
        "image", f"photo.{photo_ext}", photo_bytes, mime_for(photo_ext),
    )
    req = urllib.request.Request(
        base_url.rstrip("/") + "/images/edits",
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": content_type},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    item = (payload.get("data") or [{}])[0]
    if item.get("b64_json"):
        return base64.b64decode(item["b64_json"])
    if item.get("url"):
        with urllib.request.urlopen(item["url"], timeout=timeout) as r2:
            return r2.read()
    raise RuntimeError("OpenAI response had neither b64_json nor url")


def generate(*, photo_bytes, photo_ext, campaign, theme, sub, config):
    """Returns (image_bytes, status, error).

    status is "done" for a real generation and "fallback_mock" whenever we had
    to substitute the placeholder poster.
    """
    provider = (config.get("IMAGE_PROVIDER") or "mock").lower()
    api_key = config.get("OPENAI_API_KEY") or ""

    def mock(err=""):
        img = mockimage.make_poster(
            campaign_title=campaign.get("title", ""),
            student_name=sub.get("student_name", ""),
            theme_id=theme.get("id", "mock"),
            theme_name=theme.get("name", ""),
            learnings=sub.get("learnings") or [],
            commitments=sub.get("commitments") or [],
            sub_id=sub.get("id", ""),
        )
        return img, ("done" if not err else "fallback_mock"), err

    if provider == "mock":
        return mock("")
    if not api_key:
        return mock("ไม่พบ OPENAI_API_KEY จึงใช้รูป mock แทน")

    prompt = build_prompt(campaign.get("title", ""), theme.get("prompt", ""),
                          sub.get("student_name", ""), sub.get("learnings"),
                          sub.get("commitments"))
    try:
        img = call_openai_edit(
            photo_bytes, photo_ext, prompt,
            api_key=api_key,
            model=config.get("IMAGE_MODEL") or "gpt-image-2",
            size=config.get("IMAGE_SIZE") or "1024x1536",
            quality=config.get("IMAGE_QUALITY") or "medium",
            base_url=config.get("OPENAI_BASE_URL") or "https://api.openai.com/v1",
        )
        if not img or len(img) < 512:
            return mock("OpenAI ส่งไฟล์กลับมาว่างเปล่า")
        return img, "done", ""
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8")[:400]
        except Exception:
            pass
        return mock(f"OpenAI HTTP {e.code}: {detail}")
    except Exception as e:  # network, timeout, bad JSON -- never fatal
        return mock(f"{type(e).__name__}: {e}")
