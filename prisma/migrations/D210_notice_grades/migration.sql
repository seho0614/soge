-- =====================================================================
-- D210 (v10.279 · docs/408) — 공지 열람 등급 · 관리자 공지
--
--   대표 결정(11/13): 「공지사항 등급관리 — 해당 등급에 해당하는 공지만 열람 · 관리자가 등록할 때 등급을 정해 공지 ·
--                     관리자 공지도 등록 · 관리자용은 관리자만 본다」 → A 「공지 열람 등급 표」.
--   ① notice_grades — 등급 7개(코드 · 판단 규칙은 고정) · 이름 · 순서 · 사용 여부는 운영 화면에서(SUPER)
--   ② notices.grades — 볼 수 있는 등급(하나 이상) · 지금까지 올린 공지는 PUBLIC(보이는 범위 그대로) ·
--      요율 예약 공지(D209 로 연결된 것)는 SELLER
--   ③ fn_notice_grades(계정) — 그 사람이 가진 등급(한 곳에서만 판단 · 앱 · 시험이 같이 씀)
--      PUBLIC 누구나 · MEMBER 로그인 · BIZ 사업자 역할 · MAL_PARTNER 안심소개 활동 중(대표 · 합류 직원) ·
--      AFF_PARTNER 제휴 활동 중(대표) · SELLER 소개몰 입점 판매자(활동 · 쉬는 중) · STAFF 운영 화면 역할
--   지우는 문장 없음. 재실행 안전.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.notice_grades (
  code        text PRIMARY KEY CHECK (code IN ('PUBLIC', 'MEMBER', 'BIZ', 'MAL_PARTNER', 'AFF_PARTNER', 'SELLER', 'STAFF')),
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 30),
  rule        text NOT NULL,
  sort_order  int  NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  updated_by  uuid REFERENCES public.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.notice_grades IS
  'v10.279 (D210) 공지 열람 등급 — 코드 · 판단 규칙(rule)은 고정(fn_notice_grades) · 이름 · 순서 · 사용 여부만 운영 화면(SUPER)에서 바꿈';

INSERT INTO public.notice_grades (code, name, rule, sort_order) VALUES
  ('PUBLIC',      '전체 공개',        '누구나 — 로그인하지 않아도 봄', 10),
  ('MEMBER',      '로그인 회원',      '로그인한 모든 회원', 20),
  ('BIZ',         '사업자 회원',      '사업자(대표 · 직원) 역할이 있는 회원', 30),
  ('MAL_PARTNER', '안심소개 파트너',  '안심소개 파트너 활동 중(대표 · 합류한 직원)', 40),
  ('AFF_PARTNER', '제휴 파트너',      '제휴 파트너 활동 중(대표)', 50),
  ('SELLER',      '소개몰 판매자',    '소개몰 입점 판매자(활동 · 쉬는 중)', 60),
  ('STAFF',       '관리자',           '운영 화면 계정(관리자 · 최고 관리자 · 검수 · 지급 · 파트너 담당) — 사용자 웹에는 나오지 않음', 70)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.notices ADD COLUMN IF NOT EXISTS grades text[] NOT NULL DEFAULT ARRAY['PUBLIC']::text[];
ALTER TABLE public.notices DROP CONSTRAINT IF EXISTS ck_notices_grades;
ALTER TABLE public.notices ADD CONSTRAINT ck_notices_grades CHECK (
  cardinality(grades) >= 1 AND grades <@ ARRAY['PUBLIC', 'MEMBER', 'BIZ', 'MAL_PARTNER', 'AFF_PARTNER', 'SELLER', 'STAFF']::text[]);
COMMENT ON COLUMN public.notices.grades IS 'v10.279 (D210) 볼 수 있는 등급(notice_grades) — 하나라도 맞으면 봄 · STAFF 만이면 운영 화면에서만';
CREATE INDEX IF NOT EXISTS idx_notices_grades ON public.notices USING gin (grades);

-- 요율 예약 공지(D209)는 소개몰 판매자에게 — 아직 PUBLIC 기본값인 것만
UPDATE public.notices n SET grades = ARRAY['SELLER']::text[]
 WHERE n.grades = ARRAY['PUBLIC']::text[]
   AND EXISTS (SELECT 1 FROM public.hlt_rate_schedules r WHERE r.notice_id = n.id OR r.cancel_notice_id = n.id);

CREATE OR REPLACE FUNCTION public.fn_notice_grades(p_account uuid) RETURNS text[]
    LANGUAGE sql STABLE
    AS $$
  SELECT ARRAY['PUBLIC']::text[]
    || CASE WHEN p_account IS NULL OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = p_account) THEN ARRAY[]::text[] ELSE ARRAY['MEMBER']::text[] END
    || CASE WHEN EXISTS (SELECT 1 FROM account_roles WHERE account_id = p_account AND role IN ('BIZ_OWNER', 'BIZ_STAFF')) THEN ARRAY['BIZ']::text[] ELSE ARRAY[]::text[] END
    || CASE WHEN EXISTS (SELECT 1 FROM partners p JOIN businesses b ON b.id = p.business_id
                          LEFT JOIN business_members m ON m.business_id = b.id AND m.account_id = p_account
                                                      AND m.joined_at IS NOT NULL AND m.removed_at IS NULL
                         WHERE (b.account_id = p_account OR m.account_id IS NOT NULL) AND p.status = 'ACTIVE')
            THEN ARRAY['MAL_PARTNER']::text[] ELSE ARRAY[]::text[] END
    || CASE WHEN EXISTS (SELECT 1 FROM partners p JOIN businesses b ON b.id = p.business_id
                         WHERE b.account_id = p_account AND p.aff_status = 'ACTIVE')
            THEN ARRAY['AFF_PARTNER']::text[] ELSE ARRAY[]::text[] END
    || CASE WHEN EXISTS (SELECT 1 FROM hlt_sellers WHERE account_id = p_account AND type IN ('TENANT', 'BRAND') AND status IN ('ACTIVE', 'PAUSED'))
            THEN ARRAY['SELLER']::text[] ELSE ARRAY[]::text[] END
    || CASE WHEN EXISTS (SELECT 1 FROM account_roles WHERE account_id = p_account
                          AND role IN ('REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER', 'PARTNER_MAL', 'PARTNER_AFF'))
            THEN ARRAY['STAFF']::text[] ELSE ARRAY[]::text[] END;
$$;
COMMENT ON FUNCTION public.fn_notice_grades(uuid) IS
  'v10.279 (D210) 이 계정이 가진 공지 열람 등급 — 판단은 여기 한 곳(로그인 안 함 = PUBLIC 만). 쓰지 않는 등급(is_active false)은 앱이 고르지 못하게 함';
