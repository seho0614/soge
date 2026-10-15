-- v10.31 (10/10 「시안 기준」 · 서버 자료가 없던 구역은 서버까지) — 광고 플랫폼(외부 송출) · 퍼블리셔 지급
--   시안 SB-ADS-PLT-010(adx 「돈이 도는 길 7단계 · 무효 클릭 필터 F1~F7」) · SB-ADS-PAY-010(payout 「2인 원칙 · 금액 계산」).
--   내부 지면(ad_*)과 성격이 달라 접두를 adx_ 로 가릅니다 — 외부 송출 · 클릭 과금 · 퍼블리셔 수익 배분.
--
--   돈의 성격(INV-11 과의 관계): 광고비는 회사 매출이고 퍼블리셔 몫은 회사가 지면을 사는 비용입니다 — 남의 돈을 맡아 두는 것이 아닙니다.
--   그래도 지급(돈이 나가는 것)은 지급 게이트(adx.payout_gate)가 열리기 전에는 막습니다(전자금융업 확인 전 — 시안 「payout.gate.open = false」).
--   시안 1단계의 「에스크로」는 쓰지 않습니다(INV-11 — 플랫폼 에스크로 금지). 광고주 돈은 광고 과금(ad_invoices · ad_payments)으로 받습니다.
--
--   막는 장치(전부 DB):
--     · 미검증 도메인 송출 불가(fn_adx_serve) · 무효 클릭 F1~F7 판정(fn_adx_click) · 보류 7일 뒤 확정(fn_adx_confirm)
--     · 한 클릭은 한 명세서에만(adx_statement_items 기본키 = click_id) · 이월 · 원천징수 3.3%(fn_adx_month_close)
--     · 신청자 ≠ 승인자 ≠ 집행자 · 승인 상태가 아니면 집행 불가 · 게이트가 닫히면 집행 불가 · 원장 불일치 시 집행 불가(fn_adx_statement_flow)

