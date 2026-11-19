-- v10.396 ~ 399 (docs/533 ~ 536) — 회계 · 세무 4단계(⑬): 시산표 · 손익계산서 · 재무상태표 · 기초 잔액 · 자본 계정 · 계정별 원장 · 매입매출장 · 고정자산 · 감가상각 · 예산 대비 실적
--   대표 11/19 15:40 ⑬ 「승인 + 통과하면 병합」.
--   ① 자본(EQUITY) 종류 · 계정 · 기초 잔액 판  ② 원장 내려받기 승인 대상 ACCT_LEDGER  ③ 고정자산 · 상각 · 처분(정기 작업 acct_depreciation)  ④ 예산(정기 작업 acct_budget · ACCT_BUDGET_OVER)
--   내용연수 · 상각 방법 · 상각률은 초안 — 세무사 확인. 다시 돌려도 같음.

/* ── v10.396 (D246 · docs/533) 시산표 · 손익계산서 · 재무상태표 · 기초 잔액 ─────────────
 *   자본(EQUITY) 계정 종류를 더함 · 자본금 · 이월이익잉여금 · 고정자산 · 감가상각 · 처분 손익 계정(⑬ 전체가 씀 · 코드 초안)
 *   기초 잔액 = 시작일(처음 2026-11-01) 기준 통장 · 받을 돈 · 갚을 돈 · 자본금 등 — 시스템을 지나지 않은 돈(SUPER 가 한 번 넣고 「확정」)
 *   acct_opening_sets(판 하나 = 기준일 하나 · DRAFT → FIXED · 확정하면 못 고침) · acct_opening(줄 · DRAFT 일 때만 넣기 · 지우기)
 * ------------------------------------------------------------------------------- */
ALTER TABLE public.acct_accounts DROP CONSTRAINT IF EXISTS acct_accounts_kind_check;
ALTER TABLE public.acct_accounts ADD CONSTRAINT acct_accounts_kind_check CHECK (kind IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'));

INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note) VALUES
  ('FIXED_ASSET',    '비품',                   'ASSET',     '212', '비품',               35, '고정자산(컴퓨터 · 가구 등) — v10.398'),
  ('ACC_DEPR',       '감가상각누계액',         'ASSET',     '213', '감가상각누계액',     36, '고정자산 차감(대변 잔액) — v10.398'),
  ('EQUITY_CAPITAL', '자본금',                 'EQUITY',    '331', '자본금',             80, '기초 잔액에서 넣음 — v10.396'),
  ('RETAINED',       '이월이익잉여금',         'EQUITY',    '375', '이월이익잉여금',     85, '해 마감 때 손익을 옮김(v10.402) · 기초 잔액'),
  ('GAIN_DISPOSAL',  '유형자산처분이익',       'REVENUE',   '914', '유형자산처분이익',   180, '고정자산 처분 이익 — v10.398'),
  ('EXP_DEPR',       '감가상각비',             'EXPENSE',   '818', '감가상각비',         305, '고정자산 달 상각 — v10.398'),
  ('LOSS_DISPOSAL',  '유형자산처분손실',       'EXPENSE',   '970', '유형자산처분손실',   395, '고정자산 처분 손실 — v10.398')
ON CONFLICT (role) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.acct_opening_sets (
  id          bigserial PRIMARY KEY,
  as_of       date NOT NULL UNIQUE,
  state       text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'FIXED')),
  note        text CHECK (note IS NULL OR char_length(note) <= 200),
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  fixed_by    uuid REFERENCES public.accounts(id),
  fixed_at    timestamptz,
  CONSTRAINT ck_aos_fixed CHECK ((state = 'DRAFT' AND fixed_at IS NULL) OR (state = 'FIXED' AND fixed_at IS NOT NULL))
);
COMMENT ON TABLE public.acct_opening_sets IS 'v10.396 (D246) 기초 잔액 판 — 기준일(그날 0시 잔액) 하나 · DRAFT 에서 줄을 고치고 FIXED(차변 = 대변) 뒤로는 못 고침 · 해 마감(v10.402)이 다음 해 판을 만듦';

CREATE TABLE IF NOT EXISTS public.acct_opening (
  id          bigserial PRIMARY KEY,
  set_id      bigint NOT NULL REFERENCES public.acct_opening_sets(id),
  role        text NOT NULL REFERENCES public.acct_accounts(role),
  debit       bigint NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit      bigint NOT NULL DEFAULT 0 CHECK (credit >= 0),
  memo        text CHECK (memo IS NULL OR char_length(memo) <= 120),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ao_one CHECK ((debit > 0) <> (credit > 0))
);
CREATE INDEX IF NOT EXISTS ix_acct_opening_set ON public.acct_opening (set_id, role);
COMMENT ON TABLE public.acct_opening IS 'v10.396 (D246) 기초 잔액 줄 — 계정마다 차변 또는 대변 · 판이 DRAFT 일 때만 넣기 · 지우기(고치기 없음)';

