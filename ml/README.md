# ml/ — claims 抽出の軽量モデル（LoRA）

> **採用は Qwen3-1.7B + LoRA（マージ済み）。4B は精度比較用に残しているだけ。**
> アプリの抽出は常にこのサーバで行い、Gemini は使わない（`lib/server/llm/extract.ts`）。
> 4B の方が厳密F1 は高い（0.392 vs 0.267）が、1件 6秒前後かかって会話が止まる。
> 1.7B は 1〜2秒で、体験としてはこちらが勝つ、という判断。
> 既定の起動は `$SCRATCH/out/lora/merged` をポート **8123**（下の「推論サーバ」節）。

シオリの返答文から「作品の設定についての主張」を三つ組で取り出す工程
（`lib/server/llm/extract.ts` の `extractClaims`）を、Gemini API ではなく
手元の小型モデルで動かすための一式。

- **入力**: シオリの返答文（日本語・口語）＋作品名＋直前のユーザー発言（文脈）
- **出力**: `{"claims": [{subject, relation, object, negated, claim, quote}, ...]}`
- **出力に含めないもの**: `grounding`（canon / fabricated）。これは canonFacts との
  照合でアプリ側（`groundClaims`）が決める。モデルに判定させると作り話が canon 扱いに
  なって `FabricatedFact` に残らない取りこぼしが出る、という理由で分けてある

`relation` は `lib/server/claims.ts` の `CLAIM_RELATIONS`（15語）に閉じている。

## ファイル

| ファイル | 役割 |
|---|---|
| `common.py` | プロンプトの形・正規化・出力の検証。**学習/評価/推論すべてがここを通る**（学習時と推論時のフォーマットずれ防止） |
| `synth.py` | 教師データ合成。stage A（シオリらしい返答文を書かせる）→ stage B（本番と同じ指示 + few-shot で三つ組に分解させる） |
| `run_synth.sh` | 合成を GPU 枚数ぶんデータ並列で回す（1 GPU = 1 プロセス = 1 シャード） |
| `build_dataset.py` | 合成結果の検証・重複除去・train/holdout 分割 |
| `train_lora.py` | student に LoRA を当てる。transformers Trainer + peft、completion-only loss |
| `eval.py` | ホールドアウトでの三つ組 F1 / JSON パース率。vLLM で 4 設定を比較 |
| `eval_hf.py` | serve.py と同じ transformers 経路でホールドアウトを流し、予測とレイテンシを出す。vLLM 側の LoRA 適用が正しいかの突き合わせにも使う |
| `latency.py` | 1件あたりのレイテンシだけを測る簡易版 |
| `summarize.py` | 評価 JSON をまとめて 1 枚の表にする |
| `run_eval.sh` | 4 設定の評価を順に回す |
| `serve.py` | 推論サーバ。`POST /extract` |
| `run_all.sh` | 合成 → データ化 → 学習 → 評価 を一本で流す |
| `env.sh` / `setup_env.sh` | サーバ側の共通パスと venv 構築。**リモートでは `~/chat-lora/` に置く** |
| `probe_mem.py` | 学習前の OOM 確認。データの**最長**のものから順に forward/backward してピークメモリを出す |
| `merge_lora.py` | 学習済みアダプタをベースにマージして書き出す（`train_lora.py --merge` を後からやる版） |
| `samples.jsonl` | 生成データのサンプル20件（中身の確認用。学習には使わない） |

モデル重みと生成データはリポジトリに入れない（`ml/.gitignore`）。

## 使ったモデル

| 役割 | モデル | 備考 |
|---|---|---|
| teacher（合成） | `Qwen/Qwen3-14B-AWQ` | A4000 16GB に 1枚で載る。ゲートなし |
| **student v1（採用・アプリが叩くもの）** | `Qwen/Qwen3-1.7B` | LoRA r=32 / alpha=64、bf16。厳密F1 0.267、**1件 1〜2秒** |
| student v2（精度比較用） | `Qwen/Qwen3-4B` | LoRA r=64 / alpha=128、bf16。厳密F1 0.392 で teacher zero-shot（0.325）を超えたが、**1件 6秒前後** |

Gemma はゲート付き（manual approval）でトークンが無いと落とせないため使っていない。

教師データは v1 と同じもの（3062件）を使い回している。student を大きくしただけで
厳密F1 は 0.267 → 0.392。**1.7B の頭打ちは容量側だった**ことがこれで確かめられた。
代わりに 1件あたりのレイテンシは 1〜2秒台から 6秒台に落ちる（下の「レイテンシ」）。

