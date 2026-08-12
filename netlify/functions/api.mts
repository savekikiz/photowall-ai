// PhotoWall API on Netlify (fast path -- must answer well under 10s).
// The slow image call lives in generate-background.mts.
import * as store from "../lib/storage.mjs";
import {
  THEMES, themeById, config as envConfig, slugify, decodePhoto, PhotoError,
  json, cleanList, publicSub,
} from "../lib/core.mjs";

export default async (req: Request) => {
  const url = new URL(req.url);
  const path = decodeURIComponent(url.pathname);
  const cfg = envConfig();

  try {
    if (path === "/healthz") {
      const c = await store.counts();
      return json(200, {
        ok: true, storage: "netlify-blobs",
        image_provider: cfg.IMAGE_PROVIDER,
        has_openai_key: Boolean(cfg.OPENAI_API_KEY),
        admin_token_set: Boolean(cfg.ADMIN_TOKEN),
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
  const target = new URL("/.netlify/functions/generate-background", cfg.PUBLIC_BASE_URL || req.url);
  try {
    const r = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!r.ok && r.status !== 202) {
      await store.updateSubmission(id, { error: `trigger HTTP ${r.status}` });
    }
  } catch (e: any) {
    await store.updateSubmission(id, { error: `trigger failed: ${e.message}` });
  }

  return json(201, { id, status: "processing", pollUrl: `/api/submissions/${id}` });
}

export const config = { path: ["/healthz", "/api/*", "/media/*"] };
