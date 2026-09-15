import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  getCreators: vi.fn(),
  loadChunksOfSource: vi.fn(),
  extractCreatorStyle: vi.fn(),
  dir: "",
}));
vi.mock("./works", () => ({ getCreators: mocks.getCreators, getWork: () => ({ id: "w", title: "テスト作品" }) }));
vi.mock("./sources", () => ({ loadChunksOfSource: mocks.loadChunksOfSource }));
vi.mock("./llm/creator", () => ({ extractCreatorStyle: mocks.extractCreatorStyle }));
vi.mock("./store", () => ({ dataDir: () => mocks.dir }));

import { clearCreatorCache, getCreatorProfiles } from "./creator";

const source = { kind: "mediawiki" as const, endpoint: "https://x/w/api.php", page: "作者" };
const chunk = { id: "creator-1", sourceTitle: "作者", url: "https://x/wiki/作者", heading: "概要", label: "", text: "作風の話" };

describe("getCreatorProfiles", () => {
  beforeEach(() => {
    mocks.dir = fs.mkdtempSync(path.join(os.tmpdir(), "creator-"));
    clearCreatorCache();
    vi.clearAllMocks();
  });

  it("creators が無ければ空", async () => {
    mocks.getCreators.mockReturnValue([]);
    expect(await getCreatorProfiles("w")).toEqual([]);
    expect(mocks.loadChunksOfSource).not.toHaveBeenCalled();
  });

  it("style が書いてあれば記事も API も使わない", async () => {
    mocks.getCreators.mockReturnValue([{ role: "原作", name: "A", style: ["可愛い絵柄の奥に不条理"] }]);
    expect(await getCreatorProfiles("w")).toEqual([{ role: "原作", name: "A", style: ["可愛い絵柄の奥に不条理"] }]);
    expect(mocks.loadChunksOfSource).not.toHaveBeenCalled();
    expect(mocks.extractCreatorStyle).not.toHaveBeenCalled();
  });

  it("source から作風を抜き、DATA_DIR に残して2回目は API を呼ばない", async () => {
    mocks.getCreators.mockReturnValue([{ role: "原作", name: "A", source }]);
    mocks.loadChunksOfSource.mockResolvedValue([chunk]);
    mocks.extractCreatorStyle.mockResolvedValue(["小物で語る"]);

    const first = await getCreatorProfiles("w");
    expect(first).toEqual([{ role: "原作", name: "A", style: ["小物で語る"], source: { title: "作者", url: "https://x/wiki/作者" } }]);
    expect(mocks.extractCreatorStyle).toHaveBeenCalledWith({ workTitle: "テスト作品", role: "原作", name: "A", chunks: [chunk] });
    expect(fs.existsSync(path.join(mocks.dir, "creators", "w.json"))).toBe(true);

    clearCreatorCache();
    const second = await getCreatorProfiles("w");
    expect(second).toEqual(first);
    expect(mocks.extractCreatorStyle).toHaveBeenCalledTimes(1);
  });

  it("記事が取れない・作風が抜けない作り手は飛ばす", async () => {
    mocks.getCreators.mockReturnValue([
      { role: "原作", name: "A", source },
      { role: "監督", name: "B", source },
      { role: "脚本", name: "C" },
    ]);
    mocks.loadChunksOfSource.mockResolvedValueOnce([]).mockResolvedValueOnce([chunk]);
    mocks.extractCreatorStyle.mockRejectedValueOnce(new Error("429"));
    expect(await getCreatorProfiles("w")).toEqual([]);
  });
});
