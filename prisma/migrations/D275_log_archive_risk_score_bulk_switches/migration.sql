/* D275 (v10.509 ~ 512 · docs/647 ~ 650) ㊺ 기록 · 안전 · 운영 — 감사 · 접속 기록 3년 보관(월 묶음 · 지문 · S3 · off) · 이상 거래 점수 · 운영 화면 일괄 처리 · 기능 스위치 한눈에 */

-- =====================================================================
-- D275 (v10.509 ~ 512 · docs/647 ~ 650) ㊺ 기록 · 안전 · 운영 — 대표 11/20 「지금 바로 동시 착수」
--   ① v10.509 감사 · 접속 기록 장기 보관 — 월 묶음(gzip JSON 줄) · 묶음마다 sha256 · 목록(매니페스트) 지문을 앞 묶음 지문 + D235 감사 사슬 머리와 묶음
--      대표 11/20 「감사 · 접속기록은 3년 보관」: 보관 36개월(처음) · 법정 최소 12개월보다 짧게 못 바꿈(설정 무늬 = 서버 정규식)
--      36개월 지난 묶음은 정기 작업이 파기(파기 기록 · 감사 한 줄 먼저) · 운영 DB 원래 줄 정리는 따로 설정(처음 0 = 지우지 않음)
--      원래 줄은 「묶음으로 옮겨 지문 확인이 끝난 달」만 fn_opx_purge_month 가 지움(확인 전 · 실패 · 줄 수 다름이면 막음)
--   ② v10.510 이상 거래 점수 — 규칙 표(점수 · 기준값 SUPER) · 계정별 점수 · 까닭 · 기준 넘으면 검수 대기(opx_risk_cases) + 위험감지 경보 + 운영 알림
--   ③ v10.511 운영 화면 일괄 처리 — 한 번 실행 기록(opx_bulk_runs · 쌓기만) · 감사는 줄마다(서버)
--   ④ v10.512 기능 스위치 한눈에 — 켤 조건 문서(opx_switch_docs · 읽기만 화면)
--   ⑤ ㉕ 권한 시드 · 위험 규칙 RSK-OPX
--   지우는 문장 없음(정리 함수는 정기 작업이 부를 때만) · 다시 돌려도 같음 · RAISE 글자에 퍼센트 기호 없음
-- =====================================================================

/* ── ① 기록 장기 보관 ── */
CREATE TABLE IF NOT EXISTS public.opx_archive_bundles (
  id            bigserial PRIMARY KEY,
  source        text NOT NULL CHECK (source IN ('AUDIT', 'PII', 'ALERT', 'SETTING', 'LOGIN')),
  month         date NOT NULL CHECK (extract(day FROM month) = 1),
  rows          integer NOT NULL CHECK (rows >= 0),
  first_id      bigint,
  last_id       bigint,
  file_name     text NOT NULL CHECK (file_name ~ '^[a-z]{3,8}_[0-9]{4}-[0-9]{2}\.jsonl\.gz$'),
  bytes         bigint NOT NULL CHECK (bytes >= 0),
  sha256        text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  audit_seq     bigint,
  audit_hash    text,
  prev_manifest text,
  manifest_hash text NOT NULL UNIQUE CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (source, month)
);
COMMENT ON TABLE public.opx_archive_bundles IS 'v10.509 (D275) 기록 장기 보관 월 묶음 목록 — 묶음 sha256 · 목록 지문(앞 묶음 지문 · 감사 사슬 머리 순번 · 지문을 묶은 sha256) · 쌓기만(고치기 · 지우기 막음 · 파기해도 이 줄은 남음)';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_opx_archive_bundles_ro' AND tgrelid = 'public.opx_archive_bundles'::regclass) THEN
    CREATE TRIGGER trg_opx_archive_bundles_ro BEFORE UPDATE OR DELETE ON public.opx_archive_bundles FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.opx_archive_events (
  id         bigserial PRIMARY KEY,
  bundle_id  bigint NOT NULL REFERENCES public.opx_archive_bundles(id),
  kind       text NOT NULL CHECK (kind IN ('S3_PUT', 'VERIFY', 'DISPOSE', 'PURGE')),
  ok         boolean NOT NULL,
  detail     jsonb,
  created_by uuid,
  at         timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_opx_archive_events_bundle ON public.opx_archive_events (bundle_id, kind, at DESC);
COMMENT ON TABLE public.opx_archive_events IS 'v10.509 (D275) 묶음 사건 — 디스크 밖(S3) 올림 · 복원 확인 · 파기(파일 지움 전 목록 · 지문) · DB 원래 줄 정리 · 쌓기만';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_opx_archive_events_ro' AND tgrelid = 'public.opx_archive_events'::regclass) THEN
    CREATE TRIGGER trg_opx_archive_events_ro BEFORE UPDATE OR DELETE ON public.opx_archive_events FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* 정리 지우기 다시 확인(보안 검토 B-1) — 거래 설정 app.opx_purge 글자만 믿지 않고 트리거 안에서 조건을 다시 봄
 *   ① 설정 opx.archive_db_purge_months 정수 13 이상 ② 줄의 달(한국 달)이 지금 달 - 그 개월보다 앞
 *   ③ 그 종류 · 그 달 묶음에 복원 확인(VERIFY) 성공 · 디스크 밖(S3_PUT) 성공이 있고 파기 · 정리(PURGE 성공) 전
 *   하나라도 아니면 false — 부르는 트리거가 원래 막는 오류를 냄 */
CREATE OR REPLACE FUNCTION public.fn_opx_purge_ok(p_kind text, p_ts timestamptz) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE m int; ym date; bid bigint;
BEGIN
  IF p_kind IS NULL OR p_ts IS NULL THEN RETURN false; END IF;
  IF coalesce(current_setting('app.opx_purge', true), '') <> p_kind || ':' || to_char(p_ts AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') THEN RETURN false; END IF;
  m := coalesce((SELECT value::int FROM public.site_settings WHERE key = 'opx.archive_db_purge_months' AND value ~ '^[0-9]{1,3}$'), 0);
  IF m < 13 THEN RETURN false; END IF;
  ym := date_trunc('month', p_ts AT TIME ZONE 'Asia/Seoul')::date;
  IF ym >= (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') - make_interval(months => m))::date THEN RETURN false; END IF;
  SELECT b.id INTO bid FROM public.opx_archive_bundles b WHERE b.source = p_kind AND b.month = ym;
  IF bid IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.opx_archive_events e WHERE e.bundle_id = bid AND e.kind = 'VERIFY' AND e.ok) THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.opx_archive_events e WHERE e.bundle_id = bid AND e.kind = 'S3_PUT' AND e.ok) THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.opx_archive_events e WHERE e.bundle_id = bid AND (e.kind = 'DISPOSE' OR (e.kind = 'PURGE' AND e.ok))) THEN RETURN false; END IF;
  RETURN true;
