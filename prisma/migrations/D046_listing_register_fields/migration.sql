-- v10.31 (w1 · 10/10 시안 기준 지시) — 소개하기 등록(SB-HOM-REG-010) · 수정(SB-HOM-REG-020)을 시안대로 만들기 위한 칸.
--   시안 「상품/서비스 등록하기」 5구역: ① 기본 정보(관 · 업종 · 등급 자동 · 상품/서비스명 · 한줄 소개 · 대표 이미지)
--   ② 상세 설명 ③ 소개 조건(소개비 · 계약 지원 · 문의 가능 시간 · 부담 주체 자동) ④ 지역 정보(우편번호 · 도로명 · 상세주소)
--   ⑤ 거래 및 운영 정보(매장 · 설비 규모 · 월매출 · 권리금 · 희망조건 · 인수지원 · 기타 지원 사항 — 시안: 관 · 업종에 따라 항목이 달라짐 → jsonb).
--   시안 수정 화면: 반려 사유 · 걸린 표현 · 「초안 저장」(재검수 없이 고친 내용을 잠시 둠) · 이력.
--   새 칸은 모두 비어 있다가 등록하는 사람이 채웁니다(지어낸 값 없음).

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS summary          text,   -- 한줄 소개(60자)
  ADD COLUMN IF NOT EXISTS contract_support text,   -- 계약 지원(시안 SUPPORT 목록)
  ADD COLUMN IF NOT EXISTS contact_hours    text,   -- 문의 가능 시간
  ADD COLUMN IF NOT EXISTS address          jsonb,  -- 소재지 {zip, road, detail, sido, sigungu} — 상세주소는 본인 · 운영만
  ADD COLUMN IF NOT EXISTS biz_info         jsonb;  -- 거래 및 운영 정보 {size, sales, premium, wish, handover, etc}

DO $$ BEGIN
  ALTER TABLE public.listings ADD CONSTRAINT listings_reg_text_len_check
    CHECK ((summary IS NULL OR length(summary) <= 60) AND (contact_hours IS NULL OR length(contact_hours) <= 60)
       AND (contract_support IS NULL OR contract_support IN ('계약서 검토 지원','세무 · 회계 지원','인수 인계 지원','교육 지원','지원 없음')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.listings.biz_info IS
  '시안 「거래 및 운영 정보」 — {size 매장·설비 규모, sales 월매출, premium 권리금, wish 희망조건, handover 인수지원, etc 기타 지원}. 관 · 업종별 항목이 확정(T-05)되기 전까지 같은 칸을 씁니다.';

-- 수정 초안 — 「초안 저장」: 공개 중인 매물을 건드리지 않고(재검수 없이) 고친 내용만 잠시 둡니다. 본인만 읽고 씁니다. 재검수 요청을 보내면 지웁니다.
CREATE TABLE IF NOT EXISTS public.listing_edit_drafts (
  listing_id  uuid PRIMARY KEY REFERENCES public.listings(id) ON DELETE CASCADE,
  owner_id    uuid NOT NULL REFERENCES public.accounts(id),
  title       text,
  body        text,
  desired_fee numeric(14,0) CHECK (desired_fee IS NULL OR desired_fee >= 0),
  saved_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listing_edit_drafts_len CHECK ((title IS NULL OR length(title) <= 100) AND (body IS NULL OR length(body) <= 5000))
);
COMMENT ON TABLE public.listing_edit_drafts IS
  'SB-HOM-REG-020 「초안 저장」 — 매물 수정 초안(본인만). 재검수 요청(PATCH /listings/{id})이 성공하면 지웁니다.';
