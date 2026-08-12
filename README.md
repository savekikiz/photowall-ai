# PhotoWall AI 📸

เว็บสำหรับกิจกรรมปิดคลาส: ผู้เข้าร่วมสแกน QR → อัปรูปตัวเอง → เขียนว่าได้เรียนรู้อะไรและจะเอาไปทำอะไรต่อ
→ เลือกธีม → กดปุ่มเดียว AI สร้างโปสเตอร์แนวตั้ง 3:4 ให้ → ทุกภาพขึ้นจอใหญ่หน้าห้องเอง

**ไม่ใช้ฐานข้อมูล** เก็บทุกอย่างเป็นไฟล์ JSON ไฟล์เดียว (หรือ Netlify Blobs เวลาขึ้น Netlify)
**ไม่ต้องลงไลบรารีอะไรเลย** ถ้ารันบนเครื่องตัวเอง มีแค่ python3 ก็พอ

---

## 4 หน้าที่ใช้งาน

| หน้า | ลิงก์ | ใช้ทำอะไร |
|---|---|---|
| ผู้เข้าร่วม | `/c/<ชื่องาน>` | อัปรูป ตอบคำถาม สร้างภาพ |
| รวมภาพ | `/c/<ชื่องาน>#gallery` | ดูภาพเพื่อนในงาน |
| จอใหญ่ | `/wall.html?c=<ชื่องาน>` | ฉายโปรเจกเตอร์ รีเฟรชเองทุก 8 วินาที |
| หลังบ้าน | `/admin` | สร้างงานใหม่ (ต้องใช้รหัสผู้ดูแล) |

---

## วิธีที่ 1: รันบนเครื่องตัวเอง (ง่ายที่สุด)

ต้องมี **Python 3.9 ขึ้นไป** (macOS กับ Linux มีมาให้อยู่แล้ว)

```bash
cp .env.example .env       # 1. สร้างไฟล์ตั้งค่า
# 2. เปิดไฟล์ .env แล้วแก้ ADMIN_TOKEN เป็นรหัสอะไรก็ได้ที่เดายาก
python3 server.py          # 3. เปิดเซิร์ฟเวอร์
```

เปิดเบราว์เซอร์ไปที่ <http://localhost:8080/admin> → ใส่รหัสผู้ดูแล → สร้างงานใหม่ → ได้ลิงก์ครบ 3 ลิงก์

ค่าเริ่มต้นคือ `IMAGE_PROVIDER=mock` แปลว่าสร้าง **ภาพปลอม** ทันที ไม่เสียเงิน เอาไว้ซ้อมก่อนงานจริง
พอจะใช้จริงค่อยแก้ `.env` เป็น `IMAGE_PROVIDER=openai` และใส่ `OPENAI_API_KEY`

### ให้คนอื่นในห้องเข้าถึงได้
ทุกคนต้องต่อ Wi-Fi วงเดียวกัน แล้วใช้ IP ของเครื่องคุณแทน localhost เช่น `http://192.168.1.20:8080/c/workshop-12`
(หา IP: macOS `ipconfig getifaddr en0`)

### Docker (ถ้าถนัด)
```bash
cp .env.example .env
docker compose up --build
```

---

## วิธีที่ 2: เอาขึ้น Netlify (แนะนำถ้าคนเข้าเยอะ / อยู่คนละที่)

ทำตามทีละขั้น ไม่ต้องเขียนโค้ด

1. **เอาโค้ดขึ้น GitHub** — สร้าง repository ใหม่ แล้วอัปโหลดโฟลเดอร์นี้ทั้งหมด
   (อย่าอัป `.env` กับโฟลเดอร์ `data/` — ไฟล์ `.gitignore` กันไว้ให้แล้ว)
