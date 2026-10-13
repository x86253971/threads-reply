// デモ：まねの Threads の上で、見回り・仕分け・作文・点検・記録を本物と同じ部品で動かす。
//   node scripts/demo.js
//
// 本物の Threads には一切つながらない(投稿もしない・返信も送らない)。
// AI(Gemini)だけは本物を使う。記録はこの中だけで、ファイルにも残さない。
// 段階は、このデモの中だけ 3(送る)にして、往復がどう続くかを見る。
//
// 流れ
//   1回目の見回り：投稿についたコメント8件に返す
//   相手が返してくる(まねの人たちが、九尾の返信にもう一度書く)
//   2回目の見回り：往復の続きに返す(それまでのやりとりを覚えているか)

import "../lib/local.js";   // .env を読む(Gemini のキー)
import { sweep, config } from "../lib/sweep.js";
import { Book } from "../lib/records.js";

config.stage = 3;   // このデモの中だけ。config.json は書き換えない

const ME = "kyubi_kyukon";
const POST = {
  id: "demo-post",
  media_type: "TEXT_POST",
  timestamp: new Date(Date.now() - 3600 * 1000).toISOString(),
  // 九尾の 10/7 の本物の投稿の文
  text: "明日の一粒万倍日、\n何かを「始める」のはやめてください。\n\n九尾が見るに、明日は「やめる」が万倍になる日。\n\n・なんとなく開くSNS\n・義理だけの付き合い\n・寝る前のダラダラ\n\n惰性をひとつ手放すと、\n空いた場所に新しい縁が流れ込みます。\n\nあなたが明日手放すものを、コメントに一言だけ置いていってください。",
};

// まねの Threads。会話はこの配列に溜まっていく
let seq = 0;
const items = [];
const say = (username, text, replyTo = POST.id) => {
  const it = { id: `c${++seq}`, username, text, replied_to: { id: replyTo }, timestamp: new Date(Date.now() + seq * 1000).toISOString() };
  items.push(it);
  return it;
};
const api = {
  me: async () => ({ id: "me", username: ME }),
  myPosts: async () => [POST],
  conversation: async () => items.map((x) => ({ ...x })),
  reply: async (_t, commentId, text) => say(ME, text, commentId).id,
};

// 九尾の返信のうち、この人あての最後のもの
const lastReplyTo = (username) => {
  const mine = items.filter((x) => x.username === ME && items.find((y) => y.id === x.replied_to.id)?.username === username);
  return mine.at(-1);
};

// 会話を、Threads の画面のように並べて出す
function show(title) {
  console.log("\n" + "=".repeat(70) + "\n" + title + "\n" + "=".repeat(70));
  const children = (id) => items.filter((x) => x.replied_to.id === id);
  const walk = (id, depth) => {
    for (const x of children(id)) {
      const who = x.username === ME ? "九尾" : "@" + x.username;
      const pad = "    ".repeat(depth);
      console.log(`${pad}${depth ? "└ " : "■ "}${who}：${x.text}`);
      walk(x.id, depth + 1);
    }
  };
  walk(POST.id, 0);
}

async function patrol(n, book) {
  console.log(`\n--- ${n}回目の見回り（AIが考えています…）---`);
  const r = await sweep({ token: "demo", book, api, opts: { waitBetween: [0, 0] } });
  console.log(`  返し方を決めた ${r.made}件 / 送った ${r.sent}件`);
  for (const nt of r.notices) console.log(`  ★山崎さんへの知らせ：${nt}`);
  const skipped = book.list.filter((x) => x.status !== "送信" && x.status !== "下書き");
  return skipped;
}

// ---- 1回目：投稿についたコメント
say("aoi_0412", "義理の飲み会を手放します…毎回断れなくて疲れてました");
say("mei.mei", "寝る前のスマホ、ほんとそれです");
say("sora_fox", "🦊");
say("riku_days", "惰性ってどうやったらやめられるんですか？");
say("hana_77", "占ってほしいです！1990年5月5日生まれです");
say("yui_night", "もう全部どうでもいい。消えたい");
say("money_fukugyo", "副業で月30万！詳しくはプロフへ");
say("ken_k", "元彼のLINEを見返す癖を手放します");

const book = new Book([]);
await patrol(1, book);
show("1回目の見回りのあと");

// ---- 相手がもう一度書く(九尾の返信への返事)
const back = [
  ["aoi_0412", "ありがとうございます。でも断ったら嫌われそうで怖いです"],
  ["riku_days", "もっと詳しく知りたいです。ちゃんと見てほしい"],
  ["ken_k", "そうなんです、つい見ちゃうんですよね😂"],
  ["yui_night", "ありがとう"],
];
for (const [u, t] of back) {
  const r = lastReplyTo(u);
  if (r) say(u, t, r.id);
}

await patrol(2, book);
show("2回目の見回りのあと（往復の続き）");

// ---- 記録のまとめ
console.log("\n" + "=".repeat(70) + "\n記録（どう仕分けて、どうしたか）\n" + "=".repeat(70));
const NAMES = { A: "感想", B: "質問・相談", C: "占ってほしい", D: "重い相談", E: "荒らし・宣伝", F: "返事が要らない" };
for (const x of book.list) {
  const tags = [x.tags?.line ? "LINE案内" : "", x.tags?.remind ? "LINE再案内" : "", x.tags?.question ? "質問で終える" : ""].filter(Boolean).join("・");
  console.log(
    `  @${x.username.padEnd(14)} ${x.followup ? "往復の続き " : ""}${x.type}(${NAMES[x.type] ?? "?"}) → ${x.status}` +
      `${x.why ? "：" + x.why : ""}${tags ? "［" + tags + "］" : ""}`
  );
}
console.log("");
