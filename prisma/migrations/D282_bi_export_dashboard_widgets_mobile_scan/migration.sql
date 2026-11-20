/* D282 (v10.535 ~ 537 · docs/673 ~ 675) (52) 데이터 · 운영 — 통계 내보내기 BI(개인 식별 없는 일별 집계 · 읽기 전용 보기 bi 스키마 · CSV 내려받기 승인) · 운영 대시보드 위젯 배치(운영자마다 서버 저장) · 휴대폰 재고 실사(로트 실사 회차 · 바코드 · QR) */

/* D282 (v10.535 ~ 537) (52) 데이터 · 운영
 *   다시 돌려도 같음 · 지우는 문장 없음(트리거는 없을 때만 CREATE · 보기는 CREATE OR REPLACE)
 *   ★ DB 역할(ROLE) · 권한(GRANT)을 만들지 않음 — BI 도구용 읽기 전용 계정은 운영 서버에서 사람이(docs/673 5절)
 *   외부 연동 표(integrations)에 줄을 더하지 않음(규칙 26 해당 없음) · 메일 · 이체 · 외부 호출 없음
 *   INV-9 · INV-11 감시 낱말 · 칸 이름 없음 → v_inv11_violations 예외 줄 없음
 *   RAISE 글자에 퍼센트 기호 없음 · 트리거 이름 고유(trg_bi_* · trg_dash_* · trg_qlt_cnt_*) */


/* ── ① 통계 내보내기 BI (v10.535 · docs/673) ─────────────────────────────────────────
 *   bi_metric_defs   지표 목록(이름 · 단위 · 나눔 칸 · 어디서 셈) — 시드
 *   bi_daily_metrics 하루(한국 날짜) × 지표 × 나눔(관 · 게시판 · 문의 종류 · 목표 · 없으면 '') 숫자만
 *                    ★ 계정 · 이메일 · 휴대폰 · IP · 이름 · 주소 칸 없음 — 셀 수 있는 묶음 숫자만
 *   fn_bi_daily_build(from, to) 그 기간 줄을 지우고 다시 셈(정기 작업 bi_daily 매일 04:50 · 어제까지 3일 · 운영 화면 「다시 셈」 31일까지)
 *   bi 스키마 보기 5개 — 외부 BI 도구(메타베이스 · 태블로 · 엑셀 파워 쿼리 등)가 읽는 곳 · 나눔 줄의 작은 칸(bi.min_cell 미만)은 비움(NULL)
 *   v_bi_pii_columns — bi 스키마 보기에 개인 식별처럼 보이는 칸 이름이 있으면 줄이 나옴(늘 0 이어야 함 · 시험 test_v1535) */
CREATE SCHEMA IF NOT EXISTS bi;
COMMENT ON SCHEMA bi IS 'v10.535 (D282 · docs/673) 외부 BI 도구용 읽기 전용 보기 — 개인 식별 없는 일별 집계만 · 읽기 계정 · 권한은 운영 서버에서 사람이(마이그레이션은 역할 · 권한을 만들지 않음)';

