-- =====================================================================
-- D002 — 소개뱅크몰(건강관) 서버 기능 (2026-10-02)
--
--   1. 취소·반품 시 재고 되돌리기 — 주문이 CANCELED/RETURNED 가 되는 순간
--      품목 수량을 hlt_products.stock 에 **한 번만** 돌려놓습니다(restocked_at).
--      취소·반품된 주문은 다른 상태로 되돌릴 수 없습니다(재고가 두 번 움직이지 않게).
--   2. 청약철회 판정 — fn_hlt_return_judge 하나가 판정하고, 앱(requestReturn)과
--      트리거(fn_hlt_return_guard)가 같은 함수를 부릅니다. 두 곳이 갈라지지 않습니다.
--        · 취소(CANCEL) : 발송 전(PENDING·PAID·PREPARING)만
--        · 반품·교환    : 발송 후(SHIPPED·DELIVERED)만.
--                         단순 변심 = 받은 날부터 withdrawal_rules.days 일 (17조 1항, 초일 불산입)
--                         표시·광고와 다름·하자 = 받은 날부터 3개월 (17조 3항)
--                         아직 받지 않았으면(배송 완료 전) 기간이 시작되지 않았습니다 — 받습니다.
--   3. 배송지 — 지난 주문이 가리키는 배송지는 소프트 삭제(deleted_at), 기본 배송지는 계정당 하나.
--   4. 성분–상품 연결 · 고민 표 — hlt_product_ingredients · hlt_concerns · hlt_concern_ingredients.
--      시드는 사이트 util.ts 의 CONCERNS(7개)와 상품명·별칭 매칭 결과를 한 번 옮긴 것입니다.
--
--   재실행 안전: IF NOT EXISTS · CREATE OR REPLACE · ON CONFLICT DO NOTHING.
-- =====================================================================

/* ── 1. 재고 되돌리기 ──────────────────────────────────────────────── */

ALTER TABLE hlt_orders ADD COLUMN IF NOT EXISTS restocked_at timestamptz;
COMMENT ON COLUMN hlt_orders.restocked_at IS
  '취소·반품으로 재고를 되돌린 시각 — 값이 있으면 다시 되돌리지 않습니다 (D002)';

