"""小型 student に claims 抽出を LoRA で教える。

trl の SFTTrainer ではなく transformers の Trainer + peft を直に使っている。
理由は、プロンプト部分のマスク（completion-only loss）を自前で持ちたいから。
trl 側の API はバージョンで動きが変わるが、ここでは
「prompt のトークンは labels=-100、JSON 部分だけ損失」が常に保証される。

  python train_lora.py --data data/dataset/train.jsonl --out out/lora-qwen3-1.7b --epochs 3

1.7B + LoRA は 16GB 1枚に余裕で載るので、既定は 1 GPU。
torchrun での DDP は NCCL のパラメータ同期でこけた（HANDOFF.md 参照）ので使っていない。
"""

from __future__ import annotations

import argparse
import os
import sys

import torch
from torch.utils.data import Dataset

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import build_messages, claims_to_target, read_jsonl  # noqa: E402

STUDENT_DEFAULT = "Qwen/Qwen3-1.7B"


def load_causal_lm(cls, name: str, torch_dtype, **kw):
    """transformers 4.5x は torch_dtype=、5.x は dtype=。両方で動くようにする。"""
    try:
        return cls.from_pretrained(name, dtype=torch_dtype, trust_remote_code=True, **kw)
    except TypeError:
        return cls.from_pretrained(name, torch_dtype=torch_dtype, trust_remote_code=True, **kw)


def render_prompt(tok, text: str, work_title: str, user_message: str | None) -> str:
    messages = build_messages(text, work_title, user_message or None)
    try:
        return tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    except TypeError:
        return tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)


class ExtractDataset(Dataset):
    def __init__(self, rows: list[dict], tok, max_len: int):
        self.rows = rows
        self.tok = tok
        self.max_len = max_len

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, i: int) -> dict:
        r = self.rows[i]
        prompt = render_prompt(self.tok, r["text"], r["work_title"], r.get("user_message"))
        target = claims_to_target(r["claims"])
        p_ids = self.tok(prompt, add_special_tokens=False)["input_ids"]
        t_ids = self.tok(target, add_special_tokens=False)["input_ids"] + [self.tok.eos_token_id]
        ids = (p_ids + t_ids)[: self.max_len]
        labels = ([-100] * len(p_ids) + t_ids)[: self.max_len]
        return {"input_ids": ids, "labels": labels}


def collate(batch: list[dict], pad_id: int) -> dict:
    n = max(len(b["input_ids"]) for b in batch)
    input_ids, labels, mask = [], [], []
    for b in batch:
        pad = n - len(b["input_ids"])
        input_ids.append(b["input_ids"] + [pad_id] * pad)
        labels.append(b["labels"] + [-100] * pad)
        mask.append([1] * len(b["input_ids"]) + [0] * pad)
    return {
        "input_ids": torch.tensor(input_ids, dtype=torch.long),
        "labels": torch.tensor(labels, dtype=torch.long),
        "attention_mask": torch.tensor(mask, dtype=torch.long),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default=STUDENT_DEFAULT)
    ap.add_argument("--epochs", type=float, default=3.0)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--batch", type=int, default=2)
    ap.add_argument("--accum", type=int, default=8)
    ap.add_argument("--max-len", type=int, default=2048)
    ap.add_argument("--rank", type=int, default=32)
    ap.add_argument("--alpha", type=int, default=64)
    ap.add_argument("--merge", action="store_true", help="学習後にマージ済みモデルも書き出す")
    ap.add_argument("--grad-ckpt", type=int, default=0, help="1 で gradient checkpointing（省メモリ・遅い）")
    args = ap.parse_args()

    from peft import LoraConfig, get_peft_model
    from transformers import AutoModelForCausalLM, AutoTokenizer, Trainer, TrainingArguments

    tok = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True)
    if tok.pad_token_id is None:
        tok.pad_token = tok.eos_token

    rows = read_jsonl(args.data)
    ds = ExtractDataset(rows, tok, args.max_len)
    print(f"train rows: {len(ds)}")

    model = load_causal_lm(AutoModelForCausalLM, args.model, torch.bfloat16, attn_implementation="sdpa")
    model.config.use_cache = False
    if args.grad_ckpt:
        # gradient checkpointing と LoRA を併用すると、入力側に grad が流れず
        # 「element 0 of tensors does not require grad」で落ちることがある
        model.enable_input_require_grads()
    lora = LoraConfig(
        r=args.rank,
        lora_alpha=args.alpha,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    )
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()

    targs = TrainingArguments(
        output_dir=args.out,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch,
        gradient_accumulation_steps=args.accum,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.03,
        logging_steps=5,
        save_strategy="epoch",
        save_total_limit=1,
        bf16=True,
        gradient_checkpointing=bool(args.grad_ckpt),
        gradient_checkpointing_kwargs={"use_reentrant": False},
        report_to=[],
        ddp_find_unused_parameters=False,
        remove_unused_columns=False,
    )
    trainer = Trainer(
        model=model,
        args=targs,
        train_dataset=ds,
        data_collator=lambda b: collate(b, tok.pad_token_id),
    )
    trainer.train()

    if trainer.is_world_process_zero():
        adapter_dir = os.path.join(args.out, "adapter")
        model.save_pretrained(adapter_dir)
        tok.save_pretrained(adapter_dir)
        print(f"saved adapter -> {adapter_dir}")
        if args.merge:
            merged = model.merge_and_unload()
            merged_dir = os.path.join(args.out, "merged")
            merged.save_pretrained(merged_dir, safe_serialization=True)
            tok.save_pretrained(merged_dir)
            print(f"saved merged -> {merged_dir}")


if __name__ == "__main__":
    main()
