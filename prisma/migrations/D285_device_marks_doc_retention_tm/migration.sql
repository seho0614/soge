/* D285 (v10.546 ~ 548 · docs/684 ~ 686) (55) 운영 · 보안 — 같은 기기 여러 계정 탐지 · 서류 보관 기한 관리 · 번역 메모리 */

-- =====================================================================
-- D285 (v10.546 ~ 548 · docs/684 ~ 686) (55) 운영 · 보안 — 대표 11/20 「지금 바로 동시 착수」(7차)
--   ① v10.546 같은 기기 여러 계정 탐지 — 기기 표지(사용자 웹이 만든 무작위 쿠키 값)의 sha256 해시만 · 브라우저 지문 수집 없음
--      최근 30일 같은 표지에 계정이 sfx.device_threshold 개 이상이면 위험감지 RSK-SFX(auto_detect + detect_sql) + 운영 알림 · 자동 정지 없음
--   ② v10.547 서류 보관 기한 관리 — 파일 용도별 보관 기간 표(HR_DOC · LGL_DOC · ACCT_EVIDENCE · CORP_DOC) · 보관 대장 · 만료 전 알림
--      파기는 SUPER 확인(「파기」 입력 · 사유) · 파기 기록 쌓기만 · 법정 보관(보존)이 걸린 서류는 지우기 막음
--   ③ v10.548 번역 메모리 — 원문 해시(공백 정리) → 번역 재사용 · 사람이 고친(승인한) 번역 먼저 · 자동 번역(translate_jobs) 앞에 끼움
--   스위치 모두 처음 off(sfx.device_watch · sfx.retention_alert · sfx.tm) · 다시 돌려도 같음 · RAISE 글자에 퍼센트 기호 없음
-- =====================================================================

/* ── ① 같은 기기 여러 계정 탐지 (v10.546 · docs/684) ────────────────────────────────────────
 *   기기 표지 = 사용자 웹이 로그인 · 가입 때 만든 무작위 값(쿠키 sgb_dm · HttpOnly · 2년) — API 는 sha256('sgb-dm:' || 값)만 받아 남김
 *   원래 값 · IP · 브라우저 글자 · 화면 크기 같은 지문은 남기지 않음 · 꺼져 있으면(sfx.device_watch off) 아무것도 쌓지 않음
 *   보관 sfx.device_keep_days(처음 180일) — 마지막으로 본 날부터 지나면 정기 작업 sfx_daily 가 지움 */
CREATE TABLE IF NOT EXISTS public.sfx_device_marks (
  mark_hash   text NOT NULL CHECK (mark_hash ~ '^[0-9a-f]{64}$'),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  first_via   text NOT NULL CHECK (first_via IN ('SIGNUP', 'LOGIN')),
  first_seen  timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen   timestamptz NOT NULL DEFAULT clock_timestamp(),
  seen_count  integer NOT NULL DEFAULT 1 CHECK (seen_count >= 1),
  PRIMARY KEY (mark_hash, account_id)
);
CREATE INDEX IF NOT EXISTS ix_sfx_device_marks_account ON public.sfx_device_marks (account_id);
CREATE INDEX IF NOT EXISTS ix_sfx_device_marks_seen ON public.sfx_device_marks (last_seen);
CREATE INDEX IF NOT EXISTS ix_sfx_device_marks_short ON public.sfx_device_marks ((left(mark_hash, 16)));
COMMENT ON TABLE public.sfx_device_marks IS 'v10.546 (D285) 기기 표지 해시 · 계정 — 사용자 웹 무작위 쿠키 값의 sha256 만(원래 값 · IP · 지문 없음) · sfx.device_watch on 일 때만 쌓음 · sfx.device_keep_days 지나면 지움 · 자동 정지 없음';

