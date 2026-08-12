// Exercises the real Netlify handlers (api.mts + generate-background.mts)
// against an in-memory stand-in for Netlify Blobs, so the deploy path is
// tested without needing a deploy.  Run: npm run test:netlify
import assert from "node:assert";
import * as store from "../netlify/lib/storage.mjs";
import { makePoster } from "../netlify/lib/mockimage.mjs";

process.env.ADMIN_TOKEN = "test-token-123";
process.env.IMAGE_PROVIDER = "mock";

// ---- in-memory Blobs -------------------------------------------------------
const mem = new Map();
store.__setStore({
  async get(key, opts = {}) {
    const e = mem.get(key);
    if (!e) return null;
    if (opts.type === "json") return JSON.parse(Buffer.from(e.data).toString("utf8"));
    if (opts.type === "arrayBuffer") return Buffer.from(e.data);
    return Buffer.from(e.data).toString("utf8");
  },
  async getWithMetadata(key, opts = {}) {
    const e = mem.get(key);
    if (!e) return null;
    return { data: opts.type === "arrayBuffer" ? Buffer.from(e.data) : Buffer.from(e.data).toString("utf8"), metadata: e.metadata };
  },
  async set(key, value, opts = {}) { mem.set(key, { data: Buffer.from(value), metadata: opts.metadata || {} }); },
  async setJSON(key, value) { mem.set(key, { data: Buffer.from(JSON.stringify(value), "utf8"), metadata: {} }); },
  async list({ prefix = "" } = {}) {
    return { blobs: [...mem.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
  },
});

const api = (await import("../netlify/functions/api.mts")).default;
const background = (await import("../netlify/functions/generate-background.mts")).default;

// The API hands off to the background function over HTTP; in-process we just
// call it, which is exactly what Netlify does over the wire.
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : (input.url || String(input));
  if (url.includes("/.netlify/functions/generate-background")) {
    const res = await background(new Request(url, { method: "POST", body: init.body, headers: init.headers }));
    return res;
  }
  throw new Error("unexpected fetch to " + url);
};

const BASE = "http://local.test";
const call = (path, init) => api(new Request(BASE + path, init));
const jpost = (path, body, headers = {}) =>
  call(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

let failed = 0;
const check = (name, cond, extra = "") => {
  console.log((cond ? "PASS  " : "FAIL  ") + name + (extra ? "  :: " + extra : ""));
  if (!cond) failed = 1;
};

// ---- 2) healthz ------------------------------------------------------------
let r = await call("/healthz");
let d = await r.json();
check("healthz 200 (blobs backend)", r.status === 200 && d.storage === "netlify-blobs", JSON.stringify(d));

// ---- 3) admin campaign -----------------------------------------------------
r = await jpost("/api/campaigns", { title: "AI Workshop รุ่น 12" });
check("create campaign without token -> 401", r.status === 401);

r = await jpost("/api/campaigns", { title: "AI Workshop รุ่น 12", slug: "workshop-12" }, { "x-admin-token": "test-token-123" });
d = await r.json();
check("create campaign with token -> 201", r.status === 201 && d.campaign.slug === "workshop-12", JSON.stringify(d));

// ---- 4) submission without a photo ----------------------------------------
r = await jpost("/api/submissions", {
  campaign_slug: "workshop-12", learnings: ["a"], commitments: ["b"], theme_id: "street-flash",
});
d = await r.json();
check("submission without photo -> 400", r.status === 400, d.error);

r = await jpost("/api/submissions", {
  campaign_slug: "workshop-12", learnings: ["a"], commitments: ["b"], theme_id: "street-flash",
  photoData: "data:image/png;base64," + Buffer.from("NOTANIMAGE".repeat(300)).toString("base64"),
});
check("submission with fake png bytes -> 400", r.status === 400, (await r.json()).error);

// ---- 5) real submission ----------------------------------------------------
const photo = "data:image/png;base64," + makePoster({ width: 600, height: 800, themeId: "src" }).toString("base64");
r = await jpost("/api/submissions", {
  campaign_slug: "workshop-12", student_name: "ทอม",
  learnings: ["เข้าใจ agent workflow"], commitments: ["ทำ dashboard ทีม"],
  theme_id: "street-flash", photoData: photo,
});
d = await r.json();
check("submission with photo -> 201 + id", r.status === 201 && /^sub_[0-9a-f]{8}$/.test(d.id), JSON.stringify(d));
const id = d.id;

// ---- 6) poll ---------------------------------------------------------------
let status = null, imageUrl = null;
for (let i = 0; i < 20; i++) {
  const s = await (await call(`/api/submissions/${id}`)).json();
  status = s.status; imageUrl = s.imageUrl;
  if (status === "done" || status === "fallback_mock") break;
  await new Promise((res) => setTimeout(res, 200));
}
check("poll reaches done with imageUrl", status === "done" && !!imageUrl, `${status} ${imageUrl}`);

// ---- 7) image URL ----------------------------------------------------------
r = await call(imageUrl);
const buf = Buffer.from(await r.arrayBuffer());
check("image 200, real PNG bytes",
  r.status === 200 && r.headers.get("content-type") === "image/png" &&
  buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  `${r.status} ${r.headers.get("content-type")} ${buf.length} bytes`);

// ---- gallery ---------------------------------------------------------------
d = await (await call("/api/submissions?campaign=workshop-12")).json();
check("gallery lists the submission", d.submissions.length === 1, JSON.stringify(d.submissions.map((s) => s.id)));

// ---- 8) "restart": blobs survive a fresh handler instance ------------------
// Blobs live outside the function, so re-importing with the same store is the
// deploy-again case: a new function instance, the same data.
delete globalThis.__api_cache;
const api2 = (await import("../netlify/functions/api.mts?fresh=1")).default;
d = await (await api2(new Request(BASE + "/healthz"))).json();
check("data survives a new function instance (redeploy)", d.submissions === 1 && d.campaigns === 1, JSON.stringify(d));

// ---- concurrency: one blob per submission, nothing overwritten -------------
const before = (await (await call("/healthz")).json()).submissions;
await Promise.all(Array.from({ length: 12 }, () => jpost("/api/submissions", {
  campaign_slug: "workshop-12", student_name: "ผู้เข้าร่วม",
  learnings: ["x"], commitments: ["y"], theme_id: "future-agent-lab", photoData: photo,
})));
const after = (await (await call("/healthz")).json()).submissions;
check("12 concurrent submissions all kept", after - before === 12, `${before} -> ${after}`);

// ---- themes.json and the generated themes.mjs must agree --------------------
const jsonThemes = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../themes.json", import.meta.url), "utf8"));
const { THEMES } = await import("../netlify/lib/themes.mjs");
check("themes.mjs in sync with themes.json (>=6 themes)",
  JSON.stringify(jsonThemes) === JSON.stringify(THEMES) && THEMES.length >= 6,
  `${jsonThemes.length} vs ${THEMES.length}`);

process.exit(failed);
