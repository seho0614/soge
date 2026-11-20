/* D264 (v10.466 ~ 469 · docs/604 ~ 607) ㉝ 영업 · 자금 · 소개몰 — 영업 기회 CRM · 은행 거래내역 자동 조회(금융결제원 · 처음 off · 간주) · 문서 PDF(인쇄) · 소개몰 할인 쿠폰 · 기획전 */

/* D264 (v10.466 ~ 469 · docs/604 ~ 607) ㉝ 영업 · 자금 · 소개몰 — 영업 기회 CRM · 은행 거래내역 자동 조회(금융결제원 어댑터 재사용 · 처음 off · 간주) · 문서 PDF(인쇄 · DB 없음) · 소개몰 할인 쿠폰 · 기획전
 *   다시 돌려도 같음 · 지우는 문장은 CHECK 를 넓히는 두 줄뿐(DROP CONSTRAINT IF EXISTS → 바로 다시 ADD) · 외부 연동 수 그대로 15(FIRMBANK 재사용) */

/* ── ① 영업 기회 CRM (v10.466 · docs/604) ──────────────────────────────────────────
 *   거래처(acct_parties)마다 영업 기회 — 단계 상담(LEAD) → 견적(QUOTE · ㉓ 견적서 연결) → 계약(CONTRACT) → 성사(WON) · 실패(LOST · 사유)
 *   예상 매출 · 담당 · 다음 할 일 · 날짜 → 그날이 되면 운영 알림 SAL_OPP_DUE(매일 08:50 · sales.opp_remind on 일 때) · 지우지 않음 · 기록은 쌓기만 */
CREATE TABLE IF NOT EXISTS public.sal_opps (
  id                 bigserial PRIMARY KEY,
  party_id           bigint NOT NULL REFERENCES public.acct_parties(id),
  title              text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 120),
  stage              text NOT NULL DEFAULT 'LEAD' CHECK (stage IN ('LEAD', 'QUOTE', 'CONTRACT', 'WON', 'LOST')),
  expected_amount    bigint NOT NULL DEFAULT 0 CHECK (expected_amount BETWEEN 0 AND 1000000000000),
  owner_id           uuid REFERENCES public.accounts(id),
  next_action        text CHECK (next_action IS NULL OR char_length(next_action) <= 200),
  next_action_on     date,
  expected_close_on  date,
  quote_doc_id       uuid REFERENCES public.acct_sales_docs(id),
  memo               text CHECK (memo IS NULL OR char_length(memo) <= 400),
  lost_reason        text CHECK (lost_reason IS NULL OR char_length(lost_reason) <= 200),
  closed_at          timestamptz,
  created_by         uuid REFERENCES public.accounts(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_sal_opp_closed CHECK ((stage IN ('WON', 'LOST')) = (closed_at IS NOT NULL)),
  CONSTRAINT ck_sal_opp_lost CHECK (stage <> 'LOST' OR char_length(btrim(coalesce(lost_reason, ''))) >= 2)
);
CREATE INDEX IF NOT EXISTS ix_sal_opps_stage ON public.sal_opps (stage, next_action_on);
CREATE INDEX IF NOT EXISTS ix_sal_opps_owner ON public.sal_opps (owner_id, stage);
CREATE INDEX IF NOT EXISTS ix_sal_opps_party ON public.sal_opps (party_id);
COMMENT ON TABLE public.sal_opps IS 'v10.466 (D264) 영업 기회 — 거래처 · 단계(LEAD → QUOTE → CONTRACT → WON · LOST) · 예상 매출 · 담당 · 다음 할 일 · 견적서 연결 · 성사는 끝(고치지 않음) · 지우지 않음';

