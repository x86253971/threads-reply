// Cloudflare で動かすときの入口(設計案18章)。1分おきに起こされる。
//
// 毎分見るのは2日以内の投稿だけ。10分に1回は、最近10本ぜんぶを見る。
// 無料プランの制限(外への通信は1回50回まで・CPUは10ミリ秒)に収まるよう、1回の仕事は小さくする。
//
// KV(置き場)に置くもの
//   records          返信の記録(8章)。相手のコメントが入るので GitHub には上げない
//   drafts:日付      下書き・知らせ(段階1)。山崎さんは scripts/pull.js で取ってきて読む
//   token            延長して返ってきたトークン(11章)。あればこちらを使う
//   token_checked    最後にトークンを延長しようとした時刻
//   token_log        トークン延長の結果の記録
//   lock             見回り中の印(次の1分と重ならないように)

import { config } from "../lib/config.js";
import * as threads from "../lib/threads.js";
import { sweep, formatDraft, jstDate } from "../lib/sweep.js";
import { Book } from "../lib/records.js";

const RUN_MS = 50 * 1000;          // 1回の見回りはこれで終える(次の1分と重ならないように)
const FETCH_BUDGET = 40;           // 外への通信の上限(無料は50。余裕を持たせる)
const DAY = 24 * 3600 * 1000;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env, new Date(event.scheduledTime)));
  },
  // 外から開かれても何も出さない(中身は KV にしかない)
  async fetch() {
    return new Response("ok", { headers: { "content-type": "text/plain" } });
  },
};

export async function run(env, now = new Date()) {
  const started = Date.now();

  // 重なりよけ。前の回がまだ動いていたら、この回は何もしない
  const lock = Number(await env.KV.get("lock"));
  if (lock && started - lock < 60 * 1000) {
    console.log("前の回がまだ動いているので休みます");
    return;
  }
  await env.KV.put("lock", String(started), { expirationTtl: 120 });

  // 外への通信を数える(Threads・Gemini ぜんぶ。KV は別枠)
  let used = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (...args) => {
    used++;
    return realFetch(...args);
  };

  try {
    // AI の部品は process.env からキーを読むので、Cloudflare の Secrets を渡しておく
    if (globalThis.process?.env) process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;

    const token = (await env.KV.get("token")) ?? env.THREADS_ACCESS_TOKEN;
    if (!token || !env.GEMINI_API_KEY) {
      console.error("THREADS_ACCESS_TOKEN か GEMINI_API_KEY がありません(wrangler secret put で入れる)");
      return;
    }

    const records = JSON.parse((await env.KV.get("records")) ?? "[]");
    const book = new Book(records);
    const full = now.getUTCMinutes() % 10 === 0;

    const r = await sweep({
      token,
      book,
      opts: {
        recentHours: full ? null : 48,
        maxMade: 3,
        deadline: started + RUN_MS,
        shouldStop: () => used >= FETCH_BUDGET - 6,   // コメント1件で最大6回くらい使う
        noImage: true,
        waitBetween: [3, 8],
      },
    });

    console.log(
      `段階 ${config.stage} / ${full ? "ぜんぶ" : "最近だけ"} / 投稿 ${r.posts} / 決めた ${r.made} / 送った ${r.sent} / 下書き ${r.drafted} / 通信 ${used}回` +
        (r.stoppedEarly ? " / 途中で切り上げ" : "")
    );

    // 記録を置く。KV は書ける回数が1日1,000回なので、
    // 新しい記録が増えたときと、10分に1回(往復の印などの細かい書き換え)だけ書く
    if (book.added || (full && book.touched)) {
      await env.KV.put("records", JSON.stringify(book.trimmed()));
    }

    const draft = formatDraft(r, now);
    if (draft) {
      const key = `drafts:${jstDate(now)}`;
      const old = (await env.KV.get(key)) ?? "";
      await env.KV.put(key, old + draft, { expirationTtl: 60 * 24 * 3600 });
    }

    // 1日1回、トークンを延長する(60日で切れるため)
    const checked = Number(await env.KV.get("token_checked"));
    // パソコンで試すとき(SKIP_REFRESH)は延長しない。新しいトークンが試し用の置き場にしか残らなくなるため
    if (!env.SKIP_REFRESH && (!checked || started - checked > DAY)) await refresh(env, token, started);
  } catch (err) {
    console.error("止まりました:", err?.stack ?? err);
  } finally {
    globalThis.fetch = realFetch;
    await env.KV.delete("lock");
  }
}

// 11章。延長して返ってきたトークンは KV に置き、次からはそれを使う
async function refresh(env, token, now) {
  await env.KV.put("token_checked", String(now));
  let line;
  try {
    const { token: next, expiresInSec } = await threads.refreshToken(token);
    const days = Math.round(expiresInSec / 86400);
    if (next && next !== token) {
      await env.KV.put("token", next);
      line = `延長しました。あと${days}日(★文字列が変わったので KV に保存)`;
    } else {
      line = `延長しました。あと${days}日(文字列は同じ)`;
    }
  } catch (err) {
    line = `延長は見送り: ${String(err.message).slice(0, 120)}`;
  }
  console.log("[token] " + line);
  const log = (await env.KV.get("token_log")) ?? "";
  await env.KV.put("token_log", (log + `${new Date(now).toISOString()} ${line}\n`).slice(-5000));
}
