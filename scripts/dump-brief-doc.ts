// Dump a Google Doc's structural response (documents.get) to JSON on disk.
// Used to capture parser fixtures from real briefs.
//
//   pnpm tsx --env-file=.env.local scripts/dump-brief-doc.ts \
//     [docId] [outPath]
//
// Defaults to Brief #0219 (Demand AI) — the canonical Phase 2 parser
// fixture per the build brief.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fetchDocStructure } from "../lib/docs";

const DEFAULT_DOC_ID = "13BJAnJsb7Fk5END6_jV_QpDIMlokzO3SbFXVPrBDU8Q";
const DEFAULT_OUT = "lib/__fixtures__/brief-0219.json";

async function main() {
  const docId = process.argv[2] || DEFAULT_DOC_ID;
  const outRel = process.argv[3] || DEFAULT_OUT;
  const outAbs = path.resolve(process.cwd(), outRel);

  console.log(`[dump] fetching ${docId}`);
  const doc = await fetchDocStructure(docId);
  console.log(`[dump] title: "${doc.title}"`);
  await fs.mkdir(path.dirname(outAbs), { recursive: true });
  await fs.writeFile(outAbs, JSON.stringify(doc, null, 2) + "\n", "utf8");
  console.log(`[dump] wrote ${outRel}`);
}

main().catch((err) => {
  console.error("dump-brief-doc failed:", err?.stack ?? err);
  process.exit(1);
});
