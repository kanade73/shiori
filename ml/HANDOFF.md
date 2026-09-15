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

### 2回目の作業（student を 4B に上げた）

前回の積み残し「student が teacher zero-shot に勝てていない」に対して、
**教師データはそのまま（3062件）で student を Qwen3-1.7B → Qwen/Qwen3-4B に上げた**。
狙いどおり teacher zero-shot を超えた。

| | 素の 1.7B | 1.7B+LoRA | teacher 14B zero-shot | **4B+LoRA** |
|---|---|---|---|---|
| JSON パース率 | 0.89 | 0.99 | 1.00 | **1.00** |
| quote が本文の literal な部分文字列 | - | 0.98 | 0.92 | **0.99** |
| 三つ組 厳密F1 | 0.053 | 0.267 | 0.325 | **0.392** |
| 1件あたりレイテンシ（vLLM 中央値） | - | 約1〜2秒 | - | 6.1秒 |

- **1.7B の頭打ちは容量側だった**。データも指示も変えずに 0.267 → 0.392。
  前回「1.7B の容量と教師データ量の問題」と両論併記で書いた点の答えが出た
- **レイテンシは 2秒 → 6秒に悪化**。A4000 で 4B bf16 の逐次デコードは 35〜55 tok/s が
  上限で、出力が 400〜900 トークンある以上ここは動かせない。
  100件まとめて投げれば 0.25秒/件なので、バッチで回せるなら問題にならない
- **ハイパーパラメータは lr 2e-4 / r=64 / 3 エポックが最良**（3 設定を別 GPU で同時に実行）。
  4 エポック以上と lr 3e-4 は未検証
- 詳しい表と誤りの内訳は `ml/README.md` の「結果」節

## 成果物の場所

### リモート（gpu04.ced.cei.uec.ac.jp / ユーザー h2511188）

| もの | パス |
|---|---|
| スクリプト一式・ログ | `~/chat-lora/`（= `/home2/y2025/h2511188/chat-lora`） |
| venv・HFキャッシュ・重み・データ | `/var/tmp/h2511188/chat-lora/`（**ホームは quota が厳しいので置けない**） |
| **現行 4B アダプタ** | `/var/tmp/h2511188/chat-lora/out/lora-4b/adapter`（= run b のコピー） |
| **現行 4B マージ済み**（serve しているもの） | `/var/tmp/h2511188/chat-lora/out/lora-4b/merged`（7.6GB） |
| 4B のハイパラ比較 3 本 | `/var/tmp/h2511188/chat-lora/out/lora-4b-{a,b,c}/adapter` |
| 旧 1.7B アダプタ / マージ済み | `/var/tmp/h2511188/chat-lora/out/lora/{adapter,merged}` |
| 教師データ（4B でもこれを使った） | `/var/tmp/h2511188/chat-lora/data/dataset/{train,holdout}.jsonl` |
| 評価結果 | `/var/tmp/h2511188/chat-lora/out/eval-*.json`（`.preds.jsonl` に生出力）。4B は `eval-4b-*.json` |
| 学習ログ | `~/chat-lora/logs/train4b-{a,b,c}.log` / サーバは `logs/serve4b.log` |

`~/chat-lora/env.sh` を `source` すると `$SCRATCH` `$VLLM_PY` `$TRAIN_PY` `$ML` が入る。

### 起動しっぱなしにしているもの

**GPU 6 で 4B の推論サーバが動いている**（アプリから繋いで試すため、意図的に落としていない）。

```bash
# 起動コマンド（落ちていたら同じもので立て直す）
source ~/chat-lora/env.sh
export PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1
CUDA_VISIBLE_DEVICES=6 setsid nohup $VLLM_PY $ML/serve.py --backend vllm \
  --model $SCRATCH/out/lora-4b/merged --port 8123 > $ML/logs/serve4b.log 2>&1 < /dev/null &

# 手元から
ssh -N -L 8123:127.0.0.1:8123 h2511188@gpu04.ced.cei.uec.ac.jp
```

GPU 0〜5・7〜9 は解放済み（学習・評価のプロセスは全部落とした）。

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

所要時間の目安（A4000）: 合成 3200件 = 8 GPU で約 20分 / 学習 2 epoch = 1 GPU で 55分（1.7B）/
**4B は 3 epoch で 2時間20分・2 epoch で 1時間32分**（1 GPU、29秒/step）/ 評価 1 設定 = 1〜2分。

2回目は tmux ではなく `setsid nohup ... &` で投げた（どちらでもよい。
`setsid` を付けておくと ssh セッションが落ちても確実に残る）。

**DDP は相変わらず動かないので、分散は狙っていない。** 代わりに
**ハイパーパラメータ違いを別 GPU で 3 本同時に走らせる**方が素直で、実際これで
lr / r / epoch の当たりを 2時間20分で1回引けた（逐次なら 6時間かかる）。
出力ディレクトリを分けるだけで干渉しない。

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
8. **その OOM は `probe_mem.py` で先に潰せる**（2回目に追加）。**データの最長のものから順に**
   forward/backward してピークを出すので、1分で可否が分かる。数十ステップのスモークでは
   最長系列を引かないので意味がない。4B の実測は batch 1 でピーク 11.6 GiB（reserved 12.9）、
   **batch 2 は backward で 1.68 GiB 確保できず OOM**。これを見てから 3 エポックを投げた
