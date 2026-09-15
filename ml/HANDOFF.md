# ml/ HANDOFF

このディレクトリだけで完結する作業ログ。リポジトリ直下の `HANDOFF.md` には**触っていない**
（別セッションが編集中のため）。アプリ側のコード（`app/` `lib/` `components/`）も一切変更していない。

## 何をしたか

シオリの返答文 → 設定上の主張の三つ組、という抽出（`lib/server/llm/extract.ts` の
`extractClaims`）を Gemini API から剥がすために、**小型モデルに LoRA を当てた**。

- Gemini API 呼び出しを1発話あたり1回（generate）減らせる
- ハッカソンの技術点として「3日のうちに教師データ合成から fine-tune・評価・推論サーバまで通した」
- `grounding`（canon / fabricated）は**モデルに出させていない**。canonFacts との照合で
  アプリ側の `groundClaims` が決める、という既存の設計をそのまま守っている

**アプリ側への組み込みはまだしていない。** `extract.ts` の中の Gemini 呼び出しを
`ml/serve.py` の `POST /extract` に差し替えるところが次の一手（README 末尾に手順）。

### 結果のひとこと要約

| | 素の 1.7B | **LoRA 後** | teacher 14B zero-shot |
|---|---|---|---|
| JSON パース率 | 0.89 | **0.99** | 1.00 |
| quote が本文の literal な部分文字列 | - | **0.98** | 0.92 |
| 三つ組 厳密F1 | 0.053 | **0.267** | 0.325 |

- **形式の習得は成功**。`{"claims": [...]}` を必ず返し、quote が本文から取れている割合は
  teacher より高い。後段（矛盾検査・`FabricatedFact` 保存）に流す形としては足りている
- **中身は teacher の zero-shot に届かなかった**（0.267 vs 0.325）。学習 loss は 0.16 まで
  落ちているので underfit ではない。1.7B の容量と、教師データ 3062件という量の問題
- 詳しい表と誤りの内訳は `ml/README.md` の「結果」節

## 成果物の場所

### リモート（gpu04.ced.cei.uec.ac.jp / ユーザー h2511188）

| もの | パス |
|---|---|
| スクリプト一式・ログ | `~/chat-lora/`（= `/home2/y2025/h2511188/chat-lora`） |
| venv・HFキャッシュ・重み・データ | `/var/tmp/h2511188/chat-lora/`（**ホームは quota が厳しいので置けない**） |
| 学習済み LoRA アダプタ | `/var/tmp/h2511188/chat-lora/out/lora/adapter` |
| マージ済み student | `/var/tmp/h2511188/chat-lora/out/lora/merged` |
| 教師データ | `/var/tmp/h2511188/chat-lora/data/dataset/{train,holdout}.jsonl` |
| 評価結果 | `/var/tmp/h2511188/chat-lora/out/eval-*.json`（`.preds.jsonl` に生出力） |

`~/chat-lora/env.sh` を `source` すると `$SCRATCH` `$VLLM_PY` `$TRAIN_PY` `$ML` が入る。

**`/var/tmp` はローカルディスクなので、マシンの初期化や掃除で消える可能性がある。**
消えたら `run_all.sh` を回し直せば作り直せる（スクリプトはホーム側に残る）。

### ローカル（このリポジトリ）

`ml/` にスクリプト一式と README。モデル重みと生成データは `ml/.gitignore` で除外。
中身の確認用に `ml/samples.jsonl`（20件）だけ入れてある。

## 長い処理の回し方

ssh が切れても続くよう、**必ず tmux の中で回す**（ノートを閉じても平気）。

```bash
ssh h2511188@gpu04.ced.cei.uec.ac.jp
tmux new-session -d -s pipeline "bash ~/chat-lora/run_all.sh 3200 8 2 > ~/chat-lora/logs/pipeline.log 2>&1"
tmux ls                       # 生きているか
tail -f ~/chat-lora/logs/pipeline.log
```

使った tmux セッション名: `setup` / `fetch` / `synth` / `train` / `evalT` / `evalS` / `evalF` /
`latGPU` / `latCPU` / `serve`。**作業後はすべて落としてある**（共用マシンなので GPU を掴んだままに
しない）。推論サーバを使うときは README の「推論サーバ」節のコマンドで立て直す。

所要時間の目安（A4000）: 合成 3200件 = 8 GPU で約 20分 / 学習 2 epoch = 1 GPU で 55分 /
評価 1 設定 = 1〜2分。

## ハマったところ（同じところで詰まらないように）

1. **ホームの quota**。`pip install vllm` の途中で `Disk quota exceeded`。
   venv も HF キャッシュも `/var/tmp/h2511188/` に逃がした
