// 設定(config.json)と .env を読む。どのファイルからもここを通す。

import { existsSync, readFileSync } from "node:fs";

export const ROOT = new URL("../", import.meta.url);
export const config = JSON.parse(readFileSync(new URL("config.json", ROOT), "utf8"));

// 手元で試すときだけ .env を読む。
// GitHub Actions では Secrets が環境変数で入ってくるので、このファイルは要らない。
// .env は .gitignore に入れてあるので、GitHubには上がらない
export const ENV_FILE = new URL(".env", ROOT);
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}