9. **`serve.py` に `from __future__ import annotations` を入れると FastAPI が 422 を返す**。
   注釈が文字列になり、関数内定義の pydantic モデルを解決できずクエリ扱いになる
10. **`serve.py` を同時に叩くと、入力と無関係な三つ組が返る**（2回目に発覚・修正）。
   FastAPI は `def`（非 async）ハンドラをスレッドプールで動かすので、リクエストが重なると
   `llm.generate()` が別スレッドから並行に呼ばれる。vLLM は走行中のエンジンに別スレッドの
   プロンプトを差し込み、`outs[0]` が**他のリクエストの出力**になる。
   ログに `Processed prompts: 2it` が出ていたら混線している。`threading.Lock` で直列化して修正。
   **単発で叩いている限り再現しない**ので、前回は気づかないままだった
11. **`CUDA_VISIBLE_DEVICES` を付けずに serve すると GPU 0 に載る**。学習中の GPU と
   衝突して `Free memory on device (0.73/15.61 GiB) ...` で即死する。必ず付ける
12. **vLLM を kill しても GPU が空かないことがある**。`VLLM::EngineCore` の子プロセスが残る。
   `nvidia-smi --query-compute-apps=pid,used_memory --format=csv` で見て kill -9 する
13. **gpu04 に `curl` が無い**。動作確認は `wget --post-data` か Python の urllib で
14. **port 8000 は他プロセスが使っていることがある**。塞がっていると uvicorn が即死するので別ポートへ

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
- **エポック数は 1.7B では 2**。3 エポックで始めたが OOM で落ち、2 で回し直した。
  4B では 3 エポックまで回し、2 エポック（0.309）→ 3 エポック（0.367、同じ lr/r の a）で
  伸びているので、**4 エポック以上はまだ試す価値がある**（未検証）
- **4B の探索は 3 点だけ**（lr 1e-4/2e-4/5e-5、r 32/64、epoch 2/3）。
  最良が探索範囲の端（lr が最大・r が最大）なので、**まだ上に伸びしろがある可能性が高い**。
  時間の都合でここで止めた。次に振るなら lr 3e-4 / r 64 / 4 エポック
- **`eval.py` と `serve.py` の `max_lora_rank` は 64 決め打ち**。r を 128 に上げるなら
  両方直す必要がある（今回は 64 に収めた）
- **serve するのはマージ済みにした**。アダプタ適用より 27% 速く、精度は誤差の範囲
  （0.386 vs 0.392、bf16 のマージ時の丸め）。複数アダプタを切り替える予定はないので
  マージ済みで困らない
- **評価指標を3つ出している**。厳密一致だけだと object の言い回しのずれで不当に低く出るため、
  緩い一致（`extract.ts` の `objectMatches` と同じ包含判定）と主語+関係だけの一致も並べた
- **推論サーバは認証なし・単一プロセス**。ハッカソン用途の割り切り。
  生成を `_gen_lock` で直列化したので、同時アクセスは正しいが単に待たされる

## うまくいっていない / 未確認

- ~~**student が teacher zero-shot に勝てていない**~~ → **4B で解消**（0.392 vs 0.325）。
  残っていた候補のうち「② student を Qwen3-4B にする」を実行した結果。
  **① 教師データを 1万件規模に増やす** はまだ手つかずで、次に効きそうなのはこれ
- **4B の探索が浅い**。最良が探索範囲の端（lr 2e-4・r 64・3 エポック）なので、
  lr 3e-4 / 4 エポック / r 128 はまだ試していない
- **否定の取り違えが直ったかは未検証**。学習データ中の否定が 8.9% という偏りは 4B でも
  同じなので、期待はできない。`synth.py` の `want_negation`（今 25%）を上げるのは有効なはず
- **長い文での取りこぼしも未検証**。緩いF1 0.455 / 主語+関係F1 0.534 と、
  厳密F1 0.392 との差が 1.7B の頃より縮んでいるので改善はしているはずだが、
  誤りの中身は数えていない
- **レイテンシが 1件 6秒**。1.7B の 1〜2秒から明確に悪化した。逐次で叩く用途では重い。
  下げたいなら ① AWQ / GPTQ 量子化 ② 出力を短くする（`claim` の一文要約をやめる）
  ③ そもそもバッチで回す（0.25秒/件）
- アプリ（`lib/server/llm/extract.ts`）への接続は未実施
- **CPU 推論は動くが遅い**（1.7B で中央値 16.4秒。4B では測っていないがさらに遅いはず）。
  本番 Fly.io の1コンテナで回すのは非現実的で、使うなら GPU サーバを別に立てて HTTP で叩く形。
  transformers バックエンドは GPU でも遅いので、**必ず `--backend vllm` で起動する**
- **他作品での検証は相変わらず未実施**（`chiikawa` のみで合成・評価）
- `other` relation がデータにほとんど出ていない（teacher が具体的な relation を選ぶため）
- 複数作品・複数キャラの混線（別名の解決ミス）は評価していない
- **`torchrun` の DDP は動かなかった**（`DDP expects same model across all ranks ... rank 0 has
  inconsistent 0 params`）。1枚で足りたので追っていない。将来モデルを大きくするときは再調査が要る
