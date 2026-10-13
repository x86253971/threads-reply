// Cloudflare の KV に置いた記録と下書きを、パソコンに取ってくる(設計案18章)。
//   node scripts/pull.js
//
// 取ってきたものは「記録」「下書き」フォルダに入る(GitHub には上げない)。
// そのあと node scripts/weekly.js で週報も作れる。
// 先に npx wrangler login で Cloudflare にログインしておく必要がある。

import { execSync } from "node:child_process";
import { saveRecords, ROOT } from "../lib/local.js";
import { mkdirSync, writeFileSync } from "node:fs";

const wr = (args) => execSync(`npx wrangler ${args} --binding KV --remote`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

const records = JSON.parse(wr("kv key get records") || "[]");
saveRecords(records);
console.log(`記録 ${records.length}件 → 記録/返信の記録.jsonl`);

const keys = JSON.parse(wr("kv key list --prefix drafts:"));
mkdirSync(new URL("下書き/", ROOT), { recursive: true });
for (const { name } of keys) {
  const date = name.slice("drafts:".length);
  const text = wr(`kv key get "${name}"`);
  writeFileSync(new URL(`下書き/${date}.txt`, ROOT), text.replace(/\r?\n/g, "\r\n"), "utf8");
  console.log(`下書き ${date} → 下書き/${date}.txt`);
}

try {
  const log = wr("kv key get token_log");
  if (log) console.log("\nトークン延長の記録:\n" + log);
} catch {}
