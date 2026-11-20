/* D271 (v10.494 ~ 496 · docs/632 ~ 634) ㊶ 구매 · 품질 — 협력사 평가 · 재고 로트 · 유통기한(FEFO · 회수 대상) · 품질 클레임 · 불량 */

/* D271 (v10.494 ~ 496 · docs/632 ~ 634) ㊶ 구매 · 소개몰 품질 — 협력사(공급사) 평가 · 재고 로트 · 유통기한 · 품질 클레임 · 불량
 *   마이그레이션 #309 · prisma/migrations/D271_supplier_eval_lots_quality_claims/migration.sql
 *   다시 돌려도 같음 · 지우는 문장은 수불부 CHECK 두 개를 넓히는 줄뿐(DROP CONSTRAINT IF EXISTS → 바로 다시 ADD · 옛 줄은 모두 통과)
 *   로트는 **덧붙이는 층** — 로트 관리를 켠 직판 상품만 · 끄면(또는 켠 적 없으면) 지금과 똑같이 돎(판매 · 입고 · 출고 · 반품 · 전표 그대로) */

/* ── ① 협력사(공급사) 평가 (v10.494 · docs/632) ──────────────────────────────────────
 *   ㉑ 국내 발주(acct_pos)에 납기일 칸이 없어 표를 고치지 않고 따로 둠(qlt_po_due · 발주 상태일 때만 넣고 고침)
 *   납기일이 없는 발주는 발주일 + qlt.po_lead_days(처음 7일)를 납기로 봄 · 입고일 ≤ 납기면 제때
 *   분기마다 거래처(매입처) 한 줄 — 납기(자동) · 품질(클레임 수로 제안 · 고칠 수 있음) · 가격 · 대응(사람이 매김) → 가중 합 · 등급 · 확정하면 고치지 않음 */
