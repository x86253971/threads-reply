// 通信せずに、判断の部分だけを確かめる。
//   node scripts/selftest.js
//
// ここが通っていれば「誰に返すか・誰に返さないか」は正しい。
// 実際に送れるかどうかは、node index.js --dry で見る。

import { pickTargets, isQuiet, allowedToSend, threadWith, formatDraft, config } from "../lib/sweep.js";
import { inspect, similarity } from "../lib/check.js";
import { Book } from "../lib/records.js";
import { decide } from "../lib/brain.js";

let ok = 0;
let ng = 0;
const check = (name, cond) => {
  if (cond) { ok++; console.log("  ok   " + name); }
  else { ng++; console.log("  FAIL " + name); }
};
const head = (t) => console.log("\n[" + t + "]");

const ME = "kyubi";
const POST = "p1";

// 投稿 p1 にぶら下がった会話のひな形
const conv = (extra = []) => [
  { id: "c1", username: "aoi", text: "わかります…", replied_to: { id: POST }, timestamp: "2026-10-07T01:00:00Z" },
  ...extra,
];

head("返す相手の選び方");

check("投稿へのコメントは返す対象になる",
  pickTargets(conv(), ME, POST).map((x) => x.id).includes("c1"));

check("自分の発言には返さない",
  pickTargets([{ id: "x", username: ME, text: "こんばんは", replied_to: { id: POST } }], ME, POST).length === 0);

check("すでに返したコメントには返さない",
  pickTargets(conv([
    { id: "r1", username: ME, text: "ありがとうございます", replied_to: { id: "c1" } },
  ]), ME, POST).length === 0);

check("自分の返信への返事も拾う",
  pickTargets([
    { id: "c1", username: "aoi", text: "わかります", replied_to: { id: POST } },
    { id: "r1", username: ME, text: "ありがとうございます", replied_to: { id: "c1" } },
    { id: "c2", username: "aoi", text: "ほんとですか？", replied_to: { id: "r1" } },
  ], ME, POST).map((x) => x.id).join(",") === "c2");

check("他人どうしの会話には割り込まない",
  pickTargets([
    { id: "c1", username: "aoi", text: "わかります", replied_to: { id: POST } },
    { id: "c2", username: "mei", text: "それな", replied_to: { id: "c1" } },
  ], ME, POST).map((x) => x.id).join(",") === "c1");

check("中身の無いコメントは飛ばす",
  pickTargets([{ id: "c9", username: "aoi", text: "！", replied_to: { id: POST } }], ME, POST).length === 0);

const cap = Number(config.limits.replies_per_person_per_post);
check(`同じ人には1つの投稿で${cap}回まで`, (() => {
  const items = [];
  for (let i = 0; i < cap; i++) {
    items.push({ id: `c${i}`, username: "aoi", text: "あ".repeat(5), replied_to: { id: POST } });
    items.push({ id: `r${i}`, username: ME, text: "はい", replied_to: { id: `c${i}` } });
  }
  items.push({ id: "cN", username: "aoi", text: "まだ話したいです", replied_to: { id: POST } });
  return pickTargets(items, ME, POST).length === 0;
})());

head("休む時間帯");
const at = (h) => new Date(Date.UTC(2026, 9, 7, h - 9, 0, 0));   // 日本時間で h 時
check(`${config.quiet_hours.from}時〜${config.quiet_hours.to}時は休む`, isQuiet(at(3)) === true);
check("昼間は休まない", isQuiet(at(14)) === false);
check("夜21時は休まない", isQuiet(at(21)) === false);

head("往復の続きの見分け");
check("投稿へのコメントは往復の続きではない",
  pickTargets(conv(), ME, POST)[0].followup === false);
check("九尾の返信への返事は往復の続き",
  pickTargets([
    { id: "c1", username: "aoi", text: "わかります", replied_to: { id: POST } },
    { id: "r1", username: ME, text: "ありがとうございます", replied_to: { id: "c1" } },
    { id: "c2", username: "aoi", text: "ほんとですか？", replied_to: { id: "r1" } },
  ], ME, POST)[0].followup === true);
check("やりとりには、いま返すコメント自身は入らない", (() => {
  const items = [
    { id: "c1", username: "aoi", text: "わかります", replied_to: { id: POST }, timestamp: "1" },
    { id: "r1", username: ME, text: "ありがとうございます", replied_to: { id: "c1" }, timestamp: "2" },
    { id: "c2", username: "aoi", text: "ほんとですか？", replied_to: { id: "r1" }, timestamp: "3" },
    { id: "c3", username: "mei", text: "別の人", replied_to: { id: POST }, timestamp: "4" },
  ];
  const h = threadWith(items, ME, "aoi", "c2");
  return h.length === 2 && h[0].who === "相手" && h[1].who === "九尾";
})());

