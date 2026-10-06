// 架空のコメントを使って、どんな返事になるかを見る。
//   node scripts/sample.js
//
// Threadsには一切つながりません。文面の出来だけを見るためのもの。
// config.json の persona や、lib/ai.js の指示を直したら、これで確かめる。

import { existsSync, readFileSync } from "node:fs";
import * as ai from "../lib/ai.js";
import { config } from "../lib/sweep.js";

const envFile = new URL("../.env", import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

// 九尾が書きそうな投稿と、付きそうなコメントを並べた
const CASES = [
  {
    post: "「もう少し頑張れば報われる」と思って踏ん張っている人ほど、\nいちばん先に壊れます。\n報われるかどうかは、あなたの頑張りでは決まらないからです。",
    comments: [
      "ほんとそれです…もう3年言い聞かせてます",
      "じゃあどうすればいいんですか",
      "わかりみが深い",
    ],
  },
  {
    post: "返信が来なくなった相手のことを、\n毎日何度も考えてしまう。\nそれは未練ではなく、途中で終わったことへの引っかかりです。",
    comments: [
      "既読だけついて3週間です。もう諦めたほうがいいですよね",
      "占ってもらえますか？",
    ],
  },
  {
    post: "秋は、手放す季節だと言われます。\nでも無理に手放さなくていい。\n握っていた指の力を、少し緩めるだけで十分です。",
    comments: [
      "もう疲れました。消えたいです",
      "はじめまして。フォローしました🌸",
    ],
  },
];

const guard = config.guard ?? {};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

async function one(post, text) {
  if ((guard.sensitive_words ?? []).some((w) => text.includes(w))) {
    return { out: guard.sensitive_reply, by: "決まった文（重い話）" };
  }
  const out = await ai.writeReply({ config, post: { text: post }, comment: { text }, mine: [] });
  if (!out) return { out: pick(guard.fallback_replies), by: "決まった文（生成できず）" };
  const hit = (guard.ng_words ?? []).filter((w) => out.includes(w));
  if (hit.length) return { out: pick(guard.fallback_replies), by: `決まった文（NG: ${hit.join("、")}）` };
  return { out, by: "AI" };
}

for (const c of CASES) {
  console.log("\n" + "=".repeat(64));
  console.log("【九尾の投稿】");
  console.log(c.post.split("\n").map((l) => "  " + l).join("\n"));
  console.log("=".repeat(64));
  for (const text of c.comments) {
    const { out, by } = await one(c.post, text);
    console.log(`\n  コメント  ${text}`);
    console.log(`  返事　　  ${out}`);
    console.log(`            （${out.length}文字 / ${by}）`);
  }
}
console.log("");