CREATE TABLE IF NOT EXISTS public.qlt_po_due (
  po_id    bigint PRIMARY KEY REFERENCES public.acct_pos(id),
  due_on   date NOT NULL,
  set_by   uuid REFERENCES public.accounts(id),
  set_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.qlt_po_due IS 'v10.494 (D271) 국내 발주 납기일 — 발주(ORDERED) 상태일 때만 넣고 고침 · 입고 · 취소 뒤 고치지 않음 · 지우지 않음 · 없으면 발주일 + qlt.po_lead_days';

CREATE OR REPLACE FUNCTION public.fn_qlt_po_due_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text; od date;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'QLT_PO_DUE: 납기일은 지우지 않습니다.'; END IF;
  SELECT state, ordered_on INTO st, od FROM public.acct_pos WHERE id = NEW.po_id;
  IF st IS DISTINCT FROM 'ORDERED' THEN
    RAISE EXCEPTION 'QLT_PO_DUE: 발주 상태인 것만 납기일을 넣고 고칩니다(입고 · 취소 뒤에는 그대로).';
  END IF;
  IF NEW.due_on < od THEN RAISE EXCEPTION 'QLT_PO_DUE: 납기일은 발주일 뒤여야 합니다.'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.po_id <> OLD.po_id THEN RAISE EXCEPTION 'QLT_PO_DUE: 발주 번호는 바꾸지 않습니다.'; END IF;
  NEW.set_at := now();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_qlt_po_due_guard' AND tgrelid = 'public.qlt_po_due'::regclass) THEN
    CREATE TRIGGER trg_qlt_po_due_guard BEFORE INSERT OR UPDATE OR DELETE ON public.qlt_po_due FOR EACH ROW EXECUTE FUNCTION public.fn_qlt_po_due_guard();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.qlt_sup_evals (
  id              bigserial PRIMARY KEY,
  party_id        bigint NOT NULL REFERENCES public.acct_parties(id),
  period          text NOT NULL CHECK (period ~ '^[0-9]{4}-Q[1-4]$'),
  po_count        integer NOT NULL DEFAULT 0 CHECK (po_count >= 0),
  on_time         integer NOT NULL DEFAULT 0 CHECK (on_time >= 0),
  late_days       numeric(6,1) NOT NULL DEFAULT 0 CHECK (late_days >= 0),
  claim_count     integer NOT NULL DEFAULT 0 CHECK (claim_count >= 0),
  delivery_score  smallint NOT NULL CHECK (delivery_score BETWEEN 0 AND 100),
  quality_score   smallint NOT NULL CHECK (quality_score BETWEEN 0 AND 100),
  price_score     smallint NOT NULL CHECK (price_score BETWEEN 0 AND 100),
  response_score  smallint NOT NULL CHECK (response_score BETWEEN 0 AND 100),
  weights         text NOT NULL CHECK (weights ~ '^[0-9]{1,3},[0-9]{1,3},[0-9]{1,3},[0-9]{1,3}$'),
  total           numeric(5,1) NOT NULL CHECK (total BETWEEN 0 AND 100),
  grade           text NOT NULL CHECK (grade IN ('A', 'B', 'C', 'D')),
  memo            text CHECK (memo IS NULL OR char_length(memo) <= 400),
  state           text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'FINAL')),
  created_by      uuid REFERENCES public.accounts(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  confirmed_by    uuid REFERENCES public.accounts(id),
  confirmed_at    timestamptz,
  CONSTRAINT uq_qlt_sup_eval UNIQUE (party_id, period),
  CONSTRAINT ck_qlt_sup_eval_on_time CHECK (on_time <= po_count),
  CONSTRAINT ck_qlt_sup_eval_final CHECK ((state = 'FINAL') = (confirmed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_qlt_sup_evals_period ON public.qlt_sup_evals (period, grade);
COMMENT ON TABLE public.qlt_sup_evals IS 'v10.494 (D271) 협력사(공급사) 분기 평가 — 납기(발주 · 입고 자동) · 품질 · 가격 · 대응 점수 · 가중 합 · 등급 A ~ D · 확정(FINAL) 뒤 고치지 않음 · 지우지 않음';

CREATE OR REPLACE FUNCTION public.fn_qlt_sup_eval_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'QLT_EVAL: 평가는 지우지 않습니다.'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.state = 'FINAL' THEN RAISE EXCEPTION 'QLT_EVAL: 확정한 평가는 고치지 않습니다.'; END IF;
    IF (NEW.party_id, NEW.period) IS DISTINCT FROM (OLD.party_id, OLD.period) THEN RAISE EXCEPTION 'QLT_EVAL: 거래처 · 분기는 바꾸지 않습니다.'; END IF;
  END IF;
  SELECT kind INTO k FROM public.acct_parties WHERE id = NEW.party_id;
  IF k IS NULL OR k NOT IN ('SUPPLIER', 'BOTH') THEN RAISE EXCEPTION 'QLT_EVAL: 매입처(공급사) 거래처만 평가합니다.'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_qlt_sup_eval_guard' AND tgrelid = 'public.qlt_sup_evals'::regclass) THEN
    CREATE TRIGGER trg_qlt_sup_eval_guard BEFORE INSERT OR UPDATE OR DELETE ON public.qlt_sup_evals FOR EACH ROW EXECUTE FUNCTION public.fn_qlt_sup_eval_guard();
  END IF;
END $$;

/* ── ② 재고 로트 · 유통기한 (v10.495 · docs/633) ──────────────────────────────────────
 *   판매용 재고(hlt_product_options.stock) · 원가 수불부(acct_stock_moves · 이동평균 · 전표)는 **그대로**.
 *   로트는 수불부 줄에 「어느 로트 몇 개」를 덧붙이는 표(qlt_lot_moves · 쌓기만):
 *     입고(IN · 늘리는 실사)  → 사람이 로트를 등록하며 그 수불부 줄을 고름(합이 그 줄 수량을 넘지 못함) · 로트 시작 재고(OPEN)는 줄 없이
 *     판매 출고(OUT_SALE)     → 정기 작업 qlt_lot_alloc(매시간)이 **배송 뒤**(주문) · 바로(수출 등) 출고 지정 로트 → 먼저 끝나는 것부터(FEFO)
 *     취소 · 반품 반입(RETURN) → 그 출고에 나갔던 로트로 그대로 되돌림 · 배송 전 취소면 로트 없음(SKIP)
 *     줄이는 실사(ADJUST)      → 로트 화면의 「로트 조정」이면 그 로트 · 재고 화면 실사면 FEFO
 *     공급사 반품(SUP_RETURN)  → ③ 클레임에서만(새 수불부 종류 · 원가로 나감 · 전표 외상매입금 / 상품)
 *   처리한 수불부 줄은 qlt_move_marks 에 한 줄(DONE · SHORT 로트 모자람 · SKIP) — 로트가 모자라도 판매 · 수불부는 막지 않음(알림만). */
CREATE TABLE IF NOT EXISTS public.qlt_lot_products (
  product_id  uuid PRIMARY KEY REFERENCES public.hlt_products(id),
  active      boolean NOT NULL DEFAULT true,
  on_at       timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES public.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.qlt_lot_products IS 'v10.495 (D271) 로트 관리를 켠 직판 상품 — 켠 시각(on_at) 뒤 수불부 줄만 로트를 붙임 · 끄면 지금과 같음(로트 기록은 남음) · 다시 켜면 그때부터';

CREATE OR REPLACE FUNCTION public.fn_qlt_lot_product_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_type text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'QLT_LOT: 로트 관리 기록은 지우지 않습니다(끄기만).'; END IF;
  SELECT s.type INTO v_type FROM public.hlt_products p LEFT JOIN public.hlt_sellers s ON s.id = p.seller_id WHERE p.id = NEW.product_id;
  IF coalesce(v_type, '') <> 'DIRECT' THEN RAISE EXCEPTION 'QLT_LOT: 직판 상품만 로트 관리를 켭니다.'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.active AND NOT OLD.active THEN NEW.on_at := now(); END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_qlt_lot_product_guard' AND tgrelid = 'public.qlt_lot_products'::regclass) THEN
    CREATE TRIGGER trg_qlt_lot_product_guard BEFORE INSERT OR UPDATE OR DELETE ON public.qlt_lot_products FOR EACH ROW EXECUTE FUNCTION public.fn_qlt_lot_product_guard();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.qlt_lots (
  id          bigserial PRIMARY KEY,
  option_id   uuid NOT NULL REFERENCES public.hlt_product_options(id),
  product_id  uuid REFERENCES public.hlt_products(id),
  lot_no      text NOT NULL CHECK (lot_no ~ '^[0-9A-Za-z][0-9A-Za-z._/-]{0,39}$'),
  made_on     date,
  expires_on  date NOT NULL,
  in_kind     text NOT NULL CHECK (in_kind IN ('MOVE', 'OPEN')),
  in_qty      integer NOT NULL CHECK (in_qty BETWEEN 1 AND 1000000),
  in_move_id  bigint REFERENCES public.acct_stock_moves(id),
  party_id    bigint REFERENCES public.acct_parties(id),
  po_id       bigint REFERENCES public.acct_pos(id),
  state       text NOT NULL DEFAULT 'OK' CHECK (state IN ('OK', 'HOLD', 'RECALL', 'CLOSED')),
  state_note  text CHECK (state_note IS NULL OR char_length(state_note) <= 200),
  memo        text CHECK (memo IS NULL OR char_length(memo) <= 200),
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_qlt_lot_no UNIQUE (option_id, lot_no),
  CONSTRAINT ck_qlt_lot_dates CHECK (made_on IS NULL OR made_on <= expires_on),
  CONSTRAINT ck_qlt_lot_in CHECK ((in_kind = 'MOVE') = (in_move_id IS NOT NULL)),
  CONSTRAINT ck_qlt_lot_note CHECK (state NOT IN ('HOLD', 'RECALL') OR char_length(btrim(coalesce(state_note, ''))) >= 2)
);
CREATE INDEX IF NOT EXISTS ix_qlt_lots_option ON public.qlt_lots (option_id, expires_on, id);
CREATE INDEX IF NOT EXISTS ix_qlt_lots_move ON public.qlt_lots (in_move_id) WHERE in_move_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_qlt_lots_expiry ON public.qlt_lots (expires_on) WHERE state IN ('OK', 'HOLD');
COMMENT ON TABLE public.qlt_lots IS 'v10.495 (D271) 직판 재고 로트 — 로트 번호 · 제조일 · 유통기한 · 들어온 수량(수불부 입고 줄 MOVE · 시작 재고 OPEN) · 공급사 · 발주 · 상태(OK · HOLD 보류 · RECALL 회수 · CLOSED 끝) · 지우지 않음';

CREATE TABLE IF NOT EXISTS public.qlt_lot_moves (
  id             bigserial PRIMARY KEY,
  lot_id         bigint NOT NULL REFERENCES public.qlt_lots(id),
  kind           text NOT NULL CHECK (kind IN ('IN', 'OPEN', 'OUT', 'RETURN', 'ADJUST', 'SUP_RETURN')),
  qty            integer NOT NULL,
  qty_after      integer NOT NULL DEFAULT 0 CHECK (qty_after >= 0),
  move_id        bigint REFERENCES public.acct_stock_moves(id),
  order_item_id  uuid REFERENCES public.hlt_order_items(id),
  claim_id       bigint,
  note           text CHECK (note IS NULL OR char_length(note) <= 200),
  created_by     uuid REFERENCES public.accounts(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_qlt_lot_move_sign CHECK ((kind IN ('IN', 'OPEN', 'RETURN') AND qty > 0) OR (kind IN ('OUT', 'SUP_RETURN') AND qty < 0) OR (kind = 'ADJUST' AND qty <> 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_qlt_lot_move ON public.qlt_lot_moves (move_id, lot_id) WHERE move_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_qlt_lot_moves_lot ON public.qlt_lot_moves (lot_id, id DESC);
CREATE INDEX IF NOT EXISTS ix_qlt_lot_moves_item ON public.qlt_lot_moves (order_item_id) WHERE order_item_id IS NOT NULL;
COMMENT ON TABLE public.qlt_lot_moves IS 'v10.495 (D271) 로트 수불 — 수불부 줄(move_id)마다 어느 로트 몇 개 · 남은 수량(qty_after)은 트리거가 셈 · 0 아래로 못 감 · 쌓기만';

CREATE TABLE IF NOT EXISTS public.qlt_move_marks (
  move_id    bigint PRIMARY KEY REFERENCES public.acct_stock_moves(id),
  mark       text NOT NULL CHECK (mark IN ('DONE', 'SHORT', 'SKIP')),
  short_qty  integer NOT NULL DEFAULT 0 CHECK (short_qty >= 0),
  note       text CHECK (note IS NULL OR char_length(note) <= 200),
  marked_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_qlt_mark_short CHECK ((mark = 'SHORT') = (short_qty > 0))
);
COMMENT ON TABLE public.qlt_move_marks IS 'v10.495 (D271) 로트를 붙인 수불부 줄 — DONE 다 붙임 · SHORT 로트가 모자라 short_qty 만큼 못 붙임(알림 QLT_LOT_SHORT) · SKIP 배송 전 취소 · 로트 관리 전 출고 · 쌓기만';

CREATE TABLE IF NOT EXISTS public.qlt_lot_picks (
  id                bigserial PRIMARY KEY,
  order_item_id     uuid NOT NULL REFERENCES public.hlt_order_items(id),
  lot_id            bigint NOT NULL REFERENCES public.qlt_lots(id),
  qty               integer NOT NULL CHECK (qty BETWEEN 1 AND 1000000),
  consumed_move_id  bigint REFERENCES public.acct_stock_moves(id),
  created_by        uuid REFERENCES public.accounts(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_qlt_lot_pick UNIQUE (order_item_id, lot_id)
);
COMMENT ON TABLE public.qlt_lot_picks IS 'v10.495 (D271) 출고 로트 지정(발송 전 FEFO 제안을 사람이 확정) — 배송 뒤 정기 작업이 이 지정부터 로트를 붙임(consumed_move_id) · 쓰기 전만 지우고 바꿈';

/* 로트 가드 — 직판만 · 들어온 수불부 줄 확인(같은 옵션 · 입고 또는 늘리는 실사 · 로트 합 ≤ 그 줄 수량) · 고칠 수 있는 칸은 상태 · 메모 · 공급사뿐 */
CREATE OR REPLACE FUNCTION public.fn_qlt_lot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_type text; mv record; used integer; bal integer;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'QLT_LOT: 로트는 지우지 않습니다(끝내기만).'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT o.product_id, s.type INTO NEW.product_id, v_type
      FROM public.hlt_product_options o JOIN public.hlt_products p ON p.id = o.product_id LEFT JOIN public.hlt_sellers s ON s.id = p.seller_id
     WHERE o.id = NEW.option_id;
    IF coalesce(v_type, '') <> 'DIRECT' THEN RAISE EXCEPTION 'QLT_LOT: 직판 상품 옵션만 로트를 둡니다.'; END IF;
    IF NEW.in_move_id IS NOT NULL THEN
      SELECT option_id, kind, qty INTO mv FROM public.acct_stock_moves WHERE id = NEW.in_move_id;
      IF mv.option_id IS DISTINCT FROM NEW.option_id OR NOT (mv.kind = 'IN' OR (mv.kind = 'ADJUST' AND mv.qty > 0)) THEN
        RAISE EXCEPTION 'QLT_LOT: 같은 옵션의 입고(또는 늘리는 실사) 줄만 로트로 나눕니다.';
      END IF;
      PERFORM pg_advisory_xact_lock(hashtext('qlt_lot_in:' || NEW.in_move_id::text));
      SELECT coalesce(sum(in_qty), 0) INTO used FROM public.qlt_lots WHERE in_move_id = NEW.in_move_id;
      IF used + NEW.in_qty > mv.qty THEN RAISE EXCEPTION 'QLT_LOT: 로트 수량 합이 그 입고 줄 수량을 넘습니다.'; END IF;
    END IF;
    NEW.state := 'OK';
    RETURN NEW;
  END IF;
  IF (NEW.option_id, NEW.product_id, NEW.lot_no, NEW.made_on, NEW.expires_on, NEW.in_kind, NEW.in_qty, NEW.in_move_id, NEW.po_id, NEW.created_at)
     IS DISTINCT FROM (OLD.option_id, OLD.product_id, OLD.lot_no, OLD.made_on, OLD.expires_on, OLD.in_kind, OLD.in_qty, OLD.in_move_id, OLD.po_id, OLD.created_at) THEN
    RAISE EXCEPTION 'QLT_LOT: 로트 번호 · 날짜 · 들어온 수량은 고치지 않습니다(로트 조정 · 새 로트로).';
  END IF;
  IF NEW.state <> OLD.state THEN
    IF OLD.state = 'CLOSED' OR (OLD.state = 'RECALL' AND NEW.state <> 'CLOSED') THEN
      RAISE EXCEPTION 'QLT_LOT: 회수 로트는 끝내기만 · 끝낸 로트는 그대로입니다.';
    END IF;
    IF NEW.state = 'CLOSED' THEN
      SELECT qty_after INTO bal FROM public.qlt_lot_moves WHERE lot_id = NEW.id ORDER BY id DESC LIMIT 1;
      IF coalesce(bal, 0) <> 0 THEN RAISE EXCEPTION 'QLT_LOT: 남은 수량이 0 일 때만 끝냅니다.'; END IF;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_qlt_lot_guard' AND tgrelid = 'public.qlt_lots'::regclass) THEN
    CREATE TRIGGER trg_qlt_lot_guard BEFORE INSERT OR UPDATE OR DELETE ON public.qlt_lots FOR EACH ROW EXECUTE FUNCTION public.fn_qlt_lot_guard();
  END IF;
END $$;

/* 로트를 넣으면 첫 수불(IN · OPEN)을 같이 */
CREATE OR REPLACE FUNCTION public.fn_qlt_lot_first_move() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.qlt_lot_moves (lot_id, kind, qty, move_id, note, created_by)
  VALUES (NEW.id, CASE WHEN NEW.in_kind = 'MOVE' THEN 'IN' ELSE 'OPEN' END, NEW.in_qty, NEW.in_move_id, '로트 등록', NEW.created_by);
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_qlt_lot_first_move' AND tgrelid = 'public.qlt_lots'::regclass) THEN
    CREATE TRIGGER trg_qlt_lot_first_move AFTER INSERT ON public.qlt_lots FOR EACH ROW EXECUTE FUNCTION public.fn_qlt_lot_first_move();
  END IF;
END $$;

/* 로트 수불 — 로트마다 차례대로(잠금) · 남은 수량 셈 · 0 아래 막음 · 끝낸 로트에서 내보내지 않음 */
CREATE OR REPLACE FUNCTION public.fn_qlt_lot_move() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text; pq integer;
BEGIN
  SELECT state INTO st FROM public.qlt_lots WHERE id = NEW.lot_id FOR UPDATE;
  IF st IS NULL THEN RAISE EXCEPTION 'QLT_LOT: 없는 로트입니다.'; END IF;
  IF st = 'CLOSED' AND NEW.qty < 0 THEN RAISE EXCEPTION 'QLT_LOT: 끝낸 로트에서는 내보내지 않습니다.'; END IF;
  SELECT qty_after INTO pq FROM public.qlt_lot_moves WHERE lot_id = NEW.lot_id ORDER BY id DESC LIMIT 1;
  NEW.qty_after := coalesce(pq, 0) + NEW.qty;
  IF NEW.qty_after < 0 THEN RAISE EXCEPTION 'QLT_LOT: 로트 남은 수량이 모자랍니다.'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_qlt_lot_move' AND tgrelid = 'public.qlt_lot_moves'::regclass) THEN
    CREATE TRIGGER trg_qlt_lot_move BEFORE INSERT ON public.qlt_lot_moves FOR EACH ROW EXECUTE FUNCTION public.fn_qlt_lot_move();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_qlt_lot_moves_ro' AND tgrelid = 'public.qlt_lot_moves'::regclass) THEN
    CREATE TRIGGER trg_qlt_lot_moves_ro BEFORE UPDATE OR DELETE ON public.qlt_lot_moves FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_qlt_move_marks_ro' AND tgrelid = 'public.qlt_move_marks'::regclass) THEN
    CREATE TRIGGER trg_qlt_move_marks_ro BEFORE UPDATE OR DELETE ON public.qlt_move_marks FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* 출고 지정 — 쓰기 전만 고치고 지움 · 쓴 표시는 한 번 */
CREATE OR REPLACE FUNCTION public.fn_qlt_lot_pick_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.consumed_move_id IS NOT NULL THEN RAISE EXCEPTION 'QLT_PICK: 출고에 쓴 로트 지정은 바꾸지 않습니다.'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF (NEW.order_item_id, NEW.lot_id) IS DISTINCT FROM (OLD.order_item_id, OLD.lot_id) THEN RAISE EXCEPTION 'QLT_PICK: 주문 줄 · 로트는 바꾸지 않습니다(지우고 다시).'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_qlt_lot_pick_guard' AND tgrelid = 'public.qlt_lot_picks'::regclass) THEN
    CREATE TRIGGER trg_qlt_lot_pick_guard BEFORE UPDATE OR DELETE ON public.qlt_lot_picks FOR EACH ROW EXECUTE FUNCTION public.fn_qlt_lot_pick_guard();
  END IF;
END $$;

/* 로트 남은 수량(마지막 수불의 qty_after) */
CREATE OR REPLACE VIEW public.v_qlt_lot_qty AS
SELECT l.id AS lot_id, l.option_id, coalesce((SELECT m.qty_after FROM public.qlt_lot_moves m WHERE m.lot_id = l.id ORDER BY m.id DESC LIMIT 1), 0) AS qty
  FROM public.qlt_lots l;
COMMENT ON VIEW public.v_qlt_lot_qty IS 'v10.495 (D271) 로트 남은 수량 — 로트 수불 마지막 줄의 qty_after';

/* ── 수불부 새 종류 SUP_RETURN(공급사 반품 · ③ 클레임) — CHECK 두 개를 넓힘(옛 줄은 모두 통과 · 다른 종류 규칙 그대로) ── */
ALTER TABLE public.acct_stock_moves DROP CONSTRAINT IF EXISTS acct_stock_moves_kind_check;
ALTER TABLE public.acct_stock_moves ADD CONSTRAINT acct_stock_moves_kind_check CHECK (kind IN ('IN', 'OUT_SALE', 'RETURN', 'ADJUST', 'SUP_RETURN'));
ALTER TABLE public.acct_stock_moves DROP CONSTRAINT IF EXISTS ck_asm_sign;
ALTER TABLE public.acct_stock_moves ADD CONSTRAINT ck_asm_sign CHECK ((kind IN ('IN', 'RETURN') AND qty > 0) OR (kind IN ('OUT_SALE', 'SUP_RETURN') AND qty < 0) OR (kind = 'ADJUST' AND qty <> 0));
COMMENT ON COLUMN public.acct_stock_moves.kind IS 'IN 입고 · OUT_SALE 판매 출고 · RETURN 취소 · 반품 반입 · ADJUST 실사 조정 · SUP_RETURN 공급사 반품(v10.496 D271 · 원가로 나감 · 모자라면 막음)';

/* 공급사 반품은 재고가 모자라면 막음 — 수불부 트리거(trg_acct_stock_move · 이름 차례로 먼저 돎)가 셈한 zero_cost 를 봄 */
CREATE OR REPLACE FUNCTION public.fn_qlt_sup_return_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'SUP_RETURN' AND NEW.zero_cost THEN
    RAISE EXCEPTION 'QLT_RETURN: 재고가 모자라 공급사 반품을 적을 수 없습니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_qlt_sup_return_guard' AND tgrelid = 'public.acct_stock_moves'::regclass) THEN
    CREATE TRIGGER trg_qlt_sup_return_guard BEFORE INSERT ON public.acct_stock_moves FOR EACH ROW EXECUTE FUNCTION public.fn_qlt_sup_return_guard();
  END IF;
END $$;

/* ── ③ 품질 클레임 · 불량 (v10.496 · docs/634) ──────────────────────────────────────
 *   접수(고객 · 입고 검사 · 공급사 · 사내) → 확인 중 → 조치 → 끝냄(원인 · 조치 필수) · 반려(사유)
 *   상품 · 옵션 · 로트 · 공급사(로트의 공급사가 기본) · 주문 연결 · 공급사 반품(수불부 SUP_RETURN · 로트 수불 · 전표 QLT_SUP_RETURN)
 *   재발: 같은 상품 · 같은 불량이 90일 안 qlt.repeat_count(처음 3)건 → 운영 알림 QLT_CLAIM_REPEAT · 지우지 않음 · 기록은 쌓기만 */
CREATE TABLE IF NOT EXISTS public.qlt_claims (
  id              bigserial PRIMARY KEY,
  received_on     date NOT NULL,
  source          text NOT NULL CHECK (source IN ('CUSTOMER', 'INSPECTION', 'SUPPLIER', 'INTERNAL')),
  product_id      uuid NOT NULL REFERENCES public.hlt_products(id),
  option_id       uuid REFERENCES public.hlt_product_options(id),
  lot_id          bigint REFERENCES public.qlt_lots(id),
  party_id        bigint REFERENCES public.acct_parties(id),
  order_id        uuid REFERENCES public.hlt_orders(id),
  qty             integer NOT NULL CHECK (qty BETWEEN 1 AND 1000000),
  defect_type     text NOT NULL CHECK (defect_type IN ('DAMAGE', 'EXPIRY', 'FOREIGN', 'LABEL', 'QUALITY', 'MISSING', 'OTHER')),
  title           text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 100),
  detail          text CHECK (detail IS NULL OR char_length(detail) <= 2000),
  cause           text CHECK (cause IS NULL OR char_length(cause) <= 1000),
  action          text CHECK (action IS NULL OR char_length(action) <= 1000),
  state           text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'CHECKING', 'ACTION', 'CLOSED', 'REJECTED')),
  close_note      text CHECK (close_note IS NULL OR char_length(close_note) <= 400),
  closed_at       timestamptz,
  sup_return_qty  integer NOT NULL DEFAULT 0 CHECK (sup_return_qty >= 0),
  created_by      uuid REFERENCES public.accounts(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_qlt_claim_return CHECK (sup_return_qty <= qty),
  CONSTRAINT ck_qlt_claim_closed CHECK ((state IN ('CLOSED', 'REJECTED')) = (closed_at IS NOT NULL)),
  CONSTRAINT ck_qlt_claim_done CHECK (state <> 'CLOSED' OR (char_length(btrim(coalesce(cause, ''))) >= 2 AND char_length(btrim(coalesce(action, ''))) >= 2)),
  CONSTRAINT ck_qlt_claim_reject CHECK (state <> 'REJECTED' OR char_length(btrim(coalesce(close_note, ''))) >= 2)
);
CREATE INDEX IF NOT EXISTS ix_qlt_claims_state ON public.qlt_claims (state, received_on DESC);
CREATE INDEX IF NOT EXISTS ix_qlt_claims_repeat ON public.qlt_claims (product_id, defect_type, received_on);
CREATE INDEX IF NOT EXISTS ix_qlt_claims_party ON public.qlt_claims (party_id, received_on);
CREATE INDEX IF NOT EXISTS ix_qlt_claims_lot ON public.qlt_claims (lot_id) WHERE lot_id IS NOT NULL;
COMMENT ON TABLE public.qlt_claims IS 'v10.496 (D271) 품질 클레임 · 불량 — 접수 · 원인 · 조치 · 상품 · 로트 · 공급사 · 주문 · 공급사 반품 수량 · 끝내거나 반려하면 고치지 않음 · 지우지 않음';

CREATE OR REPLACE FUNCTION public.fn_qlt_claim_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lo record;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'QLT_CLAIM: 클레임은 지우지 않습니다(반려로).'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.state IN ('CLOSED', 'REJECTED') THEN RAISE EXCEPTION 'QLT_CLAIM: 끝내거나 반려한 클레임은 고치지 않습니다.'; END IF;
    IF (NEW.received_on, NEW.product_id, NEW.created_at) IS DISTINCT FROM (OLD.received_on, OLD.product_id, OLD.created_at) THEN
      RAISE EXCEPTION 'QLT_CLAIM: 접수일 · 상품은 바꾸지 않습니다.';
    END IF;
    IF NEW.sup_return_qty < OLD.sup_return_qty THEN RAISE EXCEPTION 'QLT_CLAIM: 공급사 반품 수량은 줄지 않습니다.'; END IF;
  END IF;
  IF NEW.lot_id IS NOT NULL THEN
    SELECT option_id, product_id INTO lo FROM public.qlt_lots WHERE id = NEW.lot_id;
    IF lo.product_id IS DISTINCT FROM NEW.product_id OR (NEW.option_id IS NOT NULL AND lo.option_id IS DISTINCT FROM NEW.option_id) THEN
      RAISE EXCEPTION 'QLT_CLAIM: 로트가 그 상품 · 옵션의 것이 아닙니다.';
    END IF;
  END IF;
  IF NEW.option_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.hlt_product_options WHERE id = NEW.option_id AND product_id = NEW.product_id) THEN
    RAISE EXCEPTION 'QLT_CLAIM: 옵션이 그 상품의 것이 아닙니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_qlt_claim_guard' AND tgrelid = 'public.qlt_claims'::regclass) THEN
    CREATE TRIGGER trg_qlt_claim_guard BEFORE INSERT OR UPDATE OR DELETE ON public.qlt_claims FOR EACH ROW EXECUTE FUNCTION public.fn_qlt_claim_guard();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_qlt_lot_moves_claim') THEN
    ALTER TABLE public.qlt_lot_moves ADD CONSTRAINT fk_qlt_lot_moves_claim FOREIGN KEY (claim_id) REFERENCES public.qlt_claims(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.qlt_claim_logs (
  id          bigserial PRIMARY KEY,
  claim_id    bigint NOT NULL REFERENCES public.qlt_claims(id),
  kind        text NOT NULL CHECK (kind IN ('CREATE', 'EDIT', 'STATE', 'RETURN', 'CLOSE')),
  note        text CHECK (note IS NULL OR char_length(note) <= 400),
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_qlt_claim_logs ON public.qlt_claim_logs (claim_id, id);
COMMENT ON TABLE public.qlt_claim_logs IS 'v10.496 (D271) 클레임 기록 — 접수 · 고침 · 상태 · 공급사 반품 · 끝냄 · 쌓기만';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_qlt_claim_logs_ro' AND tgrelid = 'public.qlt_claim_logs'::regclass) THEN
    CREATE TRIGGER trg_qlt_claim_logs_ro BEFORE UPDATE OR DELETE ON public.qlt_claim_logs FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* ── ④ 설정 · 정기 작업 ── */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('qlt.expiry_alert', 'on', 'ADMIN', '로트 유통기한 임박 알림(v10.495 · D271) — on 이면 매일 07:20 남은 수량이 있는 로트 중 qlt.expiry_days 안에 끝나는 것 · 지난 것을 운영 알림(QLT_LOT_EXPIRY)', false, '^(on|off)$', 'on'),
  ('qlt.expiry_days', '30', 'ADMIN', '로트 유통기한 임박 기준(일 · 1 ~ 180 · 처음 30 · v10.495)', false, '^([1-9]|[1-9][0-9]|1[0-7][0-9]|180)$', '30'),
  ('qlt.po_lead_days', '7', 'ADMIN', '납기일을 넣지 않은 국내 발주의 납기(발주일 + 일 · 1 ~ 90 · 처음 7 · v10.494 협력사 평가)', false, '^([1-9]|[1-8][0-9]|90)$', '7'),
  ('qlt.eval_weights', '30,40,15,15', 'ADMIN', '협력사 평가 가중치(납기,품질,가격,대응 · 합 100 · 처음 30,40,15,15 · v10.494)', false, '^[0-9]{1,3},[0-9]{1,3},[0-9]{1,3},[0-9]{1,3}$', '30,40,15,15'),
  ('qlt.eval_grades', '90,80,70', 'ADMIN', '협력사 평가 등급 기준(A,B,C 이상 점수 · 나머지 D · 처음 90,80,70 · v10.494)', false, '^[0-9]{1,3},[0-9]{1,3},[0-9]{1,3}$', '90,80,70'),
  ('qlt.repeat_count', '3', 'ADMIN', '품질 클레임 재발 알림 기준(같은 상품 · 같은 불량 90일 안 건수 · 2 ~ 10 · 처음 3 · v10.496)', false, '^([2-9]|10)$', '3')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('qlt_lot_alloc', 60, NULL, NULL, NULL, true, '재고 로트 붙이기 — 로트 관리 상품의 판매 출고(배송 뒤) · 반입 · 줄이는 실사에 로트(지정 → FEFO) · 모자라면 QLT_LOT_SHORT · D271 · v10.495'),
  ('qlt_daily', 1440, 7, 20, NULL, true, '품질 하루 점검 — 로트 유통기한 임박 · 지남(QLT_LOT_EXPIRY · qlt.expiry_alert on 일 때) · 클레임 재발(QLT_CLAIM_REPEAT) · D271 · v10.495 · 496')
ON CONFLICT (job) DO NOTHING;

/* ── ⑤ ㉕ 권한 시드(D258 모양 · gen_seed.py 와 같은 규칙) — 소개몰 묶음 · ADMIN · PAYOUT 은 네 단계 모두 · 세무사는 없음(qlt- 앞머리) ── */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('qlt-lots', '로트 · 유통기한', 'admhlt', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 994),
  ('qlt-claims', '품질 클레임', 'admhlt', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 995),
  ('qlt-supeval', '협력사 평가', 'admhlt', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 996)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'qlt-lots', 'VIEW'), ('R_ADMIN', 'qlt-lots', 'EDIT'), ('R_ADMIN', 'qlt-lots', 'APPROVE'), ('R_ADMIN', 'qlt-lots', 'EXPORT'),
  ('R_ADMIN', 'qlt-claims', 'VIEW'), ('R_ADMIN', 'qlt-claims', 'EDIT'), ('R_ADMIN', 'qlt-claims', 'APPROVE'), ('R_ADMIN', 'qlt-claims', 'EXPORT'),
  ('R_ADMIN', 'qlt-supeval', 'VIEW'), ('R_ADMIN', 'qlt-supeval', 'EDIT'), ('R_ADMIN', 'qlt-supeval', 'APPROVE'), ('R_ADMIN', 'qlt-supeval', 'EXPORT'),
  ('R_PAYOUT', 'qlt-lots', 'VIEW'), ('R_PAYOUT', 'qlt-lots', 'EDIT'), ('R_PAYOUT', 'qlt-lots', 'APPROVE'), ('R_PAYOUT', 'qlt-lots', 'EXPORT'),
  ('R_PAYOUT', 'qlt-claims', 'VIEW'), ('R_PAYOUT', 'qlt-claims', 'EDIT'), ('R_PAYOUT', 'qlt-claims', 'APPROVE'), ('R_PAYOUT', 'qlt-claims', 'EXPORT'),
  ('R_PAYOUT', 'qlt-supeval', 'VIEW'), ('R_PAYOUT', 'qlt-supeval', 'EDIT'), ('R_PAYOUT', 'qlt-supeval', 'APPROVE'), ('R_PAYOUT', 'qlt-supeval', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/qlt/claims', 'qlt-claims', 'VIEW'),
  ('GET', '/admin/qlt/claims/stats', 'qlt-claims', 'VIEW'),
  ('GET', '/admin/qlt/claims/{id}', 'qlt-claims', 'VIEW'),
  ('GET', '/admin/qlt/lots', 'qlt-lots', 'VIEW'),
  ('GET', '/admin/qlt/lots/{id}', 'qlt-lots', 'VIEW'),
  ('GET', '/admin/qlt/lots/{id}/trace', 'qlt-lots', 'VIEW'),
  ('GET', '/admin/qlt/ship-queue', 'qlt-lots', 'VIEW'),
  ('GET', '/admin/qlt/suppliers', 'qlt-supeval', 'VIEW'),
  ('GET', '/admin/qlt/suppliers/{id}', 'qlt-supeval', 'VIEW'),
  ('POST', '/admin/qlt/claims', 'qlt-claims', 'EDIT'),
  ('POST', '/admin/qlt/claims/{id}/close', 'qlt-claims', 'APPROVE'),
  ('POST', '/admin/qlt/claims/{id}/supplier-return', 'qlt-claims', 'EDIT'),
  ('POST', '/admin/qlt/lots', 'qlt-lots', 'EDIT'),
  ('POST', '/admin/qlt/lots/{id}/adjust', 'qlt-lots', 'EDIT'),
  ('POST', '/admin/qlt/lots/{id}/state', 'qlt-lots', 'EDIT'),
  ('POST', '/admin/qlt/picks', 'qlt-lots', 'EDIT'),
  ('POST', '/admin/qlt/suppliers/evals', 'qlt-supeval', 'EDIT'),
  ('POST', '/admin/qlt/suppliers/evals/{id}/confirm', 'qlt-supeval', 'APPROVE'),
  ('PUT', '/admin/qlt/claims/{id}', 'qlt-claims', 'EDIT'),
  ('PUT', '/admin/qlt/lot-products/{id}', 'qlt-lots', 'EDIT'),
  ('PUT', '/admin/qlt/pos/{id}/due', 'qlt-supeval', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

