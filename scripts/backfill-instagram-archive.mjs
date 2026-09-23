/**
 * Instagram 過去投稿の初回バックフィル（手動実行専用）。
 * 毎時の fetch-instagram.mjs とは分離し、paging.cursors.after で API 終端まで取得する。
 *
 * - 既存 data/instagram.json は Media ID でマージし、削除しない
 * - 画像は R2 へ Media ID 単位で保存。既存オブジェクトは再PUTしない
 * - 1回あたりの新規アップロード数を制限し、再実行で未保存分を補完する
 * - Secret / access_token / paging.next はログに出さない
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BACKFILL_MAX_PAGES,
  BACKFILL_MAX_UPLOADS,
  BACKFILL_PAGE_SIZE,
  MEDIA_DIR,
  OUTPUT_PATH,
  countPendingMedia,
  fetchInstagramPostsPaged,
  mergeArchives,
  readExistingArchive,
  savePostsMedia,
  writeArchiveIfChanged,
} from "./fetch-instagram.mjs";
import { createR2MediaStore, readR2ConfigFromEnv } from "./r2.mjs";

const EXIT_FAILURE = 1;

/**
 * @returns {number}
 */
export function readBackfillMaxUploads() {
  const raw = process.env.BACKFILL_MAX_UPLOADS;
  if (raw == null || raw === "") {
    return BACKFILL_MAX_UPLOADS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("BACKFILL_MAX_UPLOADS は1以上の整数である必要があります。");
  }
  return parsed;
}

/**
 * @param {{
 *   accessToken: string,
 *   userId: string,
 *   store: { has: Function, put: Function },
 *   outputPath?: string,
 *   mediaDir?: string,
 *   fetchImpl?: typeof fetch,
 *   maxUploads?: number,
 *   pageSize?: number,
 *   maxPages?: number,
 *   log?: (message: string) => void,
 * }} options
 */
export async function runInstagramBackfill(options) {
  const log = options.log || console.log;
  const outputPath = options.outputPath || OUTPUT_PATH;
  const maxUploads = options.maxUploads || BACKFILL_MAX_UPLOADS;
  const existing = readExistingArchive(outputPath);
  const fetched = await fetchInstagramPostsPaged(options.accessToken, options.userId, {
    fetchImpl: options.fetchImpl,
    pageSize: options.pageSize || BACKFILL_PAGE_SIZE,
    maxPages: options.maxPages || BACKFILL_MAX_PAGES,
    log,
  });
  const merged = mergeArchives(existing.posts, fetched.posts);
  const mediaStats = await savePostsMedia(merged.posts, {
    store: options.store,
    mediaDir: options.mediaDir || MEDIA_DIR,
    fetchImpl: options.fetchImpl,
    maxUploads,
    trustStoredUrl: true,
  });
  const wroteJson = writeArchiveIfChanged(outputPath, existing, merged.posts);
  const remaining = countPendingMedia(merged.posts);

  return {
    fetched,
    merged,
    mediaStats,
    wroteJson,
    remaining,
    complete: remaining === 0 && fetched.stoppedReason === "end",
  };
}

async function main() {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const userId = process.env.INSTAGRAM_USER_ID;

  if (!accessToken || !userId) {
    console.error("INSTAGRAM_ACCESS_TOKEN または INSTAGRAM_USER_ID が未設定です。");
    process.exit(EXIT_FAILURE);
  }

  try {
    const maxUploads = readBackfillMaxUploads();
    const r2Config = readR2ConfigFromEnv();
    const result = await runInstagramBackfill({
      accessToken,
      userId,
      store: createR2MediaStore(r2Config),
      maxUploads,
    });

    console.log(
      `Instagramバックフィル: 取得${result.fetched.posts.length}件 / 追加${result.merged.added} / 更新${result.merged.updated} / 保持${result.merged.kept} / 合計${result.merged.posts.length}件 / 停止=${result.fetched.stoppedReason}`,
    );
    console.log(
      `画像: 保存${result.mediaStats.downloaded} / スキップ${result.mediaStats.skipped} / 失敗${result.mediaStats.failed} / 今回見送り${result.mediaStats.deferred} / 残り${result.remaining}`,
    );
    console.log(
      result.wroteJson
        ? "data/instagram.json を更新しました。"
        : "投稿データに実質変更がないため JSON は更新しません。",
    );

    if (result.complete) {
      console.log("バックフィル完了: 未保存画像はありません。");
      return;
    }

    console.log("バックフィル未完了: GitHub Actions の Backfill Instagram Archive を再実行してください。");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Instagram API error (unknown)";
    console.error("Instagramバックフィルに失敗しました:", message);
    console.error("既存の data/instagram.json と保存済み画像は保持されます。");
    process.exit(EXIT_FAILURE);
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  main();
}
