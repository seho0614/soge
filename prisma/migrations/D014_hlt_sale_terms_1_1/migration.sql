-- =====================================================================
-- D014 — 건강상품 판매 약관에 반품 배송비 조항 (2026-10-02 사장님 결정 「발행하고 적용」)
--
--   D009 로 회원 사정 반품의 왕복 배송비(6,000원)를 환불액에서 빼기 시작했습니다.
--   판매 약관(HLT_SALE) 제3조는 「단순 변심 — 회원 부담」만 적고 **금액이 없습니다.**
--   약관에 없는 돈을 빼면 다툼이 되므로 조항을 넣습니다.
--
--   · 아직 발행 전인 판(새 설치 — 기준선 초안)  → 본문에 조항을 넣습니다. 그대로 1.0 으로 발행됩니다.
--   · 이미 발행된 판(쓰던 DB)                   → 조항을 넣은 **다음 판(1.1)을 만들어 발행**하고 이전 판은 보관합니다
--                                                (시행 = 이 마이그레이션이 도는 시각). 동의 이력이 참조하므로 지우지 않습니다.
--   · 조항이 이미 들어 있으면 건너뜁니다.
--
--   금액을 바꾸려면 src/modules/health/health-policy.ts 와 약관을 함께 바꾸고 새 판을 발행하십시오.
--   재실행 안전.
-- =====================================================================
DO $$
DECLARE
  r record;
  v_body text;
  v_ver text;
  -- 본문이 「제○조」 형식(기준선 C880)일 때 — 제3조(반품 비용) 표 아래에 항을 덧붙입니다
  v_articles text :=
    E'**회원 사정(단순 변심 · 잘못 주문)으로 반품**하시면 **왕복 배송비 6,000원**\n' ||
    E'(보내 드린 배송비 3,000원 + 돌려받는 배송비 3,000원)을 **환불 금액에서 뺍니다**\n' ||
    E'(전자상거래법 18조 9항 — 반환에 드는 비용은 소비자 부담). 위약금이나 손해배상은 받지 않습니다.\n\n' ||
    E'| 경우 | 환불 금액 |\n|---|---|\n' ||
    E'| 무료배송 주문(3만원 이상) | 결제 금액 − 6,000원 |\n' ||
    E'| 배송비를 내신 주문 | 결제 금액(배송비 포함) − 6,000원 |\n' ||
    E'| 발송 전 취소 | 전액 |\n' ||
    E'| 상품 하자 · 오배송 · 표시·광고와 다름 · 배송 지연 | 전액 (배송비를 받지 않습니다) |\n\n';
  -- 그 밖의 형식(초안 생성기 등)일 때 — 소제목과 함께
  v_section text;
BEGIN
  v_section := E'### 반품 배송비 — 고객 사정이면 왕복 6,000원\n\n' || v_articles;

  FOR r IN
    SELECT * FROM public.terms
     WHERE code = 'HLT_SALE' AND status <> 'ARCHIVED'
       AND position('왕복 배송비 6,000원' IN body) = 0
     ORDER BY (status = 'PUBLISHED') DESC, version
  LOOP
    IF position(E'## 제4조 (환불)' IN r.body) > 0 THEN
      v_body := replace(r.body, E'## 제4조 (환불)', v_articles || E'## 제4조 (환불)');
    ELSIF position(E'## 3. 환불은' IN r.body) > 0 THEN
      v_body := replace(r.body, E'## 3. 환불은', v_section || E'## 3. 환불은');
    ELSE
      v_body := r.body || E'\n\n' || v_section;
    END IF;

    IF r.status <> 'PUBLISHED' THEN
      -- 아직 발행 전 — 본문만 고칩니다 (발행은 기존 절차가 합니다)
      UPDATE public.terms SET body = v_body WHERE code = r.code AND version = r.version;
      RAISE NOTICE 'HLT_SALE % (%) 초안에 반품 배송비 조항 추가', r.version, r.status;
    ELSE
      -- 발행된 판 — 다음 판 번호를 찾아 새로 발행
      v_ver := split_part(r.version, '.', 1) || '.' || (split_part(r.version, '.', 2)::int + 1);
      WHILE EXISTS (SELECT 1 FROM public.terms WHERE code = 'HLT_SALE' AND version = v_ver
                       AND status IN ('PUBLISHED','ARCHIVED')) LOOP
        v_ver := split_part(v_ver, '.', 1) || '.' || (split_part(v_ver, '.', 2)::int + 1);
      END LOOP;
      INSERT INTO public.terms (code, version, title, body, is_required, effective_from, status, display_order, gwan_code)
      VALUES ('HLT_SALE', v_ver, r.title, v_body, r.is_required, 'infinity', 'LEGAL_REVIEW', r.display_order, r.gwan_code)
      ON CONFLICT (code, version) DO UPDATE SET body = EXCLUDED.body, title = EXCLUDED.title;
      UPDATE public.terms SET status = 'PUBLISHED', effective_from = now(), blocked_by = NULL
       WHERE code = 'HLT_SALE' AND version = v_ver;
      UPDATE public.terms SET status = 'ARCHIVED'
       WHERE code = 'HLT_SALE' AND version <> v_ver AND status = 'PUBLISHED';
      RAISE NOTICE 'HLT_SALE % 발행 — 반품 배송비 조항 추가 (이전 % 는 보관)', v_ver, r.version;
    END IF;
  END LOOP;
END $$;
