-- =====================================================================
-- D169 (v10.180 · docs/281) — 운영자 2단계 인증 · 운영자 권한 정기 점검
--
--   ① account_mfa — 휴대폰 인증 앱(TOTP · RFC 6238) 비밀값(암호화 · fn_enc_key) · 예비 번호(해시 · 한 번씩) · 마지막 쓴 번호 칸(같은 번호 다시 못 씀) · 틀린 횟수 · 잠금
--   ② audit.role_reviews — 운영자 권한 분기 점검 기록(분기에 한 줄 · 고칠 수 없음)
--   ③ 설정 admin.mfa_required off(off · SUPER · ALL — SUPER 만 바꿈) · admin.mfa_hours 12 · ops.role_idle_days 90
--
--   켜기 전(off)에는 아무것도 바뀌지 않습니다. 지우는 문장 없음.
-- =====================================================================

-- 1. 운영자 2단계 인증 -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_mfa (
  account_id    uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  secret_enc    bytea NOT NULL,
  enabled_at    timestamptz,
  last_step     bigint NOT NULL DEFAULT 0,
  backup_hashes text[] NOT NULL DEFAULT '{}'::text[],
  fails         int NOT NULL DEFAULT 0 CHECK (fails >= 0),
  locked_until  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(backup_hashes) <= 10)
);
COMMENT ON TABLE public.account_mfa IS
  '운영자 2단계 인증(D169 · v10.180). secret_enc = 인증 앱 비밀값(pgp_sym_encrypt · fn_enc_key) · enabled_at 이 NULL 이면 등록 중 · last_step = 마지막으로 받은 30초 칸(같은 번호 다시 못 씀) · backup_hashes = 예비 번호 sha256(쓰면 빠짐) · 5번 틀리면 15분 잠금. 지우면 등록이 풀림(SUPER 초기화 · 서버 비상 초기화 mfa-reset.sh).';

-- 2. 운영자 권한 분기 점검 --------------------------------------------------
CREATE TABLE IF NOT EXISTS audit.role_reviews (
  quarter      date PRIMARY KEY CHECK (quarter = date_trunc('quarter', quarter)::date),
  reviewed_by  uuid NOT NULL REFERENCES public.accounts(id),
  reviewed_at  timestamptz NOT NULL DEFAULT now(),
  note         text NOT NULL CHECK (length(btrim(note)) BETWEEN 5 AND 1000),
  summary      jsonb NOT NULL DEFAULT '{}'::jsonb
);
COMMENT ON TABLE audit.role_reviews IS
  '운영자 권한 분기 점검(D169 · v10.180). 분기에 한 줄 — 누가 언제 점검했고 그때 운영자 · 역할 · 오래 안 쓴 계정 · 2단계 등록이 어땠는지(요약) · 메모. 고치거나 지울 수 없습니다.';
DROP TRIGGER IF EXISTS trg_role_reviews_ro ON audit.role_reviews;
CREATE TRIGGER trg_role_reviews_ro BEFORE DELETE OR UPDATE ON audit.role_reviews
  FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();

-- 3. 설정 --------------------------------------------------------------
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('admin.mfa_required', 'off', 'ADMIN',
   '운영자 2단계 인증(v10.180 · docs/281) — off: 쓰지 않음 · SUPER: 최고 관리자만 · ALL: 운영 역할(검수 · 운영 · 지급 · 최고) 모두. 켜면 운영 API 를 쓰기 전에 인증 앱 6자리 번호를 넣어야 함. SUPER 만 바꾸고, 바꾸는 사람이 먼저 등록해야 켜짐.',
   false, '^(off|SUPER|ALL)$', 'off'),
  ('admin.mfa_hours', '12', 'ADMIN',
   '운영자 2단계 인증(v10.180) — 번호를 한 번 넣으면 이 시간 동안 다시 묻지 않음(1 ~ 24).',
   false, '^([1-9]|1[0-9]|2[0-4])$', '12'),
  ('ops.role_idle_days', '90', 'ADMIN',
   '운영자 권한 점검(v10.180) — 이 날수 넘게 로그인하지 않은 운영 계정을 「정지 권함」으로 표시(자동 정지는 하지 않음).',
   false, '^[1-9][0-9]{0,3}$', '90')
ON CONFLICT (key) DO NOTHING;
