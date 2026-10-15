-- v10.31 (w1 · 10/10 시안 기준 지시) — 고객센터 문의 · 꼬리줄 · 중개 고지를 시안대로.

-- ① 문의(SB-HOM-ETC-030 · CSB-010): 시안 「관련 거래」 · 「첨부파일(이미지 · PDF 10MB · 최대 3개)」 · 챗봇에서 상담원 연결로 넘어온 문의 구분
ALTER TABLE public.inquiries
  ADD COLUMN IF NOT EXISTS deal_id         uuid REFERENCES public.deals(id),
  ADD COLUMN IF NOT EXISTS channel         text NOT NULL DEFAULT 'FORM',
  ADD COLUMN IF NOT EXISTS attachment_keys text[] NOT NULL DEFAULT '{}';
DO $$ BEGIN
  ALTER TABLE public.inquiries ADD CONSTRAINT inquiries_channel_check CHECK (channel IN ('FORM','BOT') AND cardinality(attachment_keys) <= 3);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.inquiries.channel IS 'FORM 문의하기 폼 · BOT 1:1 문의 챗봇에서 「상담원 연결」(지금까지의 대화가 본문에 첨부됨)';

-- 시안 문의 유형 5종(거래 · 매칭 · 정산 · 소개비 · 계정 · 사업자 인증 · 신고 · 분쟁 · 기타). 전의 6종(HOWTO · LISTING · FEE · BILLING · REPORT · ETC)은
--   이미 접수된 문의의 표시를 위해 남기고(is_active 그대로) 순서만 뒤로 둡니다 — 사용자 화면의 고르기는 새 5종만.
INSERT INTO public.code_labels (domain, code, label, sort_order) VALUES
  ('inquiry.category', 'DEAL', '거래 · 매칭', 1),
  ('inquiry.category', 'SETTLE', '정산 · 소개비', 2),
  ('inquiry.category', 'ACCOUNT', '계정 · 사업자 인증', 3),
  ('inquiry.category', 'DISPUTE', '신고 · 분쟁', 4)
ON CONFLICT (domain, code) DO NOTHING;
UPDATE public.code_labels SET sort_order = 5 WHERE domain = 'inquiry.category' AND code = 'ETC';
UPDATE public.code_labels SET sort_order = 10 + sort_order WHERE domain = 'inquiry.category' AND code IN ('HOWTO','LISTING','FEE','BILLING','REPORT') AND sort_order < 10;

-- ② 꼬리줄 링크(시안 「이용약관 · 개인정보처리방침 · 운영정책 · 분쟁조정 안내 · 고객센터」): 운영정책을 더하고(→ 이용안내 · 약관 전문 · 시안 FTLINK) 순서를 시안대로.
--   개발에만 있던 링크(위치기반 · 제3자 제공 동의 · 환불 정책)는 남겨 시안 다섯 개 뒤로 둡니다(지시 ③).
INSERT INTO public.footer_links (id, section, label, target_type, target_ref, tip, sort_order, is_active)
SELECT (SELECT coalesce(max(id), 0) + 1 FROM public.footer_links), 'GUIDE', '운영정책', 'SCREEN', 'SB-HOM-ETC-010', '이용안내에서 약관 전문을 보실 수 있습니다.', 3, true
 WHERE NOT EXISTS (SELECT 1 FROM public.footer_links WHERE label = '운영정책');
UPDATE public.footer_links SET sort_order = CASE label
    WHEN '이용약관' THEN 1 WHEN '개인정보처리방침' THEN 2 WHEN '운영정책' THEN 3
    WHEN '분쟁조정 안내' THEN 4 WHEN '고객센터' THEN 5
    WHEN '제3자 제공 동의' THEN 6 WHEN '환불 정책' THEN 7 WHEN '위치기반서비스 약관' THEN 8 ELSE sort_order END;
SELECT setval(pg_get_serial_sequence('public.footer_links', 'id'), (SELECT max(id) FROM public.footer_links));

