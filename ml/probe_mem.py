"""4B + LoRA の最長バッチでのピークメモリを測る（本番学習前の OOM 確認）。"""
import argparse, os, sys, json
import torch
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import read_jsonl
from train_lora import ExtractDataset, collate, load_causal_lm

ap = argparse.ArgumentParser()
ap.add_argument("--data", required=True)
ap.add_argument("--model", default="Qwen/Qwen3-4B")
ap.add_argument("--batch", type=int, default=1)
ap.add_argument("--max-len", type=int, default=1664)
ap.add_argument("--rank", type=int, default=32)
ap.add_argument("--alpha", type=int, default=64)
ap.add_argument("--grad-ckpt", type=int, default=1)
ap.add_argument("--steps", type=int, default=3)
a = ap.parse_args()

from peft import LoraConfig, get_peft_model
from transformers import AutoTokenizer, AutoModelForCausalLM

tok = AutoTokenizer.from_pretrained(a.model, trust_remote_code=True)
if tok.pad_token_id is None:
    tok.pad_token = tok.eos_token
rows = read_jsonl(a.data)
ds = ExtractDataset(rows, tok, a.max_len)
lens = [len(ds[i]["input_ids"]) for i in range(len(ds))]
order = sorted(range(len(lens)), key=lambda i: -lens[i])
import statistics
print(f"len: max={max(lens)} p99={sorted(lens)[int(len(lens)*0.99)]} median={statistics.median(lens)} n_over_{a.max_len}={sum(1 for l in lens if l>=a.max_len)}", flush=True)

model = load_causal_lm(AutoModelForCausalLM, a.model, torch.bfloat16, attn_implementation="sdpa")
model.config.use_cache = False
if a.grad_ckpt:
    model.enable_input_require_grads()
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
lora = LoraConfig(r=a.rank, lora_alpha=a.alpha, lora_dropout=0.05, bias="none", task_type="CAUSAL_LM",
                  target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"])
model = get_peft_model(model, lora)
model.print_trainable_parameters()
model.cuda()
print(f"after load: {torch.cuda.memory_allocated()/2**30:.2f} GiB", flush=True)
opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=1e-4)
model.train()
# 最長のものから順に batch を作る（worst case）
for s in range(a.steps):
    idx = order[s*a.batch:(s+1)*a.batch]
    b = collate([ds[i] for i in idx], tok.pad_token_id)
    b = {k: v.cuda() for k, v in b.items()}
    out = model(**b)
    out.loss.backward()
    opt.step(); opt.zero_grad(set_to_none=True)
    print(f"step {s} seq={b['input_ids'].shape} loss={out.loss.item():.4f} peak={torch.cuda.max_memory_allocated()/2**30:.2f} GiB reserved={torch.cuda.max_memory_reserved()/2**30:.2f} GiB", flush=True)
print("PROBE_OK")
