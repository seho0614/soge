-- v10.31 (w2 · 10/10 「시안 기준」) — 중개사 인증의 「보증(공제)」 · 제출 서류
--
--   시안 「내 인증 상태」(SB-BIZ-BRK-011)의 보증(공제) 칸 — 기관 · 증서 · 금액 · 기간, 신청(SB-BIZ-BRK-010)의 제출 서류 체크 4개
--   (중개사무소 등록증 · 보증(공제) 증서 · 공인중개사 자격증 · 기타). 서류 파일은 BROKER_DOC(신청자 · 운영만 열람).
--   보증 기간이 끝나면(guarantee_until < 오늘) 인증 상태 화면에 「보증 만료」를 알리고, 운영의 재확인 대상입니다(v_broker_guarantee_due).

ALTER TABLE public.broker_verifications
  ADD COLUMN IF NOT EXISTS guarantee_org     text CHECK (guarantee_org IS NULL OR length(btrim(guarantee_org)) BETWEEN 2 AND 60),
  ADD COLUMN IF NOT EXISTS guarantee_cert_no text CHECK (guarantee_cert_no IS NULL OR length(btrim(guarantee_cert_no)) BETWEEN 2 AND 60),
  ADD COLUMN IF NOT EXISTS guarantee_amount  numeric(14,0) CHECK (guarantee_amount IS NULL OR guarantee_amount > 0),
  ADD COLUMN IF NOT EXISTS guarantee_from    date,
  ADD COLUMN IF NOT EXISTS guarantee_until   date,
  ADD COLUMN IF NOT EXISTS submitted_docs    text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS doc_file_ids      uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.broker_verifications DROP CONSTRAINT IF EXISTS ck_broker_guarantee_period;
ALTER TABLE public.broker_verifications ADD CONSTRAINT ck_broker_guarantee_period
  CHECK (guarantee_from IS NULL OR guarantee_until IS NULL OR guarantee_until > guarantee_from);
ALTER TABLE public.broker_verifications DROP CONSTRAINT IF EXISTS ck_broker_submitted_docs;
ALTER TABLE public.broker_verifications ADD CONSTRAINT ck_broker_submitted_docs
  CHECK (submitted_docs <@ ARRAY['REG_CERT','GUARANTEE','LICENSE','ETC']::text[]);
COMMENT ON COLUMN public.broker_verifications.submitted_docs IS
  'v10.31 — 제출 서류 체크(시안 4개): REG_CERT 중개사무소 등록증 · GUARANTEE 보증(공제) 증서 · LICENSE 공인중개사 자격증 · ETC 기타.';

INSERT INTO public.code_labels (domain, code, label, short_label, sort_order) VALUES
  ('broker.doc','REG_CERT','중개사무소 등록증','등록증',1), ('broker.doc','GUARANTEE','보증(공제) 증서','보증 증서',2),
  ('broker.doc','LICENSE','공인중개사 자격증','자격증',3), ('broker.doc','ETC','기타','기타',4)
ON CONFLICT (domain, code) DO NOTHING;

CREATE OR REPLACE VIEW public.v_broker_guarantee_due AS
SELECT v.id, v.business_id, b.company_name, v.guarantee_org, v.guarantee_until, v.state
  FROM public.broker_verifications v JOIN public.businesses b ON b.id = v.business_id
 WHERE v.state = 'VERIFIED' AND (v.guarantee_until IS NULL OR v.guarantee_until < (now() AT TIME ZONE 'Asia/Seoul')::date + 30);
COMMENT ON VIEW public.v_broker_guarantee_due IS 'v10.31 — 보증(공제) 자료가 없거나 30일 안에 끝나는 인증 중개사(운영 재확인 대상).';