/* 가입 · 로그인 성공 때 서버(sfx/device.ts)가 부름 — 실패해도 가입 · 로그인은 그대로(안에서 오류를 삼킴 · 트랜잭션을 깨지 않음) */
CREATE OR REPLACE FUNCTION public.fn_sfx_device_seen(p_hash text, p_account uuid, p_via text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_n int := 0;
  v_th int;
  v_subject text;
BEGIN
  IF coalesce((SELECT value FROM public.site_settings WHERE key = 'sfx.device_watch'), 'off') <> 'on' THEN RETURN 0; END IF;
  IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR p_account IS NULL OR p_via IS NULL OR p_via NOT IN ('SIGNUP', 'LOGIN') THEN RETURN 0; END IF;
  BEGIN
    INSERT INTO public.sfx_device_marks (mark_hash, account_id, first_via) VALUES (p_hash, p_account, p_via)
    ON CONFLICT (mark_hash, account_id) DO UPDATE SET last_seen = clock_timestamp(), seen_count = public.sfx_device_marks.seen_count + 1;
    v_th := coalesce(nullif((SELECT value FROM public.site_settings WHERE key = 'sfx.device_threshold'), '')::int, 3);
    SELECT count(*) INTO v_n FROM public.sfx_device_marks WHERE mark_hash = p_hash AND last_seen > now() - interval '30 days';
    IF v_n >= v_th THEN
      v_subject := 'device:' || left(p_hash, 16);
      /* 자동 탐지(fn_risk_scan · RSK-SFX detect_sql)와 같은 subject — 열린 경보가 있으면 두 번 넣지 않음 */
      IF NOT EXISTS (SELECT 1 FROM public.risk_alerts WHERE rule_code = 'RSK-SFX' AND subject = v_subject AND state IN ('OPEN', 'REVIEWING')) THEN
        INSERT INTO public.risk_alerts (rule_code, severity, subject, detail, reason, action)
        VALUES ('RSK-SFX', 'MEDIUM', v_subject, '같은 기기 표지로 ' || v_n || '개 계정(최근 30일 · 기준 ' || v_th || ')',
                '가입 · 로그인 때 같은 기기 표지', '위험감지 › 같은 기기 여러 계정에서 확인(자동 정지 없음)');
        INSERT INTO public.ops_alerts (alert_code, severity, title, detail, raised_at)
        VALUES ('SFX_DEVICE_MULTI', 'WARN', '같은 기기 여러 계정 ' || v_n || '개 — 위험감지 › 같은 기기 여러 계정',
                jsonb_build_object('mark', left(p_hash, 16), 'accounts', v_n, 'threshold', v_th), clock_timestamp())
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
    RETURN v_n;
  EXCEPTION WHEN others THEN
    RETURN 0;   -- 탐지가 실패해도 가입 · 로그인은 막지 않음(안쪽 블록이라 바깥 트랜잭션은 그대로)
  END;
END $$;
COMMENT ON FUNCTION public.fn_sfx_device_seen(text, uuid, text) IS 'v10.546 (D285) 기기 표지 한 번 본 것 쌓기 · 최근 30일 같은 표지 계정 수 돌려줌 · 기준 이상이면 RSK-SFX 경보 + SFX_DEVICE_MULTI(열린 경보 있으면 안 넣음) · 꺼져 있으면 0';

/* 위험감지 규칙 — 잠든 규칙(S-01 · v_risk_dormant) 막음: is_active 면 auto_detect + detect_sql
 *   꺼져 있으면(sfx.device_watch off) detect_sql 이 아무 줄도 돌려주지 않음 · 서버가 넣는 줄과 같은 subject 라 두 번 들어가지 않음(fn_risk_scan NOT EXISTS) */
INSERT INTO public.risk_rules (code, name, protects, source, false_positive, severity, is_active, sort_order, detect_sql, auto_detect)
VALUES ('RSK-SFX', '같은 기기 여러 계정', '여러 계정 도배 · 정지 우회 · 추천 보상 부정 예방',
  '가입 · 로그인 때 기기 표지(사용자 웹 무작위 쿠키 값의 해시 · v10.546) — 최근 30일 같은 표지에 계정이 sfx.device_threshold 개 이상',
  '가족 · 회사 공용 PC · PC방에서 정상으로 여러 계정이 쓰일 수 있습니다 — 자동 정지 없음 · 까닭 보고 판단.', 'MEDIUM', true, 91,
  'SELECT ''device:'' || left(d.mark_hash, 16) AS subject, ''같은 기기 표지로 '' || count(*) || ''개 계정(최근 30일 · 자동 탐지)'' AS detail FROM sfx_device_marks d WHERE d.last_seen > now() - interval ''30 days'' AND coalesce((SELECT value FROM site_settings WHERE key = ''sfx.device_watch''), ''off'') = ''on'' GROUP BY d.mark_hash HAVING count(*) >= coalesce(nullif((SELECT value FROM site_settings WHERE key = ''sfx.device_threshold''), '''')::int, 3)',
  true)
ON CONFLICT (code) DO NOTHING;


/* ── ② 서류 보관 기한 관리 (v10.547 · docs/685) ─────────────────────────────────────────────
 *   보관 기간 표(sfx_retention_rules) — 파일 용도마다 한 줄 · 개월 수는 SUPER 가 고침(법정 최소 min_months 밑으로는 못 내림 · 근거 글은 마이그레이션으로만)
 *   보관 대장(sfx_doc_retention) — 파일 하나에 한 줄 · 만료일 = 기준일 + 개월(트리거가 셈) · 기준일 처음 값 = 올린 날(한국) · SUPER 가 고침
 *   만료 sfx.retention_alert_days(처음 30일) 전부터 운영 알림 SFX_RETENTION_DUE(줄마다 한 번 · 처음 off)
 *   파기는 SUPER 가 「파기」 입력 · 사유 — 만료 전 · 법정 보관(보존) 중이면 DB 가 막음 · 파기 기록(sfx_doc_destructions)은 쌓기만
 *   법정 보관(보존)이 걸린 서류는 어떤 화면에서도 지우기(files.status = DELETED)를 막음 — 인사 채용 파기 · 본인 지우기 포함
 *   파일 용도는 기존 HR_DOC(㉛ D262) · LGL_DOC(D269) · ACCT_EVIDENCE(D245) · CORP_DOC(D253) 그대로 — 새 용도 없음(ck_files_purpose 안 고침) */
CREATE TABLE IF NOT EXISTS public.sfx_retention_rules (
  code        text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{2,30}$'),
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  purpose     text NOT NULL UNIQUE CHECK (purpose IN ('ACCT_EVIDENCE', 'HR_DOC', 'LGL_DOC', 'CORP_DOC')),
  months      integer NOT NULL CHECK (months BETWEEN 1 AND 600),
  min_months  integer NOT NULL CHECK (min_months BETWEEN 1 AND 600),
  basis       text NOT NULL CHECK (char_length(basis) BETWEEN 2 AND 400),
  base_hint   text NOT NULL CHECK (char_length(base_hint) BETWEEN 2 AND 200),
  is_active   boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by  uuid REFERENCES public.accounts(id),
  CONSTRAINT ck_sfx_ret_rule_min CHECK (months >= min_months)
);
COMMENT ON TABLE public.sfx_retention_rules IS 'v10.547 (D285) 서류 보관 기간 표 — 파일 용도마다 한 줄 · 개월 · 켜기만 SUPER(법정 최소 밑으로 못 내림) · 근거 · 용도는 마이그레이션으로만 · 지우지 않음';

CREATE OR REPLACE FUNCTION public.fn_sfx_ret_rules_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SFX_RET_RULE: 보관 기간 표 줄은 지우지 않습니다(끄기로).';
  END IF;
  IF (NEW.code, NEW.purpose, NEW.min_months, NEW.basis) IS DISTINCT FROM (OLD.code, OLD.purpose, OLD.min_months, OLD.basis) THEN
    RAISE EXCEPTION 'SFX_RET_RULE: 용도 · 법정 최소 · 근거는 고칠 수 없습니다(개월 · 켜기만).';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sfx_ret_rules_guard' AND tgrelid = 'public.sfx_retention_rules'::regclass) THEN
    CREATE TRIGGER trg_sfx_ret_rules_guard BEFORE UPDATE OR DELETE ON public.sfx_retention_rules FOR EACH ROW EXECUTE FUNCTION public.fn_sfx_ret_rules_guard();
  END IF;
END $$;

/* 처음 값 — 일반 원칙(세무사 · 노무사 · 법무 확인 거리 · docs/685 6절) · 기준일은 대장에서 서류마다 고침 */
INSERT INTO public.sfx_retention_rules (code, name, purpose, months, min_months, basis, base_hint) VALUES
  ('ACCT_EVIDENCE', '회계 증빙(매입 · 경비 영수증 · 계산서)', 'ACCT_EVIDENCE', 60, 60,
   '국세기본법 제85조의3 — 장부 · 증빙 서류는 그 거래의 법정 신고기한이 지난 날부터 5년 · 상법 제33조 전표 등 5년(일반 원칙 · 세무사 확인 거리)',
   '그 거래가 든 과세기간의 신고기한(처음 값은 올린 날 — 대장에서 고침)'),
  ('HR_DOC', '인사 서류(의무교육 증빙 · 지원자 서류)', 'HR_DOC', 36, 36,
   '근로기준법 제42조 · 시행령 제22조 — 근로자 명부 · 근로계약 서류 3년(일반 원칙 · 노무사 확인 거리) · 불합격 지원자 서류는 채용절차법 제11조 · 인사 채용 화면 파기가 먼저',
   '퇴직한 날 · 교육이 끝난 날(처음 값은 올린 날 — 대장에서 고침)'),
  ('LGL_DOC', '법무 서류(인허가 · 계약 검토 · 사건 · 보험)', 'LGL_DOC', 120, 120,
   '상법 제33조 — 상업장부와 영업에 관한 중요서류 10년(일반 원칙 · 법무 확인 거리)',
   '계약 · 인허가 · 사건 · 보험이 끝난 날(처음 값은 올린 날 — 대장에서 고침)'),
  ('CORP_DOC', '사내 문서', 'CORP_DOC', 120, 12,
   '사내 규정 — 상법 제33조 영업에 관한 중요서류면 10년 · 그 밖은 사내 규정(처음 10년 · 최소 1년)',
   '문서를 확정한 날(처음 값은 올린 날 — 대장에서 고침)')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.sfx_doc_retention (
  file_id     uuid PRIMARY KEY REFERENCES public.files(id) ON DELETE CASCADE,
  rule_code   text NOT NULL REFERENCES public.sfx_retention_rules(code),
  base_date   date NOT NULL CHECK (base_date >= DATE '2000-01-01'),
  expires_on  date NOT NULL,
  legal_hold  boolean NOT NULL DEFAULT false,
  hold_reason text,
  hold_by     uuid REFERENCES public.accounts(id),
  hold_at     timestamptz,
  state       text NOT NULL DEFAULT 'KEEP' CHECK (state IN ('KEEP', 'DESTROYED', 'GONE')),
  alerted_on  date,
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ck_sfx_ret_hold_reason CHECK (NOT legal_hold OR char_length(btrim(coalesce(hold_reason, ''))) BETWEEN 2 AND 300),
  CONSTRAINT ck_sfx_ret_hold_state CHECK (state = 'KEEP' OR NOT legal_hold)
);
CREATE INDEX IF NOT EXISTS ix_sfx_doc_retention_due ON public.sfx_doc_retention (expires_on) WHERE state = 'KEEP';
COMMENT ON TABLE public.sfx_doc_retention IS 'v10.547 (D285) 서류 보관 대장 — 파일 하나에 한 줄 · 만료일은 트리거가 셈(기준일 + 표의 개월) · KEEP → DESTROYED(SUPER 파기 · 만료 뒤 · 보존 아님) · GONE(다른 화면에서 지움) · 끝난 줄은 고치지 않음 · 지우지 않음';

CREATE OR REPLACE FUNCTION public.fn_sfx_doc_retention_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_months int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SFX_RET: 보관 대장 줄은 지우지 않습니다.';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.state <> 'KEEP' THEN
    RAISE EXCEPTION 'SFX_RET_STATE: 파기했거나 없어진 서류의 대장 줄은 고칠 수 없습니다.';
  END IF;
  SELECT months INTO v_months FROM public.sfx_retention_rules WHERE code = NEW.rule_code;
  NEW.expires_on := (NEW.base_date + make_interval(months => coalesce(v_months, 600)))::date;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.expires_on IS DISTINCT FROM OLD.expires_on THEN NEW.alerted_on := NULL; END IF;   -- 만료일이 바뀌면 다시 알림
    IF NEW.state = 'DESTROYED' THEN
      IF OLD.legal_hold OR NEW.legal_hold THEN
        RAISE EXCEPTION 'SFX_RET_HOLD: 법정 보관(보존)이 걸린 서류는 파기할 수 없습니다.';
      END IF;
      IF NEW.expires_on > (now() AT TIME ZONE 'Asia/Seoul')::date THEN
        RAISE EXCEPTION 'SFX_RET_NOT_DUE: 보관 기한이 지나지 않은 서류는 파기할 수 없습니다.';
      END IF;
    END IF;
    IF NEW.state = 'GONE' AND (OLD.legal_hold OR NEW.legal_hold) THEN
      RAISE EXCEPTION 'SFX_RET_HOLD: 법정 보관(보존)이 걸린 서류입니다.';
    END IF;
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sfx_doc_retention_guard' AND tgrelid = 'public.sfx_doc_retention'::regclass) THEN
    CREATE TRIGGER trg_sfx_doc_retention_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sfx_doc_retention FOR EACH ROW EXECUTE FUNCTION public.fn_sfx_doc_retention_guard();
  END IF;
END $$;

/* 표의 개월이 바뀌면 남은(KEEP) 줄의 만료일을 다시 셈(위 트리거가 셈 · 알림 다시) */
CREATE OR REPLACE FUNCTION public.fn_sfx_ret_rules_months() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.months IS DISTINCT FROM OLD.months THEN
    UPDATE public.sfx_doc_retention SET base_date = base_date WHERE rule_code = NEW.code AND state = 'KEEP';
  END IF;
  RETURN NULL;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sfx_ret_rules_months' AND tgrelid = 'public.sfx_retention_rules'::regclass) THEN
    CREATE TRIGGER trg_sfx_ret_rules_months AFTER UPDATE ON public.sfx_retention_rules FOR EACH ROW EXECUTE FUNCTION public.fn_sfx_ret_rules_months();
  END IF;
END $$;

/* 파기 기록 — 쌓기만(파일 이름은 앞 두 글자 + 확장자만 · 저장소 지움 표시만 한 번 고침) */
CREATE TABLE IF NOT EXISTS public.sfx_doc_destructions (
  id              bigserial PRIMARY KEY,
  file_id         uuid NOT NULL UNIQUE,
  purpose         text NOT NULL,
  rule_code       text NOT NULL,
  name_masked     text NOT NULL CHECK (char_length(name_masked) BETWEEN 1 AND 80),
  sha256          text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes      bigint,
  base_date       date NOT NULL,
  expires_on      date NOT NULL,
  reason          text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 2 AND 300),
  actor           uuid REFERENCES public.accounts(id),
  destroyed_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  storage_removed boolean NOT NULL DEFAULT false,
  storage_note    text
);
COMMENT ON TABLE public.sfx_doc_destructions IS 'v10.547 (D285) 서류 파기 기록 — 쌓기만(지우지 않음) · 저장소 지움 표시(storage_removed false → true)만 한 번 고침 · 파일 이름은 가린 것만';

CREATE OR REPLACE FUNCTION public.fn_sfx_destructions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SFX_RET_LOG: 파기 기록은 지우지 않습니다.';
  END IF;
  IF OLD.storage_removed
     OR (NEW.id, NEW.file_id, NEW.purpose, NEW.rule_code, NEW.name_masked, NEW.sha256, NEW.size_bytes, NEW.base_date, NEW.expires_on, NEW.reason, NEW.actor, NEW.destroyed_at)
        IS DISTINCT FROM (OLD.id, OLD.file_id, OLD.purpose, OLD.rule_code, OLD.name_masked, OLD.sha256, OLD.size_bytes, OLD.base_date, OLD.expires_on, OLD.reason, OLD.actor, OLD.destroyed_at) THEN
    RAISE EXCEPTION 'SFX_RET_LOG: 파기 기록은 고칠 수 없습니다(저장소 지움 표시만 한 번).';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sfx_destructions_guard' AND tgrelid = 'public.sfx_doc_destructions'::regclass) THEN
    CREATE TRIGGER trg_sfx_destructions_guard BEFORE UPDATE OR DELETE ON public.sfx_doc_destructions FOR EACH ROW EXECUTE FUNCTION public.fn_sfx_destructions_guard();
  END IF;
END $$;

/* 법정 보관(보존)이 걸린 서류는 어떤 화면에서도 지우지 못함 — 공용 fn_files_guard 는 그대로 두고 따로 트리거(㉛ trg_hr_files_guard 와 같은 방식) */
CREATE OR REPLACE FUNCTION public.fn_sfx_files_hold_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'DELETED' AND OLD.status IS DISTINCT FROM 'DELETED'
     AND EXISTS (SELECT 1 FROM public.sfx_doc_retention r WHERE r.file_id = OLD.id AND r.state = 'KEEP' AND r.legal_hold) THEN
    RAISE EXCEPTION 'FILE: 법정 보관(보존)이 걸린 서류는 지울 수 없습니다(서류 보관 기한에서 먼저 푸십시오)';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sfx_files_hold_guard' AND tgrelid = 'public.files'::regclass) THEN
    CREATE TRIGGER trg_sfx_files_hold_guard BEFORE UPDATE OF status ON public.files FOR EACH ROW EXECUTE FUNCTION public.fn_sfx_files_hold_guard();
  END IF;
END $$;

/* 다른 화면에서 지운 서류(인사 채용 파기 · 본인 지우기)는 대장 줄을 GONE 으로 — 파기 화면은 대장을 먼저 DESTROYED 로 바꿔 여기 걸리지 않음 */
CREATE OR REPLACE FUNCTION public.fn_sfx_files_gone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'DELETED' AND OLD.status IS DISTINCT FROM 'DELETED' THEN
    UPDATE public.sfx_doc_retention SET state = 'GONE' WHERE file_id = NEW.id AND state = 'KEEP' AND NOT legal_hold;
  END IF;
  RETURN NULL;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sfx_files_gone' AND tgrelid = 'public.files'::regclass) THEN
    CREATE TRIGGER trg_sfx_files_gone AFTER UPDATE OF status ON public.files FOR EACH ROW EXECUTE FUNCTION public.fn_sfx_files_gone();
  END IF;
END $$;

/* 대장 맞추기 — 표에 있는(켜진) 용도의 READY 파일 중 대장에 없는 것을 넣음(기준일 = 올린 날 · 한국) · 지운 파일은 GONE
 *   정기 작업 sfx_daily(sfx.retention_alert on 일 때) · 운영 「대장 맞추기」 단추 */
CREATE OR REPLACE FUNCTION public.fn_sfx_retention_sync() RETURNS TABLE(added integer, gone integer) LANGUAGE plpgsql AS $$
DECLARE
  v_add int := 0;
  v_gone int := 0;
BEGIN
  INSERT INTO public.sfx_doc_retention (file_id, rule_code, base_date, expires_on)
  SELECT f.id, r.code, (f.created_at AT TIME ZONE 'Asia/Seoul')::date, (f.created_at AT TIME ZONE 'Asia/Seoul')::date
    FROM public.files f JOIN public.sfx_retention_rules r ON r.purpose = f.purpose AND r.is_active
   WHERE f.status = 'READY'
  ON CONFLICT (file_id) DO NOTHING;
  GET DIAGNOSTICS v_add = ROW_COUNT;
  UPDATE public.sfx_doc_retention d SET state = 'GONE'
    FROM public.files f
   WHERE f.id = d.file_id AND f.status = 'DELETED' AND d.state = 'KEEP' AND NOT d.legal_hold;
  GET DIAGNOSTICS v_gone = ROW_COUNT;
  added := v_add; gone := v_gone;
  RETURN NEXT;
END $$;
COMMENT ON FUNCTION public.fn_sfx_retention_sync() IS 'v10.547 (D285) 서류 보관 대장 맞추기 — 새 READY 파일 넣기(만료일은 트리거) · 지운 파일 GONE · 다시 돌려도 같음';


/* ── ③ 번역 메모리 (v10.548 · docs/686) ─────────────────────────────────────────────────────
 *   열쇠 = (언어, md5(앞뒤 공백 뗀 · 공백 한 칸으로 줄인 원문)) — fn_sfx_tm_key
 *   채우기: 번역(content_translations)이 승인(APPROVED · 사람) · 자동 승인(AUTO_APPROVED · 엔진)될 때 트리거 trg_sfx_tm_feed 가 넣음
 *     사람이 넣거나(MANUAL) 사람이 승인한 번역 = HUMAN · 자동 승인 = MACHINE · HUMAN 은 MACHINE 이 덮지 못함(사람이 고친 번역 먼저)
 *     소개광장 글 · 댓글(POST · COMMENT)은 넣지 않음(회원 대화 · 개인정보) · 점검판 MOCK 엔진 · 메모리에서 온 줄(TM)도 넣지 않음
 *   쓰기: 자동 번역 배치(translate.service · translate_jobs)가 엔진을 부르기 전에 같은 원문 번역을 찾아 그대로 씀(엔진 TM · 자동 승인)
 *     금칙어 · 원문에 없는 연락처 검사를 다시 함(걸리면 쓰지 않고 엔진으로) · 운영이 끈 줄(is_active false)은 쓰지 않음
 *   처음 꺼짐(sfx.tm off) — 꺼져 있으면 채우지도 쓰지도 않음 · sfx.tm_keep_days(처음 365일) 쓰이지 않은 줄은 정기 작업이 지움 */
ALTER TABLE public.content_translations DROP CONSTRAINT IF EXISTS content_translations_engine_check;
ALTER TABLE public.content_translations ADD CONSTRAINT content_translations_engine_check
  /* 합침 — D118 목록 그대로 + TM(D285 번역 메모리에서 가져온 줄) */
  CHECK (engine IN ('MANUAL', 'CLAUDE', 'N8N', 'MOCK', 'TM'));

CREATE OR REPLACE FUNCTION public.fn_sfx_tm_key(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT md5(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'))
$$;
COMMENT ON FUNCTION public.fn_sfx_tm_key(text) IS 'v10.548 (D285) 번역 메모리 열쇠 — 앞뒤 공백 떼고 공백을 한 칸으로 줄인 원문의 md5';

CREATE TABLE IF NOT EXISTS public.sfx_tm (
  id           bigserial PRIMARY KEY,
  lang         text NOT NULL REFERENCES public.i18n_langs(code) CHECK (lang <> 'ko'),
  src_key      text NOT NULL CHECK (src_key ~ '^[0-9a-f]{32}$'),
  src_text     text NOT NULL CHECK (char_length(btrim(src_text)) BETWEEN 1 AND 20000),
  tr_text      text NOT NULL CHECK (char_length(btrim(tr_text)) BETWEEN 1 AND 40000),
  origin       text NOT NULL CHECK (origin IN ('HUMAN', 'MACHINE')),
  from_type    text NOT NULL CHECK (char_length(from_type) BETWEEN 2 AND 40),
  is_active    boolean NOT NULL DEFAULT true,
  hits         integer NOT NULL DEFAULT 0 CHECK (hits >= 0),
  last_used_at timestamptz,
  edited_by    uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ux_sfx_tm UNIQUE (lang, src_key),
  CONSTRAINT ck_sfx_tm_key CHECK (src_key = public.fn_sfx_tm_key(src_text))
);
CREATE INDEX IF NOT EXISTS ix_sfx_tm_used ON public.sfx_tm ((coalesce(last_used_at, updated_at)));
COMMENT ON TABLE public.sfx_tm IS 'v10.548 (D285) 번역 메모리 — (언어, 원문 열쇠) 한 줄 · HUMAN(사람이 넣거나 승인) 먼저 · MACHINE(자동 승인) · 운영이 고치면 HUMAN · 끄기(is_active) · 쓰이지 않은 줄은 sfx.tm_keep_days 뒤 지움';

CREATE OR REPLACE FUNCTION public.fn_sfx_tm_feed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_src text;
  v_origin text;
BEGIN
  IF NEW.status NOT IN ('APPROVED', 'AUTO_APPROVED') OR NEW.engine IN ('TM', 'MOCK') OR NEW.target_type IN ('POST', 'COMMENT') THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.text, NEW.status, NEW.engine) IS NOT DISTINCT FROM (OLD.text, OLD.status, OLD.engine) THEN RETURN NULL; END IF;
  IF coalesce((SELECT value FROM public.site_settings WHERE key = 'sfx.tm'), 'off') <> 'on' THEN RETURN NULL; END IF;
  BEGIN
    SELECT s.src INTO v_src FROM public.fn_i18n_source(NEW.target_type, NEW.target_id, NEW.field) s;
    IF v_src IS NULL OR btrim(v_src) = '' OR md5(v_src) <> NEW.source_hash OR char_length(v_src) > 20000 THEN RETURN NULL; END IF;   -- 원문이 이미 바뀐 번역은 넣지 않음
    v_origin := CASE WHEN NEW.engine = 'MANUAL' OR NEW.status = 'APPROVED' THEN 'HUMAN' ELSE 'MACHINE' END;
    INSERT INTO public.sfx_tm (lang, src_key, src_text, tr_text, origin, from_type)
    VALUES (NEW.lang, public.fn_sfx_tm_key(v_src), v_src, btrim(NEW.text), v_origin, NEW.target_type)
    ON CONFLICT (lang, src_key) DO UPDATE
      SET tr_text = EXCLUDED.tr_text, origin = EXCLUDED.origin, from_type = EXCLUDED.from_type, edited_by = NULL, updated_at = clock_timestamp()
      WHERE public.sfx_tm.origin = 'MACHINE' OR EXCLUDED.origin = 'HUMAN';
  EXCEPTION WHEN others THEN
    NULL;   -- 메모리를 못 채워도 번역 저장 · 승인은 그대로
  END;
  RETURN NULL;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sfx_tm_feed' AND tgrelid = 'public.content_translations'::regclass) THEN
    CREATE TRIGGER trg_sfx_tm_feed AFTER INSERT OR UPDATE ON public.content_translations FOR EACH ROW EXECUTE FUNCTION public.fn_sfx_tm_feed();
  END IF;
END $$;

/* 지금 있는 승인 번역으로 채우기(운영 「지금 번역으로 채우기」 · 한 번에 p_limit 줄 · 최근 것부터) — 다시 돌려도 같음 */
CREATE OR REPLACE FUNCTION public.fn_sfx_tm_backfill(p_limit integer) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  r record;
  v_src text;
  v_origin text;
  v_n int := 0;
  v_rows int;
BEGIN
  IF coalesce((SELECT value FROM public.site_settings WHERE key = 'sfx.tm'), 'off') <> 'on' THEN RETURN 0; END IF;
  FOR r IN SELECT t.target_type, t.target_id, t.field, t.lang, t.text, t.source_hash, t.status, t.engine
             FROM public.content_translations t
            WHERE t.status IN ('APPROVED', 'AUTO_APPROVED') AND t.engine NOT IN ('TM', 'MOCK') AND t.target_type NOT IN ('POST', 'COMMENT')
            ORDER BY t.id DESC
            LIMIT greatest(1, least(coalesce(p_limit, 500), 5000))
  LOOP
    BEGIN
      SELECT s.src INTO v_src FROM public.fn_i18n_source(r.target_type, r.target_id, r.field) s;
      IF v_src IS NOT NULL AND btrim(v_src) <> '' AND md5(v_src) = r.source_hash AND char_length(v_src) <= 20000 THEN
        v_origin := CASE WHEN r.engine = 'MANUAL' OR r.status = 'APPROVED' THEN 'HUMAN' ELSE 'MACHINE' END;
        INSERT INTO public.sfx_tm (lang, src_key, src_text, tr_text, origin, from_type)
        VALUES (r.lang, public.fn_sfx_tm_key(v_src), v_src, btrim(r.text), v_origin, r.target_type)
        ON CONFLICT (lang, src_key) DO UPDATE
          SET tr_text = EXCLUDED.tr_text, origin = EXCLUDED.origin, from_type = EXCLUDED.from_type, edited_by = NULL, updated_at = clock_timestamp()
          WHERE public.sfx_tm.origin = 'MACHINE' AND EXCLUDED.origin = 'HUMAN';
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_n := v_n + v_rows;
      END IF;
    EXCEPTION WHEN others THEN
      NULL;   -- 한 줄이 실패해도 나머지는 채움
    END;
  END LOOP;
  RETURN v_n;
END $$;
COMMENT ON FUNCTION public.fn_sfx_tm_backfill(integer) IS 'v10.548 (D285) 번역 메모리 채우기 — 지금 원문과 같은 승인 번역만 · 없는 열쇠는 넣고 MACHINE 줄은 HUMAN 으로만 덮음(다시 돌려도 같음) · sfx.tm off 면 0';


/* ── ④ 설정 · 정기 작업 · 기능 스위치 켤 조건 · ㉕ 권한(D258) 시드 ──────────────────────────────
 *   스위치 3개 모두 처음 off(규칙 9) · 값 무늬(value_pattern)는 서버(sfx 모듈)의 clamp 끝값과 같음(규칙 2) */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('sfx.device_watch', 'off', 'ADMIN', '같은 기기 여러 계정 탐지(v10.546 · D285) — 처음 off · on 이면 가입 · 로그인 때 사용자 웹 기기 표지(무작위 쿠키 값)의 해시만 쌓고, 최근 30일 같은 표지에 계정이 sfx.device_threshold 개 이상이면 위험감지 RSK-SFX · 운영 알림 SFX_DEVICE_MULTI(자동 정지 없음) · 켜기 전 처리방침 게시', false, '^(on|off)$', 'off'),
  ('sfx.device_threshold', '3', 'ADMIN', '같은 기기 여러 계정 기준(v10.546 · 2 ~ 20 · 처음 3) — 최근 30일 같은 기기 표지에 이만큼 계정이면 경보', false, '^([2-9]|1[0-9]|20)$', '3'),
  ('sfx.device_keep_days', '180', 'ADMIN', '기기 표지 보관(v10.546 · 일 · 30 ~ 365 · 처음 180) — 마지막으로 본 날부터 지나면 매일 05:20 지움', false, '^(3[0-9]|[4-9][0-9]|[12][0-9]{2}|3[0-5][0-9]|36[0-5])$', '180'),
  ('sfx.retention_alert', 'off', 'ADMIN', '서류 보관 기한 알림(v10.547 · D285) — 처음 off · on 이면 매일 05:20 보관 대장을 맞추고 만료 sfx.retention_alert_days 일 전 · 지난 서류를 운영 알림 SFX_RETENTION_DUE 로(줄마다 한 번) · 파기는 SUPER 가 화면에서', false, '^(on|off)$', 'off'),
  ('sfx.retention_alert_days', '30', 'ADMIN', '서류 보관 만료 알림 며칠 전(v10.547 · 7 ~ 90 · 처음 30)', false, '^([7-9]|[1-8][0-9]|90)$', '30'),
  ('sfx.tm', 'off', 'ADMIN', '번역 메모리(v10.548 · D285) — 처음 off · on 이면 승인 · 자동 승인된 번역을 원문 열쇠로 모아 두고, 자동 번역 배치가 같은 원문이면 엔진을 부르지 않고 그대로 씀(사람이 고친 번역 먼저 · 소개광장 글 · 댓글 빼고)', false, '^(on|off)$', 'off'),
  ('sfx.tm_keep_days', '365', 'ADMIN', '번역 메모리 보관(v10.548 · 일 · 90 ~ 999 · 처음 365) — 이만큼 쓰이지 않은 줄은 매일 05:20 지움', false, '^(9[0-9]|[1-9][0-9]{2})$', '365')
ON CONFLICT (key) DO NOTHING;

/* ㊺ 기능 스위치 한눈에(opx_switch_docs) — 켤 조건 */
INSERT INTO public.opx_switch_docs (key, initial_value, cond, doc_ref) VALUES
  ('sfx.device_watch', 'off', '처리방침에 기기 표지(무작위 쿠키 값 · 해시 · 보관 기간) 항목 게시 뒤 SUPER(법무 확인 끝 — 11/20 대표 · 이상 없음)', 'docs/684'),
  ('sfx.retention_alert', 'off', '보관 기간 표(세무사 · 노무사 · 법무 확인)를 맞춘 뒤 — 알림만 · 파기는 SUPER 가 화면에서', 'docs/685'),
  ('sfx.tm', 'off', '자동 번역(i18n.auto_translate.enabled)을 쓰는 중일 때 · 처리방침 번역 보관 문구 확인 뒤', 'docs/686')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('sfx_daily', 1440, 5, 20, NULL, true, '운영 · 보안(D285 · v10.546 ~ 548) — 매일 05:20 · 오래된 기기 표지 지움(sfx.device_keep_days) · sfx.retention_alert on 이면 서류 보관 대장 맞추기 + 만료 알림 SFX_RETENTION_DUE · 쓰이지 않은 번역 메모리 지움(sfx.tm_keep_days)')
ON CONFLICT (job) DO NOTHING;

/* ㉕ 권한(D258) 시드 — 새 탭 3개 · gen_seed.py 와 같은 규칙(GET = VIEW · 파기 = APPROVE · 그 밖 변경 = EDIT)
 *   sfx-device = 위험감지 묶음(admrsk) · sfx-retention = 사무 묶음(admoff) · sfx-tm = 관 관리 묶음(admsit) — 셋 다 TAB_ROLES ADMIN · SUPER
 *   보관 기간 고치기 · 대장 고치기(기준일 · 보존) · 파기는 서버 @Roles('SUPER') — 시드는 R_ADMIN 이 VIEW ~ EXPORT(다른 묶음과 같은 모양) */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('sfx-device', '같은 기기 여러 계정', 'admrsk', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3510),
  ('sfx-retention', '서류 보관 기한', 'admoff', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3520),
  ('sfx-tm', '번역 메모리', 'admsit', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3530)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'sfx-device', 'VIEW'), ('R_ADMIN', 'sfx-device', 'EDIT'), ('R_ADMIN', 'sfx-device', 'APPROVE'), ('R_ADMIN', 'sfx-device', 'EXPORT'),
  ('R_ADMIN', 'sfx-retention', 'VIEW'), ('R_ADMIN', 'sfx-retention', 'EDIT'), ('R_ADMIN', 'sfx-retention', 'APPROVE'), ('R_ADMIN', 'sfx-retention', 'EXPORT'),
  ('R_ADMIN', 'sfx-tm', 'VIEW'), ('R_ADMIN', 'sfx-tm', 'EDIT'), ('R_ADMIN', 'sfx-tm', 'APPROVE'), ('R_ADMIN', 'sfx-tm', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/sfx/device', 'sfx-device', 'VIEW'),
  ('GET', '/admin/sfx/device/{mark}', 'sfx-device', 'VIEW'),
  ('GET', '/admin/sfx/retention/rules', 'sfx-retention', 'VIEW'),
  ('PUT', '/admin/sfx/retention/rules/{code}', 'sfx-retention', 'EDIT'),
  ('GET', '/admin/sfx/retention', 'sfx-retention', 'VIEW'),
  ('POST', '/admin/sfx/retention/sync', 'sfx-retention', 'EDIT'),
  ('PUT', '/admin/sfx/retention/{fileId}', 'sfx-retention', 'EDIT'),
  ('POST', '/admin/sfx/retention/{fileId}/destroy', 'sfx-retention', 'APPROVE'),
  ('GET', '/admin/sfx/retention/destroyed', 'sfx-retention', 'VIEW'),
  ('GET', '/admin/sfx/tm', 'sfx-tm', 'VIEW'),
  ('PUT', '/admin/sfx/tm/{id}', 'sfx-tm', 'EDIT'),
  ('POST', '/admin/sfx/tm/backfill', 'sfx-tm', 'EDIT')
ON CONFLICT DO NOTHING;

