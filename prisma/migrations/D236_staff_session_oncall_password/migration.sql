-- v10.357 ~ 360 (docs/491 ~ 494) — 운영 화면 자동 로그아웃 · 급한 알림 당번 · 개인정보 열람 사유 · 운영자 비밀번호 정책
--   대표 11/18 「다음개발」 → ① 자동 로그아웃 ② 급한 알림 당번 ③ 개인정보 열람 사유 ④ 운영자 비밀번호 정책 「모두」 → 「승인 + 통과하면 병합」.
--   ① 설정 ops.admin_idle_min(30) · ops.staff_refresh_days(1) — 운영 역할만(회원은 그대로 14일)
--   ② 표 staff_oncall(요일 1 월 ~ 7 일 → 당번 운영자 · SUPER 가 정함) · ops_alerts 칸 oncall_pushed_at · escalated_at
--   ③ 칸 없음(사유는 audit.pii_access_logs.reason 에 「… · 사유 …」로)
--   ④ 표 password_history(지난 비밀번호 해시만 · 쌓기만) — 운영 역할은 최근 3개 다시 쓰기 금지
--   지우는 문장 없음 · 다시 돌려도 같음.

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('ops.admin_idle_min', '30', 'ADMIN',
   '운영 화면 자동 로그아웃(v10.357 · docs/491) — 이 분 동안 마우스 · 자판 · 누름이 없으면 1분 전 알림 뒤 로그아웃(5 ~ 240분).',
   false, '^([5-9]|[1-9][0-9]|1[0-9][0-9]|2[0-3][0-9]|240)$', '30'),
  ('ops.staff_refresh_days', '1', 'ADMIN',
   '운영 역할 로그인 유지 일수(v10.357 · docs/491) — 운영 역할이 있는 계정의 다시 받기 증표 기간(1 ~ 14일 · 회원은 14일 그대로). 바꾸면 다음 로그인부터.',
   false, '^([1-9]|1[0-4])$', '1')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.staff_oncall (
  dow        smallint PRIMARY KEY CHECK (dow BETWEEN 1 AND 7),
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.accounts(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.staff_oncall IS 'v10.358 (D236) 급한 알림 당번 — 요일(1 월 ~ 7 일 · 한국)마다 운영자 한 명 · 비면 당번 없음 · 고치기 SUPER(감사 ONCALL_SET)';
INSERT INTO public.staff_oncall (dow) SELECT g FROM generate_series(1, 7) g ON CONFLICT (dow) DO NOTHING;

ALTER TABLE public.ops_alerts ADD COLUMN IF NOT EXISTS oncall_pushed_at timestamptz;
ALTER TABLE public.ops_alerts ADD COLUMN IF NOT EXISTS escalated_at timestamptz;
COMMENT ON COLUMN public.ops_alerts.oncall_pushed_at IS 'v10.358 (D236) 급한 알림을 당번 개인 텔레그램으로 보낸 때';
COMMENT ON COLUMN public.ops_alerts.escalated_at IS 'v10.358 (D236) 30분 안에 확인이 없어 SUPER 개인 텔레그램으로 한 번 더 보낸 때';

CREATE TABLE IF NOT EXISTS public.password_history (
  id            bigserial PRIMARY KEY,
  account_id    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  replaced_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_password_history_account ON public.password_history (account_id, replaced_at DESC);
COMMENT ON TABLE public.password_history IS 'v10.360 (D236) 지난 비밀번호 해시(bcrypt)만 — 운영 역할은 최근 3개 다시 쓰기 금지 · 바꿀 때 옛 해시를 한 줄 · 고치기 막음(지우기는 계정 지울 때만)';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_password_history_ro' AND tgrelid = 'public.password_history'::regclass) THEN
    CREATE TRIGGER trg_password_history_ro BEFORE UPDATE ON public.password_history FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;
