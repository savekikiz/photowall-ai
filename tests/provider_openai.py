import base64, json, os, sys, time, urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import mockimage, imagegen

photo = mockimage.make_poster(width=300, height=400)
campaign = {"title": "AI Workshop 12"}
theme = {"id": "street-flash", "name": "Street Flash", "prompt": "street"}
sub = {"id": "sub_prov0001", "student_name": "Tom", "learnings": ["a"], "commitments": ["b"]}
failed = 0
def check(n, ok, extra=""):
    global failed
    print(("PASS  " if ok else "FAIL  ") + n + ("  :: " + extra if extra else ""))
    if not ok: failed = 1

base = "http://127.0.0.1:8099"
common = dict(photo_bytes=photo, photo_ext="png", campaign=campaign, theme=theme, sub=sub)

img, status, err = imagegen.generate(config={"IMAGE_PROVIDER": "openai", "OPENAI_API_KEY": "sk-test",
    "OPENAI_BASE_URL": base + "/ok", "IMAGE_MODEL": "gpt-image-2", "IMAGE_SIZE": "1024x1536",
    "IMAGE_QUALITY": "medium"}, **common)
check("openai b64_json response -> real image, status=done",
      status == "done" and not err and img[:8] == b"\x89PNG\r\n\x1a\n", f"{status} {len(img)}B {err}")

img, status, err = imagegen.generate(config={"IMAGE_PROVIDER": "openai", "OPENAI_API_KEY": "sk-test",
    "OPENAI_BASE_URL": base + "/url", "IMAGE_MODEL": "gpt-image-2", "IMAGE_SIZE": "1024x1536",
    "IMAGE_QUALITY": "medium"}, **common)
check("openai url response -> downloaded image, status=done",
      status == "done" and img[:8] == b"\x89PNG\r\n\x1a\n", f"{status} {len(img)}B {err}")

img, status, err = imagegen.generate(config={"IMAGE_PROVIDER": "openai", "OPENAI_API_KEY": "sk-bad",
    "OPENAI_BASE_URL": base + "/fail", "IMAGE_MODEL": "gpt-image-2", "IMAGE_SIZE": "1024x1536",
    "IMAGE_QUALITY": "medium"}, **common)
check("openai HTTP 401 -> fallback_mock + error kept, never fatal",
      status == "fallback_mock" and "401" in err and img[:8] == b"\x89PNG\r\n\x1a\n", f"{status} :: {err[:80]}")

img, status, err = imagegen.generate(config={"IMAGE_PROVIDER": "openai", "OPENAI_API_KEY": "",
    "OPENAI_BASE_URL": base + "/ok"}, **common)
check("provider=openai but no API key -> fallback_mock + error",
      status == "fallback_mock" and "OPENAI_API_KEY" in err, f"{status} :: {err}")

img, status, err = imagegen.generate(config={"IMAGE_PROVIDER": "openai", "OPENAI_API_KEY": "sk-test",
    "OPENAI_BASE_URL": "http://127.0.0.1:1/dead"}, **common)
check("unreachable endpoint -> fallback_mock, submission survives",
      status == "fallback_mock" and img[:8] == b"\x89PNG\r\n\x1a\n", f"{status} :: {err[:60]}")

sys.exit(failed)
