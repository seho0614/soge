-- v10.31 (w6) — INV-9(소개비 공제 금지) 검사 범위에 외부 송출(adx_) 정산을 예외로 더합니다.
--   D084 adx_statements.withholding 은 퍼블리셔 광고 수익에서 떼는 **원천징수(소득세 3.3%)** 칸입니다.
--   소개비가 아니므로 INV-9(소개비는 공제 없이 전액) 대상이 아니고, 제휴(affiliate_) · 파트너(partner_) 정산의
--   원천징수 칸과 같은 까닭으로 예외에 둡니다. 소개형 관(deals · settlements · deal_contracts …)의 공제 0 은 그대로입니다.
--   결정 기록: /home/claude/work/v3/w6_decisions.md P11-a
CREATE OR REPLACE FUNCTION public.fn_is_fee_exempt(p_table text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT p_table ~ '^(hlt_|v_hlt_)'              -- 건강몰 직판 대금
      OR p_table ~ '^(affiliate_|v_affiliate_)'   -- 제휴 마케팅비
      OR p_table ~ '^(partner_|v_p(order|stl|artner)_)'   -- 파트너 트랙
      OR p_table ~ '^(adx_|v_adx_)';              -- v10.31 외부 송출 퍼블리셔 수익(원천징수 — 소개비 아님)
$function$;

-- v10.31 (w6) — 정산 상태 라벨 정합 검사(v_settlement_label_gap · 공격 검정 I-02)에 APPROVED(D080 정산 승인 단계)를 더합니다.
CREATE OR REPLACE VIEW public.v_settlement_label_gap AS
 WITH allowed AS (
         SELECT unnest(ARRAY['REQUESTED'::text, 'APPROVED'::text, 'PAID'::text, 'HELD'::text, 'REJECTED'::text]) AS code
        )
 SELECT a.code,
    (l.code IS NULL) AS label_missing
   FROM (allowed a
     LEFT JOIN code_labels l ON (((l.domain = 'settlement.status'::text) AND (l.code = a.code))))
  WHERE (l.code IS NULL)
UNION ALL
 SELECT l.code,
    false AS label_missing
   FROM code_labels l
  WHERE ((l.domain = 'settlement.status'::text) AND (NOT (l.code IN ( SELECT allowed.code
           FROM allowed))));
