// 1回ぶんの見回り。
//
// 新しい投稿から順に会話を見て、まだ返していないコメントに返事をする。
//
// 「もう返したか」は、どこにも記録していない。Threadsに聞けば分かるため。
// 会話の中に、自分の名前で、そのコメント宛ての返信があれば返事済み。
// 記録を持たないので、壊れる場所がひとつ減る。
// (前の仕組みは返信済みidをファイルに持っていて、消えると二重に返す恐れがあった)

import { readFileSync } from "node:fs";
import * as threads from "./threads.js";
import * as ai from "./ai.js";

const config = JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8"));
const sleep = (sec) => new Promise((r) => setTimeout(r, sec * 1000));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** いまが休む時間かどうか。深夜に即レスが続くと、人がやっているように見えない */
export function isQuiet(now = new Date()) {
  const { from, to } = config.quiet_hours ?? {};
  if (from == null || to == null) return false;
  // ja-JP だと「03時」のように時の字が付いてくるので en-GB で取る
  const h = Number(now.toLocaleString("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", hour12: false })) % 24;
  return from < to ? h >= from && h < to : h >= from || h < to;
}

/** 会話から、返すべきコメントを拾う */
export function pickTargets(items, myName, postId) {
  const limits = config.limits ?? {};
  const maxPerPerson = Number(limits.replies_per_person_per_post ?? 3);

  const author = new Map(items.map((x) => [x.id, x.username]));
  author.set(postId, myName);

  // 自分が出した返信。誰に向けたものかを数えておく
  const minePerUser = new Map();
  const repliedTo = new Set();
  for (const x of items) {
    if (x.username !== myName || !x.replied_to?.id) continue;
    repliedTo.add(x.replied_to.id);
    const to = author.get(x.replied_to.id);
    if (to) minePerUser.set(to, (minePerUser.get(to) ?? 0) + 1);
  }

  const out = [];
  for (const c of items) {
    if (c.username === myName) continue;                      // 自分の発言
    if (!c.text || c.text.trim().length < 2) continue;        // 中身がない
    if (repliedTo.has(c.id)) continue;                        // もう返した
    const parent = c.replied_to?.id;
    if (!parent) continue;

    // 自分の投稿か、自分の返信に向けられたものだけ。
    // 他人どうしの会話に横から入らない
    const directed = parent === postId || author.get(parent) === myName;
    if (!directed) continue;

    if ((minePerUser.get(c.username) ?? 0) >= maxPerPerson) continue;  // 粘着に見える
    out.push(c);
  }
  return out;
}

/** その人とのこれまでのやりとりを、AIに渡せる形で取り出す */
function threadWith(items, myName, username) {
  const author = new Map(items.map((x) => [x.id, x.username]));
  return items
    .filter((x) => x.username === username || (x.username === myName && author.get(x.replied_to?.id) === username))
    .sort((a, b) => String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")))
    .slice(-6)
    .map((x) => ({ who: x.username === myName ? "自分" : "相手", text: String(x.text ?? "").slice(0, 300) }));
}

/** コメントの中身を見て、どう返すか決める */
async function compose({ post, comment, mine }) {
  const g = config.guard ?? {};
  const text = String(comment.text ?? "");

  // つらい話にAIの作文で返さない。決まった文で、受け止めてLINEへ寄せる
  if ((g.sensitive_words ?? []).some((w) => text.includes(w))) {
    return { text: g.sensitive_reply, by: "決まった文(重い話)" };
  }

  const out = await ai.writeReply({ config, post, comment, mine });
  if (!out) return { text: pick(g.fallback_replies ?? ["ありがとうございます。"]), by: "決まった文(生成できず)" };

  const hit = (g.ng_words ?? []).filter((w) => out.includes(w));
  if (hit.length) {
    console.log(`  使えない言葉が入ったので差し替え: ${hit.join("、")}`);
    return { text: pick(g.fallback_replies ?? ["ありがとうございます。"]), by: "決まった文(NG)" };
  }
  return { text: out, by: "AI" };
}

/**
 * 見回りを1回ぶん。
 * dryRun のときは、何を返すつもりかを出すだけで送らない。
 */
export async function sweep({ token, dryRun = false } = {}) {
  const limits = config.limits ?? {};
  const result = { posts: 0, targets: 0, sent: 0, skipped: [], lines: [] };

  if (isQuiet()) {
    result.skipped.push("休む時間帯なので何もしません");
    return result;
  }

  const who = await threads.me(token);
  const myName = who.username;
  console.log(`[threads] @${myName} として見回ります${dryRun ? "（下書き確認のみ・送りません）" : ""}`);

  const posts = await threads.myPosts(token, Number(limits.posts_per_run ?? 10));
  result.posts = posts.length;

  for (const post of posts) {
    if (result.sent >= Number(limits.replies_per_run ?? 12)) break;

    let items = [];
    try {
      items = await threads.conversation(token, post.id);
    } catch (err) {
      console.error(`  会話を取れませんでした post=${post.id}: ${err.message}`);
      continue;
    }
    const targets = pickTargets(items, myName, post.id);
    if (!targets.length) continue;
    result.targets += targets.length;

    for (const c of targets) {
      if (result.sent >= Number(limits.replies_per_run ?? 12)) break;

      const mine = threadWith(items, myName, c.username);
      const { text, by } = await compose({ post, comment: c, mine });

      const line = `@${c.username}「${String(c.text).slice(0, 40)}」\n    → ${text}  [${by}]`;
      result.lines.push(line);
      console.log(`  ${line}`);

      if (dryRun) continue;

      try {
        await threads.reply(token, c.id, text, Number(limits.wait_after_create_sec ?? 10));
        result.sent++;
        await sleep(Number(limits.wait_between_replies_sec ?? 15));
      } catch (err) {
        console.error(`  返信を送れませんでした comment=${c.id}: ${err.message}`);
      }
    }
  }
  return result;
}

export { config };
