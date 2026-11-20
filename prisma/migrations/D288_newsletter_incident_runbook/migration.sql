/* D288 (v10.556 · 557 · docs/694 · 695) (58) 운영 4 — 월간 뉴스레터 · 장애 대응 절차 화면 */

/* D288 (v10.556 · 557 · docs/694 · 695) (58) 운영 4 — 뉴스레터 · 장애 대응 절차
 *   ① 뉴스레터(v10.556): 달마다 한 호(opz_nl_issues) — 공지 · 인기 매물 · 이벤트를 골라 틀(자리값 글)에 채운 초안 · 미리보기 ·
 *      보내기는 ㊳ 캠페인(D268 mkt_campaigns · EMAIL · 대상 ALL)으로 넘겨 그쪽 서버가 마케팅 동의 · 2년 · 야간 · (광고) · 보낸 곳 · 수신 거부를 그대로 지킴
 *      (새 발송 길 없음) · 보내기 SUPER · opz.nl_enabled 처음 off(+ campaign.enabled · campaign.send_mode 도 그대로)
 *   ② 장애 대응 절차(v10.557): 장애 종류별 할 일 목록(opz_runbooks · opz_runbook_steps · 시드 6) · 장애 열기(opz_incidents · 단계 복사) ·
 *      당번 호출(운영 알림 OPZ_INCIDENT_OPEN → 기존 대화방 · 당번 개인 텔레그램 · 30분 SUPER 길) · 단계 체크 · 진행 기록 쌓기만(opz_incident_logs) ·
 *      끝난 뒤 되돌아보기(opz_incident_reviews · 확정하면 잠김) · D272 장애 공지(upt_incidents)와 연결
 *   다시 돌려도 같음(IF NOT EXISTS · ON CONFLICT · CREATE OR REPLACE · 트리거는 없을 때만)
 *   INV-9 · INV-11 감시 낱말 칸 없음 · 주석 안에 별표 빗금 없음 · RAISE 글자에 퍼센트 없음 */

/* ── ① 뉴스레터 ─────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.opz_nl_issues (
  id            bigserial PRIMARY KEY,
  ym            text NOT NULL CHECK (ym ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  title         text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 60),
  subject       text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 1 AND 90 AND subject !~ '[\r\n]'),
  intro         text NOT NULL DEFAULT '' CHECK (char_length(intro) <= 500),
  frame         text NOT NULL CHECK (char_length(frame) BETWEEN 10 AND 1200 AND frame !~* 'https?://'),
  notice_ids    uuid[] NOT NULL DEFAULT '{}'::uuid[] CHECK (cardinality(notice_ids) <= 10),
  listing_ids   uuid[] NOT NULL DEFAULT '{}'::uuid[] CHECK (cardinality(listing_ids) <= 10),
  event_ids     uuid[] NOT NULL DEFAULT '{}'::uuid[] CHECK (cardinality(event_ids) <= 10),
  body          text CHECK (body IS NULL OR char_length(btrim(body)) BETWEEN 10 AND 2000),
  state         text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'QUEUED', 'CANCELED')),
  campaign_id   bigint UNIQUE REFERENCES public.mkt_campaigns(id),
  created_by    uuid REFERENCES public.accounts(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES public.accounts(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  queued_by     uuid REFERENCES public.accounts(id),
  queued_at     timestamptz,
  canceled_at   timestamptz,
  cancel_reason text CHECK (cancel_reason IS NULL OR char_length(btrim(cancel_reason)) BETWEEN 2 AND 200),
  CONSTRAINT ck_opz_nl_queued CHECK (state <> 'QUEUED' OR (campaign_id IS NOT NULL AND queued_at IS NOT NULL AND body IS NOT NULL)),
  CONSTRAINT ck_opz_nl_cancel CHECK ((state = 'CANCELED') = (canceled_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_opz_nl_issues_ym ON public.opz_nl_issues (ym) WHERE state <> 'CANCELED';
COMMENT ON TABLE public.opz_nl_issues IS 'v10.556 (D288) 월간 뉴스레터 — 달마다 한 호(취소한 호 빼고) · 고른 공지 · 매물 · 이벤트 · 틀 · 채운 본문(2,000자 · 캠페인 글 한도) · 보내기는 mkt_campaigns(EMAIL · ALL)로 넘김 · 보낸 뒤 글은 못 고침 · 지우지 않음';

/* 보낸(QUEUED) 호 · 취소한 호는 글을 못 고침 · 상태는 한 방향(초안 → 보냄 · 초안 → 취소 · 보냄 → 취소) · 지우지 않음 */
CREATE OR REPLACE FUNCTION public.fn_opz_nl_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'OPZ_NL: 뉴스레터 호는 지우지 않습니다 — 취소로 두십시오.'; END IF;
  IF OLD.state <> 'DRAFT' AND (NEW.ym, NEW.title, NEW.subject, NEW.intro, NEW.frame, NEW.notice_ids, NEW.listing_ids, NEW.event_ids, NEW.body, NEW.campaign_id)
                               IS DISTINCT FROM (OLD.ym, OLD.title, OLD.subject, OLD.intro, OLD.frame, OLD.notice_ids, OLD.listing_ids, OLD.event_ids, OLD.body, OLD.campaign_id) THEN
    RAISE EXCEPTION 'OPZ_NL: 보냈거나 취소한 뉴스레터는 고치지 않습니다 — 새 호를 만드십시오.';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'DRAFT' AND NEW.state IN ('QUEUED', 'CANCELED')) OR (OLD.state = 'QUEUED' AND NEW.state = 'CANCELED')) THEN
    RAISE EXCEPTION 'OPZ_NL: 뉴스레터 상태는 되돌리지 않습니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_opz_nl_guard' AND tgrelid = 'public.opz_nl_issues'::regclass) THEN
    CREATE TRIGGER trg_opz_nl_guard BEFORE UPDATE OR DELETE ON public.opz_nl_issues FOR EACH ROW EXECUTE FUNCTION public.fn_opz_nl_guard();
  END IF;
