/* D270 (v10.490 ~ 493 · docs/628 ~ 631) ㊵ 사무 · 보안 — 외부 연동 키 만료 · 교체 알림(값은 안 읽음) · IT 자산 · SaaS 구독 · 사내 제안 · 건의함(익명) · 사내 설문 */

-- =====================================================================
-- D270 — ㊵ 사무 · 보안 (v10.490 ~ 493 · docs/628 ~ 631 · 마이그레이션 #308) — 대표 11/20 「지금 바로 동시 착수」
--
--   ① v10.490 외부 연동 키 만료 · 교체 알림   its_key_life · its_key_events · integration_secrets 저장 때 「교체함」 표시(트리거 · 값은 읽지 않음)
--   ② v10.491 IT 자산 · SaaS 구독            its_assets · 달 비용 → ⑬ 자금 흐름 예정(acct_cash_plans · OUT) · 갱신 알림
--   ③ v10.492 사내 제안 · 건의함              its_suggestions(익명이면 작성자 · 시각 칸 자체가 비어 있음 · DB 가 지움) · its_suggestion_log
--   ④ v10.493 사내 설문                      its_surveys · its_survey_questions · its_survey_takers(누가 냈는지만) · its_survey_answers(익명이면 계정 없음)
--   ⑤ 설정 · 정기 작업 · 내려받기 승인 대상 ITS_SURVEY · ㉕ 권한(D258) 시드
--
--   ★ 키 값은 어디서도 읽지 않습니다 — 새 표에는 값 · 끝 4자리 칸이 없고, 트리거는 NEW.integration_code · NEW.name · NEW.updated_by 만 씀.
--     보기(VIEW)를 만들지 않음(MAP-2 v_secret_leak 0 그대로) · 외부 연동 줄을 더하지 않음(INTG 15 그대로).
--   자료를 지우지 않습니다. 재실행 안전(IF NOT EXISTS · ON CONFLICT · 트리거는 있는지 보고 만듦).
-- =====================================================================


/* ── ① 외부 연동 키 만료 · 교체 (v10.490 · docs/628) ─────────────────────────────────────
 *   키마다(연동 코드 · 키 이름) 만료일 · 교체 주기(일) · 마지막 교체 시각 · 담당 메모 — 값 · 끝 4자리 칸 없음
 *   마지막 교체: 운영 화면 「연동 키」에서 넣으면(integration_secrets INSERT · value_enc UPDATE) 트리거가 저절로 표시(만료일은 비움 — 새 키의 만료일을 다시 적음)
 *               .env 로 쓰는 키는 사람이 「바꿨음」 단추(MANUAL)
 *   다음 기한 = 만료일 · (마지막 교체(없으면 줄 만든 날) + 교체 주기) 중 이른 날 → its.key_alert_days(처음 30 · 7) 전 · 지나면 운영 알림 ITS_KEY_EXPIRY */
CREATE TABLE IF NOT EXISTS public.its_key_life (
  integration_code  text NOT NULL REFERENCES public.integrations(code),
  key_name          text NOT NULL CHECK (key_name ~ '^[A-Z][A-Z0-9_]{2,59}$'),
  expires_on        date,
  rotate_days       integer CHECK (rotate_days IS NULL OR rotate_days BETWEEN 7 AND 1095),
  rotated_at        timestamptz,
  rotated_by        uuid REFERENCES public.accounts(id),
  rotate_source     text CHECK (rotate_source IS NULL OR rotate_source IN ('ADMIN_KEY', 'MANUAL')),
  owner_note        text CHECK (owner_note IS NULL OR char_length(owner_note) <= 200),
  updated_by        uuid REFERENCES public.accounts(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_code, key_name),
  CONSTRAINT ck_its_key_rotated CHECK ((rotated_at IS NULL) = (rotate_source IS NULL))
);
COMMENT ON TABLE public.its_key_life IS 'v10.490 (D270) 외부 연동 키 만료 · 교체 — 키마다 만료일 · 교체 주기 · 마지막 교체 · 담당 메모. 키 값 · 끝 4자리는 없음(integration_secrets 를 읽지 않음)';

CREATE TABLE IF NOT EXISTS public.its_key_events (
  id                bigserial PRIMARY KEY,
  integration_code  text NOT NULL,
  key_name          text NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('ROTATED', 'MANUAL_ROTATED', 'LIFE_SET')),
  detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor             uuid,
  at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_its_key_events_key ON public.its_key_events (integration_code, key_name, id DESC);
COMMENT ON TABLE public.its_key_events IS 'v10.490 (D270) 연동 키 교체 · 만료일 바꿈 기록 — 쌓기만 · 날짜 · 메모만(키 값 없음)';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_its_key_events_ro' AND tgrelid = 'public.its_key_events'::regclass) THEN
    CREATE TRIGGER trg_its_key_events_ro BEFORE UPDATE OR DELETE ON public.its_key_events FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* 운영 화면 키를 넣으면 「교체함」 — 연동 코드 · 키 이름 · 넣은 사람만 씀(값 칸 value_enc · last4 는 읽지 않음).
 * 이 표시가 실패해도 키 저장은 그대로 되게 예외를 삼킴(경고만). */
CREATE OR REPLACE FUNCTION public.fn_its_key_rotated() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    INSERT INTO public.its_key_life AS l (integration_code, key_name, rotated_at, rotated_by, rotate_source, expires_on, updated_at)
    VALUES (NEW.integration_code, NEW.name, now(), NEW.updated_by, 'ADMIN_KEY', NULL, now())
    ON CONFLICT (integration_code, key_name) DO UPDATE
       SET rotated_at = now(), rotated_by = EXCLUDED.rotated_by, rotate_source = 'ADMIN_KEY', expires_on = NULL, updated_at = now();
    INSERT INTO public.its_key_events (integration_code, key_name, kind, detail, actor)
    VALUES (NEW.integration_code, NEW.name, 'ROTATED', jsonb_build_object('source', 'ADMIN_KEY'), NEW.updated_by);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'its_key_life: 교체 표시를 남기지 못했습니다(키 저장은 그대로).';
  END;
  RETURN NULL;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_its_key_rotated' AND tgrelid = 'public.integration_secrets'::regclass) THEN
    CREATE TRIGGER trg_its_key_rotated AFTER INSERT OR UPDATE OF value_enc ON public.integration_secrets
      FOR EACH ROW EXECUTE FUNCTION public.fn_its_key_rotated();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('its.key_alert', 'on', 'ADMIN', '외부 연동 키 만료 · 교체 알림(v10.490 · D270) — on 이면 매일 08:40 다음 기한이 its.key_alert_days 안이거나 지난 키를 운영 알림 ITS_KEY_EXPIRY(키 이름만 · 값 없음)', false, '^(on|off)$', 'on'),
  ('its.key_alert_days', '30,7', 'ADMIN', '연동 키 알림 — 다음 기한 며칠 전에 알릴지(쉼표 · 큰 수부터 · 1 ~ 365 · 4개까지 · 처음 30,7 · 기한이 지나면 한 번 더)', false, '^[0-9]{1,3}(,[0-9]{1,3}){0,3}$', '30,7')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('its_key_expiry', 1440, 8, 40, NULL, true, '외부 연동 키 만료 · 교체 알림 — 매일 08:40 · its.key_alert on 일 때 · D270 · v10.490')
ON CONFLICT (job) DO NOTHING;


/* ── ② IT 자산 · SaaS 구독 (v10.491 · docs/629) ──────────────────────────────────────────
 *   종류 SAAS(구독) · LICENSE(설치 라이선스) · CLOUD · DOMAIN · DEVICE(기기) · OTHER
 *   라이선스 수(seats) · 쓰는 수(seats_used) · 담당(owner_id) · 결제 주기(MONTHLY · YEARLY · ONCE · FREE) · 한 번 금액(원 · 부가세 포함 · 외화는 원으로 바꿔 적음)
 *   다음 갱신일(renew_on) · 자동 갱신 — 자동 갱신이면 정기 작업이 지난 갱신일을 다음 주기로 옮김
 *   자금 계획: cash_plan = true 면 ⑬ 자금 흐름 예정(acct_cash_plans · OUT)을 하나 만들어 잇고(cash_plan_id) · 금액 · 주기 · 날이 바뀌면 옛 예정은 취소하고 새로 넣음
 *   지우지 않음 — 해지(CANCELED · 사유)만 · 해지하면 이은 예정도 취소 */
CREATE TABLE IF NOT EXISTS public.its_assets (
  id              bigserial PRIMARY KEY,
  kind            text NOT NULL CHECK (kind IN ('SAAS', 'LICENSE', 'CLOUD', 'DOMAIN', 'DEVICE', 'OTHER')),
  name            text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  vendor          text CHECK (vendor IS NULL OR char_length(vendor) <= 80),
  asset_tag       text CHECK (asset_tag IS NULL OR asset_tag ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$'),
  seats           integer NOT NULL DEFAULT 0 CHECK (seats BETWEEN 0 AND 100000),
  seats_used      integer NOT NULL DEFAULT 0 CHECK (seats_used BETWEEN 0 AND 100000),
  owner_id        uuid REFERENCES public.accounts(id),
  billing_cycle   text NOT NULL DEFAULT 'MONTHLY' CHECK (billing_cycle IN ('MONTHLY', 'YEARLY', 'ONCE', 'FREE')),
  cost_amount     bigint NOT NULL DEFAULT 0 CHECK (cost_amount BETWEEN 0 AND 1000000000),
  renew_on        date,
  auto_renew      boolean NOT NULL DEFAULT true,
  cash_plan       boolean NOT NULL DEFAULT true,
  cash_plan_id    bigint REFERENCES public.acct_cash_plans(id),
  cash_plan_sig   text,
  memo            text CHECK (memo IS NULL OR char_length(memo) <= 400),
  state           text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'CANCELED')),
  canceled_on     date,
  cancel_reason   text,
  created_by      uuid REFERENCES public.accounts(id),
  updated_by      uuid REFERENCES public.accounts(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_its_asset_free CHECK (billing_cycle <> 'FREE' OR cost_amount = 0),
  CONSTRAINT ck_its_asset_renew CHECK (billing_cycle NOT IN ('MONTHLY', 'YEARLY') OR renew_on IS NOT NULL),
  CONSTRAINT ck_its_asset_cancel CHECK ((state = 'ACTIVE' AND canceled_on IS NULL) OR (state = 'CANCELED' AND canceled_on IS NOT NULL AND char_length(btrim(coalesce(cancel_reason, ''))) >= 2))
);
CREATE INDEX IF NOT EXISTS ix_its_assets_renew ON public.its_assets (renew_on) WHERE state = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS ux_its_assets_tag ON public.its_assets (asset_tag) WHERE asset_tag IS NOT NULL;
COMMENT ON TABLE public.its_assets IS 'v10.491 (D270) IT 자산 · SaaS 구독 — 라이선스 수 · 담당 · 갱신일 · 한 번 금액 → 자금 흐름 예정(acct_cash_plans OUT) · 지우지 않음(해지만)';

CREATE OR REPLACE FUNCTION public.fn_its_asset_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ITS_ASSET: IT 자산은 지우지 않습니다(해지하십시오).'; END IF;
  IF OLD.state = 'CANCELED' AND (NEW.state, NEW.name, NEW.cost_amount, NEW.billing_cycle, NEW.renew_on) IS DISTINCT FROM (OLD.state, OLD.name, OLD.cost_amount, OLD.billing_cycle, OLD.renew_on) THEN
    RAISE EXCEPTION 'ITS_ASSET_STATE: 해지한 자산은 고치지 않습니다(새로 넣으십시오).';
  END IF;
  IF (NEW.kind, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.kind, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'ITS_ASSET: 종류 · 넣은 사람은 바꾸지 않습니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_its_asset_guard' AND tgrelid = 'public.its_assets'::regclass) THEN
    CREATE TRIGGER trg_its_asset_guard BEFORE UPDATE OR DELETE ON public.its_assets FOR EACH ROW EXECUTE FUNCTION public.fn_its_asset_guard();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('its.asset_alert', 'on', 'ADMIN', 'IT 자산 · 구독 갱신 알림(v10.491 · D270) — on 이면 매일 08:55 다음 갱신일이 its.asset_alert_days 안인 자산을 운영 알림 ITS_ASSET_RENEW', false, '^(on|off)$', 'on'),
  ('its.asset_alert_days', '30,7', 'ADMIN', 'IT 자산 갱신 알림 — 갱신일 며칠 전에 알릴지(쉼표 · 큰 수부터 · 1 ~ 365 · 4개까지 · 처음 30,7)', false, '^[0-9]{1,3}(,[0-9]{1,3}){0,3}$', '30,7')
ON CONFLICT (key) DO NOTHING;


/* ── ③ 사내 제안 · 건의함 (v10.492 · docs/630) ───────────────────────────────────────────
 *   익명(is_anon)이면 작성자(author_id) · 넣은 시각(created_at) 칸이 **비어 있음** — 화면에서 감추는 것이 아니라 DB 에 없음
 *     · BEFORE INSERT 트리거가 서버가 무엇을 보내도 비움 · CHECK 가 다시 막음 · 날짜(created_on)만 남김
 *     · 번호는 무작위 uuid(넣은 차례가 드러나지 않게) · 익명 접수 번호는 sha256 만(receipt_hash · 원문은 쓴 사람만 한 번 받음)
 *     · 이 표에 넣는 API 에는 감사 기록(@Audit) · 권한 주소 맵(perm_route_map) · 운영 알림 시각을 붙이지 않음(docs/630 4절)
 *   상태: RECEIVED(접수) → REVIEWING(검토 중) → ADOPTED(채택) → DONE(실행 끝) · DECLINED(반영 안 함) — 채택 · 반영 안 함 · 끝은 답변이 있어야
 *   제목 · 내용 · 익명 여부는 고치지 않음 · 지우지 않음 · 상태 바뀜은 its_suggestion_log(쌓기만 · 검토한 사람) */
CREATE TABLE IF NOT EXISTS public.its_suggestions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category      text NOT NULL CHECK (category IN ('WORK', 'SYSTEM', 'WELFARE', 'SAFETY', 'OTHER')),
  title         text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 100),
  body          text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 10 AND 3000),
  is_anon       boolean NOT NULL,
  author_id     uuid REFERENCES public.accounts(id),
  created_on    date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Seoul')::date),
  created_at    timestamptz,
  receipt_hash  text UNIQUE CHECK (receipt_hash IS NULL OR receipt_hash ~ '^[0-9a-f]{64}$'),
  state         text NOT NULL DEFAULT 'RECEIVED' CHECK (state IN ('RECEIVED', 'REVIEWING', 'ADOPTED', 'DECLINED', 'DONE')),
  answer        text CHECK (answer IS NULL OR char_length(btrim(answer)) BETWEEN 2 AND 2000),
  answered_at   timestamptz,
  answered_by   uuid REFERENCES public.accounts(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_its_sug_anon CHECK ((is_anon AND author_id IS NULL AND created_at IS NULL) OR (NOT is_anon AND author_id IS NOT NULL AND created_at IS NOT NULL AND receipt_hash IS NULL)),
  CONSTRAINT ck_its_sug_answer CHECK (state IN ('RECEIVED', 'REVIEWING') OR (answer IS NOT NULL AND answered_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_its_sug_state ON public.its_suggestions (state, created_on DESC);
CREATE INDEX IF NOT EXISTS ix_its_sug_author ON public.its_suggestions (author_id, created_on DESC) WHERE author_id IS NOT NULL;
COMMENT ON TABLE public.its_suggestions IS 'v10.492 (D270) 사내 제안 · 건의 — 익명이면 작성자 · 시각 칸이 비어 있음(DB 트리거 · CHECK) · 날짜만 · 번호 무작위 · 지우지 않음';

CREATE OR REPLACE FUNCTION public.fn_its_suggest_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.created_on := (now() AT TIME ZONE 'Asia/Seoul')::date;
  IF NEW.is_anon THEN
    NEW.author_id := NULL;      -- 익명: 쓴 사람을 남기지 않음(서버가 보내도 지움)
    NEW.created_at := NULL;     -- 익명: 시각을 남기지 않음(날짜만)
  ELSE
    NEW.created_at := now();
    NEW.receipt_hash := NULL;
  END IF;
  NEW.state := 'RECEIVED'; NEW.answer := NULL; NEW.answered_at := NULL; NEW.answered_by := NULL;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.fn_its_suggest_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ITS_SUGGEST: 제안은 지우지 않습니다.'; END IF;
  IF (NEW.category, NEW.title, NEW.body, NEW.is_anon, NEW.author_id, NEW.created_on, NEW.created_at, NEW.receipt_hash)
     IS DISTINCT FROM (OLD.category, OLD.title, OLD.body, OLD.is_anon, OLD.author_id, OLD.created_on, OLD.created_at, OLD.receipt_hash) THEN
    RAISE EXCEPTION 'ITS_SUGGEST: 제안 내용 · 익명 여부 · 쓴 사람 · 날짜는 바꾸지 않습니다.';
  END IF;
  IF OLD.state IN ('DECLINED', 'DONE') AND (NEW.state, NEW.answer) IS DISTINCT FROM (OLD.state, OLD.answer) THEN
    RAISE EXCEPTION 'ITS_SUGGEST_STATE: 끝난 제안은 바꾸지 않습니다.';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'RECEIVED' AND NEW.state IN ('REVIEWING', 'ADOPTED', 'DECLINED'))
    OR (OLD.state = 'REVIEWING' AND NEW.state IN ('RECEIVED', 'ADOPTED', 'DECLINED'))
    OR (OLD.state = 'ADOPTED' AND NEW.state = 'DONE')) THEN
    RAISE EXCEPTION 'ITS_SUGGEST_STATE: 그 상태로는 옮길 수 없습니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_its_suggest_insert' AND tgrelid = 'public.its_suggestions'::regclass) THEN
    CREATE TRIGGER trg_its_suggest_insert BEFORE INSERT ON public.its_suggestions FOR EACH ROW EXECUTE FUNCTION public.fn_its_suggest_insert();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_its_suggest_guard' AND tgrelid = 'public.its_suggestions'::regclass) THEN
    CREATE TRIGGER trg_its_suggest_guard BEFORE UPDATE OR DELETE ON public.its_suggestions FOR EACH ROW EXECUTE FUNCTION public.fn_its_suggest_guard();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.its_suggestion_log (
  id             bigserial PRIMARY KEY,
  suggestion_id  uuid NOT NULL REFERENCES public.its_suggestions(id),
  from_state     text NOT NULL,
  to_state       text NOT NULL,
  note           text CHECK (note IS NULL OR char_length(note) <= 2000),
  actor          uuid REFERENCES public.accounts(id),
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_its_sug_log ON public.its_suggestion_log (suggestion_id, id);
COMMENT ON TABLE public.its_suggestion_log IS 'v10.492 (D270) 제안 검토 · 답변 기록 — 쌓기만 · 검토한 운영자만(쓴 사람은 남기지 않음)';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_its_suggestion_log_ro' AND tgrelid = 'public.its_suggestion_log'::regclass) THEN
    CREATE TRIGGER trg_its_suggestion_log_ro BEFORE UPDATE OR DELETE ON public.its_suggestion_log FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('its.suggest_alert', 'on', 'ADMIN', '제안함 접수 대기 알림(v10.492 · D270) — on 이면 매일 08:55 「접수」 그대로인 제안 수를 운영 알림 ITS_SUGGEST_WAITING 하나로(제목 · 쓴 사람 없이 수만 · 하루 한 번 · 0 이면 풀림)', false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;


/* ── ④ 사내 설문 (v10.493 · docs/631) ─────────────────────────────────────────────────────
 *   질문 유형 SINGLE(하나 고르기) · MULTI(여럿 고르기) · SCALE(1 ~ N 점) · TEXT(글) · 대상 역할(비우면 운영 계정 모두) · 기간(92일까지) · 익명
 *   DRAFT(고치는 중) → OPEN(받는 중 · 기간 안만) → CLOSED(마감 · 정기 작업이 기간 지나면) · CANCELED
 *   두 번 내기 막기: its_survey_takers(설문 · 계정 — 낸 사실만 · 시각 없음) PK
 *   답: its_survey_answers — 익명 설문이면 account_id 칸이 비어 있음(트리거가 지움 · CHECK) · 번호 무작위 uuid · 시각 · 날짜 칸 없음(낸 사람 기록과 이어지지 않게)
 *   결과 · CSV: 익명 설문은 마감 뒤 · 응답 수가 its.survey_min_count(처음 3) 이상일 때만 · CSV 는 내려받기 승인(ITS_SURVEY) */
CREATE TABLE IF NOT EXISTS public.its_surveys (
  id          bigserial PRIMARY KEY,
  title       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 100),
  intro       text CHECK (intro IS NULL OR char_length(intro) <= 1000),
  is_anon     boolean NOT NULL DEFAULT true,
  audience    text[] NOT NULL DEFAULT ARRAY[]::text[] CHECK (audience <@ ARRAY['SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF']::text[]),
  opens_on    date NOT NULL,
  closes_on   date NOT NULL,
  state       text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'OPEN', 'CLOSED', 'CANCELED')),
  created_by  uuid NOT NULL REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  opened_at   timestamptz,
  closed_at   timestamptz,
  cancel_note text CHECK (cancel_note IS NULL OR char_length(cancel_note) <= 200),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_its_survey_range CHECK (closes_on >= opens_on AND closes_on - opens_on <= 92),
  CONSTRAINT ck_its_survey_open CHECK (state = 'DRAFT' OR state = 'CANCELED' OR opened_at IS NOT NULL),
  CONSTRAINT ck_its_survey_closed CHECK (state <> 'CLOSED' OR closed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_its_surveys_state ON public.its_surveys (state, closes_on);
COMMENT ON TABLE public.its_surveys IS 'v10.493 (D270) 사내 설문 — 대상 역할 · 기간 · 익명 · DRAFT → OPEN → CLOSED · 지우지 않음';

CREATE TABLE IF NOT EXISTS public.its_survey_questions (
  id          bigserial PRIMARY KEY,
  survey_id   bigint NOT NULL REFERENCES public.its_surveys(id),
  ord         integer NOT NULL CHECK (ord BETWEEN 1 AND 30),
  qtype       text NOT NULL CHECK (qtype IN ('SINGLE', 'MULTI', 'SCALE', 'TEXT')),
  body        text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 2 AND 300),
  options     text[] NOT NULL DEFAULT ARRAY[]::text[],
  scale_max   integer,
  required    boolean NOT NULL DEFAULT true,
  UNIQUE (survey_id, ord),
  CONSTRAINT ck_its_q_options CHECK (
       (qtype IN ('SINGLE', 'MULTI') AND cardinality(options) BETWEEN 2 AND 12 AND scale_max IS NULL)
    OR (qtype = 'SCALE' AND cardinality(options) = 0 AND scale_max BETWEEN 3 AND 10)
    OR (qtype = 'TEXT' AND cardinality(options) = 0 AND scale_max IS NULL))
);
COMMENT ON TABLE public.its_survey_questions IS 'v10.493 (D270) 설문 질문 — 고치는 중(DRAFT)인 설문만 넣고 고치고 뺌';

