-- v10.377 ~ 380 (docs/513 ~ 516) — 설정 예약 변경 · 탈퇴 유예 끝 전날 메일 · 점검 예정 회원 알림 · 내 로그인 기기
--   대표 11/18 「다음개발」 → ① 설정 예약 변경 ② 탈퇴 유예 끝 전날 알림 ③ 점검 예정 회원 알림 ④ 내 로그인 기기 목록 「모두」 → 「승인 + 통과하면 병합」.
--   ① setting_schedules — 키 · 값 · 시각 · 사유(SUPER) → 정기 작업 setting_schedule(5분마다)이 그 시각에 운영 화면과 같은 검사로 바꿈 · 쌓기만(취소 · 결과 칸만 한 번)
--   ② account_withdrawals.grace_mailed_at — 유예 끝 하루 전 메일을 보낸 때(정기 작업 withdraw_grace_mail · 매시간)
--   ③ maintenance_notices — 점검 시작 24시간 전 회원 알림을 보낸 기록(점검 시작 시각마다 한 번 · 정기 작업 maint_notice · 10분마다) · 설정 site.maintenance_mail(처음 off)
--   ④ login_sessions — 로그인 한 번 = 한 줄(기기 · 시각 · 가린 IP) · 증표에 sid · 기기별 로그아웃은 revoked_at
--   지우는 문장 없음 · 다시 돌려도 같음.

