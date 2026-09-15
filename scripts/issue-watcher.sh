#!/usr/bin/env bash
# GitHub Issue ウォッチャー。
# 受付用 Issue（既定 #12）に付いたコメントを 1 コメント = 1 タスクとして拾い、
# Claude Code (Opus) で実装して dev 向け PR を作る。結果は同じ Issue にコメントで返す。
#
#   常駐:   nohup scripts/issue-watcher.sh > .data/issue-watcher/watcher.log 2>&1 &
#   1回:    scripts/issue-watcher.sh --once
#   停止:   pkill -f issue-watcher.sh
#
# 環境変数: ISSUE_WATCHER_INBOX(既定 12) / ISSUE_WATCHER_MODEL(opus) / ISSUE_WATCHER_INTERVAL(60)
# 状態:     .data/issue-watcher/processed.txt（処理済みコメント ID）
# ログ:     .data/issue-watcher/comment-<コメントID>.log
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKTREE_ROOT="${ISSUE_WATCHER_WORKTREES:-$REPO_DIR/../chat-worktrees}"
LOG_DIR="$REPO_DIR/.data/issue-watcher"
STATE="$LOG_DIR/processed.txt"
INTERVAL="${ISSUE_WATCHER_INTERVAL:-60}"
MODEL="${ISSUE_WATCHER_MODEL:-opus}"
INBOX="${ISSUE_WATCHER_INBOX:-12}"

export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
mkdir -p "$LOG_DIR" "$WORKTREE_ROOT"
touch "$STATE"

REMOTE="$(git -C "$REPO_DIR" remote get-url origin | sed -E 's#.*github.com[:/]##; s#\.git$##')"
ME="$(gh api user -q .login)"

log() { echo "[$(date '+%F %T')] $*"; }
reply() { gh -R "$REMOTE" issue comment "$INBOX" --body "$1" >/dev/null 2>&1; }

process_comment() {
  local cid="$1" body="$2" url="$3"
  local branch="feat/inbox-${cid}"
  local wt="$WORKTREE_ROOT/inbox-${cid}"
  local logf="$LOG_DIR/comment-${cid}.log"
  local summary; summary="$(printf '%s' "$body" | head -1 | cut -c1-60)"

  echo "$cid" >> "$STATE"
  log "comment $cid: start ($summary)" | tee -a "$logf"
  reply "🤖 着手します: [${summary}](${url})"

  git -C "$REPO_DIR" fetch origin dev >>"$logf" 2>&1
  git -C "$REPO_DIR" worktree remove --force "$wt" >/dev/null 2>&1 || true
  git -C "$REPO_DIR" branch -D "$branch" >/dev/null 2>&1 || true
  if ! git -C "$REPO_DIR" worktree add -b "$branch" "$wt" origin/dev >>"$logf" 2>&1; then
    reply "🤖 失敗: worktree を作れませんでした（[元コメント](${url})）"; return
  fi
  cp "$REPO_DIR/.env.local" "$wt/.env.local" 2>/dev/null || true
  (cd "$wt" && npm ci --no-audit --no-fund >>"$logf" 2>&1) || log "comment $cid: npm ci failed (continuing)" | tee -a "$logf"

  local prompt
  prompt="$(cat <<PROMPT
あなたはこのリポジトリの作業依頼を1件実装する担当です。作業ディレクトリはブランチ ${branch}（origin/dev から分岐済み）の worktree です。
依頼は GitHub Issue #${INBOX} のコメント（${url}）に書かれた次の文章です。

## 依頼

${body}

## 手順
1. AGENTS.md と docs/HANDOFF.md を読み、プロジェクトの制約（データとコードの分離、作品名で分岐しない、未視聴範囲を漏らさない、抽象化を先回りしない）を守る
2. 依頼の意図を汲んで実装する。書きぶりが雑でも、AGENTS.md の「体験の芯」に照らして最も妥当な解釈で進める。判断に迷った点は PR 本文に書く
3. 変更箇所の隣に *.test.ts でテストを足し、\`npm test\`・\`npx tsc --noEmit\`・\`npm run lint\`・\`npm run build\` を通す
4. docs/HANDOFF.md に今回の作業を追記する（初見の AI が把握できるように）
5. 日本語の Conventional Commits でコミットし、\`git push -u origin ${branch}\` する
6. \`gh pr create --base dev --title "<type>: <要約>" --body "..."\` で PR を作る。本文に依頼元コメントの URL（${url}）、変更概要、判断に迷った点、確認方法を書く
7. 最後に PR の URL を1行で出力する

質問はできないので、必要な判断は自分で行い、その理由を PR 本文に残すこと。依頼の範囲を超えた変更はしない。
PROMPT
)"

  (cd "$wt" && claude -p --model "$MODEL" --permission-mode bypassPermissions "$prompt" >>"$logf" 2>&1)
  local rc=$?

  local pr_url
  pr_url="$(gh -R "$REMOTE" pr list --head "$branch" --json url -q '.[0].url' 2>/dev/null)"
  if [[ $rc -eq 0 && -n "$pr_url" ]]; then
    reply "🤖 完了: [${summary}](${url}) → PR ${pr_url}"
    log "comment $cid: done -> $pr_url" | tee -a "$logf"
    git -C "$REPO_DIR" worktree remove --force "$wt" >/dev/null 2>&1 || true
  else
    reply "🤖 失敗: [${summary}](${url})（claude 終了コード=${rc}、PR=${pr_url:-なし}）。ログ \`.data/issue-watcher/comment-${cid}.log\`、worktree \`${wt}\`。もう一度やらせるには同じ内容を新しいコメントで書いてください。"
    log "comment $cid: FAILED rc=$rc" | tee -a "$logf"
  fi
}

tick() {
  local json
  json="$(gh api --paginate "repos/${REMOTE}/issues/${INBOX}/comments" 2>/dev/null)" || { log "gh api failed"; return; }
  # 自分（人間）のコメントで、ロボット絵文字で始まらず、未処理のものを古い順に
  printf '%s' "$json" | jq -r --arg me "$ME" \
    '.[] | select(.user.login == $me) | select(.body | startswith("🤖") | not) | "\(.id)\t\(.html_url)\t\(.body | @base64)"' |
  while IFS=$'\t' read -r cid url b64; do
    grep -qx "$cid" "$STATE" && continue
    process_comment "$cid" "$(printf '%s' "$b64" | base64 -d)" "$url"
  done
}

log "watcher start: repo=$REMOTE inbox=#$INBOX user=$ME model=$MODEL interval=${INTERVAL}s"
if [[ "${1:-}" == "--once" ]]; then tick; exit 0; fi
while true; do tick; sleep "$INTERVAL"; done
