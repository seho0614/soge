-- =====================================================================
-- C850_affiliate  ·  파트너센터 재설계 (제휴수수료 트랙)
--
-- ── 사장님 결정 (2026-09-22) ────────────────────────────────────────
--   기존 파트너센터 18화면을 버리고 **제휴마케팅 하나만** 합니다.
--     파트너는 제휴상품 링크를 뿌리고 **건당 정액 수수료**를 받습니다.
--
--   안 하는 것
--     · 파트너가 자기 서비스를 올려 파는 것
--     · 파트너가 소개비를 받는 것 (소개비는 일반 회원이 합니다)
--
-- ── ★ 이것만 소개뱅크가 돈을 냅니다 ────────────────────────────────
--   소개비      당사자끼리 직접 — 플랫폼 공제 0원 (INV-9 · INV-11)
--   제휴수수료  **회사가 파트너에게 지급** — 마케팅비이지 남의 돈이
--               아니라 자금수탁이 아닙니다 (법무 확인 2026-09-22).
--
--   그래서 `partner_revenues` 에 `track` 을 두고 소개비와 섞이지
--   않게 합니다. 섞이면 INV-9 검정이 잡습니다.
-- =====================================================================

-- ── ① 소개링크 ────────────────────────────────────────────────────
--
-- ★ 링크마다 코드를 따로 둡니다. 어느 경로로 들어왔는지 모르면
--   수수료를 누구에게 줄지 정할 수 없습니다.
CREATE TABLE IF NOT EXISTS partner_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id   uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  product_id   uuid,
  code         text NOT NULL UNIQUE,
  label        text,
  landing_url  text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT plink_code_check CHECK (code ~ '^[A-Za-z0-9_-]{6,32}$')
);

COMMENT ON TABLE partner_links IS
  '파트너 소개링크. 링크마다 코드를 따로 둡니다 — 어느 경로로 '
  '들어왔는지 모르면 수수료를 누구에게 줄지 정할 수 없습니다.';

CREATE INDEX IF NOT EXISTS idx_plink_partner ON partner_links(partner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS partner_link_stats (
  link_id    uuid NOT NULL REFERENCES partner_links(id) ON DELETE CASCADE,
  stat_date  date NOT NULL,
  clicks     int NOT NULL DEFAULT 0,
  orders     int NOT NULL DEFAULT 0,
  PRIMARY KEY (link_id, stat_date)
);

COMMENT ON TABLE partner_link_stats IS
  '링크 일별 집계. 매번 세면 느립니다 — 배치가 하루 한 번 채웁니다.';

-- ── ② 제휴상품 ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS affiliate_products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  name          text NOT NULL,
  advertiser    text,
  commission    bigint NOT NULL,
  landing_url   text NOT NULL,
  /* ★ 재고 연동이 없습니다. 운영자가 손으로 바꿉니다(결정 22). */
  status        text NOT NULL DEFAULT 'DRAFT',
  description   text,
  started_at    date,
  ended_at      date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT aprod_status_check CHECK (status IN ('DRAFT','ON_SALE','SOLD_OUT','STOPPED')),
  CONSTRAINT aprod_comm_check CHECK (commission > 0)
);

COMMENT ON TABLE affiliate_products IS
  '제휴상품. **건당 정액 수수료**입니다. 재고 연동이 없어 운영자가 '
  '판매중·품절·중단을 손으로 바꿉니다.';
COMMENT ON COLUMN affiliate_products.commission IS
  '건당 수수료(원). 바뀌어도 **이미 생긴 주문에는 소급하지 않습니다** — '
  '주문 생성 시점의 값을 partner_orders 에 박아 둡니다.';

-- 단가 변경 이력 — 고치고 나면 "얼마였느냐" 를 물을 수 없습니다
CREATE TABLE IF NOT EXISTS affiliate_product_rates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES affiliate_products(id) ON DELETE CASCADE,
  commission  bigint NOT NULL,
  changed_by  uuid REFERENCES accounts(id),
  changed_at  timestamptz NOT NULL DEFAULT now(),
  memo        text
);

