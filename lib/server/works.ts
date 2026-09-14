import fs from "node:fs";
import path from "node:path";
import type { Arc, CanonFact, Entity, Episode, Work } from "./types";

type WorkFile = {
  work: Work;
  arcs?: Arc[];
  entities?: Entity[];
  episodes: Episode[];
  canonFacts: CanonFact[];
};

// One directory per work under data/, each holding a work.json (and cards.jsonl).
const DATA_DIR = path.join(process.cwd(), "data");
const WORK_FILE = "work.json";

let cache: Map<string, WorkFile> | null = null;

function loadAll(): Map<string, WorkFile> {
  if (cache) return cache;

  const map = new Map<string, WorkFile>();
  const dirs = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR, { withFileTypes: true }) : [];

  for (const dir of dirs) {
    if (!dir.isDirectory() || dir.name.startsWith(".")) continue;
    const file = path.join(DATA_DIR, dir.name, WORK_FILE);
    if (!fs.existsSync(file)) continue;
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as WorkFile;
    map.set(parsed.work.id, parsed);
  }

  cache = map;
  return map;
}

export function listWorks(): Work[] {
  return Array.from(loadAll().values()).map((entry) => entry.work);
}

export function getWork(workId: string): Work | null {
  return loadAll().get(workId)?.work ?? null;
}

export function getEpisodesUpTo(workId: string, currentEpisode: number): Episode[] {
  const entry = loadAll().get(workId);
  if (!entry) return [];
  return entry.episodes
    .filter((ep) => ep.episodeNumber <= currentEpisode)
    .sort((a, b) => a.episodeNumber - b.episodeNumber);
}

/** Canon facts visible from the given viewing progress (spoilerLevel <= currentEpisode). */
export function getCanonFactsUpTo(workId: string, currentEpisode: number): CanonFact[] {
  const entry = loadAll().get(workId);
  if (!entry) return [];
  return entry.canonFacts.filter((fact) => fact.episodeFrom <= currentEpisode);
}

/** All canon facts for the work, regardless of spoiler level - for the debug screen only. */
export function getAllCanonFacts(workId: string): CanonFact[] {
  return loadAll().get(workId)?.canonFacts ?? [];
}

/**
 * All episodes for the work, regardless of spoiler level. Only for the
 * viewing-progress resolver, which must search past the (not yet known)
 * spoiler boundary to figure out where that boundary is.
 */
export function getAllEpisodes(workId: string): Episode[] {
  return loadAll().get(workId)?.episodes ?? [];
}

export function getArcs(workId: string): Arc[] {
  return loadAll().get(workId)?.arcs ?? [];
}

/** Named entities (characters, places, items) with aliases, used to normalize lies before storing them. */
export function getEntities(workId: string): Entity[] {
  return loadAll().get(workId)?.entities ?? [];
}
