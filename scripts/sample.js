// 架空のコメントを使って、どんな返事になるかを見る。
//   node scripts/sample.js
//
// Threadsには一切つながりません。記録も残しません。文面と仕分けの出来だけを見るためのもの。
// config.json の persona や、lib/ai.js の指示を直したら、これで確かめる。

import { decide } from "../lib/brain.js";
import { Book } from "../lib/records.js";

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
      "占ってもらえますか？1994年3月2日生まれです",
    ],
  },
  {
    post: "秋は、手放す季節だと言われます。\nでも無理に手放さなくていい。\n握っていた指の力を、少し緩めるだけで十分です。",
    comments: [
      "もう疲れました。消えたいです",
      "はじめまして。フォローしました🌸",
      "副業で月50万！詳しくはプロフへ",
      "🙏",
    ],
  },
];

// 記録は空のまま使う(本物の記録には書かない)。ただし繰り返しの点検は、この中で効かせる
const book = new Book([]);
let n = 0;

for (const c of CASES) {
  console.log("\n" + "=".repeat(64));
  console.log("【九尾の投稿】");
  console.log(c.post.split("\n").map((l) => "  " + l).join("\n"));
  console.log("=".repeat(64));
  for (const text of c.comments) {
    const username = `sample${++n}`;
    const d = await decide({ post: { id: "sample", text: c.post }, comment: { text }, book, username });
    console.log(`\n  コメント  ${text}`);
    console.log(`  種類      ${d.type ?? "?"}（${d.reason || "-"}）`);
    if (d.text) {
      const tags = [d.tags?.line ? "LINE案内" : "", d.tags?.question ? "質問で終える" : ""].filter(Boolean).join("・");
      console.log(`  返事　　  ${d.text}`);
      console.log(`            （${d.text.length}字${tags ? "・" + tags : ""}）`);
    } else {
      console.log(`  返事　　  （返さない：${d.why}）`);
    }
    if (d.notice) console.log(`  ★知らせ  ${d.notice}`);
    if (d.text) book.put({ comment_id: username, username, type: d.type, text: d.text, tags: d.tags, status: "下書き", at: new Date().toISOString() });
  }
}
console.log("");
