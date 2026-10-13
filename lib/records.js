// 返信の記録(8章)。中身の扱いだけ。どこに置くかは呼ぶ側が決める
// (パソコン: lib/local.js のファイル / Cloudflare: src/worker.js の KV)。
//
// 「もう返したか」はこれまで通り Threads の会話を見て決める。
// この記録は、効いたかを測るためと、1日の数・LINE案内の回数を数えるためのもの。
// 消えても二重に返すことはない(壊れても困らない場所に置いておく)。

const HOUR = 3600 * 1000;

/** 記録をまとめて扱う入れ物 */
export class Book {
  constructor(list = []) {
    this.list = list;
    this.byComment = new Map(list.map((x) => [x.comment_id, x]));
    this.added = false;      // 新しい記録が増えたか
    this.touched = false;    // 「往復になった」の印など、細かい書き換えがあったか
  }

  get(commentId) {
    return this.byComment.get(commentId);
  }

  /** 1件書く(同じコメントなら上書き) */
  put(rec) {
    const old = this.byComment.get(rec.comment_id);
    if (old) Object.assign(old, rec);
    else {
      this.list.push(rec);
      this.byComment.set(rec.comment_id, rec);
    }
    this.added = true;
  }

  /** 送った返信に、相手がさらに返してきた印を付ける */
  markReplied(rec) {
    if (rec.got_reply) return;
    rec.got_reply = true;
    this.touched = true;
  }

  /** 直近24時間に送った数 */
  sentLast24h(now = Date.now()) {
    return this.list.filter((x) => x.status === "送信" && now - Date.parse(x.at) < 24 * HOUR).length;
  }

  /** この人にLINEを案内したことがあるか(下書きも数える。段階1でも同じ動きを見るため) */
  lineGuided(username) {
    return this.list.some((x) => x.username === username && x.tags?.line && ["送信", "下書き"].includes(x.status));
  }

  /** この投稿で、この人が重い相談をしたことがあるか(あれば往復を続けない) */
  heavyBefore(postId, username) {
    return this.list.some((x) => x.post_id === postId && x.username === username && x.type === "D");
  }

  /** 最近の返信の文(繰り返しの点検用)。重い相談の決まった文は除く */
  recentTexts(n = 200) {
    return this.list
      .filter((x) => x.text && x.type !== "D" && ["送信", "下書き"].includes(x.status))
      .slice(-n)
      .map((x) => x.text);
  }

  /** 送った返信のidから、記録を引く(相手が返してきたかを付けるため) */
  byMyReply(replyId) {
    return this.list.find((x) => x.my_reply_id === replyId);
  }

  /** 古い記録を落とす(置き場の容量のため)。既定は90日 */
  trimmed(days = 90, now = Date.now()) {
    return this.list.filter((x) => now - Date.parse(x.at) < days * 24 * HOUR);
  }
}