CREATE TABLE IF NOT EXISTS public.bi_metric_defs (
  metric     text PRIMARY KEY CHECK (metric ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  label_ko   text NOT NULL CHECK (char_length(label_ko) BETWEEN 2 AND 40),
  unit       text NOT NULL CHECK (unit IN ('COUNT', 'KRW', 'VIEW')),
  dim_label  text CHECK (dim_label IS NULL OR char_length(dim_label) <= 20),
  source_ko  text NOT NULL CHECK (char_length(source_ko) <= 120),
  sort       integer NOT NULL DEFAULT 0
);
COMMENT ON TABLE public.bi_metric_defs IS 'v10.535 (D282) BI 지표 목록 — 이름 · 단위 · 나눔 칸 이름 · 어디서 셈(사람이 읽는 설명)';

INSERT INTO public.bi_metric_defs (metric, label_ko, unit, dim_label, source_ko, sort) VALUES
  ('SIGNUP',         '가입',              'COUNT', NULL,      '회원 계정이 만들어진 날(한국 날짜) 수',                 10),
  ('LISTING_NEW',    '매물 등록',          'COUNT', '관',      '매물을 만든 날 수 · 관 코드로 나눔(초안 포함)',          20),
  ('REQUEST_NEW',    '요청 등록',          'COUNT', '관',      '요청을 만든 날 수 · 관 코드로 나눔(초안 포함)',          30),
  ('DEAL_NEW',       '거래 시작',          'COUNT', NULL,      '거래(문의 단계부터)를 만든 날 수',                       40),
  ('DEAL_CONFIRMED', '거래 확정',          'COUNT', NULL,      '거래가 확정된 날 수',                                    50),
  ('LEAD_NEW',       '상담 리드',          'COUNT', NULL,      '상담 리드가 들어온 날 수',                               60),
  ('POST_NEW',       '소개광장 글',        'COUNT', '게시판',  '소개광장 글을 쓴 날 수 · 게시판으로 나눔',                70),
  ('INQUIRY_NEW',    '1:1 문의',           'COUNT', '종류',    '1:1 문의가 들어온 날 수 · 문의 종류로 나눔',              80),
  ('ORDER_PAID',     '소개몰 결제 주문',   'COUNT', NULL,      '결제 · 준비 · 발송 · 배송 끝 상태 주문을 만든 날 수',      90),
  ('ORDER_AMOUNT',   '소개몰 결제 금액',   'KRW',   NULL,      '위 주문의 결제 금액 합(원)',                             100),
  ('SITE_VIEWS',     '화면 보기(추정)',    'VIEW',  NULL,      '회원 화면 사용 통계(D274)의 표본 보정 보기 합 — 켜진 날만', 110),
  ('SITE_ENTRIES',   '들어온 첫 화면',     'VIEW',  NULL,      '회원 화면 사용 통계(D274)의 첫 화면 수 합 — 켜진 날만',    120),
  ('GOAL_REACH',     '전환 목표 닿음',     'COUNT', '목표',    '회원 화면 사용 통계(D274) 전환 목표에 닿은 수 · 목표로 나눔', 130)
ON CONFLICT (metric) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.bi_daily_metrics (
  day       date NOT NULL,
  metric    text NOT NULL REFERENCES public.bi_metric_defs(metric),
  dim       text NOT NULL DEFAULT '' CHECK (dim ~ '^[A-Za-z0-9_.:/-]{0,40}$'),
  value     numeric(18,2) NOT NULL DEFAULT 0 CHECK (value >= 0),
  built_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, metric, dim)
);
CREATE INDEX IF NOT EXISTS ix_bi_daily_metric ON public.bi_daily_metrics (metric, day);
COMMENT ON TABLE public.bi_daily_metrics IS 'v10.535 (D282) BI 일별 집계 — 하루 × 지표 × 나눔 숫자만(계정 · 이메일 · 휴대폰 · IP · 이름 칸 없음) · fn_bi_daily_build 가 다시 셈 · 보관 bi.keep_days 뒤 정기 작업이 지움';

