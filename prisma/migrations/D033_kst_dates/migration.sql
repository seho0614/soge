-- =====================================================================
-- D033 — 한국 날짜로 (v10.27 · G-127)
--
--   서버(DB)는 UTC 로 돌아갑니다(개발 Docker · AWS). 그래서
--   ① 소개몰 주문번호의 날짜(H + YYMMDD)가 한국 0 ~ 9시 주문에는 전날이었고(10/3 08:22 주문 → H261002…)
--   ② 제휴 링크 클릭 집계의 날짜(stat_date)가 같은 시간대에 전날로 쌓였습니다.
--   둘 다 한국 날짜로 셉니다. 이미 쌓인 번호 · 집계는 바꾸지 않습니다(식별자 · 지난 기록).
--   월 경계(제휴 목표 기간 · 이번 달 집계 · 이용료 월별 묶음)는 서비스 SQL 쪽에서 한국 시각으로 고쳤습니다(affiliate · partner · report · ads · admin).
--   재실행 안전.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_next_hlt_order_no()
 RETURNS text
 LANGUAGE sql
AS $function$
  SELECT 'H' || to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYMMDD') || lpad(nextval('hlt_order_seq')::text, 5, '0');
$function$;

CREATE OR REPLACE FUNCTION public.fn_plink_click(p_code text, p_visitor_hash text)
 RETURNS TABLE(reason text, landing_url text, counted boolean)
 LANGUAGE plpgsql
AS $function$
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
    VALUES (r.id, (now() AT TIME ZONE 'Asia/Seoul')::date, p_visitor_hash)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_new = ROW_COUNT;
    IF v_new > 0 THEN
      INSERT INTO partner_link_stats (link_id, stat_date, clicks)
      VALUES (r.id, (now() AT TIME ZONE 'Asia/Seoul')::date, 1)
      ON CONFLICT (link_id, stat_date) DO UPDATE SET clicks = partner_link_stats.clicks + 1;
    END IF;
    /* 이틀 지난 해시는 쓸 데가 없습니다 — 이 링크 것만 지워 가볍게 */
    DELETE FROM partner_link_clicks WHERE link_id = r.id AND stat_date < (now() AT TIME ZONE 'Asia/Seoul')::date - 1;
  END IF;

  RETURN QUERY SELECT 'OK'::text, v_url, v_new > 0;
END $function$;
