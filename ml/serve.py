"""claims 抽出の推論サーバ。

  POST /extract  {"text": "...", "workTitle": "...", "userMessage": "..."}
              -> {"claims": [{subject, relation, object, negated, claim, quote}, ...], "latencyMs": 123}

アプリ側（lib/server/llm/extract.ts）の extractClaims の中身だけをこの HTTP 呼び出しに
差し替えれば、Gemini を叩かずに済む。grounding は**返さない**。canonFacts と照合して
canon/fabricated を決めるのはこれまで通りアプリ側の仕事（groundClaims）。

バックエンドは2つ。
  --backend hf    transformers + peft。依存が軽く、GPU が無くても --device cpu で動く。
                  ただし 1件ずつの生成が遅い（GPU で中央値 8秒台、CPU で 16秒台）
  --backend vllm  vLLM + LoRA。まとめて投げれば 1件あたり 0.3秒台まで落ちる。
                  アプリから使うならこちら（venv-vllm の python で起動する）

  python serve.py --backend vllm --model Qwen/Qwen3-1.7B --lora out/lora/adapter --port 8000
"""

# NOTE: `from __future__ import annotations` は入れない。
# 注釈が文字列になると FastAPI がリクエストボディのモデルを解決できず、
# `req` をクエリパラメータ扱いして 422 を返す。
import argparse
import os
import sys
import time
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import build_messages, clean_claims, parse_claims_json  # noqa: E402

_state: dict = {}


def load_vllm(model: str, lora: Optional[str], max_model_len: int, gpu_mem: float) -> None:
    from vllm import LLM, SamplingParams
    from transformers import AutoTokenizer

    try:
        tok = AutoTokenizer.from_pretrained(lora or model, trust_remote_code=True)
    except Exception:
        tok = AutoTokenizer.from_pretrained(model, trust_remote_code=True)
    kwargs = dict(model=model, max_model_len=max_model_len, gpu_memory_utilization=gpu_mem, trust_remote_code=True)
    lora_request = None
    if lora:
        from vllm.lora.request import LoRARequest

        kwargs.update(enable_lora=True, max_lora_rank=64)
        lora_request = LoRARequest("extractor", 1, lora)
    _state.update(
        backend="vllm",
        tok=tok,
        llm=LLM(**kwargs),
        lora_request=lora_request,
        sampling=SamplingParams,
        device="vllm",
    )


def load(model: str, lora: Optional[str], device: str, dtype: str) -> None:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    torch_dtype = {"bfloat16": torch.bfloat16, "float16": torch.float16, "float32": torch.float32}[dtype]
    # アダプタ側にトークナイザが入っていればそちら（学習時と完全に同じもの）を使う。
    # Trainer の途中チェックポイントには入っていないので、その場合はベースに落とす。
    try:
        tok = AutoTokenizer.from_pretrained(lora or model, trust_remote_code=True)
    except Exception:
        tok = AutoTokenizer.from_pretrained(model, trust_remote_code=True)
    try:
        mdl = AutoModelForCausalLM.from_pretrained(model, dtype=torch_dtype, trust_remote_code=True)
    except TypeError:  # transformers 4.5x は torch_dtype=
        mdl = AutoModelForCausalLM.from_pretrained(model, torch_dtype=torch_dtype, trust_remote_code=True)
    if lora:
        from peft import PeftModel

        mdl = PeftModel.from_pretrained(mdl, lora)
        mdl = mdl.merge_and_unload()  # 推論のたびのアダプタ加算を避ける
    mdl.to(device)
    mdl.eval()
    _state.update(backend="hf", tok=tok, model=mdl, device=device)


def render(tok, text: str, work_title: str, user_message: Optional[str]) -> str:
    msgs = build_messages(text, work_title, user_message)
    try:
        return tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    except TypeError:
        return tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)


def _generate(prompt: str, max_new_tokens: int) -> str:
    """バックエンドの違いをここだけに閉じ込める。返すのは生のモデル出力。"""
    if _state.get("backend") == "vllm":
        params = _state["sampling"](temperature=0.0, top_p=1.0, max_tokens=max_new_tokens)
        req = _state["lora_request"]
        outs = _state["llm"].generate([prompt], params, lora_request=req) if req else _state["llm"].generate([prompt], params)
        return outs[0].outputs[0].text

    import torch

    tok, mdl, device = _state["tok"], _state["model"], _state["device"]
    inputs = tok(prompt, return_tensors="pt", add_special_tokens=False).to(device)
    with torch.no_grad():
        out = mdl.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            pad_token_id=tok.pad_token_id or tok.eos_token_id,
        )
    return tok.decode(out[0][inputs["input_ids"].shape[1] :], skip_special_tokens=True)


def extract(text: str, work_title: str, user_message: Optional[str], max_new_tokens: int = 768):
    tok = _state["tok"]
    prompt = render(tok, text, work_title, user_message)
    raw = _generate(prompt, max_new_tokens)
    claims = parse_claims_json(raw)
    if claims is None:
        return [], raw
    # quote が本文に無いものは落とす（矛盾検査に使う以上、根拠の取れない主張は要らない）
    cleaned, _ = clean_claims(claims, text, require_quote=False)
    return cleaned, raw


def build_app():
    from fastapi import FastAPI
    from pydantic import BaseModel

    class Req(BaseModel):
        text: str
        workTitle: str = ""
        userMessage: Optional[str] = None
        maxNewTokens: int = 768

    app = FastAPI(title="chat-lora claims extractor")

    @app.get("/health")
    def health():
        return {"ok": True, "backend": _state.get("backend"), "device": _state.get("device")}

    @app.post("/extract")
    def do_extract(req: Req):
        t0 = time.time()
        if not req.text.strip():
            return {"claims": [], "latencyMs": 0}
        claims, raw = extract(req.text, req.workTitle or "", req.userMessage, req.maxNewTokens)
        return {"claims": claims, "latencyMs": round((time.time() - t0) * 1000, 1), "raw": raw}

    return app


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen3-1.7B")
    ap.add_argument("--lora", default=None)
    ap.add_argument("--backend", default="hf", choices=["hf", "vllm"])
    ap.add_argument("--device", default="cuda:0")
    ap.add_argument("--dtype", default="bfloat16", choices=["bfloat16", "float16", "float32"])
    ap.add_argument("--max-model-len", type=int, default=4096)
    ap.add_argument("--gpu-mem", type=float, default=0.85)
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()

    if args.backend == "vllm":
        load_vllm(args.model, args.lora, args.max_model_len, args.gpu_mem)
    else:
        if args.device.startswith("cpu") and args.dtype == "bfloat16":
            args.dtype = "float32"
        load(args.model, args.lora, args.device, args.dtype)
    print(f"loaded backend={args.backend} model={args.model} lora={args.lora}", flush=True)

    import uvicorn

    uvicorn.run(build_app(), host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
