"""学習済み LoRA アダプタをベースモデルにマージして書き出す。

  python merge_lora.py --model Qwen/Qwen3-4B --lora out/lora-4b/adapter --out out/lora-4b/merged
"""
import argparse, os, sys
import torch
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train_lora import load_causal_lm

ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True)
ap.add_argument("--lora", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--device", default="cpu")
a = ap.parse_args()

from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

tok = AutoTokenizer.from_pretrained(a.lora, trust_remote_code=True)
base = load_causal_lm(AutoModelForCausalLM, a.model, torch.bfloat16)
base = base.to(a.device)
model = PeftModel.from_pretrained(base, a.lora)
merged = model.merge_and_unload()
merged.save_pretrained(a.out, safe_serialization=True)
tok.save_pretrained(a.out)
print("saved merged ->", a.out)
