// Auto-generated companion of mockimage.py -- keep the two in sync.
// Pure-Node PNG poster used when IMAGE_PROVIDER=mock or a real call fails.
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";

const FONT = {"A": ["01110","10001","10001","11111","10001","10001","10001"],"B": ["11110","10001","10001","11110","10001","10001","11110"],"C": ["01110","10001","10000","10000","10000","10001","01110"],"D": ["11110","10001","10001","10001","10001","10001","11110"],"E": ["11111","10000","10000","11110","10000","10000","11111"],"F": ["11111","10000","10000","11110","10000","10000","10000"],"G": ["01110","10001","10000","10111","10001","10001","01111"],"H": ["10001","10001","10001","11111","10001","10001","10001"],"I": ["11111","00100","00100","00100","00100","00100","11111"],"J": ["00111","00010","00010","00010","00010","10010","01100"],"K": ["10001","10010","10100","11000","10100","10010","10001"],"L": ["10000","10000","10000","10000","10000","10000","11111"],"M": ["10001","11011","10101","10101","10001","10001","10001"],"N": ["10001","11001","10101","10011","10001","10001","10001"],"O": ["01110","10001","10001","10001","10001","10001","01110"],"P": ["11110","10001","10001","11110","10000","10000","10000"],"Q": ["01110","10001","10001","10001","10101","10010","01101"],"R": ["11110","10001","10001","11110","10100","10010","10001"],"S": ["01111","10000","10000","01110","00001","00001","11110"],"T": ["11111","00100","00100","00100","00100","00100","00100"],"U": ["10001","10001","10001","10001","10001","10001","01110"],"V": ["10001","10001","10001","10001","10001","01010","00100"],"W": ["10001","10001","10001","10101","10101","11011","10001"],"X": ["10001","10001","01010","00100","01010","10001","10001"],"Y": ["10001","10001","01010","00100","00100","00100","00100"],"Z": ["11111","00001","00010","00100","01000","10000","11111"],"0": ["01110","10001","10011","10101","11001","10001","01110"],"1": ["00100","01100","00100","00100","00100","00100","01110"],"2": ["01110","10001","00001","00010","00100","01000","11111"],"3": ["11111","00010","00100","00010","00001","10001","01110"],"4": ["00010","00110","01010","10010","11111","00010","00010"],"5": ["11111","10000","11110","00001","00001","10001","01110"],"6": ["00110","01000","10000","11110","10001","10001","01110"],"7": ["11111","00001","00010","00100","01000","01000","01000"],"8": ["01110","10001","10001","01110","10001","10001","01110"],"9": ["01110","10001","10001","01111","00001","00010","01100"],"-": ["00000","00000","00000","11111","00000","00000","00000"],"_": ["00000","00000","00000","00000","00000","00000","11111"],".": ["00000","00000","00000","00000","00000","01100","01100"],":": ["00000","01100","01100","00000","01100","01100","00000"],"/": ["00001","00010","00010","00100","01000","01000","10000"],"#": ["01010","11111","01010","01010","01010","11111","01010"],"!": ["00100","00100","00100","00100","00100","00000","00100"],"?": ["01110","10001","00001","00110","00100","00000","00100"]," ": ["00000","00000","00000","00000","00000","00000","00000"]};

