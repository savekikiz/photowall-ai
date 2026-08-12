# PhotoWall AI Build Spec

> **วิธีใช้ไฟล์นี้:** เปิด AI ที่เขียนโค้ดได้ (Claude Code, Cursor, Codex) แล้วแนบไฟล์นี้เข้าไป พิมพ์สั่งว่า "อ่านไฟล์นี้ทั้งหมด แล้วสร้างระบบ PhotoWall ตามสเปกให้ครบ ทดสอบจริงก่อนสรุปผล"
>
> คุณไม่ต้องอ่านไฟล์นี้ให้เข้าใจทั้งหมด ไฟล์นี้เขียนไว้ให้ AI อ่าน

---

## 1) สร้างอะไร

เว็บสำหรับกิจกรรมปิดคลาส ผู้เข้าร่วมสแกน QR แล้ว:

1. อัปรูปตัวเอง
2. เขียนว่าได้เรียนรู้อะไร
3. เขียนว่าจะเอาไปทำอะไรต่อ
4. เลือกธีมภาพ
5. กดปุ่มเดียว AI สร้างโปสเตอร์แนวตั้ง 3:4 ให้

รูปของทุกคนไปรวมกันบนจอใหญ่ที่ฉายหน้าห้อง อัปเดตเองเรื่อยๆ

**หน้าที่ต้องมี 4 หน้า**

| หน้า | ลิงก์ | ใช้ทำอะไร |
|---|---|---|
| ผู้เข้าร่วม | `/c/<ชื่องาน>` | อัปรูป ตอบคำถาม สร้างภาพ |
| รวมภาพ | `/c/<ชื่องาน>#gallery` | ดูภาพเพื่อนในงาน |
| จอใหญ่ | `/wall.html?c=<ชื่องาน>` | ฉายโปรเจกเตอร์ รีเฟรชเอง |
| หลังบ้าน | `/admin` | สร้างงานใหม่ |

---

## 2) กฎเหล็ก 2 ข้อ

**ข้อ 1: ไม่ใช้ฐานข้อมูล เก็บเป็นไฟล์ JSON ไฟล์เดียว**

ห้ามใช้ SQLite, Postgres, MySQL หรือฐานข้อมูลใดๆ ทั้งสิ้น
งานขนาดนี้ไม่ต้องใช้ และการมีฐานข้อมูลทำให้คนติดตั้งไม่เป็น

**ข้อ 2: ต้องทำงานได้จริง ไม่ใช่แค่เขียนโค้ดเสร็จ**

ต้องรันเอง ทดสอบเอง แล้วรายงานผลจริงที่รันได้ (ดูข้อ 8)

---

## 3) เก็บข้อมูลยังไง

เก็บทุกอย่างในไฟล์เดียว `data/db.json`

```json
{
  "campaigns": [
    {
      "slug": "workshop-12",
      "title": "AI Workshop รุ่น 12",
      "description": "",
      "created_at": "2026-08-07T10:00:00Z"
    }
  ],
  "submissions": [
    {
      "id": "sub_a1b2c3",
      "campaign_slug": "workshop-12",
      "student_name": "ทอม",
      "learnings": ["เข้าใจ agent workflow"],
      "commitments": ["ทำ dashboard ทีม"],
      "theme_id": "street-flash",
      "image_path": "generated/sub_a1b2c3.png",
      "photo_path": "uploads/sub_a1b2c3.jpg",
      "status": "done",
      "error": "",
      "created_at": "2026-08-07T10:05:00Z"
    }
  ]
}
```

### สิ่งที่ AI ต้องทำให้ครบ ไม่งั้นข้อมูลหายจริง

ตอนคนกดส่งพร้อมกันหลายคน ถ้าเขียนไฟล์แบบธรรมดา ข้อมูลของบางคนจะหาย
ต้องทำ 3 อย่างนี้:

**1. เขียนแบบ atomic** เขียนลงไฟล์ชั่วคราวก่อน แล้วค่อยสลับทับไฟล์จริง

```python
import json, os, tempfile

def save_db(data, path):
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
```

