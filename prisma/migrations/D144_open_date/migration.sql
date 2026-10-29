-- =====================================================================
-- D144 · 오픈일 한 칸 (v10.150 · 2026-10-29 · sgb-core docs/230)
--   ① site_settings service.open_date — 오픈일(YYYY-MM-DD · 한국 시간 · 비우면 미정)
--      운영 화면(오픈 체크리스트 · SUPER)에서 넣으면 API 가 request.view.limit_from(홍보 기간 종료일 · D013)을 오픈 + 3개월로 함께 넣음
--   ② v_open_readiness 에 권장 줄 OPEN_DATE(9줄) — 오픈 차단은 아님(권장)
--      · 메일 줄 「지금 값」에 보내는 주소(notify.mail_from)도 보임 — 판정은 그대로(v10.148 리허설: 켜져 있어도 주소가 비면 안 나감)
--   재실행 안전 · 지우는 문장 없음 · 기존 값 바꾸지 않음
-- =====================================================================

INSERT INTO public.site_settings (key, value, scope, description, value_pattern, value_example) VALUES
  ('service.open_date', '', 'GLOBAL',
   '서비스 오픈일(YYYY-MM-DD · 한국 시간 · 비우면 미정). 운영 화면 오픈 체크리스트에서 넣으면 홍보 기간 종료일(request.view.limit_from)이 오픈 + 3개월로 함께 정해집니다. 약관 시행일은 이 날로 맞춥니다.',
   '^$|^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$', '2026-12-15')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE VIEW public.v_open_readiness AS
WITH s AS (
  SELECT
    coalesce((SELECT upper(btrim(value)) FROM site_settings WHERE key = 'identity.provider'), 'STUB') AS idp,
    coalesce((SELECT upper(btrim(value)) FROM site_settings WHERE key = 'alimtalk.provider'), 'NONE') AS alp,
    coalesce((SELECT upper(btrim(value)) FROM site_settings WHERE key = 'esign.provider'), 'STUB') AS esp,
    coalesce((SELECT upper(btrim(value)) FROM site_settings WHERE key = 'safenum.provider'), 'NONE') AS snp,
    coalesce((SELECT lower(btrim(value)) FROM site_settings WHERE key = 'notify.email_verified'), 'off') AS mail,
    coalesce((SELECT lower(btrim(value)) FROM site_settings WHERE key = 'notify.alimtalk_ready'), 'off') AS alr,
    coalesce((SELECT lower(btrim(value)) FROM site_settings WHERE key = 'agent.enabled'), 'off') AS ai,
    coalesce((SELECT lower(btrim(value)) FROM site_settings WHERE key = 'feature.referral_fee'), 'off') AS fee,
    (SELECT count(*) FROM integrations WHERE code IN ('PASS', 'BANK') AND status = 'LIVE') AS passbank,
    coalesce((SELECT btrim(value) FROM site_settings WHERE key = 'service.open_date'), '') AS od,
    coalesce((SELECT btrim(value) FROM site_settings WHERE key = 'notify.mail_from'), '') AS mf,
    coalesce((SELECT btrim(value) FROM site_settings WHERE key = 'request.view.limit_from'), '') AS pe
)
SELECT x.code, x.label, x.required, x.ok, x.now_value, x.todo, x.go, x.sort
  FROM s CROSS JOIN LATERAL (VALUES
    ('IDENTITY', '본인인증 방식', true, s.idp = 'NICE',
     'identity.provider = ' || s.idp,
     'NICE 계약 → 키 3개 → 방식 NICE (docs/214) — 지금은 인증 없이 통과', 'integrations', 10),
    ('MAIL', '메일 발송 인증', true, s.mail = 'on',
     'notify.email_verified = ' || s.mail || ' · notify.mail_from = ' || coalesce(nullif(s.mf, ''), '(비어 있음 — .env MAIL_FROM 확인)'),
     'SES 인증 · DNS → 시험 메일 → 켜기 (docs/167) — 꺼져 있으면 비밀번호 찾기 메일이 나가지 않음', 'integrations', 20),
    ('NO_MOCK', '시험용 가짜(MOCK) 방식 없음', true,
     'MOCK' NOT IN (s.idp, s.alp, s.esp, s.snp),
     coalesce(nullif(concat_ws(' · ',
        CASE WHEN s.idp = 'MOCK' THEN 'identity.provider' END,
        CASE WHEN s.alp = 'MOCK' THEN 'alimtalk.provider' END,
        CASE WHEN s.esp = 'MOCK' THEN 'esign.provider' END,
        CASE WHEN s.snp = 'MOCK' THEN 'safenum.provider' END), '') || ' = MOCK', '없음'),
     '운영에서는 MOCK 을 쓰지 않음 — 실제 방식(NICE · HTTP)이나 꺼짐(STUB · NONE)으로', 'integrations', 30),
    ('REFERRAL_FEE', '소개비 스위치 순서', true, s.fee <> 'on' OR s.passbank = 2,
     'feature.referral_fee = ' || s.fee || ' · 본인인증 · 1원 계좌인증 LIVE ' || s.passbank || ' / 2',
     '소개비는 본인인증 · 1원 계좌인증이 모두 LIVE 가 된 뒤 켬 (open-blockers #9)', 'checklist', 40),
    ('ALIMTALK', '알림톡 · 문자 알림', false, s.alp = 'HTTP' AND s.alr = 'on',
     'alimtalk.provider = ' || s.alp || ' · notify.alimtalk_ready = ' || s.alr,
     '대행사 계약 → 템플릿 승인 → 켜기 (docs/215) — 꺼져 있으면 상담 신청이 닫힘', 'integrations', 50),
    ('ESIGN', '전자계약', false, s.esp = 'HTTP',
     'esign.provider = ' || s.esp,
     '업체 계약 → 방식 HTTP (docs/217) — 꺼져 있으면 화면 안 「서명」 단추로', 'integrations', 60),
    ('SAFENUM', '050 안심번호', false, s.snp = 'HTTP',
     'safenum.provider = ' || s.snp,
     '업체 계약 → 처리방침 위탁 → 방식 HTTP (docs/221) — 꺼져 있으면 「준비 중」 안내', 'integrations', 70),
    ('AI', 'AI 상담', false, s.ai = 'on',
     'agent.enabled = ' || s.ai,
     '약관 게시 → AI 키 · 월 상한 → 켜기 (docs/149) — 오픈 뒤 단계별로 켜도 됨', NULL, 80),
    ('OPEN_DATE', '오픈일', false, s.od <> '',
     'service.open_date = ' || coalesce(nullif(s.od, ''), '(없음)') || ' · 홍보 기간 종료일 ' || coalesce(nullif(s.pe, ''), '(없음)'),
     '오픈일을 넣으면 홍보 기간 종료일(오픈 + 3개월)이 함께 정해짐 · 약관 시행일은 오픈일로 · 게시는 시행 7일 전까지 (docs/230)', 'checklist', 90)
  ) AS x(code, label, required, ok, now_value, todo, go, sort)
 ORDER BY x.sort;
COMMENT ON VIEW public.v_open_readiness IS '오픈 준비 점검(D142 · v10.146 · docs/225 · D144 v10.150 오픈일 줄) — required 이고 ok 가 아닌 줄은 v_open_blockers 의 READY 로 올라감. 설정 값만 읽음.';
