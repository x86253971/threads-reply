// Threads API の呼び口。
//
// エンドポイントは、前に動いていた reply-bot.ps1 から持ってきている(実績あり)。
//   GET  /me                        自分が誰か
//   GET  /me/threads                自分の投稿一覧
//   GET  /{投稿id}/conversation      その投稿にぶら下がった会話ぜんぶ
//   POST /me/threads                返信の下書きを作る(まだ出ない)
//   POST /me/threads_publish        下書きを出す
//
// 下書きを作ってから出すまでに少し間を置かないと、Threads側が「まだ無い」と言ってくる。

const BASE = "https://graph.threads.net/v1.0";

/** 共通の呼び出し。失敗したら中身まで分かるように投げ直す */
async function call(url, { method = "GET", timeoutMs = 30000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, signal: ctrl.signal });
    const body = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${body.slice(0, 300)}`);
    return body ? JSON.parse(body) : {};
  } finally {
    clearTimeout(timer);
  }
}

const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

/** 自分が誰か。トークンが生きているかの確認も兼ねる */
export const me = (token) =>
  call(`${BASE}/me?${q({ fields: "id,username", access_token: token })}`);

/** 自分の投稿を新しい順に。返信を探しにいく先 */
export async function myPosts(token, limit = 10) {
  const r = await call(`${BASE}/me/threads?${q({ fields: "id,text,timestamp,media_type,media_url,permalink", limit, access_token: token })}`);
  return Array.isArray(r.data) ? r.data : [];
}

/** その投稿にぶら下がった会話ぜんぶ(自分の返信も相手のコメントも混ざって返る) */
export async function conversation(token, postId) {
  const r = await call(
    `${BASE}/${postId}/conversation?${q({ fields: "id,text,username,timestamp,replied_to", access_token: token })}`
  );
  return Array.isArray(r.data) ? r.data : [];
}

/** 返信を出す。下書き → 公開 の2段構え */
export async function reply(token, commentId, text, waitSec = 10) {
  const created = await call(
    `${BASE}/me/threads?${q({ media_type: "TEXT", reply_to_id: commentId, text, access_token: token })}`,
    { method: "POST" }
  );
  if (!created?.id) throw new Error("下書きのidが返ってきませんでした");
  await new Promise((r) => setTimeout(r, waitSec * 1000));
  const published = await call(`${BASE}/me/threads_publish?${q({ creation_id: created.id, access_token: token })}`, { method: "POST" });
  // 公開されたあとの id。あとで「この返信に相手が返してきたか」を見るのに使う
  return published?.id ?? created.id;
}

/** アカウント全体の数字(リンクのクリック数など)。threads_manage_insights の権限が要る */
export async function accountInsights(token, userId, metric, sinceSec, untilSec) {
  return call(
    `${BASE}/${userId}/threads_insights?${q({ metric, since: sinceSec, until: untilSec, access_token: token })}`
  );
}

/** トークンを延命する。60日で切れるので、生きているうちに呼べば次の60日が始まる。
 *  発行から24時間たっていないと断られる(その場合は何もしなくてよい) */
export async function refreshToken(token) {
  const r = await call(
    `https://graph.threads.net/refresh_access_token?${q({ grant_type: "th_refresh_token", access_token: token })}`
  );
  return { token: r.access_token ?? null, expiresInSec: Number(r.expires_in ?? 0) };
}
