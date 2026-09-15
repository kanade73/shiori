import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionTopic } from "./types";

// store は import 時に DATA_DIR を読むので、一時ディレクトリを指してから読み込む
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "store-topic-"));
let store: typeof import("./store");

beforeAll(async () => {
  process.env.DATA_DIR = dir;
  store = await import("./store");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const topic: SessionTopic = {
  title: "草むしり検定編",
  summary: "検定の話。",
  arcId: "arc-kentei",
  facts: [],
  sources: [{ title: "記事", url: "https://example.org/wiki/記事" }],
  query: "検定のところ",
  resolvedAt: "2026-09-15T00:00:00.000Z",
};

describe("store: 話題の場面（issue #14）", () => {
  it("新しいセッションは話題なし・境界 0 で始まる（話数は聞かない）", () => {
    const session = store.createSession("w");
    expect(session.currentEpisode).toBe(0);
    expect(session.topic).toBeUndefined();
    expect(session.progressDescription).toBeUndefined();
  });

  it("話題と境界を保存する", () => {
    const session = store.createSession("w");
    store.setSessionTopic(session.id, topic, 63);
    expect(store.getSession(session.id)).toMatchObject({ topic, currentEpisode: 63 });
  });

  it("一度決まった話題は差し替えず、境界は狭めない", () => {
    const session = store.createSession("w");
    store.setSessionTopic(session.id, topic, 63);
    store.setSessionTopic(session.id, { ...topic, title: "別の場面" }, 10);
    expect(store.getSession(session.id)).toMatchObject({ topic: { title: "草むしり検定編" }, currentEpisode: 63 });
  });

  it("無いセッションは null", () => {
    expect(store.setSessionTopic("missing", topic, 1)).toBeNull();
  });
});
