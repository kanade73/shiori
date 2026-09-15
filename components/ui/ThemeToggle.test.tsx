import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeToggle } from "./ThemeToggle";

// テーマ切り替えは「data-theme 属性の反転」と「localStorage への保存」の2つを約束する。
// 現在値は data-theme を読む（layout の初期化スクリプトと同じルール）。
describe("ThemeToggle", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("クリックで data-theme が反転し localStorage に保存される", () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("button", { name: "テーマを切り替え" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: "テーマを切り替え" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("data-theme が dark ならライトへ切り替わる", () => {
    document.documentElement.dataset.theme = "dark";
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("button", { name: "テーマを切り替え" }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
