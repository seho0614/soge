-- v10.31 (W5 · 10/10 시안 기준) — 제휴 영업 대시보드(SB-AFC-DSH-010) · 정산내역(SB-AFC-STL-010)
--
--   1) 추천상품의 「🔥 인기 · ❤ 고수익」 표지와 상품 사진 — 운영이 정하는 칸(promo_tag · image_path).
--      표지가 비어 있으면 「인기」만 실제 주문으로 셉니다(최근 7일 주문 상위 3 · 1건 이상). 고수익은 운영이 붙입니다.
--   2) 파트너 등급 · 다음 등급까지 — 등급 기준(이번 달 확정 수익)을 표에 둡니다. **기준은 운영이 정합니다**(시안에 금액 기준이 없어 채우지 않음 —
--      비어 있으면 화면은 「다음 등급 기준은 운영이 정합니다」).
--   3) 정산 예정일 — 시안 「12월 10일 정산 예정」 · 파트너센터 「지급일 익월 10일」: 매달 10일(설정).
--   4) 결함 — 정산 기간이 거꾸로 된 줄(시험 자료 「2029-07-09 ~ 2029-02-10」)을 바로잡고, 다시 생기지 않게 막습니다(CHECK).

ALTER TABLE public.affiliate_products ADD COLUMN promo_tag text CHECK (promo_tag IS NULL OR promo_tag IN ('HOT','HIGH'));
ALTER TABLE public.affiliate_products ADD COLUMN image_path text
  CHECK (image_path IS NULL OR image_path ~ '^(/[A-Za-z0-9._/-]{1,200}|https://[A-Za-z0-9.-]+/[A-Za-z0-9._/%?=&-]{0,300})$');
COMMENT ON COLUMN public.affiliate_products.promo_tag IS '추천상품 표지 — HOT 🔥인기 · HIGH ❤고수익(운영). 비면 인기만 최근 7일 주문으로 셈';
COMMENT ON COLUMN public.affiliate_products.image_path IS '추천상품 사진(사이트 경로 /… 또는 https 주소) — 운영';

CREATE TABLE public.partner_grade_rules (
  grade            text PRIMARY KEY CHECK (grade IN ('BRONZE','SILVER','GOLD','PLATINUM')),
  rank             int NOT NULL UNIQUE,
  min_month_earned bigint CHECK (min_month_earned IS NULL OR min_month_earned >= 0),
  note             text,
  updated_by       uuid REFERENCES public.accounts(id),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.partner_grade_rules(grade, rank, note) VALUES
  ('BRONZE', 1, '시작 등급'), ('SILVER', 2, '기준 금액은 운영이 정합니다'),
  ('GOLD', 3, '기준 금액은 운영이 정합니다'), ('PLATINUM', 4, '기준 금액은 운영이 정합니다');
COMMENT ON TABLE public.partner_grade_rules IS '파트너 등급 기준(이번 달 확정 제휴수수료). 비어 있으면 「다음 등급까지」를 계산하지 않습니다(숫자를 지어내지 않음)';

INSERT INTO public.site_settings(key, value, description, value_pattern, value_example) VALUES
 ('affiliate.payout_day', '10', '제휴수수료 · 파트너 정산 지급일(매달 며칠 — 익월). 시안 「익월 10일」', '^([1-9]|1[0-9]|2[0-8])$', '10')
ON CONFLICT (key) DO NOTHING;

-- 결함: 정산 기간 역전
UPDATE public.partner_settlements
   SET period_from = period_to, period_to = period_from
 WHERE period_from > period_to;
ALTER TABLE public.partner_settlements ADD CONSTRAINT ck_pstl_period CHECK (period_from <= period_to);