END $$;


/* ── ② 장애 대응 절차(런북) ─────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.opz_runbooks (
  id          bigserial PRIMARY KEY,
  code        text NOT NULL UNIQUE CHECK (code ~ '^[A-Z][A-Z0-9_]{1,29}$'),
  title       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 80),
  kind        text NOT NULL CHECK (kind IN ('SITE', 'API', 'DB', 'PAY', 'MAIL', 'SECURITY', 'DATA', 'OTHER')),
  sev_default text NOT NULL DEFAULT 'SEV2' CHECK (sev_default IN ('SEV1', 'SEV2', 'SEV3')),
  parts       text[] NOT NULL DEFAULT '{}' CHECK (parts <@ ARRAY['SITE', 'API', 'LOGIN', 'PAY', 'MALL', 'MAIL', 'ADMIN']::text[] AND cardinality(parts) <= 7),
  summary     text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 500),
  is_active   boolean NOT NULL DEFAULT true,
  version     integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES public.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.opz_runbooks IS 'v10.557 (D288) 장애 종류별 할 일 목록(런북) — 운영 화면 › 위험감지 › 장애 대응 · 고치면 판(version) +1 · 열린 장애는 열 때 복사한 단계를 씀 · 지우지 않음(끔)';

CREATE TABLE IF NOT EXISTS public.opz_runbook_steps (
  id          bigserial PRIMARY KEY,
  runbook_id  bigint NOT NULL REFERENCES public.opz_runbooks(id),
  ord         smallint NOT NULL CHECK (ord BETWEEN 1 AND 30),
  title       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 200),
  detail      text NOT NULL DEFAULT '' CHECK (char_length(detail) <= 1000),
  CONSTRAINT uq_opz_runbook_step UNIQUE (runbook_id, ord)
);
COMMENT ON TABLE public.opz_runbook_steps IS 'v10.557 (D288) 런북 단계(차례 1 ~ 30) — 런북을 저장할 때 통째로 바꿈(판 +1)';

CREATE OR REPLACE FUNCTION public.fn_opz_runbook_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'OPZ_RUNBOOK: 런북은 지우지 않습니다 — 끔(is_active)으로 두십시오.'; END IF;
  IF NEW.code IS DISTINCT FROM OLD.code THEN RAISE EXCEPTION 'OPZ_RUNBOOK: 런북 코드는 바꾸지 않습니다.'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_opz_runbook_guard' AND tgrelid = 'public.opz_runbooks'::regclass) THEN
    CREATE TRIGGER trg_opz_runbook_guard BEFORE UPDATE OR DELETE ON public.opz_runbooks FOR EACH ROW EXECUTE FUNCTION public.fn_opz_runbook_guard();
  END IF;
END $$;

/* 장애 한 건 — 열기(OPEN) → 누그러뜨림(MITIGATED) → 끝(CLOSED) · 한 방향 · 끝난 장애는 못 고침 · 지우지 않음 */
CREATE TABLE IF NOT EXISTS public.opz_incidents (
  id                bigserial PRIMARY KEY,
  runbook_id        bigint NOT NULL REFERENCES public.opz_runbooks(id),
  runbook_version   integer NOT NULL CHECK (runbook_version >= 1),
  title             text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 120),
  sev               text NOT NULL CHECK (sev IN ('SEV1', 'SEV2', 'SEV3')),
  state             text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'MITIGATED', 'CLOSED')),
  oncall_account_id uuid REFERENCES public.accounts(id),
  alert_id          bigint,
  source_alert_id   bigint,
  upt_incident_id   bigint REFERENCES public.upt_incidents(id),
  paged_at          timestamptz,
  page_result       text CHECK (page_result IS NULL OR page_result ~ '^[A-Z][A-Z_]{1,39}$'),
  opened_by         uuid REFERENCES public.accounts(id),
  opened_at         timestamptz NOT NULL DEFAULT now(),
  mitigated_at      timestamptz,
  closed_at         timestamptz,
  closed_by         uuid REFERENCES public.accounts(id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_opz_ir_closed CHECK ((state = 'CLOSED') = (closed_at IS NOT NULL)),
  CONSTRAINT ck_opz_ir_mitigated CHECK (state = 'OPEN' OR mitigated_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_opz_incidents_open ON public.opz_incidents (opened_at DESC) WHERE state <> 'CLOSED';
CREATE INDEX IF NOT EXISTS ix_opz_incidents_opened ON public.opz_incidents (opened_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_opz_incidents_source_alert ON public.opz_incidents (source_alert_id) WHERE source_alert_id IS NOT NULL;
COMMENT ON TABLE public.opz_incidents IS 'v10.557 (D288) 장애 대응 한 건 — 런북 · 정도(SEV1 ~ 3) · 열 때 당번 · 운영 알림(OPZ_INCIDENT_OPEN) · D272 장애 공지 연결 · 끝난 건 못 고침 · 지우지 않음';

CREATE OR REPLACE FUNCTION public.fn_opz_incident_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'OPZ_INCIDENT: 장애 대응 기록은 지우지 않습니다.'; END IF;
  IF OLD.state = 'CLOSED' THEN RAISE EXCEPTION 'OPZ_INCIDENT: 끝난 장애는 고치지 않습니다 — 되돌아보기에 적으십시오.'; END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'OPEN' AND NEW.state IN ('MITIGATED', 'CLOSED')) OR (OLD.state = 'MITIGATED' AND NEW.state = 'CLOSED')) THEN
    RAISE EXCEPTION 'OPZ_INCIDENT: 장애 상태는 되돌리지 않습니다 — 다시 생기면 새로 여십시오.';
  END IF;
  IF (NEW.runbook_id, NEW.runbook_version, NEW.opened_at, NEW.opened_by, NEW.source_alert_id)
     IS DISTINCT FROM (OLD.runbook_id, OLD.runbook_version, OLD.opened_at, OLD.opened_by, OLD.source_alert_id) THEN
    RAISE EXCEPTION 'OPZ_INCIDENT: 연 때의 기록(런북 · 판 · 연 사람 · 시각)은 바꾸지 않습니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_opz_incident_guard' AND tgrelid = 'public.opz_incidents'::regclass) THEN
    CREATE TRIGGER trg_opz_incident_guard BEFORE UPDATE OR DELETE ON public.opz_incidents FOR EACH ROW EXECUTE FUNCTION public.fn_opz_incident_guard();
  END IF;