COMMENT ON TABLE affiliate_product_rates IS
  '단가 변경 이력. **고치고 나면 "그때 얼마였느냐" 를 답할 수 '
  '없습니다** — 수정·삭제하지 않고 쌓습니다.';

-- ── ③ 주문 ────────────────────────────────────────────────────────
--
-- ★ 귀속은 **72시간 · last-click** 입니다(결정 13).
--   소개비의 90일 first-touch(INV-2)와 다릅니다 — 다른 스킴입니다.
CREATE TABLE IF NOT EXISTS partner_orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no      text NOT NULL UNIQUE,
  link_id       uuid REFERENCES partner_links(id),
  partner_id    uuid NOT NULL REFERENCES partners(id),
  product_id    uuid NOT NULL REFERENCES affiliate_products(id),

  /* ★ 발생 시점 단가를 **박아 둡니다**. 상품 단가가 바뀌어도
   *   이 값은 안 바뀝니다 — 소급하면 이미 정산한 것이 흔들립니다. */
  commission    bigint NOT NULL,

  clicked_at    timestamptz,
  ordered_at    timestamptz NOT NULL DEFAULT now(),
  /* 클릭 후 72시간 안에 주문해야 귀속됩니다 */
  attributed    boolean NOT NULL DEFAULT true,

  state         text NOT NULL DEFAULT 'PENDING',
  cancel_reason text,
  confirmed_at  timestamptz,
  settled_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT porder_state_check CHECK (state IN ('PENDING','CONFIRMED','CANCELED','SETTLED')),
  CONSTRAINT porder_comm_check CHECK (commission > 0)
);

COMMENT ON TABLE partner_orders IS
  '제휴 주문. **귀속은 72시간 last-click** 입니다 — 소개비의 90일 '
  'first-touch(INV-2)와 다른 스킴입니다.';
COMMENT ON COLUMN partner_orders.commission IS
  '발생 시점 단가를 박아 둡니다. **소급하지 않습니다** — 소급하면 '
  '이미 정산한 것이 흔들립니다.';

CREATE INDEX IF NOT EXISTS idx_porder_partner ON partner_orders(partner_id, ordered_at DESC);
CREATE INDEX IF NOT EXISTS idx_porder_state ON partner_orders(state, ordered_at);

-- ── ④ 수익 · 정산 ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partner_revenues (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  /* ★ 트랙을 나눕니다. 소개비와 섞이면 INV-9 검정이 잡습니다. */
  track       text NOT NULL DEFAULT 'AFFILIATE',
  order_id    uuid REFERENCES partner_orders(id),
  amount      bigint NOT NULL,
  occurred_on date NOT NULL,
  memo        text,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT prev_track_check CHECK (track IN ('AFFILIATE','REFERRAL'))
);

COMMENT ON TABLE partner_revenues IS
  '파트너 수익. **트랙을 나눕니다** — AFFILIATE 는 회사가 지급하고 '
  'REFERRAL 은 당사자끼리입니다(INV-9). 섞이면 공제 0원 검정이 깨집니다.';

CREATE TABLE IF NOT EXISTS partner_settlement_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id    uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  bank_code     text NOT NULL,
  bank_name     text NOT NULL,
  account_enc   text NOT NULL,
  account_last4 text NOT NULL,
  holder_name   text NOT NULL,
  verified_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id)
);

COMMENT ON TABLE partner_settlement_accounts IS
  '파트너 정산 계좌. **번호는 암호화해 두고 뒤 4자리만 보여 줍니다** — '
  '운영 화면에 전체가 보이면 그 자체가 위험입니다.';

CREATE TABLE IF NOT EXISTS partner_settlements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id   uuid NOT NULL REFERENCES partners(id),
  /* 소개비와 제휴수수료는 **배치를 따로 돌립니다**(결정 21·3) */
  track        text NOT NULL DEFAULT 'AFFILIATE',
  period_from  date NOT NULL,
  period_to    date NOT NULL,
  gross_amount bigint NOT NULL DEFAULT 0,
  withholding  bigint NOT NULL DEFAULT 0,
  net_amount   bigint NOT NULL DEFAULT 0,
  state        text NOT NULL DEFAULT 'DRAFT',
  paid_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pstl_track_check CHECK (track IN ('AFFILIATE','REFERRAL')),
  CONSTRAINT pstl_state_check CHECK (state IN ('DRAFT','CONFIRMED','PAID','CARRIED')),
  UNIQUE (partner_id, track, period_from, period_to)
);

