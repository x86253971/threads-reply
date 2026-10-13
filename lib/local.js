// パソコンで動かすときだけ使うもの(.env・記録のファイル・下書きのファイル)。
// Cloudflare では使わない(あちらは src/worker.js が KV を使う)。

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { Book } from "./records.js";

export const ROOT = new URL("../", import.meta.url);
export const ENV_FILE = new URL(".env", ROOT);

// 手元で試すときだけ .env を読む。.env は .gitignore に入れてあるので、GitHubには上がらない
export function loadEnv() {
  if (!existsSync(ENV_FILE)) return;
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}
loadEnv();

// 記録(8章)。パソコンの中の「記録」フォルダに、1行1件で残す。
// 相手のユーザー名やコメントが入るので、GitHub には上げない(.gitignore 済み)
const REC_DIR = new URL("記録/", ROOT);
const REC_FILE = new URL("返信の記録.jsonl", REC_DIR);

export function loadRecords() {
  if (!existsSync(REC_FILE)) return [];
  return readFileSync(REC_FILE, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);
}

export function saveRecords(list) {
  mkdirSync(REC_DIR, { recursive: true });
  writeFileSync(REC_FILE, list.map((x) => JSON.stringify(x)).join("\n") + (list.length ? "\n" : ""), "utf8");
}

export const fileBook = () => new Book(loadRecords());

/** 下書きの一覧を、メモ帳で読める形で日ごとのファイルに足していく(10章 段階1) */
export function appendDraft(dateStr, text) {
  if (!text) return;
  const dir = new URL("下書き/", ROOT);
  mkdirSync(dir, { recursive: true });
  appendFileSync(new URL(`${dateStr}.txt`, dir), text.replace(/\r?\n/g, "\r\n"), "utf8");
}

export function logLine(name, s) {
  mkdirSync(REC_DIR, { recursive: true });
  appendFileSync(new URL(name, REC_DIR), `${new Date().toISOString()} ${s}\n`, "utf8");
}
