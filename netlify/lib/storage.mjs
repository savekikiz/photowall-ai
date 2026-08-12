// The only module that touches persistence on Netlify.
// Local/Docker deploys use storage.py instead -- same function names.
//
// Layout inside the "photowall" blob store:
//   campaigns.json          -> [ {slug,title,description,created_at}, ... ]
//   submissions/<id>.json   -> one blob per submission
//   media/uploads/<id>.jpg  -> the learner photo
//   media/generated/<id>.png-> the finished poster
//
// Submissions get one blob each on purpose: several people press "create" at
// the same moment, and a single shared JSON array would need a read-modify-
// write that Blobs cannot lock, so the last writer would erase the others.

let _store = null;

/** Test seam: hand in an in-memory store instead of hitting Netlify. */
export function __setStore(s) { _store = s; }

async function store() {
  if (_store) return _store;
  const { getStore } = await import("@netlify/blobs");
  _store = getStore({ name: "photowall", consistency: "strong" });
  return _store;
}

export const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

export function newId(prefix = "sub") {
  const b = new Uint8Array(4);
  (globalThis.crypto || require("node:crypto").webcrypto).getRandomValues(b);
  return prefix + "_" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- campaigns

export async function listCampaigns() {
  const s = await store();
  return (await s.get("campaigns.json", { type: "json" })) ?? [];
}

export async function getCampaign(slug) {
  return (await listCampaigns()).find((c) => c.slug === slug) ?? null;
}

export async function addCampaign(slug, title, description = "") {
  const s = await store();
  const campaigns = await listCampaigns();
  if (campaigns.some((c) => c.slug === slug)) return null;
  const campaign = { slug, title, description: description || "", created_at: nowIso() };
  campaigns.push(campaign);
  await s.setJSON("campaigns.json", campaigns);
  return campaign;
}

// -------------------------------------------------------------- submissions

export async function addSubmission(sub) {
  const s = await store();
  await s.setJSON(`submissions/${sub.id}.json`, sub);
  return sub;
}

export async function getSubmission(id) {
  if (!/^[A-Za-z0-9_-]+$/.test(id || "")) return null;
  const s = await store();
  return (await s.get(`submissions/${id}.json`, { type: "json" })) ?? null;
}

export async function updateSubmission(id, fields) {
  const s = await store();
  const sub = await getSubmission(id);
  if (!sub) return null;
  const merged = { ...sub, ...fields };
  await s.setJSON(`submissions/${id}.json`, merged);
  return merged;
}

export async function listSubmissions(campaignSlug = null, onlyDone = false) {
  const s = await store();
  const { blobs } = await s.list({ prefix: "submissions/" });
  const subs = (await Promise.all(
    blobs.map((b) => s.get(b.key, { type: "json" }).catch(() => null)),
  )).filter(Boolean);
  return subs
    .filter((x) => (!campaignSlug || x.campaign_slug === campaignSlug))
    .filter((x) => (!onlyDone || ["done", "fallback_mock"].includes(x.status)))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

// ------------------------------------------------------------------- media

export async function saveMedia(relPath, bytes, contentType) {
  const s = await store();
  await s.set(`media/${relPath}`, bytes, { metadata: { contentType } });
  return relPath;
}

export async function readMedia(relPath) {
  if (relPath.includes("..")) return null;
  const s = await store();
  try {
    const r = await s.getWithMetadata(`media/${relPath}`, { type: "arrayBuffer" });
    if (!r) return null;
    return { bytes: Buffer.from(r.data), contentType: r.metadata?.contentType || "application/octet-stream" };
  } catch {
    return null;
  }
}

export async function counts() {
  const s = await store();
  const { blobs } = await s.list({ prefix: "submissions/" });
  return { campaigns: (await listCampaigns()).length, submissions: blobs.length };
}
