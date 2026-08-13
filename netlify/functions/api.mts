// PhotoWall API on Netlify (fast path -- must answer well under 10s).
// The slow image call lives in generate-background.mts.
import * as store from "../lib/storage.mjs";
import {
  THEMES, themeById, config as envConfig, slugify, decodePhoto, PhotoError,
  json, cleanList, publicSub, BUDGET, MAX_BODY_BYTES, logEvent,
} from "../lib/core.mjs";

export default async (req: Request) => {
  const url = new URL(req.url);
  const path = decodeURIComponent(url.pathname);
  const cfg = envConfig();

  try {
    if (path === "/healthz") {
      const c = await store.counts();
      // /healthz?probe=1 also checks that this function can actually reach the
      // background function. Opt-in because it queues a no-op invocation, and
      // because a green healthz that never tested the hand-off is how a site
      // ends up looking fine right up until the first real upload.
      const probe = url.searchParams.get("probe") === "1"
        ? await probeTrigger(req)
        : undefined;
      return json(200, {
        ok: true, storage: "netlify-blobs",
        image_provider: cfg.IMAGE_PROVIDER,
        has_openai_key: Boolean(cfg.OPENAI_API_KEY),
        admin_token_set: Boolean(cfg.ADMIN_TOKEN),
        ...(probe ? { trigger: probe } : {}),
        ...c, time: store.nowIso(),
      });
    }

    if (path === "/api/themes") return json(200, { themes: THEMES });

    if (path === "/api/campaigns" && req.method === "GET") {
      if (!adminOk(req, cfg)) return json(401, { error: "unauthorized" });
      return json(200, { campaigns: await store.listCampaigns() });
    }

    if (path === "/api/campaigns" && req.method === "POST") {
      if (!adminOk(req, cfg))
        return json(401, { error: "unauthorized: ต้องส่ง X-Admin-Token ให้ถูกต้อง" });
      const body = await req.json().catch(() => ({}));
      const title = (body.title || "").trim();
      if (!title) return json(400, { error: "ต้องมีชื่องาน (title)" });
      const slug = slugify(body.slug || title);
      if (!slug) return json(400, { error: "slug ไม่ถูกต้อง" });
      const campaign = await store.addCampaign(slug, title, (body.description || "").trim());
      if (!campaign) return json(409, { error: "มีงานชื่อนี้อยู่แล้ว" });
      return json(201, { campaign });
    }

    let m = /^\/api\/campaigns\/([^/]+)$/.exec(path);
    if (m) {
      const c = await store.getCampaign(m[1]);
      return c ? json(200, { campaign: c }) : json(404, { error: "ไม่พบงานนี้" });
    }

    m = /^\/api\/submissions\/([^/]+)$/.exec(path);
    if (m) {
      const sub = await store.getSubmission(m[1]);
      return sub ? json(200, publicSub(sub)) : json(404, { error: "ไม่พบ submission" });
    }

    if (path === "/api/submissions" && req.method === "GET") {
      const slug = url.searchParams.get("campaign");
      if (!slug) return json(400, { error: "ต้องระบุ ?campaign=" });
      const subs = await store.listSubmissions(slug, true);
      return json(200, { submissions: subs.map(publicSub) });
    }

    if (path === "/api/submissions" && req.method === "POST") return createSubmission(req, cfg);

    if (path.startsWith("/media/")) {
      const media = await store.readMedia(path.slice("/media/".length));
      if (!media) return json(404, { error: "not found" });
      return new Response(media.bytes, {
        headers: {
          "content-type": media.contentType,
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    }

    return json(404, { error: "not found" });
  } catch (e: any) {
    console.error("api error", e);
    return json(500, { error: "internal error" });
  }
};

function adminOk(req: Request, cfg: any) {
  const expected = cfg.ADMIN_TOKEN;
  return Boolean(expected) && req.headers.get("x-admin-token") === expected;
}

async function createSubmission(req: Request, cfg: any) {
  // Reject oversized uploads before parsing: past ~6MB of base64 the platform
  // drops the request itself, and the user gets an opaque platform error
  // instead of an explanation they can act on.
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) {
    return json(413, { error: "รูปใหญ่เกินไปสำหรับเซิร์ฟเวอร์ (จำกัดราว 4MB) ลองถ่ายใหม่หรือย่อรูปก่อน" });
  }

  const body = await req.json().catch(() => ({}));
  const slug = (body.campaign_slug || "").trim();
  const campaign = await store.getCampaign(slug);
  if (!campaign) return json(404, { error: "ไม่พบงานนี้ (campaign_slug)" });

  const theme = themeById((body.theme_id || "").trim());
  if (!theme) return json(400, { error: "ต้องเลือกธีมที่มีอยู่จริง (theme_id)" });

  const learnings = cleanList(body.learnings);
  const commitments = cleanList(body.commitments);
  if (!learnings.length) return json(400, { error: "ต้องเขียนว่าได้เรียนรู้อะไรอย่างน้อย 1 ข้อ" });
  if (!commitments.length) return json(400, { error: "ต้องเขียนว่าจะเอาไปทำอะไรต่ออย่างน้อย 1 ข้อ" });

  let photo;
  try { photo = decodePhoto(body.photoData); }
  catch (e: any) {
    if (e instanceof PhotoError) return json(400, { error: e.message });
    throw e;
  }

  const id = store.newId("sub");
  const photoPath = `uploads/${id}.${photo.ext}`;
  await store.saveMedia(photoPath, photo.bytes, photo.mime);

  const sub = {
    id, campaign_slug: slug,
    student_name: (body.student_name || "").trim().slice(0, 80),
    learnings, commitments, theme_id: theme.id,
    image_path: "", photo_path: photoPath,
    status: "processing", error: "", created_at: store.nowIso(),
  };
  await store.addSubmission(sub);

  // Hand off to the background function (up to 15 min) and answer immediately.
  // Deliberately NOT PUBLIC_BASE_URL: this is a self-invocation, so it is on
  // this exact host by definition. Deriving it from a hand-entered env var only
  // adds a way for a typo (or a copied localhost value) to take generation down
  // site-wide, which is invisible until someone waits out the whole poll window.
  const t = await callTrigger(req, { id });
  if (t.ok) logEvent("trigger_ok", { sub: id, status: t.status });
  else await failSubmission(id, t.message);

  return json(201, { id, status: "processing", pollUrl: `/api/submissions/${id}` });
}

const TRIGGER_PATH = "/.netlify/functions/generate-background";

/** Site-wide password protection / team-login sits in front of every path on
 *  the domain, functions included. This request carries no browser session, so
 *  a protected site answers 401 (or 403) here even though the code is fine --
 *  the site is simply closed to anything that is not a logged-in browser. */
const EDGE_BLOCKED =
  "เว็บเปิด password protection อยู่ ระบบจึงเรียกตัวสร้างภาพไม่ได้ " +
  "ให้ปิดที่ Netlify → Site configuration → Access & security → Visitor access " +
  "(งานนี้ต้องเปิดเป็นสาธารณะอยู่แล้ว เพราะผู้เข้าร่วมสแกน QR เข้ามาเอง)";

async function callTrigger(req: Request, payload: any) {
  const target = new URL(TRIGGER_PATH, req.url);
  try {
    const r = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(BUDGET.TRIGGER_TIMEOUT_MS),
    });
    if (r.ok || r.status === 202) return { ok: true, status: r.status, message: "" };

    const body = (await r.text().catch(() => "")).slice(0, 200);
    const blocked = r.status === 401 || r.status === 403;
    logEvent("trigger_http_error", { status: r.status, blocked, body });
    return {
      ok: false,
      status: r.status,
      message: blocked ? EDGE_BLOCKED : `เรียกตัวสร้างภาพไม่สำเร็จ (HTTP ${r.status})`,
    };
  } catch (e: any) {
    return { ok: false, status: 0, message: `เรียกตัวสร้างภาพไม่สำเร็จ: ${e.name}: ${e.message}` };
  }
}

/** Same hand-off, no submission attached: a background function answers 202 to
 *  any POST, and the handler rejects the empty body without touching storage. */
async function probeTrigger(req: Request) {
  const t = await callTrigger(req, {});
  return t.ok
    ? { ok: true, status: t.status, hint: "เรียกตัวสร้างภาพได้ปกติ" }
    : { ok: false, status: t.status, hint: t.message };
}

/** A failed hand-off must set `status`, not just `error`. Writing only `error`
 *  leaves the record at "processing" forever, so the browser keeps polling
 *  until its own giveup timer fires and reports a generic timeout -- turning a
 *  fault we already understood into a long wait and a useless message. */
async function failSubmission(id: string, error: string) {
  logEvent("trigger_failed", { sub: id, error });
  await store.updateSubmission(id, { status: "error", error });
}

export const config = { path: ["/healthz", "/api/*", "/media/*"] };
