// コメント1件について、どう返すかを決める(2章の③〜⑥)。
//
// Threads には触らない。ここは「仕分ける → 返し方を決める → 書く → 点検する」だけ。
// 送るかどうか(段階・上限・時間帯)は sweep.js が決める。
// scripts/sample.js からも同じものを呼ぶので、架空のコメントで中身を確かめられる。

import { config } from "./config.js";
import * as ai from "./ai.js";
import { inspect } from "./check.js";

const heavyWord = (text) => (config.heavy?.words ?? []).find((w) => String(text).includes(w));

/**
 * 返り値
 *   type     A〜F(Gは followup で表す)
 *   kind     返し方 A/B/C/G/D
 *   reason   仕分けの理由
 *   text     返信の文(返さないときは null)
 *   status   "作った" / "返さない" / "失敗"
 *   why      返さない・失敗の理由
 *   tags     { line: LINE案内をしたか, question: 質問で終えたか, chars: 字数 }
 *   notice   山崎さんに知らせること(なければ null)
 */
export async function decide({ post, comment, history = [], followup = false, image = null, book = null, username = "" }) {
  const base = { type: null, kind: null, reason: "", text: null, status: "返さない", why: "", tags: {}, notice: null };
  const ctext = String(comment?.text ?? "");

  // 重い相談のあとの往復は、自動では続けない(9章)
  if (followup && book?.heavyBefore(post.id, username)) {
    return {
      ...base, type: "D", kind: "D", reason: "前に重い相談をした人の続き",
      why: "重い相談のあとなので自動では続けない",
      notice: `重い相談をした @${username} から続きのコメント:「${ctext.slice(0, 60)}」`,
    };
  }

  // 3章。言葉のリストでも拾う(AIの判断の前の、もう1枚の網)
  const word = heavyWord(ctext);
  let c = word ? { type: "D", reason: `言葉「${word}」`, wantsMore: false } : await ai.classify({ post, comment, history, image });
  if (!c) return { ...base, status: "失敗", why: "AIが仕分けできなかった" };

  const out = { ...base, type: c.type, kind: c.type, reason: c.reason };

  // 9章 重い相談
  if (c.type === "D") {
    const h = config.heavy ?? {};
    const notice = `重い相談かもしれません @${username}:「${ctext.slice(0, 80)}」`;
    if (h.mode === "notify_only") return { ...out, why: "重い相談(知らせるだけ)", notice };
    return { ...out, kind: "D", text: h.reply, status: "作った", tags: { line: false, question: false, chars: h.reply.length }, notice };
  }
  if (c.type === "E") return { ...out, why: "荒らし・宣伝" };
  if (c.type === "F") return { ...out, why: "返事が要らない" };

  // 返し方
  const kind = followup ? "G" : c.type;
  const lg = config.line_guide ?? {};
  const wantsGuide = followup ? c.wantsMore || c.type === "C" : (lg.types ?? []).includes(c.type);
  const already = lg.once_per_person !== false && book?.lineGuided(username);
  const guideLine = Boolean(wantsGuide && !already);
  // LINEを案内するときは、問いかけまで重ねない
  const endWithQuestion = !guideLine && Math.random() < Number(config.reply?.question_ratio ?? 0.4);

  // 5章・6章 書いて点検。だめなら1回だけ書き直す
  const recent = book?.recentTexts(Number(config.check?.similarity_window ?? 200)) ?? [];
  let retryNote = "";
  for (let i = 0; i < 2; i++) {
    const text = await ai.writeReply({ post, comment, history, image, kind, guideLine, endWithQuestion, retryNote });
    if (!text) {
      retryNote = "";
      continue;
    }
    const v = inspect(text, { guideLine, recent });
    if (v.ok) {
      return {
        ...out, kind, text, status: "作った",
        tags: { line: guideLine, question: /[？?]\s*\S{0,2}$/.test(text), chars: text.length },
      };
    }
    retryNote = v.reason;
    console.log(`    点検で落ちた: ${v.reason}`);
  }
  return { ...out, kind, status: "失敗", why: retryNote ? `点検で2回落ちた(${retryNote})` : "AIが文を書けなかった" };
}
