// 入口。GitHub Actions から10分おきに呼ばれる。
//
//   node index.js            本番(返信を送る)
//   node index.js --dry      何を返すつもりかを出すだけ。送らない
//
// 止まったことに気づけるよう、具合が悪いときは異常終了する。
// GitHub Actions は失敗するとメールをくれるので、黙って止まり続けることがない。
// (前の仕組みは静かに止まり、2週間誰も気づかなかった)

import * as threads from "./lib/threads.js";
import { sweep, config } from "./lib/sweep.js";
import * as ai from "./lib/ai.js";

const dryRun = process.argv.includes("--dry");

async function main() {
  const token = process.env.THREADS_ACCESS_TOKEN;
  if (!token) {
    console.error("THREADS_ACCESS_TOKEN がありません。GitHubのSecretsに入れてください");
    process.exit(1);
  }
  if (!ai.isEnabled()) {
    console.error("GEMINI_API_KEY がありません。GitHubのSecretsに入れてください");
    process.exit(1);
  }

  // トークンが生きているか。死んでいたらここで異常終了して知らせる
  try {
    const who = await threads.me(token);
    console.log(`[token] 生きています @${who.username}`);
  } catch (err) {
    console.error("[token] 使えません。新しいトークンを取り直して、GitHubのSecretsを入れ替えてください");
    console.error("        " + err.message);
    process.exit(1);
  }

  const r = await sweep({ token, dryRun });

  console.log("");
  console.log(`見た投稿 ${r.posts}件 / 返す相手 ${r.targets}人 / 送った ${r.sent}件`);
  for (const s of r.skipped) console.log(`  ${s}`);

  // 1日1回、トークンを延命しておく。60日で切れるため。
  // 発行から24時間たっていないと断られるが、それは失敗ではない
  if (!dryRun && new Date().getUTCHours() === 0 && new Date().getUTCMinutes() < 15) {
    try {
      const { expiresInSec } = await threads.refreshToken(token);
      const days = Math.round(expiresInSec / 86400);
      console.log(`[token] 延命しました。あと${days}日`);
      console.log("[token] ※ 新しいトークンは GitHub の Secrets に自動では入りません。");
      console.log("        切れる前に取り直す運用にしてください（仕様書の『トークンの寿命』参照）");
    } catch (err) {
      console.log(`[token] 延命は見送り: ${err.message.slice(0, 120)}`);
    }
  }
}

main().catch((err) => {
  console.error("止まりました:", err);
  process.exit(1);
});
