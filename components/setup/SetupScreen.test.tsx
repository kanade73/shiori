import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// スタート画面の「続きから」の一覧。API は差し替える。
const mocks = vi.hoisted(() => ({
  listWorks: vi.fn(),
  listSessions: vi.fn(),
  createSession: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/lib/client/api", () => mocks);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));

import { SetupScreen } from "./SetupScreen";

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listWorks.mockResolvedValue([{ id: "w", title: "テスト作品", createdAt: "" }]);
  mocks.listSessions.mockResolvedValue([
    {
      id: "s1",
      workId: "w",
      currentEpisode: 0,
      progressDescription: "前の会話",
      createdAt: "",
      updatedAt: "2026-09-14T03:05:00.000Z",
      fabricatedFactCount: 4,
    },
  ]);
});

describe("SetupScreen: 続きから", () => {
  it("過去のセッションは見出しと日時だけを出し、嘘の件数は出さない", async () => {
    render(<SetupScreen />);
    const row = (await screen.findByText("前の会話")).closest("button")!;
    const d = new Date("2026-09-14T03:05:00.000Z");
    expect(row.textContent).toContain(`${d.getMonth() + 1}/${d.getDate()}`);
    expect(row.textContent).not.toMatch(/嘘/);
    expect(row.textContent).not.toMatch(/件/);
  });
});
