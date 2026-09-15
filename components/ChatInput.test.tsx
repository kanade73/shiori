import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChatInput } from "./ChatInput";

afterEach(cleanup);

function setup(value = "こんにちは") {
  const onSend = vi.fn();
  render(<ChatInput value={value} onChange={() => {}} onSend={onSend} />);
  return { onSend, textarea: screen.getByPlaceholderText("感想やシーンの話を送ってみて...") };
}

describe("ChatInput: Enter で送信する", () => {
  it("Enter で送る", () => {
    const { onSend, textarea } = setup();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("Shift+Enter では送らない（改行）", () => {
    const { onSend, textarea } = setup();
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("IME の変換中（isComposing）に変換を確定する Enter では送らない", () => {
    const { onSend, textarea } = setup();
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("Safari のように確定の keydown が isComposing=false・keyCode=229 で来ても送らない", () => {
    const { onSend, textarea } = setup();
    fireEvent.keyDown(textarea, { key: "Enter", keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("変換を確定した後の Enter では送る", () => {
    const { onSend, textarea } = setup();
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("空白だけなら送らない", () => {
    const { onSend, textarea } = setup("   ");
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });
});