END $$;

/* 열 때 복사한 단계 — 체크(끝냄 · 되돌림)만 바뀜 · 끝난 장애는 못 바꿈 · 지우지 않음 */
CREATE TABLE IF NOT EXISTS public.opz_incident_steps (
  id           bigserial PRIMARY KEY,
  incident_id  bigint NOT NULL REFERENCES public.opz_incidents(id),
  ord          smallint NOT NULL CHECK (ord BETWEEN 1 AND 30),
  title        text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 200),
  detail       text NOT NULL DEFAULT '' CHECK (char_length(detail) <= 1000),
  done_at      timestamptz,
  done_by      uuid REFERENCES public.accounts(id),
  CONSTRAINT uq_opz_incident_step UNIQUE (incident_id, ord)
);
COMMENT ON TABLE public.opz_incident_steps IS 'v10.557 (D288) 장애에 복사한 런북 단계 — 체크만 바뀜(누가 · 언제) · 끝난 장애는 못 바꿈';

CREATE OR REPLACE FUNCTION public.fn_opz_incident_step_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'OPZ_STEP: 장애 단계는 지우지 않습니다.'; END IF;
  SELECT state INTO st FROM public.opz_incidents WHERE id = NEW.incident_id;
  IF st = 'CLOSED' THEN RAISE EXCEPTION 'OPZ_STEP: 끝난 장애의 단계는 바꾸지 않습니다.'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.incident_id, NEW.ord, NEW.title, NEW.detail) IS DISTINCT FROM (OLD.incident_id, OLD.ord, OLD.title, OLD.detail) THEN
    RAISE EXCEPTION 'OPZ_STEP: 장애 단계 글은 바꾸지 않습니다 — 체크만 됩니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_opz_incident_step_guard' AND tgrelid = 'public.opz_incident_steps'::regclass) THEN
    CREATE TRIGGER trg_opz_incident_step_guard BEFORE INSERT OR UPDATE OR DELETE ON public.opz_incident_steps FOR EACH ROW EXECUTE FUNCTION public.fn_opz_incident_step_guard();
  END IF;