**アプリが叩くのは 1.7B の方**。抽出は1発話ごとに逐次で走るので、6秒はシオリの返答の
後ろで会話を止める長さになる。精度 0.267 は「主張を取りこぼす／言い回しがずれる」
程度の劣化で、取りこぼした嘘が保存されないだけ（矛盾は生まない）。
体験の側を取って 1.7B を採用した。4B は比較のために残してある。

## 環境構築（GPU サーバ）

RTX A4000 16GB × 10、driver 570.153（CUDA 12.8）、`nvcc` なし、`sudo` なし。

```bash
# uv 管理の Python（ヘッダ同梱）
~/.local/bin/uv python install 3.11
PY311=$(~/.local/bin/uv python find 3.11)

export SCRATCH=/var/tmp/$USER/chat-lora
export UV_CACHE_DIR=$SCRATCH/.uvcache HF_HOME=$SCRATCH/.hf

# 合成・評価用（vLLM）
uv venv $SCRATCH/venv-vllm --python "$PY311"
uv pip install --python $SCRATCH/venv-vllm/bin/python "vllm==0.11.0" "transformers==4.56.2"

# 学習・推論用
uv venv $SCRATCH/venv-train --python "$PY311"
uv pip install --python $SCRATCH/venv-train/bin/python torch --index-url https://download.pytorch.org/whl/cu128
uv pip install --python $SCRATCH/venv-train/bin/python \
  "transformers==4.56.2" "peft==0.17.1" "trl==0.21.0" "accelerate>=1.6" datasets fastapi uvicorn
```

`transformers` を 4.56.2 に固定しているのは、5.x だと vLLM 0.11 が
`Qwen2Tokenizer has no attribute all_special_tokens_extended` で落ちるため。

### 詰まった点（同じところで止まらないように）

1. **ホームに quota がある**。venv・HF キャッシュ・チェックポイントは
   ローカルディスク（`/var/tmp/<user>/chat-lora`）に置く。ホームにはスクリプトだけ
2. **`pip install vllm`（0.29）は CUDA 13 の torch を引く**。driver 570 では
   `The NVIDIA driver on your system is too old` で落ちる。`vllm==0.11.0`
   （torch 2.8.0+cu128）を明示して入れる
3. **システム Python に開発ヘッダ（`Python.h`）が無い**。triton の JIT が
   `cuda_utils.c` をコンパイルできず vLLM の起動に失敗する。`uv python install 3.11`
   で uv 管理の Python を入れ、その Python で venv を作ると同梱ヘッダで通る
4. **transformers 5.x と vLLM 0.11 が非互換**
   （`Qwen2Tokenizer has no attribute all_special_tokens_extended`）。両 venv とも 4.56.2 に固定
5. **`torchrun` の DDP が動かない**。
   `DDP expects same model across all ranks, but Rank 3 has 392 params, while rank 0 has
   inconsistent 0 params` で、GPU が 100% のまま 25分回って死ぬ。
   1.7B + LoRA は1枚に載るので追わずに 1 GPU に切り替えた
6. **語彙 15万の cross-entropy が効いてバッチを上げられない**。logits が
   `batch × seq × 151936` の fp32 で数 GB になる。系列長は中央値 843 / 最大 1602
   トークンとばらつくので、**平均的なバッチでは足りていても長いバッチで落ちる**
   （1.7B は batch 8 が即 OOM、batch 4 は 39 ステップ目で OOM）。1.7B は
   batch 2 + accum 32 + gradient checkpointing で 10.3GB、4B は **batch 1** + accum 32 で 12〜13.5GB
7. **OOM は `probe_mem.py` で先に潰す**。長いバッチでしか落ちないので、数十ステップの
   スモークでは見つからない。`probe_mem.py` は**データの最長のものから順に**
   forward/backward するので、1分で「その設定が最悪ケースで落ちるか」が分かる。
   4B の実測は batch 1 でピーク 11.6 GiB（reserved 12.9）、batch 2 は backward で
   1.68 GiB 確保できず OOM。3 エポックを投げる前にこれを回すこと
8. **`serve.py` に `from __future__ import annotations` を入れると FastAPI が 422 を返す**。
   注釈が文字列になり、関数内で定義した pydantic モデルを解決できずクエリ扱いになる