head("段階(10章)");
const saved = config.stage;
config.stage = 1;
check("段階1は何も送らない", !allowedToSend("A", "A") && !allowedToSend("D", "D"));
config.stage = 2;
check("段階2は感想(A)だけ送る", allowedToSend("A", "A") && !allowedToSend("B", "B"));
check("段階2では、往復の続きでも感想なら送る", allowedToSend("G", "A"));
check("段階2では重い相談は送らない", !allowedToSend("D", "D"));
config.stage = 3;
check("段階3は送る", allowedToSend("B", "B"));
config.stage = saved;

head("送る前の点検(6章)");
const good = "3年も言い聞かせてきたんですね。その踏ん張り、ちゃんと見えていますよ。";
check("ふつうの返信は通る", inspect(good).ok);
check("短すぎるのは落とす", !inspect("はい").ok);
check("「必ず」は落とす", !inspect("必ずうまくいきますよ、大丈夫です。安心してくださいね。").ok);
check("「このままだと」は落とす", !inspect("このままだと流れが止まってしまうかもしれません、気をつけて。").ok);
check("URLは落とす", !inspect("こちらを見てください https://example.com よければどうぞ。").ok);
check("案内しない相手にLINEの話はしない", !inspect("よければ公式LINEでゆっくりお話を聞かせてくださいね。").ok);
check("案内する相手ならLINEの話はよい", inspect("よければプロフィールの公式LINEで、ゆっくりお話を聞かせてくださいね。", { guideLine: true }).ok);
check("コメント欄で生年月日を聞かない", !inspect("よければ生年月日を教えてください、少し見てみますね。").ok);
check("LINEの案内の中なら生年月日に触れてよい", inspect("LINEでは生年月日から一人ずつ見られます。よければプロフィールからどうぞ。", { guideLine: true }).ok);
check("同じ文の繰り返しは落とす", !inspect(good, { recent: [good] }).ok);
check("少し言い回しが似ているだけなら通る",
  inspect(good, { recent: ["書いてくださってありがとうございます。今日は少し休めるといいですね。"] }).ok);
check("似かたの数字: 同じ文は1", similarity(good, good) === 1);

head("記録(8章)");
const book = new Book([
  { comment_id: "1", username: "aoi", status: "送信", at: new Date().toISOString(), tags: { line: true }, text: "a" },
  { comment_id: "2", username: "mei", status: "送信", at: "2000-01-01T00:00:00Z", text: "b" },
  { comment_id: "3", username: "sora", post_id: "p1", type: "D", status: "下書き", at: new Date().toISOString() },
]);
check("直近24時間に送った数を数える", book.sentLast24h() === 1);
check("LINE案内した人を覚えている", book.lineGuided("aoi") && !book.lineGuided("mei"));
check("重い相談をした人を覚えている", book.heavyBefore("p1", "sora") && !book.heavyBefore("p2", "sora"));

head("重い相談(9章) ※AIを呼ばずに決まる部分");
const d1 = await decide({ post: { id: "p1", text: "投稿" }, comment: { text: "もう消えたいです" }, book: new Book([]), username: "x" });
check("言葉で重い相談を拾う", d1.type === "D");
check("決まった文で返し、知らせる", d1.text === config.heavy.reply && Boolean(d1.notice));
check("重い相談の返し文にLINEの案内がない", !/LINE|ライン/.test(config.heavy.reply));
const d2 = await decide({ post: { id: "p1", text: "投稿" }, comment: { text: "ありがとう" }, followup: true, book, username: "sora" });
check("重い相談のあとの往復は自動で続けない", d2.text === null && Boolean(d2.notice));

head("絵文字だけのコメント(AIを呼ばない)");
for (const e of ["🦊", "🦊🦊", "🙏✨", "！！", "🌸 "]) {
  const d = await decide({ post: { id: "p1", text: "投稿" }, comment: { text: e }, book: new Book([]), username: "x" });
  check(`「${e}」は返さない`, d.type === "F" && d.text === null);
}

head("下書きの書き出し");
check("何もなければ空", formatDraft({ lines: [], notices: [], label: "段階1" }) === "");
check("知らせが先頭に出る", formatDraft({ lines: ["a"], notices: ["重い相談"], label: "段階1" }).indexOf("知らせ") < formatDraft({ lines: ["a"], notices: ["重い相談"], label: "段階1" }).indexOf("  a"));

head("設定の見落とし");
check("ペルソナが書かれている", (config.persona ?? []).length > 0);
check("重い話のときの文がある", Boolean(config.heavy?.reply));
check("1回あたりの上限がある", Number(config.limits?.replies_per_run) > 0);
check("1日の上限がある", Number(config.limits?.replies_per_day) > 0);
check("段階が1〜3", [1, 2, 3].includes(Number(config.stage)));

console.log(`
結果: ${ok} passed, ${ng} failed`);
process.exit(ng ? 1 : 0);
