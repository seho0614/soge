-- v10.432 (docs/569) — 홈택스 매입 세금계산서 가져오기(㉒): 연동 업체 어댑터 · 받은 매입함(승인번호 한 번) · 사람이 확인하면 매입으로 · 처음 꺼짐 · 간주
--   대표 11/19 「모두개발」 · 「이카운트 연동은 보류」. 다시 돌려도 같음.

/* ── v10.432 (docs/569) 홈택스 매입 세금계산서 가져오기 ─────────────────────────────
 *   대표 11/19 「모두개발」 → ㉒ 는 이것 하나(이카운트 연동은 보류).
 *   ① 외부 연동 TAXINBOX(연동 업체 API · 키는 외부 연동 › 연동 키 · 오픈 차단 아님)  ② acct_tax_inbox(쌓기만 · 승인번호 하나에 한 줄)
 *   ③ acct_tax_inbox_fetches(가져오기 기록 · 쌓기만)  ④ 설정 acct.taxinbox(off) · _mode(ASSUME) · _provider(GENERIC) · 정기 작업 acct_taxinbox(08:10)
 * ------------------------------------------------------------------------------- */
INSERT INTO public.integrations (code, name, purpose, provider, status, requires_ip, secret_key_name, lead_time_weeks, blocks_open, memo, sort_order)
VALUES ('TAXINBOX', '매입 세금계산서 가져오기', '홈택스에 쌓인 매입 전자세금계산서를 연동 업체(바로빌 · 팝빌 등) API 로 가져와 매입 관리로 넘김(v10.432)',
        NULL, 'NOT_STARTED', false, 'TAXINBOX_API_KEY', NULL, false,
        '업체 계약 뒤 키를 운영 화면 › 외부 연동 › 「연동 키」에 · 주소(TAXINBOX_API_BASE) · 우리 사업자번호(TAXINBOX_CORP_NUM)는 .env · 그 전에는 acct.taxinbox_mode = ASSUME(간주).',
        coalesce((SELECT max(sort_order) + 10 FROM public.integrations), 150))
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.integration_secrets DROP CONSTRAINT IF EXISTS ck_integ_secret_name;
ALTER TABLE public.integration_secrets ADD CONSTRAINT ck_integ_secret_name
  CHECK ((integration_code, name) IN (
    ('MAP','KAKAO_REST_KEY'), ('MAP','KAKAO_JS_KEY'), ('WEATHER','KMA_SERVICE_KEY'), ('AGENT','ANTHROPIC_API_KEY'),
    ('PG','TOSS_SECRET_KEY'), ('PG','TOSS_CLIENT_KEY'), ('BANK','BANK_VERIFY_KEY'), ('NTS','NTS_SERVICE_KEY'),
    ('BROKER','BROKER_LOOKUP_KEY'), ('ETAX','ETAX_KEY'), ('MAIL','SMTP_PASS'), ('MAIL','SMTP_USER'),
    ('PASS','PASS_API_KEY'), ('PASS','NICE_CLIENT_ID'), ('PASS','NICE_CLIENT_SECRET'), ('PASS','NICE_PRODUCT_ID'), ('ESIGN','ESIGN_API_KEY'), ('ESIGN','ESIGN_WEBHOOK_SECRET'), ('ALIMTALK','ALIMTALK_KEY'), ('ALIMTALK','ALIMTALK_SENDER_KEY'), ('SAFENUM','SAFENUM_KEY'), ('SAFENUM','SAFENUM_WEBHOOK_SECRET'),
    ('MAIL','TELEGRAM_BOT_TOKEN'), ('MAIL','SLACK_WEBHOOK_URL'),
    ('TAXINBOX','TAXINBOX_API_KEY')));   -- v10.432 (D255)

/* fn_integ_secret_set — D200 그대로 + TAXINBOX_API_KEY(업체 키 · 8 ~ 512자 일반 모양) */
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
                  'TAXINBOX_API_KEY') THEN   -- v10.432 (D255) 매입 세금계산서 연동 업체 키
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

