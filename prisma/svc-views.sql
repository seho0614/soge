-- svc 를 읽는 조회(tools/gen-erp-schema.py 가 만듦 · tools/erp-svc.sh 가 svc 를 가져온 뒤 실행 · docs/008)
SET search_path = public;
CREATE OR REPLACE VIEW public.v_acct_req_spend AS
 SELECT id,
    amount,
    COALESCE(( SELECT site_settings.value
           FROM svc.site_settings
          WHERE site_settings.key = 'acct.req_tolerance_pct'::text), '10'::text)::integer AS tol_pct,
    floor((amount * (100 + COALESCE(( SELECT site_settings.value
           FROM svc.site_settings
          WHERE site_settings.key = 'acct.req_tolerance_pct'::text), '10'::text)::integer))::numeric / 100.0)::bigint AS limit_amount,
    COALESCE(( SELECT sum(p.total) AS sum
           FROM acct_purchases p
          WHERE p.requisition_id = r.id AND p.state = 'ACTIVE'::text), 0::numeric)::bigint + COALESCE(( SELECT sum(c.amount) AS sum
           FROM acct_expense_claims c
          WHERE c.requisition_id = r.id AND (c.state = ANY (ARRAY['REQUESTED'::text, 'APPROVED'::text, 'PAID'::text]))), 0::numeric)::bigint AS spent,
    (( SELECT count(*) AS count
           FROM acct_purchases p
          WHERE p.requisition_id = r.id AND p.state = 'ACTIVE'::text))::integer + (( SELECT count(*) AS count
           FROM acct_expense_claims c
          WHERE c.requisition_id = r.id AND (c.state = ANY (ARRAY['REQUESTED'::text, 'APPROVED'::text, 'PAID'::text]))))::integer AS links
   FROM acct_requisitions r;
