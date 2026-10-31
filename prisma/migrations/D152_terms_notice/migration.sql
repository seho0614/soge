-- =====================================================================
-- D152 · 약관 변경 회원 알림 · 오픈 준비 점검 약관 줄 (v10.162 · 2026-10-31 · sgb-core docs/248)
--   ① terms.published_at(게시한 때) · terms.is_adverse(회원에게 불리한 변경 — 게시할 때 운영 화면에서 고름)
--      시행 예정 판의 고지 기간을 잼: 게시 → 시행 7일(불리하면 30일 · 이용약관 제14조). 기존 줄은 비워 둠(바꾸지 않음)
--   ② 알림 종류 TERM_CHANGE_NOTICE(약관 변경 안내 · 수신 거부 불가 · 주황) — 시행 예정으로 게시하면 회원마다 알림 1건(사이트 안)
--      메일 · 알림톡은 그 채널이 켜진 뒤 기존 notify_dispatch 가 같은 알림을 보냄(새 발송 길 없음)
--   ③ 설정 terms.notify_members(기본 on · off 면 알림을 만들지 않음)
--   ④ v_open_readiness 권장 줄 2개(11줄) — TERMS_EFFECTIVE 필수 약관이 오픈일까지 시행 · TERMS_NOTICE 고지 기간 부족 없음
--      오픈 차단은 아님(권장) — 필수 약관이 아예 게시되지 않은 것은 이미 v_open_blockers 의 TERM 줄이 막음
--   재실행 안전 · 지우는 문장 없음 · 기존 약관 · 알림 줄은 바꾸지 않음
-- =====================================================================

ALTER TABLE public.terms ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE public.terms ADD COLUMN IF NOT EXISTS is_adverse boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.terms.published_at IS '게시한 때(v10.162 · D152) — 시행 예정 판의 고지 기간(제14조)을 잼 · 예정 취소하면 비움 · v10.162 전 게시 판은 비어 있음';
COMMENT ON COLUMN public.terms.is_adverse IS '회원에게 불리한 변경(v10.162 · D152) — 게시할 때 고름 · 시행일은 게시 뒤 30일 이상(422 TERM_ADVERSE_30D)';

INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis, tone) VALUES
  ('TERM_CHANGE_NOTICE', '약관 변경 안내', false, false, '이용약관 제14조 — 약관을 바꿀 때 시행 7일(불리하면 30일) 전 고지', 'warn')
ON CONFLICT (event_code) DO NOTHING;

INSERT INTO public.site_settings (key, value, scope, description, value_pattern, value_example) VALUES
  ('terms.notify_members', 'on', 'GLOBAL',
   '약관 시행 예정 게시 때 회원 알림 — on(기본)이면 시행일을 미래로 게시할 때 회원마다 「약관 변경 안내」 알림 1건(사이트 안 · 메일 · 알림톡은 그 채널이 켜진 뒤). off 면 만들지 않음(v10.162).',
   '^(on|off)$', 'on')
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
), tq AS (
  SELECT
    (SELECT count(DISTINCT code) FROM terms WHERE is_required AND audience = 'ALL') AS treq,
    (SELECT count(*) FROM v_terms_current c
      WHERE c.is_required AND c.audience = 'ALL' AND s.od ~ '^\d{4}-\d{2}-\d{2}$'
        AND c.effective_from < ((s.od::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul')) AS tok,
    (SELECT count(*) FROM v_terms_upcoming) AS tup,
    (SELECT count(*) FROM v_terms_upcoming u JOIN terms t ON t.code = u.code AND t.version = u.version
      WHERE t.published_at IS NOT NULL
        AND t.effective_from < t.published_at + make_interval(days => CASE WHEN t.is_adverse THEN 30 ELSE 7 END)) AS tshort
    FROM s
)
SELECT x.code, x.label, x.required, x.ok, x.now_value, x.todo, x.go, x.sort
  FROM s CROSS JOIN tq CROSS JOIN LATERAL (VALUES
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
     '오픈일을 넣으면 홍보 기간 종료일(오픈 + 3개월)이 함께 정해짐 · 약관 시행일은 오픈일로 · 게시는 시행 7일 전까지 (docs/230)', 'checklist', 90),
    ('TERMS_EFFECTIVE', '약관 시행일', false, s.od <> '' AND tq.treq > 0 AND tq.tok = tq.treq,
     '오픈일(' || coalesce(nullif(s.od, ''), '없음') || ')까지 시행되는 필수 약관 ' || tq.tok || ' / ' || tq.treq,
     '필수 약관마다 오픈일 또는 그 전에 시행되는 판을 게시 — 법무 확인 → 운영 화면 › 관 관리 › 약관 (docs/248)', 'terms', 100),
    ('TERMS_NOTICE', '약관 변경 고지 기간', false, tq.tshort = 0,
     '시행 예정 ' || tq.tup || '건 · 고지 기간 부족 ' || tq.tshort || '건',
     '시행 예정 판은 게시 뒤 7일(회원에게 불리한 변경은 30일) 지나 시행 — 이용약관 제14조 (docs/248)', 'terms', 110)
  ) AS x(code, label, required, ok, now_value, todo, go, sort)
 ORDER BY x.sort;
COMMENT ON VIEW public.v_open_readiness IS '오픈 준비 점검(D142 · v10.146 · docs/225 · D144 오픈일 줄 · D152 v10.162 약관 시행일 · 고지 기간 줄) — required 이고 ok 가 아닌 줄은 v_open_blockers 의 READY 로 올라감.';
