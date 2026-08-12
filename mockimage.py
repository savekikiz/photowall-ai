"""Dependency-free PNG poster generator used when IMAGE_PROVIDER=mock
(or when a real image call fails).  No Pillow, no wheels to install --
just zlib and struct from the standard library.
"""

import hashlib
import struct
import zlib

# A 5x7 pixel font, enough for the ASCII labels we stamp on the mock poster.
FONT = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    "_": ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
    ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
    ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
    "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
    "#": ["01010", "11111", "01010", "01010", "01010", "11111", "01010"],
    "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
    "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
    " ": ["00000"] * 7,
}


class Canvas:
    def __init__(self, w, h, bg=(20, 22, 34)):
        self.w, self.h = w, h
        self.px = bytearray(bg * (w * h))

    def set(self, x, y, rgb):
        if 0 <= x < self.w and 0 <= y < self.h:
            i = (y * self.w + x) * 3
            self.px[i:i + 3] = bytes(rgb)

    def rect(self, x, y, w, h, rgb, alpha=1.0):
        for yy in range(max(0, y), min(self.h, y + h)):
            base = yy * self.w
            for xx in range(max(0, x), min(self.w, x + w)):
                i = (base + xx) * 3
                if alpha >= 1.0:
                    self.px[i:i + 3] = bytes(rgb)
                else:
                    for k in range(3):
                        self.px[i + k] = int(self.px[i + k] * (1 - alpha) + rgb[k] * alpha)

    def disc(self, cx, cy, r, rgb):
        for yy in range(max(0, cy - r), min(self.h, cy + r + 1)):
            dy = yy - cy
            for xx in range(max(0, cx - r), min(self.w, cx + r + 1)):
                if (xx - cx) ** 2 + dy * dy <= r * r:
                    self.set(xx, yy, rgb)

    def text(self, x, y, s, rgb, scale=3):
        cx = x
        for ch in s.upper():
            glyph = FONT.get(ch)
            if glyph is None:
                glyph = FONT["?"] if ch.strip() else FONT[" "]
            for ry, row in enumerate(glyph):
                for rxi, bit in enumerate(row):
                    if bit == "1":
                        self.rect(cx + rxi * scale, y + ry * scale, scale, scale, rgb)
            cx += (len(glyph[0]) + 1) * scale
        return cx

    def png(self):
        raw = bytearray()
        stride = self.w * 3
        for y in range(self.h):
            raw.append(0)  # filter type: none
            raw += self.px[y * stride:(y + 1) * stride]
        return _png_bytes(self.w, self.h, bytes(raw))


def _chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def _png_bytes(w, h, raw):
    header = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n"
            + _chunk(b"IHDR", header)
            + _chunk(b"IDAT", zlib.compress(raw, 6))
            + _chunk(b"IEND", b""))


def _palette(seed: str):
    h = hashlib.sha256(seed.encode("utf-8")).digest()
    top = (30 + h[0] % 90, 20 + h[1] % 70, 60 + h[2] % 120)
    bottom = (10 + h[3] % 40, 10 + h[4] % 40, 25 + h[5] % 60)
    accent = (120 + h[6] % 135, 80 + h[7] % 175, 120 + h[8] % 135)
    return top, bottom, accent


def make_poster(width=768, height=1024, *, campaign_title="", student_name="",
                theme_id="mock", theme_name="", learnings=(), commitments=(),
                sub_id=""):
    """A vertical 3:4 placeholder poster.  Latin labels are rendered as text;
    Thai/free text is represented as note-card bars (the 5x7 font is ASCII)."""
    top, bottom, accent = _palette(theme_id or "mock")
    c = Canvas(width, height)

    # vertical gradient
    for y in range(height):
        t = y / max(1, height - 1)
        row = tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(3))
        c.rect(0, y, width, 1, row)

    # accent glow behind the portrait slot
    c.disc(width // 2, int(height * 0.30), int(width * 0.30), tuple(min(255, v) for v in accent))
    c.disc(width // 2, int(height * 0.30), int(width * 0.26),
           tuple(int(v * 0.45) for v in accent))

    # frame
    border = (245, 245, 250)
    c.rect(24, 24, width - 48, 4, border)
    c.rect(24, height - 28, width - 48, 4, border)
    c.rect(24, 24, 4, height - 52, border)
    c.rect(width - 28, 24, 4, height - 52, border)

    c.text(56, 60, "PHOTOWALL MOCK POSTER", (240, 240, 250), scale=3)
    c.text(56, 96, "THEME: " + _ascii(theme_id)[:22], (230, 230, 240), scale=2)

    # portrait slot
    slot_w, slot_h = int(width * 0.46), int(width * 0.46)
    sx, sy = (width - slot_w) // 2, int(height * 0.30) - slot_h // 2
    c.rect(sx, sy, slot_w, slot_h, (250, 250, 255), alpha=0.16)
    c.rect(sx, sy, slot_w, 3, border)
    c.rect(sx, sy + slot_h - 3, slot_w, 3, border)
    c.rect(sx, sy, 3, slot_h, border)
    c.rect(sx + slot_w - 3, sy, 3, slot_h, border)
    c.disc(width // 2, sy + slot_h // 2 - 20, 34, (250, 250, 255))
    c.rect(width // 2 - 55, sy + slot_h // 2 + 20, 110, 60, (250, 250, 255))
    c.text(sx + 10, sy + slot_h + 14, "YOUR PHOTO", (235, 235, 245), scale=2)

    y = int(height * 0.50)
    c.text(56, y, "LEARNED", accent, scale=3)
    y = _cards(c, y + 40, width, len(learnings) or 1, (255, 255, 255))
    y += 18
    c.text(56, y, "WILL DO NEXT", accent, scale=3)
    y = _cards(c, y + 40, width, len(commitments) or 1, accent)

    footer = _ascii(campaign_title) or "CAMPAIGN"
    c.text(56, height - 120, footer[:26], (235, 235, 245), scale=2)
    who = _ascii(student_name) or "ANONYMOUS LEARNER"
    c.text(56, height - 96, who[:26], (215, 215, 230), scale=2)
    c.text(56, height - 66, _ascii(sub_id)[:26], (170, 175, 200), scale=2)
    return c.png()


def _cards(c, y, width, count, bar_rgb):
    count = max(1, min(4, count))
    for i in range(count):
        h = 46
        c.rect(56, y, width - 112, h, (255, 255, 255), alpha=0.14)
        c.rect(56, y, 6, h, bar_rgb)
        c.rect(78, y + 14, int((width - 190) * (0.9 - 0.13 * i)), 6, (255, 255, 255))
        c.rect(78, y + 28, int((width - 190) * (0.6 - 0.09 * i)), 6, (210, 210, 225))
        y += h + 12
    return y


def _ascii(s):
    return "".join(ch for ch in (s or "") if ch.upper() in FONT).strip()
