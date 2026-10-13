// AIに頼む仕事は2つ。コメントの仕分け(3章)と、返信の文を書くこと(5章)。
//
// 前の仕組みは `claude -p` をパソコン上で叩いていた。
// そのログインが切れたことに2週間誰も気づかず、投稿も返信も止まっていた
// (2026-08-04〜08-18)。同じ轍を踏まないよう、ここはAPIキーだけで動く Gemini にする。
// キーには有効期限が無いので、切れて黙り込むことがない。

import { config } from "./config.js";

const endpoint = () =>
  `https://generativelanguage.googleapis.com/v1beta/models/${config.ai?.model ?? "gemini-3.8-flash"}:generateContent`;

export const isEnabled = () => Boolean(process.env.GEMINI_API_KEY);

// maxOutputTokens には「考える」ぶんのトークンも含まれる。800だと考えるだけで使い切り、
// 返事が文の途中で切れていた(2026-10-07 九尾の下書きで発覚)。考える量を絞り、枠も広げる
async function generate(parts, { json = false, maxOutputTokens = 4096, timeoutMs = 30000, temperature = 1.0 } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${endpoint()}?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature,
          maxOutputTokens,
          thinkingConfig: { thinkingLevel: "low" },
          ...(json ? { responseMimeType: "application/json" } : {}),
        },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.error("[ai] 生成に失敗:", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const body = await res.json();
    // 途中で打ち切られた文は使わない
    const finish = body?.candidates?.[0]?.finishReason;
    if (finish && finish !== "STOP") {
      console.error("[ai] 途中で止まった文なので捨てます:", finish);
      return null;
    }
    const out = body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
    return out || null;
  } catch (err) {
    console.error("[ai] 生成に失敗:", err.name, err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 投稿の画像を、AIに見せられる形にする。取れなければ null(文字だけで進める) */
export async function loadImage(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0];
    if (!mime.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 5 * 1024 * 1024) return null;   // 大きすぎる画像は見せない
    return { inline_data: { mime_type: mime, data: buf.toString("base64") } };
  } catch {
    return null;
  }
}

const postBlock = (post) => `【九尾が書いた投稿】\n${String(post?.text ?? "").trim() || "(本文なし。画像だけの投稿)"}`;

const historyBlock = (history) =>
  (history ?? []).length
    ? `【この人とのこれまでのやりとり(古い順)】\n${history.map((m) => `${m.who}: ${m.text}`).join("\n")}\n`
    : "";

/**
 * コメントを7種類のどれかに分ける(3章)。
 * 往復の続き(G)かどうかは、AIではなく会話の形で決める。ここでは中身だけを見る。
 * 返り値 { type: "A"〜"F", reason, wantsMore } / 失敗したら null
 */
export async function classify({ post, comment, history, image }) {
  const prompt = `あなたは、占い師「九尾」のThreadsの投稿に付いたコメントを仕分ける係です。
返事は書きません。仕分けだけをします。

${postBlock(post)}

${historyBlock(history)}
【仕分けるコメント】
${String(comment?.text ?? "").trim()}

【種類】
A 感想・共感（「当たってる」「刺さった」「わかる」など）
B 質問・軽い相談（自分の場合はどうか聞いている、悩みを少し書いている）
C 占ってほしい（「占ってください」、生年月日や名前を書いてきた）
D 重い相談（死にたい・消えたい・自分を傷つける・もう生きていけない、などが読み取れる）
E 荒らし・宣伝（悪口、からかい、関係のない宣伝、勧誘、リンクだけ）
F 返事が要らない（絵文字だけ、記号だけ、意味のある言葉がない）

【決まり】
・迷ったら、安全な方を選ぶ。Dかもしれないなら D。Eかもしれないなら E
・wants_more は、相手が「もっと詳しく知りたい」「ちゃんと見てほしい」とはっきり言っているときだけ true

次の形のJSONだけを返してください。
{"type": "A", "reason": "一言で理由", "wants_more": false}`;

  const parts = [{ text: prompt }];
  if (image) parts.push(image);
  const out = await generate(parts, { json: true, temperature: 0.2, maxOutputTokens: 1024 });
  if (!out) return null;
  try {
    const j = JSON.parse(out.replace(/^```(json)?|```$/g, "").trim());
    const type = String(j.type ?? "").trim().toUpperCase();
    if (!"ABCDEF".includes(type) || type.length !== 1) return null;
    return { type, reason: String(j.reason ?? "").slice(0, 80), wantsMore: j.wants_more === true };
  } catch {
    return null;
  }
}

