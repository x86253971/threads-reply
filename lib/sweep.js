// 1回ぶんの見回り(2章の①〜⑨)。
//
// 新しい投稿から順に会話を見て、まだ返していないコメントについて
// brain.js に「どう返すか」を決めさせ、段階(10章)に応じて送るか下書きに残す。
//
// 「もう返したか」は Threads に聞けば分かる。
// 会話の中に、自分の名前で、そのコメント宛ての返信があれば返事済み。
// (前の仕組みは返信済みidをファイルに持っていて、消えると二重に返す恐れがあった)
// 記録(records.js)は、測るためと、下書きを何度も作り直さないためのもの。

import { mkdirSync, appendFileSync } from "node:fs";
import { config, ROOT } from "./config.js";
import * as threads from "./threads.js";
import * as ai from "./ai.js";
import { decide } from "./brain.js";
import { Book } from "./records.js";

// 公開リポジトリの GitHub Actions はログが誰でも見られる。
// そこでは相手のユーザー名・コメント・下書きの文を出さない(設計案17章)
const PUBLIC_LOG = Boolean(process.env.GITHUB_ACTIONS);
const show = (s) => { if (!PUBLIC_LOG) console.log(s); };

const sleep = (sec) => new Promise((r) => setTimeout(r, sec * 1000));
const between = (v) => (Array.isArray(v) ? v[0] + Math.random() * (v[1] - v[0]) : Number(v ?? 15));

const jst = (d = new Date()) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString();
const jstDate = (d) => jst(d).slice(0, 10);
const jstTime = (d) => jst(d).slice(11, 16);

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
    out.push({ ...c, followup: parent !== postId });
  }
  return out;
}