2. **สมัคร/เข้า [netlify.com](https://netlify.com)** → กด **Add new site** → **Import an existing project** → เลือก GitHub → เลือก repo ที่เพิ่งสร้าง
3. หน้า build settings **ไม่ต้องแก้อะไร** (ไฟล์ `netlify.toml` ตั้งค่าไว้ให้หมดแล้ว) → กด **Deploy**
4. **ใส่ค่าตั้งต้น** — ไปที่ **Site configuration → Environment variables → Add a variable** แล้วใส่ทีละตัว:

   | Key | Value |
   |---|---|
   | `ADMIN_TOKEN` | รหัสเดายากที่คุณตั้งเอง |
   | `IMAGE_PROVIDER` | `mock` ตอนทดสอบ / `openai` ตอนใช้จริง |
   | `OPENAI_API_KEY` | `sk-...` (ใส่เฉพาะตอนใช้จริง) |
   | `IMAGE_MODEL` | `gpt-image-2` |
   | `IMAGE_SIZE` | `1024x1536` |
   | `IMAGE_QUALITY` | `medium` |
   | `PUBLIC_BASE_URL` | URL ของเว็บคุณ เช่น `https://ชื่อเว็บ.netlify.app` |

5. กด **Deploys → Trigger deploy → Deploy site** อีกครั้ง เพื่อให้ค่าใหม่มีผล
6. เปิด `https://ชื่อเว็บ.netlify.app/healthz` ต้องเห็น `"ok": true` และ `"has_openai_key": true`
7. เปิด `/admin` ใส่รหัสผู้ดูแล → สร้างงาน → เอาลิงก์ `/c/<ชื่องาน>` ไปทำ QR (เช่นที่ qr-code-generator.com)

**Netlify Blobs เปิดใช้อัตโนมัติ** ไม่ต้องสมัครบริการเพิ่ม ไม่ต้องตั้งค่าอะไร ข้อมูลกับรูปอยู่ข้าม deploy

---

## ค่าที่ต้องตั้ง (ตั้งที่ไหน)

| ค่า | รันเอง = ไฟล์ `.env` | Netlify = Environment variables |
|---|---|---|
| `ADMIN_TOKEN` | **จำเป็น** รหัสเข้าหน้า `/admin` | **จำเป็น** |
| `IMAGE_PROVIDER` | `mock` หรือ `openai` | เหมือนกัน |
| `OPENAI_API_KEY` | ใส่เมื่อใช้ `openai` | เหมือนกัน |
| `IMAGE_MODEL` / `IMAGE_SIZE` / `IMAGE_QUALITY` | `gpt-image-2` / `1024x1536` / `medium` | เหมือนกัน |
| `PUBLIC_BASE_URL` | ไม่จำเป็น | **ควรใส่** URL เว็บจริง |
| `PORT` | ค่าเริ่มต้น 8080 | ไม่ต้องใส่ |

ถ้าไม่มี `OPENAI_API_KEY` ระบบ **ไม่พัง** — จะสร้างภาพสำรองให้ แล้วบันทึกสาเหตุไว้ในสถานะ `fallback_mock`

---

## ระบบทำงานยังไง (สั้นๆ)

สร้างภาพ 1 ใบใช้เวลา 30–120 วินาที ซึ่งนานกว่าที่ Netlify ยอมให้ฟังก์ชันปกติทำงาน (10 วินาที) ระบบจึงแยกเป็น 2 จังหวะ:

1. กดส่ง → บันทึกทันทีเป็น `status: "processing"` → ตอบ `id` กลับไปเลย (เร็วมาก)
2. Background function (`netlify/functions/generate-background.mts` — รันได้ถึง 15 นาที) สร้างภาพอยู่เบื้องหลัง
3. หน้าเว็บถาม `GET /api/submissions/<id>` ทุก 3 วินาที จนได้ `done` แล้วค่อยโชว์ภาพ

บนเครื่องตัวเองก็ทำแบบเดียวกัน แค่เปลี่ยนจาก background function เป็น thread

---

## ไฟล์ในโปรเจกต์

```
server.py               เซิร์ฟเวอร์สำหรับรันเอง/Docker (ไม่ใช้ไลบรารีนอก)
storage.py              จุดเดียวที่แตะข้อมูล: load_db / save_db / add_submission / list_submissions
                        เขียนแบบ atomic (temp file + os.replace) และมี lock กันข้อมูลหายตอนคนกดพร้อมกัน
imagegen.py             ตรวจรูปฝั่งเซิร์ฟเวอร์ + สร้าง prompt + เรียก OpenAI images/edits
mockimage.py            สร้าง PNG โปสเตอร์ปลอม (โหมด mock) ด้วย stdlib ล้วน ไม่ต้องลง Pillow
themes.json             ธีมภาพ 6 อัน (แหล่งความจริงเดียว)
public/                 หน้าเว็บทั้ง 4 หน้า (index / c / wall / admin) + app.css
netlify/functions/      api.mts (ตอบเร็ว) และ generate-background.mts (สร้างภาพ ≤15 นาที)
netlify/lib/            storage.mjs (Netlify Blobs) / core.mjs / mockimage.mjs / themes.mjs
netlify.toml            ตั้งค่า Netlify ให้เสร็จสรรพ
tests/                  ชุดทดสอบ (ดูหัวข้อถัดไป)
data/                   ข้อมูลจริงตอนรันเอง — db.json + รูป (ไม่ขึ้น git)
```

แก้ธีมที่ `themes.json` แล้วรัน `node scripts/sync-themes.mjs` เพื่อ sync ให้ฝั่ง Netlify

---

## ทดสอบเอง

```bash
# 1) เซิร์ฟเวอร์ที่รันเอง (เปิด server.py ค้างไว้ก่อน)
ADMIN_TOKEN=test-token-123 IMAGE_PROVIDER=mock PORT=8091 python3 server.py &
ADMIN_TOKEN=test-token-123 PORT=8091 bash tests/local.sh

# 2) โค้ดฝั่ง Netlify (จำลอง Blobs ในหน่วยความจำ)
npm install && npm run test:netlify

# 3) เส้นทางเรียก OpenAI จริง โดยไม่เสียเครดิต (ใช้ stub แทน api.openai.com)
python3 tests/openai_stub.py &
python3 tests/provider_openai.py && node tests/provider_openai.mjs

# 4) ทดสอบหน้าเว็บจริงด้วย Chrome (กดปุ่ม อัปรูป รอภาพ ดูจอใหญ่) — ไม่ต้องลง puppeteer
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/pw-chrome &
SP=/tmp BASE=http://localhost:8091 ADMIN_TOKEN=test-token-123 node tests/browser.mjs
# ภาพหน้าจอแต่ละขั้นจะถูกบันทึกไว้ใน $SP
```

---

## ความปลอดภัย / สิ่งที่ต้องบอกผู้เข้าร่วม

- หน้า `/admin` ป้องกันด้วย `ADMIN_TOKEN` ส่งผ่าน header `X-Admin-Token` — ไม่มี token ในหน้าเว็บ
- API key อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น ไม่เคยส่งลงเบราว์เซอร์
- **ภาพในหน้ารวมและจอใหญ่ ใครมีลิงก์ก็เห็นได้** ต้องบอกผู้เข้าร่วมให้ชัดก่อนเริ่ม (หน้าเว็บมีข้อความเตือนอยู่แล้ว)
- id ของ submission เป็นเลขสุ่ม เดาไม่ได้
- อย่า commit ไฟล์ `.env`

## ข้อจำกัดที่ควรรู้

- ภาพโหมด mock เขียนตัวอักษรได้เฉพาะ A–Z 0–9 (ฟอนต์ในตัว 5×7) ชื่อภาษาไทยจะขึ้นเป็น `ANONYMOUS LEARNER` — เป็นแค่ภาพซ้อม ไม่กระทบโหมดใช้จริง
- ยังไม่มีปุ่มลบภาพ/ลบงานในหน้า admin (ลบเองได้ที่ `data/db.json` ตอนรันเอง)
- ยังไม่ได้สร้าง QR ให้ในตัว — ก๊อบลิงก์จากหน้า admin ไปสร้าง QR ที่ไหนก็ได้
- หน้าจอใหญ่โชว์ 24 ภาพล่าสุด
