-- v10.31 (W5) — 확인비용 계산을 한 곳으로: fn_lead_fee_quote(리드, 파트너)
--   기준 = 그 파트너가 이 업종에 정한 최고 확인비용(승인된 서비스) → 없으면 업종 기준 단가 → 없으면 기본 단가(lead.default_fee)
--   금액 = round(기준 × 등급 비율) — 등급이 없으면(알림톡 연동 전) 기준 그대로(지금까지와 같음). 관 전용 비율이 있으면 그것(fn_lead_rate).
--   열람 과금(PartnerService.viewLead) · 상담 목록의 예상 확인비용 · 후보 판정(잔액에서 잡아 둘 몫)이 모두 이 함수를 씁니다.

CREATE FUNCTION public.fn_lead_fee_quote(p_lead uuid, p_partner uuid) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT round(
           coalesce((SELECT max(ps.top_fee) FROM partner_services ps
                      WHERE ps.partner_id = p_partner AND ps.category_id = l.category_id AND ps.status = 'APPROVED'),
                    c.lead_fee,
                    (SELECT value::numeric FROM site_settings WHERE key = 'lead.default_fee' AND value ~ '^[0-9]+$'),
                    0)
         * CASE WHEN l.grade IS NULL THEN 1 ELSE coalesce(fn_lead_rate(c.gwan_code, l.grade), 1) END)
    FROM leads l LEFT JOIN categories c ON c.id = l.category_id
   WHERE l.id = p_lead
$$;

CREATE OR REPLACE FUNCTION public.fn_lead_candidates(p_lead uuid)
 RETURNS TABLE(partner_id uuid, company text, grade text, partner_status text, service_ok boolean, qual_ok boolean, region_ok boolean, cap_ok boolean, already boolean, self_deal boolean, eligible boolean, reasons text[], unpaid numeric, unpaid_cap numeric, reserved numeric, fee numeric, recent_30d integer, last_assigned_at timestamp with time zone, weight numeric, score numeric, axis_ok boolean)
 LANGUAGE sql
 STABLE
