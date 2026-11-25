-- =====================================================================
-- D333 (v10.799 · v10.800 · docs/915 · 916) ERP 연결 — 서비스 토큰 · 로그인 넘겨주기 코드
--
--   대표 11/25 ERP 분리 · E1 계획 승인(로그인은 짧은 교환 코드 · 비밀 키 공유 없음).
--   ① 설정 erp.service_token_hash — ERP 서버가 소개뱅크 내부 길(introspect · /internal/erp/*)을 부를 때 내는 토큰의 sha256(토큰 원문은 저장 안 함)
--      처음 비움(NULL) = 닫힘 · 만들기 · 바꾸기는 SUPER(POST /admin/erp/service-token · 한 번만 보여 줌)
--   ② erp_handoff_codes — 운영 화면 「ERP 열기」 때 만드는 60초 · 한 번만 쓰는 코드(해시만 저장 · v10.800)
--   다시 돌려도 같음 · RAISE 없음
-- =====================================================================

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('erp.service_token_hash', NULL, 'SUPER', 'ERP 서비스 토큰 sha256(v10.799 · docs/915) — ERP 서버가 introspect · /internal/erp/* 를 부를 때 낸 토큰과 맞춰 봄 · 비우면 닫힘 · 만들기는 외부 연동 관리 › ERP 연동(SUPER · 원문은 한 번만 보임)', false, '^[0-9a-f]{64}$', '0000000000000000000000000000000000000000000000000000000000000000')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.erp_handoff_codes (
  code_hash    text PRIMARY KEY CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  account_id   uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  session_id   text CHECK (session_id IS NULL OR char_length(session_id) <= 80),
  mfa_at       bigint CHECK (mfa_at IS NULL OR mfa_at > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes')
);
CREATE INDEX IF NOT EXISTS erp_handoff_codes_exp ON public.erp_handoff_codes (expires_at);
COMMENT ON TABLE public.erp_handoff_codes IS 'v10.800 (D333 · docs/916) 운영 화면 → ERP 로그인 넘겨주기 코드 — 60초 · 한 번 · 해시만(원문은 주소에만 잠깐)';

-- ── 주소 표(외부 연동 관리 업무) — ERP 연동 상태 보기 · 서비스 토큰 만들기(SUPER 는 컨트롤러 @Roles) ──
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/erp/link', 'integrations', 'VIEW'),
  ('POST', '/admin/erp/service-token', 'integrations', 'APPROVE'),
  ('POST', '/admin/erp/handoff', 'integrations', 'VIEW')
ON CONFLICT (method, pattern, task_key) DO NOTHING;