CREATE OR REPLACE FUNCTION public.fn_acct_opening_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text; sid bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'ACCT_OPENING: 기초 잔액 줄은 고치지 않습니다(지우고 다시 넣기 · 확정 전만).'; END IF;
  IF TG_OP = 'DELETE' THEN sid := OLD.set_id; ELSE sid := NEW.set_id; END IF;
  SELECT state INTO st FROM public.acct_opening_sets WHERE id = sid;
  IF st = 'FIXED' THEN RAISE EXCEPTION 'ACCT_OPENING_FIXED: 확정한 기초 잔액은 고칠 수 없습니다.'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_opening_guard' AND tgrelid = 'public.acct_opening'::regclass) THEN
    CREATE TRIGGER trg_acct_opening_guard BEFORE INSERT OR UPDATE OR DELETE ON public.acct_opening FOR EACH ROW EXECUTE FUNCTION public.fn_acct_opening_guard();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_acct_opening_set_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d bigint; c bigint; n int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state = 'FIXED' THEN RAISE EXCEPTION 'ACCT_OPENING_FIXED: 확정한 기초 잔액은 고칠 수 없습니다.'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.state = 'FIXED' THEN RAISE EXCEPTION 'ACCT_OPENING_FIXED: 확정한 기초 잔액은 고칠 수 없습니다.'; END IF;
  IF NEW.as_of IS DISTINCT FROM OLD.as_of THEN RAISE EXCEPTION 'ACCT_OPENING: 기준일은 고치지 않습니다(새 판).'; END IF;
  IF NEW.state = 'FIXED' THEN
    SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) INTO d, c, n FROM public.acct_opening WHERE set_id = NEW.id;
    IF n = 0 OR d <> c THEN
      RAISE EXCEPTION 'ACCT_OPENING_UNBALANCED: 기초 잔액 차변 % · 대변 % 이 같지 않습니다(줄 %).', d, c, n;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_opening_set_guard' AND tgrelid = 'public.acct_opening_sets'::regclass) THEN
    CREATE TRIGGER trg_acct_opening_set_guard BEFORE UPDATE OR DELETE ON public.acct_opening_sets FOR EACH ROW EXECUTE FUNCTION public.fn_acct_opening_set_guard();
  END IF;
END $$;

/* ── v10.397 (D246 · docs/534) 계정별 원장 · 매입매출장 ──────────────────────────────
 *   표는 새로 만들지 않음(전표 acct_entries · acct_lines 에서 셈) · CSV 내려받기는 승인 대상 ACCT_LEDGER(거래처 이름이 들어감)
 *   ※ 대상 CHECK 는 D242 목록 + ACCT_LEDGER — ⑫ 이후 다른 대상을 더했으면 합칠 때 함께 넣을 것(빠지면 있는 요청이 있는 DB 에서 실패)
 * ------------------------------------------------------------------------------- */
ALTER TABLE public.export_requests DROP CONSTRAINT IF EXISTS export_requests_target_check;
ALTER TABLE public.export_requests ADD CONSTRAINT export_requests_target_check
  CHECK (target IN ('POINT_REPORT', 'AUDIT_EXPORT', 'NOTICE_READS', 'RATE_READS', 'ACCT_JOURNAL', 'ACCT_TAX', 'ACCT_LEDGER'));
CREATE INDEX IF NOT EXISTS ix_acct_lines_role_entry ON public.acct_lines (role, entry_id);

