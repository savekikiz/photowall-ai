// Background function: Netlify allows these up to 15 minutes, which is what an
// image generation (30-120s) needs. Both the "-background" filename suffix and
// the explicit `config.background` below mark it as one; the suffix is still
// supported, but stating it in config removes any doubt about how it deployed.
import * as store from "../lib/storage.mjs";
import { themeById, config as envConfig, generateImage, THEMES, BUDGET, logEvent } from "../lib/core.mjs";
import { makePoster } from "../lib/mockimage.mjs";

export default async (req: Request) => {
  const { id } = await req.json().catch(() => ({ id: null }));
  if (!id) return new Response("missing id", { status: 400 });

  const started = Date.now();
  const cfg = envConfig();
  logEvent("generate_start", { sub: id, provider: cfg.IMAGE_PROVIDER, model: cfg.IMAGE_MODEL });

  try {
    const sub = await store.getSubmission(id);
    if (!sub) return new Response("unknown submission", { status: 404 });

    const campaign = (await store.getCampaign(sub.campaign_slug)) || { title: sub.campaign_slug };
    const theme = themeById(sub.theme_id) || THEMES[0];
    const photo = await store.readMedia(sub.photo_path);
    const ext = (sub.photo_path || "").split(".").pop() || "jpg";

    const fallback = (error: string) => ({
      bytes: makePoster({
        campaignTitle: campaign?.title || "", studentName: sub.student_name || "",
        themeId: theme?.id || "mock", learnings: sub.learnings || [],
        commitments: sub.commitments || [], subId: sub.id,
      }),
      status: "fallback_mock",
      error,
    });

    // Whatever happens, this function must write a terminal status. If the
    // provider outlasts the watchdog we ship the fallback poster ourselves
    // rather than letting the 15-minute platform ceiling kill us mid-flight,
    // which would leave the record stuck at "processing" with nobody to fix it.
    let timer: any;
    const guard = new Promise((resolve) => {
      timer = setTimeout(
        () => resolve(fallback(`สร้างภาพนานเกิน ${Math.round(BUDGET.WATCHDOG_MS / 1000)} วินาที จึงใช้ภาพสำรองแทน`)),
        BUDGET.WATCHDOG_MS,
      );
    });

    let result: any;
    try {
      result = await Promise.race([
        generateImage({ photoBytes: photo?.bytes, photoExt: ext, campaign, theme, sub, cfg }),
        guard,
      ]);
    } finally {
      clearTimeout(timer); // don't leave a pending timer holding the runtime open
    }

    const rel = `generated/${id}.png`;
    await store.saveMedia(rel, result.bytes, "image/png");
    await store.updateSubmission(id, {
      status: result.status, error: result.error, image_path: rel,
    });
    logEvent("generate_done", {
      sub: id, status: result.status, ms: Date.now() - started, error: result.error || "",
    });
    return new Response("ok");
  } catch (e: any) {
    const error = String(e?.message || e).slice(0, 500);
    logEvent("generate_failed", { sub: id, ms: Date.now() - started, error });
    await store.updateSubmission(id, { status: "error", error });
    return new Response("error", { status: 500 });
  }
};

export const config = { background: true };