CREATE TABLE IF NOT EXISTS public.sal_opp_logs (
  id          bigserial PRIMARY KEY,
  opp_id      bigint NOT NULL REFERENCES public.sal_opps(id),
  kind        text NOT NULL CHECK (kind IN ('CREATE', 'STAGE', 'NOTE', 'EDIT', 'QUOTE')),
  from_stage  text,
  to_stage    text,
  note        text CHECK (note IS NULL OR char_length(note) <= 400),
  actor       uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sal_opp_logs_opp ON public.sal_opp_logs (opp_id, id);
COMMENT ON TABLE public.sal_opp_logs IS 'v10.466 (D264) 영업 기회 기록 — 만듦 · 단계 바꿈 · 메모 · 고침 · 견적 연결 · 쌓기만';

CREATE OR REPLACE FUNCTION public.fn_sal_opp_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_kind text; v_party bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'SAL_OPP_STATE: 영업 기회는 지우지 않습니다(실패로 닫으십시오).'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.stage = 'WON' THEN RAISE EXCEPTION 'SAL_OPP_STATE: 성사한 영업 기회는 고치지 않습니다.'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.party_id IS DISTINCT FROM OLD.party_id THEN RAISE EXCEPTION 'SAL_OPP_STATE: 거래처는 바꾸지 않습니다(새 기회로).'; END IF;
  IF NEW.quote_doc_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.quote_doc_id IS DISTINCT FROM OLD.quote_doc_id) THEN
    SELECT kind, party_id INTO v_kind, v_party FROM public.acct_sales_docs WHERE id = NEW.quote_doc_id;
    IF v_kind IS DISTINCT FROM 'QUOTE' OR v_party IS DISTINCT FROM NEW.party_id THEN
      RAISE EXCEPTION 'SAL_OPP_QUOTE: 같은 거래처의 견적서만 연결합니다.';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sal_opp_guard' AND tgrelid = 'public.sal_opps'::regclass) THEN
    CREATE TRIGGER trg_sal_opp_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sal_opps FOR EACH ROW EXECUTE FUNCTION public.fn_sal_opp_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sal_opp_logs_ro' AND tgrelid = 'public.sal_opp_logs'::regclass) THEN
    CREATE TRIGGER trg_sal_opp_logs_ro BEFORE UPDATE OR DELETE ON public.sal_opp_logs FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('sales.opp_remind', 'on', 'ADMIN', '영업 기회 다음 할 일 알림(v10.466 · D264) — on 이면 매일 08:50 다음 할 날짜가 오늘이거나 지난 열린 기회를 운영 알림(SAL_OPP_DUE)', false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('sal_opp_remind', 1440, 8, 50, NULL, true, '영업 기회 다음 할 일 알림 — 매일 08:50 · 날짜가 된 열린 기회(sales.opp_remind on 일 때) · D264 · v10.466')
ON CONFLICT (job) DO NOTHING;


/* ── ② 은행 거래내역 자동 조회 (v10.467 · docs/605) ──────────────────────────────────
 *   ㉙ 금융결제원 오픈뱅킹 어댑터(FIRMBANK)를 그대로 씀 — 외부 연동 줄을 더하지 않음(15종 그대로) · 사용자 토큰 FIRMBANK_USER_TOKEN 만 받는 키에 더함
 *   회사 계좌(핀테크이용번호 · 암호문 · 끝 4자리)를 등록하면 매일 06:40 거래내역조회 → ⑪ 은행 맞추기(acct_bank_uploads · acct_bank_txns)에 들여옴
 *   같은 줄은 한 번(row_hash · 'kftc|계좌|날짜|시각|금액|잔액|내용|순번') · CSV 로 이미 올린 줄(날짜 · 입출금 · 잔액 같음)도 건너뜀
 *   acct.bank_feed       on | off(처음 off)
 *   acct.bank_feed_mode  ASSUME | LIVE(처음 ASSUME — 금융결제원에 묻지 않고 간주 2줄)
 *   acct.bank_feed_days  한 번에 묻는 날 수(처음 3 · 1 ~ 31) */
CREATE TABLE IF NOT EXISTS public.acct_bank_feed_accounts (
  id            bigserial PRIMARY KEY,
  label         text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 40),
  bank_std      text NOT NULL CHECK (bank_std ~ '^[0-9]{3}$'),
  fintech_enc   bytea NOT NULL,
  fintech_hash  text NOT NULL UNIQUE CHECK (fintech_hash ~ '^[0-9a-f]{64}$'),
  acct_last4    text NOT NULL CHECK (acct_last4 ~ '^[0-9]{4}$'),
  active        boolean NOT NULL DEFAULT true,
  last_run_at   timestamptz,
  last_result   text CHECK (last_result IS NULL OR last_result IN ('OK', 'FAIL')),
  last_error    text CHECK (last_error IS NULL OR char_length(last_error) <= 300),
  created_by    uuid REFERENCES public.accounts(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES public.accounts(id),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.acct_bank_feed_accounts IS 'v10.467 (D264) 자동 조회할 회사 계좌 — 이름 · 은행 표준코드 · 핀테크이용번호(암호문 · 겹침 막는 지문) · 끝 4자리 · 쓰는지 · 마지막 결과 · 지우지 않음(끔)';

CREATE TABLE IF NOT EXISTS public.acct_bank_feed_runs (
  id          bigserial PRIMARY KEY,
  account_id  bigint NOT NULL REFERENCES public.acct_bank_feed_accounts(id),
  from_date   date NOT NULL,
  to_date     date NOT NULL,
  mode        text NOT NULL CHECK (mode IN ('ASSUME', 'LIVE')),
  result      text NOT NULL CHECK (result IN ('OK', 'FAIL')),
  rows_total  integer NOT NULL DEFAULT 0 CHECK (rows_total >= 0),
  rows_added  integer NOT NULL DEFAULT 0 CHECK (rows_added >= 0),
  rows_dup    integer NOT NULL DEFAULT 0 CHECK (rows_dup >= 0),
  upload_id   bigint REFERENCES public.acct_bank_uploads(id),
  error       text CHECK (error IS NULL OR char_length(error) <= 300),
  run_by      uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_abfr_range CHECK (to_date >= from_date AND to_date - from_date <= 31)
);
CREATE INDEX IF NOT EXISTS ix_abfr_acc ON public.acct_bank_feed_runs (account_id, id DESC);
COMMENT ON TABLE public.acct_bank_feed_runs IS 'v10.467 (D264) 은행 거래내역 자동 조회 기록 — 계좌 · 기간 · 방식 · 결과 · 줄 수(새로 · 이미 있음) · 들여온 기록(acct_bank_uploads) · 누가(비면 정기 작업) · 쌓기만';

CREATE OR REPLACE FUNCTION public.fn_acct_bank_feed_acc_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_BANK_FEED: 등록한 계좌는 지우지 않습니다(끄십시오).'; END IF;
  IF (NEW.bank_std, NEW.fintech_enc, NEW.fintech_hash, NEW.acct_last4, NEW.created_at) IS DISTINCT FROM (OLD.bank_std, OLD.fintech_enc, OLD.fintech_hash, OLD.acct_last4, OLD.created_at) THEN
    RAISE EXCEPTION 'ACCT_BANK_FEED: 은행 · 핀테크이용번호 · 끝 4자리는 바꾸지 않습니다(끄고 새로 등록).';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_bank_feed_acc_guard' AND tgrelid = 'public.acct_bank_feed_accounts'::regclass) THEN
    CREATE TRIGGER trg_acct_bank_feed_acc_guard BEFORE UPDATE OR DELETE ON public.acct_bank_feed_accounts FOR EACH ROW EXECUTE FUNCTION public.fn_acct_bank_feed_acc_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_bank_feed_runs_ro' AND tgrelid = 'public.acct_bank_feed_runs'::regclass) THEN
    CREATE TRIGGER trg_acct_bank_feed_runs_ro BEFORE UPDATE OR DELETE ON public.acct_bank_feed_runs FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('acct.bank_feed', 'off', 'ADMIN', '은행 거래내역 자동 조회(v10.467 · D264) — 처음 off · on 이면 매일 06:40 등록한 회사 계좌의 거래내역을 은행 맞추기로 들여옴 · 켜기 SUPER', false, '^(on|off)$', 'off'),
  ('acct.bank_feed_mode', 'ASSUME', 'ADMIN', '은행 거래내역 자동 조회 방식(v10.467) — ASSUME 은 금융결제원에 묻지 않고 간주 2줄 · LIVE 는 금융결제원 키(FIRMBANK_CLIENT_ID · FIRMBANK_USER_TOKEN) · .env FIRMBANK_ORG_CODE 가 있어야', false, '^(ASSUME|LIVE)$', 'ASSUME'),
  ('acct.bank_feed_days', '3', 'ADMIN', '은행 거래내역 자동 조회 — 한 번에 묻는 날 수(오늘 포함 · 1 ~ 31 · 처음 3 · v10.467)', false, '^([1-9]|[12][0-9]|3[01])$', '3')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('acct_bank_feed', 1440, 6, 40, NULL, true, '은행 거래내역 자동 조회 — 매일 06:40 · 등록한 회사 계좌(acct.bank_feed on 일 때) · 은행 맞추기에 들여옴 · D264 · v10.467')
ON CONFLICT (job) DO NOTHING;

/* 금융결제원 오픈뱅킹 사용자 토큰(FIRMBANK_USER_TOKEN · 거래내역조회는 사용자 인증 토큰이 필요 · 운영 화면 › 외부 연동 › 연동 키) — D261 의 CHECK · 함수를 그대로 복사해 이 이름만 더함 */
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
    ('FIRMBANK','FIRMBANK_USER_TOKEN')));   -- v10.467 (D264 · 은행 거래내역 자동 조회 — 오픈뱅킹 사용자 토큰)

