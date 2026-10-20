-- =====================================================================
-- D102 — v10.48 (2026-10-20 · 회원 탈퇴 · 비밀번호 재설정 · 로그인 잠금 · 요청 횟수 제한 · 대표 승인)
--
--   요구사항 정의서(docs/99) 11절에서 찾은 「오픈 전 필수인데 없는 것」 3건입니다.
--     ① 로그인 잠금      같은 이메일로 5회 연속 실패 → 30분 잠금(자동 해제 · 재설정 · 운영 해제)
--        요청 횟수 제한   같은 IP 의 **실패한** 로그인 1분 5회 · 재설정 메일 요청 같은 이메일 · 같은 IP 1시간 5회
--                         (성공한 로그인은 세지 않습니다 — 사무실처럼 IP 하나를 여럿이 쓰는 곳 · 자동 검정이 막히지 않게)
--     ② 비밀번호 재설정   가입 메일로 30분짜리 1회용 링크 · 증표는 해시로만 저장 · 바꾸면 그동안의 로그인 증표 무효
--     ③ 회원 탈퇴         진행 중인 거래 · 정산 · 주문 · 환불 · 리드캐시 잔액이 있으면 막음(이용약관 제13조 ②)
--
--   판정 규칙은 DB 한 곳(함수 · 트리거)에 둡니다 — API 를 거치지 않는 경로에도 같은 규칙이 걸리게.
--   이메일 · IP 원문은 저장하지 않습니다 — 이메일은 sha256(소문자), IP 는 앱이 날짜를 섞은 HMAC 으로 넘깁니다.
--   기존 자료를 지우지 않습니다. 재실행 안전.
-- =====================================================================

/* ── 0. 계정 — 로그인 증표 판 번호 ───────────────────────────────────── */
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;
COMMENT ON COLUMN public.accounts.token_version IS
  'v10.48 (D102) — 로그인 증표(JWT)의 판 번호. 비밀번호 변경 · 재설정 · 탈퇴 때 1 올리면 그 전에 발급된 증표가 모두 무효가 됩니다(다른 기기의 로그인도 끊김). 증표에 판 번호가 없으면 0 으로 봅니다.';
COMMENT ON COLUMN public.accounts.password_changed_at IS 'v10.48 (D102) — 비밀번호를 마지막으로 바꾼 시각(변경 · 재설정).';

/* ── 1. 설정값 ─────────────────────────────────────────────────────── */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
 ('auth.login.max_fail', '5', 'GLOBAL',
  '로그인 잠금 — 같은 이메일로 이 횟수만큼 연속으로 틀리면 잠급니다(v10.48 · D102). 성공하면 0 부터 다시 셉니다.',
  false, '^([3-9]|1[0-9]|20)$', '5'),
 ('auth.login.lock_minutes', '30', 'GLOBAL',
  '로그인 잠금 시간(분). 지나면 저절로 풀립니다. 비밀번호를 재설정하거나 운영 화면 › 회원 상세에서 풀면 바로 풀립니다(v10.48 · D102).',
  false, '^([5-9]|[1-9][0-9]|1[0-7][0-9]|180)$', '30'),
 ('auth.login.ip_fail_per_min', '5', 'GLOBAL',
  '같은 IP 에서 1분에 받는 **실패한** 로그인 수. 넘으면 1분이 지날 때까지 그 IP 의 로그인을 받지 않습니다(429). 성공한 로그인은 세지 않습니다(v10.48 · D102).',
  false, '^([3-9]|[1-9][0-9]|100)$', '5'),
 ('auth.reset.per_hour', '5', 'GLOBAL',
  '비밀번호 재설정 메일 요청 — 같은 이메일 · 같은 IP 각각 1시간에 이 횟수까지(v10.48 · D102).',
  false, '^([1-9]|1[0-9]|20)$', '5'),
 ('auth.reset.ttl_minutes', '30', 'GLOBAL',
  '비밀번호 재설정 링크 유효 시간(분). 한 번 쓰면 끝납니다. 새로 요청하면 그 전 링크는 무효입니다(v10.48 · D102).',
  false, '^([1-5][0-9]|60)$', '30')
ON CONFLICT (key) DO NOTHING;

