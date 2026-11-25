-- E008 옮긴 회계 코드가 SQL 로 부르는 소개뱅크 함수(tools/gen-erp-schema.py · E004 에 없는 것 · 소개뱅크 표는 svc. · docs/011)
-- 함수 6
SET check_function_bodies = off;
SET search_path = public;

CREATE OR REPLACE FUNCTION public.fn_acct_from()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
AS $function$
  SELECT (coalesce(nullif((SELECT value FROM svc.site_settings WHERE key = 'acct.start_on'), ''), '2026-11-01')::date)::timestamp AT TIME ZONE 'Asia/Seoul'
$function$;

CREATE OR REPLACE FUNCTION public.fn_acct_stub_ok(p_stub boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT NOT coalesce(p_stub, false) OR coalesce((SELECT value FROM svc.site_settings WHERE key = 'acct.include_stub'), 'off') = 'on'
$function$;

CREATE OR REPLACE FUNCTION public.fn_acct_transfer_tran_id(p_org text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF p_org IS NULL OR p_org !~ '^[A-Za-z0-9]{10}$' THEN RAISE EXCEPTION 'ACCT_TRANSFER: 이용기관코드는 영문 · 숫자 10자입니다.'; END IF;
  RETURN p_org || 'U' || lpad((nextval('public.acct_transfer_tran_seq') % 1000000000)::text, 9, '0');
END $function$;

CREATE OR REPLACE FUNCTION public.fn_enc_key()
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v text;
BEGIN
  v := current_setting('app.enc_key', true);
  IF coalesce(btrim(v), '') = '' THEN
    -- 옛 이름 — 끊지 않고 받아 줍니다
    v := current_setting('app.pii_key', true);
  END IF;

  IF coalesce(btrim(v), '') = '' THEN
    RAISE EXCEPTION
      'ENC_KEY: 암호화 열쇠가 없습니다. 서버가 접속할 때 SET app.enc_key 를 해야 합니다 (AWS 절차서 7-3 참조)';
  END IF;
  IF length(v) < 16 THEN
    RAISE EXCEPTION 'ENC_KEY: 열쇠가 너무 짧습니다 (% 자) — 32자 이상을 쓰십시오', length(v);
  END IF;
  RETURN v;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hlt_option_label(p_months integer, p_tag text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE WHEN p_months IS NULL THEN '단품' ELSE p_months || '개월 분' END
         || coalesce(' ' || nullif(btrim(p_tag), ''), '')
$function$;

CREATE OR REPLACE FUNCTION public.fn_smx_remote_exempt(p_order uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE
AS $function$
  SELECT coalesce((
    SELECT CASE WHEN coalesce(o.remote_ship_fee, 0) <= 0 OR coalesce(o.goods_amount, 0) <= 0 THEN 0
                WHEN coalesce((SELECT s.value FROM svc.site_settings s WHERE s.key = 'smx.remote_tax_mode'), 'RATIO') = 'TAXABLE' THEN 0
                ELSE (o.remote_ship_fee * coalesce((SELECT sum(it.amount) FROM svc.hlt_order_items it WHERE it.order_id = o.id AND it.tax_type = 'EXEMPT'), 0) / o.goods_amount)::bigint END
      FROM svc.hlt_orders o WHERE o.id = p_order), 0)::bigint
$function$;