END $$;

/* 진행 기록 — 쌓기만(고치기 · 지우기 막음) · 끝난 장애에는 되돌아보기(REVIEW) 줄만 */
CREATE TABLE IF NOT EXISTS public.opz_incident_logs (
  id           bigserial PRIMARY KEY,
  incident_id  bigint NOT NULL REFERENCES public.opz_incidents(id),
  kind         text NOT NULL CHECK (kind IN ('OPEN', 'PAGE', 'STEP_DONE', 'STEP_UNDO', 'NOTE', 'STATE', 'UPT', 'REVIEW')),
  body         text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
  actor        uuid REFERENCES public.accounts(id),
  at           timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_opz_incident_logs_inc ON public.opz_incident_logs (incident_id, id DESC);
COMMENT ON TABLE public.opz_incident_logs IS 'v10.557 (D288) 장애 진행 기록(열기 · 호출 · 단계 체크 · 메모 · 상태 · 공지 연결 · 되돌아보기) — 쌓기만';

CREATE OR REPLACE FUNCTION public.fn_opz_incident_log_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'OPZ_LOG: 장애 진행 기록은 고치거나 지우지 않습니다 — 새 줄을 더하십시오.'; END IF;
  IF NEW.kind <> 'REVIEW' AND (SELECT state FROM public.opz_incidents WHERE id = NEW.incident_id) = 'CLOSED' THEN
    RAISE EXCEPTION 'OPZ_LOG: 끝난 장애에는 진행 기록을 더하지 않습니다 — 되돌아보기에 적으십시오.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_opz_incident_log_guard' AND tgrelid = 'public.opz_incident_logs'::regclass) THEN
    CREATE TRIGGER trg_opz_incident_log_guard BEFORE INSERT OR UPDATE OR DELETE ON public.opz_incident_logs FOR EACH ROW EXECUTE FUNCTION public.fn_opz_incident_log_guard();
  END IF;
END $$;

