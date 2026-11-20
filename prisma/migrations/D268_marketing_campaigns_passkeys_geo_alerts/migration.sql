/* D268 (v10.483 ~ 485 · docs/621 ~ 623) ㊳ 마케팅 · 보안 — 문자 · 메일 캠페인(수신 동의 · 야간 동의) · 운영자 패스키 · 해외 접속 경고(GEOIP · 연동 16종) — 모두 처음 off */

/* D268 (v10.483 ~ 485 · docs/621 ~ 623) ㊳ 마케팅 · 보안 — 문자 · 메일 캠페인 · 운영자 패스키(WebAuthn) · 해외 접속 경고
 *   다시 돌려도 같음 · 지우는 문장은 CHECK 를 다시 만드는 한 줄뿐(ck_integ_secret_name DROP IF EXISTS → 바로 ADD)
 *   외부 연동 15 → 16종(GEOIP · IP → 국가 판별) — verify-invariants · test_v1111 · test_v1128 패치(규칙 26)
 *   ck_integ_secret_name · fn_integ_secret_set 은 ㉝ D264 판(FIRMBANK_USER_TOKEN 포함)을 그대로 복사해 GEOIP_API_KEY 만 더함 */

/* ── ① 문자 · 메일 캠페인 (v10.483 · docs/621) ─────────────────────────────────────
 *   정보통신망법 제50조 — 광고성 정보는 수신 동의자(MARKETING)에게만 · 21:00 ~ 08:00(한국)은 야간 동의(MARKETING_NIGHT)가 따로 있어야
 *   제목 · 글 앞 (광고) · 보낸 곳 이름 · 연락처 · 무료 수신 거부(메일은 링크 · 문자는 080 번호) — 서버가 글을 만들 때 붙임(운영자가 지우지 못함)
 *   보낼 때마다 DB 가 다시 봄(동의 · 야간) · 반송 · 수신 거부 주소(mail_suppressions)는 건너뜀 · 2년 넘은 동의(재확인 전)는 빼고 셈
 *   보내기는 기존 어댑터만(메일 = SES SMTP MailService · 문자 = 알림톡 대행사의 문자 주소) · 방식 campaign.send_mode ASSUME(처음 · 보내지 않고 ASSUMED) · LIVE
 *   campaign.enabled 처음 off — 꺼져 있으면 「보내기」 · 정기 작업 모두 안 함(초안 · 시험 보내기는 됨) */
