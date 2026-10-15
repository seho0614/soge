-- =====================================================================
-- C860_search  ·  AI 프롬프트 검색바 (SCH)
--
-- ── 사장님 결정 (2026-09-22) ────────────────────────────────────────
--   ① 결과를 **후보 3개 팝업**으로 보여 줍니다 (방식 A)
--   ② LLM 파서를 붙입니다 — 다만 **파서 전용**입니다
--
-- ── ★ LLM 은 판정하지 않습니다 ──────────────────────────────────────
--   LLM 이 하는 일    자유문장 → 구조화 파라미터
--   LLM 이 안 하는 일  어느 관인지 판정 · 제한업종 차단
--
--   판정을 맡기면 **모델이 바뀔 때마다 결과가 달라집니다.**
--   INV-6(제한업종)도 LLM 이 놓치면 그대로 뚫립니다.
--   그래서 LLM 출력을 받아 **규칙 엔진이 다시 봅니다.**
--
-- ── 법무 회신 (2026-09-22) ──────────────────────────────────────────
--   "개인정보를 전송하지 않으면 문제없음."
--
--   이것은 "지금 이대로 해도 된다" 가 아니라 **"비식별을 계속
--   지키는 한 문제없다"** 는 조건부 확인입니다. 그래서 임시 조치가
--   아니라 **불변식으로 박습니다** — 나중에 누가 개인화를 붙이려
--   하면 검정이 막습니다.
-- =====================================================================

-- ── ① 파서 로그 ───────────────────────────────────────────────────
--
-- ★ `raw_query` 컬럼이 **없습니다**(INV-SCH2). 있으면 누군가
--   "디버깅용으로" 넣습니다. 컬럼 자체를 안 만듭니다.
CREATE TABLE IF NOT EXISTS llm_parse_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parsed_params  jsonb NOT NULL,
  model          text,
  latency_ms     int,
  fallback       boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE llm_parse_log IS
  'LLM 파서 호출 기록. **원문 검색어를 저장하지 않습니다**(INV-SCH2) — '
  '검색어에 상호·연락처가 섞여 들어오기 때문입니다. 구조화된 '
  '파라미터만 남깁니다.';
COMMENT ON COLUMN llm_parse_log.parsed_params IS
  '파싱 결과(관·카테고리·가격대·지역). **여기에 원문을 넣지 마십시오** — '
  'INV-SCH2 검정이 잡습니다.';

CREATE INDEX IF NOT EXISTS idx_llm_parse_created ON llm_parse_log(created_at DESC);

/* ★ 원문이 파라미터에 섞여 들어가는 것을 막습니다.
 *
 *   컬럼만 없애면 `parsed_params` 에 넣습니다 — 실제로 그렇게 됩니다.
 *   그래서 키 이름으로 막습니다. */
CREATE OR REPLACE FUNCTION fn_llm_log_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.parsed_params ?| ARRAY['raw','raw_query','query','text','q','input','prompt'] THEN
    RAISE EXCEPTION
      'SEARCH: 원문 검색어를 저장할 수 없습니다 (INV-SCH2) — 구조화된 파라미터만 남기십시오';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_llm_log_guard ON llm_parse_log;
CREATE TRIGGER trg_llm_log_guard BEFORE INSERT OR UPDATE ON llm_parse_log
  FOR EACH ROW EXECUTE FUNCTION fn_llm_log_guard();

-- ── ② 설정 ────────────────────────────────────────────────────────
INSERT INTO site_settings (key, value, scope, description, value_example, value_pattern)
VALUES
 ('search.llm_parser.enabled', 'off', 'GLOBAL',
  'LLM 파서를 쓸지. off 면 규칙 엔진만 씁니다 — 검색은 그대로 동작합니다. '
  '문제가 생기면 이 값을 off 로 바꾸면 즉시 폴백합니다.',
  'on', '^(on|off)$'),
 ('search.llm_parser.model', '', 'GLOBAL',
  '파서 모델 이름. 비우면 파서를 부르지 않습니다.',
  'claude-haiku-4-5', NULL),
 ('search.popup.candidates', '3', 'GLOBAL',
  '검색 결과 팝업에 보여 줄 후보 수. 너무 많으면 고르기 어렵습니다.',
  '3', '^[1-9]$')
ON CONFLICT (key) DO NOTHING;

-- ── ③ 감시 (INV-SCH1 · SCH2) ──────────────────────────────────────

/* INV-SCH2 — 원문이 저장되지 않았는가
 *
 * ★ 트리거가 막지만, 트리거를 누가 지울 수도 있습니다.
 *   결과를 직접 세서 다시 봅니다. */
CREATE OR REPLACE VIEW v_search_raw_stored AS
SELECT id, created_at,
       (SELECT string_agg(k, ', ') FROM jsonb_object_keys(parsed_params) k
         WHERE k = ANY (ARRAY['raw','raw_query','query','text','q','input','prompt'])) AS bad_keys
  FROM llm_parse_log
 WHERE parsed_params ?| ARRAY['raw','raw_query','query','text','q','input','prompt'];

COMMENT ON VIEW v_search_raw_stored IS
  'INV-SCH2 위반 — 원문 검색어가 저장된 기록. **0이어야 합니다** — '
  '검색어에는 상호·연락처가 섞여 들어옵니다.';

/* INV-SCH1 — 파서 로그에 사람을 식별할 것이 없는가 */
CREATE OR REPLACE VIEW v_search_pii_columns AS
SELECT table_name, column_name
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'llm_parse_log'
   AND column_name ~ 'account|session|user|ip|segment|persona|member';

COMMENT ON VIEW v_search_pii_columns IS
  'INV-SCH1 위반 — 파서 로그에 사람을 가리키는 컬럼. **0이어야 합니다** — '
  '법무 회신은 "개인정보를 전송하지 않으면" 이 전제입니다. 컬럼이 '
  '생기면 그 전제가 깨집니다.';

/* 파서가 자주 실패하는가 — 폴백만 돌면 LLM 값이 없습니다 */
CREATE OR REPLACE VIEW v_search_parser_health AS
SELECT count(*)::int AS calls,
       count(*) FILTER (WHERE fallback)::int AS fallbacks,
       CASE WHEN count(*) = 0 THEN NULL
            ELSE round(count(*) FILTER (WHERE fallback) * 100.0 / count(*)) END AS fallback_pct,
       round(avg(latency_ms))::int AS avg_ms
  FROM llm_parse_log
 WHERE created_at >= now() - interval '24 hours';

COMMENT ON VIEW v_search_parser_health IS
  '파서 상태(24시간). 폴백 비율이 높으면 LLM 이 제 몫을 못 하는 '
  '것입니다 — 돈만 쓰고 정확도는 규칙 엔진과 같아집니다.';
