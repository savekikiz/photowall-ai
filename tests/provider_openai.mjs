import { generateImage } from "../netlify/lib/core.mjs";
import { makePoster } from "../netlify/lib/mockimage.mjs";
const photo = makePoster({ width: 300, height: 400 });
const base = "http://127.0.0.1:8099";
const common = { photoBytes: photo, photoExt: "png", campaign: { title: "AI Workshop 12" },
  theme: { id: "street-flash", prompt: "street" }, sub: { id: "sub_prov0002", student_name: "Tom", learnings: ["a"], commitments: ["b"] } };
let failed = 0;
const check = (n, ok, x = "") => { console.log((ok ? "PASS  " : "FAIL  ") + n + (x ? "  :: " + x : "")); if (!ok) failed = 1; };
const cfg = (u, key = "sk-test") => ({ IMAGE_PROVIDER: "openai", OPENAI_API_KEY: key, OPENAI_BASE_URL: u,
  IMAGE_MODEL: "gpt-image-2", IMAGE_SIZE: "1024x1536", IMAGE_QUALITY: "medium" });
const isPng = (b) => b.slice(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));

let r = await generateImage({ ...common, cfg: cfg(base + "/ok") });
check("openai b64_json -> done", r.status === "done" && !r.error && isPng(r.bytes), `${r.status} ${r.bytes.length}B ${r.error}`);
r = await generateImage({ ...common, cfg: cfg(base + "/url") });
check("openai url -> downloaded, done", r.status === "done" && isPng(r.bytes), `${r.status} ${r.bytes.length}B ${r.error}`);
r = await generateImage({ ...common, cfg: cfg(base + "/fail") });
check("openai 401 -> fallback_mock + error", r.status === "fallback_mock" && r.error.includes("401"), r.error.slice(0, 70));
r = await generateImage({ ...common, cfg: cfg(base + "/ok", "") });
check("no key -> fallback_mock", r.status === "fallback_mock" && r.error.includes("OPENAI_API_KEY"), r.error);
r = await generateImage({ ...common, cfg: cfg("http://127.0.0.1:1/dead") });
check("unreachable -> fallback_mock", r.status === "fallback_mock" && isPng(r.bytes), r.error.slice(0, 60));

// ---- timeout / retry behaviour -------------------------------------------
// These guard the bug that made a broken generation look like a 15-minute hang:
// a slow provider has to be abandoned on OUR schedule, not its own.
let t0 = Date.now();
r = await generateImage({
  ...common,
  cfg: { ...cfg(base + "/slow"), IMAGE_TIMEOUT_MS: 1500, IMAGE_MAX_ATTEMPTS: 1 },
});
let elapsed = Date.now() - t0;
check("slow provider -> aborted on our timeout, not theirs",
  r.status === "fallback_mock" && isPng(r.bytes) && elapsed < 5000,
  `${elapsed}ms :: ${r.error.slice(0, 60)}`);

t0 = Date.now();
r = await generateImage({
  ...common,
  cfg: { ...cfg(base + "/429"), IMAGE_MAX_ATTEMPTS: 2, IMAGE_RETRY_BACKOFF_MS: 200 },
});
elapsed = Date.now() - t0;
check("429 -> retried (honours Retry-After) then succeeds",
  r.status === "done" && isPng(r.bytes) && elapsed >= 1000,
  `${r.status} ${elapsed}ms ${r.error.slice(0, 60)}`);

r = await generateImage({
  ...common,
  cfg: { ...cfg(base + "/500"), IMAGE_MAX_ATTEMPTS: 2, IMAGE_RETRY_BACKOFF_MS: 200 },
});
check("500 -> retried then falls back with the upstream reason",
  r.status === "fallback_mock" && r.error.includes("500"), r.error.slice(0, 70));

// 401 must NOT be retried -- the key is wrong and waiting cannot fix it.
t0 = Date.now();
r = await generateImage({
  ...common,
  cfg: { ...cfg(base + "/fail"), IMAGE_MAX_ATTEMPTS: 3, IMAGE_RETRY_BACKOFF_MS: 3000 },
});
elapsed = Date.now() - t0;
check("401 -> fails fast, no pointless retries",
  r.status === "fallback_mock" && r.error.includes("401") && elapsed < 2000, `${elapsed}ms`);

process.exit(failed);
