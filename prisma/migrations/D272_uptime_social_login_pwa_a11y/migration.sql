/* D272 (v10.497 ~ 500 · docs/635 ~ 638) ㊷ 안정성 · 회원 1 — 가동 감시 · 장애 공지 · 카카오 · 네이버 간편 로그인(SOCIAL · 연동 17종 · off) · PWA · 웹 접근성 */

/* D272 (v10.497 ~ 500 · docs/635 ~ 638) ㊷ 안정성 · 회원 1 — 가동 감시 · 장애 공지 · 카카오 · 네이버 간편 로그인 · PWA · 웹 접근성 도구
 *   ① 가동 감시(v10.497): 바깥 감시는 자동화 서버 n8n(워크플로 JSON · docs/635) — 서버는 가벼운 상태 주소(GET /site/status) ·
 *      n8n 결과 받기(POST /site/uptime/report · 토큰 · uptime.report 처음 off) · 대상별 상태(upt_targets) · 장애 공지 글(upt_incidents · 운영 화면에서 씀 · 사용자 웹 맨 위 띠)
 *   ② 간편 로그인(v10.498): 연결(soc_links · 업체 회원 번호는 지문만) · OAuth state + PKCE(soc_states · 10분 · 한 번) · 이어서 가입 · 연결 표(soc_pending · 15분) ·
 *      기록(soc_events) · social.kakao · social.naver 처음 off · 간주(social.mode ASSUME) · 처리방침 확인 표시(social.privacy_ok off)
 *      외부 연동 16 → 17종(SOCIAL) — verify-invariants · test_v1111 · test_v1128 패치(규칙 26) · ck_integ_secret_name · fn_integ_secret_set 은 D268 판 그대로 복사해 4개 이름만 더함
 *   ③ PWA(v10.499): 설정 site.pwa(GLOBAL · 처음 off — 끄면 이미 설치된 서비스 워커를 사용자 웹이 지움)
 *   ④ 웹 접근성 도구(v10.500): DB 없음(이 브라우저에만 기억)
 *   정기 작업 upt_daily(매일 04:50 — 오래된 감시 결과 · 쓴 state · 지난 이어서 표 · 180일 지난 간편 로그인 기록 지움)
 *   ㉕ 권한(D258) 시드 — upt-status(위험감지 admrsk) · soc-login(회원 admusr)
 * 다시 돌려도 같음(IF NOT EXISTS · ON CONFLICT · DROP … IF EXISTS → ADD) */

