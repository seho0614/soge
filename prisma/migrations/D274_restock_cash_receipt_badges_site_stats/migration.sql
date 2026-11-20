/* D274 (v10.505 ~ 508 · docs/643 ~ 646) ㊹ 소개몰 · 광장 · 통계 — 재입고 알림 · 현금영수증(간주 · off) · 소개광장 활동 배지 · 랭킹 · 회원 화면 사용 통계 */

-- =====================================================================
-- D274_restock_cash_receipt_badges_site_stats (#312 · v10.505 ~ 508 · docs/643 ~ 646)
--   대표 11/20 「㊹ 소개몰 · 광장 · 통계」 — 다시 돌려도 같음(IF NOT EXISTS · ON CONFLICT DO NOTHING · CREATE OR REPLACE · 트리거는 있는지 보고)
--   ① 재입고 알림(v10.505)   hlt_restock_subs · 옵션 재고 0 → 양수(또는 다시 켬)에 DB 트리거가 회원 알림 HLT_RESTOCK 을 한 번 · 수신 설정 따름(fn_notify)
--   ② 현금영수증(v10.506)    hlt_cash_receipts · 직판 · 계좌이체 · 가상계좌 결제 · 소득공제(휴대폰) / 지출증빙(사업자번호) · 번호는 암호화 · 취소 · 반품이면 취소 대기
--                            · 처음 꺼짐(mall.cash_receipt off) · 간주(mall.cash_receipt_mode ASSUME) · 세무사 · PG 확인
--   ③ 소개광장 활동 배지 · 랭킹(v10.507) plz_helpful_votes · plz_rank_prefs · plz_month_scores · plz_badges · plz_month_closes
--                            · 글 · 답변 · 도움됨 점수(숨김 · 신고된 글 · 댓글 빼고) · 회원이 랭킹 노출 끄기 · 처음 꺼짐(plaza.ranking off)
--   ④ 회원 화면 사용 통계(v10.508) site_usage_daily · site_usage_goals · 하루 · 화면 주소 묶음만(계정 · IP · 브라우저 정보 없음) · 처음 꺼짐(site.usage_stats off)
--   ⑤ 알림 종류 · 템플릿 · 설정 · 정기 작업 · 권한(D258) 시드
--   RAISE 글자에 퍼센트 기호 없음 · 트리거 이름 고유(trg_hlt_restock_* · trg_hlt_cr_* · trg_plz_* · trg_site_usage_*)
-- =====================================================================

/* ── ① 재입고 알림 (v10.505 · docs/643) ─────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.hlt_restock_subs (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  option_id   uuid NOT NULL REFERENCES public.hlt_product_options(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES public.hlt_products(id) ON DELETE CASCADE,
  state       text NOT NULL DEFAULT 'WAITING' CHECK (state IN ('WAITING', 'NOTIFIED', 'CANCELED', 'EXPIRED')),
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  closed_at   timestamptz,
  CONSTRAINT ck_hlt_restock_closed CHECK ((state = 'WAITING') = (closed_at IS NULL AND notified_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_hlt_restock_waiting ON public.hlt_restock_subs (account_id, option_id) WHERE state = 'WAITING';
CREATE INDEX IF NOT EXISTS idx_hlt_restock_option ON public.hlt_restock_subs (option_id) WHERE state = 'WAITING';
CREATE INDEX IF NOT EXISTS idx_hlt_restock_account ON public.hlt_restock_subs (account_id, id DESC);
COMMENT ON TABLE public.hlt_restock_subs IS
  'v10.505 (D274) 소개몰 재입고 알림 신청 — 품절 옵션마다 회원 한 줄(기다림 하나) · 재고가 0 → 양수가 되면 DB 트리거가 HLT_RESTOCK 알림 한 번 · 기다림 기한 mall.restock_keep_days';

/* 신청 지킴 — 새 줄은 기다림 · 상품은 옵션의 상품 · 한 회원 기다림 mall.restock_max 개까지 · 닫힌 줄은 다시 열지 않음 */
CREATE OR REPLACE FUNCTION public.fn_hlt_restock_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_pid uuid; v_n integer; v_max integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HLT_RESTOCK_KEEP: 재입고 알림 신청은 지우지 않습니다(취소 · 기한 지남으로 닫음).';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'WAITING' THEN RAISE EXCEPTION 'HLT_RESTOCK_STATE: 새 재입고 알림 신청은 기다림으로 넣습니다.'; END IF;
    SELECT o.product_id INTO v_pid FROM public.hlt_product_options o WHERE o.id = NEW.option_id;
    IF v_pid IS NULL OR v_pid <> NEW.product_id THEN RAISE EXCEPTION 'HLT_RESTOCK_OPTION: 옵션과 상품이 맞지 않습니다.'; END IF;
    v_max := public.fn_hlt_setting_num('mall.restock_max', 30)::integer;
    SELECT count(*) INTO v_n FROM public.hlt_restock_subs s WHERE s.account_id = NEW.account_id AND s.state = 'WAITING';
    IF v_n >= v_max THEN RAISE EXCEPTION 'HLT_RESTOCK_MAX: 재입고 알림은 한 번에 정해진 개수까지만 기다릴 수 있습니다 — 다른 신청을 취소해 주십시오.'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.state <> 'WAITING' THEN RAISE EXCEPTION 'HLT_RESTOCK_CLOSED: 닫힌 재입고 알림 신청은 바꾸지 않습니다.'; END IF;
  IF NEW.account_id <> OLD.account_id OR NEW.option_id <> OLD.option_id OR NEW.product_id <> OLD.product_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'HLT_RESTOCK_FIXED: 재입고 알림 신청의 회원 · 옵션 · 신청 시각은 바꾸지 않습니다.';
  END IF;
  RETURN NEW;
END $$;

/* 재고가 0 → 양수(또는 꺼진 옵션을 재고 있게 다시 켬) — 기다리는 회원에게 한 번 알림 · 상품이 판매 중 · 품절 표시일 때만 · 스위치 mall.restock_alert on 일 때만
 *   fn_notify 가 수신 설정(HLT_RESTOCK 을 끈 회원)을 봄 — 끈 회원도 신청은 「알림 보냄」으로 닫힘(한 번만) */
CREATE OR REPLACE FUNCTION public.fn_hlt_restock_fire() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p record; r record; v_label text; v_n integer := 0;
BEGIN
  IF NOT (NEW.is_active AND NEW.stock > 0 AND (OLD.stock <= 0 OR NOT OLD.is_active)) THEN RETURN NULL; END IF;
  IF NOT public.fn_hlt_setting_on('mall.restock_alert') THEN RETURN NULL; END IF;
  SELECT pr.id, pr.code, pr.name, pr.status INTO p FROM public.hlt_products pr WHERE pr.id = NEW.product_id;
  IF p.id IS NULL OR p.status NOT IN ('ON_SALE', 'SOLD_OUT') THEN RETURN NULL; END IF;
  v_label := public.fn_hlt_option_label(NEW.months, NEW.tag);
  FOR r IN UPDATE public.hlt_restock_subs s SET state = 'NOTIFIED', notified_at = clock_timestamp()
            WHERE s.option_id = NEW.id AND s.state = 'WAITING' AND s.expires_at > now()
        RETURNING s.account_id LOOP
    PERFORM public.fn_notify(r.account_id, 'HLT_RESTOCK', jsonb_build_object('product', p.name, 'option', v_label), '/health/p/' || p.code);
    v_n := v_n + 1;
  END LOOP;
  RETURN NULL;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hlt_restock_guard' AND tgrelid = 'public.hlt_restock_subs'::regclass) THEN
    CREATE TRIGGER trg_hlt_restock_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hlt_restock_subs FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_restock_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hlt_restock_fire' AND tgrelid = 'public.hlt_product_options'::regclass) THEN
    CREATE TRIGGER trg_hlt_restock_fire AFTER UPDATE OF stock, is_active ON public.hlt_product_options FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_restock_fire();
  END IF;
END $$;

/* 따라잡기 — 스위치를 켜기 전에 이미 재고가 돌아온 옵션의 기다림(재고 있음 · 켠 옵션 · 판매 중)에 알림 · 운영 「지금 보내기」 · 매일 정기 작업 */
CREATE OR REPLACE FUNCTION public.fn_hlt_restock_catchup() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE r record; v_n integer := 0;
BEGIN
  IF NOT public.fn_hlt_setting_on('mall.restock_alert') THEN RETURN 0; END IF;
  FOR r IN UPDATE public.hlt_restock_subs s SET state = 'NOTIFIED', notified_at = clock_timestamp()
             FROM public.hlt_product_options o JOIN public.hlt_products p ON p.id = o.product_id
            WHERE o.id = s.option_id AND s.state = 'WAITING' AND s.expires_at > now() AND o.is_active AND o.stock > 0 AND p.status IN ('ON_SALE', 'SOLD_OUT')
        RETURNING s.account_id, p.code, p.name, public.fn_hlt_option_label(o.months, o.tag) AS label LOOP
    PERFORM public.fn_notify(r.account_id, 'HLT_RESTOCK', jsonb_build_object('product', r.name, 'option', r.label), '/health/p/' || r.code);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;


/* ── ② 현금영수증 (v10.506 · docs/644) ───────────────────────────────
 *   대상: 직판(DIRECT) 주문 · 결제 수단 계좌이체(TRANSFER) · 가상계좌(VBANK) — 카드 결제는 카드 전표가 증빙이라 빠짐
 *   용도: INCOME 소득공제(휴대폰 번호) · EXPENSE 지출증빙(사업자등록번호) · SELF 자진발급(국세청 지정 번호 010-000-1234 · mall.cash_receipt_self)
 *   번호는 암호화(pgp_sym_encrypt · fn_enc_key) · 화면 · 응답은 가린 값(id_mask)만 · 보관 mall.cash_receipt_keep_years 뒤 정기 작업이 번호를 지움
 *   흐름: REQUESTED(결제 전 신청) → PENDING(결제 승인 · DB 트리거) → ISSUED(실제) · ASSUMED(간주) · FAILED(다시) → 취소 · 반품이면 CANCEL_PENDING → CANCELED
 *         결제 전 닫힌 주문 · 카드 결제 · 직판 아님 → SKIPPED · 발급은 정기 작업 mall_cash_receipt(10분 · 스위치 on 일 때) */
CREATE TABLE IF NOT EXISTS public.hlt_cash_receipts (
  id           bigserial PRIMARY KEY,
  order_id     uuid NOT NULL REFERENCES public.hlt_orders(id),
  payment_id   uuid REFERENCES public.hlt_payments(id),
  account_id   uuid REFERENCES public.accounts(id),
  purpose      text NOT NULL CHECK (purpose IN ('INCOME', 'EXPENSE')),
  id_kind      text NOT NULL CHECK (id_kind IN ('PHONE', 'BIZNO', 'SELF')),
  id_enc       bytea,
  id_mask      text NOT NULL CHECK (char_length(id_mask) BETWEEN 4 AND 20),
  amount       bigint CHECK (amount IS NULL OR amount > 0),
  tax_free     bigint NOT NULL DEFAULT 0 CHECK (tax_free >= 0),
  supply       bigint CHECK (supply IS NULL OR supply >= 0),
  vat          bigint CHECK (vat IS NULL OR vat >= 0),
  state        text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED', 'PENDING', 'ISSUED', 'ASSUMED', 'FAILED', 'CANCEL_PENDING', 'CANCELED', 'SKIPPED')),
  source       text NOT NULL DEFAULT 'MEMBER' CHECK (source IN ('MEMBER', 'ADMIN', 'SELF', 'REISSUE')),
  doc_key      text UNIQUE CHECK (doc_key IS NULL OR doc_key ~ '^CR[0-9]{10}$'),
  approval_no  text CHECK (approval_no IS NULL OR approval_no ~ '^[0-9A-Za-z-]{4,40}$'),
  receipt_key  text CHECK (receipt_key IS NULL OR char_length(receipt_key) <= 200),
  adapter      text CHECK (adapter IS NULL OR adapter IN ('assume', 'toss')),
  attempts     integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error   text CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  cancel_reason text CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 200),
  reissue_of   bigint REFERENCES public.hlt_cash_receipts(id),
  issued_at    timestamptz,
  canceled_at  timestamptz,
  id_purged_at timestamptz,
  created_by   uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_hlt_cr_kind CHECK ((purpose = 'INCOME' AND id_kind IN ('PHONE', 'SELF')) OR (purpose = 'EXPENSE' AND id_kind = 'BIZNO')),
  CONSTRAINT ck_hlt_cr_amounts CHECK (amount IS NULL OR (tax_free <= amount AND coalesce(supply, 0) + coalesce(vat, 0) + tax_free = amount))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_hlt_cr_order_live ON public.hlt_cash_receipts (order_id) WHERE state NOT IN ('CANCELED', 'SKIPPED');
CREATE INDEX IF NOT EXISTS idx_hlt_cr_state ON public.hlt_cash_receipts (state, id) WHERE state IN ('PENDING', 'FAILED', 'CANCEL_PENDING');
CREATE INDEX IF NOT EXISTS idx_hlt_cr_issued ON public.hlt_cash_receipts (issued_at) WHERE issued_at IS NOT NULL;
COMMENT ON TABLE public.hlt_cash_receipts IS
  'v10.506 (D274) 소개몰 현금영수증 — 직판 · 계좌이체 · 가상계좌 결제만 · 번호는 암호화(id_enc) · 가린 값(id_mask) · 처음 꺼짐(mall.cash_receipt) · 간주(mall.cash_receipt_mode ASSUME) · 세무사 · PG 확인';
COMMENT ON COLUMN public.hlt_cash_receipts.receipt_key IS '발급 업체(토스페이먼츠 현금영수증 API)가 돌려준 영수증 키 — 취소에 씀 · 간주면 없음';

/* 주문 금액 나눔 — 결제 금액 · 면세 몫(쿠폰 뒤 면세 상품 금액 · 결제 금액까지) · 과세 몫 공급가액 · 부가세(과세 ÷ 11 반올림) */
CREATE OR REPLACE FUNCTION public.fn_hlt_cr_amounts(p_order uuid, OUT o_amount bigint, OUT o_tax_free bigint, OUT o_supply bigint, OUT o_vat bigint)
  LANGUAGE plpgsql STABLE AS $$
DECLARE v_goods bigint; v_disc bigint; v_ex bigint; v_paid bigint; v_tax bigint;
BEGIN
  SELECT o.goods_amount, o.discount_amount, coalesce((SELECT sum(it.amount) FROM public.hlt_order_items it WHERE it.order_id = o.id AND it.tax_type = 'EXEMPT'), 0),
         coalesce((SELECT p.amount - coalesce(p.canceled_amount, 0) FROM public.hlt_payments p WHERE p.order_id = o.id AND p.state IN ('PAID', 'CANCELED') AND p.approved_at IS NOT NULL ORDER BY p.approved_at DESC LIMIT 1), o.total)
    INTO v_goods, v_disc, v_ex, v_paid FROM public.hlt_orders o WHERE o.id = p_order;
  IF v_paid IS NULL OR v_paid <= 0 THEN o_amount := NULL; o_tax_free := 0; o_supply := NULL; o_vat := NULL; RETURN; END IF;
  o_amount := v_paid;
  o_tax_free := least(v_paid, CASE WHEN coalesce(v_goods, 0) > 0 THEN (v_ex * (v_goods - coalesce(v_disc, 0)) / v_goods) ELSE 0 END);
  v_tax := v_paid - o_tax_free;
  o_vat := round(v_tax / 11.0)::bigint;
  o_supply := v_tax - o_vat;
END $$;

/* 신청 · 바꾸기(회원 · 운영) — 서버 입력 검사와 같은 정규식(규칙 2): 휴대폰 ^01[016789][0-9]{7,8}$ · 사업자번호 ^[0-9]{10}$ */
CREATE OR REPLACE FUNCTION public.fn_hlt_cr_request(p_order uuid, p_account uuid, p_purpose text, p_number text, p_admin uuid, p_reason text)
  RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE o record; v_pay record; v_kind text; v_num text; v_mask text; v_days integer; v_id bigint; v_cur record; v_state text;
BEGIN
  SELECT o2.id, o2.account_id, o2.status, s.type AS seller_type INTO o
    FROM public.hlt_orders o2 LEFT JOIN public.hlt_sellers s ON s.id = o2.seller_id WHERE o2.id = p_order FOR UPDATE OF o2;
  IF o.id IS NULL THEN RAISE EXCEPTION 'HLT_CR_ORDER: 없는 주문입니다.'; END IF;
  IF p_admin IS NULL AND o.account_id IS DISTINCT FROM p_account THEN RAISE EXCEPTION 'HLT_CR_ORDER: 없는 주문입니다.'; END IF;
  IF o.seller_type IS DISTINCT FROM 'DIRECT' THEN RAISE EXCEPTION 'HLT_CR_DIRECT_ONLY: 현금영수증은 소개몰 직판 상품 주문만 이곳에서 발급합니다(입점 판매자 상품은 그 판매자가 발급).'; END IF;
  IF o.status IN ('CANCELED', 'RETURNED') THEN RAISE EXCEPTION 'HLT_CR_ORDER_CLOSED: 취소 · 반품된 주문입니다.'; END IF;
  IF p_purpose = 'INCOME' THEN v_kind := 'PHONE'; ELSIF p_purpose = 'EXPENSE' THEN v_kind := 'BIZNO'; ELSE RAISE EXCEPTION 'HLT_CR_PURPOSE: 소득공제 · 지출증빙 가운데 고르십시오.'; END IF;
  v_num := regexp_replace(coalesce(p_number, ''), '[^0-9]', '', 'g');
  IF v_kind = 'PHONE' AND v_num !~ '^01[016789][0-9]{7,8}$' THEN RAISE EXCEPTION 'HLT_CR_NUMBER: 휴대폰 번호를 다시 확인해 주십시오.'; END IF;
  IF v_kind = 'BIZNO' AND v_num !~ '^[0-9]{10}$' THEN RAISE EXCEPTION 'HLT_CR_NUMBER: 사업자등록번호 10자리를 다시 확인해 주십시오.'; END IF;
  v_mask := CASE WHEN v_kind = 'PHONE' THEN left(v_num, 3) || '-****-' || right(v_num, 4) ELSE left(v_num, 3) || '-**-' || right(v_num, 5) END;
  SELECT p.id, p.method, p.state, p.approved_at INTO v_pay FROM public.hlt_payments p
   WHERE p.order_id = o.id AND p.state = 'PAID' ORDER BY p.approved_at DESC NULLS LAST LIMIT 1;
  IF v_pay.id IS NOT NULL THEN
    IF v_pay.method NOT IN ('TRANSFER', 'VBANK') THEN RAISE EXCEPTION 'HLT_CR_CARD: 카드로 결제한 주문은 카드 전표가 증빙이라 현금영수증을 따로 발급하지 않습니다.'; END IF;
    v_days := public.fn_hlt_setting_num('mall.cash_receipt_req_days', 5)::integer;
    IF p_admin IS NULL AND v_pay.approved_at < now() - make_interval(days => v_days) THEN
      RAISE EXCEPTION 'HLT_CR_LATE: 결제한 지 오래되어 화면에서 신청할 수 없습니다 — 고객센터로 문의해 주십시오.';
    END IF;
    v_state := 'PENDING';
  ELSE
    v_state := 'REQUESTED';
  END IF;
  SELECT c.id, c.state INTO v_cur FROM public.hlt_cash_receipts c WHERE c.order_id = o.id AND c.state NOT IN ('CANCELED', 'SKIPPED') FOR UPDATE;
  IF v_cur.id IS NOT NULL AND v_cur.state IN ('ISSUED', 'ASSUMED', 'CANCEL_PENDING') THEN
    RAISE EXCEPTION 'HLT_CR_ISSUED: 이미 발급된 현금영수증이 있습니다 — 바꾸려면 운영이 취소한 뒤 다시 발급합니다.';
  END IF;
  IF v_cur.id IS NOT NULL THEN
    UPDATE public.hlt_cash_receipts SET purpose = p_purpose, id_kind = v_kind, id_enc = pgp_sym_encrypt(v_num, public.fn_enc_key()), id_mask = v_mask,
           state = v_state, payment_id = v_pay.id, source = CASE WHEN p_admin IS NULL THEN 'MEMBER' ELSE 'ADMIN' END, attempts = 0, last_error = NULL,
           created_by = coalesce(p_admin, p_account), updated_at = now()
     WHERE id = v_cur.id RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.hlt_cash_receipts (order_id, payment_id, account_id, purpose, id_kind, id_enc, id_mask, state, source, created_by)
    VALUES (o.id, v_pay.id, o.account_id, p_purpose, v_kind, pgp_sym_encrypt(v_num, public.fn_enc_key()), v_mask, v_state,
            CASE WHEN p_admin IS NULL THEN 'MEMBER' ELSE 'ADMIN' END, coalesce(p_admin, p_account))
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

/* 줄 지킴 — 지우지 않음 · 문서 번호는 처음 한 번 · 발급된 뒤 번호 · 용도 · 금액은 그대로 · 닫힌 줄(CANCELED · SKIPPED)은 바꾸지 않음(번호 지우기만) */
CREATE OR REPLACE FUNCTION public.fn_hlt_cr_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HLT_CR_KEEP: 현금영수증 기록은 지우지 않습니다(국세 기록 보관).'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.doc_key IS NULL THEN NEW.doc_key := 'CR' || lpad(NEW.id::text, 10, '0'); END IF;
    IF NEW.doc_key <> 'CR' || lpad(NEW.id::text, 10, '0') THEN RAISE EXCEPTION 'HLT_CR_DOC: 문서 번호는 줄 번호로 정해집니다.'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.doc_key IS DISTINCT FROM OLD.doc_key OR NEW.order_id <> OLD.order_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'HLT_CR_FIXED: 현금영수증의 주문 · 문서 번호 · 만든 시각은 바꾸지 않습니다.';
  END IF;
  IF OLD.state IN ('CANCELED', 'SKIPPED') THEN
    IF NEW.state = OLD.state AND NEW.id_enc IS NULL AND NEW.id_purged_at IS NOT NULL AND NEW.amount IS NOT DISTINCT FROM OLD.amount THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'HLT_CR_CLOSED: 닫힌 현금영수증은 바꾸지 않습니다.';
  END IF;
  IF OLD.state IN ('ISSUED', 'ASSUMED', 'CANCEL_PENDING') AND (NEW.purpose <> OLD.purpose OR NEW.id_kind <> OLD.id_kind OR NEW.id_mask <> OLD.id_mask
       OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.tax_free <> OLD.tax_free) THEN
    RAISE EXCEPTION 'HLT_CR_ISSUED: 이미 발급된 현금영수증이 있습니다 — 바꾸려면 운영이 취소한 뒤 다시 발급합니다.';
  END IF;
  IF OLD.state IN ('ISSUED', 'ASSUMED') AND NEW.state NOT IN ('ISSUED', 'ASSUMED', 'CANCEL_PENDING') THEN
    RAISE EXCEPTION 'HLT_CR_STATE: 발급된 현금영수증은 취소 대기로만 넘어갑니다.';
  END IF;
  IF OLD.state = 'CANCEL_PENDING' AND NEW.state NOT IN ('CANCEL_PENDING', 'CANCELED') THEN
    RAISE EXCEPTION 'HLT_CR_STATE: 취소 대기 현금영수증은 취소로만 넘어갑니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

/* 결제 승인(PAID) — 그 주문의 신청을 발급 대기로 · 신청이 없고 자진발급이 켜져 있고 기준 금액 이상이면 자진발급 줄 · 카드 결제면 신청을 SKIPPED
 *   결제 취소(CANCELED)는 아래 주문 상태 트리거가 맡음 */
CREATE OR REPLACE FUNCTION public.fn_hlt_cr_on_pay() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record; v_type text; v_acc uuid; v_min bigint;
BEGIN
  IF NEW.state <> 'PAID' THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.state = 'PAID' THEN RETURN NULL; END IF;
  END IF;
  SELECT s.type, o.account_id INTO v_type, v_acc FROM public.hlt_orders o LEFT JOIN public.hlt_sellers s ON s.id = o.seller_id WHERE o.id = NEW.order_id;
  SELECT x.id, x.state INTO c FROM public.hlt_cash_receipts x WHERE x.order_id = NEW.order_id AND x.state NOT IN ('CANCELED', 'SKIPPED') LIMIT 1;
  IF c.id IS NOT NULL THEN
    IF c.state = 'REQUESTED' THEN
      UPDATE public.hlt_cash_receipts SET state = CASE WHEN NEW.method IN ('TRANSFER', 'VBANK') AND v_type = 'DIRECT' THEN 'PENDING' ELSE 'SKIPPED' END,
             payment_id = NEW.id, last_error = CASE WHEN NEW.method IN ('TRANSFER', 'VBANK') AND v_type = 'DIRECT' THEN NULL ELSE '카드 결제 · 직판 아님 — 현금영수증 대상 아님' END
       WHERE id = c.id;
    END IF;
    RETURN NULL;
  END IF;
  IF v_type = 'DIRECT' AND NEW.method IN ('TRANSFER', 'VBANK') AND public.fn_hlt_setting_on('mall.cash_receipt_self') THEN
    v_min := public.fn_hlt_setting_num('mall.cash_receipt_self_min', 100000)::bigint;
    IF NEW.amount >= v_min THEN
      INSERT INTO public.hlt_cash_receipts (order_id, payment_id, account_id, purpose, id_kind, id_enc, id_mask, state, source)
      VALUES (NEW.order_id, NEW.id, v_acc, 'INCOME', 'SELF', pgp_sym_encrypt('0100001234', public.fn_enc_key()), '010-000-1234', 'PENDING', 'SELF')
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NULL;
END $$;

/* 주문이 취소 · 반품으로 — 발급된 것은 취소 대기 · 아직 안 된 것은 SKIPPED */
CREATE OR REPLACE FUNCTION public.fn_hlt_cr_on_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (NEW.status IN ('CANCELED', 'RETURNED') AND OLD.status IS DISTINCT FROM NEW.status) THEN RETURN NULL; END IF;
  UPDATE public.hlt_cash_receipts SET state = 'CANCEL_PENDING', cancel_reason = CASE WHEN NEW.status = 'CANCELED' THEN '주문 취소' ELSE '반품' END
   WHERE order_id = NEW.id AND state IN ('ISSUED', 'ASSUMED');
  UPDATE public.hlt_cash_receipts SET state = 'SKIPPED', last_error = '발급 전 주문 취소 · 반품'
   WHERE order_id = NEW.id AND state IN ('REQUESTED', 'PENDING', 'FAILED');
  RETURN NULL;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hlt_cr_guard' AND tgrelid = 'public.hlt_cash_receipts'::regclass) THEN
    CREATE TRIGGER trg_hlt_cr_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hlt_cash_receipts FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_cr_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hlt_cr_on_pay' AND tgrelid = 'public.hlt_payments'::regclass) THEN
    CREATE TRIGGER trg_hlt_cr_on_pay AFTER INSERT OR UPDATE OF state ON public.hlt_payments FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_cr_on_pay();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hlt_cr_on_order' AND tgrelid = 'public.hlt_orders'::regclass) THEN
    CREATE TRIGGER trg_hlt_cr_on_order AFTER UPDATE OF status ON public.hlt_orders FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_cr_on_order();
  END IF;
END $$;

/* 감시 — 발급(실제 · 간주)된 주문인데 주문이 취소 · 반품이고 영수증이 취소 대기 · 취소가 아님(늘 0) */
CREATE OR REPLACE VIEW public.v_hlt_cr_cancel_missing AS
 SELECT c.id, c.order_id, c.state, o.status AS order_status
   FROM public.hlt_cash_receipts c JOIN public.hlt_orders o ON o.id = c.order_id
  WHERE c.state IN ('ISSUED', 'ASSUMED') AND o.status IN ('CANCELED', 'RETURNED');
COMMENT ON VIEW public.v_hlt_cr_cancel_missing IS 'v10.506 (D274) 취소 · 반품 주문인데 현금영수증이 발급 상태로 남은 줄 — 늘 0';


/* ── ③ 소개광장 활동 배지 · 랭킹 (v10.507 · docs/645) ───────────────── */
CREATE TABLE IF NOT EXISTS public.plz_helpful_votes (
  id          bigserial PRIMARY KEY,
  target_type text NOT NULL CHECK (target_type IN ('POST', 'COMMENT')),
  target_id   uuid NOT NULL,
  voter_id    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_plz_helpful_one UNIQUE (target_type, target_id, voter_id)
);
CREATE INDEX IF NOT EXISTS idx_plz_helpful_target ON public.plz_helpful_votes (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_plz_helpful_author ON public.plz_helpful_votes (author_id, created_at);
COMMENT ON TABLE public.plz_helpful_votes IS 'v10.507 (D274) 소개광장 「도움돼요」 — 글 · 댓글(답변)마다 회원 한 번 · 자기 글 안 됨 · 공개 글만 · 다시 누르면 지움(취소)';

CREATE TABLE IF NOT EXISTS public.plz_rank_prefs (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  hide_rank  boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.plz_rank_prefs IS 'v10.507 (D274) 소개광장 랭킹 노출 — 회원이 끄면(hide_rank) 공개 랭킹에 나오지 않음(점수 · 배지는 본인에게만 보임)';

CREATE TABLE IF NOT EXISTS public.plz_month_scores (
  month       date NOT NULL CHECK (extract(day FROM month) = 1),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  posts       integer NOT NULL DEFAULT 0 CHECK (posts >= 0),
  answers     integer NOT NULL DEFAULT 0 CHECK (answers >= 0),
  comments    integer NOT NULL DEFAULT 0 CHECK (comments >= 0),
  helpful     integer NOT NULL DEFAULT 0 CHECK (helpful >= 0),
  score       integer NOT NULL DEFAULT 0 CHECK (score >= 0),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (month, account_id)
);
CREATE INDEX IF NOT EXISTS idx_plz_scores_rank ON public.plz_month_scores (month, score DESC, helpful DESC);
COMMENT ON TABLE public.plz_month_scores IS 'v10.507 (D274) 소개광장 월간 활동 점수 — 정기 작업 plz_badge_month 가 그 달을 통째로 다시 셈(숨김 · 신고된 글 · 댓글 · 공지 · 운영자 빼고)';

CREATE TABLE IF NOT EXISTS public.plz_badges (
  id          bigserial PRIMARY KEY,
  month       date NOT NULL CHECK (extract(day FROM month) = 1),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  badge       text NOT NULL CHECK (badge IN ('TOP1', 'TOP3', 'TOP10', 'HELPER', 'ANSWERER', 'WRITER')),
  score       integer NOT NULL CHECK (score >= 0),
  awarded_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  revoked_by  uuid REFERENCES public.accounts(id),
  revoke_reason text CHECK (revoke_reason IS NULL OR char_length(revoke_reason) BETWEEN 2 AND 200),
  CONSTRAINT ux_plz_badge_one UNIQUE (month, account_id, badge),
  CONSTRAINT ck_plz_badge_revoke CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);
COMMENT ON TABLE public.plz_badges IS 'v10.507 (D274) 소개광장 월간 배지 — 달이 끝나면 한 번(TOP1 · TOP3 · TOP10 · 도움왕 HELPER · 답변왕 ANSWERER · 글쓴이 WRITER) · 지우지 않고 운영이 사유와 함께 거둠';

CREATE TABLE IF NOT EXISTS public.plz_month_closes (
  month     date PRIMARY KEY CHECK (extract(day FROM month) = 1),
  closed_at timestamptz NOT NULL DEFAULT now(),
  members   integer NOT NULL CHECK (members >= 0),
  badges    integer NOT NULL CHECK (badges >= 0)
);
COMMENT ON TABLE public.plz_month_closes IS 'v10.507 (D274) 소개광장 달 마감 — 배지를 준 달(한 번만 · 쌓기만)';

/* 도움돼요 지킴 — 공개 글 · 댓글만 · 자기 것 안 됨 · 작성자를 적어 둠 · 고치지 않음(지우기 = 취소) */
CREATE OR REPLACE FUNCTION public.fn_plz_helpful_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_author uuid; v_ok boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'PLZ_HELPFUL_FIXED: 도움돼요는 고치지 않습니다(다시 누르면 취소).'; END IF;
  IF NEW.target_type = 'POST' THEN
    SELECT p.author_id, (p.state = 'PUBLISHED' AND p.hidden_at IS NULL AND p.board <> 'NOTICE') INTO v_author, v_ok FROM public.posts p WHERE p.id = NEW.target_id;
  ELSE
    SELECT c.author_id, (c.state = 'PUBLISHED' AND c.hidden_at IS NULL AND p.state = 'PUBLISHED' AND p.hidden_at IS NULL) INTO v_author, v_ok
      FROM public.post_comments c JOIN public.posts p ON p.id = c.post_id WHERE c.id = NEW.target_id;
  END IF;
  IF v_ok IS NULL THEN RAISE EXCEPTION 'PLZ_HELPFUL_TARGET: 없는 글 · 댓글입니다.'; END IF;
  IF NOT v_ok THEN RAISE EXCEPTION 'PLZ_HELPFUL_TARGET: 공개된 글 · 댓글에만 누를 수 있습니다.'; END IF;
  IF v_author IS NOT DISTINCT FROM NEW.voter_id THEN RAISE EXCEPTION 'PLZ_HELPFUL_SELF: 내 글 · 댓글에는 누를 수 없습니다.'; END IF;
  NEW.author_id := v_author;
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_plz_helpful_guard' AND tgrelid = 'public.plz_helpful_votes'::regclass) THEN
    CREATE TRIGGER trg_plz_helpful_guard BEFORE INSERT OR UPDATE ON public.plz_helpful_votes FOR EACH ROW EXECUTE FUNCTION public.fn_plz_helpful_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_plz_month_closes_ro' AND tgrelid = 'public.plz_month_closes'::regclass) THEN
    CREATE TRIGGER trg_plz_month_closes_ro BEFORE UPDATE OR DELETE ON public.plz_month_closes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* 배지 지킴 — 지우지 않음 · 거두기(revoked_*)만 · 거둔 것은 되살리지 않음 */
CREATE OR REPLACE FUNCTION public.fn_plz_badge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PLZ_BADGE_KEEP: 배지는 지우지 않습니다(거두기로).'; END IF;
  IF NEW.month <> OLD.month OR NEW.account_id <> OLD.account_id OR NEW.badge <> OLD.badge OR NEW.score <> OLD.score OR NEW.awarded_at <> OLD.awarded_at THEN
    RAISE EXCEPTION 'PLZ_BADGE_FIXED: 배지의 달 · 회원 · 종류 · 점수는 바꾸지 않습니다.';
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'PLZ_BADGE_REVOKED: 이미 거둔 배지입니다.'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_plz_badge_guard' AND tgrelid = 'public.plz_badges'::regclass) THEN
    CREATE TRIGGER trg_plz_badge_guard BEFORE UPDATE OR DELETE ON public.plz_badges FOR EACH ROW EXECUTE FUNCTION public.fn_plz_badge_guard();
  END IF;
END $$;

/* 셀 수 있는 글 · 댓글 — 공개 · 감추지 않음 · 공지 아님 · 처리 중이거나 받아들여진 신고 없음(기각된 신고만 있으면 셈) · 운영 역할 아님 */
CREATE OR REPLACE FUNCTION public.fn_plz_staff(p_account uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.account_roles r WHERE r.account_id = p_account
                    AND r.role IN ('ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT', 'ACCOUNTANT', 'PARTNER_MAL', 'PARTNER_AFF'))
$$;

/* 그 달 점수 다시 셈 — 한국 시각 달 · 하루 셈 상한(plaza.daily_cap · 글 + 댓글) · 점수 = 글 × score_post + 답변 × score_answer + 댓글 × score_comment + 도움돼요 × score_helpful */
CREATE OR REPLACE FUNCTION public.fn_plz_month_scores(p_month date) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_from timestamptz; v_to timestamptz; v_cap integer; w_post integer; w_ans integer; w_cmt integer; w_help integer; v_n integer;
BEGIN
  IF extract(day FROM p_month) <> 1 THEN RAISE EXCEPTION 'PLZ_MONTH: 달은 1일로 줍니다.'; END IF;
  v_from := (p_month::timestamp AT TIME ZONE 'Asia/Seoul');
  v_to := ((p_month + interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul');
  v_cap := public.fn_hlt_setting_num('plaza.daily_cap', 10)::integer;
  w_post := public.fn_hlt_setting_num('plaza.score_post', 3)::integer;
  w_ans := public.fn_hlt_setting_num('plaza.score_answer', 2)::integer;
  w_cmt := public.fn_hlt_setting_num('plaza.score_comment', 1)::integer;
  w_help := public.fn_hlt_setting_num('plaza.score_helpful', 2)::integer;
  DELETE FROM public.plz_month_scores WHERE month = p_month;
  WITH okp AS (
    SELECT p.id, p.author_id, p.board, p.created_at FROM public.posts p
     WHERE p.state = 'PUBLISHED' AND p.hidden_at IS NULL AND p.board <> 'NOTICE' AND p.author_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.reports r WHERE r.target_type = 'POST' AND r.target_id = p.id AND r.state <> 'DISMISSED')
  ), okc AS (
    SELECT c.id, c.author_id, c.created_at, (p.board = 'QNA' AND c.parent_id IS NULL AND c.author_id IS DISTINCT FROM p.author_id) AS answer
      FROM public.post_comments c JOIN okp p ON p.id = c.post_id
     WHERE c.state = 'PUBLISHED' AND c.hidden_at IS NULL AND c.author_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.reports r WHERE r.target_type = 'COMMENT' AND r.target_id = c.id AND r.state <> 'DISMISSED')
  ), acts AS (
    SELECT author_id, (created_at AT TIME ZONE 'Asia/Seoul')::date AS d, 'P' AS k FROM okp WHERE created_at >= v_from AND created_at < v_to
    UNION ALL
    SELECT author_id, (created_at AT TIME ZONE 'Asia/Seoul')::date, CASE WHEN answer THEN 'A' ELSE 'C' END FROM okc WHERE created_at >= v_from AND created_at < v_to
  ), capped AS (
    SELECT author_id, k, d, row_number() OVER (PARTITION BY author_id, d ORDER BY CASE k WHEN 'P' THEN 1 WHEN 'A' THEN 2 ELSE 3 END) AS rn FROM acts
  ), per AS (
    SELECT author_id,
           count(*) FILTER (WHERE k = 'P' AND rn <= v_cap)::int AS posts,
           count(*) FILTER (WHERE k = 'A' AND rn <= v_cap)::int AS answers,
           count(*) FILTER (WHERE k = 'C' AND rn <= v_cap)::int AS comments
      FROM capped GROUP BY author_id
  ), hv AS (
    SELECT v.author_id, count(*)::int AS helpful
      FROM public.plz_helpful_votes v
     WHERE v.created_at >= v_from AND v.created_at < v_to AND v.author_id IS NOT NULL AND v.voter_id <> v.author_id
       AND ((v.target_type = 'POST' AND v.target_id IN (SELECT id FROM okp)) OR (v.target_type = 'COMMENT' AND v.target_id IN (SELECT id FROM okc)))
     GROUP BY v.author_id
  ), allp AS (
    SELECT coalesce(per.author_id, hv.author_id) AS account_id, coalesce(per.posts, 0) AS posts, coalesce(per.answers, 0) AS answers,
           coalesce(per.comments, 0) AS comments, coalesce(hv.helpful, 0) AS helpful
      FROM per FULL JOIN hv ON hv.author_id = per.author_id
  )
  INSERT INTO public.plz_month_scores (month, account_id, posts, answers, comments, helpful, score)
  SELECT p_month, a.account_id, a.posts, a.answers, a.comments, a.helpful,
         greatest(0, a.posts * w_post + a.answers * w_ans + a.comments * w_cmt + a.helpful * w_help)
    FROM allp a JOIN public.accounts ac ON ac.id = a.account_id
   WHERE NOT public.fn_plz_staff(a.account_id) AND (a.posts + a.answers + a.comments + a.helpful) > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

/* 달 마감 · 배지 — 한 달에 한 번(plz_month_closes) · 순위는 노출을 끈 회원도 포함해 셈 · 회원 알림 PLZ_BADGE(수신 설정 따름) */
CREATE OR REPLACE FUNCTION public.fn_plz_month_close(p_month date) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE r record; v_n integer := 0; v_members integer; v_help integer; v_ans integer; v_post integer; v_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.plz_month_closes WHERE month = p_month) THEN RETURN 0; END IF;
  v_members := public.fn_plz_month_scores(p_month);
  v_help := public.fn_hlt_setting_num('plaza.badge_helpful_min', 10)::integer;
  v_ans := public.fn_hlt_setting_num('plaza.badge_answer_min', 10)::integer;
  v_post := public.fn_hlt_setting_num('plaza.badge_post_min', 10)::integer;
  FOR r IN SELECT s.account_id, s.score, s.helpful, s.answers, s.posts,
                  row_number() OVER (ORDER BY s.score DESC, s.helpful DESC, s.answers DESC, s.account_id) AS rk
             FROM public.plz_month_scores s WHERE s.month = p_month AND s.score > 0 LOOP
    FOR v_name IN SELECT b FROM (VALUES
        (CASE WHEN r.rk = 1 THEN 'TOP1' WHEN r.rk <= 3 THEN 'TOP3' WHEN r.rk <= 10 THEN 'TOP10' END),
        (CASE WHEN r.helpful >= v_help THEN 'HELPER' END),
        (CASE WHEN r.answers >= v_ans THEN 'ANSWERER' END),
        (CASE WHEN r.posts >= v_post THEN 'WRITER' END)) x(b) WHERE b IS NOT NULL LOOP
      INSERT INTO public.plz_badges (month, account_id, badge, score) VALUES (p_month, r.account_id, v_name, r.score) ON CONFLICT DO NOTHING;
      IF FOUND THEN
        v_n := v_n + 1;
        PERFORM public.fn_notify(r.account_id, 'PLZ_BADGE', jsonb_build_object('month', to_char(p_month, 'YYYY-MM'),
                  'badge', CASE v_name WHEN 'TOP1' THEN '이달의 1위' WHEN 'TOP3' THEN '이달의 3위 안' WHEN 'TOP10' THEN '이달의 10위 안'
                                       WHEN 'HELPER' THEN '도움왕' WHEN 'ANSWERER' THEN '답변왕' ELSE '꾸준한 글쓴이' END), '/community/ranking');
      END IF;
    END LOOP;
  END LOOP;
  INSERT INTO public.plz_month_closes (month, members, badges) VALUES (p_month, v_members, v_n);
  RETURN v_n;
END $$;


/* ── ④ 회원 화면 사용 통계 (v10.508 · docs/646) ─────────────────────
 *   하루(한국 날짜) × 화면 주소 묶음(숫자 · 긴 코드 · uuid 는 :id) — 계정 · IP · 브라우저 정보 · 방문자 쿠키 없음
 *   보기 views · 들어온 첫 화면 entries · 둘째 화면으로 이어진 첫 화면 engaged(이탈 = entries − engaged) · 표본 보정 est_views
 *   전환 site_usage_goals — 가입 · 주문 · 글쓰기 · 문의 · 매물 · 요청 완료 화면에 닿은 수(들어온 첫 화면별) */
CREATE TABLE IF NOT EXISTS public.site_usage_daily (
  day       date NOT NULL,
  path      text NOT NULL CHECK (path ~ '^/[A-Za-z0-9/_:.-]{0,119}$'),
  views     integer NOT NULL DEFAULT 0 CHECK (views >= 0),
  entries   integer NOT NULL DEFAULT 0 CHECK (entries >= 0),
  engaged   integer NOT NULL DEFAULT 0 CHECK (engaged >= 0),
  est_views numeric(14,2) NOT NULL DEFAULT 0 CHECK (est_views >= 0),
  PRIMARY KEY (day, path)
);
COMMENT ON TABLE public.site_usage_daily IS 'v10.508 (D274) 회원 화면 사용 통계 — 하루 × 화면 주소 묶음 수만(개인 식별 정보 없음) · 보관 site.usage_keep_days 뒤 정기 작업이 지움';

CREATE TABLE IF NOT EXISTS public.site_usage_goals (
  day        date NOT NULL,
  goal       text NOT NULL CHECK (goal IN ('SIGNUP', 'ORDER', 'POST', 'INQUIRY', 'LISTING', 'REQUEST')),
  entry_path text NOT NULL CHECK (entry_path ~ '^/[A-Za-z0-9/_:.-]{0,119}$'),
  n          integer NOT NULL DEFAULT 0 CHECK (n >= 0),
  PRIMARY KEY (day, goal, entry_path)
);
COMMENT ON TABLE public.site_usage_goals IS 'v10.508 (D274) 회원 화면 전환 — 하루 × 목표 × 들어온 첫 화면 수만';

/* 한 번 보기를 더함 — 하루 화면 묶음 수가 site.usage_path_cap 에 닿으면 새 주소는 /_other 로 묶음 */
CREATE OR REPLACE FUNCTION public.fn_site_usage_add(p_day date, p_path text, p_entry boolean, p_engaged text, p_goal text, p_goal_entry text, p_weight numeric)
  RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_cap integer; v_path text := p_path;
BEGIN
  v_cap := public.fn_hlt_setting_num('site.usage_path_cap', 3000)::integer;
  IF NOT EXISTS (SELECT 1 FROM public.site_usage_daily WHERE day = p_day AND path = v_path)
     AND (SELECT count(*) FROM public.site_usage_daily WHERE day = p_day) >= v_cap THEN
    v_path := '/_other';
  END IF;
  INSERT INTO public.site_usage_daily AS u (day, path, views, entries, est_views)
  VALUES (p_day, v_path, 1, CASE WHEN p_entry THEN 1 ELSE 0 END, greatest(p_weight, 0))
  ON CONFLICT (day, path) DO UPDATE SET views = u.views + 1, entries = u.entries + EXCLUDED.entries, est_views = u.est_views + EXCLUDED.est_views;
  IF p_engaged IS NOT NULL THEN
    UPDATE public.site_usage_daily SET engaged = engaged + 1 WHERE day = p_day AND path = p_engaged AND engaged < entries;
  END IF;
  IF p_goal IS NOT NULL AND p_goal_entry IS NOT NULL THEN
    INSERT INTO public.site_usage_goals AS g (day, goal, entry_path, n) VALUES (p_day, p_goal, p_goal_entry, 1)
    ON CONFLICT (day, goal, entry_path) DO UPDATE SET n = g.n + 1;
  END IF;
END $$;


/* ── ⑤ 알림 · 설정 · 정기 작업 ───────────────────────────────────── */
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis, tone) VALUES
  ('HLT_RESTOCK', '재입고 알림', true, false, '회원이 신청한 안내 — 품절 옵션이 다시 들어옴', 'info'),
  ('HLT_CASH_RECEIPT', '현금영수증 발급 · 취소', false, true, '거래 증빙 — 현금영수증 발급 · 취소 결과', 'info'),
  ('PLZ_BADGE', '소개광장 활동 배지', true, false, '안내 — 이달의 활동 배지', 'info')
ON CONFLICT (event_code) DO NOTHING;

INSERT INTO public.notification_templates (code, channel, title, body, variables) VALUES
  ('HLT_RESTOCK_INAPP', 'INAPP', '다시 들어왔습니다 — {product}',
   '기다리시던 「{product} {option}」이(가) 다시 들어왔습니다. 수량이 많지 않을 수 있으니 상품 화면에서 확인해 주십시오.', '["product","option"]'::jsonb),
  ('HLT_CASH_RECEIPT_INAPP', 'INAPP', '현금영수증 {action} — 주문 {orderNo}',
   '주문 {orderNo}의 현금영수증({purpose} · {amount}원)을 {action}했습니다. {note}', '["orderNo","purpose","amount","action","note"]'::jsonb),
  ('PLZ_BADGE_INAPP', 'INAPP', '소개광장 {month} 배지 — {badge}',
   '{month} 소개광장 활동으로 「{badge}」 배지를 받았습니다. 랭킹 화면에서 확인해 보세요.', '["month","badge"]'::jsonb)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('mall.restock_alert', 'off', 'GLOBAL', '소개몰 재입고 알림(v10.505 · D274) — 처음 off · on 이면 상품 화면 품절 옵션에 「입고되면 알림」 · 재고가 0 → 양수가 되면 신청한 회원에게 한 번 알림', false, '^(on|off)$', 'off'),
  ('mall.restock_keep_days', '90', 'ADMIN', '재입고 알림 신청을 기다리는 날 수(v10.505) — 지나면 정기 작업이 닫음(7 ~ 365 · 처음 90)', false, '^([7-9]|[1-9][0-9]|[12][0-9][0-9]|3[0-5][0-9]|36[0-5])$', '90'),
  ('mall.restock_max', '30', 'ADMIN', '회원 한 명이 한 번에 기다릴 수 있는 재입고 알림 수(v10.505 · 1 ~ 200 · 처음 30)', false, '^([1-9]|[1-9][0-9]|1[0-9][0-9]|200)$', '30'),
  ('mall.cash_receipt', 'off', 'ADMIN', '소개몰 현금영수증 발급(v10.506 · D274) — 처음 off · on 이면 10분마다 정기 작업(mall_cash_receipt)이 발급 · 취소 · 켜기 SUPER · 세무사 · PG 확인 뒤', false, '^(on|off)$', 'off'),
  ('mall.cash_receipt_mode', 'ASSUME', 'ADMIN', '현금영수증 발급 방식(v10.506) — ASSUME(처음 · 간주: 업체를 부르지 않고 「간주 발급」으로만 기록) · LIVE(토스페이먼츠 현금영수증 API · 연동 키 TOSS_SECRET_KEY · 없으면 NOT_READY) · SUPER', false, '^(ASSUME|LIVE)$', 'ASSUME'),
  ('mall.cash_receipt_self', 'off', 'ADMIN', '현금영수증 자진발급(v10.506) — on 이면 회원이 신청하지 않은 직판 계좌이체 · 가상계좌 결제 중 기준 금액 이상을 국세청 지정 번호(010-000-1234)로 발급 · 의무발행업종 해당 여부 세무사 확인 · SUPER', false, '^(on|off)$', 'off'),
  ('mall.cash_receipt_self_min', '100000', 'ADMIN', '자진발급 기준 금액(원 · v10.506) — 처음 100,000(의무발행업종 기준 · 세무사 확인 · SUPER)', false, '^[0-9]{1,9}$', '100000'),
  ('mall.cash_receipt_req_days', '5', 'ADMIN', '결제 뒤 회원이 화면에서 현금영수증을 신청할 수 있는 날 수(v10.506 · 0 ~ 90 · 처음 5 · 그 뒤는 운영이 발급)', false, '^([0-9]|[1-8][0-9]|90)$', '5'),
  ('mall.cash_receipt_keep_years', '5', 'ADMIN', '현금영수증 번호(휴대폰 · 사업자번호 암호화) 보관 해 수(v10.506 · 1 ~ 10 · 처음 5 — 국세기본법 장부 보관 기간 · 지나면 정기 작업이 번호를 지움)', false, '^([1-9]|10)$', '5'),
  ('plaza.ranking', 'off', 'GLOBAL', '소개광장 활동 랭킹 · 월간 배지(v10.507 · D274) — 처음 off · on 이면 랭킹 화면 · 도움돼요 단추 · 달 마감 배지 · 회원 알림', false, '^(on|off)$', 'off'),
  ('plaza.score_post', '3', 'ADMIN', '소개광장 점수 — 공개 글 하나(v10.507 · 0 ~ 20 · 처음 3)', false, '^([0-9]|1[0-9]|20)$', '3'),
  ('plaza.score_answer', '2', 'ADMIN', '소개광장 점수 — 질문(QNA) 글의 답변(남의 질문에 단 첫 단 댓글 · v10.507 · 0 ~ 20 · 처음 2)', false, '^([0-9]|1[0-9]|20)$', '2'),
  ('plaza.score_comment', '1', 'ADMIN', '소개광장 점수 — 그 밖의 댓글(v10.507 · 0 ~ 20 · 처음 1)', false, '^([0-9]|1[0-9]|20)$', '1'),
  ('plaza.score_helpful', '2', 'ADMIN', '소개광장 점수 — 받은 도움돼요 하나(v10.507 · 0 ~ 20 · 처음 2)', false, '^([0-9]|1[0-9]|20)$', '2'),
  ('plaza.daily_cap', '10', 'ADMIN', '소개광장 점수 — 하루에 세는 글 · 댓글 수 상한(도배 막음 · v10.507 · 1 ~ 100 · 처음 10)', false, '^([1-9]|[1-9][0-9]|100)$', '10'),
  ('plaza.rank_size', '20', 'ADMIN', '공개 랭킹에 보이는 사람 수(v10.507 · 3 ~ 100 · 처음 20)', false, '^([3-9]|[1-9][0-9]|100)$', '20'),
  ('plaza.badge_helpful_min', '10', 'ADMIN', '도움왕 배지 — 한 달 받은 도움돼요 수(v10.507 · 처음 10)', false, '^[1-9][0-9]{0,3}$', '10'),
  ('plaza.badge_answer_min', '10', 'ADMIN', '답변왕 배지 — 한 달 답변 수(v10.507 · 처음 10)', false, '^[1-9][0-9]{0,3}$', '10'),
  ('plaza.badge_post_min', '10', 'ADMIN', '꾸준한 글쓴이 배지 — 한 달 글 수(v10.507 · 처음 10)', false, '^[1-9][0-9]{0,3}$', '10'),
  ('site.usage_stats', 'off', 'GLOBAL', '회원 화면 사용 통계(v10.508 · D274) — 처음 off · on 이면 사용자 웹이 화면 주소만 보냄(계정 · IP · 방문자 쿠키 없음 · 하루 묶음) · 켜기 SUPER · 처리방침 고친 뒤(docs/646 · 법무 확인)', false, '^(on|off)$', 'off'),
  ('site.usage_sample', '100', 'GLOBAL', '사용 통계 표본(퍼센트 · v10.508 · 1 ~ 100 · 처음 100) — 브라우저 탭마다 한 번 정함 · 운영 화면 「추정 보기」는 보정', false, '^([1-9]|[1-9][0-9]|100)$', '100'),
  ('site.usage_keep_days', '400', 'ADMIN', '사용 통계 보관 날 수(v10.508 · 30 ~ 1100 · 처음 400) — 지나면 정기 작업이 지움', false, '^([3-9][0-9]|[1-9][0-9]{2}|10[0-9]{2}|1100)$', '400'),
  ('site.usage_path_cap', '3000', 'ADMIN', '하루에 따로 세는 화면 주소 묶음 수(v10.508 · 100 ~ 20000 · 처음 3000) — 넘으면 /_other 로 묶음', false, '^([1-9][0-9]{2,3}|1[0-9]{4}|20000)$', '3000')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('mall_cash_receipt', 10, NULL, NULL, NULL, true, '소개몰 현금영수증 발급 · 취소 — 10분마다 · mall.cash_receipt on 일 때만(처음 off · ASSUME 간주) · D274 · v10.506'),
  ('plz_badge_month', 1440, 3, 30, NULL, true, '소개광장 이번 달 활동 점수 다시 셈 · 지난달 마감 배지(plaza.ranking on 일 때만 배지) — 매일 03:30 · D274 · v10.507'),
  ('mlx_daily_purge', 1440, 4, 35, NULL, true, '재입고 알림 기한 닫기 · 현금영수증 번호 보관 끝 지움 · 사용 통계 보관 끝 지움 — 매일 04:35 · D274 · v10.505 · 506 · 508')
ON CONFLICT (job) DO NOTHING;


/* ── ⑥ ㉕ 권한(D258) 시드 — 새 탭 4개(따로 적지 않은 탭 = ADMIN · SUPER)
 *   주소 규칙(gen_seed.py 와 같음): GET = VIEW · /run 끝 = APPROVE · 그 밖 변경 = EDIT · 이름 = 탭 이름 · 순서 = TABS 차례(쿠폰 뒤 34 ~ 37)
 *   그룹은 adminMenu 의 「붙이기」(hrxAddTabs) 줄로 들어가 gen_seed 의 GROUPS 줄 읽기에는 안 잡혀 직접 적음(admhlt · admcmu · integ) */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('hlt-restock', '재입고 알림', 'admhlt', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 340),
  ('hlt-cashrcpt', '현금영수증', 'admhlt', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 350),
  ('plz-rank', '활동 배지 · 랭킹', 'admcmu', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 360),
  ('site-usage', '화면 사용 통계', 'integ', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 370)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'hlt-restock', 'VIEW'), ('R_ADMIN', 'hlt-restock', 'EDIT'), ('R_ADMIN', 'hlt-restock', 'APPROVE'), ('R_ADMIN', 'hlt-restock', 'EXPORT'),
  ('R_ADMIN', 'hlt-cashrcpt', 'VIEW'), ('R_ADMIN', 'hlt-cashrcpt', 'EDIT'), ('R_ADMIN', 'hlt-cashrcpt', 'APPROVE'), ('R_ADMIN', 'hlt-cashrcpt', 'EXPORT'),
  ('R_ADMIN', 'plz-rank', 'VIEW'), ('R_ADMIN', 'plz-rank', 'EDIT'), ('R_ADMIN', 'plz-rank', 'APPROVE'), ('R_ADMIN', 'plz-rank', 'EXPORT'),
  ('R_ADMIN', 'site-usage', 'VIEW'), ('R_ADMIN', 'site-usage', 'EDIT'), ('R_ADMIN', 'site-usage', 'APPROVE'), ('R_ADMIN', 'site-usage', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/health/restock', 'hlt-restock', 'VIEW'),
  ('POST', '/admin/health/restock/run', 'hlt-restock', 'APPROVE'),
  ('GET', '/admin/health/cash-receipts', 'hlt-cashrcpt', 'VIEW'),
  ('POST', '/admin/health/cash-receipts', 'hlt-cashrcpt', 'EDIT'),
  ('POST', '/admin/health/cash-receipts/run', 'hlt-cashrcpt', 'APPROVE'),
  ('POST', '/admin/health/cash-receipts/{id}/retry', 'hlt-cashrcpt', 'EDIT'),
  ('POST', '/admin/health/cash-receipts/{id}/cancel', 'hlt-cashrcpt', 'EDIT'),
  ('GET', '/admin/community/ranking', 'plz-rank', 'VIEW'),
  ('POST', '/admin/community/ranking/run', 'plz-rank', 'APPROVE'),
  ('POST', '/admin/community/badges/{id}/revoke', 'plz-rank', 'EDIT'),
  ('GET', '/admin/site-usage', 'site-usage', 'VIEW')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