9. **`serve.py` を同時に叩くと、入力と無関係な三つ組が返る**。FastAPI は `def`
   （非 async）のハンドラをスレッドプールで動かすので、リクエストが重なると
   `llm.generate()` が別スレッドから並行して呼ばれる。vLLM は走行中のエンジンに
   別スレッドのプロンプトを差し込み、`outs[0]` が**他のリクエストの出力**になる
   （ログに `Processed prompts: 2it` が出たら混線している）。生成を `threading.Lock`
   で直列化して直した。単発で叩いている限り再現しないので、アプリを繋ぐまで気づかない
10. **Trainer のログがファイルに出ない**。リダイレクト先だと stdout がブロックバッファに
   なるだけ。`PYTHONUNBUFFERED=1` を付ける
11. **vLLM を止めても GPU が空かないことがある**。`serve.py` を kill しても
   `VLLM::EngineCore` の子プロセスが残ってメモリを掴む。
   `nvidia-smi --query-compute-apps=pid,used_memory --format=csv` で確認して kill -9 する

## 再現手順

`env.sh`（パスをまとめたもの）を用意したうえで、長い処理は必ず tmux の中で回す。

```bash
tmux new-session -d -s pipeline "bash ~/chat-lora/run_all.sh 3200 8 2 > ~/chat-lora/logs/pipeline.log 2>&1"
tmux ls; tail -f ~/chat-lora/logs/pipeline.log
```

段階を分けて回す場合:

```bash
# 1. 合成（3200シナリオを 8 GPU にデータ並列）
bash ~/chat-lora/run_synth.sh 3200 8 $SCRATCH/data/synth

# 2. 検証・分割
$SCRATCH/venv-train/bin/python build_dataset.py --in $SCRATCH/data/synth --out $SCRATCH/data/dataset --holdout 100

# 3. LoRA 学習（1 GPU。DDP は下の「詰まった点」を参照）
CUDA_VISIBLE_DEVICES=0 $SCRATCH/venv-train/bin/python train_lora.py \
  --data $SCRATCH/data/dataset/train.jsonl --out $SCRATCH/out/lora \
  --epochs 2 --batch 2 --accum 32 --grad-ckpt 1 --max-len 1664 --merge

# 4. 評価（4 設定）
bash run_eval.sh          # まとめて。個別なら↓
CUDA_VISIBLE_DEVICES=0 $SCRATCH/venv-vllm/bin/python eval.py \
  --data $SCRATCH/data/dataset/holdout.jsonl --setup student-lora \
  --model Qwen/Qwen3-1.7B --lora $SCRATCH/out/lora/adapter --out $SCRATCH/out/eval-student-lora.json
```

### 4B（比較用）の学習

DDP は動かないので分散はしない。代わりに**ハイパーパラメータ違いを別 GPU で同時に回す**。
A4000 1枚 = 1 設定で、3 エポックが約 2時間20分（288 step × 29 秒）。

```bash
source ~/chat-lora/env.sh
export PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1 PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

# 投げる前に最悪ケースのメモリを確認する（1分）
CUDA_VISIBLE_DEVICES=0 $TRAIN_PY probe_mem.py \
  --data $SCRATCH/data/dataset/train.jsonl --model Qwen/Qwen3-4B --batch 1 --max-len 1664

COMMON="--data $SCRATCH/data/dataset/train.jsonl --model Qwen/Qwen3-4B \
  --batch 1 --accum 32 --grad-ckpt 1 --max-len 1664"
CUDA_VISIBLE_DEVICES=0 nohup $TRAIN_PY train_lora.py $COMMON --out $SCRATCH/out/lora-4b-a \
  --lr 1e-4 --rank 32 --alpha 64  --epochs 3 > $ML/logs/train4b-a.log 2>&1 &
CUDA_VISIBLE_DEVICES=1 nohup $TRAIN_PY train_lora.py $COMMON --out $SCRATCH/out/lora-4b-b \
  --lr 2e-4 --rank 64 --alpha 128 --epochs 3 > $ML/logs/train4b-b.log 2>&1 &
CUDA_VISIBLE_DEVICES=2 nohup $TRAIN_PY train_lora.py $COMMON --out $SCRATCH/out/lora-4b-c \
  --lr 5e-5 --rank 32 --alpha 64  --epochs 2 > $ML/logs/train4b-c.log 2>&1 &

# 評価も別 GPU で並行できる
CUDA_VISIBLE_DEVICES=3 $VLLM_PY eval.py --data $SCRATCH/data/dataset/holdout.jsonl \
  --setup student-lora --model Qwen/Qwen3-4B --lora $SCRATCH/out/lora-4b-b/adapter \
  --out $SCRATCH/out/eval-4b-lora-b.json

# 勝った設定をマージして推論用に置く
cp -r $SCRATCH/out/lora-4b-b/adapter $SCRATCH/out/lora-4b/adapter
CUDA_VISIBLE_DEVICES=0 $TRAIN_PY merge_lora.py --model Qwen/Qwen3-4B \
  --lora $SCRATCH/out/lora-4b/adapter --out $SCRATCH/out/lora-4b/merged --device cuda
```

