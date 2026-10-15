-- =====================================================================
-- D028 — 판매 약관(HLT_SALE) 제3조에 교환 비용 (2026-10-08 「약관 확정」 · v10.26)
--
--   D027 로 회원 사정(단순 변심 · 잘못 주문) 교환의 왕복 배송비 6,000원을 **교환 신청 때 결제**받기 시작했습니다(10/8 A-1 ①).
--   지금 약관 제3조는 「반품 비용」만 적고 교환 비용이 없습니다. 약관에 없는 돈을 받으면 다툼이 되므로 조항을 넣습니다.
--   전자상거래법 18조 9항 · 10항은 청약철회(반품) 때의 반환 비용만 정하므로, 교환 비용은 약관에 근거를 둡니다.
--
--   확정 문안(10/8):
--     제3조 (반품 · 교환 비용) — 사유별 부담 표 · ① 반품(지금 글 그대로) · ② 교환(신청 때 결제 · 반려/회사 사정이면 전액 돌려드림)
--     · ③ 교환할 상품이 없을 때(14일까지 기다린 뒤 반품 · 원하면 바로 · 반품 배송비를 빼지 않고 전액 환불 · 교환 배송비도 돌려드림 — 10/8 답 「빼지 않음」)
--     · 환불 금액 표에 두 줄(회원 사정 교환 · 회사 사정/반려된 교환)
--
--   D014 · D024 와 같은 방식입니다.
--     · 아직 발행 전인 판(새 설치)  → 본문만 고칩니다. 그대로 발행됩니다.
--     · 이미 발행된 판(쓰던 DB)     → 고친 **다음 판을 만들어 발행**하고 이전 판은 보관합니다(시행 = 이 마이그레이션이 도는 시각).
--                                     필수 약관의 새 판이므로 **이미 동의한 회원은 다시 동의**하게 됩니다.
--     · 조항이 이미 들어 있으면(「반품 · 교환 비용」) 건너뜁니다. 재실행 안전.
--   금액을 바꾸려면 src/modules/health/health-policy.ts(HLT_EXCHANGE_SHIP_ROUND_TRIP · HLT_EXCHANGE_WAIT_DAYS)와 약관을 함께 바꾸고 새 판을 발행하십시오.
--   ★ 시행일 · 사전 공지 기간(회원에게 불리한 변경)은 법령 원문으로 추가 확인이 필요합니다 — 운영 적용 전에 법무 확인.
-- =====================================================================
DO $$
DECLARE
  r record; v_body text; v_ver text;
  v_head_old text :=
    E'## 제3조 (반품 비용)\n| 사유 | 누가 냅니까 |\n|---|---|\n| 단순 변심 | 회원 |\n| 상품 하자 · 오배송 | **회사** |\n| 표시·광고와 다름 | **회사** |\n';
  v_head_new text :=
    E'## 제3조 (반품 · 교환 비용)\n| 사유 | 누가 냅니까 |\n|---|---|\n| 단순 변심 · 잘못 주문 | 회원 |\n| 상품 하자 · 오배송 · 표시·광고와 다름 · 배송 지연 | **회사** |\n';
  v_ret_old text := E'**회원 사정(단순 변심 · 잘못 주문)으로 반품**하시면';
  v_ret_new text := E'① **회원 사정(단순 변심 · 잘못 주문)으로 반품**하시면';
  v_row_anchor text := E'| 상품 하자 · 오배송 · 표시·광고와 다름 · 배송 지연 | 전액 (배송비를 받지 않습니다) |\n';
  v_rows text :=
    E'| 회원 사정 교환(단순 변심 · 잘못 주문) | 환불 없음 · 교환 배송비 6,000원 신청 때 결제 |\n' ||
    E'| 회사 사정 교환 · 반려된 교환 | 교환 배송비를 받지 않거나 전액 돌려드림 |\n';
  v_exchange text :=
    E'\n② **교환**은 환불 없이 같은 상품을 다시 보내 드립니다. 회원 사정(단순 변심 · 잘못 주문)으로 교환하시면\n' ||
    E'   **왕복 배송비 6,000원을 교환을 신청하실 때 결제**하십니다. 회사가 교환을 받지 않거나(반려)\n' ||
    E'   회사 사정(상품 하자 · 오배송 · 표시·광고와 다름 · 배송 지연)으로 판정되면 결제하신 금액을 **전액 돌려드립니다**.\n' ||
    E'③ **교환할 상품이 없을 때**에는 입고를 **14일까지** 기다린 뒤 반품으로 바꿔 드립니다. 원하시면 기다리지 않고\n' ||
    E'   바로 반품으로 바꿔 드립니다. 이때는 **반품 배송비를 빼지 않고 전액 환불**하며, 결제하신 교환 배송비도 돌려드립니다.\n';