**2. ใส่ lock** ครอบทุกครั้งที่ อ่าน แก้ เขียน

```python
import threading
DB_LOCK = threading.Lock()

def add_submission(sub):
    with DB_LOCK:
        db = load_db()
        db["submissions"].append(sub)
        save_db(db, DB_PATH)
```

**3. ห้ามเก็บรูปเป็น base64 ใน JSON** เก็บรูปเป็นไฟล์แยก แล้วเก็บแค่ path

ถ้าไฟล์ยังไม่มี ให้สร้าง `{"campaigns": [], "submissions": []}` อัตโนมัติ

---

## 4) เอาขึ้น Netlify (เป้าหมายหลัก)

ผู้ใช้ส่วนใหญ่จะ deploy บน Netlify **AI ต้องจัดการ 2 เรื่องนี้ให้เอง โดยไม่ให้ผู้ใช้ต้องรู้เรื่อง**

### เรื่องที่ 1: ไฟล์ที่เขียนบน Netlify จะหาย

Netlify ไม่ได้รันเซิร์ฟเวอร์ค้างไว้ ไฟล์ที่เขียนตอนรันหายทันทีที่ฟังก์ชันจบ
`db.json` และรูปทั้งหมดจะหาย

**วิธีแก้: ใช้ Netlify Blobs แทนการเขียนไฟล์**

Netlify Blobs เก็บได้ทั้ง JSON และไฟล์รูป อยู่ข้ามการ deploy ใช้ฟรีในตัว Netlify เอง ไม่ต้องสมัครบริการเพิ่ม

```javascript
import { getStore } from "@netlify/blobs";

const db = getStore("photowall");

// เก็บข้อมูล
await db.setJSON("data", { campaigns: [...], submissions: [...] });

// อ่านข้อมูล
const data = (await db.getJSON("data")) ?? { campaigns: [], submissions: [] };

// เก็บไฟล์รูป
await db.set(`generated/${id}.png`, imageBuffer);
```

### เรื่องที่ 2: สร้างรูปใช้เวลานานเกินที่ Netlify ยอม

ฟังก์ชันธรรมดาบน Netlify **หยุดเองที่ 10 วินาที** แต่สร้างรูป 1 ใบใช้ **30 ถึง 120 วินาที**
ถ้าทำตรงๆ จะ timeout ทุกครั้ง ไม่มีทางสำเร็จ

**วิธีแก้: ใช้ Background Function + ให้หน้าเว็บคอยถามสถานะ**

Background Function รันได้ถึง 15 นาที แต่มันตอบกลับทันทีโดยไม่รอผล ดังนั้นต้องเปลี่ยน flow เป็น:

1. ผู้ใช้กดสร้าง → บันทึก submission ด้วย `status: "processing"` → ตอบ id กลับไปทันที
2. Background function สร้างรูปอยู่เบื้องหลัง เสร็จแล้วอัปเดตเป็น `status: "done"` พร้อม imageUrl
3. หน้าเว็บถามสถานะทุก 3 วินาที (`GET /api/submissions/<id>`) จนได้ `done` แล้วค่อยโชว์รูป
4. ระหว่างรอ แสดง loading พร้อมข้อความว่าใช้เวลา 30 ถึง 120 วินาที

**ตั้งชื่อไฟล์ให้ลงท้ายด้วย `-background`** เช่น `netlify/functions/generate-background.mts`
Netlify ดูจากชื่อไฟล์ว่าอันไหนเป็น background function

### ถ้าผู้ใช้ไม่ได้ใช้ Netlify

รองรับการรันเป็นเซิร์ฟเวอร์ธรรมดาด้วย (Docker หรือ `python3 server.py`)
กรณีนี้เก็บเป็นไฟล์ `data/db.json` ตามข้อ 3 ได้เลย ไม่ต้องใช้ Blobs

