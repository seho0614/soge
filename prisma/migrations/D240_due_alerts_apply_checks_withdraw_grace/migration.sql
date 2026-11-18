-- v10.373 ~ 376 (docs/508 ~ 511) — 분쟁 · 정산 처리 기한 · 운영 적용 확인표 · (알림 주간 통계는 칸 없음) · 회원 탈퇴 유예 · 철회
--   대표 11/18 「다음개발」 → ① 분쟁 · 정산 처리 기한 ② 운영 적용 확인표 ③ 운영 알림 주간 통계 ④ 회원 탈퇴 유예 · 철회 「모두」 → 「승인 + 통과하면 병합」.
--   ① 설정 ops.dispute_due_days(3) · ops.settle_due_days(2)
--   ② ops_apply_checks(판 · 번호 · 항목) · ops_apply_marks(맞음 · 다름 · 메모 · 누가 · 언제) — 둘 다 쌓기만(항목은 판마다 한 번 · 다시 표시하면 새 줄)
--   ④ 설정 member.withdraw_grace_days(0 = 꺼짐 · 0 ~ 30) · account_withdrawals.canceled_at · 탈퇴 함수 · 보관 기한 트리거가 유예 날 수를 셈
--      0 이면 지금과 같음(거래 없으면 탈퇴한 날 파기 대상 · 거래 있으면 5년)
--   지우는 문장 없음 · 다시 돌려도 같음.

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('ops.dispute_due_days', '3', 'ADMIN',
   '분쟁 처리 기한(v10.373 · docs/508) — 열린 분쟁(열림 · 검토 중)이 이 날 수를 넘으면 운영 알림 DISPUTE_OVERDUE · 「오늘 할 일」 기한 넘김(1 ~ 30일).',
   false, '^([1-9]|[12][0-9]|30)$', '3'),
  ('ops.settle_due_days', '2', 'ADMIN',
   '정산 승인 기한(v10.373 · docs/508) — 정산 승인 대기가 이 날 수를 넘으면 운영 알림 SETTLE_OVERDUE · 「오늘 할 일」 기한 넘김(1 ~ 30일).',
   false, '^([1-9]|[12][0-9]|30)$', '2'),
  ('member.withdraw_grace_days', '0', 'ADMIN',
   '회원 탈퇴 유예(v10.376 · docs/511) — 탈퇴 뒤 이 날 수 동안 파기를 미루고 다시 로그인하면 「탈퇴 취소」. 0 = 꺼짐(탈퇴 즉시 파기 대상 · 지금 처리방침 그대로). 켜기 전 처리방침 · 약관 문구를 고칠 것(0 ~ 30일).',
   false, '^([0-9]|[12][0-9]|30)$', '7')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ops_apply_checks (
  id         bigserial PRIMARY KEY,
  version    text NOT NULL CHECK (version ~ '^v[0-9]+\.[0-9]+$'),
  item_no    integer NOT NULL CHECK (item_no BETWEEN 1 AND 60),
  item       text NOT NULL CHECK (char_length(item) BETWEEN 2 AND 400),
  created_by uuid REFERENCES public.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version, item_no)
);
COMMENT ON TABLE public.ops_apply_checks IS 'v10.374 (D240) 운영 적용 확인표 항목 — 판마다 절차서 4-1 화면 확인 줄(SUPER 가 붙여 넣음) · 쌓기만';
CREATE TABLE IF NOT EXISTS public.ops_apply_marks (
  id         bigserial PRIMARY KEY,
  check_id   bigint NOT NULL REFERENCES public.ops_apply_checks(id),
  result     text NOT NULL CHECK (result IN ('OK', 'NG')),
  memo       text CHECK (memo IS NULL OR char_length(memo) <= 300),
  marked_by  uuid REFERENCES public.accounts(id),
  marked_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ops_apply_marks_check ON public.ops_apply_marks (check_id, marked_at DESC);
COMMENT ON TABLE public.ops_apply_marks IS 'v10.374 (D240) 운영 적용 확인표 표시 — 맞음(OK) · 다름(NG) · 메모 · 가장 최근 줄이 지금 상태 · 쌓기만';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ops_apply_checks_ro' AND tgrelid = 'public.ops_apply_checks'::regclass) THEN
    CREATE TRIGGER trg_ops_apply_checks_ro BEFORE UPDATE OR DELETE ON public.ops_apply_checks FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ops_apply_marks_ro' AND tgrelid = 'public.ops_apply_marks'::regclass) THEN
    CREATE TRIGGER trg_ops_apply_marks_ro BEFORE UPDATE OR DELETE ON public.ops_apply_marks FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

ALTER TABLE public.account_withdrawals ADD COLUMN IF NOT EXISTS canceled_at timestamptz;
COMMENT ON COLUMN public.account_withdrawals.canceled_at IS 'v10.376 (D240) 탈퇴 유예 중 회원이 「탈퇴 취소」한 때 — 다시 탈퇴하면 비우고 새 사유 · 때로 고침';

/* ④ 보관 기한 — 거래 없는 탈퇴도 유예 날 수만큼 미룸(0 이면 전과 같음) */
CREATE OR REPLACE FUNCTION public.fn_set_retention_on_withdraw() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE has_deal boolean;
BEGIN
  IF NEW.withdrawn_at IS NOT NULL AND OLD.withdrawn_at IS NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM deals d
       WHERE NEW.id IN (d.buyer_account_id, d.seller_account_id, d.introducer_account_id)
    ) INTO has_deal;

    NEW.retention_until := CASE
      WHEN has_deal THEN (NEW.withdrawn_at + interval '5 years')::date
      ELSE (NEW.withdrawn_at + make_interval(days => fn_setting_int('member.withdraw_grace_days', 0)))::date
    END;
    NEW.status := 'WITHDRAWN';
  END IF;
  RETURN NEW;
