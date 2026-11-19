/* D261 (v10.453 ~ 456 · docs/590 ~ 593) ㉘㉙ 자금 · 영업 — 법인카드 한도 · 대량 이체(금융결제원 오픈뱅킹 어댑터 · 처음 off · 간주 · 2명 승인) · 매출 목표 대비 실적 · 거래처별 원장 · 외부 연동 15종(FIRMBANK) */

/* ── ① 법인카드 한도 · 사용자별 사용 (v10.453 · docs/590) ─────────────────────────────
 *   카드(⑫ acct_card_txns.card_tail 끝 4자리)마다 이름 · 쓰는 사람 · 달 한도(SUPER) · 바꾼 기록(쌓기만 · 사유)
 *   달 사용 = 그 달 이용 줄 합(취소 음수 포함 · IGNORED 뺌) · acct.card_alert_pct(처음 80) 넘으면 운영 알림 ACCT_CARD_LIMIT · 한도 넘으면 한 번 더
 *   정기 작업 acct_card_limit(매일 09:40 · acct.card_alert off 면 알리지 않고 열린 알림은 풀음) */
CREATE TABLE IF NOT EXISTS public.acct_card_limits (
  card_tail      text PRIMARY KEY CHECK (card_tail ~ '^[0-9*]{1,4}$'),
  name           text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  holder_id      uuid REFERENCES public.accounts(id),
  monthly_limit  bigint NOT NULL CHECK (monthly_limit BETWEEN 1 AND 1000000000000),
  active         boolean NOT NULL DEFAULT true,
  updated_by     uuid REFERENCES public.accounts(id),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.acct_card_limits IS 'v10.453 (D261) 법인카드 한도 — 카드 끝 4자리(⑫ 카드 CSV 와 같음)마다 이름 · 쓰는 사람 · 달 한도 · SUPER 가 정함';

CREATE TABLE IF NOT EXISTS public.acct_card_limit_changes (
  id          bigserial PRIMARY KEY,
  card_tail   text NOT NULL,
  before      jsonb,
  after       jsonb NOT NULL,
  reason      text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 2 AND 200),
  changed_by  uuid REFERENCES public.accounts(id),
  changed_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.acct_card_limit_changes IS 'v10.453 (D261) 법인카드 한도 바꾼 기록 — 쌓기만 · 사유';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_card_limit_changes_ro' AND tgrelid = 'public.acct_card_limit_changes'::regclass) THEN
    CREATE TRIGGER trg_acct_card_limit_changes_ro BEFORE UPDATE OR DELETE ON public.acct_card_limit_changes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_act_tail_day ON public.acct_card_txns (card_tail, used_on);

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('acct.card_alert', 'on', 'ADMIN', '법인카드 한도 알림(v10.453 · D261) — on 이면 매일 09:40 이번 달 사용이 한도의 acct.card_alert_pct 를 넘은 카드를 운영 알림(ACCT_CARD_LIMIT)', false, '^(on|off)$', 'on'),
  ('acct.card_alert_pct', '80', 'ADMIN', '법인카드 한도 알림 기준(퍼센트 · 50 ~ 100 · 처음 80 · v10.453) — 이만큼 쓰면 한 번 · 한도를 넘으면 한 번 더', false, '^([5-9][0-9]|100)$', '80')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('acct_card_limit', 1440, 9, 40, NULL, true, '법인카드 한도 알림 — 매일 09:40 · 이번 달 사용이 기준을 넘은 카드(acct.card_alert on 일 때) · D261 · v10.453')
ON CONFLICT (job) DO NOTHING;


/* ── ② 대량 이체 — 금융결제원 오픈뱅킹 어댑터 (v10.454 · docs/591 · 대표 11/20 「금융결제원을 이용한다」) ──────────
 *   외부 연동 FIRMBANK(provider KFTC · 키 FIRMBANK_CLIENT_ID · FIRMBANK_CLIENT_SECRET 는 외부 연동 › 연동 키 · 오픈 차단 아님 · assume.* 아님)
 *   수취조회(이름 다르면 HOLD · 안 보냄) → 거래고유번호(이용기관코드 + U + 9자리 · 줄에 저장 · UNIQUE) → 입금이체 → 처리 중은 PENDING · 결과조회로만 확정(다시 안 보냄)
 *   acct.transfer      on | off(처음 off)      — 「보내기」 자체를 켬(만들기 · 승인은 꺼져도 됨)
 *   acct.transfer_mode ASSUME | LIVE(처음 ASSUME) — ASSUME 이면 은행에 보내지 않고 간주 결과(전표 없음)
 *   acct.transfer_max  한 묶음 합계 상한(처음 5천만 원)
 *   흐름: 묶음 만들기(DRAFT) → 줄 넣기 · 빼기 → 만든 사람이 아닌 2명 승인(APPROVED) → 보내기(SENT · PARTIAL · FAILED) · 취소(보내기 전)
 *   계좌번호는 암호문(fn_enc_key) + 끝 4자리만 보임 · LIVE 로 보낸 줄(OK)만 전표 TRANSFER_PAID(차변 낸 계정(처음 AP) / 대변 보통예금) */
INSERT INTO public.integrations (code, name, purpose, provider, status, requires_ip, secret_key_name, lead_time_weeks, blocks_open, memo, sort_order)
VALUES ('FIRMBANK', '대량 이체(금융결제원 오픈뱅킹)', '거래처 대금 · 경비를 묶음으로 금융결제원 오픈뱅킹 입금이체(v10.454) — 만든 사람이 아닌 2명 승인 뒤 · 수취조회로 이름 확인',
        'KFTC', 'NOT_STARTED', false, 'FIRMBANK_CLIENT_SECRET', NULL, false,
        '금융결제원 오픈뱅킹 이용기관 등록(일반 법인 가능 여부 · 보안 점검 · 약정계좌 · 수수료 — 대표 확인 · 안 되면 거래 은행 펌뱅킹을 같은 어댑터 자리에) 뒤 FIRMBANK_CLIENT_ID · FIRMBANK_CLIENT_SECRET 을 운영 화면 › 외부 연동 › 「연동 키」에 · 이용기관코드(FIRMBANK_ORG_CODE) · 약정계좌(FIRMBANK_CNTR_ACCOUNT) · FIRMBANK_ENV(TEST → PROD)는 .env · 발신 IP 3.37.95.217 등록 · 그 전에는 acct.transfer_mode = ASSUME(간주).',
        coalesce((SELECT max(sort_order) + 10 FROM public.integrations), 160))
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.integration_secrets DROP CONSTRAINT IF EXISTS ck_integ_secret_name;
ALTER TABLE public.integration_secrets ADD CONSTRAINT ck_integ_secret_name
  CHECK ((integration_code, name) IN (
    ('MAP','KAKAO_REST_KEY'), ('MAP','KAKAO_JS_KEY'), ('WEATHER','KMA_SERVICE_KEY'), ('AGENT','ANTHROPIC_API_KEY'),
    ('PG','TOSS_SECRET_KEY'), ('PG','TOSS_CLIENT_KEY'), ('BANK','BANK_VERIFY_KEY'), ('NTS','NTS_SERVICE_KEY'),
    ('BROKER','BROKER_LOOKUP_KEY'), ('ETAX','ETAX_KEY'), ('MAIL','SMTP_PASS'), ('MAIL','SMTP_USER'),
    ('PASS','PASS_API_KEY'), ('PASS','NICE_CLIENT_ID'), ('PASS','NICE_CLIENT_SECRET'), ('PASS','NICE_PRODUCT_ID'), ('ESIGN','ESIGN_API_KEY'), ('ESIGN','ESIGN_WEBHOOK_SECRET'), ('ALIMTALK','ALIMTALK_KEY'), ('ALIMTALK','ALIMTALK_SENDER_KEY'), ('SAFENUM','SAFENUM_KEY'), ('SAFENUM','SAFENUM_WEBHOOK_SECRET'),
    ('MAIL','TELEGRAM_BOT_TOKEN'), ('MAIL','SLACK_WEBHOOK_URL'),
    ('TAXINBOX','TAXINBOX_API_KEY'),   -- v10.432 (D255)
    ('FIRMBANK','FIRMBANK_CLIENT_ID'), ('FIRMBANK','FIRMBANK_CLIENT_SECRET')));   -- v10.454 (D261 · 금융결제원 오픈뱅킹)

/* fn_integ_secret_set — D255 그대로 + FIRMBANK_CLIENT_ID · FIRMBANK_CLIENT_SECRET(금융결제원 오픈뱅킹 · 8 ~ 512자 일반 모양) */
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
                  'TAXINBOX_API_KEY', 'FIRMBANK_CLIENT_ID', 'FIRMBANK_CLIENT_SECRET') THEN   -- v10.432 (D255) 매입 세금계산서 연동 업체 키 · v10.454 (D261) 금융결제원 오픈뱅킹 키
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