/* ── v10.398 (D246 · docs/535) 고정자산 대장 · 감가상각 ───────────────────────────────
 *   acct_assets — 취득가 · 잔존가치 · 내용연수(달) · 정액(STRAIGHT) · 정률(DECLINING) · 시스템 전 상각액(prior_depr · prior_months)
 *     취득 전표: purchase_id 가 있으면 매입 전표가 이미 잡음(매입 계정이 비용이면 「자산으로 넘기기」 전표 ASSET_FROM_PURCHASE) ·
 *               없으면 pay_role(CASH · AP)로 ASSET_ACQUIRE · NONE 은 기초 잔액에 이미 있음(전표 없음)
 *   acct_depreciations — 달마다 한 줄(쌓기만 · 자산 · 달 고유) → 전표 DEPRECIATION(감가상각비 / 감가상각누계액)
 *   처분 — 받은 돈 · 누계액 · 취득가 → 처분 이익 · 손실 전표 ASSET_DISPOSE · 처분은 되돌리지 않음
 *   내용연수 · 상각 방법 · 정률 = 초안(세무사 확인) — 정률 = 1 − (잔존 ÷ 취득가)^(12 ÷ 내용연수 달) · 잔존이 0 이면 5% 로 셈
 * ------------------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS public.acct_assets (
  id              bigserial PRIMARY KEY,
  name            text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  category        text CHECK (category IS NULL OR char_length(category) <= 40),
  acquired_on     date NOT NULL,
  cost            bigint NOT NULL CHECK (cost > 0),
  residual        bigint NOT NULL DEFAULT 0 CHECK (residual >= 0),
  life_months     integer NOT NULL CHECK (life_months BETWEEN 1 AND 600),
  method          text NOT NULL DEFAULT 'STRAIGHT' CHECK (method IN ('STRAIGHT', 'DECLINING')),
  account_role    text NOT NULL DEFAULT 'FIXED_ASSET' REFERENCES public.acct_accounts(role),
  pay_role        text NOT NULL DEFAULT 'NONE' CHECK (pay_role IN ('CASH', 'AP', 'NONE', 'PURCHASE')),
  purchase_id     bigint UNIQUE,
  from_role       text REFERENCES public.acct_accounts(role),
  prior_depr      bigint NOT NULL DEFAULT 0 CHECK (prior_depr >= 0),
  prior_months    integer NOT NULL DEFAULT 0 CHECK (prior_months >= 0),
  state           text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'DISPOSED')),
  disposed_on     date,
  dispose_amount  bigint CHECK (dispose_amount IS NULL OR dispose_amount >= 0),
  dispose_role    text CHECK (dispose_role IS NULL OR dispose_role IN ('CASH', 'AR')),
  dispose_reason  text,
  memo            text CHECK (memo IS NULL OR char_length(memo) <= 200),
  created_by      uuid REFERENCES public.accounts(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_aa_residual CHECK (residual < cost),
  CONSTRAINT ck_aa_prior    CHECK (prior_depr <= cost - residual AND prior_months <= life_months),
  CONSTRAINT ck_aa_purchase CHECK ((pay_role = 'PURCHASE') = (purchase_id IS NOT NULL)),
  CONSTRAINT ck_aa_dispose  CHECK ((state = 'ACTIVE' AND disposed_on IS NULL AND dispose_amount IS NULL)
                                OR (state = 'DISPOSED' AND disposed_on IS NOT NULL AND dispose_amount IS NOT NULL AND dispose_role IS NOT NULL
                                    AND char_length(btrim(coalesce(dispose_reason, ''))) BETWEEN 2 AND 200))
);
CREATE INDEX IF NOT EXISTS ix_acct_assets_state ON public.acct_assets (state, acquired_on);
COMMENT ON TABLE public.acct_assets IS 'v10.398 (D246) 고정자산 대장 — 정액 · 정률 · 잔존가치 · 내용연수(달) · 시스템 전 상각 · 처분(되돌리지 않음) · 상각 규칙은 초안(세무사 확인)';

CREATE TABLE IF NOT EXISTS public.acct_depreciations (
  id          bigserial PRIMARY KEY,
  asset_id    bigint NOT NULL REFERENCES public.acct_assets(id),
  ym          text NOT NULL CHECK (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount      bigint NOT NULL CHECK (amount > 0),
  book_after  bigint NOT NULL CHECK (book_after >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, ym)
);
COMMENT ON TABLE public.acct_depreciations IS 'v10.398 (D246) 달 감가상각 — 자산 · 달 한 줄 · 쌓기만 · 전표 DEPRECIATION';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_depreciations_block' AND tgrelid = 'public.acct_depreciations'::regclass) THEN
    CREATE TRIGGER trg_acct_depreciations_block BEFORE UPDATE OR DELETE ON public.acct_depreciations FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_acct_asset_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_ASSET: 고정자산은 지우지 않습니다 — 처분하십시오.'; END IF;
  SELECT kind INTO k FROM public.acct_accounts WHERE role = NEW.account_role;
  IF k IS DISTINCT FROM 'ASSET' OR NEW.account_role IN ('CASH', 'PG_RECV', 'AR', 'VAT_IN', 'INVENTORY', 'ACC_DEPR') THEN
    RAISE EXCEPTION 'ACCT_ASSET: 고정자산 계정은 자산 계정입니다(현금 · 받을 돈 · 재고 · 누계액 빼고).';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.state = 'DISPOSED' THEN RAISE EXCEPTION 'ACCT_ASSET_DISPOSED: 처분한 고정자산은 고칠 수 없습니다.'; END IF;
    IF (NEW.acquired_on, NEW.cost, NEW.residual, NEW.life_months, NEW.method, NEW.account_role, NEW.pay_role, NEW.purchase_id, NEW.from_role, NEW.prior_depr, NEW.prior_months)
       IS DISTINCT FROM (OLD.acquired_on, OLD.cost, OLD.residual, OLD.life_months, OLD.method, OLD.account_role, OLD.pay_role, OLD.purchase_id, OLD.from_role, OLD.prior_depr, OLD.prior_months)
       AND EXISTS (SELECT 1 FROM public.acct_depreciations WHERE asset_id = OLD.id) THEN
      RAISE EXCEPTION 'ACCT_ASSET: 상각을 시작한 자산은 취득가 · 내용연수 · 방법을 고칠 수 없습니다.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_asset_guard' AND tgrelid = 'public.acct_assets'::regclass) THEN
    CREATE TRIGGER trg_acct_asset_guard BEFORE INSERT OR UPDATE OR DELETE ON public.acct_assets FOR EACH ROW EXECUTE FUNCTION public.fn_acct_asset_guard();
  END IF;
END $$;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('acct_depreciation', 1440, 3, 40, NULL, true, '감가상각 — 매일 03:40 · 끝난 달까지 자산마다 한 번(같은 달 두 번 없음) · 전표는 acct_journal 이 DEPRECIATION 으로 · D246 · v10.398')
ON CONFLICT (job) DO NOTHING;

/* ── v10.399 (D246 · docs/536) 예산 대비 실적 ──────────────────────────────────────
 *   acct_budgets — 달 · 계정(비용 · 매출)마다 예산(SUPER · 0 이면 지움) · 바꾼 기록 acct_budget_changes(쌓기만)
 *   정기 작업 acct_budget(매일 09:25) — 이번 달 · 지난달 비용 계정 실적이 예산을 넘으면 ACCT_BUDGET_OVER(달 · 계정 한 번 · 예산을 올리면 풀림)
 * ------------------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS public.acct_budgets (
  ym          text NOT NULL CHECK (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  role        text NOT NULL REFERENCES public.acct_accounts(role),
  amount      bigint NOT NULL CHECK (amount > 0),
  updated_by  uuid REFERENCES public.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ym, role)
);
COMMENT ON TABLE public.acct_budgets IS 'v10.399 (D246) 달 예산 — 계정(비용 · 매출)마다 · SUPER · 바꾼 기록은 acct_budget_changes';

CREATE OR REPLACE FUNCTION public.fn_acct_budget_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text;
BEGIN
  SELECT kind INTO k FROM public.acct_accounts WHERE role = NEW.role;
  IF k IS NULL OR k NOT IN ('EXPENSE', 'REVENUE') THEN RAISE EXCEPTION 'ACCT_BUDGET: 예산은 비용 · 매출 계정에만 둡니다.'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_budget_guard' AND tgrelid = 'public.acct_budgets'::regclass) THEN
    CREATE TRIGGER trg_acct_budget_guard BEFORE INSERT OR UPDATE ON public.acct_budgets FOR EACH ROW EXECUTE FUNCTION public.fn_acct_budget_guard();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.acct_budget_changes (
  id          bigserial PRIMARY KEY,
  ym          text NOT NULL,
  role        text NOT NULL,
  before      bigint,
  after       bigint,
  reason      text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 2 AND 200),
  actor_id    uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_budget_changes_block' AND tgrelid = 'public.acct_budget_changes'::regclass) THEN
    CREATE TRIGGER trg_acct_budget_changes_block BEFORE UPDATE OR DELETE ON public.acct_budget_changes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('acct.budget_alert', 'on', 'ADMIN',
        '예산 넘음 운영 알림(v10.399 · docs/536) — 비용 계정 달 실적이 예산을 넘으면 ACCT_BUDGET_OVER(달 · 계정 한 번). off 면 알리지 않음.',
        false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('acct_budget', 1440, 9, 25, NULL, true, '예산 넘음 알림 — 매일 09:25 · 이번 달 · 지난달 비용 계정 실적 > 예산이면 ACCT_BUDGET_OVER · 예산을 올리면 풀림 · D246 · v10.399')
ON CONFLICT (job) DO NOTHING;