CREATE TABLE IF NOT EXISTS adx_publishers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  domain             text NOT NULL UNIQUE CHECK (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  domain_verified_at timestamptz,
  account_id         uuid REFERENCES accounts(id),
  owner_ips          text[] NOT NULL DEFAULT '{}',
  share_bp           int NOT NULL DEFAULT 7000 CHECK (share_bp BETWEEN 0 AND 10000),
  status             text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','HOLD','CLOSED')),
  created_by         uuid REFERENCES accounts(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE adx_publishers IS 'v10.31 — 외부 송출 퍼블리셔(외부 사이트). 도메인 확인 전에는 송출 불가 · owner_ips = F5 본인 IP';

CREATE TABLE IF NOT EXISTS adx_impressions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  publisher_id uuid NOT NULL REFERENCES adx_publishers(id),
  placement_id uuid REFERENCES ad_placements(id),
  served_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  device_hash  text,
  ip           inet,
  ua           text
);
CREATE INDEX IF NOT EXISTS idx_adx_imp_pub ON adx_impressions (publisher_id, served_at DESC);

CREATE TABLE IF NOT EXISTS adx_clicks (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  impression_id bigint REFERENCES adx_impressions(id),
  publisher_id  uuid NOT NULL REFERENCES adx_publishers(id),
  placement_id  uuid REFERENCES ad_placements(id),
  clicked_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  device_hash   text,
  ip            inet,
  ua            text,
  cpc           bigint NOT NULL CHECK (cpc >= 0),
  invalid_rule  text CHECK (invalid_rule IN ('F1','F2','F3','F4','F5','F6','F7')),
  confirmed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_adx_click_pub ON adx_clicks (publisher_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_adx_click_dev ON adx_clicks (device_hash, placement_id, clicked_at DESC);
COMMENT ON COLUMN adx_clicks.invalid_rule IS 'NULL = 유효. F1 반복 · F2 노출 없음 · F3 0.5초 이내 · F4 봇 · F5 퍼블리셔 본인 IP · F6 데이터센터 · VPN · F7 클릭률 급등';

CREATE TABLE IF NOT EXISTS adx_statements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id      uuid NOT NULL REFERENCES adx_publishers(id),
  month             date NOT NULL CHECK (month = date_trunc('month', month)::date),
  confirmed_revenue bigint NOT NULL DEFAULT 0,
  carried_in        bigint NOT NULL DEFAULT 0,
  gross             bigint NOT NULL DEFAULT 0,
  withholding       bigint NOT NULL DEFAULT 0,
  net               bigint NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REQUESTED','APPROVED','PAID','CARRIED')),
  carried_into      uuid REFERENCES adx_statements(id),
  requested_by uuid REFERENCES accounts(id), requested_at timestamptz,
  approved_by  uuid REFERENCES accounts(id), approved_at  timestamptz,
  paid_by      uuid REFERENCES accounts(id), paid_at      timestamptz, paid_ref text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (publisher_id, month),
  CHECK (gross = confirmed_revenue + carried_in),
  CHECK (net = gross - withholding)
);
COMMENT ON TABLE adx_statements IS 'v10.31 — 퍼블리셔 월 명세서. 월 마감 → 신청 → 승인 → 집행(2인 원칙). 원천징수는 예수금(ACC-TAX)으로 따로';

/* 한 클릭은 한 명세서에만 — 기본키가 막습니다 */
CREATE TABLE IF NOT EXISTS adx_statement_items (
  click_id     bigint PRIMARY KEY REFERENCES adx_clicks(id),
  statement_id uuid NOT NULL REFERENCES adx_statements(id),
  amount       bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_adx_items_stmt ON adx_statement_items (statement_id);

INSERT INTO site_settings (key, value, description, value_pattern, value_example) VALUES
  ('adx.payout_gate', 'closed', '외부 송출 퍼블리셔 지급 게이트 — open 이어야 집행됩니다(전자금융업 확인 전에는 closed)', '^(open|closed)$', 'closed'),
  ('adx.cpc', '300', '외부 송출 클릭당 단가(원)', '^[0-9]{1,6}$', '300'),
  ('adx.hold_days', '7', '무효 클릭을 걸러내는 보류 일수 — 지나야 확정', '^[0-9]{1,2}$', '7'),
  ('adx.min_payout', '50000', '퍼블리셔 최소 지급액(원) — 미달이면 다음 달로 이월', '^[0-9]{1,8}$', '50000'),
  ('adx.withholding_bp', '330', '원천징수율(만분율) — 330 = 3.3%(소득세 3% + 지방소득세 0.3%)', '^[0-9]{1,4}$', '330'),
  ('adx.dc_ip_prefixes', '', 'F6 데이터센터 · VPN 대역(쉼표로 구분한 CIDR)', NULL, '13.124.0.0/16,52.78.0.0/15'),
  ('adx.ctr_spike_pct', '20', 'F7 비정상 클릭률 급등 기준(최근 1시간 클릭률 %, 노출 50건 이상일 때)', '^[0-9]{1,3}$', '20')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION fn_adx_setting(k text, d text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif((SELECT value FROM site_settings WHERE key = k), ''), d)
$$;

/* 송출 — 확인된 도메인 · 운영 중 퍼블리셔만. 지금 내보낼 소재 하나를 고르고 노출을 남깁니다 */
CREATE OR REPLACE FUNCTION fn_adx_serve(p_publisher uuid, p_device text, p_ip inet, p_ua text)
RETURNS TABLE (impression_id bigint, placement_id uuid, title text, body text, image_key text, cta text, link_url text)
LANGUAGE plpgsql AS $$
DECLARE p record; pl record; v_imp bigint;
BEGIN
  SELECT * INTO p FROM adx_publishers WHERE id = p_publisher;
  IF p.id IS NULL OR p.status <> 'ACTIVE' THEN RAISE EXCEPTION 'ADX_SERVE: 운영 중인 퍼블리셔가 아닙니다'; END IF;
  IF p.domain_verified_at IS NULL THEN RAISE EXCEPTION 'ADX_SERVE: 도메인 확인 전에는 송출할 수 없습니다'; END IF;
  SELECT a.* INTO pl FROM ad_placements a
   WHERE a.status = 'ACTIVE' AND now() BETWEEN coalesce(a.starts_at, '-infinity') AND coalesce(a.ends_at, 'infinity')
     AND NOT coalesce(a.is_regulated, false)          -- 규제 소재(의료 · 대부 등)는 외부로 내보내지 않습니다
   ORDER BY random() LIMIT 1;
  IF pl.id IS NULL THEN RETURN; END IF;
  INSERT INTO adx_impressions (publisher_id, placement_id, device_hash, ip, ua)
  VALUES (p_publisher, pl.id, p_device, p_ip, p_ua) RETURNING id INTO v_imp;
  RETURN QUERY SELECT v_imp, pl.id, pl.title, pl.body, pl.image_key, pl.cta, pl.link_url;
END $$;

/* 클릭 — F1~F7 을 판정해 남깁니다(무효도 지우지 않고 사유와 함께 남김 · 과금 0 이 아니라 지급 대상에서 빠짐) */
CREATE OR REPLACE FUNCTION fn_adx_click(p_publisher uuid, p_impression bigint, p_device text, p_ip inet, p_ua text)
RETURNS TABLE (click_id bigint, invalid_rule text, link_url text) LANGUAGE plpgsql AS $$
DECLARE i record; p record; v_rule text; v_id bigint; v_url text; v_imp int; v_clk int; dc text;
BEGIN
  SELECT * INTO p FROM adx_publishers WHERE id = p_publisher;
  IF p.id IS NULL THEN RAISE EXCEPTION 'ADX_CLICK: 없는 퍼블리셔입니다'; END IF;
  SELECT * INTO i FROM adx_impressions WHERE id = p_impression;
  IF i.id IS NULL OR i.publisher_id <> p_publisher THEN
    v_rule := 'F2';
  ELSIF clock_timestamp() - i.served_at < interval '500 milliseconds' THEN
    v_rule := 'F3';
  ELSIF coalesce(p_ua, '') ~* '(bot|crawl|spider|headless|curl|wget|python|phantom|selenium|playwright|puppeteer)' OR coalesce(p_ua, '') = '' THEN
    v_rule := 'F4';
  ELSIF p_ip IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p.owner_ips) x WHERE p_ip <<= x::inet) THEN
    v_rule := 'F5';
  ELSIF p_ip IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(string_to_array(fn_adx_setting('adx.dc_ip_prefixes', ''), ',')) x
                                      WHERE btrim(x) <> '' AND p_ip <<= btrim(x)::inet) THEN
    v_rule := 'F6';
  ELSIF p_device IS NOT NULL AND EXISTS (SELECT 1 FROM adx_clicks c WHERE c.device_hash = p_device AND c.placement_id = i.placement_id
                                          AND c.clicked_at > now() - interval '24 hours') THEN
    v_rule := 'F1';
  ELSE
    SELECT count(*) INTO v_imp FROM adx_impressions WHERE publisher_id = p_publisher AND served_at > now() - interval '1 hour';
    SELECT count(*) INTO v_clk FROM adx_clicks WHERE publisher_id = p_publisher AND clicked_at > now() - interval '1 hour';
    IF v_imp >= 50 AND (v_clk + 1) * 100 > v_imp * fn_adx_setting('adx.ctr_spike_pct', '20')::int THEN v_rule := 'F7'; END IF;
  END IF;
  INSERT INTO adx_clicks (impression_id, publisher_id, placement_id, device_hash, ip, ua, cpc, invalid_rule)
  VALUES (CASE WHEN i.id IS NOT NULL AND i.publisher_id = p_publisher THEN i.id END, p_publisher, i.placement_id,
          p_device, p_ip, p_ua, fn_adx_setting('adx.cpc', '300')::bigint, v_rule)
  RETURNING id INTO v_id;
  SELECT a.link_url INTO v_url FROM ad_placements a WHERE a.id = i.placement_id;
  RETURN QUERY SELECT v_id, v_rule, v_url;