CREATE TABLE IF NOT EXISTS public.acct_tax_inbox (
  id               bigserial PRIMARY KEY,
  approval_no      text NOT NULL UNIQUE CHECK (approval_no ~ '^[0-9]{24}$'),
  issued_on        date NOT NULL,
  supplier_biz_no  text CHECK (supplier_biz_no IS NULL OR supplier_biz_no ~ '^[0-9]{10}$'),
  supplier_name    text NOT NULL CHECK (char_length(supplier_name) BETWEEN 1 AND 120),
  item             text NOT NULL CHECK (char_length(item) BETWEEN 1 AND 120),
  supply           bigint NOT NULL CHECK (supply >= 0),
  vat              bigint NOT NULL CHECK (vat >= 0),
  exempt           boolean NOT NULL DEFAULT false,
  source           text NOT NULL CHECK (source IN ('ASSUME', 'PROVIDER')),
  provider         text NOT NULL CHECK (provider IN ('GENERIC', 'POPBILL', 'BAROBILL')),
  row_hash         text NOT NULL CHECK (row_hash ~ '^[0-9a-f]{64}$'),
  state            text NOT NULL DEFAULT 'NEW' CHECK (state IN ('NEW', 'BOOKED', 'IGNORED')),
  purchase_id      bigint REFERENCES public.acct_purchases(id),
  ignore_note      text CHECK (ignore_note IS NULL OR char_length(btrim(ignore_note)) BETWEEN 2 AND 200),
  decided_by       uuid REFERENCES public.accounts(id),
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ati_state CHECK ((state = 'NEW' AND purchase_id IS NULL AND ignore_note IS NULL)
                              OR (state = 'BOOKED' AND purchase_id IS NOT NULL)
                              OR (state = 'IGNORED' AND ignore_note IS NOT NULL AND purchase_id IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_acct_tax_inbox_day ON public.acct_tax_inbox (issued_on, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_acct_tax_inbox_purchase ON public.acct_tax_inbox (purchase_id) WHERE purchase_id IS NOT NULL;
COMMENT ON TABLE public.acct_tax_inbox IS 'v10.432 (D255) 가져온 매입 전자세금계산서 — 승인번호 하나에 한 줄 · 내용 못 고침 · NEW → BOOKED(매입) · IGNORED(사유) · 지우지 않음';

CREATE OR REPLACE FUNCTION public.fn_acct_tax_inbox_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'TAXINBOX_LOCKED: 가져온 세금계산서 줄은 지우지 않습니다.'; END IF;
  IF (NEW.approval_no, NEW.issued_on, NEW.supplier_biz_no, NEW.supplier_name, NEW.item, NEW.supply, NEW.vat, NEW.exempt, NEW.source, NEW.provider, NEW.row_hash, NEW.created_at)
     IS DISTINCT FROM (OLD.approval_no, OLD.issued_on, OLD.supplier_biz_no, OLD.supplier_name, OLD.item, OLD.supply, OLD.vat, OLD.exempt, OLD.source, OLD.provider, OLD.row_hash, OLD.created_at) THEN
    RAISE EXCEPTION 'TAXINBOX_LOCKED: 가져온 세금계산서 내용은 고치지 않습니다.';
  END IF;
  IF OLD.state <> 'NEW' AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'TAXINBOX_STATE: 이미 처리한 줄입니다.';
  END IF;
  IF OLD.state <> 'NEW' AND (NEW.purchase_id, NEW.ignore_note) IS DISTINCT FROM (OLD.purchase_id, OLD.ignore_note) THEN
    RAISE EXCEPTION 'TAXINBOX_STATE: 이미 처리한 줄입니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_tax_inbox_guard' AND tgrelid = 'public.acct_tax_inbox'::regclass) THEN
    CREATE TRIGGER trg_acct_tax_inbox_guard BEFORE UPDATE OR DELETE ON public.acct_tax_inbox FOR EACH ROW EXECUTE FUNCTION public.fn_acct_tax_inbox_guard();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.acct_tax_inbox_fetches (
  id          bigserial PRIMARY KEY,
  from_on     date NOT NULL,
  to_on       date NOT NULL CHECK (to_on >= from_on),
  mode        text NOT NULL CHECK (mode IN ('ASSUME', 'LIVE')),
  provider    text NOT NULL CHECK (provider IN ('GENERIC', 'POPBILL', 'BAROBILL')),
  got         integer NOT NULL DEFAULT 0 CHECK (got >= 0),
  added       integer NOT NULL DEFAULT 0 CHECK (added >= 0),
  dup         integer NOT NULL DEFAULT 0 CHECK (dup >= 0),
  skipped     integer NOT NULL DEFAULT 0 CHECK (skipped >= 0),
  error       text CHECK (error IS NULL OR char_length(error) <= 200),
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.acct_tax_inbox_fetches IS 'v10.432 (D255) 매입 세금계산서 가져오기 기록 — 쌓기만(키 · 개인정보 없음)';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_tax_inbox_fetches_ro' AND tgrelid = 'public.acct_tax_inbox_fetches'::regclass) THEN
    CREATE TRIGGER trg_acct_tax_inbox_fetches_ro BEFORE UPDATE OR DELETE ON public.acct_tax_inbox_fetches FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('acct.taxinbox', 'off', 'ADMIN', 'v10.432 매입 세금계산서 가져오기 켜기(처음 off · SUPER) — 켜면 매일 08:10 지난 7일을 가져옴 · 화면 「가져오기」', false, '^(on|off)$', 'off'),
       ('acct.taxinbox_mode', 'ASSUME', 'ADMIN', 'v10.432 ASSUME = 업체에 묻지 않고 간주 줄 · LIVE = 연동 업체 API(키 · 주소 · 사업자번호가 있어야 함)', false, '^(ASSUME|LIVE)$', 'ASSUME'),
       ('acct.taxinbox_provider', 'GENERIC', 'ADMIN', 'v10.432 연동 업체(응답 칸 이름 기본값만 다름 · 업체 문서로 확인 필요 · .env TAXINBOX_MAP 로 고침)', false, '^(GENERIC|POPBILL|BAROBILL)$', 'GENERIC')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('acct_taxinbox', 1440, 8, 10, NULL, true, '매입 세금계산서 가져오기 — 매일 08:10 지난 7일(acct.taxinbox 가 on 일 때만) · D255 · v10.432')
ON CONFLICT (job) DO NOTHING;