/* ── ① 가동 감시 · 장애 공지 ───────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.upt_incidents (
  id          bigserial PRIMARY KEY,
  title       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 120),
  title_en    text CHECK (title_en IS NULL OR char_length(btrim(title_en)) BETWEEN 2 AND 160),
  level       text NOT NULL CHECK (level IN ('MINOR', 'MAJOR', 'CRITICAL')),
  state       text NOT NULL DEFAULT 'INVESTIGATING' CHECK (state IN ('INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED')),
  parts       text[] NOT NULL DEFAULT '{}' CHECK (parts <@ ARRAY['SITE', 'API', 'LOGIN', 'PAY', 'MALL', 'MAIL', 'ADMIN']::text[] AND cardinality(parts) <= 7),
  banner      boolean NOT NULL DEFAULT true,
  started_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_upt_incident_resolved CHECK ((state = 'RESOLVED') = (resolved_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_upt_incidents_open ON public.upt_incidents (started_at DESC) WHERE state <> 'RESOLVED';
CREATE INDEX IF NOT EXISTS ix_upt_incidents_started ON public.upt_incidents (started_at DESC);
COMMENT ON TABLE public.upt_incidents IS 'v10.497 (D272) 장애 공지 — 운영 화면(위험감지 › 가동 · 장애 공지)에서 씀 · 끝나지 않은 공지는 사용자 웹 맨 위 띠(banner) · 서비스 상태 화면(/status) · 끝난 공지는 고치지 않음(트리거)';

CREATE TABLE IF NOT EXISTS public.upt_incident_notes (
  id          bigserial PRIMARY KEY,
  incident_id bigint NOT NULL REFERENCES public.upt_incidents(id) ON DELETE CASCADE,
  state       text NOT NULL CHECK (state IN ('INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED')),
  body        text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 2 AND 1000),
  body_en     text CHECK (body_en IS NULL OR char_length(btrim(body_en)) BETWEEN 2 AND 1500),
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_upt_incident_notes_inc ON public.upt_incident_notes (incident_id, id DESC);
COMMENT ON TABLE public.upt_incident_notes IS 'v10.497 (D272) 장애 공지 진행 글(조사 중 → 원인 찾음 → 지켜보는 중 → 끝남) — 쌓기만(고치기 · 지우기 막음 · 공지를 지울 때만 함께)';

/* 끝난 공지는 고치지 않음(띠 끄기 banner 만 예외) · 공지는 지우지 않음 · 진행 글은 쌓기만 */
CREATE OR REPLACE FUNCTION public.fn_upt_incident_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'UPT_INCIDENT: 장애 공지는 지우지 않습니다 — 끝냄으로 두십시오.'; END IF;
  IF OLD.state = 'RESOLVED' AND (NEW.title, NEW.title_en, NEW.level, NEW.state, NEW.parts, NEW.started_at, NEW.resolved_at)
                               IS DISTINCT FROM (OLD.title, OLD.title_en, OLD.level, OLD.state, OLD.parts, OLD.started_at, OLD.resolved_at) THEN
    RAISE EXCEPTION 'UPT_INCIDENT: 끝난 장애 공지는 고치지 않습니다(띠 끄기만 됨).';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_upt_incident_guard' AND tgrelid = 'public.upt_incidents'::regclass) THEN
    CREATE TRIGGER trg_upt_incident_guard BEFORE UPDATE OR DELETE ON public.upt_incidents FOR EACH ROW EXECUTE FUNCTION public.fn_upt_incident_guard();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_upt_note_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'UPT_NOTE: 장애 공지 진행 글은 고치지 않습니다 — 새 글을 더하십시오.'; END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'UPT_NOTE: 장애 공지 진행 글은 지우지 않습니다.'; END IF;
  IF (SELECT state FROM public.upt_incidents WHERE id = NEW.incident_id) = 'RESOLVED' THEN
    RAISE EXCEPTION 'UPT_NOTE: 끝난 장애 공지에는 글을 더하지 않습니다 — 다시 생기면 새 공지를 쓰십시오.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_upt_note_guard' AND tgrelid = 'public.upt_incident_notes'::regclass) THEN
    CREATE TRIGGER trg_upt_note_guard BEFORE INSERT OR UPDATE OR DELETE ON public.upt_incident_notes FOR EACH ROW EXECUTE FUNCTION public.fn_upt_note_guard();
  END IF;
END $$;