`eval.py` / `serve.py` の `max_lora_rank` は 64 なので、r はそこまで上げられる。

## 教師データ

work.json（`data/chiikawa/work.json`）の entities / canonFacts / episodes / arcs と
relation 語彙だけを材料に、以下の軸をランダムに振ってシナリオを組み、teacher に
1往復の会話を書かせている。

- 質問種別（theory / fact_question / doubt / chat / reaction / episode / arc）
- 返答の長さ（1〜2文 / 3〜4文 / 5〜6文）と語り口（断定・もったいぶる・小声 など）
- 主張の数（0〜4個）。**約2割は設定に触れない雑談**にして空配列を学ばせる
- 25% の確率で否定形（`negated: true`）を1つ含める
- 70% の確率で「材料に無い作り話」を混ぜる（本番でシオリがつく嘘に相当）
- 45% の確率でキャラを別名（`entities.aliases`）で呼ばせる（正式名へ寄せる訓練）

合成後、スクリプトで次を検証して通らないものを捨てる。

- ラベルが `{"claims": [...]}` としてパースできる
- `relation` が閉じた語彙の中にある / subject・object が空でない
- `quote` が返答文の literal な部分文字列である（空白・鉤括弧のズレだけなら復元する）
- 返答文の重複がない
- 「主張を入れろ」と指示したのに claims が空になった行は teacher の取りこぼしとして捨てる

## 結果

### データ

| 項目 | 値 |
|---|---|
| 合成したシナリオ | 3200（8 GPU にデータ並列、stage A のパース成功 3200/3200） |
| 検証を通った件数 | 3162（train 3062 / holdout 100） |
| 抽出された claims | 10996（平均 3.48 件/文） |
| 主張ゼロの文 | 396 件（12.5%） |
| 否定（negated: true） | 975 件（8.9%） |
| relation の分布 | related_to 2811 / did 1887 / origin 1723 / has 990 / identity 878 / can 763 / secret 630 / ほか（15語すべて出現） |
| quote 不一致で捨てた claim | 1320（約 12%） |

### 精度（holdout 100件、greedy）

| 設定 | JSONパース率 | 厳密F1 | 緩いF1 | 主語+関係F1 | 完全一致 | quote有効率 | バッチ推論 ms/件 |
|---|---|---|---|---|---|---|---|
| student 素 (Qwen3-1.7B, zero-shot) | 0.89 | 0.053 | 0.082 | 0.120 | 0.00 | - | 254 |
| student 素 (Qwen3-4B, zero-shot) | 1.00 | 0.141 | 0.187 | 0.276 | 0.08 | 0.89 | 341 |
| **student + LoRA (Qwen3-1.7B)（採用）** | 0.99 | **0.267** | 0.319 | 0.407 | 0.13 | 0.98 | 321 |
| teacher zero-shot (Qwen3-14B-AWQ) | 1.00 | 0.325 | 0.420 | 0.527 | 0.18 | 0.92 | 551 |
| student + LoRA (Qwen3-4B) | 1.00 | 0.392 | 0.455 | 0.534 | 0.20 | 0.99 | 262 |
| 同・4B マージ済み | 1.00 | 0.386 | 0.443 | 0.523 | 0.20 | 0.99 | 253 |
| teacher few-shot（ラベル生成と同条件＝上限） | 1.00 | 0.946 | 0.941 | 0.944 | 0.77 | 0.92 | 659 |

- **厳密F1**: 正規化した (subject, relation, object, negated) の完全一致
- **緩いF1**: object が包含関係なら一致とみなす（`extract.ts` の `objectMatches` と同じ基準）
- **主語+関係F1**: object の言い回しを問わない。「誰について・どの種類の主張か」だけを見る
- **teacher few-shot は上限であって競争相手ではない**。ラベルを作ったのがこの設定そのもの
  （同じモデル・同じプロンプト・greedy）なので、自分の出力を再現しているだけ。0.946 は
  「この採点方法の天井」を示すための行
