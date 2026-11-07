-- =====================================================================
-- D183 (v10.206 · docs/330) — AI 첫 주 보고 · 공휴일 표 · 위탁 목록에 카카오
--
--   ① 개인정보처리방침 제5조 · 위탁 안내 제2조 표에 「카카오」 줄(대표 「카카오 적용」 11/7 · map-kakao 미정 #2)
--      지도 · 주소 좌표(매물 도로명 · 지번만) · 동네 인증(현재 위치) · 우리동네 맛집(위치 · 찾는 말)을 카카오에 보냄.
--      글 원본 scripts/terms-text.js · docs/terms 와 같은 줄. **글 전체를 바꾸지 않고 Anthropic 줄 위에 한 줄만** 넣음
--      (운영 초안은 법무 검토 중 운영 화면에서 고쳤을 수 있음).
--      초안(DRAFT · LEGAL_REVIEW)이 있으면 그 판에 · 게시된 판만 있으면 다음 번호 LEGAL_REVIEW 초안(D161 과 같은 규칙) ·
--      이미 「| 카카오 |」 줄이 있으면 안 함. **게시하지 않음**.
--   ② 보기 v_agent_week — 최근 7일(한국 날짜) 날짜별 AI 상담 · 검수 보조 · 비용(운영 화면 AI 첫 주 보고 · 하루 요약)
--   ③ 표 public_holidays · fn_is_business_day · fn_business_day_after — 주말 + 공휴일을 건너뜀
--      처음 값: 2026-12-25 · 2027년(설날 · 부처님오신날 · 추석 · 대체공휴일 · 노동절 · 제헌절) — 정리 사이트 2곳 대조 · 노동절 대체(2027-05-03)는 자료가 갈려 넣지 않음
--      fn_review_sla_due(검수 마감)도 공휴일을 건너뜀
--
--   지우는 문장 없음. 재실행 안전.
-- =====================================================================

-- ① 위탁 목록에 카카오 --------------------------------------------------------
DO $$
DECLARE
  c record; r record; v_body text; v_ver text;
  v_note text := $N$v10.206 초안 — 처리를 맡기는 곳에 카카오(지도 · 주소 좌표 · 동네 인증 · 주변 장소 검색)를 더함(대표 「카카오 적용」 11/7 · docs/330)$N$;
BEGIN
  FOR c IN SELECT * FROM (VALUES
      ('PRIVACY',   $R$| 카카오 | 지도 · 주소를 좌표로 바꾸기 · 동네 인증(위치로 동네 찾기) · 주변 장소 검색 |$R$),
      ('OUTSOURCE', $R$| 카카오 | 지도 · 주소 좌표 · 동네 인증 · 주변 장소 검색 | 매물 주소(도로명 또는 지번 — 동 · 호는 보내지 않음) · 동네 인증 · 맛집 찾기 때의 현재 위치 좌표 |$R$)
    ) AS x(code, row_text)
  LOOP
    IF EXISTS (SELECT 1 FROM public.terms WHERE code = c.code AND status IN ('DRAFT','LEGAL_REVIEW')) THEN
      UPDATE public.terms
         SET body = regexp_replace(body, E'\n(\\| Anthropic, PBC\\(미국\\) \\|)', E'\n' || c.row_text || E'\n\\1'),
             change_note = v_note
       WHERE code = c.code AND status IN ('DRAFT','LEGAL_REVIEW')
         AND position('| 카카오 |' IN body) = 0 AND body ~ E'\n\\| Anthropic, PBC\\(미국\\) \\|';
      CONTINUE;
    END IF;
    SELECT * INTO r FROM public.terms WHERE code = c.code AND status = 'PUBLISHED' ORDER BY effective_from DESC LIMIT 1;
    IF r.code IS NULL OR position('| 카카오 |' IN r.body) > 0 OR r.body !~ E'\n\\| Anthropic, PBC\\(미국\\) \\|' THEN CONTINUE; END IF;
    v_body := regexp_replace(r.body, E'\n(\\| Anthropic, PBC\\(미국\\) \\|)', E'\n' || c.row_text || E'\n\\1');
    v_ver := split_part(r.version, '.', 1) || '.' || (split_part(r.version, '.', 2)::int + 1);
    WHILE EXISTS (SELECT 1 FROM public.terms WHERE code = r.code AND version = v_ver) LOOP
      v_ver := split_part(v_ver, '.', 1) || '.' || (split_part(v_ver, '.', 2)::int + 1);
    END LOOP;
    INSERT INTO public.terms (code, version, title, body, is_required, effective_from, status, display_order, gwan_code, change_note, is_notice)
    VALUES (r.code, v_ver, r.title, v_body, r.is_required, 'infinity', 'LEGAL_REVIEW', r.display_order, r.gwan_code, v_note, r.is_notice);
    RAISE NOTICE '% % 초안(LEGAL_REVIEW · v10.206 카카오) — 게시된 % 는 그대로', r.code, v_ver, r.version;
  END LOOP;
END $$;

-- ② AI 첫 주 보고 ---------------------------------------------------------------
--   답 · 넘김 셈은 AI 켜기 단계(GET /admin/agent/rollout)와 같음 · 일치율은 v_ai_review_agreement 와 같은 식(모름 제외 · 그날 낸 의견 중 사람이 정한 것)
CREATE OR REPLACE VIEW public.v_agent_week AS
WITH d AS (
  SELECT generate_series((now() AT TIME ZONE 'Asia/Seoul')::date - 6, (now() AT TIME ZONE 'Asia/Seoul')::date, interval '1 day')::date AS day
), m AS (
  SELECT (m.created_at AT TIME ZONE 'Asia/Seoul')::date AS day,
         count(*) FILTER (WHERE m.handoff IS FALSE) AS answers,
         count(*) FILTER (WHERE m.handoff IS TRUE OR (m.handoff IS NULL AND m.stop_reason IN ('refusal','max_tokens','bad_shape','banned'))) AS handoffs
    FROM public.agent_messages m JOIN public.agent_conversations c ON c.id = m.conversation_id
   WHERE c.channel = 'SITE_CHAT' AND m.role = 'assistant' AND m.created_at >= now() - interval '8 days'
   GROUP BY 1
), cv AS (
  SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS day, count(*) AS chats
    FROM public.agent_conversations WHERE channel = 'SITE_CHAT' AND created_at >= now() - interval '8 days' GROUP BY 1
), o AS (
  SELECT (o.created_at AT TIME ZONE 'Asia/Seoul')::date AS day,
         count(*) AS opinions,
         count(*) FILTER (WHERE r.status IN ('APPROVED','REJECTED')) AS decided,
         count(*) FILTER (WHERE (o.suggestion = 'APPROVE' AND r.status = 'APPROVED') OR (o.suggestion = 'REJECT' AND r.status = 'REJECTED')) AS agreed,
         count(*) FILTER (WHERE r.status IN ('APPROVED','REJECTED') AND o.suggestion <> 'UNSURE') AS sure
    FROM public.ai_review_opinions o JOIN public.review_items r ON r.id = o.review_item_id
   WHERE o.created_at >= now() - interval '8 days'
   GROUP BY 1
), u AS (
  SELECT day, sum(requests) AS requests, sum(cost_usd) AS cost_usd
    FROM public.agent_usage_daily WHERE day >= (now() AT TIME ZONE 'Asia/Seoul')::date - 6 GROUP BY 1
)
SELECT d.day,
       coalesce(cv.chats, 0)::int AS chats,
       coalesce(m.answers, 0)::int AS answers,
       coalesce(m.handoffs, 0)::int AS handoffs,
       round(100.0 * m.answers / nullif(m.answers + m.handoffs, 0), 1)::float AS answered_pct,
       coalesce(o.opinions, 0)::int AS opinions,
       coalesce(o.decided, 0)::int AS decided,
       round(100.0 * o.agreed / nullif(o.sure, 0), 1)::float AS agree_pct,
       coalesce(u.requests, 0)::int AS requests,
       round(coalesce(u.cost_usd, 0), 4)::float AS cost_usd
  FROM d LEFT JOIN m ON m.day = d.day LEFT JOIN cv ON cv.day = d.day LEFT JOIN o ON o.day = d.day LEFT JOIN u ON u.day = d.day;

COMMENT ON VIEW public.v_agent_week IS 'v10.206 (D183) — 최근 7일 날짜별 AI 상담(대화 · 답 · 넘김 · 답 %) · 검수 보조(의견 · 사람 결정 · 일치율) · 요청 · 비용. 운영 화면 AI 첫 주 보고 · 하루 요약.';

-- ③ 공휴일 · 영업일 ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.public_holidays (
  day        date PRIMARY KEY,
  name       text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  created_by uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.public_holidays IS 'v10.206 (D183) — 공휴일(영업일 계산에서 건너뜀). 운영 화면 › 사이트 기본 정보 › 공휴일(저장 SUPER · 감사 HOLIDAY_SAVE · HOLIDAY_DELETE).';

INSERT INTO public.public_holidays (day, name) VALUES
  ('2026-12-25', '성탄절'),
  ('2027-01-01', '신정'),
  ('2027-02-06', '설날 연휴'), ('2027-02-07', '설날'), ('2027-02-08', '설날 연휴'), ('2027-02-09', '대체공휴일(설날)'),
  ('2027-03-01', '삼일절'),
  ('2027-05-01', '노동절'),
  ('2027-05-05', '어린이날'),
  ('2027-05-13', '부처님오신날'),
  ('2027-06-06', '현충일'),
  ('2027-07-17', '제헌절'),
  ('2027-08-15', '광복절'), ('2027-08-16', '대체공휴일(광복절)'),
  ('2027-09-14', '추석 연휴'), ('2027-09-15', '추석'), ('2027-09-16', '추석 연휴'),
  ('2027-10-03', '개천절'), ('2027-10-04', '대체공휴일(개천절)'),
  ('2027-10-09', '한글날'), ('2027-10-11', '대체공휴일(한글날)'),
  ('2027-12-25', '성탄절'), ('2027-12-27', '대체공휴일(성탄절)')
ON CONFLICT (day) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_is_business_day(p_day date) RETURNS boolean
    LANGUAGE sql STABLE AS $$
  SELECT extract(isodow FROM p_day) NOT IN (6, 7) AND NOT EXISTS (SELECT 1 FROM public.public_holidays h WHERE h.day = p_day);
$$;
COMMENT ON FUNCTION public.fn_is_business_day(date) IS 'v10.206 (D183) — 영업일인가(토 · 일 · 공휴일이 아님).';

-- 영업일 1일 뒤 — 같은 시각에서 하루 뒤 · 그날이 영업일이 아니면 영업일까지 하루씩(문의 답변 예정 시각 · 전에는 서버 코드가 주말만 봄)
CREATE OR REPLACE FUNCTION public.fn_business_day_after(p_at timestamptz) RETURNS timestamptz
    LANGUAGE plpgsql STABLE AS $$
DECLARE t timestamp := (p_at AT TIME ZONE 'Asia/Seoul') + interval '1 day'; n int := 0;
BEGIN
  WHILE NOT public.fn_is_business_day(t::date) AND n < 60 LOOP t := t + interval '1 day'; n := n + 1; END LOOP;
  RETURN t AT TIME ZONE 'Asia/Seoul';
END $$;
COMMENT ON FUNCTION public.fn_business_day_after(timestamptz) IS 'v10.206 (D183) — 영업일 1일 뒤(토 · 일 · 공휴일 건너뜀 · 한국 시간). 문의 접수 「답변 예정」.';

-- 검수 마감 — D056 과 같고 「토 · 일」 자리를 fn_is_business_day 로(공휴일도 건너뜀)
CREATE OR REPLACE FUNCTION public.fn_review_sla_due(p_from timestamptz, p_hours int)
RETURNS timestamptz LANGUAGE plpgsql STABLE AS $function$
DECLARE t timestamp := p_from AT TIME ZONE 'Asia/Seoul'; left_h numeric := p_hours; step numeric;
BEGIN
  /* 영업일이 아닌 날에 들어온 건은 다음 영업일 0시부터 셉니다 */
  WHILE NOT public.fn_is_business_day(t::date) LOOP t := date_trunc('day', t) + interval '1 day'; END LOOP;
  WHILE left_h > 0 LOOP
    step := least(left_h, extract(epoch FROM (date_trunc('day', t) + interval '1 day' - t)) / 3600);
    t := t + make_interval(secs => step * 3600);
    left_h := left_h - step;
    WHILE left_h > 0 AND NOT public.fn_is_business_day(t::date) LOOP t := date_trunc('day', t) + interval '1 day'; END LOOP;
  END LOOP;
  RETURN t AT TIME ZONE 'Asia/Seoul';
END $function$;
COMMENT ON FUNCTION public.fn_review_sla_due IS 'v10.31 · v10.206 (D183) — 검수 마감 = 영업일(토 · 일 · 공휴일 제외) 기준 N시간 뒤. ReviewRepository.enqueue 가 씁니다.';