END $$;

/* 보류 기간이 지난 유효 클릭을 확정합니다 — 확정 전에는 명세서에 담기지 않습니다 */
CREATE OR REPLACE FUNCTION fn_adx_confirm() RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  UPDATE adx_clicks SET confirmed_at = now()
   WHERE confirmed_at IS NULL AND invalid_rule IS NULL
     AND clicked_at < now() - make_interval(days => fn_adx_setting('adx.hold_days', '7')::int);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

/* 월 마감 — 확정된 유효 클릭(아직 어느 명세서에도 없는 것)을 퍼블리셔별 명세서로. 최소 지급액 미달은 이월 */
CREATE OR REPLACE FUNCTION fn_adx_month_close(p_month date) RETURNS int LANGUAGE plpgsql AS $$
DECLARE m date := date_trunc('month', p_month)::date; r record; v_stmt uuid; v_carry bigint; v_gross bigint; v_wh bigint; n int := 0;
BEGIN
  IF m >= date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')::date THEN
    RAISE EXCEPTION 'ADX_CLOSE: 지난 달만 마감할 수 있습니다';
  END IF;
  PERFORM fn_adx_confirm();
  FOR r IN
    SELECT p.id, p.share_bp,
           coalesce(sum(c.cpc * p.share_bp / 10000) FILTER (WHERE c.id IS NOT NULL), 0)::bigint AS revenue
      FROM adx_publishers p
      LEFT JOIN adx_clicks c ON c.publisher_id = p.id AND c.invalid_rule IS NULL AND c.confirmed_at IS NOT NULL
             AND date_trunc('month', c.clicked_at AT TIME ZONE 'Asia/Seoul')::date <= m
             AND NOT EXISTS (SELECT 1 FROM adx_statement_items s WHERE s.click_id = c.id)
     WHERE NOT EXISTS (SELECT 1 FROM adx_statements s WHERE s.publisher_id = p.id AND s.month = m)
     GROUP BY p.id, p.share_bp
  LOOP
    SELECT coalesce(sum(gross), 0) INTO v_carry FROM adx_statements
     WHERE publisher_id = r.id AND status = 'CARRIED' AND carried_into IS NULL;
    v_gross := r.revenue + v_carry;
    IF v_gross = 0 THEN CONTINUE; END IF;
    IF v_gross < fn_adx_setting('adx.min_payout', '50000')::bigint THEN
      v_wh := 0;
    ELSE
      v_wh := floor(v_gross * fn_adx_setting('adx.withholding_bp', '330')::numeric / 10000 / 10) * 10;
    END IF;
    INSERT INTO adx_statements (publisher_id, month, confirmed_revenue, carried_in, gross, withholding, net, status)
    VALUES (r.id, m, r.revenue, v_carry, v_gross, v_wh, v_gross - v_wh,
            CASE WHEN v_gross < fn_adx_setting('adx.min_payout', '50000')::bigint THEN 'CARRIED' ELSE 'DRAFT' END)
    RETURNING id INTO v_stmt;
    UPDATE adx_statements SET carried_into = v_stmt
     WHERE publisher_id = r.id AND status = 'CARRIED' AND carried_into IS NULL AND id <> v_stmt;
    INSERT INTO adx_statement_items (click_id, statement_id, amount)
    SELECT c.id, v_stmt, c.cpc * r.share_bp / 10000 FROM adx_clicks c
     WHERE c.publisher_id = r.id AND c.invalid_rule IS NULL AND c.confirmed_at IS NOT NULL
       AND date_trunc('month', c.clicked_at AT TIME ZONE 'Asia/Seoul')::date <= m
       AND NOT EXISTS (SELECT 1 FROM adx_statement_items s WHERE s.click_id = c.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

/* 신청 → 승인 → 집행 · 2인 원칙 · 게이트 · 원장 */
CREATE OR REPLACE FUNCTION fn_adx_statement_flow() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_items bigint;
BEGIN
  IF NEW.status = OLD.status THEN
    IF (NEW.gross, NEW.withholding, NEW.net, NEW.confirmed_revenue) IS DISTINCT FROM (OLD.gross, OLD.withholding, OLD.net, OLD.confirmed_revenue)
       AND OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'ADX_STMT: 신청된 명세서의 금액은 바꿀 수 없습니다';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'REQUESTED' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'ADX_STMT: 마감된(초안) 명세서만 신청할 수 있습니다'; END IF;
    IF NEW.requested_by IS NULL THEN RAISE EXCEPTION 'ADX_STMT: 신청자가 없습니다'; END IF;
    IF EXISTS (SELECT 1 FROM adx_publishers p WHERE p.id = NEW.publisher_id AND p.status = 'HOLD') THEN
      RAISE EXCEPTION 'ADX_STMT: 보류 중인 퍼블리셔는 신청할 수 없습니다';
    END IF;
    NEW.requested_at := now();
  ELSIF NEW.status = 'APPROVED' THEN
    IF OLD.status <> 'REQUESTED' THEN RAISE EXCEPTION 'ADX_STMT: 신청된 명세서만 승인할 수 있습니다'; END IF;
    IF NEW.approved_by IS NULL OR NEW.approved_by = OLD.requested_by THEN
      RAISE EXCEPTION 'ADX_STMT: 자기가 신청한 것을 자기가 승인할 수 없습니다(2인 원칙)';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = NEW.approved_by AND r.role IN ('ADMIN','SUPER')) THEN
      RAISE EXCEPTION 'ADX_STMT: 운영(ADMIN · SUPER)만 승인할 수 있습니다';
    END IF;
    NEW.approved_at := now();
  ELSIF NEW.status = 'PAID' THEN
    IF OLD.status <> 'APPROVED' THEN RAISE EXCEPTION 'ADX_STMT: 승인 상태가 아니면 집행할 수 없습니다'; END IF;
    IF fn_adx_setting('adx.payout_gate', 'closed') <> 'open' THEN
      RAISE EXCEPTION 'ADX_GATE: 지급 게이트가 닫혀 있습니다 — 전자금융업 확인 전에는 돈이 나가지 않습니다';
    END IF;
    IF NEW.paid_by IS NULL OR NEW.paid_by IN (OLD.approved_by, OLD.requested_by) THEN
      RAISE EXCEPTION 'ADX_STMT: 승인 · 신청한 사람은 집행할 수 없습니다(2인 원칙)';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = NEW.paid_by AND r.role = 'PAYOUT') THEN
      RAISE EXCEPTION 'ADX_STMT: 지급 담당(PAYOUT)만 집행할 수 있습니다';
    END IF;
    IF coalesce(btrim(NEW.paid_ref), '') = '' THEN RAISE EXCEPTION 'ADX_STMT: 이체 참조(은행 거래번호)를 적어 주십시오'; END IF;
    SELECT coalesce(sum(amount), 0) INTO v_items FROM adx_statement_items WHERE statement_id = NEW.id;
    IF v_items <> NEW.confirmed_revenue THEN
      RAISE EXCEPTION 'ADX_LEDGER: 명세서 항목 합계(%)와 확정 수익(%)이 다릅니다 — 원장 불일치로 지급을 막습니다', v_items, NEW.confirmed_revenue;
    END IF;
    NEW.paid_at := now();
  ELSIF NEW.status = 'CARRIED' OR NEW.status = 'DRAFT' THEN
    RAISE EXCEPTION 'ADX_STMT: 이 상태로 되돌릴 수 없습니다';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_adx_statement_flow ON adx_statements;
