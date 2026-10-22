-- =====================================================================
-- D108 — v10.71 (2026-10-22 · 자동검수 점검 ③ 금칙어 범위 · 낱말 일치 · 첫 등록 · 반려 이력 · 정책 값 · docs/127)
--
--   대표 결정(2026-10-22 「추천대로」 · 반려 이력은 A — 최근 90일 · 매물 반려만)
--
--   ① fn_text_of · fn_listing_text — 매물 글 칸 모음(제목 · 본문 · 요약 · 지역 상세 · 연락 시간 · 업체 정보). 주소는 뺌
--   ② fn_enforce_banned_words — 차단 검사를 ① 의 칸 모두로. 새로 넣을 때는 전부, **고칠 때는 바뀐 칸만**
--      (전: 제목 · 본문만 · 고칠 때 바뀌지 않은 칸까지 — 예전 글에 금칙어가 있으면 운영자의 상태 변경까지 막힘)
--      요청(requests)도 같은 함수 — 요청에 없는 칸은 건너뜀
--   ③ fn_word_norm · fn_check_banned_words — 「정확히 일치(EXACT)」를 **낱말 일치**로
--      (전: 글 전체가 그 단어와 같을 때만 → 사실상 동작 안 함). 예) 「사채」 → 「사채 대출」 걸림 · 「사채업」 안 걸림
--   ④ fn_auto_review_reasons — 주의 단어도 ① 의 칸 모두 · 첫 등록 = 한 번도 노출된 적 없음 · 반려 이력 = 최근 N일 · 매물 반려만
--   ⑤ 자동검수 정책 값 범위 검사(trg_auto_review_policy_guard) — 틀리면 'POLICY_VALUE: …' (422)
--   ⑥ 반려 이력 정책에 일수 90 · 설명
--
--   자료를 지우지 않습니다. 재실행 안전(CREATE OR REPLACE · DROP TRIGGER IF EXISTS · 같은 값으로 UPDATE).
--   켜진 EXACT 금칙어가 있으면 개수를 알림으로 남깁니다(이제부터 낱말 단위로 실제로 걸리기 시작함).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_text_of(j jsonb, keys text[]) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT coalesce(string_agg(
           CASE jsonb_typeof(j -> k)
             WHEN 'string' THEN j ->> k
             WHEN 'object' THEN (SELECT string_agg(e.value, ' ') FROM jsonb_each_text(j -> k) e)
           END, ' '), '')
    FROM unnest(keys) AS k;
$$;

CREATE OR REPLACE FUNCTION public.fn_listing_text_keys() RETURNS text[]
    LANGUAGE sql IMMUTABLE
    AS $$ SELECT ARRAY['title', 'body', 'summary', 'region_detail', 'contact_hours', 'biz_info'] $$;

CREATE OR REPLACE FUNCTION public.fn_listing_text(l public.listings) RETURNS text
    LANGUAGE sql STABLE
    AS $$ SELECT fn_text_of(to_jsonb(l), fn_listing_text_keys()) $$;

