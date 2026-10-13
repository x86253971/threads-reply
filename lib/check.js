// 送る前の点検(6章)。AIは使わず、決まりだけで見る。
//
// ここで落ちた文は、1回だけ書き直させる。それでもだめなら送らない。
// (前の試作は決まった3文に差し替えていたが、同じ文の繰り返しはスパムの兆候になるのでやめた)

import { config } from "./config.js";

/** 文字の2つ並びの集まり。似ているかを比べるのに使う */
function bigrams(s) {
  const t = String(s).replace(/[\s。、！？!?…・「」『』()（）]/g, "");
  const out = new Map();
  for (let i = 0; i < t.length - 1; i++) {
    const k = t.slice(i, i + 2);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/** 2つの文の似かた(0〜1)。1に近いほど同じ */
export function similarity(a, b) {
  const x = bigrams(a);
  const y = bigrams(b);
  let total = 0;
  let same = 0;
  for (const v of x.values()) total += v;
  for (const v of y.values()) total += v;
  for (const [k, v] of x) same += Math.min(v, y.get(k) ?? 0);
  return total ? (2 * same) / total : 0;
}

/**
 * 返信の文を点検する。
 * recent は最近の返信の文(繰り返しの点検用)。commentText は相手のコメント。
 * 返り値 { ok: true } か { ok: false, reason: "なぜだめか" }
 */
export function inspect(text, { guideLine = false, recent = [], commentText = "" } = {}) {
  const c = config.check ?? {};
  const r = config.reply ?? {};
  const lg = config.line_guide ?? {};
  const t = String(text ?? "");

  const min = Number(r.min_chars ?? 15);
  const max = Number(r.max_chars ?? 90) + (guideLine ? Number(r.line_extra_chars ?? 20) : 0);
  if (t.length < min) return { ok: false, reason: `短すぎる(${t.length}字)` };
  // AIは字数をきっちり守れないので、少しはみ出すのは許す
  if (t.length > Math.round(max * 1.3)) return { ok: false, reason: `長すぎる(${t.length}字)` };

  const ng = (c.ng_words ?? []).filter((w) => t.includes(w));
  if (ng.length) return { ok: false, reason: `使えない言葉: ${ng.join("、")}` };

  // 個人のことを書かせない。LINEの案内の中で触れるのだけは許す
  const personal = (c.personal_words ?? []).filter((w) => t.includes(w));
  if (personal.length && !(guideLine && /LINE|ライン/.test(t))) {
    return { ok: false, reason: `個人のことに触れている: ${personal.join("、")}` };
  }

  // URLは、LINEをリンクで案内するときの、決めたURLだけ
  const urls = t.match(/https?:\/\/\S+|www\.\S+/g) ?? [];
  const allowed = guideLine && lg.mode === "link" ? [lg.url] : [];
  const bad = urls.filter((u) => !allowed.some((a) => u.startsWith(a)));
  if (bad.length) return { ok: false, reason: `決めていないURL: ${bad.join(" ")}` };

  // 案内しないはずなのにLINEの話をしている。
  // ただし相手が LINE(アプリ)の話をしているときは、「LINE」と書くのはよい。
  // 九尾のLINEへの案内に見える言葉(公式・プロフィール・友だち追加)は、その場合も落とす
  if (!guideLine) {
    const talksLine = /LINE|ライン/i.test(commentText);
    if (/公式|プロフィール|プロフ|友だち追加|友達追加/.test(t) && /LINE|ライン/i.test(t)) {
      return { ok: false, reason: "案内しない相手にLINEの話をしている" };
    }
    if (!talksLine && /LINE|ライン/i.test(t)) return { ok: false, reason: "案内しない相手にLINEの話をしている" };
  }

  // 最近の返信と似すぎていないか
  const maxSim = Number(c.similarity_max ?? 0.6);
  for (const old of recent) {
    const s = similarity(t, old);
    if (s >= maxSim) return { ok: false, reason: `最近の返信と似すぎ(${Math.round(s * 100)}%):「${String(old).slice(0, 30)}」` };
  }

  return { ok: true };
}
