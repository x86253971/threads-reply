// 通信せずに、判断の部分だけを確かめる。
//   node scripts/selftest.js
//
// ここが通っていれば「誰に返すか・誰に返さないか」は正しい。
// 実際に送れるかどうかは、node index.js --dry で見る。

import { pickTargets, isQuiet, config } from "../lib/sweep.js";

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

head("設定の見落とし");
check("ペルソナが書かれている", (config.persona ?? []).length > 0);
check("重い話のときの決まった文がある", Boolean(config.guard?.sensitive_reply));
check("生成に失敗したときの文がある", (config.guard?.fallback_replies ?? []).length > 0);
check("1回あたりの上限がある", Number(config.limits?.replies_per_run) > 0);

console.log(`\n結果: ${ok} passed, ${ng} failed`);
process.exit(ng ? 1 : 0);
