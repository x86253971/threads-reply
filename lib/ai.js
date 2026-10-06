// 返信の文をAIに書かせる。
//
// 前の仕組みは `claude -p` をパソコン上で叩いていた。
// そのログインが切れたことに2週間誰も気づかず、投稿も返信も止まっていた
// (2026-08-04〜08-18)。同じ轍を踏まないよう、ここはAPIキーだけで動く Gemini にする。
// キーには有効期限が無いので、切れて黙り込むことがない。

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";

export const isEnabled = () => Boolean(process.env.GEMINI_API_KEY);

async function generate(prompt, { maxOutputTokens = 800, timeoutMs = 30000 } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${ENDPOINT}?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 1.0, maxOutputTokens },
      }),
    });
    if (!res.ok) {
      console.error("[ai] 生成に失敗:", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const json = await res.json();
    const out = json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
    return out || null;
  } catch (err) {
    console.error("[ai] 生成に失敗:", err.name, err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * コメント1つへの返事を書かせる。
 *
 * 狙いは「会話が続くこと」。Threadsは会話の数で表示される量が変わるので、
 * うまいことを言って終わらせるより、相手がもう一度書きたくなるほうが強い。
 * だから短く返し、こちらで話を畳まない。
 */
export async function writeReply({ config, post, comment, mine }) {
  const r = config.reply ?? {};
  const persona = (config.persona ?? []).join("\n");

  const history = (mine ?? []).length
    ? `【この人とのこれまでのやりとり(古い順)】\n${mine.map((m) => `${m.who}: ${m.text}`).join("\n")}\n`
    : "";

  const prompt = `${persona}

いまから、自分の投稿に付いたコメントへ返事を書きます。

【自分が書いた投稿】
${String(post?.text ?? "").trim() || "(本文なし)"}

${history}
【今回いただいたコメント】
${String(comment?.text ?? "").trim()}

このコメントへの返事を、1つだけ書いてください。

【書き方】
・${r.min_chars ?? 15}〜${r.max_chars ?? 90}文字
・話し言葉で、自然に。かしこまりすぎない
・絵文字は${r.emoji ?? "0〜1個まで"}
・相手が書いた言葉を、ひとつ拾ってください
・聞かれていることには短く答えてください

【いちばん大事なこと】
会話が続くように返してください。
こちらで話を畳まないでください。
ただし、毎回わざとらしく質問を返すのはやめてください。
相手がもう一度書きたくなるかどうかが基準です。

【してはいけないこと】
・断定しない。「必ず」「絶対」のような言い切りをしない
・占いの結果をここで出さない。短い言葉では当たらないし、軽く見える
・公式LINEや商品の宣伝をしない。売り込まれたと思われたらそこで終わりです
・リンクを貼らない
・AIが書いたと分かる言い回しをしない
・返事の文だけを書いてください。前置きも見出しも要りません`;

  const out = await generate(prompt);
  if (!out) return null;

  // 前後の引用符や「返信:」のような前置きが付いてくることがあるので落とす
  const t = String(out)
    .replace(/^["'「『]+|["'」』]+$/g, "")
    .replace(/^(返信|返事|回答)[:：]\s*/, "")
    .trim();

  const min = Number(r.min_chars ?? 15);
  const max = Number(r.max_chars ?? 90);
  if (t.length < min || t.length > max * 2) return null;   // 短すぎ・長すぎは捨てる
  return t;
}
