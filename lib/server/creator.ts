import { getCreators, getWork } from "./works";
import { loadChunksOfSource } from "./sources";
import { extractCreatorStyle } from "./llm/creator";
import { supabase } from "./supabase";
import type { Creator, CreatorProfile } from "./types";

/**
 * 作り手の作風（CreatorProfile）を用意する。
 * work.json の `creators` に `style` が書いてあればそれを使い、無ければ `source` の記事を読んで
 * 資料係（llm/creator.ts）に作風を抜かせる。記事を読むのは作品ごとに1回で、結果は
 * Supabase の creator_profiles に残す（デプロイをまたいで API を呼び直さない）。
 * 取れなかった作り手は黙って飛ばす（としおは作風なしで語る）。
 */

type Cached = Record<string, CreatorProfile>; // name → profile

const inflight = new Map<string, Promise<CreatorProfile[]>>();

async function readCache(workId: string): Promise<Cached> {
  try {
    const { data, error } = await supabase()
      .from("creator_profiles")
      .select("name, profile")
      .eq("work_id", workId);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { name: string; profile: CreatorProfile }[];
    return Object.fromEntries(rows.map((row) => [row.name, row.profile]));
  } catch (error) {
    // キャッシュが読めなくても作風は抜き直せる（API を1回余計に呼ぶだけ）
    console.error("作り手の作風のキャッシュ取得に失敗:", error);
    return {};
  }
}

async function writeCache(workId: string, profile: CreatorProfile) {
  try {
    const { error } = await supabase().from("creator_profiles").upsert({
      work_id: workId,
      name: profile.name,
      profile,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  } catch (error) {
    console.error("作り手の作風のキャッシュ保存に失敗:", error);
  }
}

async function resolveOne(workId: string, workTitle: string, creator: Creator, cached: Cached): Promise<CreatorProfile | null> {
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
  await writeCache(workId, profile);
  return profile;
}

export async function getCreatorProfiles(workId: string): Promise<CreatorProfile[]> {
  const creators = getCreators(workId);
  if (creators.length === 0) return [];
  const existing = inflight.get(workId);
  if (existing) return existing;

  const task = (async () => {
    const workTitle = getWork(workId)?.title ?? workId;
    const cached = await readCache(workId);
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