/* fn_integ_secret_set — D261 그대로 + FIRMBANK_USER_TOKEN(v10.467 · 은행 거래내역 자동 조회 · 8 ~ 512자 일반 모양) */
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
                  'TAXINBOX_API_KEY', 'FIRMBANK_CLIENT_ID', 'FIRMBANK_CLIENT_SECRET', 'FIRMBANK_USER_TOKEN') THEN   -- v10.467 (D264) 사용자 토큰도 일반 모양   -- v10.432 (D255) 매입 세금계산서 연동 업체 키 · v10.454 (D261) 금융결제원 오픈뱅킹 키
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

/* ── ③ 문서 PDF(인쇄) (v10.468 · docs/606) — DB 바뀜 없음(인쇄용 화면 + @media print · 서버 PDF 라이브러리 없음) ── */


/* ── ④ 소개몰 할인 쿠폰 · 기획전 (v10.469 · docs/607) ─────────────────────────────────
 *   기획전(hlt_promotions) = 상품 묶음 · 기간 · 쿠폰을 기획전 상품에만 걸 수 있음
 *   쿠폰(hlt_coupons) = 정액(FIXED 원) · 정률(RATE 1 ~ 90% · 최대 할인) · 최소 주문 · 전체 · 한 사람 사용 한도 · 기간 · 멈춤
 *   직판(DIRECT) 주문에만 — 입점 판매자 정산(goods_amount 기준)에 끼지 않게 · 회사가 부담 · 매출 할인 전표(MALL_DISCOUNT · 계정 초안 · 세무사 확인)
 *   쓰면 hlt_coupon_uses(주문 하나에 하나) · 주문이 취소 · 반품되면 DB 가 되돌림(RESTORED · 한도에서 빠짐)
 *   주문 금액 total = goods_amount + ship_fee − discount_amount · 할인은 상품 금액을 넘지 못하고 결제 금액은 음수가 되지 않음(DB CHECK)
 *   mall.coupon on | off(처음 off) — 주문서에서 쿠폰을 받는지(쿠폰 만들기 · 기획전은 꺼져도 됨) · 「주문 받기」(mall.order_open)가 꺼진 지금은 운영 화면만 */