CREATE TABLE IF NOT EXISTS public.acct_transfer_batches (
  id           bigserial PRIMARY KEY,
  title        text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 80),
  pay_on       date NOT NULL,
  state        text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'APPROVED', 'CHECKING', 'SENT', 'PARTIAL', 'FAILED', 'CANCELED')),
  mode         text CHECK (mode IS NULL OR mode IN ('ASSUME', 'LIVE')),
  item_count   integer NOT NULL DEFAULT 0 CHECK (item_count BETWEEN 0 AND 200),
  total        bigint NOT NULL DEFAULT 0 CHECK (total >= 0),
  created_by   uuid NOT NULL REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  approved_at  timestamptz,
  sent_by      uuid REFERENCES public.accounts(id),
  sent_at      timestamptz,
  canceled_at  timestamptz,
  cancel_note  text CHECK (cancel_note IS NULL OR char_length(cancel_note) <= 200),
  CONSTRAINT ck_atb_cancel CHECK (state <> 'CANCELED' OR (canceled_at IS NOT NULL AND char_length(btrim(coalesce(cancel_note, ''))) >= 2)),
  CONSTRAINT ck_atb_sent CHECK (state NOT IN ('CHECKING', 'SENT', 'PARTIAL', 'FAILED') OR (sent_at IS NOT NULL AND mode IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT ck_atb_approved CHECK (state <> 'APPROVED' OR approved_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_atb_state ON public.acct_transfer_batches (state, pay_on DESC);
COMMENT ON TABLE public.acct_transfer_batches IS 'v10.454 (D261) 대량 이체 묶음 — DRAFT → 2명 승인 APPROVED → CHECKING(보냄 · 결과 확인 중) → SENT · PARTIAL · FAILED · 취소는 보내기 전 · 지우지 않음';

CREATE TABLE IF NOT EXISTS public.acct_transfer_items (
  id           bigserial PRIMARY KEY,
  batch_id     bigint NOT NULL REFERENCES public.acct_transfer_batches(id),
  party_id     bigint REFERENCES public.acct_parties(id),
  payee        text NOT NULL CHECK (char_length(btrim(payee)) BETWEEN 1 AND 40),
  bank_code    text NOT NULL CHECK (bank_code ~ '^[0-9]{3}$'),
  acct_no_enc  bytea NOT NULL,
  acct_last4   text NOT NULL CHECK (acct_last4 ~ '^[0-9]{4}$'),
  amount       bigint NOT NULL CHECK (amount BETWEEN 1 AND 1000000000),
  pay_role     text NOT NULL DEFAULT 'AP' REFERENCES public.acct_accounts(role),
  memo         text CHECK (memo IS NULL OR char_length(memo) <= 20),
  result       text CHECK (result IS NULL OR result IN ('OK', 'FAIL', 'ASSUMED', 'HOLD', 'PENDING')),
  bank_tran_id text UNIQUE CHECK (bank_tran_id IS NULL OR bank_tran_id ~ '^[A-Za-z0-9]{10}U[0-9]{9}$'),
  bank_rsp_code text CHECK (bank_rsp_code IS NULL OR char_length(bank_rsp_code) <= 10),
  result_code  text CHECK (result_code IS NULL OR char_length(result_code) <= 40),
  result_msg   text CHECK (result_msg IS NULL OR char_length(result_msg) <= 200),
  bank_tx_id   text CHECK (bank_tx_id IS NULL OR char_length(bank_tx_id) <= 60),
  done_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ati_done CHECK ((result IS NULL) = (done_at IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_ati_batch ON public.acct_transfer_items (batch_id, id);
COMMENT ON TABLE public.acct_transfer_items IS 'v10.454 (D261) 대량 이체 줄 — 받는 분 · 은행 코드 · 계좌(암호문 · 끝 4자리) · 금액 · 낸 계정 · 결과(한 번만 · OK · FAIL · ASSUMED · HOLD 수취조회로 안 보냄 · PENDING 처리 중 → 결과조회로만 확정) · 거래고유번호(UNIQUE · 다시 안 씀)';

CREATE TABLE IF NOT EXISTS public.acct_transfer_approvals (
  batch_id     bigint NOT NULL REFERENCES public.acct_transfer_batches(id),
  approver     uuid NOT NULL REFERENCES public.accounts(id),
  note         text CHECK (note IS NULL OR char_length(note) <= 200),
  approved_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, approver)
);
COMMENT ON TABLE public.acct_transfer_approvals IS 'v10.454 (D261) 대량 이체 승인 — 만든 사람이 아닌 사람 · 한 사람 한 번 · 2명이면 묶음 APPROVED · 쌓기만';

/* 묶음 — 지우지 않음 · 내용(제목 · 지급일 · 만든 사람)은 DRAFT 에서만 · 상태는 앞으로만 · APPROVED 는 승인 2명 + 줄 합이 맞아야 */
CREATE OR REPLACE FUNCTION public.fn_acct_transfer_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_n integer; v_sum bigint; v_apv integer;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_TRANSFER: 이체 묶음은 지우지 않습니다(취소로).'; END IF;
  IF (NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'ACCT_TRANSFER: 만든 사람 · 시각은 고치지 않습니다.';
  END IF;
  IF OLD.state <> 'DRAFT' AND (NEW.title, NEW.pay_on, NEW.item_count, NEW.total) IS DISTINCT FROM (OLD.title, OLD.pay_on, OLD.item_count, OLD.total) THEN
    RAISE EXCEPTION 'ACCT_TRANSFER_STATE: 승인 뒤에는 묶음 내용을 고치지 않습니다.';
  END IF;
  IF OLD.state = 'CHECKING' AND (NEW.mode, NEW.sent_by, NEW.sent_at, NEW.approved_at) IS DISTINCT FROM (OLD.mode, OLD.sent_by, OLD.sent_at, OLD.approved_at) THEN
    RAISE EXCEPTION 'ACCT_TRANSFER_STATE: 보낸 기록은 고치지 않습니다.';
  END IF;
  IF OLD.state IN ('SENT', 'PARTIAL', 'FAILED', 'CANCELED') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'ACCT_TRANSFER_STATE: 끝난 이체 묶음은 고치지 않습니다.';
  END IF;
  IF NEW.state <> OLD.state THEN
    IF NOT ((OLD.state = 'DRAFT' AND NEW.state IN ('APPROVED', 'CANCELED'))
         OR (OLD.state = 'APPROVED' AND NEW.state IN ('CHECKING', 'CANCELED'))
         OR (OLD.state = 'CHECKING' AND NEW.state IN ('SENT', 'PARTIAL', 'FAILED'))) THEN
      RAISE EXCEPTION 'ACCT_TRANSFER_STATE: 이체 묶음 상태는 앞으로만 바뀝니다.';
    END IF;
    IF NEW.state = 'APPROVED' THEN
      SELECT count(*), coalesce(sum(amount), 0) INTO v_n, v_sum FROM public.acct_transfer_items WHERE batch_id = NEW.id;
      SELECT count(*) INTO v_apv FROM public.acct_transfer_approvals WHERE batch_id = NEW.id AND approver <> NEW.created_by;
      IF v_n = 0 OR v_n <> NEW.item_count OR v_sum <> NEW.total THEN RAISE EXCEPTION 'ACCT_TRANSFER: 줄 수 · 합계가 묶음과 다릅니다.'; END IF;
      IF v_apv < 2 THEN RAISE EXCEPTION 'ACCT_TRANSFER_APPROVE: 만든 사람이 아닌 2명이 승인해야 합니다.'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_transfer_batch_guard' AND tgrelid = 'public.acct_transfer_batches'::regclass) THEN
    CREATE TRIGGER trg_acct_transfer_batch_guard BEFORE UPDATE OR DELETE ON public.acct_transfer_batches FOR EACH ROW EXECUTE FUNCTION public.fn_acct_transfer_batch_guard();
  END IF;
END $$;

/* 줄 — 넣기 · 빼기 · 고치기는 DRAFT 에서만 · 결과 칸은 APPROVED 묶음에서 한 번만(그 밖 칸은 그대로) */
CREATE OR REPLACE FUNCTION public.fn_acct_transfer_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_state text;
BEGIN
  SELECT state INTO v_state FROM public.acct_transfer_batches WHERE id = coalesce(NEW.batch_id, OLD.batch_id);
  IF TG_OP = 'UPDATE'
     AND (NEW.batch_id, NEW.party_id, NEW.payee, NEW.bank_code, NEW.acct_no_enc, NEW.acct_last4, NEW.amount, NEW.pay_role, NEW.memo, NEW.created_at)
         IS NOT DISTINCT FROM (OLD.batch_id, OLD.party_id, OLD.payee, OLD.bank_code, OLD.acct_no_enc, OLD.acct_last4, OLD.amount, OLD.pay_role, OLD.memo, OLD.created_at) THEN
    /* 거래고유번호 — 승인된 묶음에서 한 번만 · 바꾸거나 지우지 않음 */
    IF NEW.bank_tran_id IS DISTINCT FROM OLD.bank_tran_id THEN
      IF OLD.bank_tran_id IS NOT NULL OR v_state <> 'APPROVED' OR OLD.result IS NOT NULL OR NEW.result IS DISTINCT FROM OLD.result THEN
        RAISE EXCEPTION 'ACCT_TRANSFER: 거래고유번호는 보낼 때 한 번만 정합니다.';
      END IF;
      RETURN NEW;
    END IF;
    /* 결과 — 없음 → 결과(APPROVED · CHECKING) · PENDING → OK · FAIL · ASSUMED(CHECKING) · 확정된 결과는 고치지 않음 */
    IF OLD.result IS NULL AND NEW.result IS NOT NULL AND v_state IN ('APPROVED', 'CHECKING') THEN RETURN NEW; END IF;
    IF OLD.result = 'PENDING' AND NEW.result IN ('OK', 'FAIL', 'ASSUMED') AND v_state = 'CHECKING' THEN RETURN NEW; END IF;
    IF OLD.result IS NOT DISTINCT FROM NEW.result AND OLD.result = 'PENDING' AND v_state = 'CHECKING' THEN RETURN NEW; END IF;   -- 처리 중 메모만
    IF OLD.result IS NOT NULL THEN RAISE EXCEPTION 'ACCT_TRANSFER: 확정된 이체 결과는 고치지 않습니다.'; END IF;
  END IF;
  IF coalesce(v_state, '') <> 'DRAFT' THEN RAISE EXCEPTION 'ACCT_TRANSFER_STATE: 승인 뒤에는 이체 줄을 고치지 않습니다.'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.batch_id <> OLD.batch_id THEN RAISE EXCEPTION 'ACCT_TRANSFER: 줄을 다른 묶음으로 옮기지 않습니다.'; END IF;
  IF TG_OP <> 'DELETE' AND NEW.result IS NOT NULL THEN RAISE EXCEPTION 'ACCT_TRANSFER: 결과는 보낼 때만 채웁니다.'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_transfer_item_guard' AND tgrelid = 'public.acct_transfer_items'::regclass) THEN
    CREATE TRIGGER trg_acct_transfer_item_guard BEFORE INSERT OR UPDATE OR DELETE ON public.acct_transfer_items FOR EACH ROW EXECUTE FUNCTION public.fn_acct_transfer_item_guard();
  END IF;
END $$;

/* 승인 — 만든 사람은 못 함 · DRAFT 에서만 · 쌓기만 */
CREATE OR REPLACE FUNCTION public.fn_acct_transfer_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_state text; v_by uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'ACCT_TRANSFER: 승인 기록은 고치거나 지우지 않습니다.'; END IF;
  SELECT state, created_by INTO v_state, v_by FROM public.acct_transfer_batches WHERE id = NEW.batch_id;
  IF v_state IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'ACCT_TRANSFER_STATE: 승인을 기다리는 묶음이 아닙니다.'; END IF;
  IF NEW.approver = v_by THEN RAISE EXCEPTION 'ACCT_TRANSFER_SELF: 만든 사람은 승인하지 않습니다.'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_transfer_approval_guard' AND tgrelid = 'public.acct_transfer_approvals'::regclass) THEN
    CREATE TRIGGER trg_acct_transfer_approval_guard BEFORE INSERT OR UPDATE OR DELETE ON public.acct_transfer_approvals FOR EACH ROW EXECUTE FUNCTION public.fn_acct_transfer_approval_guard();
  END IF;
END $$;

/* 거래고유번호 — 이용기관코드(10자) + 'U' + 9자리 · 시퀀스라 하루 안은 물론 10억 번까지 겹치지 않음 · 줄의 UNIQUE 가 다시 확인 */
CREATE SEQUENCE IF NOT EXISTS public.acct_transfer_tran_seq;
CREATE OR REPLACE FUNCTION public.fn_acct_transfer_tran_id(p_org text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF p_org IS NULL OR p_org !~ '^[A-Za-z0-9]{10}$' THEN RAISE EXCEPTION 'ACCT_TRANSFER: 이용기관코드는 영문 · 숫자 10자입니다.'; END IF;
  RETURN p_org || 'U' || lpad((nextval('public.acct_transfer_tran_seq') % 1000000000)::text, 9, '0');
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('acct.transfer', 'off', 'ADMIN', '대량 이체 「보내기」(v10.454 · D261) — 처음 off · 만들기 · 승인은 꺼져도 됨 · 켜기 SUPER', false, '^(on|off)$', 'off'),
  ('acct.transfer_mode', 'ASSUME', 'ADMIN', '대량 이체 방식(v10.454) — ASSUME 은 은행에 보내지 않고 간주 결과(전표 없음) · LIVE 는 금융결제원 키(FIRMBANK_CLIENT_ID · FIRMBANK_CLIENT_SECRET) · .env FIRMBANK_ORG_CODE · FIRMBANK_CNTR_ACCOUNT 가 있어야', false, '^(ASSUME|LIVE)$', 'ASSUME'),
  ('acct.transfer_max', '50000000', 'ADMIN', '대량 이체 한 묶음 합계 상한(원 · v10.454 · 처음 5천만 원)', false, '^[0-9]{5,12}$', '50000000')
ON CONFLICT (key) DO NOTHING;


/* ── ③ 매출 목표 대비 실적 (v10.455 · docs/592) ────────────────────────────────────────
 *   달(YYYY-MM)마다 회사 전체(TOTAL) · 부서(DEPT · ㉓ acct_depts) · 담당자(OWNER · 운영자) 목표 금액(SUPER · 사유 · 바꾼 기록)
 *   실적: 전체 · 부서 = ㉓ 부서 손익(매출 계정 · 꼬리표) · 담당자 = 그 사람이 만든 거래명세서 중 그 달 확정한 공급가 합 */
CREATE TABLE IF NOT EXISTS public.acct_sales_targets (
  id          bigserial PRIMARY KEY,
  ym          text NOT NULL CHECK (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  axis        text NOT NULL CHECK (axis IN ('TOTAL', 'DEPT', 'OWNER')),
  dept_id     bigint REFERENCES public.acct_depts(id),
  owner_id    uuid REFERENCES public.accounts(id),
  amount      bigint NOT NULL CHECK (amount BETWEEN 0 AND 1000000000000),
  memo        text CHECK (memo IS NULL OR char_length(memo) <= 200),
  updated_by  uuid REFERENCES public.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ast_axis CHECK ((axis = 'TOTAL' AND dept_id IS NULL AND owner_id IS NULL)
                             OR (axis = 'DEPT' AND dept_id IS NOT NULL AND owner_id IS NULL)
                             OR (axis = 'OWNER' AND owner_id IS NOT NULL AND dept_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ast_target ON public.acct_sales_targets (ym, axis, coalesce(dept_id, 0), coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid));
COMMENT ON TABLE public.acct_sales_targets IS 'v10.455 (D261) 매출 목표 — 달 · 전체 · 부서 · 담당자마다 한 줄 · SUPER 가 정함(바꾸면 acct_target_changes)';

CREATE TABLE IF NOT EXISTS public.acct_target_changes (
  id          bigserial PRIMARY KEY,
  ym          text NOT NULL,
  axis        text NOT NULL,
  target_key  text NOT NULL,
  before      bigint,
  after       bigint NOT NULL,
  reason      text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 2 AND 200),
  changed_by  uuid REFERENCES public.accounts(id),
  changed_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.acct_target_changes IS 'v10.455 (D261) 매출 목표 바꾼 기록 — 쌓기만 · 사유';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_target_changes_ro' AND tgrelid = 'public.acct_target_changes'::regclass) THEN
    CREATE TRIGGER trg_acct_target_changes_ro BEFORE UPDATE OR DELETE ON public.acct_target_changes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;


/* ── ④ 거래처별 원장 (v10.456 · docs/593) — 표 없음 · 전표 거래처 이름(acct_entries.party)으로 찾음 ── */
CREATE INDEX IF NOT EXISTS ix_acct_entries_party ON public.acct_entries (party, entry_date, id);


/* ── ⑤ ㉕ 권한(D258) 시드에 새 탭 4개 — gen_seed.py 와 같은 규칙(탭 역할 = SUPER · PAYOUT · 세무사는 acct- 탭만 보기 · 내려받기) ── */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('acct-cardlimit', '법인카드 한도', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 975),
  ('fin-transfer', '대량 이체', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 976),
  ('acct-target', '매출 목표', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 977),
  ('acct-partyledger', '거래처 원장', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 978)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_PAYOUT', 'acct-cardlimit', 'VIEW'), ('R_PAYOUT', 'acct-cardlimit', 'EDIT'), ('R_PAYOUT', 'acct-cardlimit', 'APPROVE'), ('R_PAYOUT', 'acct-cardlimit', 'EXPORT'),
  ('R_PAYOUT', 'fin-transfer', 'VIEW'), ('R_PAYOUT', 'fin-transfer', 'EDIT'), ('R_PAYOUT', 'fin-transfer', 'APPROVE'), ('R_PAYOUT', 'fin-transfer', 'EXPORT'),
  ('R_PAYOUT', 'acct-target', 'VIEW'), ('R_PAYOUT', 'acct-target', 'EDIT'), ('R_PAYOUT', 'acct-target', 'APPROVE'), ('R_PAYOUT', 'acct-target', 'EXPORT'),
  ('R_PAYOUT', 'acct-partyledger', 'VIEW'), ('R_PAYOUT', 'acct-partyledger', 'EDIT'), ('R_PAYOUT', 'acct-partyledger', 'APPROVE'), ('R_PAYOUT', 'acct-partyledger', 'EXPORT'),
  ('R_ACCOUNTANT', 'acct-cardlimit', 'VIEW'), ('R_ACCOUNTANT', 'acct-cardlimit', 'EXPORT'),
  ('R_ACCOUNTANT', 'acct-target', 'VIEW'), ('R_ACCOUNTANT', 'acct-target', 'EXPORT'),
  ('R_ACCOUNTANT', 'acct-partyledger', 'VIEW'), ('R_ACCOUNTANT', 'acct-partyledger', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/acct/card-limits', 'acct-cardlimit', 'VIEW'),
  ('PUT', '/admin/acct/card-limits/{tail}', 'acct-cardlimit', 'EDIT'),
  ('GET', '/admin/fin/transfers', 'fin-transfer', 'VIEW'),
  ('GET', '/admin/fin/transfers/{id}', 'fin-transfer', 'VIEW'),
  ('POST', '/admin/fin/transfers', 'fin-transfer', 'EDIT'),
  ('POST', '/admin/fin/transfers/{id}/items', 'fin-transfer', 'EDIT'),
  ('POST', '/admin/fin/transfers/{id}/items/{itemId}/remove', 'fin-transfer', 'EDIT'),
  ('POST', '/admin/fin/transfers/{id}/approve', 'fin-transfer', 'APPROVE'),
  ('POST', '/admin/fin/transfers/{id}/send', 'fin-transfer', 'APPROVE'),
  ('POST', '/admin/fin/transfers/{id}/cancel', 'fin-transfer', 'EDIT'),
  ('POST', '/admin/fin/transfers/{id}/check', 'fin-transfer', 'EDIT'),
  ('GET', '/admin/acct/sales-targets', 'acct-target', 'VIEW'),
  ('PUT', '/admin/acct/sales-targets', 'acct-target', 'EDIT'),
  ('GET', '/admin/acct/party-ledger', 'acct-partyledger', 'VIEW'),
  ('GET', '/admin/acct/party-ledger/{id}', 'acct-partyledger', 'VIEW'),
  ('GET', '/admin/acct/party-ledger/{id}/export', 'acct-partyledger', 'EXPORT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