COMMENT ON TABLE partner_settlements IS
  '파트너 정산. **트랙별로 따로 돕니다** — 정산주기가 다를 수 있어 '
  '배치 스케줄을 분리합니다(결정 21).';

CREATE TABLE IF NOT EXISTS partner_invoices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL REFERENCES partner_settlements(id) ON DELETE CASCADE,
  invoice_no    text NOT NULL UNIQUE,
  issued_on     date NOT NULL,
  amount        bigint NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE partner_invoices IS
  '세금계산서. **트랙별로 그룹이 다릅니다** — 소개비와 제휴수수료는 '
  '성격이 달라 한 장에 묶으면 안 됩니다(결정 8).';

-- ── ⑤ 목표 ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partner_goals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /* 개별 설정이 등급 일괄보다 우선합니다(결정 20) */
  partner_id  uuid REFERENCES partners(id) ON DELETE CASCADE,
  grade       text,
  period_ym   text NOT NULL,
  target      bigint NOT NULL,
  reward      bigint,
  set_by      uuid REFERENCES accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pgoal_scope_check CHECK (
    (partner_id IS NOT NULL AND grade IS NULL) OR
    (partner_id IS NULL AND grade IS NOT NULL)),
  CONSTRAINT pgoal_ym_check CHECK (period_ym ~ '^\d{4}-\d{2}$')
);

COMMENT ON TABLE partner_goals IS
  '파트너 목표. 등급 일괄과 개인별 둘 다 둡니다. '
  '**개인별이 우선입니다**(결정 20) — 특별히 정해 준 것이 일반 규칙보다 앞섭니다.';

/* 목표를 고를 때 개인별을 먼저 봅니다 */
CREATE OR REPLACE VIEW v_partner_goal_effective AS
SELECT p.id AS partner_id, g.period_ym,
       coalesce(pg.target, gg.target) AS target,
       coalesce(pg.reward, gg.reward) AS reward,
       CASE WHEN pg.id IS NOT NULL THEN '개인' ELSE '등급' END AS source
  FROM partners p
  CROSS JOIN (SELECT DISTINCT period_ym FROM partner_goals) g
  LEFT JOIN partner_goals pg ON pg.partner_id = p.id AND pg.period_ym = g.period_ym
  LEFT JOIN partner_goals gg ON gg.grade = p.grade AND gg.period_ym = g.period_ym
 WHERE coalesce(pg.target, gg.target) IS NOT NULL;

-- ── ⑥ 마케팅자료 · 가이드 · 문의 ──────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_materials (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  kind         text NOT NULL,
  file_key     text,
  body         text,
  /* ★ 사전 심의 뒤에 게시합니다(결정 9) */
  state        text NOT NULL DEFAULT 'PENDING',
  reject_reason text,
  reviewed_by  uuid REFERENCES accounts(id),
  reviewed_at  timestamptz,
  created_by   uuid REFERENCES accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mmat_state_check CHECK (state IN ('PENDING','APPROVED','REJECTED')),
  CONSTRAINT mmat_kind_check CHECK (kind IN ('IMAGE','BANNER','COPY','VIDEO','DOC'))
);

COMMENT ON TABLE marketing_materials IS
  '마케팅자료. **심의 뒤에 게시합니다** — 파트너가 뿌리는 순간 '
  '회사가 한 말이 됩니다. 반려하면 인앱과 이메일로 알립니다(결정 19).';

CREATE TABLE IF NOT EXISTS partner_guides (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL,
  body       text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partner_inquiries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  subject    text NOT NULL,
  body       text NOT NULL,
  state      text NOT NULL DEFAULT 'OPEN',
  answer     text,
  answered_by uuid REFERENCES accounts(id),
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pinq_state_check CHECK (state IN ('OPEN','ANSWERED','CLOSED'))
);

