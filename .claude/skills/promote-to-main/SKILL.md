---
name: promote-to-main
description: dev を main に取り込んでよいか判定し、OKなら実際に main へ反映してプッシュする。「mainに取り込んで」「devをmainにマージして」「リリースして」「/promote-to-main」で使う。引数なしなら判定のみ、`--apply` で実行まで行う。
---

# dev → main 昇格

## 前提

- `main` は提出・デプロイ用（Vercel が見る）。壊れた状態を絶対に置かない
- `dev` は統合ブランチ。PR はすべて `dev` に向く（AGENTS.md「ブランチ運用」参照）
- 昇格は **fast-forward のみ**。`main` に `dev` にないコミットがある場合は止めて報告する
- 判定は機械的なチェックを優先し、最後に企画の制約（AGENTS.md）に照らす

## 手順

### 1. 状態を揃える

```bash
git fetch origin main dev
git status --porcelain          # 未コミットがあれば止める（stash はしない。ユーザーに聞く）
git log --oneline origin/main..origin/dev   # 取り込まれる差分
git log --oneline origin/dev..origin/main   # ← ここに何かあれば fast-forward 不可。止める
```

差分が空なら「取り込むものがない」と報告して終了。

### 2. 機械チェック（origin/dev を検査する）

`origin/dev` をワークツリーに出して、以下をすべて通す。1つでも落ちたら NG。

```bash
git worktree add -f /tmp/promote-check origin/dev
cd /tmp/promote-check && npm ci --silent && npm run build && npx tsc --noEmit -p . && npm run lint
```

終わったら `git worktree remove --force /tmp/promote-check`。

### 3. 制約チェック（差分を読む）

`git diff origin/main..origin/dev` を読み、AGENTS.md の「やらないこと」に照らす。

- `data/` 以外に作品名・キャラ名の条件分岐が入っていないか
- `NEXT_PUBLIC_` に API キー、またはクライアントから `lib/server/` の値 import がないか
- `getAllCanonFacts` / `getAllEpisodes` が debug 画面・進捗解決以外から呼ばれていないか
- `.env.local` / `.data/` / 秘密情報がコミットされていないか（`git diff --name-only` で確認）
- `lib/server/llm/client.ts` の API キー無効化が、意図せず解除されていないか。解除されていたら Vercel 側の環境変数登録が済んでいるかユーザーに確認する
- `data/*/work.json` が変わっている場合、JSON としてパースでき、id 重複と `episodeFrom > episodeCount` がないか

```bash
python3 - <<'PY'
import json,glob
for f in glob.glob("data/*/work.json"):
    d=json.load(open(f)); n=d["work"].get("episodeCount",10**9)
    ids=[x["id"] for k in("arcs","episodes","canonFacts") for x in d.get(k,[])]
    assert len(ids)==len(set(ids)), f"{f}: duplicate id"
    assert all(x["episodeFrom"]<=n for x in d["canonFacts"]), f"{f}: episodeFrom > episodeCount"
    print(f,"ok")
PY
```

### 4. 判定を報告する

以下の形で短く報告する。

- 判定: **OK / NG**
- 取り込まれるコミット一覧（1行ずつ）
- 落ちたチェックとその出力（NG のとき）
- 制約チェックで気になった点（あれば）

引数に `--apply` がない場合はここで終了。ユーザーが「取り込んで」と言ったら 5 へ。

### 5. 反映する（`--apply` または明示の指示があるときのみ）

```bash
git checkout main
git merge --ff-only origin/dev
git push origin main
git checkout dev
```

`--ff-only` が失敗したら force しない。理由を報告して止める。

反映後、`main` の先頭コミットのハッシュと、Vercel のデプロイが走ることを一言添える。