/* n8n 이 보낸 감시 결과(대상 · 성공 · 응답 코드 · 걸린 시간) — 개인정보 없음 · uptime.keep_days(90) 지나면 지움 */
CREATE TABLE IF NOT EXISTS public.upt_checks (
  id          bigserial PRIMARY KEY,
  target      text NOT NULL CHECK (target ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  ok          boolean NOT NULL,
  http_status integer CHECK (http_status IS NULL OR http_status BETWEEN 0 AND 999),
  ms          integer CHECK (ms IS NULL OR ms BETWEEN 0 AND 600000),
  note        text CHECK (note IS NULL OR char_length(note) <= 200),
  source      text NOT NULL DEFAULT 'N8N' CHECK (source IN ('N8N', 'TEST')),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_upt_checks_target_at ON public.upt_checks (target, at DESC);
CREATE INDEX IF NOT EXISTS ix_upt_checks_at ON public.upt_checks (at);
COMMENT ON TABLE public.upt_checks IS 'v10.497 (D272) 바깥 감시 결과(자동화 서버 n8n → POST /site/uptime/report) — 대상(SITE · API · ADMIN …) · 성공 · 응답 코드 · ms · uptime.keep_days 뒤 지움';

/* 대상별 지금 상태 — 연속 실패가 uptime.fail_count(2) 이상이면 내려감(UPTIME_DOWN 긴급 알림 한 번) · 다시 되면 올라감(UPTIME_RECOVERED) */
CREATE TABLE IF NOT EXISTS public.upt_targets (
  target      text PRIMARY KEY CHECK (target ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  down        boolean NOT NULL DEFAULT false,
  fails       integer NOT NULL DEFAULT 0 CHECK (fails >= 0),
  down_since  timestamptz,
  last_ok     boolean,
  last_at     timestamptz,
  CONSTRAINT ck_upt_target_down CHECK (down = (down_since IS NOT NULL))
);
COMMENT ON TABLE public.upt_targets IS 'v10.497 (D272) 바깥 감시 대상별 상태 — 연속 실패 수 · 내려간 때';

/* ── ② 간편 로그인(카카오 · 네이버) ─────────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.soc_links (
  id            bigserial PRIMARY KEY,
  account_id    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  provider      text NOT NULL CHECK (provider IN ('KAKAO', 'NAVER')),
  subject_hash  text NOT NULL CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  email_masked  text CHECK (email_masked IS NULL OR char_length(email_masked) <= 120),
  assumed       boolean NOT NULL DEFAULT false,
  linked_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  CONSTRAINT uq_soc_links_subject UNIQUE (provider, subject_hash),
  CONSTRAINT uq_soc_links_account UNIQUE (account_id, provider)
);
COMMENT ON TABLE public.soc_links IS 'v10.498 (D272) 간편 로그인 연결 — 업체 회원 번호는 지문(sha256)만 · 가린 이메일(보여 주기) · 한 계정에 업체마다 하나 · 같은 업체 회원은 한 계정에만 · assumed = 간주(점검판)로 만든 연결';

CREATE TABLE IF NOT EXISTS public.soc_states (
  id            bigserial PRIMARY KEY,
  state_hash    text NOT NULL CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  binding_hash  text NOT NULL CHECK (binding_hash ~ '^[0-9a-f]{64}$'),
  provider      text NOT NULL CHECK (provider IN ('KAKAO', 'NAVER')),
  mode          text NOT NULL CHECK (mode IN ('LOGIN', 'LINK')),
  account_id    uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  verifier      text NOT NULL CHECK (verifier ~ '^[A-Za-z0-9_-]{43,128}$'),
  redirect_uri  text NOT NULL CHECK (char_length(redirect_uri) BETWEEN 10 AND 300),
  assumed       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  used_at       timestamptz,
  CONSTRAINT uq_soc_states_hash UNIQUE (state_hash),
  CONSTRAINT ck_soc_states_link CHECK ((mode = 'LINK') = (account_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_soc_states_created ON public.soc_states (created_at);
COMMENT ON TABLE public.soc_states IS 'v10.498 (D272) OAuth 시작 기록 — state 지문 · 이 브라우저 묶음(쿠키) 지문 · PKCE code_verifier(10분 · 한 번) · 하루 지나면 지움';

CREATE TABLE IF NOT EXISTS public.soc_pending (
  id             bigserial PRIMARY KEY,
  ticket_hash    text NOT NULL CHECK (ticket_hash ~ '^[0-9a-f]{64}$'),
  provider       text NOT NULL CHECK (provider IN ('KAKAO', 'NAVER')),
  subject_hash   text NOT NULL CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  email          text CHECK (email IS NULL OR char_length(email) <= 254),
  email_verified boolean NOT NULL DEFAULT false,
  name_hint      text CHECK (name_hint IS NULL OR char_length(name_hint) <= 40),
  assumed        boolean NOT NULL DEFAULT false,
  link_tries     integer NOT NULL DEFAULT 0 CHECK (link_tries BETWEEN 0 AND 10),
  created_at     timestamptz NOT NULL DEFAULT now(),
  used_at        timestamptz,
  CONSTRAINT uq_soc_pending_ticket UNIQUE (ticket_hash)
);
CREATE INDEX IF NOT EXISTS ix_soc_pending_created ON public.soc_pending (created_at);
COMMENT ON TABLE public.soc_pending IS 'v10.498 (D272) 간편 로그인 이어서(처음 온 업체 회원) — 15분 · 새로 가입 또는 확인된 같은 이메일 계정에 비밀번호 확인 뒤 연결 · 저절로 합치지 않음 · 하루 지나면 지움(이메일 함께)';

CREATE TABLE IF NOT EXISTS public.soc_events (
  id          bigserial PRIMARY KEY,
  provider    text NOT NULL CHECK (provider IN ('KAKAO', 'NAVER')),
  kind        text NOT NULL CHECK (kind IN ('LOGIN', 'SIGNUP', 'LINK', 'UNLINK', 'FAIL')),
  account_id  uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  reason      text CHECK (reason IS NULL OR reason ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  assumed     boolean NOT NULL DEFAULT false,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_soc_events_at ON public.soc_events (at DESC);
COMMENT ON TABLE public.soc_events IS 'v10.498 (D272) 간편 로그인 기록 — 업체 · 종류(로그인 · 가입 · 연결 · 해제 · 실패) · 계정 · 실패 코드만(업체 회원 번호 · 이메일 없음) · 180일 지나면 지움';

/* ── 설정(모두 처음 off · 간주) ─────────────────────────────────────── */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('uptime.report', 'off', 'ADMIN', '바깥 감시 결과 받기(v10.497 · D272) — 처음 off · on 이면 자동화 서버 n8n 이 POST /site/uptime/report 로 보낸 결과(토큰 확인)를 받아 대상별 상태 · 연속 실패면 운영 알림 UPTIME_DOWN(긴급) · 켜기 SUPER', false, '^(on|off)$', 'off'),
  ('uptime.report_token_hash', '', 'PRIVATE', '바깥 감시 토큰 지문(v10.497) — 운영 화면 › 위험감지 › 가동 · 장애 공지 › 「토큰 새로 만들기」(SUPER)가 채움 · 토큰 원문은 그때 한 번만 보임 · 비면 받지 않음', false, '^$|^[0-9a-f]{64}$', ''),
  ('uptime.fail_count', '2', 'ADMIN', '바깥 감시 연속 실패 몇 번이면 내려감으로 볼지(v10.497 · 1 ~ 10) — 내려가면 UPTIME_DOWN(긴급 · 텔레그램 길) 한 번 · 다시 되면 UPTIME_RECOVERED', false, '^([1-9]|10)$', '2'),
  ('uptime.keep_days', '90', 'ADMIN', '바깥 감시 결과 보관 날수(v10.497 · 7 ~ 400) — 정기 작업 upt_daily 가 지남을 지움', false, '^([7-9]|[1-9][0-9]|[1-3][0-9][0-9]|400)$', '90'),
  ('social.kakao', 'off', 'ADMIN', '카카오 간편 로그인(v10.498 · D272) — 처음 off · on 이면 사용자 웹 로그인 화면에 「카카오로 로그인」 · 켜기 SUPER · LIVE 는 키 · 처리방침 확인(social.privacy_ok) 뒤', false, '^(on|off)$', 'off'),
  ('social.naver', 'off', 'ADMIN', '네이버 간편 로그인(v10.498 · D272) — 처음 off · on 이면 사용자 웹 로그인 화면에 「네이버로 로그인」 · 켜기 SUPER · LIVE 는 키 · 처리방침 확인 뒤', false, '^(on|off)$', 'off'),
  ('social.mode', 'ASSUME', 'ADMIN', '간편 로그인 방식(v10.498) — ASSUME 은 업체를 부르지 않고 간주(점검판 · 운영 서버에서는 쓸 수 없음) · LIVE 는 외부 연동 SOCIAL(카카오 · 네이버 키)', false, '^(ASSUME|LIVE)$', 'ASSUME'),
  ('social.privacy_ok', 'off', 'ADMIN', '간편 로그인 처리방침 확인(v10.498) — 개인정보처리방침에 카카오 · 네이버에서 받는 항목(회원 번호 · 이메일 · 별명)을 게시하고 법무 확인을 마치면 SUPER 가 on · LIVE 켜기 전 필수(docs/636 5절)', false, '^(on|off)$', 'off'),
  ('site.pwa', 'off', 'GLOBAL', '앱처럼 설치(PWA · v10.499 · D272) — 처음 off · on 이면 사용자 웹이 서비스 워커(오프라인 안내 화면만 · 화면 캐시 없음)를 등록 · off 로 돌리면 이미 등록된 서비스 워커를 지움', false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('upt_daily', 1440, 4, 50, NULL, true, '가동 감시 · 간편 로그인 정리 — 매일 04:50 · uptime.keep_days 지난 감시 결과 · 하루 지난 OAuth state · 이어서 표(이메일 함께) · 180일 지난 간편 로그인 기록을 지움 · D272 · v10.497')
ON CONFLICT (job) DO NOTHING;

/* ── 외부 연동 17번째 — 간편 로그인(카카오 · 네이버) · 처음 꺼짐 · 간주 ── */
INSERT INTO public.integrations (code, name, purpose, provider, status, requires_ip, secret_key_name, lead_time_weeks, blocks_open, memo, sort_order)
VALUES ('SOCIAL', '간편 로그인(카카오 · 네이버)', '사용자 웹 카카오 · 네이버 로그인 · 가입 · 계정 연결(v10.498) — 업체에서 받는 것은 회원 번호(지문만 저장) · 이메일 · 별명뿐 · 본인인증은 그대로',
        'KAKAO_NAVER', 'NOT_STARTED', false, 'NAVER_CLIENT_SECRET', NULL, false,
        '카카오 디벨로퍼스 앱(지도와 같은 앱이면 REST API 키를 client_id 로 다시 씀 · 카카오 로그인 켜기 · Redirect URI https://sogaebank.com/login/social/kakao/callback · Client Secret 켜면 KAKAO_LOGIN_SECRET) · 네이버 개발자센터 앱(NAVER_CLIENT_ID · NAVER_CLIENT_SECRET · Callback https://sogaebank.com/login/social/naver/callback) · 처리방침 게시 뒤 social.privacy_ok on → social.mode LIVE → social.kakao · social.naver on(docs/636).',
        coalesce((SELECT max(sort_order) + 10 FROM public.integrations), 180))
ON CONFLICT (code) DO NOTHING;

/* 받는 키 — D268 의 CHECK · 함수를 그대로 복사해 SOCIAL 4개만 더함(㊸ ㊹ 가 같은 것을 더하면 목록을 합칠 것) */
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
    ('GEOIP','GEOIP_API_KEY'),   -- v10.485 (D268 · IP 국가 판별)
    ('SOCIAL','KAKAO_LOGIN_CLIENT_ID'), ('SOCIAL','KAKAO_LOGIN_SECRET'), ('SOCIAL','NAVER_CLIENT_ID'), ('SOCIAL','NAVER_CLIENT_SECRET')));   -- v10.498 (D272 · 간편 로그인)

/* fn_integ_secret_set — D268 그대로 + SOCIAL 4개(v10.498 · 업체 키 · 8 ~ 512자 일반 모양) */
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
                  'TAXINBOX_API_KEY', 'FIRMBANK_CLIENT_ID', 'FIRMBANK_CLIENT_SECRET', 'FIRMBANK_USER_TOKEN', 'GEOIP_API_KEY',
                  'KAKAO_LOGIN_CLIENT_ID', 'KAKAO_LOGIN_SECRET', 'NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET') THEN   -- v10.498 (D272) 간편 로그인 키도 일반 모양   -- v10.485 (D268) IP 국가 판별 키도 일반 모양   -- v10.467 (D264) 사용자 토큰도 일반 모양   -- v10.432 (D255) 매입 세금계산서 연동 업체 키 · v10.454 (D261) 금융결제원 오픈뱅킹 키
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

/* ── ㉕ 권한(D258) 시드에 새 탭 2개 — gen_seed.py 와 같은 규칙
 *   upt-status(따로 적지 않은 탭 = ADMIN · 위험감지 묶음 admrsk) · soc-login(따로 적지 않은 탭 = ADMIN · 회원 묶음 admusr)
 *   주소 규칙: GET = VIEW · /token · /run 끝 = APPROVE 없음(토큰은 SUPER 가 @Roles 로) · 그 밖 변경 = EDIT
 *   회원 쪽(/auth/social · /me/social) · 공개(/site/status · /site/uptime/report)는 탭이 아님 — 시드 없음 */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('upt-status', '가동 · 장애 공지', 'admrsk', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2920),
  ('soc-login', '간편 로그인', 'admusr', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2930)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'upt-status', 'VIEW'), ('R_ADMIN', 'upt-status', 'EDIT'), ('R_ADMIN', 'upt-status', 'APPROVE'), ('R_ADMIN', 'upt-status', 'EXPORT'),
  ('R_ADMIN', 'soc-login', 'VIEW'), ('R_ADMIN', 'soc-login', 'EDIT'), ('R_ADMIN', 'soc-login', 'APPROVE'), ('R_ADMIN', 'soc-login', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/uptime', 'upt-status', 'VIEW'),
  ('POST', '/admin/uptime/incidents', 'upt-status', 'EDIT'),
  ('PUT', '/admin/uptime/incidents/{id}', 'upt-status', 'EDIT'),
  ('POST', '/admin/uptime/incidents/{id}/notes', 'upt-status', 'EDIT'),
  ('PUT', '/admin/uptime/settings', 'upt-status', 'EDIT'),
  ('POST', '/admin/uptime/token', 'upt-status', 'EDIT'),
  ('GET', '/admin/social', 'soc-login', 'VIEW'),
  ('PUT', '/admin/social/settings', 'soc-login', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