/** その人とのこれまでのやりとりを、AIに渡せる形で取り出す(同じ投稿の中だけ) */
export function threadWith(items, myName, username, uptoId) {
  const author = new Map(items.map((x) => [x.id, x.username]));
  const n = Number(config.reply?.history_items ?? 20);
  return items
    .filter((x) => x.id !== uptoId)
    .filter((x) => x.username === username || (x.username === myName && author.get(x.replied_to?.id) === username))
    .sort((a, b) => String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")))
    .slice(-n)
    .map((x) => ({ who: x.username === myName ? "九尾" : "相手", text: String(x.text ?? "").slice(0, 300) }));
}

/** 段階(10章)と種類から、送ってよいか */
export function allowedToSend(kind, type) {
  const stage = Number(config.stage ?? 1);
  if (stage >= 3) return true;
  if (stage === 2) return (config.stage2_send_types ?? []).includes(type) && kind !== "D";
  return false;
}

/** この記録のコメントは、もう触らなくてよいか */
function settled(rec) {
  if (!rec) return false;
  if (rec.status === "失敗") return (rec.attempts ?? 1) >= Number(config.limits?.max_attempts ?? 2);
  return true;
}

/**
 * 見回りを1回ぶん。
 * dryRun のときは、何を返すつもりかを画面に出すだけ。送らず、記録も下書きも残さない。
 */
export async function sweep({ token, dryRun = false } = {}) {
  const limits = config.limits ?? {};
  const stage = Number(config.stage ?? 1);
  const result = { posts: 0, made: 0, sent: 0, drafted: 0, held: 0, skipped: [], lines: [], notices: [] };

  if (isQuiet()) {
    result.skipped.push("休む時間帯なので何もしません");
    return result;
  }

  const book = new Book();
  const who = await threads.me(token);
  const myName = who.username;
  const label = dryRun ? "画面に出すだけ" : stage === 1 ? "段階1・下書きだけ" : stage === 2 ? "段階2・一部だけ送る" : "段階3・送る";
  console.log(`[threads] @${myName} として見回ります（${label}）`);

  const posts = await threads.myPosts(token, Number(limits.posts_per_run ?? 10));
  result.posts = posts.length;
  const perRun = Number(limits.replies_per_run ?? 12);
  const perDay = Number(limits.replies_per_day ?? 100);
  const minWait = Number(limits.min_wait_minutes ?? 0) * 60 * 1000;

  for (const post of posts) {
    if (result.made >= perRun) break;

    let items = [];
    try {
      items = await threads.conversation(token, post.id);
    } catch (err) {
      console.error(`  会話を取れませんでした post=${post.id}: ${err.message}`);
      continue;
    }

    // 8章 送った返信に、相手がさらに返してきたか(往復になったか)
    for (const x of items) {
      const rec = x.replied_to?.id && book.byMyReply(x.replied_to.id);
      if (rec && x.username === rec.username && !rec.got_reply) rec.got_reply = true;
    }

    const targets = pickTargets(items, myName, post.id).filter((c) => !settled(book.get(c.id)));
    if (!targets.length) continue;

    // 画像1枚の投稿なら画像も見せる(複数枚・動画は文字だけ)
    const image = config.reply?.use_post_image !== false && post.media_type === "IMAGE" ? await ai.loadImage(post.media_url) : null;

    for (const c of targets) {
      if (result.made >= perRun) break;
      if (minWait && Date.now() - Date.parse(c.timestamp) < minWait) continue;   // まだ待つ

      const history = threadWith(items, myName, c.username, c.id);
      const d = await decide({ post, comment: c, history, followup: c.followup, image, book, username: c.username });
      result.made++;

      // 送るか、下書きにするか
      let status = d.status;
      let why = d.why;
      if (d.status === "作った") {
        if (dryRun) status = "画面だけ";
        else if (!allowedToSend(d.kind, d.type)) {
          status = "下書き";
          why = stage === 1 ? "段階1なので送らない" : "段階2では送らない種類";
        } else if (book.sentLast24h() >= perDay) {
          status = "下書き";
          why = `1日の上限(${perDay}件)に達した`;
          result.held++;
        } else status = "送る";
      }

      let myReplyId = null;
      if (status === "送る") {
        try {
          myReplyId = await threads.reply(token, c.id, d.text, Number(limits.wait_after_create_sec ?? 10));
          status = "送信";
          result.sent++;
          await sleep(between(limits.wait_between_replies_sec));
        } catch (err) {
          status = "失敗";
          why = `送れなかった: ${err.message.slice(0, 120)}`;
        }
      }
      if (status === "下書き") result.drafted++;

      const typeLabel = c.followup ? `${d.type ?? "?"}→G` : d.type ?? "?";
      const tags = [d.tags?.line ? "LINE案内" : "", d.tags?.question ? "質問で終える" : ""].filter(Boolean).join("・");
      const line =
        `@${c.username}「${String(c.text).replace(/\s+/g, " ").slice(0, 60)}」\n` +
        `    種類 ${typeLabel}（${d.reason || "-"}）\n` +
        (d.text ? `    → ${d.text}\n      （${d.text.length}字${tags ? "・" + tags : ""}）\n` : "") +
        `    ［${status}${why ? "：" + why : ""}］`;
      result.lines.push(line);
      show("  " + line.replace(/\n/g, "\n  "));
      if (d.notice) result.notices.push(d.notice);

      if (dryRun) continue;
      const old = book.get(c.id);
      book.put({
        comment_id: c.id,
        post_id: post.id,
        username: c.username,
        comment_text: String(c.text).slice(0, 120),
        comment_at: c.timestamp,
        at: new Date().toISOString(),
        followup: c.followup,
        type: d.type,
        kind: d.kind,
        reason: d.reason,
        text: d.text,
        tags: d.tags,
        status,
        why,
        my_reply_id: myReplyId,
        got_reply: false,
        attempts: (old?.attempts ?? 0) + 1,
        model: config.ai?.model,
      });
    }
  }

  if (!dryRun) {
    book.save();
    writeDraftFile(result, label);
  }
  return result;
}

/** 下書きの一覧を、メモ帳で読める形で日ごとのファイルに足していく(10章 段階1) */
function writeDraftFile(result, label) {
  if (!result.lines.length && !result.notices.length) return;
  const now = new Date();
  const dir = new URL("下書き/", ROOT);
  mkdirSync(dir, { recursive: true });
  const file = new URL(`${jstDate(now)}.txt`, dir);
  const parts = [
    "",
    "=".repeat(64),
    `${jstDate(now)} ${jstTime(now)} の見回り（${label}）`,
    "=".repeat(64),
  ];
  if (result.notices.length) {
    parts.push("", "★ 山崎さんへの知らせ");
    for (const n of result.notices) parts.push("  ・" + n);
  }
  for (const l of result.lines) parts.push("", "  " + l.replace(/\n/g, "\n  "));
  parts.push("");
  appendFileSync(file, parts.join("\r\n").replace(/(?<!\r)\n/g, "\r\n"), "utf8");
}

export { config };
