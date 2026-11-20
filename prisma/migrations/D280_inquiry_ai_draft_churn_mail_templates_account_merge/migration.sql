/* D280 (v10.528 ~ 531 · docs/666 ~ 669) ㊿ 고객센터 · 회원 — 1:1 문의 AI 답변 초안 · 이탈 위험 신호 · 메일 문구 템플릿 편집 · 중복 계정 합치기(모두 off) */

-- =====================================================================
-- D280 — v10.528 ~ 531 (2026-11-20 · docs/666 ~ 669) ㊿ 고객센터 · 회원
--   대표 11/20 「지금 바로 동시 착수」(CONTRACT6) — ① 1:1 문의 AI 답변 초안 ② 이탈 위험 신호 ③ 메일 문구 템플릿 편집 ④ 중복 계정 합치기
--   다시 돌려도 같음(IF NOT EXISTS · ON CONFLICT · CREATE OR REPLACE · 트리거는 DROP IF EXISTS 뒤 만듦) · 옛 자료를 지우지 않음
--   스위치 모두 처음 꺼짐: csx.ai_draft · csx.ai_draft_auto · csx.churn · csx.mail_templates · csx.account_merge
-- =====================================================================


-- ── ① v10.528 1:1 문의 AI 답변 초안 ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.csx_inquiry_drafts (
  id            bigserial PRIMARY KEY,
  inquiry_id    uuid NOT NULL REFERENCES public.inquiries(id) ON DELETE CASCADE,
  state         text NOT NULL DEFAULT 'QUEUED' CHECK (state IN ('QUEUED', 'PENDING', 'DRAFT', 'USED', 'DISCARDED', 'FAILED')),
  body          text CHECK (body IS NULL OR char_length(body) BETWEEN 2 AND 4000),
  sources       jsonb NOT NULL DEFAULT '{}'::jsonb,
  model         text,
  engine        text CHECK (engine IS NULL OR engine IN ('MOCK', 'CLAUDE', 'N8N')),
  note          text CHECK (note IS NULL OR char_length(note) <= 300),
  in_tokens     integer NOT NULL DEFAULT 0,
  out_tokens    integer NOT NULL DEFAULT 0,
  requested_by  uuid REFERENCES public.accounts(id),
  used_by       uuid REFERENCES public.accounts(id),
  used_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (state NOT IN ('DRAFT', 'USED') OR body IS NOT NULL),
  CHECK (state <> 'USED' OR (used_by IS NOT NULL AND used_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_csx_draft_live ON public.csx_inquiry_drafts (inquiry_id) WHERE state IN ('QUEUED', 'PENDING', 'DRAFT');
CREATE INDEX IF NOT EXISTS ix_csx_draft_state ON public.csx_inquiry_drafts (state, id DESC);
COMMENT ON TABLE public.csx_inquiry_drafts IS 'v10.528 (D280) 1:1 문의 AI 답변 초안 — 운영 화면에만 보임(회원에게 안 보임 · inquiries.answer 를 건드리지 않음) · 운영자가 답변 칸에 넣어 고친 뒤 기존 답변 API 로 보냄 · AI 통로 CSX_DRAFT(스위치 csx.ai_draft · 월 상한) · 한 문의에 살아 있는 초안 하나';

-- AI 통로 CSX_DRAFT — D276 위에 한 줄(스위치 csx.ai_draft · 처음 off) · ㊾ D279 의 LSY_PHOTO · LSY_REPORT 도 함께 둠(D279 → D280 차례로 돌아도 통로가 빠지지 않게)
ALTER TABLE public.agent_usage_daily DROP CONSTRAINT IF EXISTS agent_usage_daily_channel_check;
ALTER TABLE public.agent_usage_daily ADD CONSTRAINT agent_usage_daily_channel_check
  CHECK (channel IN ('SITE_CHAT','REVIEW_SHADOW','AUDIT','SETTLE','TRANSLATE','BOARD','TOWN_PICK','RECEIPT','LSX_SUMMARY','LSY_PHOTO','LSY_REPORT','CSX_DRAFT'));

CREATE OR REPLACE FUNCTION public.fn_agent_allowed(p_channel text, OUT ok boolean, OUT reason text)
  LANGUAGE plpgsql STABLE AS $$
DECLARE v_cap numeric; v_sw text;
BEGIN
  ok := false;
  IF coalesce((SELECT value FROM site_settings WHERE key = 'agent.enabled'), 'off') <> 'on' THEN reason := 'AGENT_OFF'; RETURN; END IF;
  v_sw := CASE p_channel WHEN 'REVIEW_SHADOW' THEN 'agent.review_shadow.enabled' WHEN 'SITE_CHAT' THEN 'agent.chat.enabled'
                         WHEN 'TRANSLATE' THEN 'i18n.auto_translate.enabled'   -- D118 번역
                         WHEN 'BOARD' THEN 'i18n.board_on_view'   -- D119 게시판 볼 때 번역
                         WHEN 'TOWN_PICK' THEN 'agent.town_pick.enabled'   -- D188 동네픽 AI
                         WHEN 'RECEIPT' THEN 'acct.receipt_ai'   -- D257 영수증 읽기
                         WHEN 'LSX_SUMMARY' THEN 'lsx.ai_summary'   -- D276 매물 AI 요약
                         WHEN 'LSY_PHOTO' THEN 'lsy.photo_ai'   -- D279 사진 속 연락처(㊾ · 같은 날 묶음 — 없어도 해 없음: 설정이 없으면 CHANNEL_OFF)
                         WHEN 'LSY_REPORT' THEN 'lsy.report_ai'   -- D279 신고 분류(㊾)
                         WHEN 'CSX_DRAFT' THEN 'csx.ai_draft' END;   -- D280 1:1 문의 AI 답변 초안
  IF v_sw IS NULL THEN reason := 'CHANNEL_NOT_READY'; RETURN; END IF;
  IF coalesce((SELECT value FROM site_settings WHERE key = v_sw), 'off') <> 'on' THEN reason := 'CHANNEL_OFF'; RETURN; END IF;
  v_cap := coalesce(nullif((SELECT value FROM site_settings WHERE key = 'agent.monthly_cap_usd'), '')::numeric, 0);
  IF v_cap <= 0 THEN reason := 'CAP_ZERO'; RETURN; END IF;
  IF public.fn_agent_month_cost() >= v_cap THEN reason := 'CAP_REACHED'; RETURN; END IF;
  ok := true; reason := NULL;
END $$;


-- ── ② v10.529 이탈 위험 신호 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.csx_churn_signals (
  account_id      uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  prev_days       integer NOT NULL CHECK (prev_days >= 0),
  recent_days     integer NOT NULL CHECK (recent_days >= 0),
  last_active_on  date,
  score           integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  level           text NOT NULL CHECK (level IN ('MID', 'HIGH')),
  day             date NOT NULL,
  built_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_csx_churn_level ON public.csx_churn_signals (level, score DESC);
COMMENT ON TABLE public.csx_churn_signals IS 'v10.529 (D280) 지금 이탈 위험인 회원만(매일 다시 만듦 · 파생 자료) — 운영 화면 안에서만 봄 · 내려받기 없음 · 재방문 안내는 마케팅 동의자만(캠페인 대상 CHURN_RISK)';

CREATE TABLE IF NOT EXISTS public.csx_churn_daily (
  day       date PRIMARY KEY,
  high      integer NOT NULL DEFAULT 0 CHECK (high >= 0),
  mid       integer NOT NULL DEFAULT 0 CHECK (mid >= 0),
  built_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.csx_churn_daily IS 'v10.529 (D280) 이탈 위험 수 하루 기록(사람 정보 없음)';

-- 활동한 날 = 로그인 성공 · 매물 등록 · 거래 시작(사는 쪽 · 파는 쪽) · 1:1 문의. 앞 60일(91 ~ 31일 전) 하루 비율보다 최근 30일 비율이 줄어든 정도(0 ~ 100)
CREATE OR REPLACE FUNCTION public.fn_csx_churn_build() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_min int; v_pct int; n int; v_day date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  v_min := coalesce(nullif((SELECT value FROM site_settings WHERE key = 'csx.churn_min_prev_days'), '')::int, 3);
  v_pct := coalesce(nullif((SELECT value FROM site_settings WHERE key = 'csx.churn_drop_pct'), '')::int, 70);
  DELETE FROM csx_churn_signals;
  WITH act AS (
    SELECT h.account_id AS aid, (h.at AT TIME ZONE 'Asia/Seoul')::date AS d FROM login_history h WHERE h.ok AND h.at > now() - interval '91 days'
    UNION SELECT l.owner_account_id, (l.created_at AT TIME ZONE 'Asia/Seoul')::date FROM listings l WHERE l.created_at > now() - interval '91 days'
    UNION SELECT x.buyer_account_id, (x.created_at AT TIME ZONE 'Asia/Seoul')::date FROM deals x WHERE x.created_at > now() - interval '91 days'
    UNION SELECT x.seller_account_id, (x.created_at AT TIME ZONE 'Asia/Seoul')::date FROM deals x WHERE x.created_at > now() - interval '91 days'
    UNION SELECT i.account_id, (i.created_at AT TIME ZONE 'Asia/Seoul')::date FROM inquiries i WHERE i.account_id IS NOT NULL AND i.created_at > now() - interval '91 days'
  ), agg AS (
    SELECT aid,
           count(DISTINCT d) FILTER (WHERE d BETWEEN v_day - 89 AND v_day - 30)::int AS p_days,
           count(DISTINCT d) FILTER (WHERE d BETWEEN v_day - 29 AND v_day)::int AS r_days,
           max(d) AS last_d
      FROM act GROUP BY aid
  ), sc AS (
    SELECT g.aid, g.p_days, g.r_days, g.last_d,
           CASE WHEN g.r_days = 0 THEN 100
                ELSE greatest(0, least(100, round(100 * (1 - (g.r_days / 30.0) / (g.p_days / 60.0)))))::int END AS s
      FROM agg g JOIN accounts a ON a.id = g.aid
     WHERE g.p_days >= v_min AND a.status = 'ACTIVE' AND a.purged_at IS NULL AND a.withdrawn_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = a.id AND r.role NOT IN ('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'))
  )
  INSERT INTO csx_churn_signals (account_id, prev_days, recent_days, last_active_on, score, level, day)
  SELECT sc.aid, sc.p_days, sc.r_days, sc.last_d, sc.s, CASE WHEN sc.s >= 90 THEN 'HIGH' ELSE 'MID' END, v_day
    FROM sc WHERE sc.s >= v_pct;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO csx_churn_daily (day, high, mid)
  SELECT v_day, count(*) FILTER (WHERE level = 'HIGH')::int, count(*) FILTER (WHERE level = 'MID')::int FROM csx_churn_signals
  ON CONFLICT (day) DO UPDATE SET high = EXCLUDED.high, mid = EXCLUDED.mid, built_at = now();
  RETURN n;
END $$;
COMMENT ON FUNCTION public.fn_csx_churn_build() IS 'v10.529 (D280) 이탈 위험 신호 다시 만듦 — 앞 60일 csx.churn_min_prev_days 일 넘게 쓴 회원 중 하루 비율이 csx.churn_drop_pct 넘게 줄어든 회원(90 이상 HIGH) · 운영 역할 · 쓰지 않는 계정 뺌';

-- 재방문 안내 = 기존 「문자 · 메일 캠페인」(D268) 대상에 CHURN_RISK 한 가지 더함(받는 사람은 그쪽 그대로 마케팅 동의자만)
ALTER TABLE public.mkt_campaigns DROP CONSTRAINT IF EXISTS mkt_campaigns_audience_check;
ALTER TABLE public.mkt_campaigns ADD CONSTRAINT mkt_campaigns_audience_check CHECK (audience IN ('ALL', 'RECENT_90', 'CHURN_RISK'));


-- ── ③ v10.530 메일 문구 템플릿 ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.csx_mail_template_defs (
  code              text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{2,39}$'),
  name              text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  vars              text[] NOT NULL,
  required          text[] NOT NULL DEFAULT '{}'::text[],
  subject_required  text[] NOT NULL DEFAULT '{}'::text[],
  sort_order        integer NOT NULL DEFAULT 100
);
COMMENT ON TABLE public.csx_mail_template_defs IS 'v10.530 (D280) 메일 종류 · 쓸 수 있는 자리값 · 꼭 넣을 자리값 — 코드 src/modules/csx/mail-render.ts MAIL_DEFAULTS 와 같음(기본 문구는 코드에만)';
INSERT INTO public.csx_mail_template_defs (code, name, vars, required, subject_required, sort_order) VALUES
  ('PW_RESET', '비밀번호 재설정', ARRAY['link','ttl'], ARRAY['link'], '{}'::text[], 10),
  ('CONSULT_OTP', '안심소개 상담 인증번호', ARRAY['code','ttl'], ARRAY['code'], '{}'::text[], 20),
  ('WITHDRAW_GRACE', '탈퇴 취소 기한 안내', ARRAY['until','base'], ARRAY['until'], '{}'::text[], 30),
  ('PTN_INVITE_NEW', '파트너센터 직원 초대(가입 전)', ARRAY['company'], '{}'::text[], '{}'::text[], 40),
  ('PTN_INVITE_MEMBER', '파트너센터 직원 초대(회원)', ARRAY['company'], '{}'::text[], '{}'::text[], 50),
  ('PAYSLIP_NOTICE', '급여명세서 알림', ARRAY['name','ym'], ARRAY['ym'], '{}'::text[], 60),
  ('AD_REPORT', '광고 성과 보고서', ARRAY['label','advertiser','report'], ARRAY['report'], '{}'::text[], 70),
  ('NOTIFY_MAIL', '알림 메일(모든 알림의 틀)', ARRAY['title','body','golink','base'], ARRAY['body'], ARRAY['title'], 80)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.csx_mail_templates (
  code        text PRIMARY KEY REFERENCES public.csx_mail_template_defs(code),
  subject     text CHECK (subject IS NULL OR (char_length(subject) BETWEEN 1 AND 120 AND subject !~ '[\r\n]')),
  body        text CHECK (body IS NULL OR char_length(body) BETWEEN 2 AND 4000),
  version     integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  is_custom   boolean NOT NULL DEFAULT false,
  updated_by  uuid REFERENCES public.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT is_custom OR (subject IS NOT NULL AND body IS NOT NULL))
);
COMMENT ON TABLE public.csx_mail_templates IS 'v10.530 (D280) 메일 문구 지금 판 — is_custom false 면 코드 기본 문구 · 스위치 csx.mail_templates on 일 때만 고친 문구로 보냄 · 고치기 SUPER';
INSERT INTO public.csx_mail_templates (code) SELECT code FROM public.csx_mail_template_defs ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.csx_mail_template_versions (
  id            bigserial PRIMARY KEY,
  code          text NOT NULL REFERENCES public.csx_mail_template_defs(code),
  version       integer NOT NULL CHECK (version >= 1),
  kind          text NOT NULL CHECK (kind IN ('SAVE', 'REVERT', 'RESET')),
  subject       text,
  body          text,
  from_version  integer,
  note          text NOT NULL CHECK (char_length(note) BETWEEN 2 AND 200),
  created_by    uuid REFERENCES public.accounts(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version),
  CHECK (kind = 'RESET' OR (subject IS NOT NULL AND body IS NOT NULL))
);
COMMENT ON TABLE public.csx_mail_template_versions IS 'v10.530 (D280) 메일 문구 판 기록 — 쌓기만(고치기 · 지우기 막음) · 되돌리기는 그 판 글을 새 판으로';

-- 자리값 검사 = 코드 checkMailTemplate 와 같은 규칙(계약 규칙 2)
CREATE OR REPLACE FUNCTION public.fn_csx_mail_tpl_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d csx_mail_template_defs%ROWTYPE; t text; tok text; r text;
BEGIN
  IF NOT NEW.is_custom THEN RETURN NEW; END IF;
  SELECT * INTO d FROM csx_mail_template_defs WHERE code = NEW.code;
  IF d.code IS NULL THEN RAISE EXCEPTION 'CSX_TPL_CHECK: 없는 메일 종류입니다.'; END IF;
  t := NEW.subject || E'\n' || NEW.body;
  IF t ~* 'https?://' THEN RAISE EXCEPTION 'CSX_TPL_CHECK: 주소(http · https)는 글에 직접 쓰지 말고 자리값으로만 넣습니다.'; END IF;
  IF regexp_replace(t, '\{[a-z_]+\}', '', 'g') ~ '[{}]' THEN RAISE EXCEPTION 'CSX_TPL_CHECK: 중괄호는 자리값에만 씁니다.'; END IF;
  FOR tok IN SELECT m[1] FROM regexp_matches(t, '\{([a-z_]+)\}', 'g') AS m LOOP
    IF NOT (tok = ANY (d.vars)) THEN RAISE EXCEPTION USING MESSAGE = 'CSX_TPL_CHECK: 쓸 수 없는 자리값이 있습니다 — ' || tok; END IF;
  END LOOP;
  FOREACH r IN ARRAY d.required LOOP
    IF position('{' || r || '}' IN NEW.body) = 0 THEN RAISE EXCEPTION USING MESSAGE = 'CSX_TPL_CHECK: 본문에 꼭 넣어야 하는 자리값이 빠졌습니다 — ' || r; END IF;
  END LOOP;
  FOREACH r IN ARRAY d.subject_required LOOP
    IF position('{' || r || '}' IN NEW.subject) = 0 THEN RAISE EXCEPTION USING MESSAGE = 'CSX_TPL_CHECK: 제목에 꼭 넣어야 하는 자리값이 빠졌습니다 — ' || r; END IF;
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_csx_mail_tpl_guard ON public.csx_mail_templates;
CREATE TRIGGER trg_csx_mail_tpl_guard BEFORE INSERT OR UPDATE ON public.csx_mail_templates FOR EACH ROW EXECUTE FUNCTION public.fn_csx_mail_tpl_guard();

-- 쌓기만 하는 표(판 기록 · 합치기 항목) — 고치기 · 지우기 막음
CREATE OR REPLACE FUNCTION public.fn_csx_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING MESSAGE = 'CSX_IMMUTABLE: 이 기록은 고치거나 지울 수 없습니다(' || TG_TABLE_NAME || ').';
END $$;
DROP TRIGGER IF EXISTS trg_csx_mail_ver_ro ON public.csx_mail_template_versions;
CREATE TRIGGER trg_csx_mail_ver_ro BEFORE UPDATE OR DELETE ON public.csx_mail_template_versions FOR EACH ROW EXECUTE FUNCTION public.fn_csx_append_only();


-- ── ④ v10.531 중복 계정 합치기 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.csx_account_merges (
  id            bigserial PRIMARY KEY,
  source_id     uuid NOT NULL REFERENCES public.accounts(id),
  target_id     uuid NOT NULL REFERENCES public.accounts(id),
  state         text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED', 'DONE', 'REJECTED', 'CANCELED', 'FAILED')),
  reason        text NOT NULL CHECK (char_length(reason) BETWEEN 2 AND 300),
  plan          jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by  uuid NOT NULL REFERENCES public.accounts(id),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES public.accounts(id),
  decided_at    timestamptz,
  decide_note   text CHECK (decide_note IS NULL OR char_length(decide_note) <= 300),
  result        jsonb,
  CHECK (source_id <> target_id),
  CHECK (state = 'REQUESTED' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_csx_merge_open ON public.csx_account_merges (source_id) WHERE state = 'REQUESTED';
CREATE UNIQUE INDEX IF NOT EXISTS uq_csx_merge_done ON public.csx_account_merges (source_id) WHERE state = 'DONE';
CREATE INDEX IF NOT EXISTS ix_csx_merge_target ON public.csx_account_merges (target_id);
COMMENT ON TABLE public.csx_account_merges IS 'v10.531 (D280) 중복 계정 합치기 — 본인인증(NICE) 일치로만 · ADMIN 요청 → 다른 SUPER 승인 = 실행(되돌릴 수 없음) · 끝난 줄은 고칠 수 없음 · 옛 계정은 SUSPENDED 로 남김';

CREATE TABLE IF NOT EXISTS public.csx_account_merge_items (
  id          bigserial PRIMARY KEY,
  merge_id    bigint NOT NULL REFERENCES public.csx_account_merges(id),
  kind        text NOT NULL CHECK (kind IN ('LISTING', 'REQUEST', 'INQUIRY', 'FAVORITE', 'POINT')),
  ref         text NOT NULL CHECK (char_length(ref) BETWEEN 1 AND 120),
  n           integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_csx_merge_items ON public.csx_account_merge_items (merge_id, kind);
COMMENT ON TABLE public.csx_account_merge_items IS 'v10.531 (D280) 합치기로 옮긴 것 한 줄씩(매물 · 요청 · 문의 · 관심 · 포인트 옮김 줄) — 쌓기만';
DROP TRIGGER IF EXISTS trg_csx_merge_items_ro ON public.csx_account_merge_items;
CREATE TRIGGER trg_csx_merge_items_ro BEFORE UPDATE OR DELETE ON public.csx_account_merge_items FOR EACH ROW EXECUTE FUNCTION public.fn_csx_append_only();

-- 끝난 요청(DONE · REJECTED · CANCELED · FAILED)은 고칠 수 없음 · 지우기 막음
CREATE OR REPLACE FUNCTION public.fn_csx_merge_row_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'CSX_IMMUTABLE: 합치기 기록은 지울 수 없습니다.'; END IF;
  IF OLD.state <> 'REQUESTED' THEN RAISE EXCEPTION 'CSX_IMMUTABLE: 끝난 합치기 요청은 고칠 수 없습니다.'; END IF;
  IF NEW.source_id <> OLD.source_id OR NEW.target_id <> OLD.target_id OR NEW.requested_by <> OLD.requested_by THEN
    RAISE EXCEPTION 'CSX_IMMUTABLE: 합칠 계정 · 요청한 사람은 바꿀 수 없습니다.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_csx_merge_row_guard ON public.csx_account_merges;
CREATE TRIGGER trg_csx_merge_row_guard BEFORE UPDATE OR DELETE ON public.csx_account_merges FOR EACH ROW EXECUTE FUNCTION public.fn_csx_merge_row_guard();

-- 합쳐진 옛 계정은 다시 쓰는 계정(ACTIVE)으로 못 바꿈(되돌릴 수 없음)
CREATE OR REPLACE FUNCTION public.fn_csx_merged_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM csx_account_merges m WHERE m.source_id = NEW.id AND m.state = 'DONE') THEN
    RAISE EXCEPTION 'CSX_MERGED_SOURCE: 다른 계정으로 합쳐진 계정은 다시 쓸 수 없습니다.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_csx_merged_source_guard ON public.accounts;
CREATE TRIGGER trg_csx_merged_source_guard BEFORE UPDATE OF status ON public.accounts FOR EACH ROW
  WHEN (NEW.status = 'ACTIVE' AND OLD.status IS DISTINCT FROM 'ACTIVE') EXECUTE FUNCTION public.fn_csx_merged_source_guard();

-- 포인트 옮김 줄 — 규칙 두 개(활동 보상 규칙이 아님 · 꺼진 채 · 현금화 가능 포인트를 옮길 수 있게 needs_valid false)
INSERT INTO public.point_rules (code, name, points, needs_valid, monthly_cap, is_active, sort_order) VALUES
  ('CSX_MERGE_OUT', '계정 합치기 — 옛 계정에서 뺌(v10.531)', 1, false, NULL, false, 90),
  ('CSX_MERGE_IN', '계정 합치기 — 남길 계정에 더함(v10.531)', 1, false, NULL, false, 91)
ON CONFLICT (code) DO NOTHING;

-- 합치기 함수 안에서만 그 규칙 줄을 쓸 수 있음(sgb.csx_merge = 합치기 번호)
CREATE OR REPLACE FUNCTION public.fn_csx_merge_point_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rule_code IN ('CSX_MERGE_IN', 'CSX_MERGE_OUT')
     AND coalesce(current_setting('sgb.csx_merge', true), '') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'CSX_MERGE_POINT: 계정 합치기 포인트 줄은 합치기 실행 안에서만 씁니다.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_csx_merge_point_guard ON public.point_ledger;
CREATE TRIGGER trg_csx_merge_point_guard BEFORE INSERT ON public.point_ledger FOR EACH ROW EXECUTE FUNCTION public.fn_csx_merge_point_guard();

-- 미리 확인 — 막는 까닭 · 옮길 것 · 남길 것 · 본인인증 일치(ci_hash 는 돌려주지 않음)
CREATE OR REPLACE FUNCTION public.fn_csx_merge_check(p_source uuid, p_target uuid, p_except bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  b jsonb := '[]'::jsonb; s accounts%ROWTYPE; t accounts%ROWTYPE;
  c_s text; a_s text; c_t text; a_t text; n int; v_match boolean;
BEGIN
  SELECT * INTO s FROM accounts WHERE id = p_source;
  SELECT * INTO t FROM accounts WHERE id = p_target;
  IF s.id IS NULL OR t.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'blockers', jsonb_build_array(jsonb_build_object('code', 'NOT_FOUND', 'label', '계정을 찾을 수 없습니다', 'n', 1)),
                              'moves', '{}'::jsonb, 'keeps', '{}'::jsonb, 'identity', jsonb_build_object('match', false, 'adapter', NULL));
  END IF;
  IF p_source = p_target THEN b := b || jsonb_build_array(jsonb_build_object('code', 'SAME', 'label', '같은 계정입니다', 'n', 1)); END IF;
  IF s.status <> 'ACTIVE' OR s.withdrawn_at IS NOT NULL OR s.purged_at IS NOT NULL THEN
    b := b || jsonb_build_array(jsonb_build_object('code', 'SOURCE_STATUS', 'label', '옛 계정이 쓰는 계정이 아닙니다(정지 · 탈퇴 · 파기)', 'n', 1));
  END IF;
  IF t.status <> 'ACTIVE' OR t.withdrawn_at IS NOT NULL OR t.purged_at IS NOT NULL THEN
    b := b || jsonb_build_array(jsonb_build_object('code', 'TARGET_STATUS', 'label', '남길 계정이 쓰는 계정이 아닙니다(정지 · 탈퇴 · 파기)', 'n', 1));
  END IF;
  -- 본인인증: 성공 · 방식 NICE(점검판 MOCK) · 시험용 stub-ci 아님 · 가장 최근 것
  SELECT v.ci_hash, v.adapter INTO c_s, a_s FROM identity_verifications v
   WHERE v.account_id = p_source AND v.result = 'SUCCESS' AND v.adapter IN ('NICE', 'MOCK') AND v.ci_hash IS NOT NULL AND v.ci_hash <> 'stub-ci'
   ORDER BY v.completed_at DESC NULLS LAST LIMIT 1;
  SELECT v.ci_hash, v.adapter INTO c_t, a_t FROM identity_verifications v
   WHERE v.account_id = p_target AND v.result = 'SUCCESS' AND v.adapter IN ('NICE', 'MOCK') AND v.ci_hash IS NOT NULL AND v.ci_hash <> 'stub-ci'
   ORDER BY v.completed_at DESC NULLS LAST LIMIT 1;
  v_match := c_s IS NOT NULL AND c_t IS NOT NULL AND c_s = c_t;
  IF NOT v_match THEN
    b := b || jsonb_build_array(jsonb_build_object('code', 'IDENTITY', 'label', '두 계정의 본인인증이 같지 않습니다(둘 다 실명 본인인증이 있어야 함)', 'n', 1));
  END IF;
  SELECT count(*) INTO n FROM csx_account_merges WHERE state = 'DONE' AND source_id IN (p_source, p_target);
  IF n > 0 THEN b := b || jsonb_build_array(jsonb_build_object('code', 'ALREADY_MERGED', 'label', '이미 다른 계정으로 합쳐진 계정입니다', 'n', n)); END IF;
  SELECT count(*) INTO n FROM csx_account_merges WHERE state = 'REQUESTED' AND (p_except IS NULL OR id <> p_except)
     AND (source_id IN (p_source, p_target) OR target_id IN (p_source, p_target));
  IF n > 0 THEN b := b || jsonb_build_array(jsonb_build_object('code', 'OPEN_REQUEST', 'label', '두 계정 중 하나에 열린 합치기 요청이 있습니다', 'n', n)); END IF;
  SELECT count(*) INTO n FROM account_roles WHERE account_id IN (p_source, p_target) AND role NOT IN ('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF');
  IF n > 0 THEN b := b || jsonb_build_array(jsonb_build_object('code', 'STAFF_ROLE', 'label', '운영 역할이 있는 계정은 합치지 않습니다', 'n', n)); END IF;
  SELECT count(*) INTO n FROM account_roles WHERE account_id = p_source AND role IN ('BIZ_OWNER', 'BIZ_STAFF');
  n := n + (SELECT count(*) FROM business_members WHERE account_id = p_source AND removed_at IS NULL);
  IF n > 0 THEN b := b || jsonb_build_array(jsonb_build_object('code', 'SOURCE_BUSINESS', 'label', '옛 계정이 회사(파트너) 소속입니다 — 소속을 먼저 정리', 'n', n)); END IF;
  SELECT count(*) INTO n FROM deals WHERE p_source IN (buyer_account_id, seller_account_id, introducer_account_id) AND status NOT IN ('CONFIRMED', 'SETTLED', 'CANCELLED');
  IF n > 0 THEN b := b || jsonb_build_array(jsonb_build_object('code', 'DEAL_OPEN', 'label', '옛 계정에 진행 중인 거래가 있습니다', 'n', n)); END IF;
  SELECT count(*) INTO n FROM disputes WHERE raised_by = p_source AND status IN ('OPEN', 'IN_REVIEW');
  IF n > 0 THEN b := b || jsonb_build_array(jsonb_build_object('code', 'DISPUTE_OPEN', 'label', '옛 계정에 열린 분쟁이 있습니다', 'n', n)); END IF;
  SELECT count(*) INTO n FROM settlements WHERE payee_account_id = p_source AND status IN ('REQUESTED', 'HELD');
  IF n > 0 THEN b := b || jsonb_build_array(jsonb_build_object('code', 'SETTLE_OPEN', 'label', '옛 계정에 진행 중인 정산이 있습니다', 'n', n)); END IF;
  SELECT count(*) INTO n FROM point_cashouts WHERE account_id = p_source AND status IN ('REQUESTED', 'CONFIRMED');
  IF n > 0 THEN b := b || jsonb_build_array(jsonb_build_object('code', 'CASHOUT_OPEN', 'label', '옛 계정에 진행 중인 포인트 출금이 있습니다', 'n', n)); END IF;
  SELECT count(*) INTO n FROM subscriptions WHERE account_id = p_source AND status IN ('ACTIVE', 'PAST_DUE');
  IF n > 0 THEN b := b || jsonb_build_array(jsonb_build_object('code', 'SUBSCRIPTION', 'label', '옛 계정에 쓰는 구독이 있습니다 — 끝난 뒤 합침', 'n', n)); END IF;
  SELECT count(*) INTO n FROM hlt_sellers WHERE account_id = p_source;
  IF n > 0 THEN b := b || jsonb_build_array(jsonb_build_object('code', 'MALL_SELLER', 'label', '옛 계정이 소개몰 판매자입니다', 'n', n)); END IF;
  SELECT count(*) INTO n FROM hlt_orders WHERE account_id = p_source AND status IN ('PENDING', 'PAID', 'PREPARING', 'SHIPPED');
  IF n > 0 THEN b := b || jsonb_build_array(jsonb_build_object('code', 'MALL_ORDER_OPEN', 'label', '옛 계정에 진행 중인 소개몰 주문이 있습니다', 'n', n)); END IF;
  SELECT count(*) INTO n FROM hlt_point_lots WHERE account_id = p_source AND closed_at IS NULL AND remaining > 0;
  IF n > 0 THEN b := b || jsonb_build_array(jsonb_build_object('code', 'MALL_POINTS', 'label', '옛 계정에 남은 소개몰 적립금이 있습니다(옮기지 않음 — 쓰거나 소멸 뒤)', 'n', n)); END IF;
  SELECT count(*) INTO n FROM listings WHERE owner_account_id = p_source AND status = 'IN_REVIEW';
  n := n + (SELECT count(*) FROM requests WHERE owner_account_id = p_source AND status = 'IN_REVIEW');
  IF n > 0 THEN b := b || jsonb_build_array(jsonb_build_object('code', 'IN_REVIEW', 'label', '옛 계정에 검수 중인 매물 · 요청이 있습니다', 'n', n)); END IF;
  SELECT count(*) INTO n FROM posting_suspensions WHERE account_id IN (p_source, p_target) AND lifted_at IS NULL AND until_at > now();
  IF n > 0 THEN b := b || jsonb_build_array(jsonb_build_object('code', 'POSTING_SUSPENDED', 'label', '두 계정 중 하나가 등록 정지 중입니다', 'n', n)); END IF;
  IF public.fn_point_cashable(p_source) < 0 THEN
    b := b || jsonb_build_array(jsonb_build_object('code', 'POINT_NEGATIVE', 'label', '옛 계정의 현금화 가능 포인트가 0 보다 작습니다 — 먼저 확인', 'n', 1));
  END IF;
  RETURN jsonb_build_object(
    'ok', jsonb_array_length(b) = 0, 'blockers', b,
    'identity', jsonb_build_object('match', v_match, 'adapter', a_s),
    'moves', jsonb_build_object(
      'listings', (SELECT count(*) FROM listings WHERE owner_account_id = p_source),
      'requests', (SELECT count(*) FROM requests WHERE owner_account_id = p_source),
      'inquiries', (SELECT count(*) FROM inquiries WHERE account_id = p_source),
      'favorites', (SELECT count(*) FROM favorites f WHERE f.account_id = p_source
                     AND NOT EXISTS (SELECT 1 FROM favorites g WHERE g.account_id = p_target AND g.target_type = f.target_type AND g.target_id = f.target_id)),
      'pointsNonCash', coalesce((SELECT sum(points) FROM point_ledger WHERE account_id = p_source AND NOT redeemable), 0),
      'pointsCashable', greatest(public.fn_point_cashable(p_source), 0)),
    'keeps', jsonb_build_object(
      'deals', (SELECT count(*) FROM deals WHERE p_source IN (buyer_account_id, seller_account_id, introducer_account_id)),
      'settlements', (SELECT count(*) FROM settlements WHERE payee_account_id = p_source),
      'cashouts', (SELECT count(*) FROM point_cashouts WHERE account_id = p_source),
      'payoutAccounts', (SELECT count(*) FROM payout_accounts WHERE account_id = p_source),
      'mallOrders', (SELECT count(*) FROM hlt_orders WHERE account_id = p_source)));
END $$;
COMMENT ON FUNCTION public.fn_csx_merge_check(uuid, uuid, bigint) IS 'v10.531 (D280) 계정 합치기 미리 확인 — blockers 가 비어야 요청 · 승인 · moves(옮길 것) · keeps(옛 계정에 남는 기록)';

-- 실행 — SUPER · 요청한 사람이 아닌 사람 · 스위치 on · 다시 확인 통과 · 한 번에(실패하면 모두 되돌아감)
CREATE OR REPLACE FUNCTION public.fn_csx_merge_execute(p_merge bigint, p_actor uuid, p_note text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE m csx_account_merges%ROWTYPE; chk jsonb; v_non int; v_cash int; n_l int := 0; n_r int := 0; n_i int := 0; n_f int := 0; v_res jsonb; v_mail text;
BEGIN
  SELECT * INTO m FROM csx_account_merges WHERE id = p_merge FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION 'CSX_MERGE_NOT_FOUND: 합치기 요청이 없습니다.'; END IF;
  IF m.state <> 'REQUESTED' THEN RAISE EXCEPTION 'CSX_MERGE_STATE: 열린 요청만 승인할 수 있습니다.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM account_roles WHERE account_id = p_actor AND role = 'SUPER') THEN
    RAISE EXCEPTION 'CSX_MERGE_SUPER: 합치기 승인은 SUPER 만 할 수 있습니다.';
  END IF;
  IF p_actor = m.requested_by THEN RAISE EXCEPTION 'CSX_MERGE_SELF: 요청한 사람이 아닌 다른 SUPER 가 승인해야 합니다.'; END IF;
  IF coalesce((SELECT value FROM site_settings WHERE key = 'csx.account_merge'), 'off') <> 'on' THEN
    RAISE EXCEPTION 'CSX_MERGE_OFF: 계정 합치기가 꺼져 있습니다(csx.account_merge).';
  END IF;
  PERFORM 1 FROM accounts WHERE id IN (m.source_id, m.target_id) ORDER BY id FOR UPDATE;
  chk := public.fn_csx_merge_check(m.source_id, m.target_id, m.id);
  IF NOT (chk->>'ok')::boolean THEN RAISE EXCEPTION 'CSX_MERGE_BLOCKED: 합칠 수 없는 까닭이 생겼습니다 — 다시 확인해 주십시오.'; END IF;
  PERFORM set_config('sgb.csx_merge', m.id::text, true);

  WITH x AS (UPDATE listings SET owner_account_id = m.target_id WHERE owner_account_id = m.source_id RETURNING id)
  INSERT INTO csx_account_merge_items (merge_id, kind, ref) SELECT m.id, 'LISTING', x.id::text FROM x;
  GET DIAGNOSTICS n_l = ROW_COUNT;
  WITH x AS (UPDATE requests SET owner_account_id = m.target_id WHERE owner_account_id = m.source_id RETURNING id)
  INSERT INTO csx_account_merge_items (merge_id, kind, ref) SELECT m.id, 'REQUEST', x.id::text FROM x;
  GET DIAGNOSTICS n_r = ROW_COUNT;
  WITH x AS (UPDATE inquiries SET account_id = m.target_id WHERE account_id = m.source_id RETURNING id)
  INSERT INTO csx_account_merge_items (merge_id, kind, ref) SELECT m.id, 'INQUIRY', x.id::text FROM x;
  GET DIAGNOSTICS n_i = ROW_COUNT;
  WITH x AS (UPDATE favorites f SET account_id = m.target_id
              WHERE f.account_id = m.source_id
                AND NOT EXISTS (SELECT 1 FROM favorites g WHERE g.account_id = m.target_id AND g.target_type = f.target_type AND g.target_id = f.target_id)
              RETURNING f.target_type, f.target_id)
  INSERT INTO csx_account_merge_items (merge_id, kind, ref) SELECT m.id, 'FAVORITE', x.target_type || ':' || x.target_id::text FROM x;
  GET DIAGNOSTICS n_f = ROW_COUNT;

  -- 포인트: 기록은 고치지 않고 옮김 줄 — 현금화 안 되는 합 · 현금화 가능 잔액(이미 출금한 몫은 옛 계정에 그대로)
  v_non := coalesce((SELECT sum(points) FROM point_ledger WHERE account_id = m.source_id AND NOT redeemable), 0)::int;
  v_cash := greatest(public.fn_point_cashable(m.source_id), 0);
  IF v_non <> 0 THEN
    INSERT INTO point_ledger (account_id, rule_code, points, redeemable, memo) VALUES
      (m.source_id, 'CSX_MERGE_OUT', -v_non, false, '계정 합치기 #' || m.id || ' — 남길 계정으로 옮김'),
      (m.target_id, 'CSX_MERGE_IN', v_non, false, '계정 합치기 #' || m.id || ' — 옛 계정에서 옮겨 옴');
    INSERT INTO csx_account_merge_items (merge_id, kind, ref, n) VALUES (m.id, 'POINT', 'NON_CASH', v_non);
  END IF;
  IF v_cash > 0 THEN
    INSERT INTO point_ledger (account_id, rule_code, points, redeemable, memo) VALUES
      (m.source_id, 'CSX_MERGE_OUT', -v_cash, true, '계정 합치기 #' || m.id || ' — 현금화 가능 잔액 옮김'),
      (m.target_id, 'CSX_MERGE_IN', v_cash, true, '계정 합치기 #' || m.id || ' — 현금화 가능 잔액 옮겨 옴');
    INSERT INTO csx_account_merge_items (merge_id, kind, ref, n) VALUES (m.id, 'POINT', 'CASHABLE', v_cash);
  END IF;
  PERFORM set_config('sgb.csx_merge', '', true);

  -- 옛 계정: 정지 · 모든 로그인 끊김(token_version · 상태 바뀜 트리거가 세션도 끊음) · 다시 ACTIVE 못 됨(trg_csx_merged_source_guard)
  UPDATE accounts SET status = 'SUSPENDED', token_version = token_version + 1 WHERE id = m.source_id;
  v_res := jsonb_build_object('listings', n_l, 'requests', n_r, 'inquiries', n_i, 'favorites', n_f, 'pointsNonCash', v_non, 'pointsCashable', v_cash, 'keeps', chk->'keeps');
  UPDATE csx_account_merges SET state = 'DONE', decided_by = p_actor, decided_at = now(), decide_note = nullif(btrim(coalesce(p_note, '')), ''), result = v_res
   WHERE id = m.id;
  SELECT left(email::text, 2) || '***@' || split_part(email::text, '@', 2) INTO v_mail FROM accounts WHERE id = m.source_id;
  PERFORM public.fn_notify(m.target_id, 'CSX_ACCOUNT_MERGED', jsonb_build_object('email', v_mail), '/my');
  RETURN v_res;
END $$;
COMMENT ON FUNCTION public.fn_csx_merge_execute(bigint, uuid, text) IS 'v10.531 (D280) 계정 합치기 실행 — 매물 · 요청 · 문의 · 관심 옮김 · 포인트 옮김 줄 · 옛 계정 SUSPENDED · 남길 계정 알림 · 되돌릴 수 없음';

INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis, tone) VALUES
  ('CSX_ACCOUNT_MERGED', '계정 합치기 완료', false, false, '회원 요청에 따른 계정 처리 결과 통지(v10.531 · D280)', 'info')
ON CONFLICT (event_code) DO NOTHING;
INSERT INTO public.notification_templates (code, channel, title, body, variables) VALUES
  ('CSX_ACCOUNT_MERGED_INAPP', 'INAPP', '두 계정을 하나로 합쳤습니다',
   '본인인증이 같은 계정({email})의 매물 · 요청 · 1:1 문의 · 관심 · 포인트를 이 계정으로 옮겼습니다. 거래 · 정산 기록은 옛 계정에 남고, 옛 계정은 더 이상 쓸 수 없습니다.', '["email"]'::jsonb)
ON CONFLICT (code) DO NOTHING;


-- ── ⑤ 설정 — 스위치 모두 처음 꺼짐(켜기 · 값 바꾸기 SUPER · 바뀐 기록은 「전체 설정」 기록 그대로) ──
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('csx.ai_draft', 'off', 'ADMIN', '1:1 문의 AI 답변 초안(v10.528 · D280) — on 이면 답변함에서 「AI 초안 만들기」 · 초안은 회원에게 안 보임 · AI 전체 스위치 · 월 상한 안에서만 · 처음 off', false, '^(on|off)$', 'off'),
  ('csx.ai_draft_auto', 'off', 'ADMIN', '1:1 문의 자동 AI 초안(v10.528) — on 이면 매시간 답변 전 문의(3일 안)에 초안을 미리 만듦 · csx.ai_draft 도 켜져 있어야 · 처음 off', false, '^(on|off)$', 'off'),
  ('csx.ai_draft_model', '', 'ADMIN', '1:1 문의 AI 초안 모델(v10.528) — 비우면 agent.review_model · 요금표(agent_model_prices)에 있는 모델만', false, '^(|[a-z0-9][a-z0-9.-]{2,59})$', ''),
  ('csx.ai_draft_batch', '5', 'ADMIN', '자동 AI 초안 한 번에 만드는 수(매시간 · 1 ~ 20 · 처음 5 · v10.528)', false, '^([1-9]|1[0-9]|20)$', '5'),
  ('csx.churn', 'off', 'ADMIN', '이탈 위험 신호(v10.529 · D280) — on 이면 매일 06:20 활동이 크게 줄어든 회원을 셈(운영 화면 안에서만 봄) · 처음 off', false, '^(on|off)$', 'off'),
  ('csx.churn_min_prev_days', '3', 'ADMIN', '이탈 위험 — 앞 60일에 이 날수 넘게 쓴 회원만(1 ~ 60 · 처음 3 · v10.529)', false, '^([1-9]|[1-5][0-9]|60)$', '3'),
  ('csx.churn_drop_pct', '70', 'ADMIN', '이탈 위험 — 하루 활동 비율이 이만큼(%) 넘게 줄면 표시(10 ~ 99 · 처음 70 · 90 이상은 HIGH · v10.529)', false, '^([1-9][0-9])$', '70'),
  ('csx.mail_templates', 'off', 'ADMIN', '메일 문구 템플릿(v10.530 · D280) — on 이면 운영 화면에서 고친 문구로 보냄(검사 통과한 것만) · off 면 코드 기본 문구 · 처음 off', false, '^(on|off)$', 'off'),
  ('csx.account_merge', 'off', 'ADMIN', '중복 계정 합치기(v10.531 · D280) — on 이면 본인인증이 같은 두 계정의 합치기 요청 · SUPER 승인(되돌릴 수 없음) · 처음 off', false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;


-- ── ⑥ 정기 작업 ──
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('csx_daily', 1440, 6, 20, NULL, true, '고객센터 · 회원 하루 작업 — 매일 06:20 · 이탈 위험 신호 다시 셈(csx.churn on 일 때만) · D280 · v10.529'),
  ('csx_hourly', 60, NULL, NULL, NULL, true, '고객센터 · 회원 매시간 작업 — 1:1 문의 자동 AI 초안(csx.ai_draft_auto on · AI 통로 CSX_DRAFT 열림 · 월 상한) · D280 · v10.528')
ON CONFLICT (job) DO NOTHING;


-- ── ⑦ ㉕ 권한 시드(D258 모양) — 회원 묶음(admusr) · 운영 관리자는 네 탭 모두(고치기 · 승인 API 일부는 @Roles SUPER) · 세무사 없음(csx- 앞머리) ──
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('csx-aidraft', 'AI 답변 초안', 'admusr', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 156),
  ('csx-churn', '이탈 위험 신호', 'admusr', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 157),
  ('csx-mailtpl', '메일 문구', 'admusr', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 158),
  ('csx-merge', '계정 합치기', 'admusr', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 159)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'csx-aidraft', 'VIEW'), ('R_ADMIN', 'csx-aidraft', 'EDIT'), ('R_ADMIN', 'csx-aidraft', 'APPROVE'), ('R_ADMIN', 'csx-aidraft', 'EXPORT'),
  ('R_ADMIN', 'csx-churn', 'VIEW'), ('R_ADMIN', 'csx-churn', 'EDIT'), ('R_ADMIN', 'csx-churn', 'APPROVE'), ('R_ADMIN', 'csx-churn', 'EXPORT'),
  ('R_ADMIN', 'csx-mailtpl', 'VIEW'), ('R_ADMIN', 'csx-mailtpl', 'EDIT'), ('R_ADMIN', 'csx-mailtpl', 'APPROVE'), ('R_ADMIN', 'csx-mailtpl', 'EXPORT'),
  ('R_ADMIN', 'csx-merge', 'VIEW'), ('R_ADMIN', 'csx-merge', 'EDIT'), ('R_ADMIN', 'csx-merge', 'APPROVE'), ('R_ADMIN', 'csx-merge', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/csx/overview', 'csx-aidraft', 'VIEW'),
  ('PUT', '/admin/csx/settings', 'csx-aidraft', 'EDIT'),
  ('GET', '/admin/csx/ai-drafts', 'csx-aidraft', 'VIEW'),
  ('GET', '/admin/csx/inquiries/{id}/ai-draft', 'csx-aidraft', 'VIEW'),
  ('POST', '/admin/csx/inquiries/{id}/ai-draft', 'csx-aidraft', 'EDIT'),
  ('POST', '/admin/csx/ai-drafts/{id}/used', 'csx-aidraft', 'EDIT'),
  ('POST', '/admin/csx/ai-drafts/{id}/discard', 'csx-aidraft', 'EDIT'),
  ('GET', '/admin/csx/churn', 'csx-churn', 'VIEW'),
  ('POST', '/admin/csx/churn/rebuild', 'csx-churn', 'EDIT'),
  ('GET', '/admin/csx/mail-templates', 'csx-mailtpl', 'VIEW'),
  ('GET', '/admin/csx/mail-templates/{code}', 'csx-mailtpl', 'VIEW'),
  ('POST', '/admin/csx/mail-templates/{code}/preview', 'csx-mailtpl', 'VIEW'),
  ('PUT', '/admin/csx/mail-templates/{code}', 'csx-mailtpl', 'EDIT'),
  ('POST', '/admin/csx/mail-templates/{code}/revert', 'csx-mailtpl', 'EDIT'),
  ('POST', '/admin/csx/mail-templates/{code}/reset', 'csx-mailtpl', 'EDIT'),
  ('GET', '/admin/csx/merges', 'csx-merge', 'VIEW'),
  ('GET', '/admin/csx/merges/find', 'csx-merge', 'VIEW'),
  ('POST', '/admin/csx/merges/check', 'csx-merge', 'VIEW'),
  ('POST', '/admin/csx/merges', 'csx-merge', 'EDIT'),
  ('POST', '/admin/csx/merges/{id}/approve', 'csx-merge', 'APPROVE'),
  ('POST', '/admin/csx/merges/{id}/reject', 'csx-merge', 'APPROVE'),
  ('POST', '/admin/csx/merges/{id}/cancel', 'csx-merge', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