/* 되돌아보기 — 끝난 장애만 · 확정하면 잠김 · 지우지 않음 */
CREATE TABLE IF NOT EXISTS public.opz_incident_reviews (
  incident_id   bigint PRIMARY KEY REFERENCES public.opz_incidents(id),
  summary       text NOT NULL CHECK (char_length(btrim(summary)) BETWEEN 2 AND 2000),
  cause         text NOT NULL DEFAULT '' CHECK (char_length(cause) <= 2000),
  impact        text NOT NULL DEFAULT '' CHECK (char_length(impact) <= 1000),
  went_well     text NOT NULL DEFAULT '' CHECK (char_length(went_well) <= 1000),
  improve       text NOT NULL DEFAULT '' CHECK (char_length(improve) <= 2000),
  actions       text NOT NULL DEFAULT '' CHECK (char_length(actions) <= 2000),
  created_by    uuid REFERENCES public.accounts(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES public.accounts(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  finalized_by  uuid REFERENCES public.accounts(id),
  finalized_at  timestamptz,
  CONSTRAINT ck_opz_review_final CHECK ((finalized_at IS NULL) = (finalized_by IS NULL))
);
COMMENT ON TABLE public.opz_incident_reviews IS 'v10.557 (D288) 장애 되돌아보기 — 무엇이 · 왜 · 영향 · 잘된 것 · 고칠 것 · 할 일 · 끝난 장애만 · 확정 뒤 잠김';

CREATE OR REPLACE FUNCTION public.fn_opz_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'OPZ_REVIEW: 되돌아보기는 지우지 않습니다.'; END IF;
  IF TG_OP = 'INSERT' AND coalesce((SELECT state FROM public.opz_incidents WHERE id = NEW.incident_id), '') <> 'CLOSED' THEN
    RAISE EXCEPTION 'OPZ_REVIEW: 되돌아보기는 끝난 장애에만 씁니다.';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.finalized_at IS NOT NULL THEN RAISE EXCEPTION 'OPZ_REVIEW: 확정한 되돌아보기는 고치지 않습니다.'; END IF;
  IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_opz_review_guard' AND tgrelid = 'public.opz_incident_reviews'::regclass) THEN
    CREATE TRIGGER trg_opz_review_guard BEFORE INSERT OR UPDATE OR DELETE ON public.opz_incident_reviews FOR EACH ROW EXECUTE FUNCTION public.fn_opz_review_guard();
  END IF;
END $$;

/* 런북 시드 6 — 일반 절차(대표 · 운영이 화면에서 고침) · 운영 반영 · 되돌리기(rollback)는 늘 사람이 ubuntu 로(대표 승인) */
INSERT INTO public.opz_runbooks (code, title, kind, sev_default, parts, summary) VALUES
  ('SITE_DOWN', '사이트 접속 안 됨', 'SITE', 'SEV1', ARRAY['SITE', 'API'], '사용자 웹 · API 가 응답하지 않음(바깥 감시 UPTIME_DOWN · 회원 신고)'),
  ('API_ERRORS', '서버 오류 몰림', 'API', 'SEV2', ARRAY['API'], '서버 오류(5xx)가 몰리거나 느린 응답이 이어짐'),
  ('DB_TROUBLE', 'DB 느림 · 연결 안 됨', 'DB', 'SEV1', ARRAY['SITE', 'API', 'ADMIN'], 'DB 연결 실패 · 느린 조회 · 디스크 부족'),
  ('PAY_FAIL', '결제 · 정산 이상', 'PAY', 'SEV2', ARRAY['PAY', 'MALL'], '결제 실패 몰림 · 정산 금액 이상(간주 모드 여부 먼저 확인)'),
  ('MAIL_FAIL', '메일 · 알림 안 나감', 'MAIL', 'SEV3', ARRAY['MAIL'], '메일 발송 실패 · 반송 몰림 · 텔레그램 알림 끊김'),
  ('SECURITY', '보안 사고 의심', 'SECURITY', 'SEV1', ARRAY['ADMIN'], '운영 계정 탈취 · 개인정보 유출 의심 · 이상 접속(유출이면 알게 된 때부터 72시간 안 통지 · 신고)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.opz_runbook_steps (runbook_id, ord, title, detail)
SELECT r.id, s.ord, s.title, s.detail
  FROM (VALUES
    ('SITE_DOWN', 1, '상태 주소 · 바깥 감시 확인', '위험감지 › 가동 · 장애 공지에서 대상별 상태 · 마지막 감시 시각을 봄. 사무실 · 집 두 곳에서 sogaebank.com 을 열어 봄.'),
    ('SITE_DOWN', 2, '장애 공지 올리기', '이 화면 「공지 올리기」 또는 가동 · 장애 공지 — 사용자 웹 맨 위 띠 · /status 에 나감(회원에게 알림).'),
    ('SITE_DOWN', 3, '최근 운영 반영 확인', '바로 전에 운영 반영이 있었으면 되돌리기(rollback)를 대표에게 묻고 승인 뒤 사람이 ubuntu 로(apply 블록에 넣지 않음).'),
    ('SITE_DOWN', 4, '서버 자원 · 서버 오류 확인', '운영 화면 › 서버 상태 · 최근 서버 오류 · 디스크 경보.'),
    ('SITE_DOWN', 5, '복구 확인 · 공지 끝냄', '두 곳에서 다시 열어 보고 바깥 감시가 다시 응답함(UPTIME_RECOVERED)인지 본 뒤 공지를 끝냄.'),
    ('SITE_DOWN', 6, '되돌아보기 쓰기', '끝낸 뒤 이 화면 「되돌아보기」 — 원인 · 영향 · 고칠 것 · 할 일.'),
    ('API_ERRORS', 1, '최근 서버 오류 보기', '운영 화면 › 최근 서버 오류(지난 1시간 50건) — 같은 주소 · 같은 오류인지.'),
    ('API_ERRORS', 2, '느린 응답 · 느린 DB 조회 보기', '느린 응답 p95 · 느린 DB 조회 목록.'),
    ('API_ERRORS', 3, '관련 기능 스위치 끄기 판단', '특정 기능 때문이면 그 기능 스위치를 끔(SUPER · 사유) — 기능 스위치 한눈에.'),
    ('API_ERRORS', 4, '회원 영향 크면 장애 공지', '일부 안 됨이면 MAJOR 공지.'),
    ('API_ERRORS', 5, '되돌아보기 쓰기', '원인 · 고칠 것.'),
    ('DB_TROUBLE', 1, 'DB 연결 · 디스크 확인', '서버 상태 · 디스크 경보 · RDS 상태(운영 콘솔은 대표 · 사람).'),
    ('DB_TROUBLE', 2, '장애 공지 올리기', '전체 안 됨이면 CRITICAL 공지.'),
    ('DB_TROUBLE', 3, '스냅샷 · 되살리기 판단', 'RDS 스냅샷에서 되살리기는 대표 결정 · 사람이 콘솔에서(개발 서버는 운영 RDS 에 접속하지 않음).'),
    ('DB_TROUBLE', 4, '복구 확인 · 공지 끝냄', '로그인 · 매물 목록 · 운영 화면이 열리는지.'),
    ('DB_TROUBLE', 5, '되돌아보기 쓰기', '원인 · 데이터 잃음 여부 · 할 일.'),
    ('PAY_FAIL', 1, '간주 모드 확인', '기능 스위치 한눈에서 assume.payment · 소개몰 주문 받기 상태를 먼저 봄.'),
    ('PAY_FAIL', 2, '주문 받기 끄기 판단', '실결제 중 이상이면 소개몰 주문 받기를 끔(SUPER · 확인 문구).'),
    ('PAY_FAIL', 3, '영향 받은 주문 · 정산 목록 만들기', '운영 화면 주문 · 정산 승인에서 그 시간대 줄을 확인.'),
    ('PAY_FAIL', 4, '회원 안내', '필요하면 장애 공지 · 1:1 문의 답변 틀.'),
    ('PAY_FAIL', 5, '되돌아보기 쓰기', '금액 차이 · 되돌린 것 · 할 일.'),
    ('MAIL_FAIL', 1, '메일 준비 상태 보기', '운영 알림 화면 메일 줄(NO_SMTP 등) · 반송 · 수신 거부 주소.'),
    ('MAIL_FAIL', 2, '텔레그램 · 슬랙 길 보기', '운영 알림 › 알림 길 · 시험 보내기.'),
    ('MAIL_FAIL', 3, '캠페인 · 뉴스레터 멈춤 판단', '보내는 중인 캠페인이 있으면 취소 또는 campaign.enabled 끔.'),
    ('MAIL_FAIL', 4, '되돌아보기 쓰기', '원인 · 못 보낸 메일 다시 보낼지.'),
    ('SECURITY', 1, '대표 · 법무에 바로 알림 · 유출이면 72시간 안 통지 · 신고', '개인정보 유출이면 알게 된 때부터 72시간 안에 정보주체에게 통지하고, 1천 명 이상 등 법정 요건에 해당하면 개인정보보호위원회에 신고(법무 확인 끝 11/21 대표 · 법령 개정 확인 — docs/695 5절).'),
    ('SECURITY', 2, '의심 계정 막기', '운영 계정이면 권한 거둠 · 모든 기기 로그아웃 · 비밀번호 바꿈 · 2단계 인증 다시.'),
    ('SECURITY', 3, '접속 기록 보존', '감사 기록 · 로그인 기록 · 막힌 접속을 내려받아 보관(지우지 않음).'),
    ('SECURITY', 4, '허용 IP · 열쇠 점검', '운영 화면 허용 IP · 외부 연동 키 · 감시 토큰을 새로 만들지 판단.'),
    ('SECURITY', 5, '되돌아보기 쓰기', '경로 · 영향 범위 · 통지 여부 · 할 일.')
  ) AS s(code, ord, title, detail)
  JOIN public.opz_runbooks r ON r.code = s.code
ON CONFLICT (runbook_id, ord) DO NOTHING;


/* ── ③ 설정 · 정기 작업 · 기능 스위치 한눈에 · ㉕ 권한(D258) 시드 ──────────────────────────
 *   스위치 3개 모두 처음 off(규칙 9) · 값 무늬(value_pattern)는 서버 opz-settings.ts OPZ_RANGES 와 같은 끝값 */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('opz.nl_enabled', 'off', 'ADMIN', '월간 뉴스레터 보내기(v10.556 · D288) — 처음 off · on 이어야 「보내기」(SUPER)가 됨 · 보내는 길은 ㊳ 캠페인이라 campaign.enabled · campaign.send_mode(처음 ASSUME) · 마케팅 동의 · (광고) · 수신 거부 규칙을 그대로 따름 · 초안 · 미리보기 · 나에게 시험은 꺼져도 됨', false, '^(on|off)$', 'off'),
  ('opz.nl_items', '5', 'ADMIN', '뉴스레터 묶음마다 처음 고를 수(공지 · 인기 매물 · 이벤트 · v10.556 · 1 ~ 10 · 처음 5)', false, '^([1-9]|10)$', '5'),
  ('opz.nl_listing_days', '30', 'ADMIN', '뉴스레터 인기 매물 후보 — 최근 며칠 안에 게시한 매물(v10.556 · 7 ~ 90 · 처음 30)', false, '^([7-9]|[1-8][0-9]|90)$', '30'),
  ('opz.ir_enabled', 'off', 'ADMIN', '장애 대응 열기(v10.557 · D288) — 처음 off · on 이면 위험감지 › 장애 대응에서 런북을 골라 장애를 열고 운영 알림 OPZ_INCIDENT_OPEN(SEV1 ~ 3 모두 긴급 — 기존 대화방 · 당번 개인 텔레그램 · 30분 SUPER 길)을 올림 · 런북 고치기는 꺼져도 됨', false, '^(on|off)$', 'off'),
  ('opz.ir_page_now', 'off', 'ADMIN', '장애를 열 때 오늘 당번 개인 텔레그램으로 바로 한 통(v10.557) — 처음 off(꺼져 있으면 정기 작업 launch_watch 의 당번 보내기가 맡음) · 「다시 호출」 단추도 이 스위치', false, '^(on|off)$', 'off'),
  ('opz.ir_review_days', '3', 'ADMIN', '장애를 끝낸 뒤 며칠 안에 되돌아보기를 확정할지(v10.557 · 1 ~ 14 · 처음 3) — 넘으면 운영 알림 OPZ_REVIEW_DUE 한 번', false, '^([1-9]|1[0-4])$', '3')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('opz_daily', 1440, 9, 10, NULL, true, '운영 4 — 매일 09:10 · 끝난 장애 되돌아보기 기한 넘김(OPZ_REVIEW_DUE · 장애마다 한 번) · 24시간 넘게 진행 기록 없는 열린 장애(OPZ_INCIDENT_STALE · 하루 한 번) · 뉴스레터 켜짐인데 이달 호 없음(OPZ_NL_REMIND · 달마다 한 번 · 10일부터) · D288 · v10.556 · 557')
ON CONFLICT (job) DO NOTHING;

/* ㊺ 기능 스위치 한눈에(opx_switch_docs) — 켤 조건 */
INSERT INTO public.opx_switch_docs (key, initial_value, cond, doc_ref) VALUES
  ('opz.nl_enabled', 'off', '광고 표기 · 보낸 곳 연락처(campaign.contact) · 수신 거부 처리 법무 확인 뒤 SUPER — 실제 발송은 campaign.enabled on · campaign.send_mode LIVE · 메일 준비됨까지 모두', 'docs/694'),
  ('opz.ir_enabled', 'off', '런북 6개를 대표 · 운영이 읽고 고친 뒤 · 당번(위험감지 › 운영 알림)을 정한 뒤', 'docs/695'),
  ('opz.ir_page_now', 'off', '텔레그램 봇 토큰 · 당번 개인 텔레그램 대화방이 준비된 뒤(운영 알림 › 알림 길 시험 보내기로 확인)', 'docs/695')
ON CONFLICT (key) DO NOTHING;

/* ㉕ 권한(D258) 시드 — 새 탭 2개 · gen_seed.py 와 같은 규칙(GET = VIEW · 보내기 · 확정 = APPROVE · 그 밖 변경 = EDIT)
 *   opz-newsletter = 회원 묶음(admusr · TAB_ROLES 따로 없음 = ADMIN · SUPER) · opz-incident = 위험감지 묶음(admrsk · ADMIN · SUPER) */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('opz-newsletter', '월간 뉴스레터', 'admusr', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2905),
  ('opz-incident', '장애 대응', 'admrsk', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2925)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'opz-newsletter', 'VIEW'), ('R_ADMIN', 'opz-newsletter', 'EDIT'), ('R_ADMIN', 'opz-newsletter', 'APPROVE'), ('R_ADMIN', 'opz-newsletter', 'EXPORT'),
  ('R_ADMIN', 'opz-incident', 'VIEW'), ('R_ADMIN', 'opz-incident', 'EDIT'), ('R_ADMIN', 'opz-incident', 'APPROVE'), ('R_ADMIN', 'opz-incident', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/opz/newsletters', 'opz-newsletter', 'VIEW'),
  ('GET', '/admin/opz/newsletters/{id}', 'opz-newsletter', 'VIEW'),
  ('POST', '/admin/opz/newsletters', 'opz-newsletter', 'EDIT'),
  ('PUT', '/admin/opz/newsletters/{id}', 'opz-newsletter', 'EDIT'),
  ('POST', '/admin/opz/newsletters/{id}/test', 'opz-newsletter', 'EDIT'),
  ('POST', '/admin/opz/newsletters/{id}/send', 'opz-newsletter', 'APPROVE'),
  ('POST', '/admin/opz/newsletters/{id}/cancel', 'opz-newsletter', 'EDIT'),
  ('PUT', '/admin/opz/newsletter-settings', 'opz-newsletter', 'EDIT'),
  ('GET', '/admin/opz/incidents', 'opz-incident', 'VIEW'),
  ('GET', '/admin/opz/incidents/{id}', 'opz-incident', 'VIEW'),
  ('POST', '/admin/opz/incidents', 'opz-incident', 'EDIT'),
  ('POST', '/admin/opz/incidents/{id}/page', 'opz-incident', 'EDIT'),
  ('POST', '/admin/opz/incidents/{id}/steps/{stepId}', 'opz-incident', 'EDIT'),
  ('POST', '/admin/opz/incidents/{id}/notes', 'opz-incident', 'EDIT'),
  ('POST', '/admin/opz/incidents/{id}/state', 'opz-incident', 'EDIT'),
  ('PUT', '/admin/opz/incidents/{id}/upt', 'opz-incident', 'EDIT'),
  ('PUT', '/admin/opz/incidents/{id}/review', 'opz-incident', 'EDIT'),
  ('POST', '/admin/opz/incidents/{id}/review/finalize', 'opz-incident', 'APPROVE'),
  ('GET', '/admin/opz/runbooks/{id}', 'opz-incident', 'VIEW'),
  ('POST', '/admin/opz/runbooks', 'opz-incident', 'EDIT'),
  ('PUT', '/admin/opz/runbooks/{id}', 'opz-incident', 'EDIT'),
  ('PUT', '/admin/opz/incident-settings', 'opz-incident', 'EDIT')
ON CONFLICT DO NOTHING;