CREATE TABLE IF NOT EXISTS public.hlt_promotions (
  id          bigserial PRIMARY KEY,
  title       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 60),
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  memo        text CHECK (memo IS NULL OR char_length(memo) <= 200),
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_hlt_promo_range CHECK (ends_on >= starts_on)
);
COMMENT ON TABLE public.hlt_promotions IS 'v10.469 (D264) 소개몰 기획전 — 이름 · 기간 · 켬 · 상품 묶음(hlt_promotion_products) · 쿠폰을 이 상품에만 걸 수 있음';

CREATE TABLE IF NOT EXISTS public.hlt_promotion_products (
  promotion_id  bigint NOT NULL REFERENCES public.hlt_promotions(id),
  product_id    uuid NOT NULL REFERENCES public.hlt_products(id) ON DELETE CASCADE,
  sort          integer NOT NULL DEFAULT 0,
  PRIMARY KEY (promotion_id, product_id)
);
COMMENT ON TABLE public.hlt_promotion_products IS 'v10.469 (D264) 기획전 상품 — 기획전마다 상품 목록(바꾸면 통째로 갈아 끼움)';

CREATE TABLE IF NOT EXISTS public.hlt_coupons (
  id                bigserial PRIMARY KEY,
  code              text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{4,20}$'),
  name              text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 60),
  kind              text NOT NULL CHECK (kind IN ('FIXED', 'RATE')),
  amount            bigint CHECK (amount IS NULL OR amount BETWEEN 1 AND 10000000),
  rate              integer CHECK (rate IS NULL OR rate BETWEEN 1 AND 90),
  max_discount      bigint CHECK (max_discount IS NULL OR max_discount BETWEEN 1 AND 10000000),
  min_order         bigint NOT NULL DEFAULT 0 CHECK (min_order BETWEEN 0 AND 100000000),
  total_limit       integer CHECK (total_limit IS NULL OR total_limit BETWEEN 1 AND 1000000),
  per_member_limit  integer NOT NULL DEFAULT 1 CHECK (per_member_limit BETWEEN 1 AND 100),
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  promotion_id      bigint REFERENCES public.hlt_promotions(id),
  state             text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'PAUSED')),
  memo              text CHECK (memo IS NULL OR char_length(memo) <= 200),
  created_by        uuid REFERENCES public.accounts(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES public.accounts(id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_hlt_coupon_kind CHECK ((kind = 'FIXED' AND amount IS NOT NULL AND rate IS NULL AND max_discount IS NULL)
                                    OR (kind = 'RATE' AND rate IS NOT NULL AND amount IS NULL)),
  CONSTRAINT ck_hlt_coupon_range CHECK (ends_at > starts_at)
);
COMMENT ON TABLE public.hlt_coupons IS 'v10.469 (D264) 소개몰 할인 쿠폰 — 코드 · 정액 · 정률(최대 할인) · 최소 주문 · 전체 · 한 사람 한도 · 기간 · 기획전 상품만 · 멈춤 · 쓴 뒤에는 할인 모양을 바꾸지 않음 · 지우지 않음';

CREATE TABLE IF NOT EXISTS public.hlt_coupon_uses (
  id              bigserial PRIMARY KEY,
  coupon_id       bigint NOT NULL REFERENCES public.hlt_coupons(id),
  order_id        uuid NOT NULL UNIQUE REFERENCES public.hlt_orders(id),
  account_id      uuid NOT NULL REFERENCES public.accounts(id),
  discount        bigint NOT NULL CHECK (discount BETWEEN 1 AND 100000000),
  state           text NOT NULL DEFAULT 'USED' CHECK (state IN ('USED', 'RESTORED')),
  used_at         timestamptz NOT NULL DEFAULT now(),
  restored_at     timestamptz,
  restore_reason  text CHECK (restore_reason IS NULL OR char_length(restore_reason) <= 60),
  CONSTRAINT ck_hcu_restored CHECK ((state = 'RESTORED') = (restored_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_hcu_coupon ON public.hlt_coupon_uses (coupon_id, state);
CREATE INDEX IF NOT EXISTS ix_hcu_member ON public.hlt_coupon_uses (coupon_id, account_id, state);
COMMENT ON TABLE public.hlt_coupon_uses IS 'v10.469 (D264) 쿠폰 쓴 기록 — 주문 하나에 하나 · 할인 금액 · 주문이 취소 · 반품되면 RESTORED(한도에서 빠짐) · 지우지 않음';

/* 주문 할인 칸 · 금액 규칙(결제 금액 = 상품 + 배송비 − 할인 · 음수 없음) */
ALTER TABLE public.hlt_orders ADD COLUMN IF NOT EXISTS discount_amount bigint NOT NULL DEFAULT 0;
ALTER TABLE public.hlt_orders DROP CONSTRAINT IF EXISTS hlt_orders_total_check;
ALTER TABLE public.hlt_orders ADD CONSTRAINT hlt_orders_total_check
  CHECK (discount_amount >= 0 AND discount_amount <= goods_amount AND total = goods_amount + ship_fee - discount_amount AND total >= 0);
COMMENT ON COLUMN public.hlt_orders.discount_amount IS 'v10.469 (D264) 쿠폰 할인(원) — 주문할 때 한 번 정함 · total = goods_amount + ship_fee − discount_amount · 상품 금액을 넘지 않음';

CREATE OR REPLACE FUNCTION public.fn_hlt_order_discount_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.discount_amount IS DISTINCT FROM OLD.discount_amount THEN
    RAISE EXCEPTION 'HLT_COUPON: 주문의 할인 금액은 주문한 뒤 바꾸지 않습니다.';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_hlt_coupon_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HLT_COUPON: 쿠폰은 지우지 않습니다(멈춤으로).'; END IF;
  IF NEW.code IS DISTINCT FROM OLD.code THEN RAISE EXCEPTION 'HLT_COUPON: 쿠폰 코드는 바꾸지 않습니다.'; END IF;
  IF (NEW.kind, NEW.amount, NEW.rate, NEW.max_discount, NEW.min_order, NEW.promotion_id) IS DISTINCT FROM (OLD.kind, OLD.amount, OLD.rate, OLD.max_discount, OLD.min_order, OLD.promotion_id)
     AND EXISTS (SELECT 1 FROM public.hlt_coupon_uses u WHERE u.coupon_id = OLD.id) THEN
    RAISE EXCEPTION 'HLT_COUPON_USED: 이미 쓴 쿠폰은 할인 모양(종류 · 금액 · 비율 · 최대 · 최소 주문 · 기획전)을 바꾸지 않습니다 — 멈추고 새 쿠폰으로.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

/* 쓴 기록 — 넣을 때 DB 가 한 번 더 확인(동시에 두 주문이 와도 한도를 넘지 않게 쿠폰 줄을 잠금) · 고치기는 USED → RESTORED 만 */
CREATE OR REPLACE FUNCTION public.fn_hlt_coupon_use_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record; o record; v_used integer; v_mine integer;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HLT_COUPON: 쿠폰 쓴 기록은 지우지 않습니다.'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.coupon_id, NEW.order_id, NEW.account_id, NEW.discount, NEW.used_at) IS DISTINCT FROM (OLD.coupon_id, OLD.order_id, OLD.account_id, OLD.discount, OLD.used_at)
       OR NOT (OLD.state = 'USED' AND NEW.state = 'RESTORED') THEN
      RAISE EXCEPTION 'HLT_COUPON: 쿠폰 쓴 기록은 되돌림(RESTORED)만 합니다.';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO c FROM public.hlt_coupons WHERE id = NEW.coupon_id FOR UPDATE;
  IF c.id IS NULL OR c.state <> 'ACTIVE' OR now() < c.starts_at OR now() >= c.ends_at THEN
    RAISE EXCEPTION 'HLT_COUPON_PERIOD: 지금 쓸 수 있는 쿠폰이 아닙니다.';
  END IF;
  SELECT o2.account_id, o2.status, o2.discount_amount, o2.goods_amount, s.type AS seller_type INTO o
    FROM public.hlt_orders o2 LEFT JOIN public.hlt_sellers s ON s.id = o2.seller_id WHERE o2.id = NEW.order_id;
  IF o.account_id IS NULL OR o.account_id <> NEW.account_id OR o.status <> 'PENDING' THEN
    RAISE EXCEPTION 'HLT_COUPON: 결제 전 본인 주문에만 쿠폰을 씁니다.';
  END IF;
  IF o.seller_type IS DISTINCT FROM 'DIRECT' THEN RAISE EXCEPTION 'HLT_COUPON_DIRECT_ONLY: 쿠폰은 직판 상품 주문에만 씁니다.'; END IF;
  IF o.discount_amount <> NEW.discount OR NEW.discount > o.goods_amount THEN RAISE EXCEPTION 'HLT_COUPON: 주문의 할인 금액과 쿠폰 할인이 다릅니다.'; END IF;
  SELECT count(*) FILTER (WHERE state = 'USED'), count(*) FILTER (WHERE state = 'USED' AND account_id = NEW.account_id)
    INTO v_used, v_mine FROM public.hlt_coupon_uses WHERE coupon_id = NEW.coupon_id;
  IF c.total_limit IS NOT NULL AND v_used >= c.total_limit THEN RAISE EXCEPTION 'HLT_COUPON_LIMIT: 쿠폰이 모두 쓰였습니다.'; END IF;
  IF v_mine >= c.per_member_limit THEN RAISE EXCEPTION 'HLT_COUPON_MEMBER_LIMIT: 이 쿠폰을 쓸 수 있는 횟수를 넘었습니다.'; END IF;
  RETURN NEW;
END $$;

/* 주문이 취소 · 반품되면 쿠폰을 되돌림(한도에서 빠짐) — 결제 취소 · 반품 승인 · 결제 전 취소 모든 길이 여기로 */
CREATE OR REPLACE FUNCTION public.fn_hlt_coupon_restore() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('CANCELED', 'RETURNED') AND OLD.status NOT IN ('CANCELED', 'RETURNED') THEN
    UPDATE public.hlt_coupon_uses SET state = 'RESTORED', restored_at = clock_timestamp(),
           restore_reason = CASE WHEN NEW.status = 'CANCELED' THEN '주문 취소' ELSE '반품' END
     WHERE order_id = NEW.id AND state = 'USED';
  END IF;
  RETURN NULL;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hlt_order_discount_guard' AND tgrelid = 'public.hlt_orders'::regclass) THEN
    CREATE TRIGGER trg_hlt_order_discount_guard BEFORE UPDATE OF discount_amount ON public.hlt_orders FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_order_discount_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hlt_coupon_restore' AND tgrelid = 'public.hlt_orders'::regclass) THEN
    CREATE TRIGGER trg_hlt_coupon_restore AFTER UPDATE OF status ON public.hlt_orders FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_coupon_restore();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hlt_coupon_guard' AND tgrelid = 'public.hlt_coupons'::regclass) THEN
    CREATE TRIGGER trg_hlt_coupon_guard BEFORE UPDATE OR DELETE ON public.hlt_coupons FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_coupon_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hlt_coupon_use_guard' AND tgrelid = 'public.hlt_coupon_uses'::regclass) THEN
    CREATE TRIGGER trg_hlt_coupon_use_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hlt_coupon_uses FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_coupon_use_guard();
  END IF;
END $$;

/* 매출 할인 계정(초안 · 세무사 확인) — 쿠폰 할인을 매출에서 빼는 계정(전표 MALL_DISCOUNT · 차변 매출할인 / 대변 상품 매출) */
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, draft) VALUES
  ('SALES_DISC', '매출할인(소개몰 쿠폰)', 'REVENUE', '403', '매출할인', 175, '소개몰 직판 쿠폰 할인 — 매출에서 빼는 계정(차변) · v10.469 · 계정 코드 · 부가세 처리(에누리 · 공급가액에서 뺌) 세무사 확인', true)
ON CONFLICT (role) DO NOTHING;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('mall.coupon', 'off', 'ADMIN', '소개몰 할인 쿠폰 받기(v10.469 · D264) — 처음 off · on 이면 주문서에서 쿠폰 코드를 받음(직판 주문만) · 쿠폰 만들기 · 기획전은 꺼져도 됨', false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;


/* ── ⑤ ㉕ 권한(D258) 시드에 새 탭 3개 — gen_seed.py 와 같은 규칙
 *   sal-crm(SUPER · PAYOUT · ADMIN · 회계 묶음 · acct- 가 아니라 세무사 안 봄) · acct-bankfeed(SUPER · PAYOUT · 세무사 보기 · 내려받기) · hlt-coupons(따로 적지 않은 탭 = ADMIN · 소개몰 묶음)
 *   주소 규칙: GET = VIEW · /run 끝 = APPROVE · 그 밖 변경 = EDIT */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('sal-crm', '영업 기회', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2600),
  ('acct-bankfeed', '은행 자동 조회', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2610),
  ('hlt-coupons', '쿠폰 · 기획전', 'admhlt', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2620)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'sal-crm', 'VIEW'), ('R_ADMIN', 'sal-crm', 'EDIT'), ('R_ADMIN', 'sal-crm', 'APPROVE'), ('R_ADMIN', 'sal-crm', 'EXPORT'),
  ('R_PAYOUT', 'sal-crm', 'VIEW'), ('R_PAYOUT', 'sal-crm', 'EDIT'), ('R_PAYOUT', 'sal-crm', 'APPROVE'), ('R_PAYOUT', 'sal-crm', 'EXPORT'),
  ('R_PAYOUT', 'acct-bankfeed', 'VIEW'), ('R_PAYOUT', 'acct-bankfeed', 'EDIT'), ('R_PAYOUT', 'acct-bankfeed', 'APPROVE'), ('R_PAYOUT', 'acct-bankfeed', 'EXPORT'),
  ('R_ACCOUNTANT', 'acct-bankfeed', 'VIEW'), ('R_ACCOUNTANT', 'acct-bankfeed', 'EXPORT'),
  ('R_ADMIN', 'hlt-coupons', 'VIEW'), ('R_ADMIN', 'hlt-coupons', 'EDIT'), ('R_ADMIN', 'hlt-coupons', 'APPROVE'), ('R_ADMIN', 'hlt-coupons', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/sales/opps', 'sal-crm', 'VIEW'),
  ('GET', '/admin/sales/opps/{id}', 'sal-crm', 'VIEW'),
  ('POST', '/admin/sales/opps', 'sal-crm', 'EDIT'),
  ('PUT', '/admin/sales/opps/{id}', 'sal-crm', 'EDIT'),
  ('POST', '/admin/sales/opps/{id}/stage', 'sal-crm', 'EDIT'),
  ('POST', '/admin/sales/opps/{id}/quote', 'sal-crm', 'EDIT'),
  ('POST', '/admin/sales/opps/{id}/note', 'sal-crm', 'EDIT'),
  ('GET', '/admin/acct/bank-feed', 'acct-bankfeed', 'VIEW'),
  ('POST', '/admin/acct/bank-feed/accounts', 'acct-bankfeed', 'EDIT'),
  ('PUT', '/admin/acct/bank-feed/accounts/{id}', 'acct-bankfeed', 'EDIT'),
  ('POST', '/admin/acct/bank-feed/run', 'acct-bankfeed', 'APPROVE'),
  ('GET', '/admin/health/coupons', 'hlt-coupons', 'VIEW'),
  ('POST', '/admin/health/coupons', 'hlt-coupons', 'EDIT'),
  ('PUT', '/admin/health/coupons/{id}', 'hlt-coupons', 'EDIT'),
  ('GET', '/admin/health/coupons/{id}/uses', 'hlt-coupons', 'VIEW'),
  ('POST', '/admin/health/coupons/quote', 'hlt-coupons', 'EDIT'),
  ('POST', '/admin/health/promotions', 'hlt-coupons', 'EDIT'),
  ('GET', '/admin/health/promotions/{id}', 'hlt-coupons', 'VIEW'),
  ('PUT', '/admin/health/promotions/{id}', 'hlt-coupons', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