CREATE TABLE IF NOT EXISTS public.mkt_campaigns (
  id             bigserial PRIMARY KEY,
  title          text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 80),
  channel        text NOT NULL CHECK (channel IN ('EMAIL', 'SMS')),
  subject        text CHECK (subject IS NULL OR char_length(btrim(subject)) BETWEEN 1 AND 100),
  body           text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 10 AND 2000),
  audience       text NOT NULL DEFAULT 'ALL' CHECK (audience IN ('ALL', 'RECENT_90')),
  state          text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'QUEUED', 'SENDING', 'DONE', 'CANCELED')),
  scheduled_at   timestamptz,
  send_mode      text CHECK (send_mode IS NULL OR send_mode IN ('ASSUME', 'LIVE')),
  queued_by      uuid REFERENCES public.accounts(id),
  queued_at      timestamptz,
  started_at     timestamptz,
  finished_at    timestamptz,
  canceled_by    uuid REFERENCES public.accounts(id),
  canceled_at    timestamptz,
  cancel_reason  text CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 200),
  last_note      text CHECK (last_note IS NULL OR char_length(last_note) <= 300),
  created_by     uuid REFERENCES public.accounts(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_mkt_campaign_subject CHECK (channel <> 'EMAIL' OR subject IS NOT NULL),
  CONSTRAINT ck_mkt_campaign_sms_len CHECK (channel <> 'SMS' OR char_length(body) <= 600),
  CONSTRAINT ck_mkt_campaign_cancel CHECK ((state = 'CANCELED') = (canceled_at IS NOT NULL)),
  CONSTRAINT ck_mkt_campaign_queued CHECK (state = 'DRAFT' OR state = 'CANCELED' OR (queued_at IS NOT NULL AND send_mode IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_mkt_campaigns_state ON public.mkt_campaigns (state, scheduled_at);
COMMENT ON TABLE public.mkt_campaigns IS 'v10.483 (D268) 문자 · 메일 캠페인 — 초안 → 보내기(받는 사람 고정 · 예약) → 보내는 중 → 끝 · 취소 · 보내기 시작한 뒤 글은 못 고침 · 지우지 않음';

CREATE TABLE IF NOT EXISTS public.mkt_campaign_sends (
  id               bigserial PRIMARY KEY,
  campaign_id      bigint NOT NULL REFERENCES public.mkt_campaigns(id),
  account_id       uuid NOT NULL REFERENCES public.accounts(id),
  test             boolean NOT NULL DEFAULT false,
  to_masked        text CHECK (to_masked IS NULL OR char_length(to_masked) <= 80),
  state            text NOT NULL DEFAULT 'QUEUED' CHECK (state IN ('QUEUED', 'SENT', 'ASSUMED', 'SKIPPED', 'FAILED')),
  skip_reason      text CHECK (skip_reason IS NULL OR skip_reason IN ('NO_CONSENT', 'INACTIVE', 'NO_ADDRESS', 'SUPPRESSED', 'CANCELED', 'UNSUBSCRIBED')),
  error            text CHECK (error IS NULL OR char_length(error) <= 200),
  provider_msg_id  text CHECK (provider_msg_id IS NULL OR char_length(provider_msg_id) <= 120),
  unsub_hash       text NOT NULL UNIQUE CHECK (unsub_hash ~ '^[0-9a-f]{64}$'),
  night            boolean,
  sent_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_mkt_send_done CHECK ((state IN ('SENT', 'ASSUMED')) = (sent_at IS NOT NULL)),
  CONSTRAINT ck_mkt_send_skip CHECK ((state = 'SKIPPED') = (skip_reason IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_send_member ON public.mkt_campaign_sends (campaign_id, account_id) WHERE NOT test;
CREATE INDEX IF NOT EXISTS ix_mkt_sends_campaign ON public.mkt_campaign_sends (campaign_id, state, id);
CREATE INDEX IF NOT EXISTS ix_mkt_sends_account ON public.mkt_campaign_sends (account_id, created_at DESC);
COMMENT ON TABLE public.mkt_campaign_sends IS 'v10.483 (D268) 캠페인 받는 사람 한 줄 — 보내기 누를 때 동의자로 고정 · 보낼 때 DB 가 동의 · 야간 동의를 다시 봄 · 받는 곳은 가린 값만 · 수신 거부 열쇠는 지문(sha256)만 · 시험 보내기(test)는 운영자 본인 · 지우지 않음';

CREATE TABLE IF NOT EXISTS public.mkt_unsubscribes (
  id           bigserial PRIMARY KEY,
  send_id      bigint NOT NULL UNIQUE REFERENCES public.mkt_campaign_sends(id),
  campaign_id  bigint NOT NULL REFERENCES public.mkt_campaigns(id),
  account_id   uuid NOT NULL REFERENCES public.accounts(id),
  channel      text NOT NULL CHECK (channel IN ('EMAIL', 'SMS')),
  withdrew     text[] NOT NULL DEFAULT '{}',
  ip_masked    text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_mkt_unsub_account ON public.mkt_unsubscribes (account_id, created_at DESC);
COMMENT ON TABLE public.mkt_unsubscribes IS 'v10.483 (D268) 캠페인 수신 거부 — 메일의 수신 거부 링크로 철회(약관 동의 기록 term_agreements 에 「거부」 한 줄씩 · 철회한 약관 코드) · 쌓기만';

/* 캠페인 상태 · 글 지킴 — 보내기 시작한 뒤 글 · 채널 · 대상은 못 바꿈 · 상태는 앞으로만 · 지우지 않음 */
CREATE OR REPLACE FUNCTION public.fn_mkt_campaign_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'MKT_STATE: 캠페인은 지우지 않습니다(취소로).'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.state <> 'DRAFT' AND (NEW.title, NEW.channel, NEW.subject, NEW.body, NEW.audience) IS DISTINCT FROM (OLD.title, OLD.channel, OLD.subject, OLD.body, OLD.audience) THEN
      RAISE EXCEPTION 'MKT_STATE: 보내기를 누른 캠페인은 글 · 채널 · 대상을 고치지 않습니다(취소하고 새로).';
    END IF;
    IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
         (OLD.state = 'DRAFT' AND NEW.state IN ('QUEUED', 'CANCELED'))
      OR (OLD.state = 'QUEUED' AND NEW.state IN ('SENDING', 'CANCELED'))
      OR (OLD.state = 'SENDING' AND NEW.state IN ('DONE', 'CANCELED'))) THEN
      RAISE EXCEPTION 'MKT_STATE: 캠페인 상태를 그렇게 바꿀 수 없습니다.';
    END IF;
    IF OLD.state IN ('DONE', 'CANCELED') AND (NEW.scheduled_at, NEW.send_mode, NEW.queued_at, NEW.started_at, NEW.finished_at, NEW.canceled_at, NEW.cancel_reason)
         IS DISTINCT FROM (OLD.scheduled_at, OLD.send_mode, OLD.queued_at, OLD.started_at, OLD.finished_at, OLD.canceled_at, OLD.cancel_reason) THEN
      RAISE EXCEPTION 'MKT_STATE: 끝났거나 취소한 캠페인은 고치지 않습니다(메모 줄만).';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

/* 받는 사람 줄 지킴 — 넣을 때 · 보낼 때 마케팅 동의(그 순간 유효한 것) · 야간이면 야간 동의 · 시험 보내기는 운영 역할 본인만 · 끝난 줄은 못 고침 */
CREATE OR REPLACE FUNCTION public.fn_mkt_send_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_h integer;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'MKT_SEND: 캠페인 받는 사람 기록은 지우지 않습니다.'; END IF;
  IF NEW.test AND NOT EXISTS (SELECT 1 FROM public.account_roles r WHERE r.account_id = NEW.account_id
                                AND r.role IN ('SUPER', 'ADMIN', 'REVIEWER', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT')) THEN
    RAISE EXCEPTION 'MKT_SEND: 시험 보내기는 운영자 본인에게만 합니다.';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'QUEUED' THEN RAISE EXCEPTION 'MKT_SEND: 받는 사람 줄은 대기(QUEUED)로만 넣습니다.'; END IF;
    IF NOT NEW.test AND NOT public.fn_consent_at(NEW.account_id, 'MARKETING', clock_timestamp()) THEN
      RAISE EXCEPTION 'MKT_NO_CONSENT: 마케팅 수신에 동의하지 않은 회원은 받는 사람에 넣지 않습니다.';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.campaign_id, NEW.account_id, NEW.test, NEW.unsub_hash, NEW.created_at) IS DISTINCT FROM (OLD.campaign_id, OLD.account_id, OLD.test, OLD.unsub_hash, OLD.created_at) THEN
    RAISE EXCEPTION 'MKT_SEND: 캠페인 · 받는 사람 · 수신 거부 열쇠는 바꾸지 않습니다.';
  END IF;
  IF OLD.state <> 'QUEUED' THEN RAISE EXCEPTION 'MKT_SEND: 끝난 받는 사람 줄은 고치지 않습니다.'; END IF;
  IF NEW.state IN ('SENT', 'ASSUMED') THEN
    v_h := extract(hour FROM (clock_timestamp() AT TIME ZONE 'Asia/Seoul'))::integer;
    NEW.night := (v_h >= 21 OR v_h < 8);
    IF NOT NEW.test THEN
      IF NOT public.fn_consent_at(NEW.account_id, 'MARKETING', clock_timestamp()) THEN
        RAISE EXCEPTION 'MKT_NO_CONSENT: 지금 마케팅 수신 동의가 없는 회원에게는 보내지 않습니다.';
      END IF;
      IF NEW.night AND NOT public.fn_consent_at(NEW.account_id, 'MARKETING_NIGHT', clock_timestamp()) THEN
        RAISE EXCEPTION 'MKT_NIGHT: 21시 ~ 8시에는 야간 광고 수신에 동의한 회원에게만 보냅니다.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mkt_campaign_guard' AND tgrelid = 'public.mkt_campaigns'::regclass) THEN
    CREATE TRIGGER trg_mkt_campaign_guard BEFORE UPDATE OR DELETE ON public.mkt_campaigns FOR EACH ROW EXECUTE FUNCTION public.fn_mkt_campaign_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mkt_send_guard' AND tgrelid = 'public.mkt_campaign_sends'::regclass) THEN
    CREATE TRIGGER trg_mkt_send_guard BEFORE INSERT OR UPDATE OR DELETE ON public.mkt_campaign_sends FOR EACH ROW EXECUTE FUNCTION public.fn_mkt_send_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mkt_unsub_ro' AND tgrelid = 'public.mkt_unsubscribes'::regclass) THEN
    CREATE TRIGGER trg_mkt_unsub_ro BEFORE UPDATE OR DELETE ON public.mkt_unsubscribes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* 감시 — 보낸(간주 포함) 줄 중 그 시각에 동의가 없었거나 야간에 야간 동의 없이 보낸 것(늘 0 이어야) */
CREATE OR REPLACE VIEW public.v_mkt_consent_violation AS
 SELECT s.id, s.campaign_id, s.account_id, s.sent_at,
        CASE WHEN NOT public.fn_consent_at(s.account_id, 'MARKETING', s.sent_at) THEN '마케팅 수신 동의 없이 보냄'
             ELSE '야간 동의 없이 21시 ~ 8시에 보냄' END AS note
   FROM public.mkt_campaign_sends s
  WHERE s.state IN ('SENT', 'ASSUMED') AND NOT s.test
    AND (NOT public.fn_consent_at(s.account_id, 'MARKETING', s.sent_at)
         OR (s.night AND NOT public.fn_consent_at(s.account_id, 'MARKETING_NIGHT', s.sent_at)));
COMMENT ON VIEW public.v_mkt_consent_violation IS 'v10.483 (D268) 캠페인 동의 위반 감시 — 보낸 그 시각에 마케팅 동의 · (야간이면) 야간 동의가 없던 줄 · 늘 0';

/* 수신 거부 처리 결과 알림(나의공간 › 알림 · 끌 수 없음 — 처리 결과 통지) · 이벤트 이름에 MARKETING · AD_ 를 넣지 않음(광고 감시 보기 v_marketing_no_consent 에 잡히지 않게) */
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis, tone) VALUES
  ('CONSENT_OPTOUT', '광고 수신 거부 처리', false, true, '정보통신망법 제50조 — 수신 거부 · 동의 철회 처리 결과 알림', 'info')
ON CONFLICT (event_code) DO NOTHING;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('campaign.enabled', 'off', 'ADMIN', '문자 · 메일 캠페인 보내기(v10.483 · D268) — 처음 off · on 이면 「보내기」 · 5분마다 정기 작업(mkt_campaign_send)이 보냄 · 초안 · 시험 보내기는 꺼져도 됨 · 켜기 SUPER', false, '^(on|off)$', 'off'),
  ('campaign.send_mode', 'ASSUME', 'ADMIN', '캠페인 보내는 방식(v10.483) — ASSUME 은 보내지 않고 「간주(ASSUMED)」로만 기록 · LIVE 는 메일(SES SMTP · 메일 준비됨) · 문자(알림톡 대행사 문자 주소 CAMPAIGN_SMS_URL · 발신번호)', false, '^(ASSUME|LIVE)$', 'ASSUME'),
  ('campaign.sender_name', '(주)한국바이오헬스케어 소개뱅크 사업부', 'ADMIN', '캠페인 보낸 곳 이름(v10.483) — 메일 끝 「보낸 곳」 · 정보통신망법 제50조 전송자 명칭', false, '^.{2,60}$', '(주)한국바이오헬스케어 소개뱅크 사업부'),
  ('campaign.sms_name', '소개뱅크', 'ADMIN', '캠페인 문자 앞 이름(v10.483) — 「(광고)소개뱅크」 처럼 붙음', false, '^.{2,20}$', '소개뱅크'),
  ('campaign.contact', '', 'ADMIN', '캠페인 연락처(v10.483) — 메일 끝 「연락처」(전화 또는 주소) · 비면 보내기 막음', false, '^.{0,100}$', '1588-0000 · 서울시 …'),
  ('campaign.optout_phone', '', 'ADMIN', '문자 무료 수신 거부 번호(v10.483) — 080 으로 시작하는 숫자만 · 문자 캠페인은 비면 보내기 막음', false, '^(|080[0-9]{7,8})$', '0801234567'),
  ('campaign.sms_from', '', 'ADMIN', '문자 발신번호(v10.483) — 대행사에 사전 등록한 번호(숫자만) · 문자 LIVE 는 비면 보내기 막음', false, '^(|0[0-9]{8,10})$', '0212345678'),
  ('campaign.batch', '200', 'ADMIN', '캠페인 한 번에 보내는 수(v10.483) — 정기 작업 5분마다 이만큼(1 ~ 1000 · 처음 200)', false, '^([1-9][0-9]{0,2}|1000)$', '200')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('mkt_campaign_send', 5, NULL, NULL, NULL, true, '문자 · 메일 캠페인 보내기 — 5분마다 예약 시각이 된 캠페인을 campaign.batch 만큼(campaign.enabled on 일 때만 · 야간은 야간 동의자만) · D268 · v10.483')
ON CONFLICT (job) DO NOTHING;


/* ── ② 운영자 패스키 (v10.484 · docs/622) ─────────────────────────────────────────────
 *   WebAuthn(FIDO2) — 운영 역할 계정만 · 공개 키(SPKI DER)와 서명 횟수만 저장(개인 키는 기기 밖으로 나오지 않음)
 *   admin.passkey       on | off(처음 off) — 꺼져 있으면 등록 · 확인 모두 안 함
 *   admin.passkey_mode  EXTRA(처음 · 비밀번호 + 2단계 인증 뒤 패스키 한 번 더 — 등록한 사람만) | REPLACE_MFA(패스키 확인이 2단계 인증을 대신함) · SUPER
 *   admin.passkey_rp_id 패스키를 묶을 도메인(예 sogaebank.com · 점검판 localhost) — 비면 NOT_READY
 *   확인한 것은 로그인 기기 줄(login_sessions.passkey_at)에 둠 · 확인 유효 시간은 admin.mfa_hours 와 같음 */
CREATE TABLE IF NOT EXISTS public.staff_passkeys (
  id             bigserial PRIMARY KEY,
  account_id     uuid NOT NULL REFERENCES public.accounts(id),
  cred_id        text NOT NULL UNIQUE CHECK (cred_id ~ '^[A-Za-z0-9_-]+$' AND char_length(cred_id) BETWEEN 16 AND 1400),
  public_key     bytea NOT NULL CHECK (octet_length(public_key) BETWEEN 32 AND 2048),
  alg            integer NOT NULL CHECK (alg IN (-7, -8, -257)),
  rp_id          text NOT NULL CHECK (char_length(rp_id) BETWEEN 1 AND 253),
  sign_count     bigint NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  label          text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 40),
  transports     text[] NOT NULL DEFAULT '{}',
  aaguid         text CHECK (aaguid IS NULL OR aaguid ~ '^[0-9a-f]{32}$'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz,
  revoked_at     timestamptz,
  revoked_by     uuid REFERENCES public.accounts(id),
  revoke_reason  text CHECK (revoke_reason IS NULL OR char_length(revoke_reason) BETWEEN 2 AND 200),
  CONSTRAINT ck_staff_passkey_revoked CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_staff_passkeys_account ON public.staff_passkeys (account_id) WHERE revoked_at IS NULL;
COMMENT ON TABLE public.staff_passkeys IS 'v10.484 (D268) 운영자 패스키(WebAuthn) — 운영 역할 계정만 · 공개 키(SPKI DER) · 알고리즘(-7 ES256 · -8 EdDSA · -257 RS256) · 서명 횟수(줄면 복제 의심) · 지우지 않음(끄기 = revoked_at · 사유)';

CREATE TABLE IF NOT EXISTS public.staff_passkey_challenges (
  id              bigserial PRIMARY KEY,
  account_id      uuid NOT NULL REFERENCES public.accounts(id),
  purpose         text NOT NULL CHECK (purpose IN ('REGISTER', 'VERIFY')),
  challenge_hash  text NOT NULL UNIQUE CHECK (challenge_hash ~ '^[0-9a-f]{64}$'),
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_staff_passkey_ch_account ON public.staff_passkey_challenges (account_id, created_at DESC);
COMMENT ON TABLE public.staff_passkey_challenges IS 'v10.484 (D268) 패스키 확인 문제(challenge) — 지문(sha256)만 · 5분 · 한 번만 · 하루 지난 줄은 정기 작업 sec_daily_purge 가 지움';

ALTER TABLE public.login_sessions ADD COLUMN IF NOT EXISTS passkey_at timestamptz;
COMMENT ON COLUMN public.login_sessions.passkey_at IS 'v10.484 (D268) 이 로그인 기기에서 패스키로 마지막 확인한 때 — EXTRA 방식에서 admin.mfa_hours 안이면 운영 API 를 엶';

CREATE OR REPLACE FUNCTION public.fn_staff_passkey_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PASSKEY_STATE: 패스키는 지우지 않습니다(끄기로).'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.account_roles r WHERE r.account_id = NEW.account_id
                     AND r.role IN ('SUPER', 'ADMIN', 'REVIEWER', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT')) THEN
      RAISE EXCEPTION 'PASSKEY_STATE: 패스키는 운영 역할 계정만 등록합니다.';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.account_id, NEW.cred_id, NEW.public_key, NEW.alg, NEW.rp_id, NEW.created_at) IS DISTINCT FROM (OLD.account_id, OLD.cred_id, OLD.public_key, OLD.alg, OLD.rp_id, OLD.created_at) THEN
    RAISE EXCEPTION 'PASSKEY_STATE: 패스키의 계정 · 키 · 도메인은 바꾸지 않습니다.';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'PASSKEY_STATE: 끈 패스키는 다시 켜지 않습니다(새로 등록).';
  END IF;
  IF NEW.sign_count < OLD.sign_count THEN RAISE EXCEPTION 'PASSKEY_STATE: 서명 횟수는 줄지 않습니다.'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_staff_passkey_guard' AND tgrelid = 'public.staff_passkeys'::regclass) THEN
    CREATE TRIGGER trg_staff_passkey_guard BEFORE INSERT OR UPDATE OR DELETE ON public.staff_passkeys FOR EACH ROW EXECUTE FUNCTION public.fn_staff_passkey_guard();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('admin.passkey', 'off', 'ADMIN', '운영자 패스키(v10.484 · D268) — 처음 off · on 이면 운영 계정이 패스키(WebAuthn)를 등록 · 확인 · 켜기 SUPER(도메인 admin.passkey_rp_id 가 있어야)', false, '^(on|off)$', 'off'),
  ('admin.passkey_mode', 'EXTRA', 'ADMIN', '패스키 쓰는 방식(v10.484) — EXTRA 는 비밀번호 · 2단계 인증 뒤 한 번 더(등록한 사람만) · REPLACE_MFA 는 패스키 확인이 2단계 인증을 대신함 · SUPER', false, '^(EXTRA|REPLACE_MFA)$', 'EXTRA'),
  ('admin.passkey_rp_id', '', 'ADMIN', '패스키 도메인(v10.484) — 운영 화면 주소의 도메인(예 sogaebank.com) · 점검판 localhost · 바꾸면 그 전 패스키는 쓸 수 없음', false, '^(|localhost|([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})$', 'sogaebank.com')
ON CONFLICT (key) DO NOTHING;


/* ── ③ 해외 접속 경고 (v10.485 · docs/623) ────────────────────────────────────────────
 *   운영 역할 계정이 로그인할 때 접속 IP 의 나라를 봄 — 허용 나라(security.geo_allow · 처음 KR) 밖이면 운영 알림 STAFF_LOGIN_ABROAD(CRITICAL)
 *   security.geo_block on 이면 그 로그인을 막고(403 GEO_BLOCKED) STAFF_LOGIN_ABROAD_BLOCKED(WARN)
 *   판별은 어댑터 — ASSUME(처음 · 묻지 않고 security.geo_assume_country) · LIVE(외부 연동 GEOIP · 키 GEOIP_API_KEY · 없으면 NOT_READY → 판별 못 함 · 막지 않음)
 *   security.geo_watch 처음 off · 기록은 IP 앞 두 마디 · 나라 · 판정만(원래 IP 는 남기지 않음 · 캐시는 IP 지문만) · 1년 지난 줄은 지움 */
CREATE TABLE IF NOT EXISTS public.sec_geo_events (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES public.accounts(id),
  ip_masked   text,
  country     text CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  source      text NOT NULL CHECK (source IN ('ASSUME', 'LIVE', 'CACHE', 'PRIVATE', 'NOT_READY', 'ERROR')),
  result      text NOT NULL CHECK (result IN ('OK', 'ALERT', 'BLOCKED', 'UNKNOWN')),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sec_geo_events_at ON public.sec_geo_events (at DESC);
CREATE INDEX IF NOT EXISTS ix_sec_geo_events_account ON public.sec_geo_events (account_id, at DESC);
COMMENT ON TABLE public.sec_geo_events IS 'v10.485 (D268) 운영자 로그인 나라 판정 — IP 앞 두 마디 · 나라 · 어디서 판별(간주 · 외부 · 캐시 · 사설 · 준비 안 됨 · 오류) · 판정(OK · 경고 · 막음 · 모름) · 고치지 않음 · 1년 지나면 지움';

CREATE TABLE IF NOT EXISTS public.sec_geo_cache (
  ip_hash    text PRIMARY KEY CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  country    text CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  looked_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.sec_geo_cache IS 'v10.485 (D268) IP → 나라 판별 캐시(LIVE 결과만 · IP 지문 sha256 만 · 7일 동안 다시 묻지 않음 · 30일 지나면 지움)';

CREATE OR REPLACE FUNCTION public.fn_sec_geo_events_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'SEC_GEO: 접속 나라 기록은 고치지 않습니다.'; END IF;
  IF OLD.at > now() - interval '365 days' THEN RAISE EXCEPTION 'SEC_GEO: 1년이 지나지 않은 접속 나라 기록은 지우지 않습니다.'; END IF;
  RETURN OLD;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sec_geo_events_guard' AND tgrelid = 'public.sec_geo_events'::regclass) THEN
    CREATE TRIGGER trg_sec_geo_events_guard BEFORE UPDATE OR DELETE ON public.sec_geo_events FOR EACH ROW EXECUTE FUNCTION public.fn_sec_geo_events_guard();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('security.geo_watch', 'off', 'ADMIN', '운영자 해외 접속 경고(v10.485 · D268) — 처음 off · on 이면 운영 역할 로그인마다 접속 나라를 보고 허용 나라 밖이면 운영 알림 STAFF_LOGIN_ABROAD · 켜기 SUPER', false, '^(on|off)$', 'off'),
  ('security.geo_mode', 'ASSUME', 'ADMIN', '접속 나라 판별 방식(v10.485) — ASSUME 은 묻지 않고 security.geo_assume_country 로 봄(점검판) · LIVE 는 외부 연동 GEOIP(키 GEOIP_API_KEY)', false, '^(ASSUME|LIVE)$', 'ASSUME'),
  ('security.geo_assume_country', 'KR', 'ADMIN', '간주 판별 나라(v10.485) — ASSUME 일 때 모든 접속을 이 나라로 봄(나라 코드 두 글자)', false, '^[A-Z]{2}$', 'KR'),
  ('security.geo_allow', 'KR', 'ADMIN', '운영 로그인 허용 나라(v10.485) — 쉼표로 나눈 나라 코드(KR 은 꼭 들어감 · 출장 때 잠시 더함)', false, '^[A-Z]{2}(,[A-Z]{2}){0,29}$', 'KR,JP'),
  ('security.geo_block', 'off', 'ADMIN', '해외 운영 로그인 막기(v10.485) — 처음 off · on 이면 허용 나라 밖 운영 로그인을 막음(403 GEO_BLOCKED) · 판별 못 하면 막지 않음 · SUPER', false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('sec_daily_purge', 1440, 4, 55, NULL, true, '보안 기록 정리 — 매일 04:55 · 1년 지난 접속 나라 기록 · 30일 지난 나라 캐시 · 하루 지난 패스키 확인 문제를 지움 · D268 · v10.485')
ON CONFLICT (job) DO NOTHING;

/* 외부 연동 16번째 — IP → 나라 판별(GEOIP) · 업체 미정(기본 틀 ipinfo 모양 · 한국인터넷진흥원 후이즈도 주소 틀로) · 처음 꺼짐 · 간주 */
INSERT INTO public.integrations (code, name, purpose, provider, status, requires_ip, secret_key_name, lead_time_weeks, blocks_open, memo, sort_order)
VALUES ('GEOIP', 'IP 국가 판별', '운영 역할 로그인의 접속 나라를 봐서 해외 로그인을 운영 알림 · 막기(v10.485) — 원래 IP 는 남기지 않음(앞 두 마디 · 지문만)',
        'IPINFO', 'NOT_STARTED', false, 'GEOIP_API_KEY', NULL, false,
        '업체(ipinfo · 한국인터넷진흥원 후이즈 OpenAPI 등) 선정 · 약관 · 국외 이전 여부(법무) 확인 뒤 GEOIP_API_KEY 를 운영 화면 › 외부 연동 › 「연동 키」에 · 주소 틀 GEOIP_API_BASE({ip} · {key}) · 나라 칸 GEOIP_COUNTRY_PATH 는 .env · 그 전에는 security.geo_mode = ASSUME(간주).',
        coalesce((SELECT max(sort_order) + 10 FROM public.integrations), 170))
ON CONFLICT (code) DO NOTHING;

/* GEOIP_API_KEY — ㉝ D264 의 CHECK · 함수를 그대로 복사해 이 이름만 더함(D264 가 먼저 합쳐짐 · ㉟ ~ ㊲ 이 같은 것을 더하면 목록을 합칠 것) */
ALTER TABLE public.integration_secrets DROP CONSTRAINT IF EXISTS ck_integ_secret_name;
ALTER TABLE public.integration_secrets ADD CONSTRAINT ck_integ_secret_name
  CHECK ((integration_code, name) IN (
    ('MAP','KAKAO_REST_KEY'), ('MAP','KAKAO_JS_KEY'), ('WEATHER','KMA_SERVICE_KEY'), ('AGENT','ANTHROPIC_API_KEY'),
    ('PG','TOSS_SECRET_KEY'), ('PG','TOSS_CLIENT_KEY'), ('BANK','BANK_VERIFY_KEY'), ('NTS','NTS_SERVICE_KEY'),
    ('BROKER','BROKER_LOOKUP_KEY'), ('ETAX','ETAX_KEY'), ('MAIL','SMTP_PASS'), ('MAIL','SMTP_USER'),
    ('PASS','PASS_API_KEY'), ('PASS','NICE_CLIENT_ID'), ('PASS','NICE_CLIENT_SECRET'), ('PASS','NICE_PRODUCT_ID'), ('ESIGN','ESIGN_API_KEY'), ('ESIGN','ESIGN_WEBHOOK_SECRET'), ('ALIMTALK','ALIMTALK_KEY'), ('ALIMTALK','ALIMTALK_SENDER_KEY'), ('SAFENUM','SAFENUM_KEY'), ('SAFENUM','SAFENUM_WEBHOOK_SECRET'),
    ('MAIL','TELEGRAM_BOT_TOKEN'), ('MAIL','SLACK_WEBHOOK_URL'),
    ('TAXINBOX','TAXINBOX_API_KEY'),   -- v10.432 (D255)
    ('FIRMBANK','FIRMBANK_CLIENT_ID'), ('FIRMBANK','FIRMBANK_CLIENT_SECRET'),   -- v10.454 (D261 · 금융결제원 오픈뱅킹)
    ('FIRMBANK','FIRMBANK_USER_TOKEN'),   -- v10.467 (D264 · 은행 거래내역 자동 조회 — 오픈뱅킹 사용자 토큰)
    ('GEOIP','GEOIP_API_KEY')));   -- v10.485 (D268 · IP 국가 판별)

/* fn_integ_secret_set — D264 그대로 + GEOIP_API_KEY(v10.485 · 업체 키 · 8 ~ 512자 일반 모양) */
CREATE OR REPLACE FUNCTION public.fn_integ_secret_set(p_code text, p_name text, p_value text, p_actor uuid)
 RETURNS TABLE(o_name text, o_last4 text, o_updated_at timestamptz) LANGUAGE plpgsql AS $function$
/* 돌려주는 칸 이름에 o_ 를 붙입니다 — 표의 칸(name · last4 · updated_at)과 이름이 같으면 plpgsql 이 「모호함」으로 멈춥니다 */
DECLARE v text := btrim(coalesce(p_value, ''));
BEGIN
  IF p_name IN ('KMA_SERVICE_KEY', 'NTS_SERVICE_KEY') THEN
    /* 공공데이터포털 일반 인증키 — Decoding(+ / =) 또는 Encoding(%2B …) 어느 쪽이든 받습니다 */
    IF v !~ '^[A-Za-z0-9+/=%]{20,200}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 공공데이터포털 › 마이페이지 › 활용 신청 상세의 「일반 인증키(Decoding)」를 붙여 넣으십시오.';
    END IF;
  ELSIF p_name = 'ANTHROPIC_API_KEY' THEN
    /* v10.111 — API 키만(sk-ant-api…). 관리 키(sk-ant-admin…) · 사용자 키(sk-ant-usr…)는 쓰지 않습니다 */
    IF v !~ '^sk-ant-api[A-Za-z0-9_-]{20,250}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — Anthropic 콘솔 › API Keys 에서 만든 키(sk-ant-api 로 시작)를 붙여 넣으십시오.';
    END IF;
  ELSIF p_name = 'TOSS_SECRET_KEY' THEN
    /* 토스페이먼츠 시크릿 키 — test_sk_ · live_sk_ (결제위젯은 gsk) */
    IF v !~ '^(test|live)_g?sk_[A-Za-z0-9_]{8,200}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 토스페이먼츠 개발자센터 › API 키의 「시크릿 키」(test_sk_ · live_sk_ 로 시작)를 붙여 넣으십시오.';
    END IF;
  ELSIF p_name = 'TOSS_CLIENT_KEY' THEN
    /* 결제창 클라이언트 키 — 브라우저에 나가는 공개 키(test_ck_ · live_ck_ · 결제위젯은 gck) */
    IF v !~ '^(test|live)_g?ck_[A-Za-z0-9_]{8,200}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 토스페이먼츠 개발자센터 › API 키의 「클라이언트 키」(test_ck_ · live_ck_ 로 시작)를 붙여 넣으십시오.';
    END IF;
  ELSIF p_name = 'SMTP_PASS' THEN
    /* SES SMTP 비밀번호 — base64 모양 */
    IF v !~ '^[A-Za-z0-9+/=]{20,128}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — SES 콘솔 › SMTP 설정 › 「SMTP 자격 증명」의 비밀번호를 붙여 넣으십시오(IAM 액세스 키가 아닙니다).';
    END IF;
  ELSIF p_name = 'SMTP_USER' THEN
    /* v10.140 — SES SMTP 사용자 이름(보통 AKIA 로 시작하는 20자 · 영문 대문자 · 숫자) */
    IF v !~ '^[A-Z0-9]{16,128}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — SES 콘솔 › SMTP 설정 › 「SMTP 자격 증명」의 사용자 이름(영문 대문자 · 숫자)을 붙여 넣으십시오.';
    END IF;
  ELSIF p_name = 'SLACK_WEBHOOK_URL' THEN
    /* v10.237 (D200) — 슬랙 앱 › Incoming Webhooks 가 준 주소「https://hooks.slack.com/services/T…/B…/…」 */
    IF v !~ '^https://hooks\.slack\.com/services/[A-Za-z0-9]+/[A-Za-z0-9]+/[A-Za-z0-9]+$' OR length(v) > 300 THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 주소 형식이 아닙니다 — 슬랙 앱 › Incoming Webhooks 의 「Webhook URL」(https://hooks.slack.com/services/ 로 시작)을 붙여 넣으십시오.';
    END IF;
  ELSIF p_name = 'TELEGRAM_BOT_TOKEN' THEN
    /* v10.200 (D178) — BotFather 가 준 토큰「123456789:AA…」(숫자 · 쌍점 · 영문 · 숫자 · _ · -) */
    IF v !~ '^[0-9]{5,15}:[A-Za-z0-9_-]{30,64}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 텔레그램 BotFather 가 준 토큰(숫자:영문 · 숫자 — 예 123456789:AA…)을 붙여 넣으십시오.';
    END IF;
  ELSIF p_name IN ('BANK_VERIFY_KEY', 'BROKER_LOOKUP_KEY', 'ETAX_KEY', 'PASS_API_KEY', 'ESIGN_API_KEY', 'ALIMTALK_KEY', 'SAFENUM_KEY',
                  'NICE_CLIENT_ID', 'NICE_CLIENT_SECRET', 'NICE_PRODUCT_ID', 'ALIMTALK_SENDER_KEY', 'ESIGN_WEBHOOK_SECRET', 'SAFENUM_WEBHOOK_SECRET',
                  'TAXINBOX_API_KEY', 'FIRMBANK_CLIENT_ID', 'FIRMBANK_CLIENT_SECRET', 'FIRMBANK_USER_TOKEN', 'GEOIP_API_KEY') THEN   -- v10.485 (D268) IP 국가 판별 키도 일반 모양   -- v10.467 (D264) 사용자 토큰도 일반 모양   -- v10.432 (D255) 매입 세금계산서 연동 업체 키 · v10.454 (D261) 금융결제원 오픈뱅킹 키
    /* 업체마다 모양이 달라 「빈칸 없는 영문 · 숫자 · 기호 8 ~ 512자」만 봅니다(PostgreSQL 정규식 반복 수는 255 까지라 길이는 따로) */
    IF length(v) NOT BETWEEN 8 AND 512 OR v !~ '^[!-~]+$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 업체에서 받은 키를 빈칸 없이 붙여 넣으십시오(8 ~ 512자).';
    END IF;
  ELSIF v !~ '^[A-Za-z0-9_-]{16,128}$' THEN
    RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 카카오 콘솔 「앱 키」에서 복사한 값(영문 · 숫자 16 ~ 128자)을 붙여 넣으십시오.';
  END IF;
  INSERT INTO public.integration_secrets AS s (integration_code, name, value_enc, last4, is_public, updated_by, updated_at)
  VALUES (p_code, p_name, pgp_sym_encrypt(v, public.fn_enc_key()), right(v, 4), p_name IN ('KAKAO_JS_KEY', 'TOSS_CLIENT_KEY'), p_actor, now())
  ON CONFLICT (integration_code, name) DO UPDATE
     SET value_enc = EXCLUDED.value_enc, last4 = EXCLUDED.last4, updated_by = EXCLUDED.updated_by, updated_at = now();
  IF p_name NOT IN ('KAKAO_JS_KEY', 'TOSS_CLIENT_KEY', 'TELEGRAM_BOT_TOKEN', 'SLACK_WEBHOOK_URL') THEN
    UPDATE public.integrations SET secret_registered = true WHERE code = p_code;
  END IF;
  RETURN QUERY SELECT s.name, s.last4, s.updated_at FROM public.integration_secrets s
                WHERE s.integration_code = p_code AND s.name = p_name;
END $function$;


/* ── ④ ㉕ 권한(D258) 시드에 새 탭 2개 — gen_seed.py 와 같은 규칙
 *   mkt-campaign(따로 적지 않은 탭 = ADMIN · 회원 묶음 admusr) · sec-geo(따로 적지 않은 탭 = ADMIN · 위험감지 묶음 admrsk)
 *   주소 규칙: GET = VIEW · /send · /run 끝 = APPROVE · 그 밖 변경 = EDIT
 *   패스키는 탭이 아님(「내 2단계 인증」 화면 안 구역 · /auth/passkey 는 로그인만 · /admin/passkeys 는 SUPER) — 시드 없음 */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('mkt-campaign', '문자 · 메일 캠페인', 'admusr', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2900),
  ('sec-geo', '해외 접속 경고', 'admrsk', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2910)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'mkt-campaign', 'VIEW'), ('R_ADMIN', 'mkt-campaign', 'EDIT'), ('R_ADMIN', 'mkt-campaign', 'APPROVE'), ('R_ADMIN', 'mkt-campaign', 'EXPORT'),
  ('R_ADMIN', 'sec-geo', 'VIEW'), ('R_ADMIN', 'sec-geo', 'EDIT'), ('R_ADMIN', 'sec-geo', 'APPROVE'), ('R_ADMIN', 'sec-geo', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/marketing/campaigns', 'mkt-campaign', 'VIEW'),
  ('GET', '/admin/marketing/campaigns/{id}', 'mkt-campaign', 'VIEW'),
  ('GET', '/admin/marketing/campaigns/{id}/audience', 'mkt-campaign', 'VIEW'),
  ('POST', '/admin/marketing/campaigns', 'mkt-campaign', 'EDIT'),
  ('PUT', '/admin/marketing/campaigns/{id}', 'mkt-campaign', 'EDIT'),
  ('POST', '/admin/marketing/campaigns/{id}/test', 'mkt-campaign', 'EDIT'),
  ('POST', '/admin/marketing/campaigns/{id}/send', 'mkt-campaign', 'APPROVE'),
  ('POST', '/admin/marketing/campaigns/{id}/cancel', 'mkt-campaign', 'EDIT'),
  ('POST', '/admin/marketing/run', 'mkt-campaign', 'APPROVE'),
  ('PUT', '/admin/marketing/settings', 'mkt-campaign', 'EDIT'),
  ('GET', '/admin/security/geo', 'sec-geo', 'VIEW'),
  ('PUT', '/admin/security/geo', 'sec-geo', 'EDIT'),
  ('POST', '/admin/security/geo/test', 'sec-geo', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

