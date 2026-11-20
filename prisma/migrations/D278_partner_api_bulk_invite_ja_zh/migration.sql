/* D278 (v10.521 ~ 523 · docs/659 ~ 661) ㊽ 파트너 · 운영 · 다국어 — 파트너 오픈 API(키 지문 · 웹훅 서명 · off) · 회원 일괄 등록 CSV · 일본어 · 중국어(검수 전 off) */

/* D278 (v10.521 ~ 523 · docs/659 ~ 661) ㊽ 파트너 · 운영 · 다국어 — 파트너 오픈 API(키 · 범위 · 사용 한도 · 요청 기록 · 웹훅 서명 · 재시도) · 파트너 직원 일괄 등록 CSV · 일본어 · 중국어(간체) 틀 — 모두 처음 꺼짐 */

/* D278 (v10.521 ~ 523) ㊽ 파트너 · 운영 · 다국어
 *   다시 돌려도 같음 · 지우는 문장 없음(트리거는 DROP IF EXISTS → 바로 CREATE)
 *   외부 연동 표(integrations)에 줄을 더하지 않음 — 웹훅은 업체 키가 아니라 파트너가 알려 준 주소로 보내는 것(규칙 26 해당 없음)
 *   INV-9 · INV-11 감시 낱말 · 칸 이름 없음 → v_inv11_violations 예외 줄 없음 */

/* ── ① 파트너 오픈 API (v10.521 · docs/659) ─────────────────────────────────────────
 *   주소 /api/partner/v1/… (운영 화면 /api/v1/admin 아래가 아님 · 회원 로그인 증표가 아니라 파트너 API 키)
 *   키 = sgbp_<앞 8자>_<비밀 32자> — DB 에는 앞머리(sgbp_xxxxxxxx)와 sha256 지문만 · 원문은 발급 때 한 번만 화면에
 *   범위(scopes) — 읽기만: leads:read(배정 리드 · 연락처 없음) · services:read(내 서비스) · cash:read(리드 이용료 잔액)
 *   키마다 1분 사용 한도(rate_per_min) · 요청 기록(ptn_api_requests · IP 는 하루 바뀌는 지문 16자만 · papi.log_keep_days 뒤 지움)
 *   웹훅 — 파트너마다 주소 하나(https) · 비밀값은 암호문(pgp_sym_encrypt · fn_enc_key)으로 · 서명 HMAC-SHA256 · 재시도 6번(1분 · 5분 · 30분 · 2시간 · 6시간 · 12시간)
 *   papi.enabled 처음 off(키가 있어도 503 PAPI_OFF) · papi.hook_enabled 처음 off(웹훅 줄도 만들지 않음) · papi.hook_mode 처음 ASSUME(보내지 않고 ASSUMED) */
CREATE TABLE IF NOT EXISTS public.ptn_api_keys (
  id             bigserial PRIMARY KEY,
  partner_id     uuid NOT NULL REFERENCES public.partners(id),
  name           text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 60),
  key_prefix     text NOT NULL UNIQUE CHECK (key_prefix ~ '^sgbp_[a-z0-9]{8}$'),
  key_hash       text NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  scopes         text[] NOT NULL CHECK (cardinality(scopes) BETWEEN 1 AND 3 AND scopes <@ ARRAY['leads:read', 'services:read', 'cash:read']::text[]),
  rate_per_min   int NOT NULL DEFAULT 60 CHECK (rate_per_min BETWEEN 1 AND 600),
  status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  expires_at     timestamptz NOT NULL,
  last_used_at   timestamptz,
  created_by     uuid REFERENCES public.accounts(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  revoked_by     uuid REFERENCES public.accounts(id),
  revoked_at     timestamptz,
  revoke_reason  text CHECK (revoke_reason IS NULL OR char_length(revoke_reason) BETWEEN 2 AND 200),
  CONSTRAINT ck_ptn_api_key_revoked CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL)),
  CONSTRAINT ck_ptn_api_key_expiry CHECK (expires_at > created_at AND expires_at <= created_at + interval '731 days')
);
CREATE INDEX IF NOT EXISTS ix_ptn_api_keys_partner ON public.ptn_api_keys (partner_id, status);
COMMENT ON TABLE public.ptn_api_keys IS 'v10.521 (D278) 파트너 오픈 API 키 — 원문은 저장하지 않음(앞머리 · sha256 지문만) · 범위는 읽기 3종 · 키마다 1분 한도 · 거둔(REVOKED) 키는 되살리지 않음 · 지우지 않음';

