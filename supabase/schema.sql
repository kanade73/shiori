-- misdirection-chat の Supabase スキーマ。
-- Supabase の SQL Editor に貼って一度流す（何度流しても壊れないように書いてある）。
--
-- 時刻はすべて text。アプリ（lib/server/store.ts）が new Date().toISOString() で作った文字列を
-- そのまま持つ。並び替えは ISO-8601 の辞書順でそのまま正しく、DB を経由しても値が変わらない。
--
-- 行を触れるのは service_role キーだけ（全テーブル RLS 有効・ポリシー無し）。
-- アプリからの読み書きは必ず Route Handler 側（lib/server/supabase.ts）を通る。

create extension if not exists vector;

-- --- 会話 ---------------------------------------------------------------

create table if not exists sessions (
  id                   text primary key,
  work_id              text not null,
  -- ネタバレ境界。話題が決まるまでは 0
  current_episode      integer not null default 0,
  -- SessionTopic / SessionTopic[] / RevealState（lib/server/types.ts）をそのまま入れる
  topic                jsonb,
  past_topics          jsonb not null default '[]'::jsonb,
  reveal               jsonb,
  -- 旧データのみ: 廃止したシーン検索でユーザーが入力した視聴進捗
  progress_description text,
  created_at           text not null,
  updated_at           text not null
);

create index if not exists sessions_work_id_idx on sessions (work_id);
create index if not exists sessions_updated_at_idx on sessions (updated_at desc);

create table if not exists messages (
  -- 並びは seq で決める。同じミリ秒に2件入っても保存した順に取り出せる
  seq        bigserial not null,
  id         text primary key,
  session_id text not null references sessions(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  -- 'shiori' | 'toshio'。旧データの null は shiori とみなす
  speaker    text,
  -- シオリの表情（'neutral' | 'wink'）。旧データ・としおは null = neutral
  expression text,
  content    text not null,
  created_at text not null
);

create index if not exists messages_session_idx on messages (session_id, seq);

-- シオリの発話が述べた主張。答え合わせ（lib/server/reveal/build.ts）が真偽と本文中の位置に使う
create table if not exists message_claims (
  id                     text primary key,
  session_id             text not null references sessions(id) on delete cascade,
  message_id             text not null references messages(id) on delete cascade,
  -- 発話の中での並び。extract が取り出した順を保つ
  ord                    integer not null,
  subject                text not null,
  relation               text not null,
  object                 text not null,
  negated                boolean not null default false,
  claim                  text not null,
  -- 返答文からの抜き出し。モデルが省くことがあるので null 可
  quote                  text,
  grounding              text not null check (grounding in ('canon', 'fabricated')),
  source_canon_fact_ids  text[] not null default '{}'
);

create index if not exists message_claims_session_idx on message_claims (session_id, message_id, ord);

-- --- 嘘 -----------------------------------------------------------------

-- grounding=fabricated の claim を正規化して残したもの。「矛盾しない嘘」の実体
create table if not exists fabricated_facts (
  seq                    bigserial not null,
  id                     text primary key,
  session_id             text not null references sessions(id) on delete cascade,
  subject                text not null,
  relation               text not null,
  object                 text not null,
  negated                boolean not null default false,
  claim                  text not null,
  source_canon_fact_ids  text[] not null default '{}',
  introduced_message_id  text not null,
  confidence             double precision not null default 0,
  status                 text not null default 'active' check (status in ('active', 'contradicted', 'retired')),
  created_at             text not null
);

create index if not exists fabricated_facts_session_idx on fabricated_facts (session_id, seq);

create table if not exists fabricated_relations (
  id           text primary key,
  session_id   text not null references sessions(id) on delete cascade,
  from_fact_id text not null,
  to_fact_id   text not null,
  relation     text not null
);

create index if not exists fabricated_relations_session_idx on fabricated_relations (session_id);

-- --- 外部資料の段落のベクトル ---------------------------------------------

-- 段落の埋め込み。作るのは scripts/embed-chunks.ts（オフライン）で、実行時は検索しかしない。
-- chunk_key は「見出し + 本文」の sha1（lib/server/embeddings.ts の keyOf と同じ）
create table if not exists source_chunks (
  chunk_key  text primary key,
  work_id    text not null,
  label      text not null,
  text       text not null,
  -- GEMINI_EMBEDDING_MODEL。次元が違うモデルに変えたら、この表を作り直すこと
  model      text not null,
  embedding  vector(768) not null,
  updated_at text not null
);

create index if not exists source_chunks_work_idx on source_chunks (work_id, model);

-- 近傍探索。段落は作品あたり数百件なので総当たり（ANN インデックスは張らない）。
-- 返すのはコサイン類似度（1 - コサイン距離）で、呼び出し側の閾値 0.66 はこの尺度のまま使える
create or replace function match_source_chunks(
  p_work_id text,
  p_model   text,
  p_query   vector(768),
  p_k       integer
)
returns table (chunk_key text, similarity double precision)
language sql
stable
as $$
  select c.chunk_key, 1 - (c.embedding <=> p_query) as similarity
  from source_chunks c
  where c.work_id = p_work_id and c.model = p_model
  order by c.embedding <=> p_query
  limit p_k;
$$;

-- --- 作り手の作風 ---------------------------------------------------------

-- 記事から1回だけ抜いた CreatorProfile。作品ごとに再取得しないためのキャッシュ
create table if not exists creator_profiles (
  work_id    text not null,
  name       text not null,
  profile    jsonb not null,
  updated_at text not null,
  primary key (work_id, name)
);

-- --- RLS ----------------------------------------------------------------

-- ポリシーを1つも作らないので、anon / authenticated キーでは何も見えない。
-- service_role は RLS を迂回するので、サーバー側だけが読み書きできる。
alter table sessions             enable row level security;
alter table messages             enable row level security;
alter table message_claims       enable row level security;
alter table fabricated_facts     enable row level security;
alter table fabricated_relations enable row level security;
alter table source_chunks        enable row level security;
alter table creator_profiles     enable row level security;