CREATE TABLE IF NOT EXISTS public.its_survey_takers (
  survey_id   bigint NOT NULL REFERENCES public.its_surveys(id),
  account_id  uuid NOT NULL REFERENCES public.accounts(id),
  PRIMARY KEY (survey_id, account_id)
);
COMMENT ON TABLE public.its_survey_takers IS 'v10.493 (D270) 설문 낸 사람 — 두 번 내기 막기 · 응답률만 · 답 · 시각 없음 · 쌓기만';

CREATE TABLE IF NOT EXISTS public.its_survey_answers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id   bigint NOT NULL REFERENCES public.its_surveys(id),
  account_id  uuid REFERENCES public.accounts(id),
  answers     jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'object')
);
CREATE INDEX IF NOT EXISTS ix_its_survey_answers ON public.its_survey_answers (survey_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_its_survey_answers_named ON public.its_survey_answers (survey_id, account_id) WHERE account_id IS NOT NULL;
COMMENT ON TABLE public.its_survey_answers IS 'v10.493 (D270) 설문 답 — 익명 설문이면 계정 칸 없음(트리거) · 번호 무작위 · 시각 없음 · 쌓기만';

CREATE OR REPLACE FUNCTION public.fn_its_survey_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ITS_SURVEY: 설문은 지우지 않습니다(취소하십시오).'; END IF;
  IF (NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'ITS_SURVEY: 만든 사람은 바꾸지 않습니다.';
  END IF;
  IF OLD.state IN ('CLOSED', 'CANCELED') AND (NEW.state, NEW.title, NEW.intro, NEW.is_anon, NEW.audience, NEW.opens_on, NEW.closes_on)
     IS DISTINCT FROM (OLD.state, OLD.title, OLD.intro, OLD.is_anon, OLD.audience, OLD.opens_on, OLD.closes_on) THEN
    RAISE EXCEPTION 'ITS_SURVEY_STATE: 마감 · 취소한 설문은 바꾸지 않습니다.';
  END IF;
  IF OLD.state = 'OPEN' AND (NEW.title, NEW.intro, NEW.is_anon, NEW.audience, NEW.opens_on) IS DISTINCT FROM (OLD.title, OLD.intro, OLD.is_anon, OLD.audience, OLD.opens_on) THEN
    RAISE EXCEPTION 'ITS_SURVEY_STATE: 받는 중인 설문은 마감일만 늦출 수 있습니다.';
  END IF;
  IF OLD.state = 'OPEN' AND NEW.closes_on < OLD.closes_on THEN
    RAISE EXCEPTION 'ITS_SURVEY_STATE: 받는 중인 설문의 마감일은 앞당기지 않습니다(지금 마감하십시오).';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'DRAFT' AND NEW.state IN ('OPEN', 'CANCELED'))
    OR (OLD.state = 'OPEN' AND NEW.state IN ('CLOSED', 'CANCELED'))) THEN
    RAISE EXCEPTION 'ITS_SURVEY_STATE: 그 상태로는 옮길 수 없습니다.';
  END IF;
  IF OLD.state = 'DRAFT' AND NEW.state = 'OPEN' AND NOT EXISTS (SELECT 1 FROM public.its_survey_questions q WHERE q.survey_id = NEW.id) THEN
    RAISE EXCEPTION 'ITS_SURVEY_EMPTY: 질문이 하나도 없는 설문은 열지 않습니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.fn_its_survey_q_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT s.state INTO st FROM public.its_surveys s WHERE s.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.survey_id ELSE NEW.survey_id END;
  IF st IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'ITS_SURVEY_STATE: 질문은 고치는 중(DRAFT)인 설문에서만 바꿉니다.';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.survey_id IS DISTINCT FROM OLD.survey_id THEN
    RAISE EXCEPTION 'ITS_SURVEY: 질문을 다른 설문으로 옮기지 않습니다.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