**สำคัญ:** แยกส่วนเก็บข้อมูลเป็นฟังก์ชันกลาง เช่น `load_db()` `save_db()` `add_submission()` `list_submissions()`
ส่วนอื่นเรียกผ่านฟังก์ชันพวกนี้เท่านั้น ห้ามยิงเข้าไฟล์หรือ Blobs ตรงๆ
เวลาสลับระหว่าง Netlify กับเซิร์ฟเวอร์ธรรมดา จะแก้แค่ข้างในฟังก์ชัน

---

## 5) ค่าที่ต้องตั้ง

```bash
PUBLIC_BASE_URL=https://your-site.netlify.app
ADMIN_TOKEN=ตั้งรหัสเดายาก
OPENAI_API_KEY=sk-...
IMAGE_PROVIDER=openai        # openai หรือ mock
IMAGE_MODEL=gpt-image-2
IMAGE_SIZE=1024x1536
IMAGE_QUALITY=medium
```

- ถ้า `IMAGE_PROVIDER=mock` ให้สร้างรูปปลอมทันที ใช้ทดสอบโดยไม่เสียเครดิต
- ถ้าไม่มี `OPENAI_API_KEY` ให้ fallback เป็น mock แล้วบันทึก error ไว้ ห้ามทำให้ระบบพัง
- `/healthz` ต้องบอกได้ว่ามี key หรือไม่

---

## 6) ธีมภาพ (อย่างน้อย 6 อัน)

```json
[
  {
    "id": "cinematic-graduation",
    "name": "Cinematic Graduation",
    "tagline": "โปสเตอร์จบคลาสแบบเท่ มีพลัง และน่าภูมิใจ",
    "prompt": "cinematic celebratory portrait poster, direct flash, colorful confetti, warm classroom energy, premium editorial poster, inspirational but realistic"
  },
  {
    "id": "future-agent-lab",
    "name": "Future Agent Lab",
    "tagline": "ห้องแล็บ AI ล้ำๆ เหมาะกับสายเทค",
    "prompt": "futuristic AI agent command center, glowing dashboards, friendly robots as assistants, neon blue magenta, optimistic tech lab, high detail"
  },
  {
    "id": "retro-90s-tech",
    "name": "90s Retro Tech",
    "tagline": "กลิ่นอายคอมพิวเตอร์ยุค 90s สนุกและจำง่าย",
    "prompt": "90s retro cartoon tech poster, CRT computers, floppy disks, fax machine, saturated colors, nostalgic playful caricature style, crisp Thai-friendly layout area"
  },
  {
    "id": "street-flash",
    "name": "Street Flash",
    "tagline": "ภาพจริงใจแบบสตรีท มีแฟลช สีสด",
    "prompt": "candid street photography look, direct flash, saturated colors, documentary realism, energetic workshop vibe"
  },
  {
    "id": "thai-inspiration",
    "name": "Thai Inspiration",
    "tagline": "อบอุ่น ภูมิใจ เหมาะกับภาพสรุป commitment",
    "prompt": "warm Thai workshop celebration poster, elegant modern Thai visual motifs, soft golden light, meaningful milestone, premium inspirational learning certificate vibe"
  },
  {
    "id": "maker-sticker-wall",
    "name": "Maker Sticker Wall",
    "tagline": "เหมือนบอร์ดไอเดีย สำหรับคนลงมือทำจริง",
    "prompt": "creative maker wall full of stickers, notes, flowcharts, AI agents doing tasks, playful startup energy, colorful collage poster, clean focal composition"
  }
]
```

---

## 7) การสร้างภาพ

### Prompt ที่ใช้

```text
Create a vertical 3:4 commemorative closing-class poster for a workshop campaign named "{campaign_title}".
Style direction: {theme_prompt}.
Learner name: {student_name_or_anonymous}

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

Mood: inspiring, celebratory, practical, warm, high-impact.
```

### ฝั่งหน้าเว็บ

- ย่อรูปก่อนส่ง ด้านยาวสุดประมาณ 1600px คุณภาพ 0.88
- ส่งเป็น data URL ในชื่อ `photoData`

### ฝั่งเซิร์ฟเวอร์