CREATE TRIGGER trg_adx_statement_flow BEFORE UPDATE ON adx_statements FOR EACH ROW EXECUTE FUNCTION fn_adx_statement_flow();

CREATE OR REPLACE FUNCTION fn_adx_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ADX_STMT: 명세서 · 항목 · 클릭 기록은 지울 수 없습니다'; END $$;
DROP TRIGGER IF EXISTS trg_adx_stmt_no_delete ON adx_statements;
CREATE TRIGGER trg_adx_stmt_no_delete BEFORE DELETE ON adx_statements FOR EACH ROW EXECUTE FUNCTION fn_adx_no_delete();
DROP TRIGGER IF EXISTS trg_adx_items_no_delete ON adx_statement_items;
CREATE TRIGGER trg_adx_items_no_delete BEFORE DELETE OR UPDATE ON adx_statement_items FOR EACH ROW EXECUTE FUNCTION fn_adx_no_delete();
DROP TRIGGER IF EXISTS trg_adx_clicks_no_delete ON adx_clicks;
CREATE TRIGGER trg_adx_clicks_no_delete BEFORE DELETE ON adx_clicks FOR EACH ROW EXECUTE FUNCTION fn_adx_no_delete();

/* 감시 — 0 이어야 합니다 */
CREATE OR REPLACE VIEW v_adx_ledger_mismatch AS
SELECT s.id, s.publisher_id, s.month, s.confirmed_revenue, coalesce(sum(i.amount), 0) AS items
  FROM adx_statements s LEFT JOIN adx_statement_items i ON i.statement_id = s.id
 GROUP BY s.id HAVING coalesce(sum(i.amount), 0) <> s.confirmed_revenue;
COMMENT ON VIEW v_adx_ledger_mismatch IS 'v10.31 — 명세서 확정 수익 ≠ 항목 합계. 0 이어야 합니다(있으면 집행이 막힘)';