/* 나눔 값 — 글자 모양이 아니면 OTHER(한글 종류 이름 등) · 비면 '-' */
CREATE OR REPLACE FUNCTION public.fn_bi_dim(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p IS NULL OR btrim(p) = '' THEN '-' WHEN p ~ '^[A-Za-z0-9_.:/-]{1,40}$' THEN p ELSE 'OTHER' END
$$;

/* 기간 다시 셈 — 지표마다 따로 막음(한 표가 없거나 칸이 바뀌어도 나머지는 셈) · 돌려주는 값 = 넣은 줄 수 */
CREATE OR REPLACE FUNCTION public.fn_bi_daily_build(p_from date, p_to date) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_lo timestamptz;
  v_hi timestamptz;
  v_n  integer := 0;
  v_k  integer;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN
    RAISE EXCEPTION 'BI_RANGE: 기간은 시작 ≤ 끝 · 401일 안입니다.';
  END IF;
  v_lo := (p_from::timestamp AT TIME ZONE 'Asia/Seoul');
  v_hi := ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Seoul');
  DELETE FROM public.bi_daily_metrics WHERE day BETWEEN p_from AND p_to;

  BEGIN
    INSERT INTO public.bi_daily_metrics (day, metric, dim, value)
    SELECT (a.created_at AT TIME ZONE 'Asia/Seoul')::date, 'SIGNUP', '', count(*)
      FROM public.accounts a WHERE a.created_at >= v_lo AND a.created_at < v_hi GROUP BY 1;
    GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  BEGIN
    INSERT INTO public.bi_daily_metrics (day, metric, dim, value)
    SELECT d, 'LISTING_NEW', g, count(*) FROM (
      SELECT (l.created_at AT TIME ZONE 'Asia/Seoul')::date AS d, public.fn_bi_dim(l.gwan_code) AS g
        FROM public.listings l WHERE l.created_at >= v_lo AND l.created_at < v_hi) x GROUP BY d, g;
    GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  BEGIN
    INSERT INTO public.bi_daily_metrics (day, metric, dim, value)
    SELECT d, 'REQUEST_NEW', g, count(*) FROM (
      SELECT (r.created_at AT TIME ZONE 'Asia/Seoul')::date AS d, public.fn_bi_dim(r.gwan_code) AS g
        FROM public.requests r WHERE r.created_at >= v_lo AND r.created_at < v_hi) x GROUP BY d, g;
    GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  BEGIN
    INSERT INTO public.bi_daily_metrics (day, metric, dim, value)
    SELECT (x.created_at AT TIME ZONE 'Asia/Seoul')::date, 'DEAL_NEW', '', count(*)
      FROM public.deals x WHERE x.created_at >= v_lo AND x.created_at < v_hi GROUP BY 1;
    GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  BEGIN
    INSERT INTO public.bi_daily_metrics (day, metric, dim, value)
    SELECT (x.confirmed_at AT TIME ZONE 'Asia/Seoul')::date, 'DEAL_CONFIRMED', '', count(*)
      FROM public.deals x WHERE x.confirmed_at >= v_lo AND x.confirmed_at < v_hi GROUP BY 1;
    GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  BEGIN
    INSERT INTO public.bi_daily_metrics (day, metric, dim, value)
    SELECT (x.created_at AT TIME ZONE 'Asia/Seoul')::date, 'LEAD_NEW', '', count(*)
      FROM public.leads x WHERE x.created_at >= v_lo AND x.created_at < v_hi GROUP BY 1;
    GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  BEGIN
    INSERT INTO public.bi_daily_metrics (day, metric, dim, value)
    SELECT d, 'POST_NEW', g, count(*) FROM (
      SELECT (p.created_at AT TIME ZONE 'Asia/Seoul')::date AS d, public.fn_bi_dim(p.board) AS g
        FROM public.posts p WHERE p.created_at >= v_lo AND p.created_at < v_hi) x GROUP BY d, g;
    GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  BEGIN
    INSERT INTO public.bi_daily_metrics (day, metric, dim, value)
    SELECT d, 'INQUIRY_NEW', g, count(*) FROM (
      SELECT (q.created_at AT TIME ZONE 'Asia/Seoul')::date AS d, public.fn_bi_dim(q.category) AS g
        FROM public.inquiries q WHERE q.created_at >= v_lo AND q.created_at < v_hi) x GROUP BY d, g;
    GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  BEGIN
    INSERT INTO public.bi_daily_metrics (day, metric, dim, value)
    SELECT d, m, '', v FROM (
      SELECT (o.created_at AT TIME ZONE 'Asia/Seoul')::date AS d, count(*)::numeric AS c, coalesce(sum(o.total), 0)::numeric AS s
        FROM public.hlt_orders o
       WHERE o.status IN ('PAID', 'PREPARING', 'SHIPPED', 'DELIVERED') AND o.created_at >= v_lo AND o.created_at < v_hi GROUP BY 1) x
     CROSS JOIN LATERAL (VALUES ('ORDER_PAID', x.c), ('ORDER_AMOUNT', x.s)) AS t(m, v);
    GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  BEGIN
    INSERT INTO public.bi_daily_metrics (day, metric, dim, value)
    SELECT u.day, t.m, '', t.v FROM (
      SELECT day, sum(est_views)::numeric AS ev, sum(entries)::numeric AS en FROM public.site_usage_daily WHERE day BETWEEN p_from AND p_to GROUP BY day) u
     CROSS JOIN LATERAL (VALUES ('SITE_VIEWS', u.ev), ('SITE_ENTRIES', u.en)) AS t(m, v);
    GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  BEGIN
    INSERT INTO public.bi_daily_metrics (day, metric, dim, value)
    SELECT g.day, 'GOAL_REACH', public.fn_bi_dim(g.goal), sum(g.n)
      FROM public.site_usage_goals g WHERE g.day BETWEEN p_from AND p_to GROUP BY g.day, public.fn_bi_dim(g.goal);
    GET DIAGNOSTICS v_k = ROW_COUNT; v_n := v_n + v_k;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  RETURN v_n;
END $$;

/* ── bi 스키마 보기(외부 BI 도구가 읽는 곳 · 보기 주인 권한으로 원본을 읽으므로 읽기 계정은 bi 보기만 SELECT 하면 됨) ── */
CREATE OR REPLACE VIEW bi.v_metrics_daily AS
SELECT m.day, m.metric, m.dim,
       CASE WHEN m.dim <> '' AND m.value < s.min_cell THEN NULL ELSE m.value END AS value,
       (m.dim <> '' AND m.value < s.min_cell) AS suppressed
  FROM public.bi_daily_metrics m
 CROSS JOIN (SELECT coalesce((SELECT CASE WHEN st.value ~ '^([0-9]|1[0-9]|20)$' THEN st.value::int END FROM public.site_settings st WHERE st.key = 'bi.min_cell'), 3) AS min_cell) s;
COMMENT ON VIEW bi.v_metrics_daily IS 'v10.535 (D282) 일별 지표 — 나눔 줄(dim)의 작은 칸(bi.min_cell 미만)은 value 를 비우고 suppressed = true';

CREATE OR REPLACE VIEW bi.v_metric_catalog AS
SELECT metric, label_ko, unit, dim_label, source_ko, sort FROM public.bi_metric_defs;
COMMENT ON VIEW bi.v_metric_catalog IS 'v10.535 (D282) 지표 목록 — 이름 · 단위(COUNT · KRW · VIEW) · 나눔 칸 · 어디서 셈';

CREATE OR REPLACE VIEW bi.v_site_usage_daily AS
SELECT day, path, views, entries, engaged, est_views FROM public.site_usage_daily;
COMMENT ON VIEW bi.v_site_usage_daily IS 'v10.535 (D282) 회원 화면 사용 통계(D274) — 하루 × 화면 주소 묶음 숫자(번호 · 코드는 :id 로 묶인 주소)';

CREATE OR REPLACE VIEW bi.v_site_usage_goals AS
SELECT day, goal, entry_path, n FROM public.site_usage_goals;
COMMENT ON VIEW bi.v_site_usage_goals IS 'v10.535 (D282) 회원 화면 전환(D274) — 하루 × 목표 × 들어온 첫 화면 수';

CREATE OR REPLACE VIEW bi.v_build_state AS
SELECT max(day) AS last_day, max(built_at) AS built_at, count(*)::bigint AS row_count FROM public.bi_daily_metrics;
COMMENT ON VIEW bi.v_build_state IS 'v10.535 (D282) 집계 상태 — 마지막 날 · 마지막 셈 시각 · 줄 수';

/* 개인 식별처럼 보이는 칸 이름 감시(bi 스키마) — 늘 0 줄 */
CREATE OR REPLACE VIEW public.v_bi_pii_columns AS
SELECT c.table_name::text AS view_name, c.column_name::text AS column_name
  FROM information_schema.columns c
 WHERE c.table_schema = 'bi'
   AND c.column_name ~* '(^|_)(account|accounts|email|phone|mobile|tel|ip|addr|address|birth|rrn|user|member|author|buyer|seller|owner|name|nick|card)(_|$)';
COMMENT ON VIEW public.v_bi_pii_columns IS 'v10.535 (D282) bi 스키마 보기에 개인 식별처럼 보이는 칸 이름 — 0 줄이어야 함(시험 test_v1535)';

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('bi.min_cell', '3', 'ADMIN', 'BI 내보내기 작은 칸 가림(v10.535 · D282 · 0 ~ 20 · 처음 3) — bi 보기 · CSV 에서 나눔 줄(관 · 게시판 · 문의 종류 · 목표)의 숫자가 이보다 작으면 비움 · 0 이면 가리지 않음 · 고치기 SUPER', false, '^([0-9]|1[0-9]|20)$', '3'),
  ('bi.keep_days', '1100', 'ADMIN', 'BI 일별 집계 보관 일수(v10.535 · D282 · 400 ~ 3650 · 처음 1100) — 지난 줄은 정기 작업 bi_daily 가 지움 · 원본 표는 그대로 · 고치기 SUPER', false, '^[0-9]{3,4}$', '1100')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('bi_daily', 1440, 4, 50, NULL, true, 'BI 일별 집계 — 어제까지 3일 다시 셈 · bi.keep_days 지난 줄 지움 — 매일 04:50 · D282 · v10.535')
ON CONFLICT (job) DO NOTHING;

/* 내려받기 승인 대상에 BI_DAILY — 지금 CHECK 목록을 읽어 하나만 더함(D270 과 같은 모양 · 앞 묶음이 더한 대상을 지우지 않게 · 이미 있으면 그대로) */
DO $$
DECLARE d text; vals text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO d FROM pg_constraint c
   WHERE c.conname = 'export_requests_target_check' AND c.conrelid = 'public.export_requests'::regclass;
  IF d IS NULL OR position('''BI_DAILY''' IN d) > 0 THEN RETURN; END IF;
  SELECT array_agg((m.x)[1]) INTO vals FROM regexp_matches(d, '''([A-Z][A-Z0-9_]*)''', 'g') AS m(x);
  vals := coalesce(vals, ARRAY[]::text[]) || 'BI_DAILY'::text;
  ALTER TABLE public.export_requests DROP CONSTRAINT export_requests_target_check;
  EXECUTE 'ALTER TABLE public.export_requests ADD CONSTRAINT export_requests_target_check CHECK (target IN ('
          || (SELECT string_agg(quote_literal(u.v), ', ') FROM unnest(vals) AS u(v)) || '))';
END $$;


/* ── ② 운영 대시보드 위젯 배치 (v10.536 · docs/674) ─────────────────────────────────
 *   운영자 계정마다 첫 화면 카드 차례 · 숨김 — 줄이 없으면 기본 배치 그대로(화면 코드의 차례)
 *   카드 열쇠 모양 = 서버 DASH_KEY_RE(^[a-z][a-z0-9-]{1,23}$) · 쉼표로 이어 붙인 글자에 같은 모양을 검사(규칙 2) · 40개까지 */
CREATE TABLE IF NOT EXISTS public.staff_dash_layouts (
  account_id    uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  widget_order  text[] NOT NULL DEFAULT '{}',
  widget_hidden text[] NOT NULL DEFAULT '{}',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_dash_order_keys CHECK (cardinality(widget_order) <= 40 AND array_to_string(widget_order, ',') ~ '^([a-z][a-z0-9-]{1,23}(,|$))*$'),
  CONSTRAINT ck_dash_hidden_keys CHECK (cardinality(widget_hidden) <= 40 AND array_to_string(widget_hidden, ',') ~ '^([a-z][a-z0-9-]{1,23}(,|$))*$')
);
COMMENT ON TABLE public.staff_dash_layouts IS 'v10.536 (D282) 운영 대시보드 위젯 배치 — 운영자 계정마다 카드 차례 · 숨김(서버 저장) · 줄이 없으면 기본 배치 · 지우면 기본으로';

CREATE OR REPLACE FUNCTION public.fn_dash_layout_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_dash_layout_touch' AND tgrelid = 'public.staff_dash_layouts'::regclass) THEN
    CREATE TRIGGER trg_dash_layout_touch BEFORE UPDATE ON public.staff_dash_layouts FOR EACH ROW EXECUTE FUNCTION public.fn_dash_layout_touch();
  END IF;
END $$;


/* ── ③ 휴대폰 재고 실사 (v10.537 · docs/675) ────────────────────────────────────────
 *   로트 실사 회차 — 열면 남은 수량이 있는 로트(정상 · 보류 · 회수)를 「장부 수량(expected)」과 함께 줄로 · 한 번에 하나만 열림
 *   휴대폰 카메라(BarcodeDetector) · 리더기 · 손 입력으로 로트 QR(SGB-LOT-000123) · 로트 번호 · 옵션 바코드(acct_barcodes)를 읽어 센 수(counted)를 적음
 *   처음 센 때의 장부 수량(book_qty)을 함께 남김 — 차이 = counted − book_qty(센 뒤 출고 · 입고가 있어도 차이는 그대로)
 *   닫으면 센 수는 못 고침 · 차이 조정은 SUPER 가 줄마다(D271 로트 조정 = 원가 수불부 실사 조정 한 줄) · 한 번만(adjusted_at)
 *   ㉟ 자산 실사(hrx_stocktakes)는 표를 더하지 않음 — 휴대폰 화면이 기존 읽기 API 를 그대로 부름 */
CREATE TABLE IF NOT EXISTS public.qlt_lot_counts (
  id          bigserial PRIMARY KEY,
  title       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 60),
  state       text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'CLOSED')),
  note        text CHECK (note IS NULL OR char_length(note) <= 200),
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  closed_by   uuid REFERENCES public.accounts(id),
  closed_at   timestamptz,
  CONSTRAINT ck_qlt_cnt_closed CHECK ((state = 'CLOSED') = (closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_qlt_cnt_one_open ON public.qlt_lot_counts (state) WHERE state = 'OPEN';
COMMENT ON TABLE public.qlt_lot_counts IS 'v10.537 (D282) 로트 재고 실사 회차 — 한 번에 하나만 열림 · 닫으면 다시 열지 않음 · 지우지 않음';

CREATE TABLE IF NOT EXISTS public.qlt_lot_count_lines (
  count_id        bigint NOT NULL REFERENCES public.qlt_lot_counts(id),
  lot_id          bigint NOT NULL REFERENCES public.qlt_lots(id),
  expected        integer NOT NULL CHECK (expected >= 0),
  counted         integer CHECK (counted IS NULL OR counted BETWEEN 0 AND 1000000),
  book_qty        integer CHECK (book_qty IS NULL OR book_qty >= 0),
  counted_by      uuid REFERENCES public.accounts(id),
  counted_at      timestamptz,
  note            text CHECK (note IS NULL OR char_length(note) <= 200),
  added_late      boolean NOT NULL DEFAULT false,
  adjusted_at     timestamptz,
  adjust_move_id  bigint,
  PRIMARY KEY (count_id, lot_id),
  CONSTRAINT ck_qlt_cnt_line_pair CHECK ((counted IS NULL) = (counted_at IS NULL) AND (counted IS NULL) = (book_qty IS NULL)),
  CONSTRAINT ck_qlt_cnt_line_adj CHECK (adjusted_at IS NULL OR counted IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_qlt_cnt_lines_lot ON public.qlt_lot_count_lines (lot_id);
COMMENT ON TABLE public.qlt_lot_count_lines IS 'v10.537 (D282) 로트 실사 줄 — 열 때 장부 수량(expected) · 센 수 · 처음 센 때 장부 수량(book_qty) · 늦게 더한 로트(added_late) · 차이 조정 한 번(adjusted_at)';

/* 회차 지킴 — 지우지 않음 · 닫은 회차는 다시 열지 않음 */
CREATE OR REPLACE FUNCTION public.fn_qlt_cnt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'QLT_CNT: 실사 회차는 지우지 않습니다.'; END IF;
  IF OLD.state = 'CLOSED' AND NEW.state <> 'CLOSED' THEN RAISE EXCEPTION 'QLT_CNT: 닫은 실사는 다시 열지 않습니다.'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_qlt_cnt_guard' AND tgrelid = 'public.qlt_lot_counts'::regclass) THEN
    CREATE TRIGGER trg_qlt_cnt_guard BEFORE UPDATE OR DELETE ON public.qlt_lot_counts FOR EACH ROW EXECUTE FUNCTION public.fn_qlt_cnt_guard();
  END IF;
END $$;

/* 줄 지킴 — 지우지 않음 · 닫은 회차의 센 수 · 메모는 못 고침 · 조정 표시는 한 번만(없음 → 있음) */
CREATE OR REPLACE FUNCTION public.fn_qlt_cnt_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'QLT_CNT: 실사 줄은 지우지 않습니다.'; END IF;
  SELECT state INTO v_state FROM public.qlt_lot_counts WHERE id = NEW.count_id;
  IF TG_OP = 'INSERT' THEN
    IF v_state <> 'OPEN' THEN RAISE EXCEPTION 'QLT_CNT: 닫은 실사에는 줄을 더하지 않습니다.'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.count_id <> OLD.count_id OR NEW.lot_id <> OLD.lot_id OR NEW.expected <> OLD.expected THEN
    RAISE EXCEPTION 'QLT_CNT: 실사 줄의 회차 · 로트 · 열 때 수량은 바꾸지 않습니다.';
  END IF;
  IF v_state = 'CLOSED' AND (NEW.counted IS DISTINCT FROM OLD.counted OR NEW.book_qty IS DISTINCT FROM OLD.book_qty OR NEW.note IS DISTINCT FROM OLD.note) THEN
    RAISE EXCEPTION 'QLT_CNT: 닫은 실사는 고치지 않습니다.';
  END IF;
  IF v_state = 'OPEN' AND NEW.adjusted_at IS NOT NULL THEN
    RAISE EXCEPTION 'QLT_CNT: 차이 조정은 실사를 닫은 뒤에 합니다.';
  END IF;
  IF OLD.adjusted_at IS NOT NULL AND (NEW.adjusted_at IS DISTINCT FROM OLD.adjusted_at OR NEW.adjust_move_id IS DISTINCT FROM OLD.adjust_move_id) THEN
    RAISE EXCEPTION 'QLT_CNT: 이미 조정한 줄입니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_qlt_cnt_line_guard' AND tgrelid = 'public.qlt_lot_count_lines'::regclass) THEN
    CREATE TRIGGER trg_qlt_cnt_line_guard BEFORE INSERT OR UPDATE OR DELETE ON public.qlt_lot_count_lines FOR EACH ROW EXECUTE FUNCTION public.fn_qlt_cnt_line_guard();
  END IF;
END $$;


/* ── ④ ㉕ 권한(D258) 시드 — 새 탭 2개
 *   bi-export(통계 내보내기 · 통합 현황 integ · TAB_ROLES ADMIN · SUPER) · mob-scan(휴대폰 실사 · 소개몰 admhlt · TAB_ROLES ADMIN · PAYOUT · SUPER)
 *   주소 규칙(gen_seed.py 와 같음): GET = VIEW · /run 끝 · 설정 · 조정 = APPROVE · 내려받기 = EXPORT · 그 밖 변경 = EDIT
 *   그룹은 adminMenu 의 「붙이기」(hrxAddTabs) 줄로 들어가 gen_seed 의 GROUPS 줄 읽기에는 안 잡혀 직접 적음
 *   위젯 배치(/admin/dash-layout)는 자기 계정 것만이라 주소 맵에 넣지 않음(@Roles 만)
 *   휴대폰 실사의 자산 모드는 ㉟ 자산 실사 주소(hrx-stocktake 업무)를 그대로 부름 — 여기서 넓히지 않음 */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('bi-export', '통계 내보내기(BI)', 'integ', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2950),
  ('mob-scan', '휴대폰 실사', 'admhlt', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2960)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT g, 'bi-export', l FROM (VALUES ('R_ADMIN')) x(g)
  CROSS JOIN (VALUES ('VIEW'), ('EDIT'), ('APPROVE'), ('EXPORT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = x.g)
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT g, 'mob-scan', l FROM (VALUES ('R_ADMIN'), ('R_PAYOUT')) x(g)
  CROSS JOIN (VALUES ('VIEW'), ('EDIT'), ('APPROVE'), ('EXPORT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = x.g)
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/bi', 'bi-export', 'VIEW'),
  ('GET', '/admin/bi/daily', 'bi-export', 'VIEW'),
  ('GET', '/admin/bi/export', 'bi-export', 'EXPORT'),
  ('POST', '/admin/bi/run', 'bi-export', 'APPROVE'),
  ('PUT', '/admin/bi/settings', 'bi-export', 'APPROVE'),
  ('GET', '/admin/qlt/lot-counts', 'mob-scan', 'VIEW'),
  ('POST', '/admin/qlt/lot-counts', 'mob-scan', 'EDIT'),
  ('GET', '/admin/qlt/lot-counts/{id}', 'mob-scan', 'VIEW'),
  ('POST', '/admin/qlt/lot-counts/{id}/scan', 'mob-scan', 'EDIT'),
  ('PUT', '/admin/qlt/lot-counts/{id}/lines/{lotId}', 'mob-scan', 'EDIT'),
  ('POST', '/admin/qlt/lot-counts/{id}/close', 'mob-scan', 'EDIT'),
  ('POST', '/admin/qlt/lot-counts/{id}/lines/{lotId}/adjust', 'mob-scan', 'APPROVE')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