/* 키 지킴 — 앞머리 · 지문 · 파트너는 못 바꿈 · 거둔 키는 되살리지 않음 · 파트너마다 살아 있는 키 5개까지 · 파트너가 ACTIVE 여야 발급 · 지우지 않음 */
CREATE OR REPLACE FUNCTION public.fn_ptn_api_key_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_n int; v_st text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PAPI_KEY: API 키 기록은 지우지 않습니다 — 거두기(REVOKED)로 막으십시오.';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO v_st FROM public.partners WHERE id = NEW.partner_id;
    IF v_st IS DISTINCT FROM 'ACTIVE' THEN
      RAISE EXCEPTION 'PAPI_KEY: 활동 중(ACTIVE)인 파트너에게만 API 키를 발급합니다.';
    END IF;
    SELECT count(*) INTO v_n FROM public.ptn_api_keys WHERE partner_id = NEW.partner_id AND status = 'ACTIVE' AND expires_at > now();
    IF v_n >= 5 THEN
      RAISE EXCEPTION 'PAPI_KEY: 파트너마다 살아 있는 API 키는 5개까지입니다 — 쓰지 않는 키를 먼저 거두십시오.';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.partner_id <> OLD.partner_id OR NEW.key_prefix <> OLD.key_prefix OR NEW.key_hash <> OLD.key_hash OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'PAPI_KEY: 키의 파트너 · 앞머리 · 지문은 바꿀 수 없습니다 — 새 키를 발급하십시오.';
  END IF;
  IF OLD.status = 'REVOKED' AND (NEW.status <> 'REVOKED' OR NEW.scopes <> OLD.scopes OR NEW.rate_per_min <> OLD.rate_per_min) THEN
    RAISE EXCEPTION 'PAPI_KEY: 거둔 키는 되살리거나 고칠 수 없습니다 — 새 키를 발급하십시오.';
  END IF;
  IF NEW.expires_at > OLD.expires_at THEN
    RAISE EXCEPTION 'PAPI_KEY: 키 기한은 늘릴 수 없습니다 — 새 키를 발급하십시오.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ptn_api_key_guard ON public.ptn_api_keys;
CREATE TRIGGER trg_ptn_api_key_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ptn_api_keys
  FOR EACH ROW EXECUTE FUNCTION public.fn_ptn_api_key_guard();

