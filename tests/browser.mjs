// End-to-end browser test: drives real headless Chrome over the DevTools
// protocol using node's built-in WebSocket -- no puppeteer, no npm deps.
//
//   1) start the app:   ADMIN_TOKEN=test-token-123 IMAGE_PROVIDER=mock PORT=8091 python3 server.py &
//   2) start Chrome:    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//                         --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/pw-chrome &
//   3) run:             SP=/tmp CDP=http://127.0.0.1:9222 ADMIN_TOKEN=test-token-123 node tests/browser.mjs
//
// Screenshots are written to $SP.
const SP = process.env.SP || "/tmp";
const CDP = process.env.CDP || "http://127.0.0.1:9222";
const BASE = process.env.BASE || "http://localhost:8091";
const SLUG = process.env.SLUG || "browser-demo";
const TOKEN = process.env.ADMIN_TOKEN || "test-token-123";
let failed = 0;
const check = (n, ok, extra = "") => { console.log((ok ? "PASS  " : "FAIL  ") + n + (extra ? "  :: " + extra : "")); if (!ok) failed = 1; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function newTab(url) {
  const t = await (await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener("message", e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const myId = ++id; pending.set(myId, m => m.error ? rej(new Error(method + ": " + JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
  await send("Page.enable"); await send("Runtime.enable");
  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "js error");
    return r.result.value;
  };
  const goto = async (u) => { await send("Page.navigate", { url: u }); await sleep(900); };
  const shot = async (name) => {
    const { data } = await send("Page.captureScreenshot", { captureBeyondViewport: true });
    (await import("node:fs")).writeFileSync(`${SP}/${name}.png`, Buffer.from(data, "base64"));
    return `${SP}/${name}.png`;
  };
  await send("Emulation.setDeviceMetricsOverride", { width: 430, height: 1200, deviceScaleFactor: 1, mobile: true });
  return { send, evalJs, goto, shot, close: () => ws.close(), targetId: t.id };
}

const tab = await newTab("about:blank");

// ---------------- admin page: create a campaign through the UI --------------
await tab.goto(`${BASE}/admin`);
await tab.evalJs(`localStorage.setItem('pw_admin_token', ${JSON.stringify(TOKEN)}); document.getElementById('token').value = ${JSON.stringify(TOKEN)};`);
await tab.evalJs(`
  document.getElementById('title').value = 'PhotoWall Browser Demo';
  document.getElementById('slug').value = ${JSON.stringify(SLUG)};
  document.getElementById('desc').value = 'ทดสอบผ่านเบราว์เซอร์จริง';
  document.getElementById('create').click();
`);
await sleep(1200);
let adminText = await tab.evalJs(`document.getElementById('msg').textContent + ' || ' + document.getElementById('list').textContent.slice(0,120)`);
check("admin: campaign created + listed via UI", adminText.includes("สร้างงาน") && adminText.includes(SLUG), adminText.replace(/\s+/g, " "));
await tab.shot("01-admin");

// ---------------- participant page ------------------------------------------
await tab.goto(`${BASE}/c/${SLUG}`);
const title = await tab.evalJs(`document.getElementById('title').textContent`);
check("participant page loads campaign title", title === "PhotoWall Browser Demo", title);
const themeCount = await tab.evalJs(`document.querySelectorAll('.theme').length`);
check("6 themes rendered, first pre-selected", themeCount === 6 && await tab.evalJs(`!!document.querySelector('.theme.sel')`), String(themeCount));

// client-side guard: submit with no photo
await tab.evalJs(`document.getElementById('learnings').value='เข้าใจ agent workflow'; document.getElementById('commitments').value='ทำ dashboard ทีม'; document.getElementById('submit').click();`);
await sleep(400);
const guard = await tab.evalJs(`document.getElementById('formerr').textContent`);
check("browser blocks submit without a photo", guard.includes("ต้องแนบรูป"), guard);
await tab.shot("02-form-guard");

// pick the theme + attach a real file through the real <input type=file>
await tab.evalJs(`document.querySelector('[data-id="thai-inspiration"]').click(); true`);
// a stand-in "selfie" so the test needs no external asset
const { makePoster } = await import("../netlify/lib/mockimage.mjs");
const b64 = makePoster({ width: 900, height: 1200, themeId: "portrait", studentName: "Tom" }).toString("base64");
await tab.evalJs(`(async () => {
  const bin = Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0));
  const file = new File([bin], 'portrait.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(file);
  const input = document.getElementById('file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change'));
  await new Promise(r => setTimeout(r, 700));
  return document.getElementById('preview').src.slice(0, 30);
})()`);
const previewOk = await tab.evalJs(`!document.getElementById('preview').hidden && document.getElementById('preview').src.startsWith('data:image/jpeg')`);
check("photo picked, resized client-side to jpeg data URL", previewOk === true);
await tab.evalJs(`document.getElementById('name').value = 'ทอม (browser)'; true`);
await tab.shot("03-form-filled");

await tab.evalJs(`document.getElementById('submit').click(); true`);
await sleep(800);
const working = await tab.evalJs(`!document.getElementById('working').hidden`);
check("loading state shown while generating", working === true);
await tab.shot("04-generating");

let posterSrc = "";
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  posterSrc = await tab.evalJs(`document.getElementById('result').hidden ? '' : document.getElementById('poster').src`);
  if (posterSrc) break;
}
check("poster appears after polling", posterSrc.includes("/media/generated/"), posterSrc);
const imgOk = await tab.evalJs(`(() => { const i = document.getElementById('poster'); return i.complete && i.naturalWidth > 0 ? i.naturalWidth + 'x' + i.naturalHeight : 'not loaded'; })()`);
check("poster image actually renders (3:4)", imgOk === "768x1024", imgOk);
await tab.shot("05-result");

// gallery tab
await tab.evalJs(`location.hash = '#gallery'; true`);
await sleep(1500);
const tiles = await tab.evalJs(`document.querySelectorAll('#grid .tile img').length`);
const tileLoaded = await tab.evalJs(`[...document.querySelectorAll('#grid .tile img')].every(i => i.naturalWidth > 0)`);
check("gallery shows the image", tiles >= 1 && tileLoaded === true, `${tiles} tiles`);
await tab.shot("06-gallery");

// ---------------- wall page --------------------------------------------------
await tab.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await tab.goto(`${BASE}/wall.html?c=${SLUG}`);
await sleep(1200);
const wallCount1 = await tab.evalJs(`document.getElementById('count').textContent`);
const wallTitle = await tab.evalJs(`document.getElementById('title').textContent`);
check("wall page shows campaign + count", wallTitle === "PhotoWall Browser Demo" && wallCount1.startsWith("1"), `${wallTitle} / ${wallCount1}`);
await tab.shot("07-wall-before");

// a new submission posted from outside must appear without reloading the wall
await fetch(`${BASE}/api/submissions`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({
    campaign_slug: SLUG, student_name: "เพื่อนร่วมคลาส",
    learnings: ["ทำ RAG ได้"], commitments: ["สอนต่อให้ทีม"],
    theme_id: "future-agent-lab",
    photoData: "data:image/png;base64," + b64,
  }),
});
await sleep(12000); // wall polls every 8s
const wallCount2 = await tab.evalJs(`document.getElementById('count').textContent`);
const freshRing = await tab.evalJs(`document.querySelectorAll('#grid .tile.fresh').length`);
check("wall auto-refreshes with the new poster (no reload)", wallCount2.startsWith("2"), `${wallCount1} -> ${wallCount2}, highlighted=${freshRing}`);
await tab.shot("08-wall-after");

const errors = await tab.evalJs(`window.__errs ? window.__errs.length : 0`);
await fetch(`${CDP}/json/close/${tab.targetId}`);
process.exit(failed);
