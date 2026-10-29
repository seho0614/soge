-- =====================================================================
-- D142 — v10.146 (2026-10-29 · 오픈 준비 점검 2판 · docs/225)
--
--   ① v_open_readiness — 오픈 준비 점검 8줄(꼭 4 · 권장 4 · 지금 값 · 할 일 · 고칠 곳)
--      꼭: 본인인증 방식 NICE · 메일 발송 인증 · 시험용 가짜(MOCK) 방식 없음 · 소개비 스위치 순서
--      권장: 알림톡 · 전자계약 · 050 안심번호 · AI 상담 (꺼져 있어도 오픈은 됨 — 그 기능만 닫힘)
--   ② v_open_blockers 에 「READY」 줄 더함 — ① 의 꼭 줄 중 안 된 것
--      (v10.27 D031 뒤로 그대로였음 — v10.128 ~ v10.145 의 방식 설정을 못 봄)
--   재실행 안전 · 자료를 바꾸지 않음(보기 두 개만).
-- =====================================================================

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
    (SELECT count(*) FROM integrations WHERE code IN ('PASS', 'BANK') AND status = 'LIVE') AS passbank
)
SELECT x.code, x.label, x.required, x.ok, x.now_value, x.todo, x.go, x.sort
  FROM s CROSS JOIN LATERAL (VALUES
    ('IDENTITY', '본인인증 방식', true, s.idp = 'NICE',
     'identity.provider = ' || s.idp,
     'NICE 계약 → 키 3개 → 방식 NICE (docs/214) — 지금은 인증 없이 통과', 'integrations', 10),
    ('MAIL', '메일 발송 인증', true, s.mail = 'on',
     'notify.email_verified = ' || s.mail,
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
     '약관 게시 → AI 키 · 월 상한 → 켜기 (docs/149) — 오픈 뒤 단계별로 켜도 됨', NULL, 80)
  ) AS x(code, label, required, ok, now_value, todo, go, sort)
 ORDER BY x.sort;
COMMENT ON VIEW public.v_open_readiness IS '오픈 준비 점검(D142 · v10.146 · docs/225) — required 이고 ok 가 아닌 줄은 v_open_blockers 의 READY 로 올라감. 설정 값만 읽음.';

CREATE OR REPLACE VIEW public.v_open_blockers AS
 SELECT 'SETTING'::text AS kind,
    s.key AS item,
        CASE
            WHEN s.value IS NULL OR btrim(s.value) = ''::text THEN s.description
            WHEN (EXISTS ( SELECT 1
               FROM setting_placeholders p
              WHERE s.value ~~* (('%'::text || p.token) || '%'::text))) THEN '자리표시자가 남아 있습니다 — '::text || s.value
            WHEN s.value_pattern IS NOT NULL AND s.value !~ s.value_pattern THEN '형식 오류 — 예: '::text || COALESCE(s.value_example, ''::text)
            ELSE ('길이 부족 — '::text || COALESCE(s.min_length::text, ''::text)) || '자 이상'::text
        END AS reason
   FROM site_settings s
  WHERE s.is_required_for_open AND (s.value IS NULL OR btrim(s.value) = ''::text OR (EXISTS ( SELECT 1
           FROM setting_placeholders p
          WHERE s.value ~~* (('%'::text || p.token) || '%'::text))) OR s.value_pattern IS NOT NULL AND s.value !~ s.value_pattern OR s.min_length IS NOT NULL AND length(btrim(s.value)) < s.min_length)
UNION ALL
 SELECT 'TERM'::text AS kind,
    (t.code || ' '::text) || max(t.title) AS item,
    COALESCE(max(t.blocked_by), '내용 미작성'::text) AS reason
   FROM terms t
  WHERE t.is_required
  GROUP BY t.code
 HAVING count(*) FILTER (WHERE t.status = 'PUBLISHED'::text) = 0
UNION ALL
 SELECT 'FOOTER'::text AS kind,
    v_footer_links.label AS item,
    '목적지 없음 — '::text || COALESCE(v_footer_links.tip, '미정'::text) AS reason
   FROM v_footer_links
  WHERE NOT v_footer_links.available AND v_footer_links.section = 'LEGAL'::text
UNION ALL
 SELECT 'INTEGRATION'::text AS kind,
    integrations.name AS item,
    (('연동 미완료 ('::text || integrations.status) || ') — '::text) || integrations.purpose AS reason
   FROM integrations
  WHERE integrations.blocks_open AND integrations.status <> 'LIVE'::text
UNION ALL
 SELECT 'ASSUME'::text AS kind,
    s.key AS item,
    '간주 모드 켜짐 — 실제 확인 없이 통과시킵니다. 연동을 마친 뒤 끄십시오 (' || coalesce(s.description, s.key) || ')'::text AS reason
   FROM site_settings s
  WHERE s.key LIKE 'assume.%' AND s.value = 'on'
UNION ALL
 SELECT 'READY'::text AS kind,
    r.label AS item,
    (r.now_value || ' — '::text) || r.todo AS reason
   FROM public.v_open_readiness r
  WHERE r.required AND NOT r.ok
  ORDER BY 1, 2;
COMMENT ON VIEW public.v_open_blockers IS '오픈 전에 풀어야 할 것 — 설정 · 약관 · 바닥줄 · 외부 연동 · 간주 모드(D031 · G-176) · 오픈 준비 READY(D142 · v10.146)';