// 種類ごとの返し方(3章の表)
const HOW = {
  A: "感想をくれた人です。短く受け止めて、相手の言葉を1つ拾ってください。",
  B: "質問か、軽い相談です。少しだけ中身に触れて答えてください。ただし占いの結果をここで言い切らないでください。",
  C: "占ってほしい人です。コメント欄では占いません。占いの結果も書かないでください。生年月日などを書いてくれていても、それには触れないでください。",
  G: "九尾の返信に、もう一度返してくれた人です。それまでのやりとりの続きとして、自然に話を続けてください。",
};

function lineInstruction() {
  const lg = config.line_guide ?? {};
  if (lg.mode === "link") {
    return `・最後に、九尾の公式LINEを1回だけ案内してください。URLはこれをそのまま使う: ${lg.url}
・押し売りにしない。「よければ」くらいの軽さで。LINEでは一人ずつ見られる、ということが伝わればよい
・LINEの案内は一文で短く`;
  }
  return `・最後に、プロフィールにある九尾の公式LINEを、言葉で1回だけ案内してください。URLは書かない
・押し売りにしない。「よければ」くらいの軽さで。LINEでは一人ずつ見られる、ということが伝わればよい
・LINEの案内は一文で短く`;
}

// 前にLINEを案内した人が、また「見てほしい」と言ったとき(19章)
const REMIND = `・この人には前に、九尾の公式LINEを案内しています。もう一度しつこく誘わないでください
・コメント欄では占えないこと、LINEの方なら一人ずつ見られることを、一言だけやさしく伝えてください。URLは書かない`;

/**
 * 返信の文を1つ書かせる(5章)。
 * kind は A/B/C/G。guideLine は LINE を案内するか。endWithQuestion は質問で終えるか。
 * retryNote は、点検で落ちたときの理由(書き直しのときだけ)。
 */
export async function writeReply({ post, comment, history, image, kind, guideLine, remind, endWithQuestion, retryNote }) {
  const r = config.reply ?? {};
  const persona = (config.persona ?? []).join("\n");
  const max = Number(r.max_chars ?? 90) + (guideLine || remind ? Number(r.line_extra_chars ?? 20) : 0);

  const examples = (config.examples ?? []).length
    ? `【九尾の返信の見本(口調の参考。そのまま写さない)】\n${config.examples.map((e) => `コメント: ${e.comment}\n返信: ${e.reply}`).join("\n\n")}\n`
    : "";

  const prompt = `${persona}

いまから、自分の投稿に付いたコメントへ返事を書きます。

${postBlock(post)}

${historyBlock(history)}
【今回いただいたコメント】
${String(comment?.text ?? "").trim()}

【この人への返し方】
${HOW[kind] ?? HOW.A}

${examples}
【書き方】
・${r.min_chars ?? 15}〜${max}文字
・話し言葉で、自然に。かしこまりすぎない
・絵文字は${r.emoji ?? "0〜1個まで"}
・相手が書いた言葉を、ひとつ拾ってください。「ありがとうございます」だけの中身のない返事にしない
・${endWithQuestion ? "相手が答えやすい短い問いかけで終えてください" : "問いかけでは終えないでください。受け止めて終える"}
${guideLine ? lineInstruction() : remind ? REMIND : "・公式LINEや商品のことは書かない。リンクも貼らない"}

【いちばん大事なこと】
相手がもう一度書きたくなるかどうかが基準です。こちらで話を畳まないでください。

【してはいけないこと】
・断定しない。「必ず」「絶対」のような言い切りをしない
・不安をあおらない。「このままだと」「手遅れ」「不幸になる」のような言い方をしない
・健康やお金のことを言い切らない
・コメント欄で、生年月日・本名・住所などを書かせようとしない
・急がせない。「今だけ」「先着」などを言わない
・コメント欄で占わない。「ここで見ますね」「ちゃんと見ます」のように、コメント欄で占う・見る約束をしない
・AIが書いたと分かる言い回しをしない
・返事の文だけを書いてください。前置きも見出しも要りません
${retryNote ? `\n【書き直しです】前に書いた文は、次の理由で使えませんでした: ${retryNote}\n同じことにならないように書き直してください。` : ""}`;

  const parts = [{ text: prompt }];
  if (image) parts.push(image);
  const out = await generate(parts);
  if (!out) return null;

  // 「返信:」のような前置きや、文全体を囲む引用符が付いてくることがあるので落とす。
  // 文の中の「」は残す(先頭の「だけ消して文が壊れたことがある 2026-10-13)
  let t = String(out).replace(/^(返信|返事|回答)[:：]\s*/, "").trim();
  const wrap = t.match(/^(["'「『])([\s\S]*)(["'」』])$/);
  if (wrap && !/[「『"']/.test(wrap[2])) t = wrap[2].trim();
  return t;
}