- マージ済みの 0.386 とアダプタの 0.392 の差は bf16 のマージ時の丸め。実質同じ

### 4B のハイパーパラメータ比較（同じ教師データ 3062件、batch 1 + accum 32 + grad-ckpt）

3 設定を別 GPU で同時に走らせた。**大きい r と大きい lr が効いた**。

| run | lr | r / alpha | epoch | 最終 loss | ピークVRAM | 所要 | 厳密F1 |
|---|---|---|---|---|---|---|---|
| a | 1e-4 | 32 / 64 | 3 | 0.065 | 12.4 GB | 2h20m | 0.367 |
| **b（採用）** | **2e-4** | **64 / 128** | **3** | **0.036** | 13.5 GB | 2h20m | **0.392** |
| c | 5e-5 | 32 / 64 | 2 | 0.093 | 12.4 GB | 1h32m | 0.309 |

2 エポック（c）でも 1.7B の 3 エポック相当（0.267）を超えている。
c と a の差（0.309 → 0.367）にエポックと lr が両方効いているので、
**4 エポック以上と lr 3e-4 はまだ試す余地がある**（未検証）。

### 読み取れること

- **1.7B の頭打ちは容量側だった**。教師データも指示もまったく同じまま student を
  1.7B → 4B にしただけで 0.267 → 0.392。前回「データ量の問題かもしれない」と
  書いた点は、**少なくとも 4B までは容量側が支配的**だった
- **teacher zero-shot（0.325）を超えた**。14B に few-shot なしで解かせるより、
  4B を 3062 件で LoRA した方が良い。当初の狙いは達成
- **形式は 1.7B の時点で完璧、4B でも維持**。JSON パース率 1.00、quote が本文の
  literal な部分文字列である割合 0.99（teacher は 0.92）
- **伸びたのは主に精度側**。precision 0.266 → 0.385、recall 0.268 → 0.400 で、
  誤検出と取りこぼしが両方減っている。ただし主語+関係F1 は 0.407 → 0.534 で、
  **「誰について何を言ったか」は teacher zero-shot（0.527）とほぼ並んだのに対し、
  object の言い回しのずれは残っている**（緩いF1 0.455 < teacher 0.420 は超えたが差は小さい）
- **否定の弱さは未検証**。学習データ中の否定が 8.9% という偏りは 4B でも同じなので、
  改善しているとは限らない。`synth.py` の `want_negation` を上げる案はそのまま残っている

### レイテンシ（1件ずつ、warmup 後、A4000 1枚）

| 構成 | 中央値 | 平均 | p90 | 備考 |
|---|---|---|---|---|
| 4B マージ済み・vLLM | 6.1秒 | 5.9秒 | 8.9秒 | `serve.py --backend vllm`、n=30（holdout） |
| 4B + LoRA アダプタ・vLLM | 8.3秒 | 8.3秒 | 13.3秒 | 同 n=30。**アダプタ適用のオーバーヘッドで 27% 遅い** |
| （参考）4B マージ済み、短い文 3例 | 1.8〜3.2秒 | - | - | 主張 1〜2個の短文ならこのくらい |
| **1.7B + LoRA・vLLM（採用）** | **約 0.9〜2.3秒** | - | - | 短い文 0.9秒 / 3主張の文 2.3秒。**この速さで 4B を落とした** |
| 1.7B + LoRA・transformers（GPU） | 8.3秒 | 7.1秒 | - | `--backend hf`、n=30 |
| 1.7B + LoRA・transformers（CPU, fp32, 16スレッド） | 16.4秒 | 17.2秒 | - | n=5。動くが実用にはつらい |
| （参考）100件まとめて vLLM に投げた場合（4B） | - | 0.25秒/件 | - | 上の精度表の「バッチ推論 ms/件」 |

出力が 400〜900 トークンの JSON になるので、1件あたりの時間はほぼ出力長で決まる。
A4000 の帯域だと 4B bf16 の逐次デコードは 35〜55 tok/s が上限で、**精度 0.267 → 0.392 を
レイテンシ 2秒 → 6秒 で買った**、というのが 1.7B → 4B のトレードオフ。

**serve するならアダプタではなくマージ済みを指定する**（精度は同じで 27% 速い）。
100件まとめて投げれば 0.25秒/件まで落ちるので、バッチで回せる用途なら 4B でも困らない。
ただしアプリの抽出は1発話ごとの逐次呼び出しなので、**採用は 1.7B マージ済み**。

