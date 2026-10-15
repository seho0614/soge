-- =====================================================================
-- D001 — 제휴 링크 클릭 기록 · 파트너 정산 계좌 1원 재인증 (2026-10-02)
--
--   1. 링크 클릭 — 공개 주소 /r/{code} 를 누르면 하루·방문자당 한 번 센다.
--      ★ 방문자는 **해시로만** 남깁니다(IP·UA·쿠키 원문 없음). 해시는 앱이
--        날짜를 섞어 만들므로 날이 바뀌면 같은 사람을 이어 볼 수 없습니다.
--      ★ 착지 주소는 http/https 또는 내부 경로(/…)만 — javascript: 등 차단.
--   2. 정산 계좌 재인증 — 계좌를 바꾸면 verified_at 이 비는데(C850)
--      다시 인증할 길이 없었습니다. 1원 인증 상태 칸을 더하고
--      **계좌가 바뀌면 인증·시도 상태를 DB 가 지웁니다**.
--      시도 5회 초과·만료 코드로 인증 완료 처리하는 것도 DB 가 막습니다.
-- 재실행 안전 (IF NOT EXISTS · OR REPLACE · DROP TRIGGER IF EXISTS)
-- =====================================================================

/* ── 1. 착지 주소 검사 ─────────────────────────────────────────── */

CREATE OR REPLACE FUNCTION fn_aff_safe_landing(u text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT u IS NOT NULL AND length(u) <= 300 AND (
         u ~* '^https?://[^[:space:]/\\?#@]+([/?#][^[:space:]]*)?$'
      OR u ~  '^/([^/\\[:space:]][^[:space:]]*)?$')
$$;
COMMENT ON FUNCTION fn_aff_safe_landing(text) IS
  '제휴 착지 주소로 쓸 수 있는가 — http/https 절대주소 또는 내부 경로(/…). '
  '//host · /\host · javascript: · data: 는 거짓 (열린 리다이렉트 차단, D001)';

CREATE OR REPLACE FUNCTION fn_aff_landing_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  /* 바뀐 때만 봅니다 — 예전 행(표본 입력 등)이 상태 변경까지 막히지 않게 */
  IF NEW.landing_url IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.landing_url IS DISTINCT FROM OLD.landing_url)
     AND NOT fn_aff_safe_landing(NEW.landing_url) THEN
    RAISE EXCEPTION 'LANDING: 착지 주소는 http:// · https:// 로 시작하거나 / 로 시작하는 내부 경로여야 합니다';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_aprod_landing ON affiliate_products;
CREATE TRIGGER trg_aprod_landing BEFORE INSERT OR UPDATE OF landing_url ON affiliate_products
  FOR EACH ROW EXECUTE FUNCTION fn_aff_landing_guard();
DROP TRIGGER IF EXISTS trg_plink_landing ON partner_links;
CREATE TRIGGER trg_plink_landing BEFORE INSERT OR UPDATE OF landing_url ON partner_links
  FOR EACH ROW EXECUTE FUNCTION fn_aff_landing_guard();

/* ── 2. 클릭 중복 제거 ─────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS partner_link_clicks (
  link_id      uuid NOT NULL REFERENCES partner_links(id) ON DELETE CASCADE,
  stat_date    date NOT NULL,
  visitor_hash text NOT NULL CHECK (visitor_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (link_id, stat_date, visitor_hash)
);
COMMENT ON TABLE partner_link_clicks IS
  '링크 클릭 중복 제거용(하루·방문자당 1회). **해시만** 둡니다 — IP·UA·쿠키 원문 없음. '
  '해시에 날짜가 섞여 날을 넘겨 추적할 수 없고, 이틀 지난 행은 fn_plink_click 이 지웁니다. 집계는 partner_link_stats (D001)';

/**
 * 클릭 한 번 처리 — 링크 상태 판정 + (필요하면) 하루 1회 집계.
 * reason: OK · NOT_FOUND · LINK_INACTIVE · PARTNER_INACTIVE · PRODUCT_NOT_ON_SALE · BAD_LANDING
 * p_visitor_hash 가 NULL 이면(봇·미리보기) 세지 않고 주소만 돌려줍니다.
 */
CREATE OR REPLACE FUNCTION fn_plink_click(p_code text, p_visitor_hash text)
RETURNS TABLE (reason text, landing_url text, counted boolean)
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  v_url text;
  v_new int := 0;
