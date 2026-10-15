-- =====================================================================
-- D020 — 법률 · 세무 월 정액 노출료 기준 금액 (2026-10-02 사장님 결정)
--
--   「기준 금액은 관리자에서 등록 — 일단 월 30만원」
--
--   · 설정 directory.monthly_fee (기본 300000원). 운영 화면 「법률·세무 정액 노출」에서 바꿉니다.
--   · 노출을 켤 때 금액 칸을 비우면 이 기준 금액이 들어갑니다. 업체의 신청 화면에도 이 금액이 보입니다.
--   · 기준 금액을 바꿔도 **이미 켠 노출의 금액은 그대로**입니다 — 낸 금액의 기록이기 때문입니다.
--   · 노출료는 여전히 기간 정액입니다. 연락 · 수임 건수와 잇는 칸은 없습니다(D019 · 소개 대가 금지).
--
--   재실행 안전.
-- =====================================================================
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('directory.monthly_fee', '300000', 'GLOBAL',
        '법률 · 세무 월 정액 노출료 기준 금액(원 · 월). 노출을 켤 때 금액을 따로 적지 않으면 이 금액으로 기록합니다. '
        || '바꿔도 이미 켠 노출의 금액은 그대로입니다.',
        false, '^[1-9][0-9]{3,8}$', '300000')
ON CONFLICT (key) DO NOTHING;

/* 기준 금액 — 설정이 비었거나 형식이 틀리면 NULL(운영이 금액을 직접 적어야 켜집니다) */
CREATE OR REPLACE FUNCTION public.fn_directory_base_fee() RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN value ~ '^[1-9][0-9]{3,8}$' THEN value::numeric END
    FROM site_settings WHERE key = 'directory.monthly_fee'
$$;
COMMENT ON FUNCTION public.fn_directory_base_fee() IS
  '법률 · 세무 월 정액 노출료 기준 금액(설정 directory.monthly_fee). 형식이 틀리면 NULL.';
