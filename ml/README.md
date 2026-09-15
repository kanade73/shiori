# ml/ — claims 抽出の軽量モデル（LoRA）

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
| `samples.jsonl` | 生成データのサンプル20件（中身の確認用。学習には使わない） |

モデル重みと生成データはリポジトリに入れない（`ml/.gitignore`）。

## 使ったモデル

| 役割 | モデル | 備考 |
|---|---|---|
| teacher（合成） | `Qwen/Qwen3-14B-AWQ` | A4000 16GB に 1枚で載る。ゲートなし |
| student（学習対象） | `Qwen/Qwen3-1.7B` | LoRA r=32 / alpha=64、bf16 |

Gemma はゲート付き（manual approval）でトークンが無いと落とせないため使っていない。

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
   （batch 8 は即 OOM、batch 4 は 39 ステップ目で OOM）。batch 2 + accum 32 +
   gradient checkpointing だと 10.3GB で安定する
7. **`serve.py` に `from __future__ import annotations` を入れると FastAPI が 422 を返す**。
   注釈が文字列になり、関数内で定義した pydantic モデルを解決できずクエリ扱いになる
8. **Trainer のログがファイルに出ない**。リダイレクト先だと stdout がブロックバッファに
   なるだけ。`PYTHONUNBUFFERED=1` を付ける

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
| teacher zero-shot (Qwen3-14B-AWQ) | 1.00 | 0.325 | 0.420 | 0.527 | 0.18 | 0.92 | 551 |
| **student + LoRA (Qwen3-1.7B)** | 0.99 | 0.267 | 0.319 | 0.407 | 0.13 | 0.98 | 321 |
| teacher few-shot（ラベル生成と同条件＝上限） | 1.00 | 0.946 | 0.941 | 0.944 | 0.77 | 0.92 | 659 |

- **厳密F1**: 正規化した (subject, relation, object, negated) の完全一致
- **緩いF1**: object が包含関係なら一致とみなす（`extract.ts` の `objectMatches` と同じ基準）
- **主語+関係F1**: object の言い回しを問わない。「誰について・どの種類の主張か」だけを見る
- **teacher few-shot は上限であって競争相手ではない**。ラベルを作ったのがこの設定そのもの
  （同じモデル・同じプロンプト・greedy）なので、自分の出力を再現しているだけ。0.946 は
  「この採点方法の天井」を示すための行

### 読み取れること

- **形式は完全に習得した**。素の 1.7B は JSON パース率 0.89 で、しかも `{"claims": ...}` で
  包まず裸の配列を返すことが多かった（実測）。LoRA 後はパース率 0.99、quote が本文の
  literal な部分文字列である割合 0.98 で、**teacher（0.92）より高い**。
  後段の矛盾検査に渡す形としてはこれで十分使える
- **中身は teacher zero-shot に届かなかった**。厳密F1 0.053 → 0.267（5倍）まで上がったが、
  14B の zero-shot（0.325）には及ばない。学習 loss は 0.16 まで下がっているので
  underfit ではなく、1.7B の容量と教師データ量（3062件）の問題
- **誤りの中身は「取りこぼし」と「言い回しのずれ」**。主張が5〜6個詰まった長い文で
  2〜3個しか拾えていない例が目立つ。object の表現ゆれを許しても 0.319 までしか上がらない
  （＝ずれだけが原因ではなく、実際に拾えていない）
- **否定が弱い**。「〜が苦手ってよく言われるけど、あれは違うの」を
  `cannot / negated: false` と取ってしまう。学習データ中の否定が 8.9% しかないので、
  シナリオ側で否定の比率を上げるのが次の一手

### レイテンシ（1件ずつ、warmup 後）

| 構成 | 中央値 | 平均 | 備考 |
|---|---|---|---|
| vLLM バックエンド（GPU 1枚, A4000） | 約 0.9〜2.3秒 | - | `serve.py --backend vllm`。実測値（短い文 0.9秒 / 3主張の文 2.3秒） |
| transformers バックエンド（GPU 1枚, A4000） | 8.3秒 | 7.1秒 | `serve.py --backend hf`、n=30 |
| transformers バックエンド（CPU, fp32, 16スレッド） | 16.4秒 | 17.2秒 | n=5。動くが実用にはつらい |
| （参考）100件まとめて vLLM に投げた場合 | - | 0.32秒/件 | 上の精度表の「バッチ推論 ms/件」 |

出力が 400〜900 トークンの JSON になるので、1件あたりの時間はほぼ出力長で決まる。
**アプリから叩くなら vLLM バックエンド一択**。

## 推論サーバ

```bash
# 速い方（vLLM バックエンド。venv-vllm の python で起動する）
tmux new-session -d -s serve "source ~/chat-lora/env.sh; CUDA_VISIBLE_DEVICES=6 \
  \$VLLM_PY ~/chat-lora/serve.py --backend vllm \
  --model Qwen/Qwen3-1.7B --lora \$SCRATCH/out/lora/adapter --port 8123 \
  > ~/chat-lora/logs/serve.log 2>&1"

# 軽い方（transformers。GPU が無ければ --device cpu でも動く）
$SCRATCH/venv-train/bin/python ~/chat-lora/serve.py \
  --lora $SCRATCH/out/lora/adapter --device cuda:0 --port 8123
$SCRATCH/venv-train/bin/python ~/chat-lora/serve.py \
  --lora $SCRATCH/out/lora/adapter --device cpu --port 8123
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

返ってくるもの（実測）:

```json
{"claims":[{"subject":"うさぎ","relation":"cannot","object":"討伐","negated":false,
            "claim":"うさぎは討伐ができない。","quote":"うさぎは討伐が苦手ってよく言われるけど、あれは違うの。"}],
 "latencyMs":883.9}
```

（この例の `negated` は本来 true であるべきで、上の「否定が弱い」に当たる誤り。）

ポート 8000 は共用マシンで他プロセスが使っていることがある。塞がっていたら
`address already in use` でサーバが即死するので、別のポートを指定する。

アプリから使うときは `lib/server/llm/extract.ts` の `extractClaims` の中の
Gemini 呼び出しを、この `/extract` への fetch に差し替える。返ってきた
`claims` をそのまま `groundClaims(claims, canonFacts, normalize)` に渡せば、
grounding 付きの `Claim[]` になる（**ここは今回のブランチでは変更していない**）。
