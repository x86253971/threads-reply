// 入口。10分おきに呼ばれる想定。
//
//   node index.js            config.json の stage どおりに動く(段階1なら下書きだけ)
//   node index.js --dry      何を返すつもりかを画面に出すだけ。送らず、記録も下書きも残さない
//
// 止まったことに気づけるよう、具合が悪いときは異常終了する。
// GitHub Actions は失敗するとメールをくれるので、黙って止まり続けることがない。
// (前の仕組みは静かに止まり、2週間誰も気づかなかった)

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { config, ENV_FILE, ROOT } from "./lib/config.js";
import * as threads from "./lib/threads.js";
import { sweep } from "./lib/sweep.js";
import * as ai from "./lib/ai.js";

const dryRun = process.argv.includes("--dry");

async function main() {
  const token = process.env.THREADS_ACCESS_TOKEN;
  if (!token) {
    console.error("THREADS_ACCESS_TOKEN がありません。.env か GitHub の Secrets に入れてください");
    process.exit(1);
  }
  if (!ai.isEnabled()) {
    console.error("GEMINI_API_KEY がありません。.env か GitHub の Secrets に入れてください");
    process.exit(1);
  }

  // トークンが生きているか。死んでいたらここで異常終了して知らせる
  try {
    const who = await threads.me(token);
    console.log(`[token] 生きています @${who.username}`);
  } catch (err) {
    console.error("[token] 使えません。新しいトークンを取り直してください");
    console.error("        " + err.message);
    process.exit(1);
  }

  const r = await sweep({ token, dryRun });

  console.log("");
  console.log(`段階 ${config.stage} / 見た投稿 ${r.posts}件 / 返し方を決めた ${r.made}件 / 送った ${r.sent}件 / 下書き ${r.drafted}件`);
  for (const s of r.skipped) console.log(`  ${s}`);
  // 知らせには相手の名前とコメントが入る。公開ログ(GitHub)では件数だけ
  if (process.env.GITHUB_ACTIONS) { if (r.notices.length) console.log(`  ★知らせ ${r.notices.length}件`); }
  else for (const n of r.notices) console.log(`  ★知らせ: ${n}`);
  if (!dryRun && r.lines.length) console.log("  下書きフォルダに書き出しました");

  if (!dryRun && new Date().getUTCHours() === 0 && new Date().getUTCMinutes() < 15) await refresh(token);
}

// 11章。1日1回、トークンを延命する。60日で切れるため。
// 延長の返事には新しいトークンが入ってくる。前と同じ文字列かどうかは、まだ確かめていない。
// なので、同じだったか違ったかを記録に残し、違っていてパソコンで動かしているときは .env を書き換える。
async function refresh(token) {
  const log = (s) => {
    console.log(s);
    mkdirSync(new URL("記録/", ROOT), { recursive: true });
    appendFileSync(new URL("記録/トークン.log", ROOT), `${new Date().toISOString()} ${s}\n`, "utf8");
  };
  try {
    const { token: next, expiresInSec } = await threads.refreshToken(token);
    const days = Math.round(expiresInSec / 86400);
    if (!next || next === token) {
      log(`[token] 延命しました。あと${days}日（文字列は同じ）`);
      return;
    }
    log(`[token] 延命しました。あと${days}日（★文字列が変わった）`);
    if (!process.env.GITHUB_ACTIONS && existsSync(ENV_FILE)) {
      const body = readFileSync(ENV_FILE, "utf8").replace(/^(\s*THREADS_ACCESS_TOKEN\s*=).*$/m, `$1${next}`);
      writeFileSync(ENV_FILE, body, "utf8");
      log("[token] .env を新しいトークンに書き換えました");
    } else {
      log("[token] ※ GitHub の Secrets は自動では変わりません。入れ替えが要ります");
    }
  } catch (err) {
    log(`[token] 延命は見送り: ${err.message.slice(0, 120)}`);
  }
}

main().catch((err) => {
  console.error("止まりました:", err);
  process.exit(1);
});
