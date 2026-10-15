-- v10.31 (w1 · 10/10 시안 기준 지시) — 소개받기(SB-HOM-REQ-010 · 020 · 030)를 시안대로 만들기 위한 칸.
--   시안 요청 카드(reqCard): 관 · 업종 · 🔒 회사명 비공개 · D-day · 제목 · 설명 · 📍 지역 · 📦 규모/수량 · 💰 예산(비공개 가능) · 요청 번호 ·
--     성사 시 예상 소개비 · 소개 제안하기 · 「제안 n건 · 공개 범위」.
--   시안 등록 폼(scReqNew): 관 · 업종 · 등급 · 제목 · 대표/상세 이미지 · 상세 내용 · 예상 소개비 · 문의 가능 시간 · 희망 지역 주소(우편번호 · 도로명 · 상세).
--   시안 요청 상세(scReqDetail): 요청 기업 · 지역 · 규모 · 희망 예산 · 공개 범위 · 요청 번호 + 받은 제안 + 「소개 제안하기」(소개할 업체 · 관계 · 제안 내용).
--   지어낸 값은 넣지 않습니다 — 새 칸은 모두 비어 있다가 등록하는 사람이 채웁니다.

-- ① 요청 칸
ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS region        text,                       -- 📍 지역(시 · 구) — 주소에서 화면이 채움
  ADD COLUMN IF NOT EXISTS address       jsonb,                      -- 희망 지역 주소 {zip, road, detail} — 상세주소는 요청자 본인 · 운영만
  ADD COLUMN IF NOT EXISTS quantity      text,                       -- 📦 규모 · 수량(자유 글 · 60자)
  ADD COLUMN IF NOT EXISTS contact_hours text,                       -- 문의 가능 시간(예: 평일 10:00 ~ 18:00)
  ADD COLUMN IF NOT EXISTS budget_open   boolean NOT NULL DEFAULT true,  -- 💰 예산 공개 여부(시안 budOpen)
  ADD COLUMN IF NOT EXISTS company_blind boolean NOT NULL DEFAULT false, -- 🔒 회사명 비공개(시안 blind)
  ADD COLUMN IF NOT EXISTS visibility    text NOT NULL DEFAULT 'ALL',    -- 공개 범위(시안 scope — 전체 · 회원 · 인증 회원)
  ADD COLUMN IF NOT EXISTS image_keys    text[] NOT NULL DEFAULT '{}'; -- 대표 · 상세 이미지(파일 키 · 최대 5)

DO $$ BEGIN
  ALTER TABLE public.requests ADD CONSTRAINT requests_visibility_check CHECK (visibility IN ('ALL','MEMBER','VERIFIED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.requests ADD CONSTRAINT requests_text_len_check
    CHECK ((quantity IS NULL OR length(quantity) <= 60) AND (contact_hours IS NULL OR length(contact_hours) <= 60)
       AND (region IS NULL OR length(region) <= 40) AND cardinality(image_keys) <= 5);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.requests.visibility IS
  '공개 범위(시안 「공개 범위」): ALL 누구나 · MEMBER 로그인 회원 · VERIFIED 본인인증 회원. 남의 회사 사정이 올라오는 자리라 요청마다 고릅니다(시안 안내 띠).';
COMMENT ON COLUMN public.requests.company_blind IS
  '회사명 비공개(시안 🔒) — 켜면 목록 · 상세에 요청 기업 이름 대신 업종 · 규모만 보입니다.';

-- ② 30일 자동 마감(시안 「요청은 등록 후 30일이 지나면 자동으로 닫힙니다」) — closes_at 을 채우는 곳이 없었습니다.
--    이미 있는 요청은 오늘부터 30일(지금 보이던 요청이 갑자기 사라지지 않게). 새 요청은 서버가 등록 때 now()+30일.
UPDATE public.requests SET closes_at = greatest(created_at, now()) + interval '30 days'
 WHERE closes_at IS NULL AND status IN ('IN_REVIEW','PUBLISHED','DRAFT');

-- ③ 소개 제안 칸(시안 「소개할 업체 · 업체와의 관계 · 제안 내용」) · 수락하면 열리는 대화
ALTER TABLE public.request_proposals
  ADD COLUMN IF NOT EXISTS company_name    text,
  ADD COLUMN IF NOT EXISTS relation        text,
  ADD COLUMN IF NOT EXISTS decided_at      timestamptz,
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.conversations(id);
DO $$ BEGIN
  ALTER TABLE public.request_proposals ADD CONSTRAINT request_proposals_relation_check
    CHECK (relation IS NULL OR relation IN ('CLIENT','PARTNER','ACQUAINTANCE','OWN','OTHER'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.request_proposals ADD CONSTRAINT request_proposals_company_len_check
    CHECK (company_name IS NULL OR length(btrim(company_name)) BETWEEN 1 AND 60);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO public.code_labels (domain, code, label) VALUES
  ('proposal.relation', 'CLIENT', '거래처'),
  ('proposal.relation', 'PARTNER', '협력사'),
  ('proposal.relation', 'ACQUAINTANCE', '지인 업체'),
  ('proposal.relation', 'OWN', '우리 회사'),
  ('proposal.relation', 'OTHER', '기타'),
  ('request.visibility', 'ALL', '전체'),
  ('request.visibility', 'MEMBER', '회원'),
  ('request.visibility', 'VERIFIED', '인증 회원')
ON CONFLICT DO NOTHING;

-- ④ 매물 등급 이름(시안 검색 결과 표 「등급」 — 골든 · 실버 · 브론즈, 시안 표기 그대로 가칭). listings.grade_code G1 · G2 · G3 와 짝.
INSERT INTO public.code_labels (domain, code, label, sort_order) VALUES
  ('listing.grade', 'G1', '골든', 1), ('listing.grade', 'G2', '실버', 2), ('listing.grade', 'G3', '브론즈', 3)
ON CONFLICT DO NOTHING;