BEGIN
  FOR r IN
    SELECT * FROM public.terms
     WHERE code = 'HLT_SALE' AND status <> 'ARCHIVED'
       AND position('반품 · 교환 비용' IN body) = 0
     ORDER BY (status = 'PUBLISHED') DESC, version
  LOOP
    v_body := r.body;
    IF position(v_head_old IN v_body) > 0 THEN
      v_body := replace(v_body, v_head_old, v_head_new);
    ELSE
      -- 다른 모양의 본문(초안 생성기 등) — 제목만 바꿉니다
      v_body := replace(v_body, '## 제3조 (반품 비용)', '## 제3조 (반품 · 교환 비용)');
    END IF;
    v_body := replace(v_body, v_ret_old, v_ret_new);
    IF position(v_row_anchor IN v_body) > 0 THEN
      v_body := replace(v_body, v_row_anchor, v_row_anchor || v_rows || v_exchange);
    ELSIF position(E'## 제4조 (환불)' IN v_body) > 0 THEN
      v_body := replace(v_body, E'## 제4조 (환불)', E'| 경우 | 환불 금액 |\n|---|---|\n' || v_rows || v_exchange || E'\n## 제4조 (환불)');
    ELSE
      v_body := v_body || E'\n\n### 반품 · 교환 비용\n\n' || E'| 경우 | 환불 금액 |\n|---|---|\n' || v_rows || v_exchange;
    END IF;
    IF v_body = r.body THEN CONTINUE; END IF;

    IF r.status <> 'PUBLISHED' THEN
      UPDATE public.terms SET body = v_body WHERE code = r.code AND version = r.version;
      RAISE NOTICE 'HLT_SALE % (%) 초안에 교환 비용 조항 추가', r.version, r.status;
    ELSE
      v_ver := split_part(r.version, '.', 1) || '.' || (split_part(r.version, '.', 2)::int + 1);
      WHILE EXISTS (SELECT 1 FROM public.terms WHERE code = r.code AND version = v_ver
                       AND status IN ('PUBLISHED','ARCHIVED')) LOOP
        v_ver := split_part(v_ver, '.', 1) || '.' || (split_part(v_ver, '.', 2)::int + 1);
      END LOOP;
      INSERT INTO public.terms (code, version, title, body, is_required, effective_from, status, display_order, gwan_code)
      VALUES (r.code, v_ver, r.title, v_body, r.is_required, 'infinity', 'LEGAL_REVIEW', r.display_order, r.gwan_code)
      ON CONFLICT (code, version) DO UPDATE SET body = EXCLUDED.body, title = EXCLUDED.title;
      UPDATE public.terms SET status = 'PUBLISHED', effective_from = now(), blocked_by = NULL
       WHERE code = r.code AND version = v_ver;
      UPDATE public.terms SET status = 'ARCHIVED'
       WHERE code = r.code AND version <> v_ver AND status = 'PUBLISHED';
      RAISE NOTICE 'HLT_SALE % 발행 — 교환 비용 조항 추가 (이전 % 는 보관)', v_ver, r.version;
    END IF;
  END LOOP;
END $$;