CREATE TABLE IF NOT EXISTS public.ptn_api_requests (
  id          bigserial PRIMARY KEY,
  key_id      bigint REFERENCES public.ptn_api_keys(id),
  partner_id  uuid,
  method      text NOT NULL CHECK (method ~ '^[A-Z]{3,7}$'),
  path        text NOT NULL CHECK (char_length(path) BETWEEN 1 AND 200),
  status      int NOT NULL CHECK (status BETWEEN 100 AND 599),
  ms          int CHECK (ms IS NULL OR ms BETWEEN 0 AND 600000),
  reason      text CHECK (reason IS NULL OR reason ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  ip_key      text CHECK (ip_key IS NULL OR ip_key ~ '^[0-9a-f]{16}$'),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ptn_api_requests_key ON public.ptn_api_requests (key_id, at DESC);
CREATE INDEX IF NOT EXISTS ix_ptn_api_requests_at ON public.ptn_api_requests (at);
COMMENT ON TABLE public.ptn_api_requests IS 'v10.521 (D278) 파트너 오픈 API 요청 기록 — 키 · 주소(쿼리 뺌) · 응답 코드 · 걸린 시간 · 막힌 까닭 · IP 는 하루마다 바뀌는 HMAC 지문 앞 16자만(원래 IP 없음) · papi.log_keep_days 지나면 papi_daily 가 지움';

CREATE TABLE IF NOT EXISTS public.ptn_api_hooks (
  id               bigserial PRIMARY KEY,
  partner_id       uuid NOT NULL REFERENCES public.partners(id),
  url              text NOT NULL CHECK (char_length(url) <= 300 AND url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{2,5})?(/[!-~]*)?$'),
  events           text[] NOT NULL CHECK (cardinality(events) BETWEEN 1 AND 2 AND events <@ ARRAY['lead.delivered', 'lead.state_changed']::text[]),
  secret_enc       bytea NOT NULL,
  secret_last4     text NOT NULL CHECK (secret_last4 ~ '^[A-Za-z0-9_-]{4}$'),
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  fail_streak      int NOT NULL DEFAULT 0 CHECK (fail_streak >= 0),
  created_by       uuid REFERENCES public.accounts(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  rotated_at       timestamptz,
  disabled_by      uuid REFERENCES public.accounts(id),
  disabled_at      timestamptz,
  disabled_reason  text CHECK (disabled_reason IS NULL OR char_length(disabled_reason) BETWEEN 2 AND 200),
  CONSTRAINT ck_ptn_api_hook_disabled CHECK ((status = 'DISABLED') = (disabled_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ptn_api_hook_active ON public.ptn_api_hooks (partner_id) WHERE status = 'ACTIVE';
COMMENT ON TABLE public.ptn_api_hooks IS 'v10.521 (D278) 파트너 웹훅 주소 — 파트너마다 살아 있는 것 하나 · https 만 · 비밀값은 암호문(원문은 만들 때 · 바꿀 때 한 번만 화면에) · 끈(DISABLED) 주소는 되살리지 않고 새로 만듦';

CREATE OR REPLACE FUNCTION public.fn_ptn_api_hook_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PAPI_HOOK: 웹훅 기록은 지우지 않습니다 — 끄기(DISABLED)로 막으십시오.';
  END IF;
  IF NEW.partner_id <> OLD.partner_id OR NEW.url <> OLD.url OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'PAPI_HOOK: 웹훅의 파트너 · 주소는 바꿀 수 없습니다 — 끄고 새로 만드십시오.';
  END IF;
  IF OLD.status = 'DISABLED' AND NEW.status <> 'DISABLED' THEN
    RAISE EXCEPTION 'PAPI_HOOK: 끈 웹훅은 되살리지 않습니다 — 새로 만드십시오.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ptn_api_hook_guard ON public.ptn_api_hooks;
CREATE TRIGGER trg_ptn_api_hook_guard BEFORE UPDATE OR DELETE ON public.ptn_api_hooks
  FOR EACH ROW EXECUTE FUNCTION public.fn_ptn_api_hook_guard();

CREATE TABLE IF NOT EXISTS public.ptn_api_hook_events (
  id           bigserial PRIMARY KEY,
  hook_id      bigint NOT NULL REFERENCES public.ptn_api_hooks(id),
  partner_id   uuid NOT NULL REFERENCES public.partners(id),
  event        text NOT NULL CHECK (event IN ('lead.delivered', 'lead.state_changed', 'ping')),
  event_uid    uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  ref_key      text CHECK (ref_key IS NULL OR char_length(ref_key) <= 80),
  payload      jsonb NOT NULL CHECK (pg_column_size(payload) < 4000),
  state        text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'SENT', 'ASSUMED', 'FAILED', 'GIVEUP', 'CANCELED')),
  attempts     int NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  next_at      timestamptz NOT NULL DEFAULT now(),
  last_status  int CHECK (last_status IS NULL OR last_status BETWEEN 0 AND 599),
  last_error   text CHECK (last_error IS NULL OR char_length(last_error) <= 200),
  sent_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ptn_api_event_sent CHECK ((state IN ('SENT', 'ASSUMED')) = (sent_at IS NOT NULL))
);
/* 같은 배정 · 같은 상태는 웹훅 한 번(트리거가 두 번 돌아도) — ping 은 ref_key 가 없어 늘 새 줄 */
CREATE UNIQUE INDEX IF NOT EXISTS uq_ptn_api_event_ref ON public.ptn_api_hook_events (hook_id, event, ref_key) WHERE ref_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ptn_api_events_due ON public.ptn_api_hook_events (state, next_at) WHERE state IN ('PENDING', 'FAILED');
CREATE INDEX IF NOT EXISTS ix_ptn_api_events_hook ON public.ptn_api_hook_events (hook_id, id DESC);
COMMENT ON TABLE public.ptn_api_hook_events IS 'v10.521 (D278) 웹훅 보낼 줄 — 리드 배정 · 상태 바뀜(DB 트리거) · 시험(ping) · 몸통은 배정 번호 · 상태 · 시각만(연락처 · 요약 없음) · 1분마다 papi_hook_send · 재시도 6번 뒤 GIVEUP';

/* 리드 배정 · 상태 바뀜 → 웹훅 줄. papi.enabled · papi.hook_enabled 둘 다 on 이고 그 파트너에 살아 있는 웹훅이 그 일을 받을 때만.
 * ★ 이 트리거가 실패해도 리드 배정은 막지 않음(EXCEPTION → RETURN NEW) — 웹훅은 덧붙이는 기능 */
CREATE OR REPLACE FUNCTION public.fn_papi_lead_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_ev text; v_on boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.state IS NOT DISTINCT FROM OLD.state THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT (count(*) FILTER (WHERE key = 'papi.enabled' AND value = 'on') = 1 AND count(*) FILTER (WHERE key = 'papi.hook_enabled' AND value = 'on') = 1)
      INTO v_on FROM public.site_settings WHERE key IN ('papi.enabled', 'papi.hook_enabled');
    IF NOT coalesce(v_on, false) THEN
      RETURN NEW;
    END IF;
    v_ev := CASE WHEN TG_OP = 'INSERT' THEN 'lead.delivered' ELSE 'lead.state_changed' END;
    INSERT INTO public.ptn_api_hook_events (hook_id, partner_id, event, ref_key, payload)
    SELECT h.id, h.partner_id, v_ev, NEW.id::text || ':' || NEW.state,
           jsonb_build_object('deliveryId', NEW.id, 'state', NEW.state,
                              'expiresAt', CASE WHEN NEW.expires_at IS NULL THEN NULL ELSE to_char(NEW.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
                              'at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
      FROM public.ptn_api_hooks h
     WHERE h.partner_id = NEW.partner_id AND h.status = 'ACTIVE' AND v_ev = ANY (h.events)
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'papi lead event skipped';
  END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_papi_lead_event ON public.lead_deliveries;
CREATE TRIGGER trg_papi_lead_event AFTER INSERT OR UPDATE OF state ON public.lead_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.fn_papi_lead_event();

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('papi.enabled', 'off', 'ADMIN', '파트너 오픈 API(v10.521 · D278) — 처음 off · off 이면 키가 있어도 /api/partner/v1 모두 503 PAPI_OFF · 키 발급 · 웹훅 등록은 꺼져도 됨 · 켜기 SUPER(보안 검토 docs/659 6절 뒤)', false, '^(on|off)$', 'off'),
  ('papi.hook_enabled', 'off', 'ADMIN', '파트너 웹훅 보내기(v10.521) — 처음 off · off 이면 리드 배정 · 상태 바뀜 웹훅 줄도 만들지 않음 · 시험(ping)은 줄만 만들고 정기 작업이 보내지 않음', false, '^(on|off)$', 'off'),
  ('papi.hook_mode', 'ASSUME', 'ADMIN', '파트너 웹훅 방식(v10.521) — ASSUME 은 보내지 않고 「간주(ASSUMED)」로만 기록(점검판) · LIVE 는 파트너 주소로 서명해 보냄', false, '^(ASSUME|LIVE)$', 'ASSUME'),
  ('papi.default_rate', '60', 'ADMIN', '파트너 API 키 1분 사용 한도 처음 값(v10.521 · 1 ~ 600 · 처음 60) — 키마다 따로 바꿀 수 있음', false, '^([1-9][0-9]{0,1}|[1-5][0-9]{2}|600)$', '60'),
  ('papi.log_keep_days', '90', 'ADMIN', '파트너 API 요청 기록 보관 일수(v10.521 · 30 ~ 365 · 처음 90) — 지나면 papi_daily 가 지움', false, '^([3-9][0-9]|[1-2][0-9]{2}|3[0-5][0-9]|36[0-5])$', '90')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('papi_hook_send', 1, NULL, NULL, NULL, true, '파트너 웹훅 보내기 — 1분마다 보낼 줄 50개(papi.hook_enabled on 일 때만 · ASSUME 은 간주) · 실패하면 1분 · 5분 · 30분 · 2시간 · 6시간 · 12시간 뒤 다시 · 6번 뒤 GIVEUP · 연속 20번 실패한 주소는 끔 · D278 · v10.521'),
  ('papi_daily', 1440, 3, 50, NULL, true, '파트너 API 하루 정리 — 요청 기록 papi.log_keep_days 지난 것 지움 · 3일 넘게 못 보낸 웹훅 줄 GIVEUP · 기한 7일 안 키 알림(PAPI_KEY_EXPIRING) · 틀린 키 몰림 알림(PAPI_KEY_ABUSE) · D278 · v10.521')
ON CONFLICT (job) DO NOTHING;


/* ── ② 파트너 직원 일괄 등록 CSV (v10.522 · docs/660) ───────────────────────────────
 *   운영자가 파트너 한 곳을 고르고 CSV(email · can_settle 두 칸만)를 올림 → 미리보기(줄마다 결과) → 확정
 *   이미 가입한 회원 = 기존 「직원 초대」와 같은 줄(business_members · 받아들이면 합류) · 아직 안 한 사람 = 가입 대기(PENDING · 원문 이메일은 이 동안만)
 *   가입 대기 줄은 15분마다 pbulk_match 가 같은 이메일로 가입한 회원을 찾아 초대 줄로 바꾸고 원문 이메일을 지움 · pbulk.pending_days 지나면 EXPIRED(이메일 지움)
 *   초대 메일 pbulk.invite_mail 처음 off — off 면 메일 없이 기록만(OFF) · 계정을 대신 만들지 않음(약관 동의 · 본인 가입이 먼저)
 *   감사 기록 — 확정 · 짝 맞춤 때 줄마다 한 줄(PBULK_ROW · PBULK_MATCH · 이메일은 가린 값만) */
CREATE TABLE IF NOT EXISTS public.ptn_bulk_invites (
  id            bigserial PRIMARY KEY,
  partner_id    uuid NOT NULL REFERENCES public.partners(id),
  business_id   uuid NOT NULL REFERENCES public.businesses(id),
  file_name     text CHECK (file_name IS NULL OR char_length(file_name) <= 120),
  state         text NOT NULL DEFAULT 'PREVIEW' CHECK (state IN ('PREVIEW', 'CONFIRMED', 'CANCELED')),
  total         int NOT NULL DEFAULT 0 CHECK (total BETWEEN 0 AND 1000),
  n_member      int NOT NULL DEFAULT 0 CHECK (n_member >= 0),
  n_pending     int NOT NULL DEFAULT 0 CHECK (n_pending >= 0),
  n_bad         int NOT NULL DEFAULT 0 CHECK (n_bad >= 0),
  created_by    uuid REFERENCES public.accounts(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  confirmed_by  uuid REFERENCES public.accounts(id),
  confirmed_at  timestamptz,
  canceled_at   timestamptz,
  CONSTRAINT ck_pbulk_confirmed CHECK ((state = 'CONFIRMED') = (confirmed_at IS NOT NULL)),
  CONSTRAINT ck_pbulk_canceled CHECK ((state = 'CANCELED') = (canceled_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_ptn_bulk_invites_partner ON public.ptn_bulk_invites (partner_id, created_at DESC);
COMMENT ON TABLE public.ptn_bulk_invites IS 'v10.522 (D278) 파트너 직원 일괄 등록 묶음 — 미리보기 → 확정(앞으로만) · 취소 · 지우지 않음';

CREATE TABLE IF NOT EXISTS public.ptn_bulk_invite_rows (
  id            bigserial PRIMARY KEY,
  batch_id      bigint NOT NULL REFERENCES public.ptn_bulk_invites(id),
  line_no       int NOT NULL CHECK (line_no BETWEEN 1 AND 1000),
  email_hash    text CHECK (email_hash IS NULL OR email_hash ~ '^[0-9a-f]{64}$'),
  email_masked  text CHECK (email_masked IS NULL OR char_length(email_masked) <= 80),
  email         text CHECK (email IS NULL OR (char_length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  can_settle    boolean NOT NULL DEFAULT false,
  result        text NOT NULL CHECK (result IN ('MEMBER', 'PENDING', 'DUPLICATE', 'INVALID', 'ALREADY', 'OTHER_BUSINESS', 'SELF')),
  state         text NOT NULL DEFAULT 'PREVIEW' CHECK (state IN ('PREVIEW', 'INVITED', 'PENDING', 'MATCHED', 'EXPIRED', 'SKIPPED', 'CANCELED')),
  account_id    uuid REFERENCES public.accounts(id),
  mail_state    text CHECK (mail_state IS NULL OR mail_state IN ('QUEUED', 'SENT', 'ASSUMED', 'FAILED', 'OFF')),
  mailed_at     timestamptz,
  expires_at    timestamptz,
  done_at       timestamptz,
  UNIQUE (batch_id, line_no),
  /* 원문 이메일은 가입 대기(미리보기 · PENDING) 동안만 — 짝 맞춤 · 기한 지남 · 취소 · 건너뜀이면 지움 */
  CONSTRAINT ck_pbulk_row_email_kept CHECK (email IS NULL OR (result = 'PENDING' AND state IN ('PREVIEW', 'PENDING'))),
  CONSTRAINT ck_pbulk_row_pending_exp CHECK (state <> 'PENDING' OR expires_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_ptn_bulk_rows_pending ON public.ptn_bulk_invite_rows (state, email_hash) WHERE state = 'PENDING';
COMMENT ON TABLE public.ptn_bulk_invite_rows IS 'v10.522 (D278) 일괄 등록 한 줄 — 받는 칸은 이메일 · 정산 권한 둘뿐 · 원문 이메일은 가입 대기 동안만(지문 · 가린 값은 남음) · 결과 MEMBER(가입 회원 → 초대) · PENDING(가입 대기) · DUPLICATE · INVALID · ALREADY · OTHER_BUSINESS · SELF';

/* 줄 지킴 — 묶음 · 줄 번호 · 결과 · 지문은 못 바꿈 · 상태는 앞으로만 · 지우지 않음 */
CREATE OR REPLACE FUNCTION public.fn_pbulk_row_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PBULK: 일괄 등록 줄은 지우지 않습니다.';
  END IF;
  IF NEW.batch_id <> OLD.batch_id OR NEW.line_no <> OLD.line_no OR NEW.result <> OLD.result OR NEW.email_hash IS DISTINCT FROM OLD.email_hash THEN
    RAISE EXCEPTION 'PBULK: 일괄 등록 줄의 묶음 · 줄 번호 · 결과는 바꿀 수 없습니다.';
  END IF;
  IF NEW.email IS NOT NULL AND NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'PBULK: 원문 이메일은 새로 넣을 수 없습니다(지우기만).';
  END IF;
  IF OLD.state <> NEW.state AND NOT (
       (OLD.state = 'PREVIEW' AND NEW.state IN ('INVITED', 'PENDING', 'SKIPPED', 'CANCELED'))
    OR (OLD.state = 'PENDING' AND NEW.state IN ('MATCHED', 'EXPIRED', 'SKIPPED'))) THEN
    RAISE EXCEPTION 'PBULK: 일괄 등록 줄 상태는 앞으로만 바뀝니다.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pbulk_row_guard ON public.ptn_bulk_invite_rows;
CREATE TRIGGER trg_pbulk_row_guard BEFORE UPDATE OR DELETE ON public.ptn_bulk_invite_rows
  FOR EACH ROW EXECUTE FUNCTION public.fn_pbulk_row_guard();

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('pbulk.invite_mail', 'off', 'ADMIN', '파트너 직원 일괄 등록 초대 메일(v10.522 · D278) — 처음 off · off 면 메일 없이 기록만(OFF) · on 이면 15분마다 pbulk_match 가 초대 메일(메일 준비됨일 때) · 켜기 SUPER(법무 확인 docs/660 5절 뒤)', false, '^(on|off)$', 'off'),
  ('pbulk.max_rows', '200', 'ADMIN', '파트너 직원 일괄 등록 한 번에 받는 줄 수(v10.522 · 10 ~ 1000 · 처음 200)', false, '^([1-9][0-9]{1,2}|1000)$', '200'),
  ('pbulk.pending_days', '30', 'ADMIN', '일괄 등록 가입 대기 기한(v10.522 · 7 ~ 90일 · 처음 30) — 지나면 EXPIRED · 원문 이메일 지움', false, '^([7-9]|[1-8][0-9]|90)$', '30')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('pbulk_match', 15, NULL, NULL, NULL, true, '파트너 직원 일괄 등록 — 15분마다 가입 대기 줄과 새 회원 짝 맞춤(초대 줄 · 원문 이메일 지움) · 기한 지난 줄 EXPIRED · 하루 지난 미리보기 취소 · 초대 메일(pbulk.invite_mail on 일 때만) · D278 · v10.522')
ON CONFLICT (job) DO NOTHING;


/* ── ③ 일본어 · 중국어(간체) (v10.523 · docs/661) ─────────────────────────────────────
 *   ja 는 D115 에 이미 있음(꺼짐) · zh(간체) 더함(꺼짐) — 사용자 웹 언어 단추는 i18n.enabled on + 그 언어 is_active on 일 때만 보임(기존 규칙 그대로)
 *   사전(사용자 웹 ja.json · zh.json · 서버 server-text.ja.ts · zh.ts)은 기계 번역 초안 — 검수 기록(i18n_lang_reviews)이
 *   사이트(SITE) · 서버 문장(SERVER) 둘 다 「승인」이어야 ja · zh 를 켤 수 있음(DB 가 막음 · 번역 검수 전 공개 안 함) */
INSERT INTO public.i18n_langs (code, name, native, rtl, is_active, sort_order) VALUES
  ('zh', '중국어(간체)', '简体中文', false, false, 8)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.i18n_lang_reviews (
  id            bigserial PRIMARY KEY,
  lang          text NOT NULL REFERENCES public.i18n_langs(code) CHECK (lang IN ('ja', 'zh')),
  scope         text NOT NULL CHECK (scope IN ('SITE', 'SERVER', 'DB')),
  verdict       text NOT NULL CHECK (verdict IN ('APPROVED', 'REJECTED')),
  reviewer      text NOT NULL CHECK (char_length(btrim(reviewer)) BETWEEN 2 AND 60),
  dict_version  text NOT NULL CHECK (dict_version ~ '^v10\.[0-9]{3}$'),
  note          text CHECK (note IS NULL OR char_length(note) <= 500),
  recorded_by   uuid REFERENCES public.accounts(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_i18n_lang_reviews ON public.i18n_lang_reviews (lang, scope, id DESC);
COMMENT ON TABLE public.i18n_lang_reviews IS 'v10.523 (D278) 일본어 · 중국어 사전 검수 기록 — 누가(검수자 이름 · 기록한 운영자) · 어느 판 사전 · 승인 · 반려 · 쌓기만(고치지 · 지우지 않음) · 가장 최근 줄이 그 범위의 지금 판정';

CREATE OR REPLACE FUNCTION public.fn_i18n_review_block() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'I18N_REVIEW: 검수 기록은 고치거나 지우지 않습니다 — 새 줄로 남기십시오.';
END $$;
DROP TRIGGER IF EXISTS trg_i18n_review_block ON public.i18n_lang_reviews;
CREATE TRIGGER trg_i18n_review_block BEFORE UPDATE OR DELETE ON public.i18n_lang_reviews
  FOR EACH ROW EXECUTE FUNCTION public.fn_i18n_review_block();

/* ja · zh 켜기 — 사이트 · 서버 문장 검수의 가장 최근 판정이 둘 다 APPROVED 일 때만(끄기는 언제나 됨) */
CREATE OR REPLACE FUNCTION public.fn_i18n_draft_lang_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_ok int;
BEGIN
  IF NEW.code NOT IN ('ja', 'zh') OR NOT NEW.is_active THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_active THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_ok FROM (
    SELECT DISTINCT ON (scope) scope, verdict FROM public.i18n_lang_reviews
     WHERE lang = NEW.code AND scope IN ('SITE', 'SERVER') ORDER BY scope, id DESC) t
   WHERE t.verdict = 'APPROVED';
  IF v_ok < 2 THEN
    RAISE EXCEPTION 'I18N_REVIEW: 번역 검수 전에는 켤 수 없습니다 — 사용자 웹 사전 · 서버 문장 검수가 모두 「승인」이어야 합니다(운영 화면 › 관 관리 › 일본어 · 중국어 검수).';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_i18n_draft_lang_guard ON public.i18n_langs;
CREATE TRIGGER trg_i18n_draft_lang_guard BEFORE INSERT OR UPDATE OF is_active ON public.i18n_langs
  FOR EACH ROW EXECUTE FUNCTION public.fn_i18n_draft_lang_guard();


/* ── ④ ㉕ 권한(D258) 시드에 새 탭 3개 — gen_seed.py 와 같은 규칙
 *   ptn-openapi · ptn-bulk(파트너사 묶음 admptn · TAB_ROLES ADMIN · SUPER · PARTNER_MAL) · i18n-review(관 관리 묶음 admsit · TAB_ROLES ADMIN · SUPER)
 *   주소 규칙: GET = VIEW · 발급 · 확정 · 켜기(설정) · 지금 보내기 = APPROVE · 그 밖 변경 = EDIT
 *   /api/partner/v1/… 는 운영 주소가 아님(파트너 API 키) — 시드 없음 */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('ptn-openapi', '오픈 API', 'admptn', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2920),
  ('ptn-bulk', '직원 일괄 등록', 'admptn', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2930),
  ('i18n-review', '일본어 · 중국어 검수', 'admsit', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2940)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'ptn-openapi', 'VIEW'), ('R_ADMIN', 'ptn-openapi', 'EDIT'), ('R_ADMIN', 'ptn-openapi', 'APPROVE'), ('R_ADMIN', 'ptn-openapi', 'EXPORT'),
  ('R_ADMIN', 'ptn-bulk', 'VIEW'), ('R_ADMIN', 'ptn-bulk', 'EDIT'), ('R_ADMIN', 'ptn-bulk', 'APPROVE'), ('R_ADMIN', 'ptn-bulk', 'EXPORT'),
  ('R_ADMIN', 'i18n-review', 'VIEW'), ('R_ADMIN', 'i18n-review', 'EDIT'), ('R_ADMIN', 'i18n-review', 'APPROVE'), ('R_ADMIN', 'i18n-review', 'EXPORT'),
  ('R_PARTNER_MAL', 'ptn-openapi', 'VIEW'), ('R_PARTNER_MAL', 'ptn-openapi', 'EDIT'), ('R_PARTNER_MAL', 'ptn-openapi', 'APPROVE'), ('R_PARTNER_MAL', 'ptn-openapi', 'EXPORT'),
  ('R_PARTNER_MAL', 'ptn-bulk', 'VIEW'), ('R_PARTNER_MAL', 'ptn-bulk', 'EDIT'), ('R_PARTNER_MAL', 'ptn-bulk', 'APPROVE'), ('R_PARTNER_MAL', 'ptn-bulk', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/papi', 'ptn-openapi', 'VIEW'),
  ('GET', '/admin/papi/requests', 'ptn-openapi', 'VIEW'),
  ('GET', '/admin/papi/hooks/{id}/events', 'ptn-openapi', 'VIEW'),
  ('POST', '/admin/papi/keys', 'ptn-openapi', 'APPROVE'),
  ('PUT', '/admin/papi/keys/{id}', 'ptn-openapi', 'EDIT'),
  ('POST', '/admin/papi/keys/{id}/revoke', 'ptn-openapi', 'EDIT'),
  ('POST', '/admin/papi/hooks', 'ptn-openapi', 'APPROVE'),
  ('POST', '/admin/papi/hooks/{id}/rotate', 'ptn-openapi', 'APPROVE'),
  ('POST', '/admin/papi/hooks/{id}/disable', 'ptn-openapi', 'EDIT'),
  ('POST', '/admin/papi/hooks/{id}/test', 'ptn-openapi', 'EDIT'),
  ('POST', '/admin/papi/events/{id}/retry', 'ptn-openapi', 'EDIT'),
  ('POST', '/admin/papi/run', 'ptn-openapi', 'APPROVE'),
  ('PUT', '/admin/papi/settings', 'ptn-openapi', 'APPROVE'),
  ('GET', '/admin/pbulk', 'ptn-bulk', 'VIEW'),
  ('GET', '/admin/pbulk/{id}', 'ptn-bulk', 'VIEW'),
  ('POST', '/admin/pbulk/preview', 'ptn-bulk', 'EDIT'),
  ('POST', '/admin/pbulk/{id}/confirm', 'ptn-bulk', 'APPROVE'),
  ('POST', '/admin/pbulk/{id}/cancel', 'ptn-bulk', 'EDIT'),
  ('POST', '/admin/pbulk/run', 'ptn-bulk', 'APPROVE'),
  ('PUT', '/admin/pbulk/settings', 'ptn-bulk', 'APPROVE'),
  ('GET', '/admin/i18n-review', 'i18n-review', 'VIEW'),
  ('POST', '/admin/i18n-review/{lang}', 'i18n-review', 'APPROVE')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

