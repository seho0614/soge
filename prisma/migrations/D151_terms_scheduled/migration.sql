-- =====================================================================
-- D151 · 약관 예정 게시 — 시행일을 지킴 (v10.161 · 2026-10-31 · sgb-core docs/246)
--   전에는 시행일을 미래로 넣고 게시해도 ① 앞 판이 그 자리에서 보관(ARCHIVED)으로 바뀌고 ② 회원에게 바로 재동의 화면이 떴음.
--   이용약관 제14조(시행 7일 전 고지 · 시행일부터 적용)와 어긋남(docs/242 §2 #3).
--   ① v_terms_current — 약관마다 「지금 시행 중인 판」 하나. 시행일이 지난 게시 판 중 가장 최근 것 · 없으면(처음 게시) 가장 이른 예정 판.
--      스위치 terms.reconsent_before_effective = on 이면 예전처럼 가장 최근 게시 판(시행일 전에도 재동의)
--   ② v_terms_upcoming — 시행 예정 판(게시됐지만 아직 시행 전 · 지금 판이 따로 있음) — 사용자 웹 알림 · 운영 화면 「예정」
--   ③ fn_terms_archive_due() — 새 판이 시행된 약관의 앞 판을 보관으로(매시간 작업 · 게시 · 운영 화면 목록에서 부름) · 바꾼 줄 수
--   ④ 필수 약관 미동의(v_term_not_agreed) · AI 켜기 조건(fn_privacy_ai_ready)이 지금 시행 중인 판을 봄
--   ⑤ fn_archive_prior_terms()(트리거 trg_archive_prior_terms · B075) — 게시하는 순간 앞 게시 판을 보관하던 것을, 시행일이 지난 경우만(③)으로.
--      같은 약관의 초안 · 법무 검토 판을 보관하는 것은 그대로
--   재실행 안전 · 지우는 문장 없음 · 기존 약관 · 동의 기록은 바꾸지 않음(③ 은 부를 때만)
-- =====================================================================

INSERT INTO public.site_settings (key, value, scope, description, value_pattern, value_example) VALUES
  ('terms.reconsent_before_effective', 'off', 'GLOBAL',
   '약관 새 판 재동의 시점 — off(기본)면 시행일부터 새 판 동의를 받고 그전에는 바뀔 내용만 알림(이용약관 제14조). on 이면 예전처럼 게시하는 즉시 재동의 화면이 뜸(법무 판단 뒤에만 · v10.161).',
   '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE VIEW public.v_terms_current AS
 WITH sw AS (SELECT coalesce((SELECT value FROM public.site_settings WHERE key = 'terms.reconsent_before_effective'), 'off') = 'on' AS early)
 SELECT DISTINCT ON (t.code) t.*
   FROM public.terms t CROSS JOIN sw
  WHERE t.status = 'PUBLISHED' AND t.effective_from <> 'infinity'
  ORDER BY t.code,
           (sw.early OR t.effective_from <= now()) DESC,
           CASE WHEN sw.early OR t.effective_from <= now() THEN t.effective_from END DESC NULLS LAST,
           t.effective_from ASC;

COMMENT ON VIEW public.v_terms_current IS '약관마다 지금 시행 중인 판 하나(시행일 지난 게시 판 중 최근 · 없으면 가장 이른 예정 판) — 동의 · 가입 · 재동의가 봄(D151 · v10.161)';

CREATE OR REPLACE VIEW public.v_terms_upcoming AS
 SELECT t.*
   FROM public.terms t
  WHERE t.status = 'PUBLISHED' AND t.effective_from > now() AND t.effective_from <> 'infinity'
    AND NOT EXISTS (SELECT 1 FROM public.v_terms_current c WHERE c.code = t.code AND c.version = t.version);

COMMENT ON VIEW public.v_terms_upcoming IS '시행 예정 판 — 게시됐지만 시행 전이고 지금 시행 중인 판이 따로 있음(D151 · v10.161)';

CREATE OR REPLACE FUNCTION public.fn_terms_archive_due() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE n int;
BEGIN
  UPDATE public.terms o SET status = 'ARCHIVED'
   WHERE o.status = 'PUBLISHED'
     AND NOT EXISTS (SELECT 1 FROM public.v_terms_current c WHERE c.code = o.code AND c.version = o.version)
     AND EXISTS (SELECT 1 FROM public.v_terms_current c WHERE c.code = o.code AND c.effective_from > o.effective_from);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

COMMENT ON FUNCTION public.fn_terms_archive_due() IS '새 판이 시행된 약관의 앞 판을 보관으로 — 시행 예정 판의 앞 판은 시행일까지 게시 그대로(D151 · v10.161)';

CREATE OR REPLACE FUNCTION public.fn_archive_prior_terms() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'PUBLISHED' AND OLD.status IS DISTINCT FROM 'PUBLISHED' THEN
    UPDATE terms SET status = 'ARCHIVED'
     WHERE code = NEW.code AND version <> NEW.version
       AND status IN ('LEGAL_REVIEW','DRAFT');
    /* D151 — 앞 게시 판은 새 판이 시행된 경우만 보관(시행 예정이면 시행일까지 게시 그대로 · 그 뒤 매시간 작업이 보관) */
    PERFORM public.fn_terms_archive_due();
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE VIEW public.v_term_not_agreed AS
 SELECT a.id AS account_id, a.email, t.code, t.title
   FROM accounts a CROSS JOIN v_terms_current t
  WHERE t.is_required AND a.status = 'ACTIVE'
    AND NOT EXISTS (SELECT 1 FROM v_term_consent_current g
                     WHERE g.account_id = a.id AND g.term_code = t.code AND g.term_version = t.version AND g.agreed);

CREATE OR REPLACE FUNCTION public.fn_privacy_ai_ready() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.v_terms_current
     WHERE code = 'PRIVACY'
       AND body ~ '(^|\n)#{1,4}[^\n]*국외 이전')
$$;

COMMENT ON FUNCTION public.fn_privacy_ai_ready() IS 'AI 켜기 조건(D145 · D149 · D151) — 지금 시행 중인 개인정보처리방침에 국외 이전 조항(제목 줄)이 있음. 시행 예정 판은 시행일부터. 판 번호는 보지 않음';