- ตรวจว่ามีรูปจริง รับเฉพาะ png, jpeg, jpg, webp
- ปฏิเสธไฟล์เล็กกว่า 1KB หรือใหญ่กว่า 12MB
- **ต้องตรวจฝั่งเซิร์ฟเวอร์ด้วย** ไม่ใช่ตรวจแค่หน้าเว็บ เพราะคนยิงเข้า API ตรงได้

### เรียก OpenAI

ใช้ image edit endpoint แบบ multipart form:

- `POST https://api.openai.com/v1/images/edits`
- Header: `Authorization: Bearer $OPENAI_API_KEY`
- Fields: `model`, `prompt`, `size`, `quality`, `n=1`
- File field ชื่อ `image` คือรูปที่ผู้ใช้อัป

รองรับ response ทั้ง `data[0].b64_json` และ `data[0].url`

**ถ้าเรียกไม่สำเร็จ** ห้ามให้ทั้ง submission พัง ให้ใช้รูป mock แทน ตั้ง `status: "fallback_mock"` แล้วเก็บ error ไว้

---

## 8) ต้องทดสอบจริงก่อนบอกว่าเสร็จ

รันแล้วแนบผลจริงมาด้วย ห้ามบอกว่าผ่านถ้ายังไม่ได้รัน

1. เปิดเซิร์ฟเวอร์ด้วย `IMAGE_PROVIDER=mock`
2. `/healthz` ต้องได้ 200
3. สร้างงานใหม่ผ่านหน้า admin ด้วย token
4. ส่ง submission **โดยไม่มีรูป** ต้องได้ 400
5. ส่ง submission **พร้อมรูป** ต้องได้ 201 พร้อม id
6. ถามสถานะจนได้ `done` แล้วต้องมี imageUrl
7. เปิด URL รูปนั้น ต้องได้ 200 และเป็นไฟล์รูปจริง
8. **ปิดแล้วเปิดใหม่ ข้อมูลต้องยังอยู่ครบ**
9. ถ้า deploy Netlify: ทดสอบว่าสร้างรูปเสร็จจริงและข้อมูลไม่หายหลัง deploy ใหม่

---

## 9) เช็คก่อนส่งมอบ

- [ ] 4 หน้าเปิดได้ครบ
- [ ] สร้างงานใหม่ได้ในหน้า admin
- [ ] ไม่มีรูปแล้วไปต่อไม่ได้ ทั้งหน้าเว็บและเซิร์ฟเวอร์
- [ ] สร้างภาพได้จริงในโหมด mock
- [ ] หน้ารวมภาพเห็นรูป
- [ ] จอใหญ่รีเฟรชเอง
- [ ] ปิดเปิดใหม่ข้อมูลไม่หาย
- [ ] ถ้าใช้ Netlify: ข้อมูลอยู่ใน Blobs และสร้างรูปเสร็จจริงโดยไม่ timeout
- [ ] มี README บอกวิธีติดตั้งแบบคนไม่เขียนโค้ดอ่านรู้เรื่อง

---

## 10) ความปลอดภัยขั้นต่ำ

- หน้า admin ต้องมี token ป้องกัน ส่งผ่าน header `X-Admin-Token`
- ห้าม hardcode token หรือ API key ลงในหน้าเว็บ
- ห้าม commit ไฟล์ `.env`
- รูปในหน้ารวมและจอใหญ่ ใครมีลิงก์ก็เห็นได้ **ต้องบอกผู้เข้าร่วมให้ชัดก่อนเริ่ม**
- ใช้ id แบบสุ่มสำหรับ submission

`.gitignore`:

```gitignore
.env
data/
__pycache__/
*.pyc
.DS_Store
```

---

## 11) รายงานตอนเสร็จ

1. ไฟล์ที่สร้าง
2. วิธีรันบนเครื่องตัวเอง
3. วิธีเอาขึ้น Netlify แบบทีละขั้น เขียนให้คนไม่เขียนโค้ดทำตามได้
4. ค่าที่ต้องตั้ง และตั้งตรงไหน
5. ลิงก์ที่ต้องเปิด
6. ผลทดสอบจริงตามข้อ 8
7. อะไรที่ยังทำไม่ได้หรือมีข้อจำกัด