class Canvas {
  constructor(w, h, bg = [20, 22, 34]) {
    this.w = w; this.h = h;
    this.px = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) { this.px[i*3] = bg[0]; this.px[i*3+1] = bg[1]; this.px[i*3+2] = bg[2]; }
  }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.px[i] = c[0]; this.px[i+1] = c[1]; this.px[i+2] = c[2];
  }
  rect(x, y, w, h, c, alpha = 1) {
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++)
      for (let xx = Math.max(0, x); xx < Math.min(this.w, x + w); xx++) {
        const i = (yy * this.w + xx) * 3;
        if (alpha >= 1) { this.px[i] = c[0]; this.px[i+1] = c[1]; this.px[i+2] = c[2]; }
        else for (let k = 0; k < 3; k++) this.px[i+k] = Math.round(this.px[i+k] * (1 - alpha) + c[k] * alpha);
      }
  }
  disc(cx, cy, r, c) {
    for (let yy = Math.max(0, cy - r); yy <= Math.min(this.h - 1, cy + r); yy++) {
      const dy = yy - cy;
      for (let xx = Math.max(0, cx - r); xx <= Math.min(this.w - 1, cx + r); xx++)
        if ((xx - cx) ** 2 + dy * dy <= r * r) this.set(xx, yy, c);
    }
  }
  text(x, y, s, c, scale = 3) {
    let cx = x;
    for (const raw of String(s).toUpperCase()) {
      const glyph = FONT[raw] || (raw.trim() ? FONT["?"] : FONT[" "]);
      glyph.forEach((row, ry) => {
        for (let rxi = 0; rxi < row.length; rxi++)
          if (row[rxi] === "1") this.rect(cx + rxi * scale, y + ry * scale, scale, scale, c);
      });
      cx += (glyph[0].length + 1) * scale;
    }
    return cx;
  }
  png() {
    const stride = this.w * 3;
    const raw = Buffer.alloc((stride + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (stride + 1)] = 0;
      this.px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0); ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(tag, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(tag, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function palette(seed) {
  const h = createHash("sha256").update(String(seed)).digest();
  return {
    top: [30 + h[0] % 90, 20 + h[1] % 70, 60 + h[2] % 120],
    bottom: [10 + h[3] % 40, 10 + h[4] % 40, 25 + h[5] % 60],
    accent: [120 + h[6] % 135, 80 + h[7] % 175, 120 + h[8] % 135],
  };
}

const asciiOnly = (s) => [...(s || "")].filter((ch) => FONT[ch.toUpperCase()] !== undefined).join("").trim();

function cards(c, y, width, count, bar) {
  count = Math.max(1, Math.min(4, count));
  for (let i = 0; i < count; i++) {
    const h = 46;
    c.rect(56, y, width - 112, h, [255, 255, 255], 0.14);
    c.rect(56, y, 6, h, bar);
    c.rect(78, y + 14, Math.round((width - 190) * (0.9 - 0.13 * i)), 6, [255, 255, 255]);
    c.rect(78, y + 28, Math.round((width - 190) * (0.6 - 0.09 * i)), 6, [210, 210, 225]);
    y += h + 12;
  }
  return y;
}

export function makePoster({ width = 768, height = 1024, campaignTitle = "", studentName = "",
                             themeId = "mock", learnings = [], commitments = [], subId = "" } = {}) {
  const { top, bottom, accent } = palette(themeId || "mock");
  const c = new Canvas(width, height);
  for (let y = 0; y < height; y++) {
    const t = y / Math.max(1, height - 1);
    c.rect(0, y, width, 1, [0, 1, 2].map((i) => Math.round(top[i] * (1 - t) + bottom[i] * t)));
  }
  c.disc(width >> 1, Math.round(height * 0.3), Math.round(width * 0.3), accent.map((v) => Math.min(255, v)));
  c.disc(width >> 1, Math.round(height * 0.3), Math.round(width * 0.26), accent.map((v) => Math.round(v * 0.45)));

  const border = [245, 245, 250];
  c.rect(24, 24, width - 48, 4, border);
  c.rect(24, height - 28, width - 48, 4, border);
  c.rect(24, 24, 4, height - 52, border);
  c.rect(width - 28, 24, 4, height - 52, border);

  c.text(56, 60, "PHOTOWALL MOCK POSTER", [240, 240, 250], 3);
  c.text(56, 96, "THEME: " + asciiOnly(themeId).slice(0, 22), [230, 230, 240], 2);

  const slot = Math.round(width * 0.46);
  const sx = (width - slot) >> 1, sy = Math.round(height * 0.3) - (slot >> 1);
  c.rect(sx, sy, slot, slot, [250, 250, 255], 0.16);
  c.rect(sx, sy, slot, 3, border); c.rect(sx, sy + slot - 3, slot, 3, border);
  c.rect(sx, sy, 3, slot, border); c.rect(sx + slot - 3, sy, 3, slot, border);
  c.disc(width >> 1, sy + (slot >> 1) - 20, 34, [250, 250, 255]);
  c.rect((width >> 1) - 55, sy + (slot >> 1) + 20, 110, 60, [250, 250, 255]);
  c.text(sx + 10, sy + slot + 14, "YOUR PHOTO", [235, 235, 245], 2);

  let y = Math.round(height * 0.5);
  c.text(56, y, "LEARNED", accent, 3);
  y = cards(c, y + 40, width, learnings.length || 1, [255, 255, 255]) + 18;
  c.text(56, y, "WILL DO NEXT", accent, 3);
  cards(c, y + 40, width, commitments.length || 1, accent);

  c.text(56, height - 120, (asciiOnly(campaignTitle) || "CAMPAIGN").slice(0, 26), [235, 235, 245], 2);
  c.text(56, height - 96, (asciiOnly(studentName) || "ANONYMOUS LEARNER").slice(0, 26), [215, 215, 230], 2);
  c.text(56, height - 66, asciiOnly(subId).slice(0, 26), [170, 175, 200], 2);
  return c.png();
}