/* ── 2. 로그인 · 재설정 요청 횟수 기록 ─────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.auth_throttle (
  key_kind     text        NOT NULL,
  key_hash     text        NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now(),
  hits         integer     NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_auth_throttle PRIMARY KEY (key_kind, key_hash),
  CONSTRAINT ck_auth_throttle_kind CHECK (key_kind IN ('LOGIN_EMAIL','LOGIN_IP','RESET_EMAIL','RESET_IP')),
  CONSTRAINT ck_auth_throttle_hash CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_auth_throttle_hits CHECK (hits >= 0),
  CONSTRAINT ck_auth_throttle_lock CHECK (locked_until IS NULL OR (key_kind = 'LOGIN_EMAIL' AND locked_until <= last_at + interval '3 hours'))
);
CREATE INDEX IF NOT EXISTS idx_auth_throttle_last ON public.auth_throttle (last_at);
COMMENT ON TABLE public.auth_throttle IS
  'v10.48 (D102) — 로그인 실패 · 재설정 요청 횟수. 이메일은 sha256(소문자) · IP 는 날짜를 섞은 HMAC — 원문은 저장하지 않습니다. LOGIN_EMAIL 만 잠금(locked_until)을 가집니다. 2일 지난 줄은 다음 기록 때 지웁니다.';

/* 이메일 키 — 소문자 · 앞뒤 공백 제거 뒤 sha256. 계정이 없는 이메일도 같은 방식으로 셉니다(계정 유무가 드러나지 않게) */
CREATE OR REPLACE FUNCTION public.fn_auth_email_key(p_email text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(digest(lower(btrim(coalesce(p_email, ''))), 'sha256'), 'hex')
$$;

/* 로그인 전에 묻기 — 막혔으면 사유(LOCKED · TOO_MANY)와 남은 초 */
CREATE OR REPLACE FUNCTION public.fn_login_gate(p_email text, p_ip_hash text)
RETURNS TABLE (blocked text, retry_after_sec integer)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE r record; ipmax int := fn_setting_int('auth.login.ip_fail_per_min', 5);
BEGIN
  SELECT locked_until INTO r FROM auth_throttle
   WHERE key_kind = 'LOGIN_EMAIL' AND key_hash = fn_auth_email_key(p_email);
  IF r.locked_until IS NOT NULL AND r.locked_until > now() THEN
    RETURN QUERY SELECT 'LOCKED'::text, ceil(extract(epoch FROM r.locked_until - now()))::int; RETURN;
  END IF;
  IF p_ip_hash IS NOT NULL THEN
    SELECT window_start, hits INTO r FROM auth_throttle WHERE key_kind = 'LOGIN_IP' AND key_hash = p_ip_hash;
    IF r.window_start IS NOT NULL AND r.window_start > now() - interval '1 minute' AND r.hits >= ipmax THEN
      RETURN QUERY SELECT 'TOO_MANY'::text, greatest(1, ceil(extract(epoch FROM r.window_start + interval '1 minute' - now())))::int; RETURN;
    END IF;
  END IF;
  RETURN QUERY SELECT NULL::text, 0;
END $$;

/* 로그인 실패 한 번 — 이메일 연속 실패 수 +1(다 차면 잠금) · IP 1분 창 +1. 잠겼으면 lockedUntil 을 돌려줍니다 */
CREATE OR REPLACE FUNCTION public.fn_login_fail(p_email text, p_ip_hash text)
RETURNS TABLE (fails integer, locked_until timestamptz)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE k text := fn_auth_email_key(p_email);
        maxf int := fn_setting_int('auth.login.max_fail', 5);
        lockm int := fn_setting_int('auth.login.lock_minutes', 30);
        f int; lu timestamptz;
BEGIN
  DELETE FROM auth_throttle WHERE last_at < now() - interval '2 days';
  INSERT INTO auth_throttle AS t (key_kind, key_hash, hits, last_at)
  VALUES ('LOGIN_EMAIL', k, 1, now())
  ON CONFLICT (key_kind, key_hash) DO UPDATE
     SET hits = CASE WHEN t.locked_until IS NOT NULL AND t.locked_until <= now() THEN 1 ELSE t.hits + 1 END,
         locked_until = CASE WHEN t.locked_until IS NOT NULL AND t.locked_until <= now() THEN NULL ELSE t.locked_until END,
         last_at = now()
  RETURNING t.hits INTO f;
  IF f >= maxf THEN
    UPDATE auth_throttle SET locked_until = now() + make_interval(mins => lockm), hits = 0
     WHERE key_kind = 'LOGIN_EMAIL' AND key_hash = k
    RETURNING auth_throttle.locked_until INTO lu;
  END IF;
  IF p_ip_hash IS NOT NULL THEN
    INSERT INTO auth_throttle AS t (key_kind, key_hash, window_start, hits, last_at)
    VALUES ('LOGIN_IP', p_ip_hash, now(), 1, now())
    ON CONFLICT (key_kind, key_hash) DO UPDATE
       SET window_start = CASE WHEN t.window_start <= now() - interval '1 minute' THEN now() ELSE t.window_start END,
           hits = CASE WHEN t.window_start <= now() - interval '1 minute' THEN 1 ELSE t.hits + 1 END,
           last_at = now();
  END IF;
  RETURN QUERY SELECT coalesce(f, 0), lu;
END $$;

/* 로그인 성공 · 비밀번호 재설정 · 운영 해제 — 그 이메일의 실패 수와 잠금을 지웁니다 */
CREATE OR REPLACE FUNCTION public.fn_login_clear(p_email text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  DELETE FROM auth_throttle WHERE key_kind = 'LOGIN_EMAIL' AND key_hash = fn_auth_email_key(p_email);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

/* 재설정 메일 요청 한 번 — 같은 이메일 · 같은 IP 각각 1시간 창. 넘었으면 false (세지 않음) */
CREATE OR REPLACE FUNCTION public.fn_reset_request_allowed(p_email text, p_ip_hash text) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE lim int := fn_setting_int('auth.reset.per_hour', 5); k text := fn_auth_email_key(p_email); r record;
BEGIN
  FOR r IN SELECT kind, h FROM (VALUES ('RESET_EMAIL', k), ('RESET_IP', p_ip_hash)) v(kind, h) WHERE h IS NOT NULL LOOP
    IF EXISTS (SELECT 1 FROM auth_throttle WHERE key_kind = r.kind AND key_hash = r.h
                  AND window_start > now() - interval '1 hour' AND hits >= lim) THEN
      RETURN false;
    END IF;
  END LOOP;
  FOR r IN SELECT kind, h FROM (VALUES ('RESET_EMAIL', k), ('RESET_IP', p_ip_hash)) v(kind, h) WHERE h IS NOT NULL LOOP
    INSERT INTO auth_throttle AS t (key_kind, key_hash, window_start, hits, last_at)
    VALUES (r.kind, r.h, now(), 1, now())
    ON CONFLICT (key_kind, key_hash) DO UPDATE
       SET window_start = CASE WHEN t.window_start <= now() - interval '1 hour' THEN now() ELSE t.window_start END,
           hits = CASE WHEN t.window_start <= now() - interval '1 hour' THEN 1 ELSE t.hits + 1 END,
           last_at = now();
  END LOOP;
  RETURN true;
END $$;

/* ── 3. 비밀번호 재설정 증표 ───────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid        NOT NULL REFERENCES public.accounts(id),
  token_hash  text        NOT NULL,
  ip_hash     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  revoked_at  timestamptz,
  CONSTRAINT uq_password_reset_token UNIQUE (token_hash),
  CONSTRAINT ck_prt_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_prt_ip CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_prt_ttl CHECK (expires_at > created_at AND expires_at <= created_at + interval '1 hour'),
  CONSTRAINT ck_prt_once CHECK (used_at IS NULL OR revoked_at IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_prt_account ON public.password_reset_tokens (account_id, created_at DESC);
COMMENT ON TABLE public.password_reset_tokens IS
  'v10.48 (D102) — 비밀번호 재설정 링크. 링크의 증표 원문은 메일에만 있고 여기에는 sha256 만 둡니다. 한 번 쓰면 used_at · 새로 요청하면 그 전 것은 revoked_at. 7일 지난 줄은 개인정보 파기 배치가 지웁니다.';

/* 새 증표 — 같은 계정의 쓰지 않은 증표는 무효로 하고 한 줄 넣습니다 */
CREATE OR REPLACE FUNCTION public.fn_password_reset_issue(p_account uuid, p_token_hash text, p_ip_hash text)
RETURNS timestamptz
LANGUAGE plpgsql AS $$
DECLARE ttl int := fn_setting_int('auth.reset.ttl_minutes', 30); e timestamptz;
BEGIN
  UPDATE password_reset_tokens SET revoked_at = now()
   WHERE account_id = p_account AND used_at IS NULL AND revoked_at IS NULL;
  INSERT INTO password_reset_tokens (account_id, token_hash, ip_hash, expires_at)
  VALUES (p_account, p_token_hash, p_ip_hash, now() + make_interval(mins => least(ttl, 60)))
  RETURNING expires_at INTO e;
  RETURN e;
END $$;

/* 증표 쓰기 — 살아 있는 증표면 쓴 것으로 표시하고 계정 id 를 돌려줍니다(없으면 NULL). 한 문장이라 두 번 쓸 수 없습니다 */
CREATE OR REPLACE FUNCTION public.fn_password_reset_consume(p_token_hash text) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE a uuid;
BEGIN
  UPDATE password_reset_tokens t SET used_at = now()
    FROM accounts ac
   WHERE t.token_hash = p_token_hash AND t.used_at IS NULL AND t.revoked_at IS NULL
     AND t.expires_at > now() AND ac.id = t.account_id AND ac.status = 'ACTIVE'
  RETURNING t.account_id INTO a;
  RETURN a;
END $$;

/* 증표 · 오래된 횟수 기록 파기 — 기존 개인정보 파기 배치(pii_purge)가 함께 부릅니다(fn_purge_accounts 뒤) */
CREATE OR REPLACE FUNCTION public.fn_purge_auth_records() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int; m int;
BEGIN
  DELETE FROM password_reset_tokens WHERE created_at < now() - interval '7 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM auth_throttle WHERE last_at < now() - interval '2 days' AND (locked_until IS NULL OR locked_until < now());
  GET DIAGNOSTICS m = ROW_COUNT;
  RETURN n + m;
END $$;

/* ── 4. 회원 탈퇴 ─────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.account_withdrawals (
  account_id   uuid        PRIMARY KEY REFERENCES public.accounts(id),
  reason_code  text        NOT NULL,
  memo         text,
  had_deal     boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_aw_reason CHECK (reason_code IN ('LOW_USE','NOT_USEFUL','OTHER_SERVICE','PRIVACY','BAD_EXPERIENCE','OTHER')),
  CONSTRAINT ck_aw_memo CHECK (memo IS NULL OR length(memo) <= 500),
  CONSTRAINT ck_aw_other CHECK (reason_code <> 'OTHER' OR length(btrim(coalesce(memo, ''))) >= 2)
);
COMMENT ON TABLE public.account_withdrawals IS
  'v10.48 (D102) — 회원 탈퇴 기록(사유 · 거래 기록 여부). 계정 개인정보는 기존 규칙대로 파기합니다(거래 기록이 있으면 5년 뒤 · 없으면 다음 파기 배치 · fn_set_retention_on_withdraw · fn_purge_accounts). memo 에는 개인정보를 받지 않습니다(화면 안내).';

/* 탈퇴를 막는 것 — 이용약관 제13조 ② 「진행 중인 거래나 정산이 있으면 그것이 끝난 뒤」. 줄이 없으면 탈퇴할 수 있습니다 */
CREATE OR REPLACE FUNCTION public.fn_withdraw_blockers(p_account uuid)
RETURNS TABLE (code text, label text, cnt integer, link text)
LANGUAGE sql STABLE AS $$
  SELECT * FROM (
    SELECT 'DEAL_OPEN', '진행 중인 거래', count(*)::int, '/my/deals'
      FROM deals d
     WHERE p_account IN (d.buyer_account_id, d.seller_account_id, d.introducer_account_id)
       AND (d.status IN ('NEGOTIATING','CONTRACTED','PAYMENT_REPORTED','DISPUTED')
            OR (d.status = 'INQUIRY' AND d.created_at > now() - interval '30 days'))
    UNION ALL
    SELECT 'DISPUTE_OPEN', '처리 중인 분쟁', count(*)::int, '/my/deals'
      FROM disputes x JOIN deals d ON d.id = x.deal_id
     WHERE x.status IN ('OPEN','IN_REVIEW')
       AND p_account IN (d.buyer_account_id, d.seller_account_id, d.introducer_account_id, x.raised_by)
    UNION ALL
    SELECT 'SETTLEMENT_OPEN', '처리 중인 정산', count(*)::int, '/my/settlement'
      FROM settlements s
     WHERE s.payee_account_id = p_account AND s.status IN ('REQUESTED','APPROVED','HELD')
    UNION ALL
    SELECT 'ORDER_OPEN', '진행 중인 소개몰 주문', count(*)::int, '/my/health'
      FROM hlt_orders o
     WHERE o.account_id = p_account AND o.status IN ('PAID','PREPARING','SHIPPED','DELIVERED')
    UNION ALL
    SELECT 'RETURN_OPEN', '처리 중인 취소 · 반품', count(*)::int, '/my/health'
      FROM hlt_returns r JOIN hlt_orders o ON o.id = r.order_id
     WHERE o.account_id = p_account AND r.state IN ('REQUESTED','APPROVED')
    UNION ALL
    SELECT 'SUB_REFUND_OPEN', '처리 중인 구독 환불', count(*)::int, '/my/subscription'
      FROM subscription_refunds sr
     WHERE sr.account_id = p_account AND sr.state IN ('REQUESTED','PROCESSING','UNKNOWN')
    UNION ALL
    SELECT 'LEAD_CASH_LEFT', '파트너 리드캐시 유상 잔액(환불 신청 뒤 탈퇴)', count(*)::int, '/partner/cash'
      FROM lead_cash_wallets w JOIN partners p ON p.id = w.partner_id JOIN businesses b ON b.id = p.business_id
     WHERE b.account_id = p_account AND w.paid_balance > 0
    UNION ALL
    SELECT 'LEAD_CASH_REFUND_OPEN', '처리 중인 리드캐시 환불', count(*)::int, '/partner/cash'
      FROM lead_cash_refunds lr JOIN partners p ON p.id = lr.partner_id JOIN businesses b ON b.id = p.business_id
     WHERE b.account_id = p_account AND lr.state = 'REQUESTED'
  ) z(code, label, cnt, link)
  WHERE cnt > 0
$$;
COMMENT ON FUNCTION public.fn_withdraw_blockers(uuid) IS
  'v10.48 (D102) — 탈퇴를 막는 항목(이용약관 제13조 ②). INQUIRY(문의만 한 거래)는 30일이 지나면 막지 않습니다(취소 단추가 없어 영영 못 나가는 일을 막기 위해).';

/* 탈퇴 처리 — 막는 항목 확인 → 기록 → 유료 구독 해지 예약 · 결제 수단 해제 → withdrawn_at (기존 트리거가 상태 · 보관 기한 · 매물 내리기 · 소개코드 정지) */
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
  VALUES (p_account, p_reason, nullif(btrim(coalesce(p_memo, '')), ''), hd);
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

/* 마지막 방어선 — 막는 항목이 남은 채로 withdrawn_at 을 찍는 다른 경로(직접 UPDATE 등)도 막습니다 */
CREATE OR REPLACE FUNCTION public.fn_account_withdraw_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE b text;
BEGIN
  IF NEW.withdrawn_at IS NOT NULL AND OLD.withdrawn_at IS NULL THEN
    SELECT string_agg(label, ' · ') INTO b FROM fn_withdraw_blockers(NEW.id);
    IF b IS NOT NULL THEN RAISE EXCEPTION 'WITHDRAW_BLOCKED: %', b; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_account_withdraw_guard ON public.accounts;
CREATE TRIGGER trg_account_withdraw_guard BEFORE UPDATE OF withdrawn_at ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.fn_account_withdraw_guard();

/* ── 5. 알림 종류 ─────────────────────────────────────────────────── */
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES
  ('PASSWORD_CHANGED', '비밀번호 변경', false, true, '계정 보안 — 본인이 바꾸지 않았으면 바로 알아야 합니다'),
  ('LOGIN_LOCKED', '로그인 잠금', false, true, '계정 보안 — 남이 비밀번호를 맞혀 보는 중일 수 있습니다')
ON CONFLICT (event_code) DO NOTHING;

/* ── 6. 감시 보기 (0 이어야 정상) ─────────────────────────────────── */
CREATE OR REPLACE VIEW public.v_auth_lock_overlong AS
SELECT key_hash, locked_until, last_at
  FROM auth_throttle
 WHERE key_kind = 'LOGIN_EMAIL' AND locked_until IS NOT NULL
   AND locked_until > last_at + make_interval(mins => fn_setting_int('auth.login.lock_minutes', 30) + 1);
COMMENT ON VIEW public.v_auth_lock_overlong IS
  'v10.48 (D102) — 설정한 잠금 시간보다 길게 잠긴 이메일. 0 이어야 정상입니다(잠금은 auth.login.lock_minutes 만큼만).';

CREATE OR REPLACE VIEW public.v_reset_token_live_overdue AS
SELECT id, account_id, expires_at
  FROM password_reset_tokens
 WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at < now() - interval '7 days';
COMMENT ON VIEW public.v_reset_token_live_overdue IS
  'v10.48 (D102) — 7일 넘게 남아 있는 재설정 증표(파기 배치가 돌지 않음). 0 이어야 정상입니다.';

CREATE OR REPLACE VIEW public.v_withdrawn_with_open_items AS
SELECT a.id AS account_id, a.withdrawn_at, b.code, b.cnt
  FROM accounts a CROSS JOIN LATERAL fn_withdraw_blockers(a.id) b
 WHERE a.withdrawn_at IS NOT NULL AND a.withdrawn_at > now() - interval '1 day'
   AND b.code IN ('SETTLEMENT_OPEN','LEAD_CASH_LEFT','LEAD_CASH_REFUND_OPEN','SUB_REFUND_OPEN');
COMMENT ON VIEW public.v_withdrawn_with_open_items IS
  'v10.48 (D102) — 어제 · 오늘 탈퇴했는데 돈이 걸린 일이 남은 계정. 0 이어야 정상입니다(탈퇴 가드가 막아야 함).';