END $$;
COMMENT ON FUNCTION public.fn_opx_purge_ok(text, timestamptz) IS 'v10.509 (D275 · 보안 검토 B-1) 감사 · 접속 · 설정 기록 지우기 트리거가 정리 표시(app.opx_purge) 뒤에 다시 보는 조건 — 13개월 이상 · 기준보다 오래된 달 · 복원 확인 · S3 올림 성공 · 파기 · 정리 전';

/* 감사 기록 지우기 막기 — D235 함수와 같되 「묶음 확인이 끝난 달 정리」(거래 설정 app.opx_purge = 'AUDIT:YYYY-MM' · fn_opx_purge_month 만 검 + fn_opx_purge_ok 조건)만 지우기 허용 */
CREATE OR REPLACE FUNCTION public.fn_block_audit_write() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.fn_opx_purge_ok('AUDIT', OLD.occurred_at) THEN
      RETURN OLD;   -- v10.509 (D275) 묶음 · 지문 · S3 확인이 끝난 달만(정리 표시 + 조건 다시 봄 · B-1)
    END IF;
    RAISE EXCEPTION USING MESSAGE = 'append-only table: DELETE on ' || TG_TABLE_NAME || ' is forbidden';
  END IF;

  -- 마스킹만 허용합니다. 나머지가 하나라도 다르면 거부합니다(v10.356 D235 — 사슬 칸도)
  IF NEW.id                IS DISTINCT FROM OLD.id
  OR NEW.actor_account_id  IS DISTINCT FROM OLD.actor_account_id
  OR NEW.actor_role        IS DISTINCT FROM OLD.actor_role
  OR NEW.action            IS DISTINCT FROM OLD.action
  OR NEW.target_type       IS DISTINCT FROM OLD.target_type
  OR NEW.target_id         IS DISTINCT FROM OLD.target_id
  OR NEW.before_data       IS DISTINCT FROM OLD.before_data
  OR NEW.after_data        IS DISTINCT FROM OLD.after_data
  OR NEW.occurred_at       IS DISTINCT FROM OLD.occurred_at
  OR NEW.chain_seq         IS DISTINCT FROM OLD.chain_seq
  OR NEW.chain_prev        IS DISTINCT FROM OLD.chain_prev
  OR NEW.chain_hash        IS DISTINCT FROM OLD.chain_hash
  OR NEW.ip                IS NOT NULL
  OR NEW.user_agent        IS NOT NULL
  THEN
    RAISE EXCEPTION USING MESSAGE = 'append-only table: UPDATE on ' || TG_TABLE_NAME || ' is forbidden (IP·User-Agent 마스킹만 허용)';
  END IF;

  RETURN NEW;
END $$;

/* 개인정보 접속기록 · 설정 바뀐 기록 — 고치기는 그대로 막고, 지우기는 「묶음 확인이 끝난 달 정리」만(인자: 시각 칸 · 묶음 종류 · 막을 때 글자) */
CREATE OR REPLACE FUNCTION public.fn_opx_ro_or_purge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.fn_opx_purge_ok(TG_ARGV[1], (to_jsonb(OLD) ->> TG_ARGV[0])::timestamptz) THEN RETURN OLD; END IF;   -- 정리 표시 + 조건 다시 봄(B-1)
  END IF;
  RAISE EXCEPTION USING MESSAGE = TG_ARGV[2] || ' (' || TG_OP || ' · ' || TG_TABLE_NAME || ')';
END $$;
DROP TRIGGER IF EXISTS trg_pii_access_ro ON audit.pii_access_logs;
CREATE TRIGGER trg_pii_access_ro BEFORE DELETE OR UPDATE ON audit.pii_access_logs
  FOR EACH ROW EXECUTE FUNCTION public.fn_opx_ro_or_purge('occurred_at', 'PII', 'append-only table: 개인정보 접속기록은 고치거나 지울 수 없습니다');
DROP TRIGGER IF EXISTS trg_site_setting_changes_ro ON public.site_setting_changes;
CREATE TRIGGER trg_site_setting_changes_ro BEFORE UPDATE OR DELETE ON public.site_setting_changes
  FOR EACH ROW EXECUTE FUNCTION public.fn_opx_ro_or_purge('at', 'SETTING', 'APND: 쌓기만 하는 기록이라 고치거나 지울 수 없습니다');

