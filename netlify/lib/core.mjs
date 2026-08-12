// Shared logic for the Netlify functions: config, photo validation,
// the poster prompt, and the image call (with mock fallback).
import { THEMES } from "./themes.mjs";
import { makePoster } from "./mockimage.mjs";

export { THEMES };
export const themeById = (id) => THEMES.find((t) => t.id === id) || null;

export const config = () => ({
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || "",
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || "",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  IMAGE_PROVIDER: (process.env.IMAGE_PROVIDER || "mock").toLowerCase(),
  IMAGE_MODEL: process.env.IMAGE_MODEL || "gpt-image-2",
  IMAGE_SIZE: process.env.IMAGE_SIZE || "1024x1536",
  IMAGE_QUALITY: process.env.IMAGE_QUALITY || "medium",
  // only for testing against a stub; leave unset in production
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
});

export const slugify = (v) =>
  (v || "").trim().toLowerCase()
    .replace(/[^a-z0-9฀-๿]+/g, "-")
    .replace(/-+/g, "-").replace(/^-|-$/g, "");

// ------------------------------------------------------------ photo checks
const MIN_BYTES = 1024;
const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/jpg", "image/webp"];

export class PhotoError extends Error {}

/** data URL -> {bytes, ext, mime}. Runs server-side: the browser check alone
 *  is worthless because anyone can POST straight at /api/submissions. */
export function decodePhoto(photoData) {
  if (!photoData || typeof photoData !== "string")
    throw new PhotoError("ต้องแนบรูปถ่าย (photoData) ก่อนจึงจะสร้างภาพได้");
  const m = /^data:([-\w.+/]+);base64,(.+)$/s.exec(photoData.trim());
  if (!m) throw new PhotoError("รูปต้องส่งมาเป็น data URL เช่น data:image/jpeg;base64,...");
  if (!ALLOWED.includes(m[1].toLowerCase()))
    throw new PhotoError("รับเฉพาะไฟล์ png, jpeg, jpg, webp เท่านั้น");
  let bytes;
  try { bytes = Buffer.from(m[2], "base64"); }
  catch { throw new PhotoError("ถอดรหัสรูปไม่สำเร็จ ไฟล์อาจเสียหาย"); }
  if (bytes.length < MIN_BYTES) throw new PhotoError("ไฟล์รูปเล็กเกินไป (ต้องมากกว่า 1KB)");
  if (bytes.length > MAX_BYTES) throw new PhotoError("ไฟล์รูปใหญ่เกินไป (ต้องไม่เกิน 12MB)");
  const ext = sniff(bytes);
  if (!ext) throw new PhotoError("ไฟล์ที่ส่งมาไม่ใช่รูปภาพจริง");
  return { bytes, ext, mime: mimeFor(ext) };
}

export function sniff(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 12 && b.slice(0, 4).toString("ascii") === "RIFF" && b.slice(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

export const mimeFor = (ext) =>
  ({ png: "image/png", jpg: "image/jpeg", webp: "image/webp" }[ext] || "application/octet-stream");

// ----------------------------------------------------------------- prompt
export function buildPrompt(campaignTitle, themePrompt, studentName, learnings, commitments) {
  const bullets = (items) => {
    const list = (items || []).map((x) => String(x).trim()).filter(Boolean);
    return list.length ? list.map((i) => "- " + i).join("\n") : "- (none provided)";
  };
  return `Create a vertical 3:4 commemorative closing-class poster for a workshop campaign named "${campaignTitle || "Workshop"}".
Style direction: ${themePrompt || "clean modern celebratory poster"}.
Learner name: ${studentName || "Anonymous learner"}

The poster must visually communicate a proud end-of-class moment, practical learning, and a personal commitment to apply what they learned at work.

Incorporate these learning takeaways as short visual notes, but do not overfill the image:
${bullets(learnings)}

Incorporate these commitments as future action cards:
${bullets(commitments)}

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

Mood: inspiring, celebratory, practical, warm, high-impact.`;
}

// ------------------------------------------------------------- generation
export async function generateImage({ photoBytes, photoExt, campaign, theme, sub, cfg }) {
  const mock = (err = "") => ({
    bytes: makePoster({
      campaignTitle: campaign?.title || "", studentName: sub.student_name || "",
      themeId: theme?.id || "mock", learnings: sub.learnings || [],
      commitments: sub.commitments || [], subId: sub.id,
    }),
    status: err ? "fallback_mock" : "done",
    error: err,
  });

  if (cfg.IMAGE_PROVIDER === "mock") return mock("");
  if (!cfg.OPENAI_API_KEY) return mock("ไม่พบ OPENAI_API_KEY จึงใช้รูป mock แทน");

  try {
    const form = new FormData();
    form.append("model", cfg.IMAGE_MODEL);
    form.append("prompt", buildPrompt(campaign?.title, theme?.prompt, sub.student_name, sub.learnings, sub.commitments));
    form.append("size", cfg.IMAGE_SIZE);
    form.append("quality", cfg.IMAGE_QUALITY);
    form.append("n", "1");
    form.append("image", new Blob([photoBytes], { type: mimeFor(photoExt) }), `photo.${photoExt}`);

    const res = await fetch(cfg.OPENAI_BASE_URL.replace(/\/$/, "") + "/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(13 * 60 * 1000),
    });
    if (!res.ok) return mock(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const payload = await res.json();
    const item = payload?.data?.[0] || {};
    if (item.b64_json) return { bytes: Buffer.from(item.b64_json, "base64"), status: "done", error: "" };
    if (item.url) {
      const img = await fetch(item.url);
      if (!img.ok) return mock(`ดาวน์โหลดรูปจาก OpenAI ไม่สำเร็จ (HTTP ${img.status})`);
      return { bytes: Buffer.from(await img.arrayBuffer()), status: "done", error: "" };
    }
    return mock("OpenAI response had neither b64_json nor url");
  } catch (e) {
    return mock(`${e.name}: ${e.message}`);
  }
}

// ------------------------------------------------------------------ utils
export const json = (code, body) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export function cleanList(v) {
  if (typeof v === "string") v = v.split("\n");
  return (v || []).map((x) => String(x).trim().slice(0, 300)).filter(Boolean).slice(0, 6);
}

export function publicSub(sub) {
  return {
    id: sub.id, campaign_slug: sub.campaign_slug, student_name: sub.student_name || "",
    learnings: sub.learnings || [], commitments: sub.commitments || [],
    theme_id: sub.theme_id || "", status: sub.status || "processing",
    error: sub.error || "", created_at: sub.created_at || "",
    imageUrl: sub.image_path ? "/media/" + sub.image_path : null,
  };
}
