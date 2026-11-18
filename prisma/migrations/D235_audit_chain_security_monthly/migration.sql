-- v10.354 · v10.356 (docs/488 · 490) — 월간 보안 보고 · 감사 기록 위변조 확인(SHA-256 사슬)
--   대표 11/18 「다음개발」 → ① 막힌 접속 기록 · ② 월간 보안 보고 · ③ 운영자 활동 요약 · ④ 감사 기록 위변조 확인 「모두」 → 「승인 + 통과하면 병합」.
--   ① audit.audit_logs 에 사슬 칸 셋(chain_seq · chain_prev · chain_hash) — 이 마이그레이션 뒤 쓰는 줄부터. 줄마다 앞 줄의 지문과 이 줄 내용을 묶어 SHA-256.
--      IP · User-Agent 는 1년 뒤 마스킹(fn_purge_old_ip)이 지우므로 지문에 넣지 않음. 쓰기는 사슬 순서를 위해 한 줄씩 줄을 섬(거래 잠금).
--   ② fn_block_audit_write 에 사슬 칸도 고칠 수 없게 더함(마스킹만 허용은 그대로).
--   ③ 확인 기록 audit.chain_checks(쌓기만) · 확인 함수 audit.fn_audit_chain_verify(시작 순번) — 정기 작업 sla_alert 가 매시간 부름.
--   ④ 설정 ops.security_monthly on · 정기 작업 security_monthly(매일 09:20 — 지난달 보고를 아직 안 보냈으면 보냄).
--   지우는 문장 없음 · 다시 돌려도 같음.

ALTER TABLE audit.audit_logs ADD COLUMN IF NOT EXISTS chain_seq bigint;
ALTER TABLE audit.audit_logs ADD COLUMN IF NOT EXISTS chain_prev bigint;
ALTER TABLE audit.audit_logs ADD COLUMN IF NOT EXISTS chain_hash text;
CREATE SEQUENCE IF NOT EXISTS audit.audit_chain_seq;
CREATE UNIQUE INDEX IF NOT EXISTS ux_audit_logs_chain_seq ON audit.audit_logs (chain_seq) WHERE chain_seq IS NOT NULL;
COMMENT ON COLUMN audit.audit_logs.chain_hash IS 'v10.356 (D235) 위변조 확인 지문 = sha256(앞 줄 지문 | 이 줄 내용 — IP · User-Agent 뺌). 이 칸이 빈 줄은 D235 전 기록';