AS $function$
  WITH s AS (
    SELECT (SELECT value::numeric FROM site_settings
             WHERE key = 'lead.default_fee' AND value ~ '^[0-9]+$') AS dfee
  ), l AS (
    SELECT l.id, l.category_id, l.sido, l.sigungu, l.requester_account_id,
           coalesce(c.lead_fee, s.dfee, 0) AS fee,
           r.mode AS rmode, coalesce(r.qual_code, r.code) AS qual
      FROM leads l
      JOIN categories c ON c.id = l.category_id
      CROSS JOIN s
      LEFT JOIN restricted_industries r
        ON r.code = c.restricted_code AND r.gwan_code = c.gwan_code AND r.is_active
     WHERE l.id = p_lead
  ), pool AS (
    SELECT DISTINCT ps.partner_id FROM partner_services ps JOIN l ON ps.category_id = l.category_id
    UNION
    SELECT d.partner_id FROM lead_deliveries d WHERE d.lead_id = p_lead
  ), x AS (
    SELECT p.id AS pid, b.company_name AS company, p.grade, p.status AS pstatus,
           EXISTS (SELECT 1 FROM partner_services ps
                    WHERE ps.partner_id = p.id AND ps.category_id = l.category_id
                      AND ps.status = 'APPROVED') AS service_ok,
           (l.rmode IS DISTINCT FROM 'GATED' OR EXISTS (
              SELECT 1 FROM qualification_reviews q
               WHERE q.business_id = p.business_id AND q.category_code = l.qual
                 AND q.state = 'APPROVED')) AS qual_ok,
           EXISTS (SELECT 1 FROM partner_regions g
                    WHERE g.partner_id = p.id AND g.sido = l.sido
                      AND (l.sigungu IS NULL OR g.sigungu = l.sigungu OR g.sigungu IN ('전체','*'))) AS region_ok,
           EXISTS (SELECT 1 FROM lead_deliveries d
                    WHERE d.lead_id = l.id AND d.partner_id = p.id) AS already,
           (l.requester_account_id IS NOT NULL AND b.account_id = l.requester_account_id) AS self_deal,
           coalesce((SELECT sum(f.amount) FROM lead_fees f
                      WHERE f.partner_id = p.id AND f.state = 'PENDING'), 0) AS unpaid,
           p.unpaid_cap,
           /* D070 — 선불 잔액(유상 + 보너스) */
           coalesce((SELECT cw.paid_balance + cw.bonus_balance FROM lead_cash_wallets cw
                      WHERE cw.partner_id = p.id), 0) AS balance,
           /* 아직 열지 않은 배정도 열면 청구됩니다 — 그만큼 한도를 잡아 둡니다 */
           coalesce((SELECT sum(fn_lead_fee_quote(d.lead_id, p.id))
                       FROM lead_deliveries d
                      WHERE d.partner_id = p.id AND d.state = 'DELIVERED'
                        AND d.expires_at IS NOT NULL AND d.expires_at > now()), 0) AS reserved,
           fn_lead_fee_quote(l.id, p.id) AS fee,
           (SELECT count(*)::int FROM lead_deliveries d
             WHERE d.partner_id = p.id AND d.state <> 'REVOKED'
               AND d.delivered_at > now() - interval '30 days') AS recent_30d,
           (SELECT max(d.delivered_at) FROM lead_deliveries d WHERE d.partner_id = p.id) AS last_at,
           coalesce(w.weight, 1) AS weight,
           EXISTS (SELECT 1 FROM mal_partner_axes ax
                    WHERE ax.business_id = p.business_id AND ax.axis = 'CONSULT'
                      AND ax.state = 'APPROVED') AS axis_ok
      FROM pool
      JOIN partners p   ON p.id = pool.partner_id
      JOIN businesses b ON b.id = p.business_id
      CROSS JOIN l CROSS JOIN s
      LEFT JOIN lead_assign_weights w ON w.grade = p.grade
  )
  SELECT x.pid, x.company, x.grade, x.pstatus,
         x.service_ok, x.qual_ok, x.region_ok,
         (x.unpaid < x.unpaid_cap AND x.balance - x.reserved >= x.fee) AS cap_ok,
         x.already, x.self_deal,
         (x.pstatus = 'ACTIVE' AND x.axis_ok AND x.service_ok AND x.qual_ok AND x.region_ok
          AND x.unpaid < x.unpaid_cap AND x.balance - x.reserved >= x.fee
          AND NOT x.already AND NOT x.self_deal) AS eligible,
         array_remove(ARRAY[
           CASE WHEN x.pstatus <> 'ACTIVE' THEN '활동 중 아님(' || x.pstatus || ')' END,
           CASE WHEN NOT x.axis_ok    THEN '상담 축 입점 승인 없음' END,
           CASE WHEN NOT x.service_ok THEN '이 업종의 승인된 서비스 없음' END,
           CASE WHEN NOT x.qual_ok    THEN '자격 심사 미통과' END,
           CASE WHEN NOT x.region_ok  THEN '활동 지역 밖' END,
           CASE WHEN x.unpaid >= x.unpaid_cap THEN '이전 후불 미납 한도 초과' END,
           CASE WHEN x.balance - x.reserved < x.fee THEN '리드 이용료 잔액 부족' END,
           CASE WHEN x.already        THEN '이미 배정함' END,
           CASE WHEN x.self_deal      THEN '신청자 본인 업체' END], NULL) AS reasons,
         x.unpaid, x.unpaid_cap, x.reserved, x.fee,
         x.recent_30d, x.last_at, x.weight,
         round(x.recent_30d / x.weight, 4) AS score,
         x.axis_ok
    FROM x
   ORDER BY 11 DESC, 20 ASC, 18 ASC NULLS FIRST, 1
$function$;
