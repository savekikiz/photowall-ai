// Background function: Netlify allows these up to 15 minutes, which is what an
// image generation (30-120s) needs. The "-background" suffix is what makes it one.
import * as store from "../lib/storage.mjs";
import { themeById, config, generateImage, THEMES } from "../lib/core.mjs";

export default async (req: Request) => {
  const { id } = await req.json().catch(() => ({ id: null }));
  if (!id) return new Response("missing id", { status: 400 });

  try {
    const sub = await store.getSubmission(id);
    if (!sub) return new Response("unknown submission", { status: 404 });

    const campaign = (await store.getCampaign(sub.campaign_slug)) || { title: sub.campaign_slug };
    const theme = themeById(sub.theme_id) || THEMES[0];
    const photo = await store.readMedia(sub.photo_path);
    const ext = (sub.photo_path || "").split(".").pop() || "jpg";

    const { bytes, status, error } = await generateImage({
      photoBytes: photo?.bytes, photoExt: ext, campaign, theme, sub, cfg: config(),
    });

    const rel = `generated/${id}.png`;
    await store.saveMedia(rel, bytes, "image/png");
    await store.updateSubmission(id, { status, error, image_path: rel });
    return new Response("ok");
  } catch (e: any) {
    console.error("generate-background failed", e);
    await store.updateSubmission(id, { status: "error", error: String(e?.message || e).slice(0, 500) });
    return new Response("error", { status: 500 });
  }
};