CREATE OR REPLACE FUNCTION audit.fn_audit_chain_body(r audit.audit_logs) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT concat_ws('|', r.id::text, coalesce(r.actor_account_id::text, ''), coalesce(r.actor_role, ''), r.action, coalesce(r.target_type, ''),
                   coalesce(r.target_id::text, ''), coalesce(r.before_data::text, ''), coalesce(r.after_data::text, ''),
                   to_char(r.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'))
$$;

CREATE OR REPLACE FUNCTION audit.fn_audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_id bigint; p_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(7426001);
  SELECT id, chain_hash INTO p_id, p_hash FROM audit.audit_logs WHERE chain_seq IS NOT NULL ORDER BY chain_seq DESC LIMIT 1;
  NEW.chain_seq := nextval('audit.audit_chain_seq');
  NEW.chain_prev := p_id;
  NEW.chain_hash := encode(sha256(convert_to(coalesce(p_hash, 'GENESIS') || '|' || audit.fn_audit_chain_body(NEW), 'UTF8')), 'hex');
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_zz_audit_chain' AND tgrelid = 'audit.audit_logs'::regclass) THEN
    CREATE TRIGGER trg_zz_audit_chain BEFORE INSERT ON audit.audit_logs FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_chain();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_block_audit_write() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'append-only table: DELETE on % is forbidden', TG_TABLE_NAME;
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
    RAISE EXCEPTION
      'append-only table: UPDATE on % is forbidden (IP·User-Agent 마스킹만 허용)',
      TG_TABLE_NAME;
  END IF;

  RETURN NEW;
END $$;

CREATE TABLE IF NOT EXISTS audit.chain_checks (
  id         bigserial PRIMARY KEY,
  checked_at timestamptz NOT NULL DEFAULT now(),
  from_seq   bigint,
  to_seq     bigint,
  to_hash    text,
  rows       integer NOT NULL DEFAULT 0 CHECK (rows >= 0),
  ok         boolean NOT NULL,
  broken_id  bigint,
  reason     text
);
COMMENT ON TABLE audit.chain_checks IS 'v10.356 (D235) 감사 기록 사슬 확인 기록 — 매시간 · 쌓기만(고치기 · 지우기 막음)';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_chain_checks_ro' AND tgrelid = 'audit.chain_checks'::regclass) THEN
    CREATE TRIGGER trg_audit_chain_checks_ro BEFORE DELETE OR UPDATE ON audit.chain_checks FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

-- 확인: 마지막으로 온전했던 지점(p_from_seq · 그 줄 지문 p_from_hash)이 그대로인지 → 그 뒤 줄을 순서대로 다시 계산.
--   줄이 빠졌거나(앞 줄 없음 · 순번 건너뜀은 괜찮음) 내용 · 지문이 다르면 그 줄 번호를 돌려줌.
CREATE OR REPLACE FUNCTION audit.fn_audit_chain_verify(p_from_seq bigint, p_from_hash text, p_limit integer DEFAULT 200000)
RETURNS TABLE (checked integer, ok boolean, broken_id bigint, last_seq bigint, last_hash text, reason text) LANGUAGE plpgsql AS $$
DECLARE r audit.audit_logs; prev_hash text; prev_id bigint; n int := 0; exp text;
BEGIN
  prev_hash := NULL; prev_id := NULL;
  IF p_from_seq IS NOT NULL THEN
    SELECT a.id, a.chain_hash INTO prev_id, prev_hash FROM audit.audit_logs a WHERE a.chain_seq = p_from_seq;
    IF prev_id IS NULL OR prev_hash IS DISTINCT FROM p_from_hash THEN
      RETURN QUERY SELECT 0, false, prev_id, p_from_seq, p_from_hash, '지난 확인 지점 줄이 없거나 지문이 바뀜'::text; RETURN;
    END IF;
  END IF;
  FOR r IN SELECT * FROM audit.audit_logs a WHERE a.chain_seq IS NOT NULL AND a.chain_seq > coalesce(p_from_seq, 0) ORDER BY a.chain_seq LIMIT p_limit LOOP
    IF r.chain_prev IS DISTINCT FROM prev_id THEN
      RETURN QUERY SELECT n, false, r.id, coalesce(p_from_seq, 0), prev_hash, '앞 줄 연결이 끊김(줄이 지워졌을 수 있음)'::text; RETURN;
    END IF;
    exp := encode(sha256(convert_to(coalesce(prev_hash, 'GENESIS') || '|' || audit.fn_audit_chain_body(r), 'UTF8')), 'hex');
    IF exp IS DISTINCT FROM r.chain_hash THEN
      RETURN QUERY SELECT n, false, r.id, coalesce(p_from_seq, 0), prev_hash, '내용 · 지문이 다름(고쳐졌을 수 있음)'::text; RETURN;
    END IF;
    prev_id := r.id; prev_hash := r.chain_hash; p_from_seq := r.chain_seq; n := n + 1;
  END LOOP;
  RETURN QUERY SELECT n, true, NULL::bigint, p_from_seq, prev_hash, NULL::text;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('ops.security_monthly', 'on', 'ADMIN',
   '월간 보안 보고(v10.354 · docs/488) — on 이면 매달 처음 돌 때(매일 09:20 · 지난달 보고를 아직 안 보냈으면) 권한 주기 · 거두기 · 중요 설정 바뀜 · 개인정보 열람 · 낯선 로그인 · 접속 인증 · 막힌 접속 · 급한 알림 · 감사 기록 사슬을 텔레그램 · 슬랙 · 운영자 게시판으로. off 면 보내지 않음.',
   false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('security_monthly', 1440, 9, 20, NULL, true, '월간 보안 보고 — 매일 09:20 돌고 지난달 보고를 아직 안 보냈으면 텔레그램 · 슬랙 · 운영자 게시판(ops.security_monthly) · 운영 알림 SECURITY_MONTHLY · D235')
ON CONFLICT (job) DO NOTHING;