/* 통째 비우기(TRUNCATE) 막기(보안 검토 B-4) — 줄마다 트리거는 TRUNCATE 에 안 걸림 · 문장마다 fn_block_write(B075) */
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_logs_no_truncate' AND tgrelid = 'audit.audit_logs'::regclass) THEN
    CREATE TRIGGER trg_audit_logs_no_truncate BEFORE TRUNCATE ON audit.audit_logs FOR EACH STATEMENT EXECUTE FUNCTION public.fn_block_write();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_pii_access_no_truncate' AND tgrelid = 'audit.pii_access_logs'::regclass) THEN
    CREATE TRIGGER trg_pii_access_no_truncate BEFORE TRUNCATE ON audit.pii_access_logs FOR EACH STATEMENT EXECUTE FUNCTION public.fn_block_write();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_site_setting_changes_no_truncate' AND tgrelid = 'public.site_setting_changes'::regclass) THEN
    CREATE TRIGGER trg_site_setting_changes_no_truncate BEFORE TRUNCATE ON public.site_setting_changes FOR EACH STATEMENT EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* DB 원래 줄 정리 — 한 묶음(달)만 · 조건: 정리 설정 13 이상(B-3) · 그 달이 정리 기준보다 오래됨 · 복원 확인 성공 · 디스크 밖(S3) 올림 성공(B-2) · 파기 · 정리 전 · DB 줄 수 = 묶음 줄 수 · 가장 큰 번호 ≤ 묶음 끝 번호
 *   LOGIN(운영자 로그인)은 privacy.login_history_days 파기가 따로 있어 여기서 지우지 않음 */