CREATE OR REPLACE FUNCTION fn_hlt_order_restock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  /* 한 번 적힌 되돌림 시각은 지우거나 바꿀 수 없습니다 */
  IF OLD.restocked_at IS NOT NULL THEN
    NEW.restocked_at := OLD.restocked_at;
  END IF;

  /* 취소·반품은 끝 상태입니다. 되살리면 재고를 다시 빼야 하는데 그 경로가 없습니다 */
  IF OLD.status IN ('CANCELED','RETURNED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'HLTO: 취소·반품된 주문은 상태를 바꿀 수 없습니다 — 새로 주문해 주십시오 (%)', OLD.order_no;
  END IF;

  IF NEW.status IN ('CANCELED','RETURNED') AND OLD.restocked_at IS NULL THEN
    UPDATE hlt_products p
       SET stock = p.stock + x.q
      FROM (SELECT product_id, sum(qty)::int AS q
              FROM hlt_order_items WHERE order_id = NEW.id
             GROUP BY product_id) x
     WHERE p.id = x.product_id;
    NEW.restocked_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_hlt_order_restock ON hlt_orders;
CREATE TRIGGER trg_hlt_order_restock BEFORE UPDATE ON hlt_orders
  FOR EACH ROW EXECUTE FUNCTION fn_hlt_order_restock();

/* 결제 → 주문 반영. 끝난 주문(취소·반품)은 건드리지 않습니다.
 * 결제 승인은 결제 대기 주문에만 반영합니다 — 취소된 주문이 늦은 승인으로 되살아나지 않게. */
CREATE OR REPLACE FUNCTION fn_hlt_pay_apply() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'PAID' AND coalesce(OLD.state,'') <> 'PAID' THEN
    UPDATE hlt_orders
       SET status = 'PAID', paid_at = coalesce(NEW.approved_at, now()),
           pay_method = NEW.method
     WHERE id = NEW.order_id AND status = 'PENDING';
  END IF;
  IF NEW.state = 'CANCELED' THEN
    UPDATE hlt_orders SET status = 'CANCELED'
     WHERE id = NEW.order_id AND status NOT IN ('CANCELED','RETURNED');
  END IF;
  RETURN NEW;
END $$;

/* 배송 이벤트 → 주문 반영. 취소·반품된 주문에는 반영하지 않습니다. */
CREATE OR REPLACE FUNCTION fn_hlt_ship_apply() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'DELIVERED' THEN
    UPDATE hlt_orders
       SET status = 'DELIVERED', delivered_at = NEW.happened_at
     WHERE id = NEW.order_id AND delivered_at IS NULL
       AND status NOT IN ('CANCELED','RETURNED');
  ELSIF NEW.state IN ('PICKED','IN_TRANSIT') THEN
    UPDATE hlt_orders
       SET status = 'SHIPPED', shipped_at = coalesce(shipped_at, NEW.happened_at)
     WHERE id = NEW.order_id AND status IN ('PAID','PREPARING');
  END IF;
  RETURN NEW;
END $$;

/* 이미 취소·반품된 주문 — 되돌림 기록이 없으면 지금 한 번 되돌립니다(위 트리거가 처리) */
UPDATE hlt_orders SET status = status
 WHERE status IN ('CANCELED','RETURNED') AND restocked_at IS NULL;

/* ── 2. 청약철회 판정 ──────────────────────────────────────────────── */

/*
 * 판정 하나. ok=false 면 code · message 가 이유입니다. deadline 은 신청 마감 시각(없으면 NULL).
 * 기간 계산은 한국 날짜 기준, 초일 불산입(민법 157조) — 받은 날 + N일의 **자정까지**.
 * 판매자 귀책 사유(하자·오배송·표시와 다름)는 17조 3항으로 3개월.
 * 식품 개봉 여부(blocked_if)는 서버가 알 수 없어 운영이 판정합니다(승인·반려).
 */
CREATE OR REPLACE FUNCTION fn_hlt_return_judge(p_order uuid, p_kind text, p_reason text)
RETURNS TABLE (ok boolean, code text, message text, deadline timestamptz)
LANGUAGE plpgsql STABLE AS $$
DECLARE o record; d int; seller boolean; base date;
BEGIN
  SELECT * INTO o FROM hlt_orders WHERE id = p_order;
  IF o.id IS NULL THEN
    RETURN QUERY SELECT false, 'NOT_FOUND', '없는 주문입니다.', NULL::timestamptz; RETURN;
  END IF;
  IF o.status IN ('CANCELED','RETURNED') THEN
    RETURN QUERY SELECT false, 'HLT_ALREADY_CLOSED', '이미 취소·반품된 주문입니다.', NULL::timestamptz; RETURN;
  END IF;

  IF p_kind = 'CANCEL' THEN
    IF o.status IN ('PENDING','PAID','PREPARING') THEN
      RETURN QUERY SELECT true, 'OK', '발송 전이라 주문 취소로 접수합니다.', NULL::timestamptz;
    ELSE
      RETURN QUERY SELECT false, 'HLT_CANCEL_AFTER_SHIP',
        '이미 발송되어 취소할 수 없습니다. 받으신 뒤 반품으로 신청해 주십시오.', NULL::timestamptz;
    END IF;
    RETURN;
  END IF;

  /* 반품 · 교환 */
  IF o.status IN ('PENDING','PAID','PREPARING') THEN
    RETURN QUERY SELECT false, 'HLT_RETURN_BEFORE_SHIP',
      '아직 발송 전입니다. 주문 취소로 신청해 주십시오.', NULL::timestamptz; RETURN;
  END IF;
  IF o.delivered_at IS NULL THEN
    /* 배송 중 — 청약철회 기간은 받은 날부터 셉니다. 아직 시작되지 않았습니다 */
    RETURN QUERY SELECT true, 'OK', '배송 중입니다 — 받으신 날부터 청약철회 기간이 시작됩니다.', NULL::timestamptz;
    RETURN;
  END IF;

  seller := p_reason IN ('DEFECT','WRONG_ITEM','MISMATCH');
  base := (o.delivered_at AT TIME ZONE 'Asia/Seoul')::date;
  IF seller THEN
    deadline := ((base + interval '3 months')::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul';
  ELSE
    SELECT coalesce(max(w.days), 7) INTO d
      FROM hlt_order_items i JOIN withdrawal_rules w ON w.code = i.withdrawal_code
     WHERE i.order_id = o.id;
    deadline := (base + d + 1)::timestamp AT TIME ZONE 'Asia/Seoul';
  END IF;

  IF now() < deadline THEN
    RETURN QUERY SELECT true, 'OK',
      CASE WHEN seller THEN '상품 하자·표시와 다름은 받으신 날부터 3개월 안에 받습니다(전자상거래법 17조 3항).'
           ELSE format('받으신 날부터 %s일 안이라 이유를 묻지 않습니다(전자상거래법 17조).', d) END,
      deadline;
  ELSIF seller THEN
    RETURN QUERY SELECT false, 'HLT_WITHDRAWAL_EXPIRED',
      '받으신 날부터 3개월이 지나 반품·교환을 받을 수 없습니다(전자상거래법 17조 3항).', deadline;
  ELSE
    RETURN QUERY SELECT false, 'HLT_WITHDRAWAL_EXPIRED',
      format('청약철회 기간(받으신 날부터 %s일)이 지났습니다. 상품이 상했거나 다른 것이 왔거나 표시와 다르면 그 사유로 신청해 주십시오.', d),
      deadline;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_hlt_return_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE j record;
BEGIN
  IF NEW.state = 'REJECTED' AND coalesce(btrim(NEW.decide_note),'') = '' THEN
    RAISE EXCEPTION
      'HLTR: 거절하시려면 이유를 적어야 합니다 — 청약철회는 법이 준 권리라 근거가 필요합니다';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO j FROM fn_hlt_return_judge(NEW.order_id, NEW.kind, NEW.reason);
    IF NOT j.ok THEN
      RAISE EXCEPTION 'HLTR: %', j.message;
    END IF;
  END IF;
  RETURN NEW;
END $$;

/* ── 3. 배송지 ─────────────────────────────────────────────────────── */

ALTER TABLE hlt_addresses ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
COMMENT ON COLUMN hlt_addresses.deleted_at IS
  '지운 배송지 — 지난 주문이 가리키고 있어 행은 남깁니다. 목록·주문에 쓰지 않습니다 (D002)';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hlt_addr_deleted_not_default') THEN
    ALTER TABLE hlt_addresses ADD CONSTRAINT hlt_addr_deleted_not_default
      CHECK (NOT (is_default AND deleted_at IS NOT NULL));
  END IF;
END $$;
/* 기본 배송지는 계정당 하나 — idx_hlt_addr_default 가 이미 있으면 그대로 씁니다 */
CREATE UNIQUE INDEX IF NOT EXISTS idx_hlt_addr_default ON hlt_addresses (account_id) WHERE is_default;

/* ── 4. 성분–상품 · 고민 ──────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS hlt_product_ingredients (
  product_id      uuid NOT NULL REFERENCES hlt_products(id) ON DELETE CASCADE,
  ingredient_code text NOT NULL REFERENCES ingredients(code) ON UPDATE CASCADE,
  amount          text,
  sort            int  NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, ingredient_code)
);
CREATE INDEX IF NOT EXISTS idx_hlt_pi_ing ON hlt_product_ingredients (ingredient_code);
COMMENT ON TABLE hlt_product_ingredients IS
  '상품–성분 연결. amount 는 상품 표시 함량 그대로(예: "1000IU") — D002';

CREATE TABLE IF NOT EXISTS hlt_concerns (
  code       text PRIMARY KEY,
  name       text NOT NULL,
  icon       text,
  sort       int  NOT NULL DEFAULT 0,
  note       text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE hlt_concerns IS
  '고민 축 — 이름은 상태 표현만(질병명 금지). 고민은 "많이 찾는 성분" 묶음입니다 — D002';

CREATE TABLE IF NOT EXISTS hlt_concern_ingredients (
  concern_code    text NOT NULL REFERENCES hlt_concerns(code) ON DELETE CASCADE ON UPDATE CASCADE,
  ingredient_code text NOT NULL REFERENCES ingredients(code) ON UPDATE CASCADE,
  sort            int  NOT NULL DEFAULT 0,
  PRIMARY KEY (concern_code, ingredient_code)
);

/* 고민 이름·설명에 질병명이나 효능 표현을 쓰지 않습니다(건강기능식품 표시·광고 규제). */
CREATE OR REPLACE FUNCTION fn_hlt_concern_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE w text;
BEGIN
  FOREACH w IN ARRAY ARRAY['당뇨','고혈압','불면증','치료','완치','예방','질환','질병','특효','효과']
  LOOP
    IF strpos(NEW.name || ' ' || coalesce(NEW.note,''), w) > 0 THEN
      RAISE EXCEPTION 'HLTK: 고민 이름·설명에 "%" 을(를) 쓸 수 없습니다 — 질병명·효능이 아닌 상태 표현으로 적어 주십시오', w;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hlt_concern ON hlt_concerns;
CREATE TRIGGER trg_hlt_concern BEFORE INSERT OR UPDATE ON hlt_concerns
  FOR EACH ROW EXECUTE FUNCTION fn_hlt_concern_guard();

/* 시드 — 사이트 util.ts CONCERNS 그대로 (성분 코드는 이미 DB 코드) */
INSERT INTO hlt_concerns (code, name, icon, sort) VALUES
  ('IMMUNE',  '면역',             '🛡', 10),
  ('EYE',     '눈',               '👁', 20),
  ('BONE',    '뼈 · 연골 · 관절', '🦴', 30),
  ('GLUCOSE', '혈당',             '📉', 40),
  ('FATIGUE', '피로회복',         '🔋', 50),
  ('BRAIN',   '두뇌',             '🧠', 60),
  ('CIRC',    '혈행',             '🩺', 70)
ON CONFLICT (code) DO NOTHING;

INSERT INTO hlt_concern_ingredients (concern_code, ingredient_code, sort)
SELECT v.c, v.i, v.s
  FROM (VALUES ('IMMUNE','LACTO',1), ('IMMUNE','VIT-D',2),
               ('EYE','OMEGA3',1),
               ('BONE','CA',1), ('BONE','VIT-D',2),
               ('GLUCOSE','LACTO',1),
               ('FATIGUE','GINSENG',1),
               ('BRAIN','OMEGA3',1),
               ('CIRC','OMEGA3',1), ('CIRC','GINSENG',2)) AS v(c, i, s)
 WHERE EXISTS (SELECT 1 FROM ingredients g WHERE g.code = v.i)
ON CONFLICT DO NOTHING;

/* 상품–성분 — 사이트가 하던 매칭을 한 번 옮깁니다:
 * 상품명에 성분명·별칭(2자 이상)이 들어 있는가. 공백·하이픈·가운뎃점·밑줄·대소문자 무시. 부형제 제외. */
INSERT INTO hlt_product_ingredients (product_id, ingredient_code)
SELECT DISTINCT p.id, g.code
  FROM hlt_products p
  CROSS JOIN ingredients g
  CROSS JOIN LATERAL unnest(array_prepend(g.name, coalesce(g.aliases, '{}'::text[]))) AS k(key)
 WHERE NOT g.is_excipient
   AND char_length(lower(regexp_replace(k.key, '[\s\-·_]', '', 'g'))) >= 2
   AND strpos(lower(regexp_replace(p.name, '[\s\-·_]', '', 'g')),
              lower(regexp_replace(k.key, '[\s\-·_]', '', 'g'))) > 0
ON CONFLICT DO NOTHING;