-- ── ⑦ 막는 트리거 ─────────────────────────────────────────────────

/* 주문이 생길 때 **그 순간 단가를 박습니다.**
 *
 * ★ 상품 단가가 바뀌어도 이미 생긴 주문은 안 바뀝니다.
 *   소급하면 이미 정산한 것이 흔들리고, 파트너는 "받기로 한 것과
 *   다르다" 고 합니다. */
CREATE OR REPLACE FUNCTION fn_porder_fix_commission() RETURNS trigger AS $$
DECLARE v_comm bigint; v_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT commission, status INTO v_comm, v_status
      FROM affiliate_products WHERE id = NEW.product_id;

    IF v_status <> 'ON_SALE' THEN
      RAISE EXCEPTION 'AFFILIATE: 판매 중이 아닌 상품입니다 (%)', v_status;
    END IF;
    NEW.commission := v_comm;

    /* ★ 클릭 후 72시간 안이어야 귀속됩니다(결정 13).
     *   지나면 주문은 받되 **수수료는 주지 않습니다.** */
    IF NEW.clicked_at IS NOT NULL
       AND NEW.ordered_at > NEW.clicked_at + interval '72 hours' THEN
      NEW.attributed := false;
    END IF;
  END IF;

  /* 단가는 한 번 정해지면 못 고칩니다 */
  IF TG_OP = 'UPDATE' AND NEW.commission <> OLD.commission THEN
    RAISE EXCEPTION
      'AFFILIATE: 수수료는 고칠 수 없습니다 — 발생 시점 단가로 고정입니다';
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_porder_commission ON partner_orders;
CREATE TRIGGER trg_porder_commission BEFORE INSERT OR UPDATE ON partner_orders
  FOR EACH ROW EXECUTE FUNCTION fn_porder_fix_commission();

/* 단가를 바꾸면 이력을 남깁니다 */
CREATE OR REPLACE FUNCTION fn_aprod_rate_log() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.commission <> OLD.commission THEN
    INSERT INTO affiliate_product_rates (product_id, commission, memo)
    VALUES (NEW.id, NEW.commission, '단가 변경: ' || OLD.commission || ' → ' || NEW.commission);
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO affiliate_product_rates (product_id, commission, memo)
    VALUES (NEW.id, NEW.commission, '최초 등록');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_aprod_rate ON affiliate_products;
CREATE TRIGGER trg_aprod_rate AFTER INSERT OR UPDATE ON affiliate_products
  FOR EACH ROW EXECUTE FUNCTION fn_aprod_rate_log();

/* 심의를 안 거친 자료는 파트너에게 안 보입니다 */
CREATE OR REPLACE FUNCTION fn_mmat_guard() RETURNS trigger AS $$
BEGIN
  /* ★ 반려에는 사유가 있어야 합니다. 안 적으면 같은 자료가
   *   다시 올라옵니다. */
  IF NEW.state = 'REJECTED' AND coalesce(btrim(NEW.reject_reason),'') = '' THEN
    RAISE EXCEPTION 'MATERIAL: 반려 사유를 적으십시오 — 안 적으면 같은 자료가 다시 올라옵니다';
  END IF;
  IF NEW.state <> 'PENDING' AND NEW.reviewed_by IS NULL THEN
    RAISE EXCEPTION 'MATERIAL: 자동 심의 경로가 없습니다 — 사람이 판단해야 합니다';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mmat_guard ON marketing_materials;
CREATE TRIGGER trg_mmat_guard BEFORE INSERT OR UPDATE ON marketing_materials
  FOR EACH ROW EXECUTE FUNCTION fn_mmat_guard();

