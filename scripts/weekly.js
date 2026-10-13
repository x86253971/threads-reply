// 週1のまとめ(8章)。記録から「効いたか」をメモ帳で読める形にする。
//   node scripts/weekly.js          直近7日
//   node scripts/weekly.js 14       直近14日
//
// 出す先: 週報/週報_YYYY-MM-DD.txt (GitHubには上げない。相手のコメントが入るため)
// LINE の友だち追加の数は、今は入れていない(九尾LINE側の記録とは、まだつないでいない)。

import { mkdirSync, writeFileSync } from "node:fs";
import { ROOT, loadRecords as load } from "../lib/local.js";
import * as threads from "../lib/threads.js";

const days = Number(process.argv[2] ?? 7);
const now = Date.now();
const from = now - days * 86400 * 1000;
const recs = load().filter((x) => Date.parse(x.at) >= from);

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "-");
const count = (arr, f) => arr.filter(f).length;
const L = [];
const today = new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);

L.push("=".repeat(64), `週報 ${today}（直近${days}日）`, "=".repeat(64), "");

// 全体
const byStatus = {};
for (const r of recs) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
L.push("■ 全体", `  返し方を決めたコメント ${recs.length}件`);
for (const [k, v] of Object.entries(byStatus)) L.push(`    ${k}: ${v}件`);
L.push("");

// 種類ごと
const NAMES = { A: "感想", B: "質問・軽い相談", C: "占ってほしい", D: "重い相談", E: "荒らし・宣伝", F: "返事が要らない" };
L.push("■ コメントの種類");
for (const [t, name] of Object.entries(NAMES)) {
  const n = count(recs, (x) => x.type === t);
  if (n) L.push(`  ${t} ${name}: ${n}件（うち往復の続き ${count(recs, (x) => x.type === t && x.followup)}件）`);
}
L.push("");

// 往復になったか(送ったものだけ)
const sent = recs.filter((x) => x.status === "送信");
L.push("■ 往復になったか（送った返信のうち、相手がもう一度返してきた割合）");
if (!sent.length) L.push("  まだ送った返信がありません（段階1）");
else {
  const rate = (f) => {
    const g = sent.filter(f);
    return `${pct(count(g, (x) => x.got_reply), g.length)}（${g.length}件中）`;
  };
  L.push(`  全体:             ${rate(() => true)}`);
  L.push(`  質問で終えた:     ${rate((x) => x.tags?.question)}`);
  L.push(`  質問で終えない:   ${rate((x) => !x.tags?.question)}`);
  L.push(`  LINE案内した:     ${rate((x) => x.tags?.line)}`);
  L.push(`  60字以下:         ${rate((x) => (x.tags?.chars ?? 0) <= 60)}`);
  L.push(`  61字以上:         ${rate((x) => (x.tags?.chars ?? 0) > 60)}`);
  L.push("  ※ 数が少ないうちは偶然の差が大きい。結論を急がない（09_自分たちで測る）");
}
L.push("");

// LINEリンクのクリック数(取れれば)
L.push("■ LINEリンクのクリック数（Threadsの数字）");
try {
  const token = process.env.THREADS_ACCESS_TOKEN;
  if (!token) throw new Error("トークンがありません");
  const me = await threads.me(token);
  const r = await threads.accountInsights(token, me.id, "clicks", Math.floor(from / 1000), Math.floor(now / 1000));
  const vals = r?.data?.[0]?.link_total_values ?? r?.data?.[0]?.values ?? [];
  if (!vals.length) L.push("  データなし");
  for (const v of vals) L.push(`  ${v.link_url ?? ""} ${v.value}回`);
} catch (err) {
  L.push(`  取れませんでした（${String(err.message).slice(0, 80)}）`);
}
L.push("  ※ 同じ週の LINE 友だち追加数は、九尾LINE の管理画面で見てください", "");

// 知らせ・送らなかったもの(点検が厳しすぎないかを見る)
const heavy = recs.filter((x) => x.type === "D");
L.push(`■ 重い相談（${heavy.length}件）`);
for (const x of heavy) L.push(`  ${x.at.slice(0, 10)} @${x.username}「${x.comment_text}」［${x.status}］`);
L.push("");

const notSent = recs.filter((x) => ["失敗", "返さない"].includes(x.status));
L.push(`■ 返さなかった・返せなかったもの（${notSent.length}件）…点検が厳しすぎないか見る`);
for (const x of notSent) L.push(`  @${x.username}「${x.comment_text.slice(0, 40)}」→ ${x.why}`);
L.push("");

L.push("■ 返信の一覧（おかしなものがないか）");
for (const x of recs.filter((y) => y.text)) {
  L.push(`  [${x.status}] @${x.username}「${x.comment_text.slice(0, 40)}」`, `      → ${x.text}`);
}

const dir = new URL("週報/", ROOT);
mkdirSync(dir, { recursive: true });
const file = new URL(`週報_${today}.txt`, dir);
writeFileSync(file, L.join("\r\n") + "\r\n", "utf8");
console.log(L.join("\n"));
console.log(`\n書き出しました: 週報/週報_${today}.txt`);