-- ③ 중개 고지 문구 — 시안 문구로(첫 문장은 전자상거래법 제20조 고지 그대로 · 둘째 문장은 시안)
UPDATE public.site_settings
   SET value = '소개뱅크는 통신판매중개자이며 거래의 당사자가 아닙니다. 상품 · 서비스 · 사업기회에 대한 정보와 거래에 관한 책임은 등록자에게 있습니다.'
 WHERE key = 'legal.intermediary_notice';

-- ④ v10.31 가입 3단계(시안 scJoin 「부서 · 직위」 · 선택) — 담당자 직위를 계정에 둡니다. 거래 상대에게 보이는 칸이 아닙니다(나의공간 · 운영만).
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS job_title text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_job_title_len') THEN
    ALTER TABLE public.accounts ADD CONSTRAINT accounts_job_title_len CHECK (job_title IS NULL OR char_length(job_title) <= 60);
  END IF;
END $$;

-- ⑤ v10.31 대표 · 상세 이미지(시안 「소개하기 등록」 · 「소개받기 등록」 — JPG · PNG 최대 10MB · 최대 6장(대표 1 + 상세 5)).
--   올리는 길은 기존 파일 흐름(POST /files → PUT → complete)을 그대로 씁니다. 보이는 곳: 게시된 매물 · 열린 요청의 이미지 주소
--   (GET /listings/{id}/images/{n} · GET /requests/{id}/images/{n}) — 공개 범위는 그 글의 공개 범위를 따릅니다.
--   ★ 다른 묶음(W5 D072)이 ck_files_purpose 를 다시 만들면 LISTING_IMAGE · REQUEST_IMAGE 도 목록에 넣어야 합니다.
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS ck_files_purpose;
ALTER TABLE public.files ADD CONSTRAINT ck_files_purpose
  CHECK (purpose = ANY (ARRAY['OWNERSHIP_DOC','MARKETING_MATERIAL','PARTNER_GUIDE','PRODUCT_IMAGE','PARTNER_MEDIA','LISTING_IMAGE','REQUEST_IMAGE']));
INSERT INTO public.file_policies (purpose, content_type, max_bytes, ext) VALUES
  ('LISTING_IMAGE', 'image/jpeg', 10485760, 'jpg'), ('LISTING_IMAGE', 'image/png', 10485760, 'png'),
  ('REQUEST_IMAGE', 'image/jpeg', 10485760, 'jpg'), ('REQUEST_IMAGE', 'image/png', 10485760, 'png')
ON CONFLICT DO NOTHING;

-- ⑥ v10.31 고객센터 문의 첨부(시안 cs 「첨부파일 — 이미지 · PDF 10MB까지 (최대 3개)」) — inquiries.attachment_keys(위 ①)에 파일 id 를 담습니다.
--   보는 사람: 올린 사람 · 운영(fn_file_can_read 의 ADMIN · SUPER · REVIEWER). ★ ck_files_purpose 를 다시 만드는 묶음은 INQUIRY_ATTACHMENT 도 넣어야 합니다.
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS ck_files_purpose;
ALTER TABLE public.files ADD CONSTRAINT ck_files_purpose
  CHECK (purpose = ANY (ARRAY['OWNERSHIP_DOC','MARKETING_MATERIAL','PARTNER_GUIDE','PRODUCT_IMAGE','PARTNER_MEDIA','LISTING_IMAGE','REQUEST_IMAGE','INQUIRY_ATTACHMENT','BROKER_DOC']));
INSERT INTO public.file_policies (purpose, content_type, max_bytes, ext) VALUES
  ('INQUIRY_ATTACHMENT', 'image/jpeg', 10485760, 'jpg'), ('INQUIRY_ATTACHMENT', 'image/png', 10485760, 'png'),
  ('INQUIRY_ATTACHMENT', 'application/pdf', 10485760, 'pdf')
ON CONFLICT DO NOTHING;