## 推論サーバ

```bash
# 採用（1.7B マージ済み + vLLM、ポート 8123）。CUDA_VISIBLE_DEVICES は必ず付ける。
# 付けないと GPU 0 に載り、他の学習と衝突して "Free memory on device ..." で即死する
source ~/chat-lora/env.sh
export PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1
CUDA_VISIBLE_DEVICES=6 setsid nohup $VLLM_PY $ML/serve.py --backend vllm \
  --model $SCRATCH/out/lora/merged --port 8123 \
  > $ML/logs/serve.log 2>&1 < /dev/null &

# 精度比較用の 4B を並べて立てるなら別ポートで（1件 6秒前後）
CUDA_VISIBLE_DEVICES=7 setsid nohup $VLLM_PY $ML/serve.py --backend vllm \
  --model $SCRATCH/out/lora-4b/merged --port 8124 \
  > $ML/logs/serve4b.log 2>&1 < /dev/null &

# アダプタを当てる形でも動く（27% 遅い。複数アダプタを切り替えたいとき用）
CUDA_VISIBLE_DEVICES=6 $VLLM_PY $ML/serve.py --backend vllm \
  --model Qwen/Qwen3-1.7B --lora $SCRATCH/out/lora/adapter --port 8123

# 軽い方（transformers。GPU が無ければ --device cpu でも動く）
$TRAIN_PY $ML/serve.py --model Qwen/Qwen3-1.7B \
  --lora $SCRATCH/out/lora/adapter --device cuda:0 --port 8123
```

手元から叩くときは SSH トンネルを張る。アプリの `EXTRACT_ENDPOINT` はこの
トンネルの URL（例 `http://localhost:8123`）を指す。

```bash
ssh -N -L 8123:127.0.0.1:8123 h2511188@gpu04.ced.cei.uec.ac.jp
# 4B も並べて見るなら
ssh -N -L 8124:127.0.0.1:8124 h2511188@gpu04.ced.cei.uec.ac.jp
```

`Uvicorn running on http://0.0.0.0:8123` がログに出れば起動完了。

```bash
curl -s localhost:8123/extract -H 'content-type: application/json' -d '{
  "text": "ハチワレが洞窟に住んでるのはね、討伐の資格を取る前に師匠と暮らしてた名残なんだよ。",
  "workTitle": "ちいかわ",
  "userMessage": "ハチワレってなんで洞窟に住んでるの？"
}' | python3 -m json.tool
```

**gpu04 には curl が入っていない**ので、サーバ上で叩くときは wget を使う。

```bash
wget -q -O - --header='content-type: application/json' \
  --post-data='{"text":"うさぎは討伐が苦手ってよく言われるけど、あれは違うの。","workTitle":"ちいかわ"}' \
  http://127.0.0.1:8123/extract
```

返ってくるもの（4B マージ済みでの実測）:

```json
{"claims":[{"subject":"ハチワレ","relation":"lives_in","object":"洞窟","negated":false,
            "claim":"ハチワレは洞窟に住んでいる。","quote":"ハチワレが洞窟に住んでるのはね"},
           {"subject":"ハチワレ","relation":"origin","object":"討伐の資格を取る前に師匠と暮らしてた名残","negated":false,
            "claim":"ハチワレが洞窟に住んでいるのは師匠と暮らしていた名残である。",
            "quote":"討伐の資格を取る前に師匠と暮らしてた名残なんだよ"}],
 "latencyMs":3209.2}
```

ポート 8000 は共用マシンで他プロセスが使っていることがある。塞がっていたら
`address already in use` でサーバが即死するので、別のポートを指定する。

**同時に複数リクエストを投げても混線しないことは確認済み**（並行6本で
quote が自分の入力に含まれない claim = 0件）。ただし `_gen_lock` で直列化しているので、
同時に叩くと単に待たされる。連続して使うなら1件ずつ順番に投げるのが速い。

アプリ（`lib/server/llm/extract.ts` の `extractClaims`）は `EXTRACT_ENDPOINT` を
この `/extract` に向けて叩き、返ってきた `claims` を `groundClaims(claims, canonFacts, normalize)`
に通して grounding 付きの `Claim[]` にする。**Gemini 版の抽出は残っていない**ので、
サーバが落ちていればその発話の claims は空になる（返答文はそのまま返り、会話は止まらない）。
