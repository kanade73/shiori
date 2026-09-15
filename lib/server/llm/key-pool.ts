import { createHash } from "node:crypto";

/**
 * Gemini の API キーを2本（自分・先輩）持ち、無料枠の上限（429）に達したらもう1本に切り替える（issue #11）。
 *
 * - モデルごとに「いま使っているキー」を持ち、そのキーが上限に達するまで使い続ける。上限に達したら
 *   同じリクエストをもう1本ですぐ送り直し、以後はそちらを使う。そちらも上限に達したら元のキーへ戻る
 * - 無料枠はプロジェクトごと・モデルごとに数えられるので、休ませるのも (キー, モデル) の組。
 *   シオリのモデルで1本目が尽きても、判定役・埋め込み（別モデル）は1本目のまま
 * - 上限に達したキーは、1日の枠なら太平洋時間の0時（枠のリセット）まで、1分の枠ならエラーに書かれた
 *   待ち時間だけ休ませる。どのキーも休み中なら送らずに投げる（呼び出し側の fallback に任せる）
 * - 無効なキー（入力ミスなど）はプロセスが動いている間ずっと外す
 * - 混雑（500/503）など、キーを変えても変わらない失敗はそのまま投げる
 *
 * 回数を数えて先回りはしない（手元の数え方が Google 側とずれると取りこぼす）。1回の切り替えで
 * むだになるのは、断られた1リクエストだけ。
 */

export interface ApiKeyEntry<C> {
  /** ログに出す名前（環境変数名）。キーの文字列そのものはログに出さない */
  label: string;
  /** キーの指紋（`fingerprint`）。キーを差し替えたら別のキーとして扱う */
  id: string;
  client: C;
}

export interface KeyRotationState {
  /** モデル → いま使っているキーの id */
  active: Map<string, string>;
  /** `${キーの id}\n${モデル}` → この時刻（ms）まで休ませる */
  restUntil: Map<string, number>;
  /** 無効と分かったキーの id */
  dead: Set<string>;
}

export type KeyFailure = { kind: "day" | "minute"; until: number } | { kind: "invalid" };

/** どのキーも休み中で、送らずに諦めたとき */
export class AllKeysRestingError extends Error {
  readonly status = 429;
  constructor(model: string) {
    super(`Gemini の無料枠: どの API キーも ${model} の上限で休み中`);
    this.name = "AllKeysRestingError";
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
// 429 の本文から待ち時間が読めなかったとき
const DEFAULT_REST_MS = 60_000;

export function newKeyRotationState(): KeyRotationState {
  return { active: new Map(), restUntil: new Map(), dead: new Set() };
}

export function fingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 12);
}

const PACIFIC = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hourCycle: "h23",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** 次の太平洋時間の0時（1日の枠のリセット）までの ms。夏時間の切り替わる日は1時間ずれるが、早ければもう一度 429 を受けて休み直すだけ */
export function msUntilPacificMidnight(now: number): number {
  const parts = Object.fromEntries(PACIFIC.formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  const elapsed = ((Number(parts.hour) * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000 + (now % 1000);
  return DAY_MS - elapsed;
}

/**
 * SDK の ApiError（`status` と、API のエラー JSON を文字列にした `message`）から、キーを替えるべき失敗かを決める。
 * 429 の本文の例: `{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[
 *   {"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]},
 *   {"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"38s"}]}}`
 */
export function classifyKeyFailure(error: unknown, now: number): KeyFailure | null {
  const status = (error as { status?: unknown } | null)?.status;
  const raw = error instanceof Error ? error.message : String(error);

  if (status === 429) {
    const details = errorDetails(raw);
    const quotaIds = details.flatMap((d) =>
      Array.isArray(d.violations) ? d.violations.map((v) => String((v as { quotaId?: unknown } | null)?.quotaId ?? "")) : [],
    );
    // 1日の枠は RetryInfo にも数十秒の待ち時間が付いてくるので、quotaId で見分ける
    if (quotaIds.some((id) => /PerDay/i.test(id))) return { kind: "day", until: now + msUntilPacificMidnight(now) };
    const delay = details.map((d) => parseDelay(d.retryDelay)).find((ms) => ms !== null);
    return { kind: "minute", until: now + (delay ?? DEFAULT_REST_MS) };
  }
  if (status === 401 || status === 403 || (status === 400 && /API_KEY_INVALID|API key not valid/.test(raw))) {
    return { kind: "invalid" };
  }
  return null;
}

function errorDetails(raw: string): Record<string, unknown>[] {
  try {
    const details = (JSON.parse(raw) as { error?: { details?: unknown } } | null)?.error?.details;
    return Array.isArray(details) ? details.filter((d) => d && typeof d === "object") : [];
  } catch {
    return [];
  }
}

function parseDelay(value: unknown): number | null {
  const match = typeof value === "string" ? /^(\d+(?:\.\d+)?)s$/.exec(value) : null;
  return match ? Math.ceil(Number(match[1]) * 1000) : null;
}

const FAILURE_LABEL = { day: "1日の上限（太平洋時間の0時まで休ませる）", minute: "1分の上限", invalid: "無効なキー（以後使わない）" };

/**
 * `withApiKey(model, (client) => client.models.generateContent(...))` の形で使う。
 * キーが1本だけなら今までどおりそのまま呼ぶ（切り替えも休ませもしない）。
 */
export function createKeyRotation<C>(
  keys: ApiKeyEntry<C>[],
  options: { state?: KeyRotationState; now?: () => number; log?: (message: string) => void } = {},
) {
  if (keys.length === 0) throw new Error("createKeyRotation: キーが1本も無い");
  const state = options.state ?? newKeyRotationState();
  const now = options.now ?? Date.now;
  const log = options.log ?? ((message: string) => console.warn(message));
  const slot = (key: ApiKeyEntry<C>, model: string) => `${key.id}\n${model}`;
  const resting = (key: ApiKeyEntry<C>, model: string) =>
    state.dead.has(key.id) || (state.restUntil.get(slot(key, model)) ?? 0) > now();

  return async function withApiKey<T>(model: string, call: (client: C) => Promise<T>): Promise<T> {
    if (keys.length === 1) return call(keys[0].client);

    const activeId = state.active.get(model);
    const start = Math.max(0, keys.findIndex((k) => k.id === activeId));
    let lastError: unknown = new AllKeysRestingError(model);
    for (let step = 0; step < keys.length; step++) {
      const key = keys[(start + step) % keys.length];
      if (resting(key, model)) continue;
      try {
        const result = await call(key.client);
        if (key.id !== keys[start].id) log(`[gemini] ${model} は ${key.label} に切り替えた`);
        state.active.set(model, key.id);
        return result;
      } catch (error) {
        const failure = classifyKeyFailure(error, now());
        if (!failure) throw error;
        if (failure.kind === "invalid") state.dead.add(key.id);
        else state.restUntil.set(slot(key, model), failure.until);
        log(`[gemini] ${key.label} が ${model} で${FAILURE_LABEL[failure.kind]}`);
        lastError = error;
      }
    }
    throw lastError;
  };
}
