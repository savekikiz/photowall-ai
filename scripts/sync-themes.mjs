// themes.json is the single source of truth.  The Netlify functions import a
// plain .mjs copy so nothing depends on JSON-import support in the bundler.
// Run after editing themes.json:  node scripts/sync-themes.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const themes = JSON.parse(readFileSync(join(root, "themes.json"), "utf8"));
const out = `// GENERATED from themes.json by scripts/sync-themes.mjs -- do not edit by hand.
export const THEMES = ${JSON.stringify(themes, null, 2)};
`;
writeFileSync(join(root, "netlify/lib/themes.mjs"), out);
console.log(`synced ${themes.length} themes -> netlify/lib/themes.mjs`);