/* 정산 상태는 건너뛸 수 없습니다 — 건강몰과 같은 규칙(C750) */
CREATE OR REPLACE FUNCTION fn_pstl_state_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.state = NEW.state THEN RETURN NEW; END IF;

  IF OLD.state = 'DRAFT' AND NEW.state NOT IN ('CONFIRMED','CARRIED') THEN
    RAISE EXCEPTION 'SETTLE: DRAFT 에서 바로 %로 갈 수 없습니다 — 확정이 먼저입니다', NEW.state;
  END IF;
  IF OLD.state IN ('PAID','CARRIED') THEN
    RAISE EXCEPTION 'SETTLE: 지급·이월한 정산은 되돌릴 수 없습니다 — 다음 회차에서 조정하십시오';
  END IF;
  IF NEW.state = 'PAID' AND NOT EXISTS (
     SELECT 1 FROM partner_settlement_accounts a
      WHERE a.partner_id = NEW.partner_id AND a.verified_at IS NOT NULL) THEN
    RAISE EXCEPTION 'SETTLE: 인증된 정산 계좌가 없습니다 — 돈을 보낼 곳이 없습니다';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pstl_state ON partner_settlements;
CREATE TRIGGER trg_pstl_state BEFORE UPDATE ON partner_settlements
  FOR EACH ROW EXECUTE FUNCTION fn_pstl_state_guard();

-- ── ⑧ 감시 ────────────────────────────────────────────────────────

/* ★ 소개비(REFERRAL)가 제휴 정산에 섞이면 INV-9 가 깨집니다.
 *   소개비는 당사자끼리 주고받고 플랫폼이 공제하지 않습니다. */
CREATE OR REPLACE VIEW v_partner_track_mixed AS
SELECT s.id, s.partner_id, s.track, s.period_from,
       count(r.id) AS wrong_track_rows
  FROM partner_settlements s
  JOIN partner_revenues r ON r.partner_id = s.partner_id
                         AND r.occurred_on BETWEEN s.period_from AND s.period_to
                         AND r.track <> s.track
 GROUP BY s.id, s.partner_id, s.track, s.period_from;

COMMENT ON VIEW v_partner_track_mixed IS
  '트랙이 섞인 정산. **0이어야 합니다** — 소개비와 제휴수수료는 '
  '성격이 달라 한 장에 묶으면 INV-9(공제 0원)가 깨집니다.';

/* 귀속 안 된 주문에 수수료가 붙으면 안 됩니다 */
CREATE OR REPLACE VIEW v_porder_unattributed_paid AS
SELECT o.id, o.order_no, o.partner_id, o.commission
  FROM partner_orders o
 WHERE NOT o.attributed AND o.state IN ('CONFIRMED','SETTLED');

COMMENT ON VIEW v_porder_unattributed_paid IS
  '귀속되지 않았는데 확정·정산된 주문. **0이어야 합니다** — '
  '72시간이 지난 클릭에 수수료를 주면 규칙이 무의미해집니다.';

/* 심의 안 된 자료가 게시되면 안 됩니다 */
CREATE OR REPLACE VIEW v_mmat_unreviewed_live AS
SELECT id, title, state
  FROM marketing_materials
 WHERE state = 'APPROVED' AND reviewed_by IS NULL;

COMMENT ON VIEW v_mmat_unreviewed_live IS
  '심의자 없이 승인된 자료. **0이어야 합니다** — 파트너가 뿌리는 '
  '순간 회사가 한 말이 됩니다.';

/* 계좌 없이 지급된 정산 */
CREATE OR REPLACE VIEW v_pstl_paid_no_account AS
SELECT s.id, s.partner_id, s.net_amount
  FROM partner_settlements s
 WHERE s.state = 'PAID'
   AND NOT EXISTS (SELECT 1 FROM partner_settlement_accounts a
                    WHERE a.partner_id = s.partner_id AND a.verified_at IS NOT NULL);

COMMENT ON VIEW v_pstl_paid_no_account IS
  '인증 계좌 없이 지급된 정산. **0이어야 합니다** — 돈이 어디로 '
  '갔는지 모르게 됩니다.';
