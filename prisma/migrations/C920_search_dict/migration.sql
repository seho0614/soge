-- =====================================================================
-- C920_search_dict  ·  검색 사전과 정규화 (P1)
--
-- ── 사장님 결정 (2026-09-23) ────────────────────────────────────────
--   **LLM 을 쓰지 않습니다.** 주관적 표현도 규칙으로 정의합니다.
--
-- ── ★ pg_trgm 은 한글에 안 통합니다 ────────────────────────────────
--   show_trgm('카페') → []   (빈 배열)
--   영문은 0.58 이 나오는데 한글은 0 입니다.
--
--   그래서 오타는 **levenshtein(fuzzystrmatch)** 으로 잡습니다.
--     프렌차이즈 ~ 프랜차이즈   거리 1
--     까페 ~ 카페              거리 1
--     인테리어 ~ 인테리아        거리 1
--
--   이것을 모르고 pg_trgm 으로 만들었으면 **오타 교정이 통째로
--   안 도는데 검정은 통과**했을 것입니다.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- ── ① 동의어 사전 ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_synonyms (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term      text NOT NULL,          -- 사람이 치는 말
  canonical text NOT NULL,          -- 우리가 저장한 말
  kind      text NOT NULL,          -- GWAN · CATEGORY · REGION · STATE · ITEM
  weight    int  NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (term, kind),
  CONSTRAINT syn_kind_check
    CHECK (kind IN ('GWAN','CATEGORY','REGION','STATE','ITEM')),
  /* ★ 자기 자신을 가리키면 무한히 도는 것처럼 보입니다. */
  CONSTRAINT syn_self_check CHECK (term <> canonical)
);

COMMENT ON TABLE search_synonyms IS
  '검색 동의어. 사람이 치는 말을 우리가 저장한 말로 바꿉니다 — '
  '"점포" 로 쳐도 "상가" 가 나오게 합니다.';
COMMENT ON COLUMN search_synonyms.weight IS
  '확신도. 낮으면 다른 후보와 함께 보여 주고, 높으면 바로 바꿉니다.';

CREATE INDEX IF NOT EXISTS idx_syn_term ON search_synonyms(term);

-- ── ② 주관 표현 사전 ──────────────────────────────────────────────
--
-- ★ "가성비" 를 LLM 없이 푸는 방법입니다. 값을 정해 두면
--   결과가 일정하고, 왜 그렇게 나왔는지 설명할 수 있습니다.
CREATE TABLE IF NOT EXISTS search_intents (
  term      text PRIMARY KEY,
  field     text NOT NULL,          -- 어느 조건으로 바꾸나
  operator  text NOT NULL,          -- <= · >= · = · IS NOT NULL
  value     text,
  note      text NOT NULL,          -- ★ 왜 이 값인지

  CONSTRAINT intent_op_check
    CHECK (operator IN ('<=','>=','=','<','>','IS NOT NULL')),
  /* 왜 그 값인지 안 적으면 나중에 못 고칩니다. */
  CONSTRAINT intent_note_check CHECK (length(btrim(note)) >= 5)
);

COMMENT ON TABLE search_intents IS
  '주관적 표현을 조건으로 바꾸는 사전. **LLM 대신 씁니다** — '
  '"가성비" 가 무엇인지 값으로 정해 두면 결과가 일정하고 '
  '왜 그렇게 나왔는지 설명할 수 있습니다.';
COMMENT ON COLUMN search_intents.note IS
  '★ 왜 이 값인지. 비워 둘 수 없습니다 — 안 적으면 나중에 '
  '"이 40% 는 어디서 나온 숫자냐" 에 답할 수 없습니다.';

-- ── ③ 검색어 통계 ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_term_stats (
  term       text PRIMARY KEY,      -- 정규화된 말 (원문 아님)
  hits       bigint NOT NULL DEFAULT 0,
  zero_hits  bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE search_term_stats IS
  '검색어 통계. **정규화된 말만 담습니다** — 원문에는 상호·연락처가 '
  '섞여 들어옵니다(INV-SCH2).';

-- ── ④ 정규화 함수 ─────────────────────────────────────────────────

/* 동의어 · 오타를 거쳐 우리 말로 바꿉니다. */
CREATE OR REPLACE FUNCTION fn_search_normalize(p_term text)
RETURNS TABLE(canonical text, kind text, how text) AS $$
  /* ★ UNION 의 각 갈래에는 LIMIT 을 붙일 수 없습니다.
     묶은 다음 한 번만 정렬해서 하나를 고릅니다.
     정확히 맞는 것(pri 1)을 오타 교정(pri 2)보다 앞에 둡니다. */
  SELECT canonical, kind, how FROM (
    SELECT s.canonical, s.kind, '동의어'::text AS how,
           1 AS pri, s.weight
      FROM search_synonyms s
     WHERE lower(btrim(s.term)) = lower(btrim(p_term))
    UNION ALL
    /* 오타 — 거리 1 이내만. 2 를 허용하면 "상가"가 "점포"로 갑니다. */
    SELECT s.canonical, s.kind, '오타 교정'::text,
           2 AS pri, s.weight
      FROM search_synonyms s
     WHERE length(p_term) BETWEEN 2 AND 12
       AND levenshtein(s.term, p_term) = 1
  ) x
  ORDER BY pri, weight DESC
  LIMIT 1;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION fn_search_normalize IS
  '검색어를 우리 말로 바꿉니다. **거리 1 까지만** 오타로 봅니다 — '
  '2 를 허용하면 "상가"(거리 2)가 "점포"로 바뀝니다.';

-- ── ⑤ 감시 ────────────────────────────────────────────────────────

/* 결과가 자주 0건이면 사전이 모자란 것입니다. */
CREATE OR REPLACE VIEW v_search_zero_hit_terms AS
SELECT term, zero_hits, hits,
       round(zero_hits * 100.0 / greatest(hits,1)) AS zero_pct
  FROM search_term_stats
 WHERE zero_hits >= 10 AND zero_hits * 2 > hits
 ORDER BY zero_hits DESC;

COMMENT ON VIEW v_search_zero_hit_terms IS
  '결과가 자주 0건인 검색어. **0이어야 합니다** — 사람은 이 말로 '
  '찾는데 우리는 다른 말로 저장하고 있다는 뜻입니다. 동의어를 '
  '더하십시오.';

/* 사전이 비어 있으면 정규화가 아무 일도 안 합니다. */
CREATE OR REPLACE VIEW v_search_dict_empty AS
SELECT '동의어 사전이 비어 있습니다'::text AS note
 WHERE (SELECT count(*) FROM search_synonyms) = 0
UNION ALL
SELECT '주관 표현 사전이 비어 있습니다'
 WHERE (SELECT count(*) FROM search_intents) = 0;

COMMENT ON VIEW v_search_dict_empty IS
  '사전이 빈 상태. **0이어야 합니다** — 비어 있으면 정규화가 '
  '아무 일도 하지 않고, 검색은 예전 그대로입니다.';
