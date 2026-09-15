import fs from "node:fs";
import path from "node:path";
import { getCreators, getWork } from "./works";
import { loadChunksOfSource } from "./sources";
import { extractCreatorStyle } from "./llm/creator";
import { dataDir } from "./store";
import type { Creator, CreatorProfile } from "./types";

/**
 * 作り手の作風（CreatorProfile）を用意する。
 * work.json の `creators` に `style` が書いてあればそれを使い、無ければ `source` の記事を読んで
 * 資料係（llm/creator.ts）に作風を抜かせる。記事を読むのは作品ごとに1回で、結果は
 * DATA_DIR/creators/<workId>.json に残す（再起動をまたいで API を呼び直さない）。
 * 取れなかった作り手は黙って飛ばす（としおは作風なしで語る）。
 */

type CacheFile = Record<string, CreatorProfile>; // name → profile

const inflight = new Map<string, Promise<CreatorProfile[]>>();

function cachePath(workId: string): string {
  return path.join(dataDir(), "creators", `${workId}.json`);
}

function readCache(workId: string): CacheFile {
  try {
    return JSON.parse(fs.readFileSync(cachePath(workId), "utf-8")) as CacheFile;
  } catch {
    return {};
  }
}

function writeCache(workId: string, file: CacheFile) {
  try {
    const p = cachePath(workId);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(file, null, 2));
  } catch (error) {
    console.error("作り手の作風のキャッシュ保存に失敗:", error);
  }
}

async function resolveOne(workId: string, workTitle: string, creator: Creator, cached: CacheFile): Promise<CreatorProfile | null> {
  if (creator.style && creator.style.length > 0) {
    return { role: creator.role, name: creator.name, style: creator.style };
  }
  const hit = cached[creator.name];
  if (hit) return { ...hit, role: creator.role };
  if (!creator.source) return null;

  const chunks = await loadChunksOfSource(creator.source, "creator");
  if (chunks.length === 0) return null;
  const style = await extractCreatorStyle({ workTitle, role: creator.role, name: creator.name, chunks });
  if (style.length === 0) return null;
  const profile: CreatorProfile = {
    role: creator.role,
    name: creator.name,
    style,
    source: { title: chunks[0].sourceTitle, url: chunks[0].url },
  };
  cached[creator.name] = profile;
  writeCache(workId, cached);
  return profile;
}

export async function getCreatorProfiles(workId: string): Promise<CreatorProfile[]> {
  const creators = getCreators(workId);
  if (creators.length === 0) return [];
  const existing = inflight.get(workId);
  if (existing) return existing;

  const task = (async () => {
    const workTitle = getWork(workId)?.title ?? workId;
    const cached = readCache(workId);
    const profiles: CreatorProfile[] = [];
    for (const creator of creators) {
      try {
        const profile = await resolveOne(workId, workTitle, creator, cached);
        if (profile) profiles.push(profile);
      } catch (error) {
        console.error(`作り手の作風の取得に失敗（${creator.name}）:`, error);
      }
    }
    return profiles;
  })();
  inflight.set(workId, task);
  try {
    return await task;
  } finally {
    // 失敗した作り手を次回また試せるよう、揃わなかったときは持ち越さない
    task.then((profiles) => {
      if (profiles.length < creators.length) inflight.delete(workId);
    });
  }
}

/** テスト用 */
export function clearCreatorCache() {
  inflight.clear();
}