CREATE OR REPLACE FUNCTION public.fn_word_norm(t text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$ SELECT ' ' || btrim(regexp_replace(lower(coalesce(t, '')), '[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]+', ' ', 'g')) || ' ' $$;

CREATE OR REPLACE FUNCTION public.fn_check_banned_words(p_text text, p_gwan text) RETURNS TABLE(word text, severity text)
    LANGUAGE sql STABLE
    AS $$
  SELECT b.word, b.severity
    FROM banned_words b
   WHERE b.is_active
     AND (b.gwan_code IS NULL OR b.gwan_code = p_gwan)
     AND btrim(b.word) <> ''            -- 빈 규칙은 전건 적중을 만듭니다
     AND CASE b.match_type
           -- D108 — 낱말 일치: 띄어쓰기 · 문장부호로 나눈 낱말(들)이 같을 때(전: p_text = b.word — 글 전체가 같을 때만)
           WHEN 'EXACT'    THEN position(fn_word_norm(b.word) in fn_word_norm(p_text)) > 0
           -- lower() + position() : 대소문자 무시 + 문자 그대로 비교
           WHEN 'CONTAINS' THEN position(lower(b.word) in lower(p_text)) > 0
           WHEN 'REGEX'    THEN fn_regex_hit(p_text, b.word)   -- D106
           ELSE false
         END;
$$;

CREATE OR REPLACE FUNCTION public.fn_enforce_banned_words() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  j jsonb := to_jsonb(NEW);
  o jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
  keys text[];
  hit record;
BEGIN
  -- D108 — 새로 넣을 때는 글 칸 전부, 고칠 때는 바뀐 칸만(전: 제목 · 본문만 · 바뀌지 않아도)
  SELECT array_agg(k) INTO keys FROM unnest(fn_listing_text_keys()) AS k
   WHERE j ? k AND (o IS NULL OR (j -> k) IS DISTINCT FROM (o -> k));
  IF keys IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO hit FROM fn_check_banned_words(fn_text_of(j, keys), NEW.gwan_code)
   WHERE severity = 'BLOCK' LIMIT 1;

  IF hit.word IS NOT NULL THEN
    RAISE EXCEPTION 'BANNED_WORD: "%"는 사용할 수 없는 표현입니다.', hit.word;
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_auto_review_reasons(p_review_item_id uuid) RETURNS text[]
    LANGUAGE plpgsql
    AS $$
DECLARE
  ri record; l record; b record; c record;
  reasons text[] := '{}';
  pol record;
  prior_rejects int;
  warn_word text;
BEGIN
  SELECT * INTO ri FROM review_items WHERE id = p_review_item_id;
  IF ri IS NULL THEN RETURN ARRAY['NOT_FOUND']; END IF;

  SELECT * INTO pol FROM auto_review_policies WHERE key = 'auto_approve_enabled';
  IF NOT pol.enabled THEN RETURN ARRAY['AUTO_DISABLED']; END IF;

  IF ri.target_type <> 'LISTING' THEN
    RETURN ARRAY['TARGET_TYPE_' || ri.target_type];
  END IF;

  SELECT * INTO l FROM listings WHERE id = ri.target_id;
  IF l IS NULL THEN RETURN ARRAY['TARGET_MISSING']; END IF;

  SELECT * INTO b FROM businesses
   WHERE account_id = l.owner_account_id ORDER BY verified_at NULLS LAST LIMIT 1;
  SELECT * INTO c FROM categories WHERE id = l.category_id;

  -- ★ 주의 단어. 문맥에 따라 정상일 수 있어 차단하지 않고 사람에게 보냅니다
  -- D108 — 제목 · 본문만 → 매물 글 칸 모두(fn_listing_text 와 같은 칸 · l 은 record 라 to_jsonb 로)
  SELECT w.word INTO warn_word
    FROM fn_check_banned_words(fn_text_of(to_jsonb(l), fn_listing_text_keys()), l.gwan_code) w
   WHERE w.severity = 'WARN' LIMIT 1;
  IF warn_word IS NOT NULL THEN
    reasons := array_append(reasons, 'BANNED_WORD_WARN');
  END IF;

  -- D107 — P2P(2026-10-13 · 개인도 모든 업무): 본인인증한 개인은 이 이유로 사람에게 보내지 않습니다.
  --        본인인증도 사업자 인증도 없을 때만(전: 사업자 인증이 없으면 개인은 모두 사람 검수)
  SELECT * INTO pol FROM auto_review_policies WHERE key = 'manual_unverified_business';
  IF pol.enabled AND (b IS NULL OR b.verified_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM accounts a
                      WHERE a.id = l.owner_account_id AND a.identity_verified_at IS NOT NULL) THEN
    reasons := array_append(reasons, 'UNVERIFIED_BUSINESS');
  END IF;

  -- D108 — 첫 등록 = 그 회원의 매물이 한 번도 노출된 적 없음(이 매물 포함).
  --        전: 다른 매물이 지금 노출 중이 아니면 첫 등록 → 매물이 하나뿐인 회원은 고칠 때마다 사람 검수
  SELECT * INTO pol FROM auto_review_policies WHERE key = 'manual_first_listing';
  IF pol.enabled AND NOT EXISTS (
       SELECT 1 FROM listings x
        WHERE x.owner_account_id = l.owner_account_id
          AND x.published_at IS NOT NULL
     ) THEN
    reasons := array_append(reasons, 'FIRST_LISTING');
  END IF;

  SELECT * INTO pol FROM auto_review_policies WHERE key = 'manual_fee_threshold';
  IF pol.enabled AND l.desired_fee IS NOT NULL AND l.desired_fee >= pol.num_value THEN
    reasons := array_append(reasons, 'HIGH_FEE');
  END IF;

  -- D108 — 반려 이력 = 최근 N일(정책 숫자 값 · 기본 90) 안의 **매물** 반려만(대표 2026-10-22 「추천대로」 A).
  --        전: 반려가 한 번이라도 · 종류와 관계없이(배지 포함) · 기한 없이
  SELECT * INTO pol FROM auto_review_policies WHERE key = 'manual_after_reject';
  IF pol.enabled THEN
    SELECT count(*) INTO prior_rejects FROM review_items x
     WHERE x.submitted_by = l.owner_account_id AND x.status = 'REJECTED'
       AND x.target_type = 'LISTING'
       AND coalesce(x.decided_at, x.submitted_at) > now() - make_interval(days => coalesce(pol.num_value, 90)::int);
    IF prior_rejects > 0 THEN reasons := array_append(reasons, 'PRIOR_REJECT'); END IF;
  END IF;

  SELECT * INTO pol FROM auto_review_policies WHERE key = 'manual_gated_category';
  IF pol.enabled AND c.restricted_code IS NOT NULL AND EXISTS (
       SELECT 1 FROM restricted_industries r
        WHERE r.code = c.restricted_code AND r.gwan_code = l.gwan_code
          AND r.is_active AND r.mode = 'GATED'
     ) THEN
    reasons := array_append(reasons, 'GATED_CATEGORY');
  END IF;

  SELECT * INTO pol FROM auto_review_policies WHERE key = 'min_body_length';
  IF pol.enabled AND coalesce(length(btrim(l.body)), 0) < pol.num_value THEN
    reasons := array_append(reasons, 'THIN_CONTENT');
  END IF;

  RETURN reasons;
END $$;

CREATE OR REPLACE FUNCTION public.fn_auto_review_policy_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE lo numeric; hi numeric; unit text;
BEGIN
  IF NEW.num_value IS NULL THEN RETURN NEW; END IF;
  SELECT r.lo, r.hi, r.unit INTO lo, hi, unit FROM (VALUES
      ('sample_audit_rate',    0::numeric, 100::numeric, '%'),
      ('manual_fee_threshold', 0,          NULL,         '원'),
      ('min_body_length',      0,          2000,         '자'),
      ('urgent_max_days',      1,          60,           '일'),
      ('urgent_max_active',    1,          20,           '건'),
      ('manual_after_reject',  1,          3650,         '일')
    ) AS r(key, lo, hi, unit) WHERE r.key = NEW.key;
  IF lo IS NOT NULL AND (NEW.num_value < lo OR (hi IS NOT NULL AND NEW.num_value > hi)) THEN
    RAISE EXCEPTION 'POLICY_VALUE: 「%」 값은 % ~ % 사이여야 합니다(단위 % · 받은 값 %).',
      NEW.key, lo, coalesce(hi::text, '제한 없음'), unit, NEW.num_value;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_review_policy_guard ON public.auto_review_policies;
CREATE TRIGGER trg_auto_review_policy_guard BEFORE INSERT OR UPDATE ON public.auto_review_policies
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_review_policy_guard();

UPDATE public.auto_review_policies
   SET num_value = 90, updated_at = now()
 WHERE key = 'manual_after_reject' AND num_value IS NULL;
UPDATE public.auto_review_policies
   SET description = '최근 N일(숫자 값) 안에 매물이 반려된 적 있으면 사람이 본다(배지 반려는 빼고)', updated_at = now()
 WHERE key = 'manual_after_reject'
   AND description IS DISTINCT FROM '최근 N일(숫자 값) 안에 매물이 반려된 적 있으면 사람이 본다(배지 반려는 빼고)';
UPDATE public.auto_review_policies
   SET description = '그 회원의 매물이 한 번도 노출된 적 없으면(처음 올리는 매물) 사람이 본다', updated_at = now()
 WHERE key = 'manual_first_listing'
   AND description IS DISTINCT FROM '그 회원의 매물이 한 번도 노출된 적 없으면(처음 올리는 매물) 사람이 본다';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.banned_words WHERE is_active AND match_type = 'EXACT';
  IF n > 0 THEN RAISE NOTICE 'D108 — 켜진 「정확히 일치(EXACT)」 금칙어 %줄이 이제부터 낱말 단위로 걸립니다(전에는 사실상 걸리지 않음).', n; END IF;
END $$;

COMMENT ON FUNCTION public.fn_listing_text(public.listings) IS '매물 글 칸 모음(제목 · 본문 · 요약 · 지역 상세 · 연락 시간 · 업체 정보) — 금칙어 · 자동검수 · 검수 화면이 같이 씀 · D108';
COMMENT ON FUNCTION public.fn_word_norm(text) IS '낱말 일치용 — 소문자 · 문장부호/빈칸을 한 칸으로 · 앞뒤 한 칸 · D108';
COMMENT ON TRIGGER trg_auto_review_policy_guard ON public.auto_review_policies IS '자동검수 정책 값 범위 — POLICY_VALUE · D108';