END $$;

/* ④ 탈퇴 함수 — 취소한 뒤 다시 탈퇴할 수 있게(같은 회원 한 줄을 새 사유로) · 나머지는 D102 그대로 */
CREATE OR REPLACE FUNCTION public.fn_account_withdraw(p_account uuid, p_reason text, p_memo text)
RETURNS date
LANGUAGE plpgsql AS $$
DECLARE b text; hd boolean; ru date;
BEGIN
  PERFORM 1 FROM accounts WHERE id = p_account AND status = 'ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WITHDRAW_NOT_ACTIVE: 탈퇴할 수 없는 계정입니다'; END IF;
  SELECT string_agg(label, ' · ') INTO b FROM fn_withdraw_blockers(p_account);
  IF b IS NOT NULL THEN RAISE EXCEPTION 'WITHDRAW_BLOCKED: %', b; END IF;
  SELECT EXISTS (SELECT 1 FROM deals d WHERE p_account IN (d.buyer_account_id, d.seller_account_id, d.introducer_account_id)) INTO hd;
  INSERT INTO account_withdrawals (account_id, reason_code, memo, had_deal)
  VALUES (p_account, p_reason, nullif(btrim(coalesce(p_memo, '')), ''), hd)
  ON CONFLICT (account_id) DO UPDATE SET reason_code = EXCLUDED.reason_code, memo = EXCLUDED.memo, had_deal = EXCLUDED.had_deal,
                                         created_at = now(), canceled_at = NULL;
  UPDATE subscriptions SET cancel_at = coalesce(cancel_at, clock_timestamp())
   WHERE account_id = p_account AND status IN ('ACTIVE','PAST_DUE');
  UPDATE billing_keys SET status = 'REVOKED', revoked_at = now()
   WHERE account_id = p_account AND status = 'ACTIVE';
  UPDATE password_reset_tokens SET revoked_at = now()
   WHERE account_id = p_account AND used_at IS NULL AND revoked_at IS NULL;
  UPDATE accounts SET withdrawn_at = now(), token_version = token_version + 1
   WHERE id = p_account
  RETURNING retention_until INTO ru;
  RETURN ru;
END $$;