/* 답 넣기 — 받는 중 · 기간 안 · 익명이면 계정을 지움 · 질문 유형마다 값 모양(서버 검사와 같음) */
CREATE OR REPLACE FUNCTION public.fn_its_survey_answer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s record; q record; v jsonb; k text; today date := (now() AT TIME ZONE 'Asia/Seoul')::date; n int;
BEGIN
  SELECT * INTO s FROM public.its_surveys WHERE id = NEW.survey_id;
  IF s.id IS NULL OR s.state <> 'OPEN' OR today < s.opens_on OR today > s.closes_on THEN
    RAISE EXCEPTION 'ITS_SURVEY_CLOSED: 지금 받는 설문이 아닙니다.';
  END IF;
  IF s.is_anon THEN
    NEW.account_id := NULL;   -- 익명: 누가 냈는지 답에 남기지 않음(낸 사실은 its_survey_takers 에만 · 시각 없음)
  ELSIF NEW.account_id IS NULL THEN
    RAISE EXCEPTION 'ITS_SURVEY_ANSWER: 이름을 밝히는 설문은 계정이 있어야 합니다.';
  END IF;
  FOR k IN SELECT jsonb_object_keys(NEW.answers) LOOP
    IF k !~ '^[0-9]{1,18}$' OR NOT EXISTS (SELECT 1 FROM public.its_survey_questions x WHERE x.survey_id = s.id AND x.id = k::bigint) THEN
      RAISE EXCEPTION 'ITS_SURVEY_ANSWER: 이 설문에 없는 질문의 답이 있습니다.';
    END IF;
  END LOOP;
  FOR q IN SELECT * FROM public.its_survey_questions x WHERE x.survey_id = s.id ORDER BY x.ord LOOP
    v := NEW.answers -> q.id::text;
    IF v IS NULL OR v = 'null'::jsonb THEN
      IF q.required THEN RAISE EXCEPTION 'ITS_SURVEY_ANSWER: 꼭 답할 질문이 비었습니다.'; END IF;
      CONTINUE;
    END IF;
    IF q.qtype = 'SINGLE' THEN
      IF jsonb_typeof(v) <> 'number' OR (v #>> '{}') !~ '^[0-9]{1,2}$' THEN
        RAISE EXCEPTION 'ITS_SURVEY_ANSWER: 고를 수 있는 답이 아닙니다.';
      END IF;
      IF (v #>> '{}')::int >= cardinality(q.options) THEN
        RAISE EXCEPTION 'ITS_SURVEY_ANSWER: 고를 수 있는 답이 아닙니다.';
      END IF;
    ELSIF q.qtype = 'MULTI' THEN
      IF jsonb_typeof(v) <> 'array' OR jsonb_array_length(v) < 1 OR jsonb_array_length(v) > cardinality(q.options) THEN
        RAISE EXCEPTION 'ITS_SURVEY_ANSWER: 여럿 고르기 답 모양이 아닙니다.';
      END IF;
      SELECT count(*) INTO n FROM jsonb_array_elements(v) e
       WHERE CASE WHEN jsonb_typeof(e) = 'number' AND (e #>> '{}') ~ '^[0-9]{1,2}$' THEN (e #>> '{}')::int >= cardinality(q.options) ELSE true END;
      IF n > 0 OR (SELECT count(DISTINCT e #>> '{}') FROM jsonb_array_elements(v) e) <> jsonb_array_length(v) THEN
        RAISE EXCEPTION 'ITS_SURVEY_ANSWER: 여럿 고르기 답 모양이 아닙니다.';
      END IF;
    ELSIF q.qtype = 'SCALE' THEN
      IF jsonb_typeof(v) <> 'number' OR (v #>> '{}') !~ '^[0-9]{1,2}$' THEN
        RAISE EXCEPTION 'ITS_SURVEY_ANSWER: 점수가 범위 밖입니다.';
      END IF;
      IF (v #>> '{}')::int NOT BETWEEN 1 AND q.scale_max THEN
        RAISE EXCEPTION 'ITS_SURVEY_ANSWER: 점수가 범위 밖입니다.';
      END IF;
    ELSE
      IF jsonb_typeof(v) <> 'string' OR char_length(v #>> '{}') > 1000 THEN
        RAISE EXCEPTION 'ITS_SURVEY_ANSWER: 글 답은 1000자까지입니다.';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_its_survey_guard' AND tgrelid = 'public.its_surveys'::regclass) THEN
    CREATE TRIGGER trg_its_survey_guard BEFORE UPDATE OR DELETE ON public.its_surveys FOR EACH ROW EXECUTE FUNCTION public.fn_its_survey_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_its_survey_q_guard' AND tgrelid = 'public.its_survey_questions'::regclass) THEN
    CREATE TRIGGER trg_its_survey_q_guard BEFORE INSERT OR UPDATE OR DELETE ON public.its_survey_questions FOR EACH ROW EXECUTE FUNCTION public.fn_its_survey_q_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_its_survey_answer_guard' AND tgrelid = 'public.its_survey_answers'::regclass) THEN
    CREATE TRIGGER trg_its_survey_answer_guard BEFORE INSERT ON public.its_survey_answers FOR EACH ROW EXECUTE FUNCTION public.fn_its_survey_answer_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_its_survey_answers_ro' AND tgrelid = 'public.its_survey_answers'::regclass) THEN
    CREATE TRIGGER trg_its_survey_answers_ro BEFORE UPDATE OR DELETE ON public.its_survey_answers FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_its_survey_takers_ro' AND tgrelid = 'public.its_survey_takers'::regclass) THEN
    CREATE TRIGGER trg_its_survey_takers_ro BEFORE UPDATE OR DELETE ON public.its_survey_takers FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('its.survey_min_count', '3', 'ADMIN', '사내 설문 — 익명 설문 결과 · CSV 를 보여 줄 가장 적은 응답 수(v10.493 · D270 · 2 ~ 20 · 처음 3). 이보다 적으면 누가 무엇을 골랐는지 짐작할 수 있어 감춥니다', false, '^([2-9]|1[0-9]|20)$', '3')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('its_office_daily', 1440, 8, 55, NULL, true, 'IT 자산 갱신 알림 · 자동 갱신일 옮김 · 제안 접수 대기 수 · 기간 지난 설문 마감 — 매일 08:55 · D270 · v10.491 ~ 493')
ON CONFLICT (job) DO NOTHING;

/* 내려받기 승인 대상에 ITS_SURVEY — 지금 CHECK 목록을 읽어 하나만 더함(앞 묶음이 다른 대상을 더했어도 지우지 않게 · 이미 있으면 그대로) */
DO $$
DECLARE d text; vals text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO d FROM pg_constraint c
   WHERE c.conname = 'export_requests_target_check' AND c.conrelid = 'public.export_requests'::regclass;
  IF d IS NULL OR position('''ITS_SURVEY''' IN d) > 0 THEN RETURN; END IF;
  SELECT array_agg((m.x)[1]) INTO vals FROM regexp_matches(d, '''([A-Z][A-Z0-9_]*)''', 'g') AS m(x);
  vals := coalesce(vals, ARRAY[]::text[]) || 'ITS_SURVEY'::text;
  ALTER TABLE public.export_requests DROP CONSTRAINT export_requests_target_check;
  EXECUTE 'ALTER TABLE public.export_requests ADD CONSTRAINT export_requests_target_check CHECK (target IN ('
          || (SELECT string_agg(quote_literal(u.v), ', ') FROM unnest(vals) AS u(v)) || '))';
END $$;


/* ── ⑤ ㉕ 권한(D258) 시드에 새 탭 3개 — gen_seed.py 와 같은 규칙(탭 역할 그대로 · 세무사 빠짐 · 회계 탭 아님)
 *   its-assets(IT 자산 · 구독) = ADMIN · PAYOUT · its-suggest(제안함) · its-survey(사내 설문) = 운영 역할 모두
 *   주소 맵은 탭 화면(ITS-020 · 030 · 040)의 API 만 — 제안 쓰기 · 내 제안 · 설문 답 넣기(ITS-031 · 041)는 넣지 않음(@Roles 만 ·
 *   권한 검사 기록(perm_shadow_log)에 누가 · 언제 그 주소를 불렀는지 남지 않게) · 연동 키 만료(ITS-010)는 SUPER 전용(외부 연동 · 넓히기 금지) */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('its-assets', 'IT 자산 · 구독', 'admoff', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2700),
  ('its-suggest', '제안함', 'admoff', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2710),
  ('its-survey', '사내 설문', 'admoff', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2720)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT g, 'its-assets', l FROM (VALUES ('R_ADMIN'), ('R_PAYOUT')) x(g)
  CROSS JOIN (VALUES ('VIEW'), ('EDIT'), ('APPROVE'), ('EXPORT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = x.g)
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT g, t, l FROM (VALUES ('R_ADMIN'), ('R_PAYOUT'), ('R_REVIEWER'), ('R_PARTNER_MAL'), ('R_PARTNER_AFF')) x(g)
  CROSS JOIN (VALUES ('its-suggest'), ('its-survey')) z(t)
  CROSS JOIN (VALUES ('VIEW'), ('EDIT'), ('APPROVE'), ('EXPORT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = x.g)
ON CONFLICT DO NOTHING;

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/its/assets', 'its-assets', 'VIEW'),
  ('POST', '/admin/its/assets', 'its-assets', 'EDIT'),
  ('PUT', '/admin/its/assets/{id}', 'its-assets', 'EDIT'),
  ('POST', '/admin/its/assets/{id}/cancel', 'its-assets', 'EDIT'),
  ('GET', '/admin/its/suggestions', 'its-suggest', 'VIEW'),
  ('GET', '/admin/its/suggestions/{id}', 'its-suggest', 'VIEW'),
  ('POST', '/admin/its/suggestions/{id}/decide', 'its-suggest', 'APPROVE'),
  ('GET', '/admin/its/surveys', 'its-survey', 'VIEW'),
  ('POST', '/admin/its/surveys', 'its-survey', 'EDIT'),
  ('GET', '/admin/its/surveys/{id}', 'its-survey', 'VIEW'),
  ('PUT', '/admin/its/surveys/{id}', 'its-survey', 'EDIT'),
  ('POST', '/admin/its/surveys/{id}/open', 'its-survey', 'EDIT'),
  ('POST', '/admin/its/surveys/{id}/close', 'its-survey', 'APPROVE'),
  ('POST', '/admin/its/surveys/{id}/cancel', 'its-survey', 'EDIT'),
  ('GET', '/admin/its/surveys/{id}/results', 'its-survey', 'VIEW'),
  ('GET', '/admin/its/surveys/{id}/export', 'its-survey', 'EXPORT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