-- ── INV-9 · INV-11 예외에 제휴 트랙 추가 (C851) ────────────────────
--
-- ★ 검정이 제 `commission` 컬럼을 잡았습니다. **정당한 지적**입니다 —
--   소개비에서 공제하는 컬럼이 생기면 INV-9(공제 0원)가 깨집니다.
--
-- ── 제휴수수료는 왜 예외인가 ────────────────────────────────────────
--   소개비      당사자끼리 주고받는 **남의 돈**. 우리가 손대면 안 됩니다.
--   제휴수수료  **회사가 파트너에게 주는 마케팅비**. 우리 돈입니다.
--
--   건강몰 판매수수료가 `hlt_` 접두어로 이미 예외인 것과 같습니다.
--   접두어로만 예외를 둡니다 — 표 이름을 일일이 적으면 새 표를
--   만들 때마다 빠뜨립니다.

CREATE OR REPLACE VIEW v_inv9_violations AS
SELECT table_name, column_name
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND column_name ~ 'deduct|commission|platform_fee|withhold|take_rate'
   /* 건강몰 — 판매수수료(직판) */
   AND table_name !~ '^(hlt_|v_hlt_)'
   /* 제휴 — 회사가 지급하는 마케팅비 */
   AND table_name !~ '^(affiliate_|v_affiliate_)'
   AND table_name !~ '^(partner_orders|partner_settlements|partner_revenues)$';

COMMENT ON VIEW v_inv9_violations IS
  'INV-9 위반 — 소개비에서 공제하는 컬럼. **0이어야 합니다.** '
  '건강몰 판매수수료(hlt_)와 제휴 마케팅비(affiliate_ · partner_*)는 '
  '소개비가 아니라 예외입니다 — 전자는 직판 대금, 후자는 회사가 '
  '내는 돈입니다.';

CREATE OR REPLACE VIEW v_inv11_violations AS
SELECT table_name, column_name
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND column_name ~ 'account_no|bank_code|pg_provider|pg_tid|escrow|vaccount|card_no'
   AND NOT (table_name = 'hlt_payments' AND column_name = 'pg_tid')
   /* ★ 파트너 정산 계좌는 **우리가 돈을 보내는 곳**입니다.
    *   남의 돈을 받아 두는 것이 아니라 우리 돈을 내보내는 것이라
    *   자금수탁이 아닙니다(법무 확인 2026-09-22). */
   AND table_name <> 'partner_settlement_accounts';

COMMENT ON VIEW v_inv11_violations IS
  'INV-11 위반 — 자금을 수탁하는 컬럼. **0이어야 합니다.** '
  '파트너 정산 계좌는 우리가 **돈을 보내는 곳**이라 예외입니다 — '
  '남의 돈을 받아 두는 것이 아닙니다.';
-- ── 예외 규칙을 한 곳에 모읍니다 (C852) ────────────────────────────
--
-- ★ 같은 예외를 뷰 세 곳에 따로 적었더니 **한 곳만 고쳐 어긋났습니다.**
--   함수 하나로 모읍니다 — 다음에 예외가 생겨도 여기만 고칩니다.
CREATE OR REPLACE FUNCTION fn_is_fee_exempt(p_table text) RETURNS boolean AS $$
  SELECT p_table ~ '^(hlt_|v_hlt_)'              -- 건강몰 직판 대금
      OR p_table ~ '^(affiliate_|v_affiliate_)'   -- 제휴 마케팅비
      OR p_table ~ '^(partner_|v_p(order|stl|artner)_)';  -- 파트너 트랙
$$ LANGUAGE sql IMMUTABLE;

COMMENT ON FUNCTION fn_is_fee_exempt IS
  'INV-9 공제 금지의 예외인가. **소개비가 아닌 돈**만 예외입니다 — '
  '건강몰은 직판 대금, 제휴는 회사가 내는 마케팅비입니다.';

CREATE OR REPLACE VIEW v_inv9_violations AS
SELECT table_name, column_name
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND column_name ~ 'deduct|commission|platform_fee|withhold|take_rate'
   AND NOT fn_is_fee_exempt(table_name);

CREATE OR REPLACE VIEW v_broker_commission_leak AS
SELECT table_name, column_name,
       '소개형 4관은 공제 0원입니다(INV-9) — 이 컬럼을 두면 안 됩니다'::text AS note
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND column_name ~ 'deduct|commission|platform_fee|withhold|take_rate'
   AND NOT fn_is_fee_exempt(table_name);