CREATE OR REPLACE FUNCTION public.fn_opx_purge_month(p_bundle bigint) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE b public.opx_archive_bundles; m int; f timestamptz; t timestamptz; cnt int; mx bigint; n int := 0;
BEGIN
  SELECT * INTO b FROM public.opx_archive_bundles WHERE id = p_bundle;
  IF b.id IS NULL THEN RAISE EXCEPTION 'OPX_PURGE: 없는 묶음입니다.'; END IF;
  IF b.source NOT IN ('AUDIT', 'PII', 'ALERT', 'SETTING') THEN RAISE EXCEPTION 'OPX_PURGE: 이 종류는 DB 에서 정리하지 않습니다.'; END IF;
  m := coalesce((SELECT nullif(value, '')::int FROM public.site_settings WHERE key = 'opx.archive_db_purge_months' AND value ~ '^[0-9]{1,3}$'), 0);
  IF m <= 0 THEN RAISE EXCEPTION 'OPX_PURGE: DB 원래 줄 정리가 꺼져 있습니다(opx.archive_db_purge_months 0).'; END IF;
  IF m < 13 THEN RAISE EXCEPTION 'OPX_PURGE: 정리 개월은 13개월 이상이어야 합니다.'; END IF;   -- 설정 무늬와 따로 함수 안에서도(B-3)
  IF b.month >= (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') - make_interval(months => m))::date THEN
    RAISE EXCEPTION 'OPX_PURGE: 아직 정리 기준(개월)이 지나지 않은 달입니다.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.opx_archive_events e WHERE e.bundle_id = b.id AND e.kind = 'VERIFY' AND e.ok) THEN
    RAISE EXCEPTION 'OPX_PURGE: 복원 확인이 끝나지 않은 묶음입니다.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.opx_archive_events e WHERE e.bundle_id = b.id AND e.kind = 'VERIFY' AND NOT e.ok
              AND e.at > (SELECT max(x.at) FROM public.opx_archive_events x WHERE x.bundle_id = b.id AND x.kind = 'VERIFY' AND x.ok)) THEN
    RAISE EXCEPTION 'OPX_PURGE: 마지막 복원 확인이 실패한 묶음입니다.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.opx_archive_events e WHERE e.bundle_id = b.id AND e.kind = 'S3_PUT' AND e.ok) THEN
    RAISE EXCEPTION 'OPX_PURGE: 디스크 밖(S3)에 올리지 않은 묶음은 DB 에서 정리하지 않습니다.';   -- B-2
  END IF;
  IF EXISTS (SELECT 1 FROM public.opx_archive_events e WHERE e.bundle_id = b.id AND (e.kind = 'DISPOSE' OR (e.kind = 'PURGE' AND e.ok))) THEN
    RAISE EXCEPTION 'OPX_PURGE: 이미 파기했거나 정리한 묶음입니다.';
  END IF;
  f := b.month::timestamp AT TIME ZONE 'Asia/Seoul';
  t := (b.month + interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul';
  IF b.source = 'AUDIT' THEN SELECT count(*)::int, max(id) INTO cnt, mx FROM audit.audit_logs WHERE occurred_at >= f AND occurred_at < t;
  ELSIF b.source = 'PII' THEN SELECT count(*)::int, max(id) INTO cnt, mx FROM audit.pii_access_logs WHERE occurred_at >= f AND occurred_at < t;
  ELSIF b.source = 'ALERT' THEN SELECT count(*)::int, max(id) INTO cnt, mx FROM public.ops_alerts WHERE raised_at >= f AND raised_at < t;
  ELSE SELECT count(*)::int, max(id) INTO cnt, mx FROM public.site_setting_changes WHERE at >= f AND at < t;
  END IF;
  IF cnt <> b.rows OR (mx IS NOT NULL AND mx > coalesce(b.last_id, 0)) THEN
    INSERT INTO public.opx_archive_events (bundle_id, kind, ok, detail) VALUES (b.id, 'PURGE', false, jsonb_build_object('why', 'DB 줄 수가 묶음과 다름', 'db', cnt, 'bundle', b.rows));
    RETURN -1;
  END IF;
  PERFORM set_config('app.opx_purge', b.source || ':' || to_char(b.month, 'YYYY-MM'), true);
  IF b.source = 'AUDIT' THEN DELETE FROM audit.audit_logs WHERE occurred_at >= f AND occurred_at < t;
  ELSIF b.source = 'PII' THEN DELETE FROM audit.pii_access_logs WHERE occurred_at >= f AND occurred_at < t;
  ELSIF b.source = 'ALERT' THEN DELETE FROM public.ops_alerts WHERE raised_at >= f AND raised_at < t;
  ELSE DELETE FROM public.site_setting_changes WHERE at >= f AND at < t;
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('app.opx_purge', '', true);
  INSERT INTO public.opx_archive_events (bundle_id, kind, ok, detail) VALUES (b.id, 'PURGE', true, jsonb_build_object('rows', n, 'month', to_char(b.month, 'YYYY-MM'), 'source', b.source, 'sha256', b.sha256));
  RETURN n;
END $$;
COMMENT ON FUNCTION public.fn_opx_purge_month(bigint) IS 'v10.509 (D275) 묶음 · 지문 확인이 끝난 달의 운영 DB 원래 줄 정리 — 정기 작업 opx_archive 가 opx.archive_db_purge_months > 0 일 때만 부름';

/* ── ② 이상 거래 점수 ── */
CREATE TABLE IF NOT EXISTS public.opx_risk_rules (
  code        text PRIMARY KEY CHECK (code ~ '^[A-Z_]{3,30}$'),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  description text NOT NULL,
  param       integer NOT NULL CHECK (param BETWEEN 1 AND 3650),
  param_label text NOT NULL,
  points      integer NOT NULL CHECK (points BETWEEN 0 AND 100),
  is_active   boolean NOT NULL DEFAULT true,
  sort        integer NOT NULL DEFAULT 0,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.opx_risk_rules IS 'v10.510 (D275) 이상 거래 점수 규칙 — 계산식은 서버 코드(규칙 코드별) · 점수 · 기준값 · 켜기만 SUPER 가 고침 · 지우지 않음(끄기)';
CREATE OR REPLACE FUNCTION public.fn_opx_risk_rules_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'OPX_RISK_RULE: 규칙은 지우지 않고 끕니다.'; END IF;
  IF NEW.code IS DISTINCT FROM OLD.code THEN RAISE EXCEPTION 'OPX_RISK_RULE: 규칙 코드는 바꿀 수 없습니다.'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_opx_risk_rules_guard' AND tgrelid = 'public.opx_risk_rules'::regclass) THEN
    CREATE TRIGGER trg_opx_risk_rules_guard BEFORE UPDATE OR DELETE ON public.opx_risk_rules FOR EACH ROW EXECUTE FUNCTION public.fn_opx_risk_rules_guard();
  END IF;
END $$;
INSERT INTO public.opx_risk_rules (code, name, description, param, param_label, points, sort) VALUES
  ('NEW_ACCOUNT', '가입한 지 얼마 안 됨', '가입한 지 기준일 안인 계정', 7, '일', 10, 10),
  ('LISTING_BURST', '짧은 시간 매물 여러 개', '최근 24시간 등록한 매물이 기준 개수 이상', 5, '개(24시간)', 25, 20),
  ('SAME_PHONE', '같은 연락처 반복', '같은 휴대폰 번호(숫자만 비교)를 쓰는 다른 계정이 기준 수 이상', 1, '계정', 25, 30),
  ('REPORTED', '신고 받음', '최근 90일 이 계정 · 이 계정 매물에 들어온 신고(기각 뺌)가 기준 건수 이상', 2, '건(90일)', 20, 40),
  ('REPORT_UPHELD', '인정된 신고', '최근 180일 인정(UPHELD)된 신고가 기준 건수 이상', 1, '건(180일)', 25, 50),
  ('BLOCK_NEAR', '가입 차단 목록 근접', '메일 도메인이 가입 차단(메일 도메인) 목록에 있거나 기준일 안에 풀린 것과 같음', 180, '일(풀린 뒤)', 30, 60),
  ('REVIEW_REJECTED', '검수 반려 반복', '최근 30일 검수 반려가 기준 건수 이상', 2, '건(30일)', 15, 70),
  ('WAS_SUSPENDED', '정지 이력', '기준일 안에 운영이 정지한 적이 있음', 365, '일', 20, 80),
  ('NO_IDENTITY', '본인인증 없이 등록', '본인인증을 하지 않았는데 매물이 기준 개수 이상', 1, '개', 10, 90)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.opx_risk_scores (
  account_id  uuid PRIMARY KEY REFERENCES public.accounts(id),
  score       integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  reasons     jsonb NOT NULL DEFAULT '[]'::jsonb,
  via         text NOT NULL CHECK (via IN ('EVENT', 'SWEEP', 'MANUAL')),
  computed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_opx_risk_scores_score ON public.opx_risk_scores (score DESC, computed_at DESC);
COMMENT ON TABLE public.opx_risk_scores IS 'v10.510 (D275) 계정별 이상 거래 점수 · 까닭(규칙 코드 · 점수 · 값) — 운영 화면만 · 회원 화면 · 회원 API 에는 내보내지 않음';

CREATE TABLE IF NOT EXISTS public.opx_risk_dirty (
  account_id uuid PRIMARY KEY,
  why        text NOT NULL,
  at         timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE public.opx_risk_dirty IS 'v10.510 (D275) 점수를 다시 셀 계정(매물 등록 · 신고 접수 때 DB 트리거가 넣음 · 5분마다 정기 작업이 비움)';
CREATE OR REPLACE FUNCTION public.fn_opx_risk_mark() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE acc uuid;
BEGIN
  BEGIN
    IF coalesce((SELECT value FROM public.site_settings WHERE key = 'opx.risk_score'), 'off') <> 'on' THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'listings' THEN acc := NEW.owner_account_id;
    ELSIF NEW.target_type = 'PROFILE' THEN acc := NEW.target_id;
    ELSIF NEW.target_type = 'LISTING' THEN SELECT owner_account_id INTO acc FROM public.listings WHERE id = NEW.target_id;
    END IF;
    IF acc IS NOT NULL THEN
      INSERT INTO public.opx_risk_dirty (account_id, why) VALUES (acc, upper(TG_TABLE_NAME))
      ON CONFLICT (account_id) DO UPDATE SET why = EXCLUDED.why, at = clock_timestamp();
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;   -- 점수 표시는 등록 · 신고를 막지 않음
  END;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_opx_risk_mark_listing' AND tgrelid = 'public.listings'::regclass) THEN
    CREATE TRIGGER trg_opx_risk_mark_listing AFTER INSERT ON public.listings FOR EACH ROW EXECUTE FUNCTION public.fn_opx_risk_mark();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_opx_risk_mark_report' AND tgrelid = 'public.reports'::regclass) THEN
    CREATE TRIGGER trg_opx_risk_mark_report AFTER INSERT ON public.reports FOR EACH ROW EXECUTE FUNCTION public.fn_opx_risk_mark();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.opx_risk_cases (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES public.accounts(id),
  score       integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  reasons     jsonb NOT NULL DEFAULT '[]'::jsonb,
  state       text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'CLEARED', 'ACTIONED')),
  opened_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_by  uuid REFERENCES public.accounts(id),
  decided_at  timestamptz,
  note        text CHECK (note IS NULL OR char_length(note) BETWEEN 2 AND 300),
  CONSTRAINT ck_opx_risk_cases_decided CHECK ((state = 'OPEN') = (decided_at IS NULL) AND (state = 'OPEN' OR note IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_opx_risk_cases_open ON public.opx_risk_cases (account_id) WHERE state = 'OPEN';
COMMENT ON TABLE public.opx_risk_cases IS 'v10.510 (D275) 이상 거래 점수 검수 대기 — 기준을 넘으면 한 줄(계정마다 열린 것 하나) · 문제없음(CLEARED) · 조치함(ACTIONED) 한 번만 · 지우지 않음';
CREATE OR REPLACE FUNCTION public.fn_opx_risk_cases_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'OPX_RISK_CASE: 검수 대기는 지우지 않습니다.'; END IF;
  IF OLD.state <> 'OPEN' OR NEW.state = 'OPEN'
     OR (NEW.account_id, NEW.score, NEW.reasons, NEW.opened_at) IS DISTINCT FROM (OLD.account_id, OLD.score, OLD.reasons, OLD.opened_at) THEN
    RAISE EXCEPTION 'OPX_RISK_CASE: 열린 검수 대기를 한 번만 끝낼 수 있습니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_opx_risk_cases_guard' AND tgrelid = 'public.opx_risk_cases'::regclass) THEN
    CREATE TRIGGER trg_opx_risk_cases_guard BEFORE UPDATE OR DELETE ON public.opx_risk_cases FOR EACH ROW EXECUTE FUNCTION public.fn_opx_risk_cases_guard();
  END IF;
END $$;

INSERT INTO public.risk_rules (code, name, protects, source, false_positive, severity, is_active, sort_order, detect_sql, auto_detect)
VALUES ('RSK-OPX', '이상 거래 점수 기준 넘음', '사기 · 도배 · 차단 우회 예방', '이상 거래 점수(v10.510 · 규칙 표 opx_risk_rules)의 합이 opx.risk_threshold 이상', '새 회원이 한 번에 매물을 여러 개 올린 정상 경우일 수 있습니다 — 까닭 보고 판단.', 'MEDIUM', true, 90, NULL, false)
ON CONFLICT (code) DO NOTHING;

/* ── ③ 일괄 처리 실행 기록 ── */
CREATE TABLE IF NOT EXISTS public.opx_bulk_runs (
  id         bigserial PRIMARY KEY,
  kind       text NOT NULL CHECK (kind IN ('REVIEW', 'REPORT', 'INQUIRY', 'MEMBER')),
  action     text NOT NULL CHECK (action ~ '^[A-Z_]{3,20}$'),
  reason     text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 2 AND 300),
  total      integer NOT NULL CHECK (total BETWEEN 1 AND 100),
  ok_count   integer NOT NULL CHECK (ok_count >= 0),
  fail_count integer NOT NULL CHECK (fail_count >= 0),
  results    jsonb NOT NULL DEFAULT '[]'::jsonb,
  actor      uuid REFERENCES public.accounts(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ck_opx_bulk_runs_sum CHECK (ok_count + fail_count = total)
);
COMMENT ON TABLE public.opx_bulk_runs IS 'v10.511 (D275) 운영 화면 일괄 처리 한 번 — 줄마다 결과(번호 · 됨 · 오류 코드) · 감사 기록은 줄마다 따로 · 쌓기만';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_opx_bulk_runs_ro' AND tgrelid = 'public.opx_bulk_runs'::regclass) THEN
    CREATE TRIGGER trg_opx_bulk_runs_ro BEFORE UPDATE OR DELETE ON public.opx_bulk_runs FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* ── ④ 기능 스위치 켤 조건 ── */
CREATE TABLE IF NOT EXISTS public.opx_switch_docs (
  key           text PRIMARY KEY CHECK (key ~ '^[a-z0-9_]+\.[a-z0-9_.]+$'),
  initial_value text NOT NULL,
  cond          text NOT NULL CHECK (char_length(cond) BETWEEN 2 AND 400),
  doc_ref       text,
  who           text NOT NULL DEFAULT 'SUPER'
);
COMMENT ON TABLE public.opx_switch_docs IS 'v10.512 (D275) 기능 스위치 처음 값 · 켤 조건 · 문서 — 운영 화면 「기능 스위치 한눈에」(읽기만) · 고치기는 마이그레이션으로';
INSERT INTO public.opx_switch_docs (key, initial_value, cond, doc_ref) VALUES
  ('assume.payment', 'on', '결제대행(PG) 계약 · 키 등록 · 실결제 시험 뒤 off(외부 연동 완료 후)', 'CLAUDE.md 현재 상태 · docs/84'),
  ('assume.broker', 'on', '중개사 확인 연동 완료 뒤 off', 'CLAUDE.md 현재 상태'),
  ('assume.bank', 'on', '계좌 확인 연동 완료 뒤 off', 'CLAUDE.md 현재 상태'),
  ('assume.etax', 'on', '전자세금계산서 연동 완료 뒤 off', '전자세금계산서_연동절차.md'),
  ('mall.order_open', 'on', '운영은 꺼둠 — 실결제(assume.payment off) · 소개몰 열기 준비 점검 뒤 SUPER 가 확인 문구와 함께', 'docs/306 · 314'),
  ('mall.tenant', 'off', '입점 약관 게시 · 입점 열기 준비 점검 뒤', 'docs/359'),
  ('signup.open', 'on', '그대로 — 가입 급증 · 자동 가입이 보이면 잠시 off', 'docs/266'),
  ('lead.legal_ok', 'off', '법무 재확인 회신 뒤 on(11/17 회신 · docs/594 4-3 ①)', 'docs/466 · 467'),
  ('site.maintenance_mail', 'off', '메일 준비 · SES 하루 한도 확인 뒤', 'docs/594 4-3 ⑦'),
  ('report.send', 'off', '받을 곳(텔레그램 · 메일) 확인 뒤', 'docs/594 4-3 ⑪'),
  ('acct.deadline_alert', 'on', '그대로', 'docs/594 4-3 ⑪'),
  ('acct.cash_alert', 'on', '그대로 · 기준 잔액(acct.cash_floor)을 정하면 의미가 생김', 'docs/594 4-3 ⑪'),
  ('acct.aging_alert', 'on', '그대로', 'docs/594 4-3 ⑪'),
  ('acct.insurance_alert', 'on', '그대로', 'docs/594 4-3 ⑪'),
  ('acct.biz_status_check', 'off', '사업자 상태 조회 키가 있을 때', 'docs/594 4-3 ⑪'),
  ('acct.taxinbox', 'off', '연동 업체 계약 · 키 뒤(acct.taxinbox_mode LIVE)', 'docs/594 4-3 ⑪'),
  ('acct.taxinbox_mode', 'ASSUME', '연동 업체 키 등록 뒤 LIVE', 'docs/569'),
  ('acct.dunning', 'off', '메일 준비 · 문안 확인 뒤', 'docs/594 4-3 ⑪'),
  ('acct.deadline_payday', 'off', '직원 등록 뒤', 'docs/594 4-3 ⑪'),
  ('acct.receipt_ai', 'off', 'AI 키 · 월 상한 확인 뒤', 'docs/575'),
  ('acct.contract_accrue', 'off', '고정비 계약 등록 · 세무사 확인 뒤', 'docs/576'),
  ('acct.payslip_mail', 'off', '메일 준비 뒤', 'docs/584'),
  ('acct.transfer', 'off', '금융결제원 오픈뱅킹 · 은행 계약 · 키 뒤(지급은 2명 승인)', 'docs/591'),
  ('acct.transfer_mode', 'ASSUME', '은행 계약 · 키 뒤 LIVE', 'docs/591'),
  ('acct.bank_feed', 'off', '금융결제원 키(FIRMBANK_*) 뒤 · 켜기 SUPER', 'docs/605'),
  ('acct.bank_feed_mode', 'ASSUME', '금융결제원 키 · 기관 코드 뒤 LIVE', 'docs/605'),
  ('acct.exempt_invoice', 'off', '면세 품목 확인 · 전자세금계산서 어댑터 준비 뒤 SUPER', 'docs/615'),
  ('perm.enforce', 'SHADOW', '「막혔을 요청」 하루 이상 0 확인 뒤 ON', 'docs/594 4-3 ⑭'),
  ('perm.allow_widen', 'off', '필요할 때만 · ON 상태에서만 동작', 'docs/594 4-3 ⑭'),
  ('ops.security_monthly', 'on', '그대로', 'docs/488'),
  ('ops.cs_weekly', 'on', '그대로', 'docs/486'),
  ('admin.ip_verify', 'off', '허용 IP 밖 운영 접속 인증 — 텔레그램 · 문자 길 확인 뒤', 'docs/361'),
  ('admin.passkey', 'off', '도메인(admin.passkey_rp_id) 설정 뒤 SUPER', 'docs/622'),
  ('security.geo_watch', 'off', '외부 연동 GEOIP 키 뒤(ASSUME 이면 점검판만)', 'docs/623'),
  ('security.geo_block', 'off', 'geo_watch 로 한 달 지켜본 뒤 SUPER', 'docs/623'),
  ('security.geo_mode', 'ASSUME', 'GEOIP 키 등록 뒤 LIVE', 'docs/623'),
  ('campaign.enabled', 'off', '수신 동의 · 문안 · 발신번호 확인 뒤 SUPER', 'docs/621'),
  ('campaign.send_mode', 'ASSUME', '메일 준비(SES) · 문자 대행 주소 뒤 LIVE', 'docs/621'),
  ('mall.coupon', 'off', '쿠폰 정책 · 주문 받기 켠 뒤', 'docs/607'),
  ('mall.points', 'off', '적립 정책 · 약관 게시 뒤', 'docs/617'),
  ('mall.tiers', 'off', '적립금 켠 뒤', 'docs/618'),
  ('mall.subscribe', 'off', '주문 받기 · 카드 자동결제 계약 뒤', 'docs/619'),
  ('mall.subscribe_mode', 'ASSUME', '카드 자동결제 키 뒤 LIVE', 'docs/619'),
  ('mall.giftcard', 'off', '법무 확인 뒤', 'docs/620'),
  ('hr.contract_esign', 'off', '전자계약 업체 · 키 뒤', 'docs/597'),
  ('agent.enabled', 'off', 'AI 키 · 처리방침 · 월 상한 확인 뒤', 'docs/176'),
  ('agent.chat.enabled', 'off', 'AI 상담 약관 · 처리방침 게시 뒤', 'docs/176'),
  ('i18n.enabled', 'off', '번역 초안 승인 뒤', 'docs/150'),
  ('map.enabled', 'off', '카카오 키 뒤', 'docs/104'),
  ('community.town_verify', 'off', '위치 약관 게시 · 신고번호 · 카카오 키 뒤', 'docs/335'),
  ('weather.enabled', 'off', '기상청 키 뒤', 'docs/102'),
  ('notify.ses_feedback', 'off', 'SES → SNS 웹훅 준비 뒤', 'docs/334'),
  ('marketing.send_enabled', 'off', '수신 동의 · 메일 준비 뒤', '—'),
  ('poll.member_create', 'off', '소개광장 운영 방침 확인 뒤', 'docs/274'),
  ('point.cashout_tax_id', 'off', '처리방침(주민등록번호) 게시 뒤', 'docs/352'),
  ('uptime.report', 'off', '자동화 서버 n8n · 토큰 준비 뒤 SUPER', 'docs/635'),
  ('social.kakao', 'off', '키 · 처리방침 확인(social.privacy_ok) 뒤 SUPER', 'docs/636'),
  ('social.naver', 'off', '키 · 처리방침 확인 뒤 SUPER', 'docs/636'),
  ('social.privacy_ok', 'off', '처리방침에 받는 항목 게시 · 법무 확인 뒤', 'docs/636'),
  ('site.pwa', 'off', '오프라인 안내 화면 확인 뒤', 'docs/637'),
  ('mbx.recent', 'off', '처리방침 「서비스 이용 기록」 게시 뒤', 'docs/639'),
  ('mbx.compare', 'off', '화면 확인 뒤', 'docs/640'),
  ('mbx.price_alert', 'off', '알림 수신 설정 확인 뒤', 'docs/641'),
  ('mbx.dm', 'off', '법무 확인 · 처리방침 「회원 대화」 게시 뒤', 'docs/642'),
  ('mall.restock_alert', 'off', '주문 받기 켠 뒤', 'docs/643'),
  ('mall.cash_receipt', 'off', '세무사 · PG 확인 뒤 SUPER', 'docs/644'),
  ('mall.cash_receipt_mode', 'ASSUME', '토스페이먼츠 키 뒤 LIVE', 'docs/644'),
  ('plaza.ranking', 'off', '소개광장 운영 방침 확인 뒤', 'docs/645'),
  ('site.usage_stats', 'off', '처리방침 고친 뒤(법무 확인) SUPER', 'docs/646'),
  ('opx.archive', 'off', '보관 폴더 디스크 여유 확인 뒤 SUPER(묶음만 만들고 원래 줄은 그대로)', 'docs/647'),
  ('opx.archive_s3', 'off', '.env BACKUP_S3_BUCKET(서버 역할 권한 · 버킷 버전 관리 권함) 뒤 — 없으면 서버 디스크만', 'docs/647'),
  ('opx.risk_score', 'on', '그대로 — 오탐이 잦으면 규칙 점수부터 낮춤', 'docs/648')
ON CONFLICT (key) DO NOTHING;

/* ── 설정 · 정기 작업 ── */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('opx.archive', 'off', 'ADMIN', '기록 장기 보관(v10.509 · D275 · docs/647) — 처음 off · on 이면 매일 04:20 지난달까지의 감사 기록 · 개인정보 접속기록 · 운영 알림 · 설정 바뀐 기록 · 운영자 로그인을 달마다 묶음(gzip · sha256 · 감사 사슬 머리와 묶은 목록 지문)으로 서버 디스크(DATA_DIR/backup/log-archive)에 · 켜기 SUPER', false, '^(on|off)$', 'off'),
  ('opx.archive_s3', 'off', 'ADMIN', '기록 묶음 디스크 밖(S3) 보관(v10.509) — 처음 off · on 이고 .env BACKUP_S3_BUCKET 이 있으면 묶음을 s3://버킷/log-archive/ 에 올림(서버 역할 권한) · 버킷이 없으면 NOT_READY(서버 디스크만 · 화면에 「디스크 밖 보관 아님」)', false, '^(on|off)$', 'off'),
  ('opx.archive_keep_months', '36', 'ADMIN', '기록 묶음 보관 개월(v10.509 · 대표 11/20 「감사 · 접속기록은 3년 보관」 · 처음 36) — 지나면 정기 작업이 파기 기록 · 감사 한 줄을 남기고 묶음 파일을 지움 · 법정 최소(개인정보 접속기록 1년 · 5만 명 이상 등 2년 — 안전성 확보조치 기준 제8조 · 일반 원칙 · 법무 확인) 12개월보다 짧게 못 바꿈 · 12 ~ 120', false, '^(1[2-9]|[2-9][0-9]|1[01][0-9]|120)$', '36'),
  ('opx.archive_db_purge_months', '0', 'ADMIN', '운영 DB 원래 줄 정리 개월(v10.509) — 0(처음) = 지우지 않음 · 13 ~ 120 이면 그 개월이 지난 달 중 묶음 · 복원 확인이 끝나고 줄 수가 같은 달만 감사 기록 · 개인정보 접속기록 · 운영 알림 · 설정 바뀐 기록을 지움(운영자 로그인은 privacy.login_history_days 파기 따로) · SUPER', false, '^(0|1[3-9]|[2-9][0-9]|1[01][0-9]|120)$', '0'),
  ('opx.risk_score', 'on', 'ADMIN', '이상 거래 점수(v10.510 · docs/648) — on 이면 매물 등록 · 신고 접수 때(5분마다) · 매일 04:50 최근 계정을 규칙(opx_risk_rules) 점수로 셈 · 기준 넘으면 검수 대기 · 위험감지 경보 · 운영 알림 OPX_RISK_HIGH · 회원에게 보이지 않음', false, '^(on|off)$', 'on'),
  ('opx.risk_threshold', '60', 'ADMIN', '이상 거래 점수 기준(v10.510 · 1 ~ 100 · 처음 60) — 이 점수 이상이면 검수 대기 · 알림', false, '^([1-9]|[1-9][0-9]|100)$', '60')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('opx_archive', 1440, 4, 20, NULL, true, '기록 장기 보관 — 지난 달 묶음 · 디스크 밖(S3) 올림 · 복원 확인 1개 · 보관 개월 지난 묶음 파기 · DB 원래 줄 정리(설정 > 0 일 때) · opx.archive on 일 때만 · D275 · v10.509'),
  ('opx_risk_events', 5, NULL, NULL, NULL, true, '이상 거래 점수 — 매물 등록 · 신고 접수로 표시된 계정 다시 셈 · opx.risk_score on 일 때 · D275 · v10.510'),
  ('opx_risk_daily', 1440, 4, 50, NULL, true, '이상 거래 점수 — 최근 30일 가입 · 7일 매물 · 30일 신고 계정 모두 다시 셈 · D275 · v10.510')
ON CONFLICT (job) DO NOTHING;

/* ── ⑤ ㉕ 권한 시드(D258 모양) — 기록 장기 보관은 SUPER 만(R_ 그룹 줄 없음) · 점수 · 스위치 ADMIN · 일괄 처리 ADMIN · REVIEWER(검수만 · 서버가 종류마다 역할 다시 봄) ── */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('opx-archive', '기록 장기 보관', 'admrsk', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 1009),
  ('opx-risk', '이상 거래 점수', 'admrsk', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 1010),
  ('opx-bulk', '일괄 처리', 'admusr', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 1011),
  ('opx-switches', '기능 스위치 한눈에', 'admpol', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 1012)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'opx-risk', 'VIEW'), ('R_ADMIN', 'opx-risk', 'EDIT'), ('R_ADMIN', 'opx-risk', 'APPROVE'), ('R_ADMIN', 'opx-risk', 'EXPORT'),
  ('R_ADMIN', 'opx-bulk', 'VIEW'), ('R_ADMIN', 'opx-bulk', 'EDIT'), ('R_ADMIN', 'opx-bulk', 'APPROVE'), ('R_ADMIN', 'opx-bulk', 'EXPORT'),
  ('R_REVIEWER', 'opx-bulk', 'VIEW'), ('R_REVIEWER', 'opx-bulk', 'EDIT'), ('R_REVIEWER', 'opx-bulk', 'APPROVE'), ('R_REVIEWER', 'opx-bulk', 'EXPORT'),
  ('R_ADMIN', 'opx-switches', 'VIEW'), ('R_ADMIN', 'opx-switches', 'EDIT'), ('R_ADMIN', 'opx-switches', 'APPROVE'), ('R_ADMIN', 'opx-switches', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/opx/archive', 'opx-archive', 'VIEW'),
  ('GET', '/admin/opx/archive/{id}', 'opx-archive', 'VIEW'),
  ('POST', '/admin/opx/archive/run', 'opx-archive', 'EDIT'),
  ('POST', '/admin/opx/archive/{id}/verify', 'opx-archive', 'EDIT'),
  ('GET', '/admin/opx/risk/rules', 'opx-risk', 'VIEW'),
  ('PUT', '/admin/opx/risk/rules/{id}', 'opx-risk', 'APPROVE'),
  ('GET', '/admin/opx/risk/scores', 'opx-risk', 'VIEW'),
  ('GET', '/admin/opx/risk/cases', 'opx-risk', 'VIEW'),
  ('POST', '/admin/opx/risk/cases/{id}/decide', 'opx-risk', 'EDIT'),
  ('POST', '/admin/opx/risk/recompute/{id}', 'opx-risk', 'EDIT'),
  ('GET', '/admin/opx/bulk/runs', 'opx-bulk', 'VIEW'),
  ('POST', '/admin/opx/bulk/reviews', 'opx-bulk', 'EDIT'),
  ('POST', '/admin/opx/bulk/reports', 'opx-bulk', 'EDIT'),
  ('POST', '/admin/opx/bulk/inquiries', 'opx-bulk', 'EDIT'),
  ('POST', '/admin/opx/bulk/members', 'opx-bulk', 'EDIT'),
  ('GET', '/admin/opx/switches', 'opx-switches', 'VIEW')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

