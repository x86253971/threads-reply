// 設定(config.json)を読む。どのファイルからもここを通す。
// パソコンでも Cloudflare でも動くように、ファイルの読み書きはここではしない(lib/local.js へ)。

import config from "../config.json" with { type: "json" };

export { config };