/* ── ① 설정 예약 변경 ── */
CREATE TABLE IF NOT EXISTS public.setting_schedules (
  id            bigserial PRIMARY KEY,
  setting_key   text NOT NULL REFERENCES public.site_settings(key),
  value         text NOT NULL CHECK (char_length(value) <= 2000),
  run_at        timestamptz NOT NULL,
  reason        text NOT NULL CHECK (char_length(reason) BETWEEN 2 AND 200),
  created_by    uuid REFERENCES public.accounts(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  canceled_at   timestamptz,
  canceled_by   uuid REFERENCES public.accounts(id),
  cancel_reason text CHECK (cancel_reason IS NULL OR char_length(cancel_reason) BETWEEN 2 AND 200),
  done_at       timestamptz,
  result        text CHECK (result IS NULL OR result IN ('APPLIED', 'FAILED')),
  result_note   text CHECK (result_note IS NULL OR char_length(result_note) <= 400),
  CONSTRAINT ck_setting_schedules_cancel CHECK ((canceled_at IS NULL) = (cancel_reason IS NULL)),
  CONSTRAINT ck_setting_schedules_done CHECK ((done_at IS NULL) = (result IS NULL)),
  CONSTRAINT ck_setting_schedules_one CHECK (canceled_at IS NULL OR done_at IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_setting_schedules_open ON public.setting_schedules (setting_key) WHERE canceled_at IS NULL AND done_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_setting_schedules_due ON public.setting_schedules (run_at) WHERE canceled_at IS NULL AND done_at IS NULL;
COMMENT ON TABLE public.setting_schedules IS 'v10.377 (D241) 설정 예약 변경 — 그 시각에 정기 작업 setting_schedule 이 운영 화면 「전체 설정」과 같은 검사로 바꿈(예약한 SUPER 이름으로 · 바뀐 기록 · 운영 알림 그대로) · 키마다 기다리는 예약 하나 · 쌓기만(취소 · 결과는 한 번)';

CREATE OR REPLACE FUNCTION public.fn_setting_schedules_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'SETTING_SCHEDULE: 설정 예약 기록은 지우지 않습니다.'; END IF;
  IF OLD.canceled_at IS NOT NULL OR OLD.done_at IS NOT NULL
     OR (NEW.setting_key, NEW.value, NEW.run_at, NEW.reason, NEW.created_by, NEW.created_at)
        IS DISTINCT FROM (OLD.setting_key, OLD.value, OLD.run_at, OLD.reason, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'SETTING_SCHEDULE: 설정 예약은 취소 또는 결과(한 번)만 기록합니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_setting_schedules_guard' AND tgrelid = 'public.setting_schedules'::regclass) THEN
    CREATE TRIGGER trg_setting_schedules_guard BEFORE UPDATE OR DELETE ON public.setting_schedules FOR EACH ROW EXECUTE FUNCTION public.fn_setting_schedules_guard();
  END IF;
END $$;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('setting_schedule', 5, NULL, NULL, NULL, true, '설정 예약 변경 — 시각이 된 예약을 운영 화면과 같은 검사로 바꿈 · 실패하면 운영 알림 SETTING_SCHEDULE_FAIL · D241 · v10.377')
ON CONFLICT (job) DO NOTHING;

/* ── ② 탈퇴 유예 끝 전날 메일 ── */
ALTER TABLE public.account_withdrawals ADD COLUMN IF NOT EXISTS grace_mailed_at timestamptz;
COMMENT ON COLUMN public.account_withdrawals.grace_mailed_at IS 'v10.378 (D241) 탈퇴 유예 끝 하루 전 「내일 파기 · 오늘까지 취소 가능」 메일을 보낸 때(한 번 · 다시 탈퇴하면 비움)';

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('withdraw_grace_mail', 60, NULL, NULL, NULL, true, '탈퇴 유예 끝 하루 전 메일 — 유예 중 · 취소 안 함 · 아직 안 보낸 회원에게 한 번(member.withdraw_grace_days 2일 이상일 때) · D241 · v10.378')
ON CONFLICT (job) DO NOTHING;

/* 다시 탈퇴하면 메일 표시도 비움 — 나머지는 D240 그대로 */
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
                                         created_at = now(), canceled_at = NULL, grace_mailed_at = NULL;
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

/* ── ③ 점검 예정 회원 알림 ── */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('site.maintenance_mail', 'off', 'ADMIN',
   '점검 예정 회원 알림 메일(v10.379 · docs/515) — on 이면 시작 24시간 전 사이트 알림과 함께 메일도(회원이 끈 사람 · 반송 주소 빼고). off 면 사이트 알림만. 문자는 보내지 않음.',
   false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis, tone) VALUES
  ('SITE_MAINTENANCE', '사이트 점검 안내', true, false, '안내 — 서비스를 잠시 쓸 수 없는 시각', 'warn')
ON CONFLICT (event_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.maintenance_notices (
  id         bigserial PRIMARY KEY,
  from_at    timestamptz NOT NULL UNIQUE,
  until_at   timestamptz NOT NULL,
  sent       integer NOT NULL CHECK (sent >= 0),
  mailed     boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.maintenance_notices IS 'v10.379 (D241) 점검 예정 회원 알림 — 점검 시작 시각마다 한 번(받은 회원 수 · 메일 함께였는지) · 쌓기만';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_maintenance_notices_ro' AND tgrelid = 'public.maintenance_notices'::regclass) THEN
    CREATE TRIGGER trg_maintenance_notices_ro BEFORE UPDATE OR DELETE ON public.maintenance_notices FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('maint_notice', 10, NULL, NULL, NULL, true, '점검 예정 회원 알림 — 점검 시작 24시간 안이 되면 쓰는 회원 모두에게 사이트 알림 한 번(site.maintenance_mail on 이면 메일도) · D241 · v10.379')
ON CONFLICT (job) DO NOTHING;

/* ── ④ 내 로그인 기기 ── */
CREATE TABLE IF NOT EXISTS public.login_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES public.accounts(id),
  tv             integer NOT NULL,
  ip_masked      text,
  ua_kind        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  revoked_reason text CHECK (revoked_reason IS NULL OR char_length(revoked_reason) <= 100),
  CONSTRAINT ck_login_sessions_revoked CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_login_sessions_account ON public.login_sessions (account_id, last_seen_at DESC);
COMMENT ON TABLE public.login_sessions IS 'v10.380 (D241) 내 로그인 기기 — 로그인 한 번 = 한 줄 · 증표(access · refresh)에 sid · 기기별 로그아웃은 revoked_at(그 sid 증표는 바로 무효) · IP 앞 두 마디 · 브라우저 종류만 · 보관 날수 · 회원 파기 때 fn_purge_auth_records 가 지움';

/* 파기 — D170 그대로에 로그인 기기 줄을 더함(보관 날수가 지났거나 파기된 계정) */
CREATE OR REPLACE FUNCTION public.fn_purge_auth_records() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int; m int; h int; p int; s int; days int;
BEGIN
  DELETE FROM password_reset_tokens WHERE created_at < now() - interval '7 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM auth_throttle WHERE last_at < now() - interval '2 days' AND (locked_until IS NULL OR locked_until < now());
  GET DIAGNOSTICS m = ROW_COUNT;
  -- v10.181 (D170) — 로그인 기록 보관 기간 · 파기된 계정
  days := greatest(fn_setting_int('privacy.login_history_days', 180), 1);
  DELETE FROM login_history lh
   WHERE lh.at < now() - make_interval(days => days)
      OR EXISTS (SELECT 1 FROM accounts a WHERE a.id = lh.account_id AND a.purged_at IS NOT NULL);
  GET DIAGNOSTICS h = ROW_COUNT;
  UPDATE privacy_requests pr SET body_enc = NULL
    FROM accounts a
   WHERE a.id = pr.account_id AND a.purged_at IS NOT NULL AND pr.body_enc IS NOT NULL
     AND pr.status IN ('DONE','REJECTED');
  GET DIAGNOSTICS p = ROW_COUNT;
  -- v10.380 (D241) — 로그인 기기 줄(마지막으로 쓴 지 보관 날수 · 파기된 계정)
  DELETE FROM login_sessions ls
   WHERE ls.last_seen_at < now() - make_interval(days => days)
      OR EXISTS (SELECT 1 FROM accounts a WHERE a.id = ls.account_id AND a.purged_at IS NOT NULL);
  GET DIAGNOSTICS s = ROW_COUNT;
  RETURN n + m + h + p + s;
END $$;