BEGIN
  SELECT l.id, l.is_active, l.landing_url AS l_url,
         pt.status AS partner_status, ap.status AS product_status, ap.landing_url AS p_url
    INTO r
    FROM partner_links l
    JOIN partners pt ON pt.id = l.partner_id
    LEFT JOIN affiliate_products ap ON ap.id = l.product_id
   WHERE l.code = p_code;

  IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, false; RETURN; END IF;
  IF NOT r.is_active THEN RETURN QUERY SELECT 'LINK_INACTIVE'::text, NULL::text, false; RETURN; END IF;
  IF r.partner_status <> 'ACTIVE' THEN RETURN QUERY SELECT 'PARTNER_INACTIVE'::text, NULL::text, false; RETURN; END IF;
  IF r.product_status IS DISTINCT FROM 'ON_SALE' THEN
    RETURN QUERY SELECT 'PRODUCT_NOT_ON_SALE'::text, NULL::text, false; RETURN;
  END IF;
  v_url := coalesce(nullif(btrim(r.l_url), ''), r.p_url);
  IF NOT coalesce(fn_aff_safe_landing(v_url), false) THEN
    RETURN QUERY SELECT 'BAD_LANDING'::text, NULL::text, false; RETURN;
  END IF;

  IF p_visitor_hash IS NOT NULL THEN
    INSERT INTO partner_link_clicks (link_id, stat_date, visitor_hash)
    VALUES (r.id, current_date, p_visitor_hash)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_new = ROW_COUNT;
    IF v_new > 0 THEN
      INSERT INTO partner_link_stats (link_id, stat_date, clicks)
      VALUES (r.id, current_date, 1)
      ON CONFLICT (link_id, stat_date) DO UPDATE SET clicks = partner_link_stats.clicks + 1;
    END IF;
    /* 이틀 지난 해시는 쓸 데가 없습니다 — 이 링크 것만 지워 가볍게 */
    DELETE FROM partner_link_clicks WHERE link_id = r.id AND stat_date < current_date - 1;
  END IF;

  RETURN QUERY SELECT 'OK'::text, v_url, v_new > 0;
END $$;

/* ── 3. 정산 계좌 1원 재인증 ───────────────────────────────────── */

ALTER TABLE partner_settlement_accounts
  ADD COLUMN IF NOT EXISTS verify_code_hash  text,
  ADD COLUMN IF NOT EXISTS verify_sent_at    timestamptz,
  ADD COLUMN IF NOT EXISTS verify_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS verify_tries      int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS verify_stub       boolean NOT NULL DEFAULT false;

ALTER TABLE partner_settlement_accounts DROP CONSTRAINT IF EXISTS pstl_acc_tries_check;
ALTER TABLE partner_settlement_accounts ADD CONSTRAINT pstl_acc_tries_check
  CHECK (verify_tries BETWEEN 0 AND 5);

COMMENT ON COLUMN partner_settlement_accounts.verify_code_hash IS
  '1원 입금자명 코드의 sha256 — 원문은 두지 않습니다. 인증되면 비웁니다 (D001)';
COMMENT ON COLUMN partner_settlement_accounts.verify_tries IS
  '틀린 횟수. 5회면 막힘 — 계좌를 다시 등록해야 풀립니다 (D001)';
COMMENT ON COLUMN partner_settlement_accounts.verify_stub IS
  '계좌인증 연동 전 스텁으로 보낸 것인가 — 참이면 실제 1원이 가지 않았습니다 (D001)';

CREATE OR REPLACE FUNCTION fn_pstl_account_reverify() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  /* ① 계좌가 바뀌면 인증은 무효 — 앱이 잊어도 DB 가 지웁니다 */
  IF NEW.bank_code   IS DISTINCT FROM OLD.bank_code
  OR NEW.account_enc IS DISTINCT FROM OLD.account_enc
  OR NEW.holder_name IS DISTINCT FROM OLD.holder_name THEN
    NEW.verified_at       := NULL;
    NEW.verify_code_hash  := NULL;
    NEW.verify_sent_at    := NULL;
    NEW.verify_expires_at := NULL;
    NEW.verify_tries      := 0;
    NEW.verify_stub       := false;
    RETURN NEW;
  END IF;

  /* ② 진행 중이던 1원 인증이 막혔거나 만료됐으면 인증 완료로 바꿀 수 없습니다 */
  IF OLD.verified_at IS NULL AND NEW.verified_at IS NOT NULL THEN
    IF OLD.verify_tries >= 5 THEN
      RAISE EXCEPTION 'VERIFY_LOCKED: 인증 코드를 다섯 번 틀려 막혔습니다 — 계좌를 다시 등록하십시오';
    END IF;
    IF OLD.verify_code_hash IS NOT NULL AND OLD.verify_expires_at < now() THEN
      RAISE EXCEPTION 'VERIFY_EXPIRED: 인증 코드가 만료됐습니다 — 1원을 다시 받으십시오';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pstl_account_reverify ON partner_settlement_accounts;
CREATE TRIGGER trg_pstl_account_reverify BEFORE UPDATE ON partner_settlement_accounts
  FOR EACH ROW EXECUTE FUNCTION fn_pstl_account_reverify();