2. **CUDA バージョン**。素の `uv pip install vllm` は vllm 0.29 + torch cu130 を引き、
   driver 570（CUDA 12.8）では `The NVIDIA driver on your system is too old`。
   `vllm==0.11.0`（torch 2.8.0+cu128）に固定
3. **transformers 5.x と vLLM 0.11 が非互換**。
   `Qwen2Tokenizer has no attribute all_special_tokens_extended`。両 venv とも `4.56.2` に固定
4. **システム Python に `Python.h` が無い**（`sudo` 不可）。triton の JIT が
   `cuda_utils.c` をコンパイルできず vLLM が起動しない。`uv python install 3.11` で
   uv 管理の Python（ヘッダ同梱）を入れ、その Python で venv を作って回避
5. **Gemma はゲート付き**（manual approval）でトークン無しでは落とせない → Qwen 系に統一
6. **Trainer のログがファイルに出ない**。リダイレクト先だと stdout がブロックバッファに
   なるため。`PYTHONUNBUFFERED=1` を付ける（`run_all.sh` に入れてある）
7. **学習の OOM は「平均」ではなく「最長バッチ」で決まる**。語彙 15万の logits が
   `batch × seq × 151936` で数 GB になり、系列長が中央値 843 / 最大 1602 とばらつくので、
   batch 4 は 39 ステップ目まで走ってから落ちた。batch 2 + accum 32 + grad checkpointing で 10.3GB
8. **`serve.py` に `from __future__ import annotations` を入れると FastAPI が 422 を返す**。
   注釈が文字列になり、関数内定義の pydantic モデルを解決できずクエリ扱いになる
9. **gpu04 に `curl` が無い**。動作確認は `wget --post-data` か Python の urllib で
10. **port 8000 は他プロセスが使っていることがある**。塞がっていると uvicorn が即死するので別ポートへ

## 仮置きにした判断

- **教師データは teacher の出力そのまま**（few-shot 付き stage B）。人手の検品はしていないので、
  student の上限は teacher の抽出品質で決まる。評価表の `teacher-few` が事実上の天井
- **作品は `chiikawa` の1つだけ**で合成した。他作品へ効くかは未検証。
  ただしプロンプトに作品固有の語を焼き込んでいないので、`work.json` を足して
  `run_synth.sh --work` を差し替えれば同じ手順で増やせる
- **`claim`（一文の要約）も出力させている**。矛盾検査には三つ組しか要らないが、
  debug 画面に出す文が要るので残した。評価は三つ組だけで採点している
- **`quote` が本文から復元できない claim は学習データから捨てている**（約12%）。
  teacher が言い換えた quote を学ぶと、後段で嘘の該当箇所を切り出せなくなるため
- **エポック数は 2**。3 エポックで始めたが OOM で落ち、2 で回し直した。
  最後の loss は 0.115 で平ら、1 エポック時点の評価（厳密F1 0.217）から 2 エポックで
  0.267 に上がっているので、3 エポック目で多少は伸びる可能性はある（未検証）
- **評価指標を3つ出している**。厳密一致だけだと object の言い回しのずれで不当に低く出るため、
  緩い一致（`extract.ts` の `objectMatches` と同じ包含判定）と主語+関係だけの一致も並べた
- **推論サーバは認証なし・単一プロセス**。ハッカソン用途の割り切り

## うまくいっていない / 未確認

- **student が teacher zero-shot に勝てていない**（厳密F1 0.267 vs 0.325）。
  次に効きそうな順に: ① 教師データを 1万件規模に増やす ② student を Qwen3-4B にする
  ③ 長い文での取りこぼし対策（文を分割して投げる）
- **否定の取り違え**。「〜が苦手ってよく言われるけど、あれは違うの」を
  `negated: false` と取る。学習データ中の否定が 8.9% しかない。
  `synth.py` の `want_negation` の確率（今 25%）を上げるのが手っ取り早い
- **長い文で主張を取りこぼす**。gold 6件に対して 2件しか出さない例がある
- アプリ（`lib/server/llm/extract.ts`）への接続は未実施
- **CPU 推論は動くが遅い**（中央値 16.4秒）。本番 Fly.io の1コンテナで回すのは非現実的で、
  使うなら GPU サーバを別に立てて HTTP で叩く形になる。
  transformers バックエンドは GPU でも 8.3秒かかるので、**必ず `--backend vllm` で起動する**（0.9〜2.3秒）
- `other` relation がデータにほとんど出ていない（teacher が具体的な relation を選ぶため）
- 複数作品・複数キャラの混線（別名の解決ミス）は評価していない
- **`torchrun` の DDP は動かなかった**（`DDP expects same model across all ranks ... rank 0 has
  inconsistent 0 params`）。1枚で足りたので追っていない。将来モデルを大きくするときは再調査が要る
