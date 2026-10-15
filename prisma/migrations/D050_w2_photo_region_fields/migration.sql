-- v10.31 (w2 · 10/10 「시안 기준」 지시 ① — 시안에 있는데 서버 자료가 없는 구역은 서버까지 만듦)
--   관 화면(소개장터 · 안심소개 · 소개창업)의 사진 · 지역 · 거래 금액 · 한줄 소개 · 매물번호 · 요청의 종류 · 지역 · 사진.
--   숫자를 지어내지 않습니다 — 모두 등록자가 넣은 값이거나 이미 있는 값(사업자 주소의 시 · 도 · 시군구)에서 옵니다.
--
--   ① 사진: files.purpose 에 LISTING_IMAGE(매물 사진) · REQUEST_IMAGE(요청 사진) · BROKER_DOC(중개사 제출 서류).
--      listing_media 에 file_id 를 달아 「올리기 확인(READY)을 마친 파일」만 매물에 붙게 합니다(전에는 아무 글자나 s3_key 로 들어갔음).
--      게시 중인 매물의 사진은 누구나 봅니다(GET /listings/{id}/photos/{n}) — fn_file_can_read 에도 같은 규칙.
--   ② 지역: regions 에 시 · 도 17곳(법정동 시도 코드 10자리). 시군구 코드는 넣지 않습니다(목록을 지어내지 않음) —
--      매물 · 요청의 시군구는 글자(region_detail)로 받고, 없으면 등록자 사업장 주소(businesses.sido · sigungu)를 씁니다.
--   ③ listings: 거래 금액(deal_amount) · 한줄 소개(summary) · 매물번호(listing_no — 사람이 읽는 번호) · 시군구 글자(region_detail).
--   ④ requests: 요청 종류(kind — 시안 탭 「상품 구매 · 서비스 의뢰 · 전문가 문의 · 업체 찾기 · 중고 구하기」) · 지역 · 사진.

-- ① 파일 용도 -----------------------------------------------------------------
-- ★ 합칠 때: 다른 묶음(w3 등)이 ck_files_purpose 를 다시 만들면 아래 세 값이 빠지지 않게 하나로 합치십시오.
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS ck_files_purpose;
ALTER TABLE public.files ADD CONSTRAINT ck_files_purpose
  /* 합침(v10.31) — 모든 묶음의 용도 합집합(w1 D049 · w2 · w5 D072 · D090 과 같은 목록) */
  CHECK (purpose = ANY (ARRAY['OWNERSHIP_DOC','MARKETING_MATERIAL','PARTNER_GUIDE','PRODUCT_IMAGE','PARTNER_MEDIA','LISTING_IMAGE','REQUEST_IMAGE','INQUIRY_ATTACHMENT','BROKER_DOC']));
INSERT INTO public.file_policies (purpose, content_type, max_bytes, ext) VALUES
  ('LISTING_IMAGE', 'image/jpeg', 10485760, 'jpg'), ('LISTING_IMAGE', 'image/png', 10485760, 'png'),
  ('REQUEST_IMAGE', 'image/jpeg', 10485760, 'jpg'), ('REQUEST_IMAGE', 'image/png', 10485760, 'png'),
  ('BROKER_DOC', 'application/pdf', 10485760, 'pdf'), ('BROKER_DOC', 'image/jpeg', 10485760, 'jpg'), ('BROKER_DOC', 'image/png', 10485760, 'png')
ON CONFLICT DO NOTHING;

ALTER TABLE public.listing_media ADD COLUMN IF NOT EXISTS file_id uuid REFERENCES public.files(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_listing_media_file ON public.listing_media (listing_id, file_id) WHERE file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listing_media_listing ON public.listing_media (listing_id, sort_order);
COMMENT ON COLUMN public.listing_media.file_id IS
  'v10.31 — 올리기 확인을 마친 LISTING_IMAGE 파일. 이 값이 있는 줄만 공개 사진으로 내보냅니다(GET /listings/{id}/photos/{n}). s3_key 는 그 파일의 storage_key 사본입니다.';

/* 매물 사진은 매물 주인의 파일 · LISTING_IMAGE · READY 만 붙습니다. 한 매물 10장까지. */
CREATE OR REPLACE FUNCTION public.fn_listing_media_guard()
 RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE f public.files; l record; n int;
BEGIN
  IF NEW.file_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO f FROM public.files WHERE id = NEW.file_id;
  SELECT owner_account_id INTO l FROM public.listings WHERE id = NEW.listing_id;
  IF f.id IS NULL OR f.status <> 'READY' OR f.purpose <> 'LISTING_IMAGE' THEN
    RAISE EXCEPTION 'LISTING_PHOTO_FILE: 올리기 확인을 마친 매물 사진만 붙일 수 있습니다.';
  END IF;
  IF f.owner_account_id <> l.owner_account_id THEN
    RAISE EXCEPTION 'LISTING_PHOTO_OWNER: 매물 주인이 올린 사진만 붙일 수 있습니다.';
  END IF;
  SELECT count(*) INTO n FROM public.listing_media WHERE listing_id = NEW.listing_id AND media_type = 'IMAGE' AND id <> NEW.id;
  IF n >= 10 THEN
    RAISE EXCEPTION 'LISTING_PHOTO_LIMIT: 사진은 한 매물에 10장까지입니다.';
  END IF;
  NEW.s3_key := f.storage_key; NEW.media_type := 'IMAGE';
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_listing_media_guard ON public.listing_media;
CREATE TRIGGER trg_listing_media_guard BEFORE INSERT OR UPDATE OF file_id ON public.listing_media
  FOR EACH ROW EXECUTE FUNCTION public.fn_listing_media_guard();

/* 파일 열기(GET /files/{id}) — 게시 중인 매물에 붙은 사진 · 게시 중인 요청의 사진은 로그인한 누구나 봅니다.
   그 밖의 규칙은 전과 같습니다(이 함수의 앞부분은 B 판 그대로). */
CREATE OR REPLACE FUNCTION public.fn_file_can_read(p_file uuid, p_account uuid, p_roles text[])
 RETURNS text LANGUAGE plpgsql STABLE AS $function$
DECLARE
  f public.files;
  v_partner boolean;
BEGIN
  SELECT * INTO f FROM public.files WHERE id = p_file;
  IF f.id IS NULL OR f.status <> 'READY' OR p_account IS NULL THEN RETURN 'NOT_FOUND'; END IF;
  IF f.owner_account_id = p_account THEN RETURN 'OK'; END IF;
  /* 심사 · 심의하는 사람 */
  IF p_roles && ARRAY['ADMIN','SUPER','REVIEWER'] THEN RETURN 'OK'; END IF;

  IF f.purpose = 'MARKETING_MATERIAL'
     AND EXISTS (SELECT 1 FROM public.marketing_materials m WHERE m.file_id = f.id AND m.state = 'APPROVED')
  OR f.purpose = 'PARTNER_GUIDE'
     AND EXISTS (SELECT 1 FROM public.partner_guides g WHERE g.file_id = f.id AND g.is_active) THEN
    SELECT EXISTS (SELECT 1 FROM public.partners p JOIN public.businesses b ON b.id = p.business_id
                    WHERE b.account_id = p_account AND p.status = 'ACTIVE') INTO v_partner;
    RETURN CASE WHEN v_partner THEN 'OK' ELSE 'PARTNER_ONLY' END;
  END IF;
  /* v10.31 — 공개된 매물 · 요청의 사진 */
  IF f.purpose = 'LISTING_IMAGE' AND EXISTS (
       SELECT 1 FROM public.listing_media m JOIN public.listings l ON l.id = m.listing_id
        WHERE m.file_id = f.id AND l.status = 'PUBLISHED') THEN RETURN 'OK'; END IF;
  IF f.purpose = 'REQUEST_IMAGE' AND EXISTS (
       SELECT 1 FROM public.requests r WHERE r.photo_file_id = f.id AND r.status = 'PUBLISHED') THEN RETURN 'OK'; END IF;
  /* 등기부 · 중개 서류는 신청자와 운영만 봅니다 */
  RETURN 'NOT_FOUND';
END $function$;

-- ② 지역(시 · 도) ---------------------------------------------------------------
--   법정동 코드의 시 · 도 자리(앞 2자리 + 0 여덟 개). 강원(51) · 전북(52)은 특별자치도 전환 뒤 코드입니다.
--   sido 는 짧은 이름 — 상담 신청 · 업체 활동 지역과 같은 규칙(src/common/region.ts normSido).
INSERT INTO public.regions (code, sido, sigungu, eupmyeondong, parent_code, is_active) VALUES
  ('1100000000','서울',NULL,NULL,NULL,true), ('2600000000','부산',NULL,NULL,NULL,true),
  ('2700000000','대구',NULL,NULL,NULL,true), ('2800000000','인천',NULL,NULL,NULL,true),
  ('2900000000','광주',NULL,NULL,NULL,true), ('3000000000','대전',NULL,NULL,NULL,true),
  ('3100000000','울산',NULL,NULL,NULL,true), ('3600000000','세종',NULL,NULL,NULL,true),
  ('4100000000','경기',NULL,NULL,NULL,true), ('5100000000','강원',NULL,NULL,NULL,true),
  ('4300000000','충북',NULL,NULL,NULL,true), ('4400000000','충남',NULL,NULL,NULL,true),
  ('5200000000','전북',NULL,NULL,NULL,true), ('4600000000','전남',NULL,NULL,NULL,true),
  ('4700000000','경북',NULL,NULL,NULL,true), ('4800000000','경남',NULL,NULL,NULL,true),
  ('5000000000','제주',NULL,NULL,NULL,true)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.regions ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 99;
/* 시안 「지역으로 찾기」 순서(서울 · 경기 · 인천 · 대전 · 대구 · 부산 · 울산 · 광주 · 제주) — 나머지는 「기타 지역」 */
UPDATE public.regions r SET sort_order = x.o FROM (VALUES
  ('1100000000',1),('4100000000',2),('2800000000',3),('3000000000',4),('2700000000',5),
  ('2600000000',6),('3100000000',7),('2900000000',8),('5000000000',9)) x(c,o) WHERE r.code = x.c;

/* 짧은 시 · 도 이름 → 시 · 도 코드 (사업자 주소 「서울특별시」 · 「서울」 둘 다) */
CREATE OR REPLACE FUNCTION public.fn_sido_code(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p IS NULL OR btrim(p) = '' THEN NULL
    WHEN p ~ '^서울' THEN '1100000000' WHEN p ~ '^부산' THEN '2600000000' WHEN p ~ '^대구' THEN '2700000000'
    WHEN p ~ '^인천' THEN '2800000000' WHEN p ~ '^광주' THEN '2900000000' WHEN p ~ '^대전' THEN '3000000000'
    WHEN p ~ '^울산' THEN '3100000000' WHEN p ~ '^세종' THEN '3600000000' WHEN p ~ '^경기' THEN '4100000000'
    WHEN p ~ '^강원' THEN '5100000000' WHEN p ~ '^(충북|충청북)' THEN '4300000000' WHEN p ~ '^(충남|충청남)' THEN '4400000000'
    WHEN p ~ '^(전북|전라북)' THEN '5200000000' WHEN p ~ '^(전남|전라남)' THEN '4600000000'
    WHEN p ~ '^(경북|경상북)' THEN '4700000000' WHEN p ~ '^(경남|경상남)' THEN '4800000000' WHEN p ~ '^제주' THEN '5000000000'
    ELSE NULL END
$$;

-- ③ 매물 항목 -------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.listing_no_seq START 1001;
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS deal_amount   numeric(16,0) CHECK (deal_amount IS NULL OR deal_amount >= 0),
  ADD COLUMN IF NOT EXISTS summary       text CHECK (summary IS NULL OR (length(btrim(summary)) BETWEEN 2 AND 60)),
  ADD COLUMN IF NOT EXISTS region_detail text CHECK (region_detail IS NULL OR length(btrim(region_detail)) BETWEEN 1 AND 30),
  ADD COLUMN IF NOT EXISTS listing_no    bigint;
UPDATE public.listings SET listing_no = nextval('public.listing_no_seq')
 WHERE listing_no IS NULL AND id IN (SELECT id FROM public.listings ORDER BY created_at, id);
ALTER TABLE public.listings ALTER COLUMN listing_no SET DEFAULT nextval('public.listing_no_seq');
ALTER TABLE public.listings ALTER COLUMN listing_no SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_listings_no ON public.listings (listing_no);
COMMENT ON COLUMN public.listings.deal_amount IS 'v10.31 — 거래(희망) 금액 · 원. 등록자가 넣습니다. 소개비율(소개비 ÷ 거래 금액) 정렬의 분모입니다. 플랫폼이 계산하지 않습니다(A-12).';
COMMENT ON COLUMN public.listings.summary IS 'v10.31 — 한줄 소개(시안 사업 기회 등록 「한줄 소개」 · 카드 설명). 2~60자.';
COMMENT ON COLUMN public.listings.listing_no IS 'v10.31 — 사람이 읽는 매물번호(시안 「매물번호 L-4471」). 1001 부터 늘어납니다. 주소는 여전히 id 입니다.';
COMMENT ON COLUMN public.listings.region_detail IS 'v10.31 — 시군구 글자(예: 수원시). 시 · 도는 listing_regions. 둘 다 없으면 등록자 사업장 주소를 씁니다(v_listing_region).';

/* 매물의 지역 — 매물에 넣은 시 · 도(listing_regions)가 먼저, 없으면 등록자 사업장 주소 */
CREATE OR REPLACE VIEW public.v_listing_region AS
SELECT l.id AS listing_id,
       coalesce(lr.code, fn_sido_code(b.sido)) AS sido_code,
       coalesce(lr.sido, rg.sido)              AS sido,
       CASE WHEN lr.code IS NOT NULL THEN l.region_detail
            ELSE coalesce(l.region_detail, nullif(split_part(btrim(b.sigungu), ' ', 1), '')) END AS sigungu
  FROM public.listings l
  LEFT JOIN LATERAL (
    SELECT r.code, r.sido FROM public.listing_regions x JOIN public.regions r ON r.code = x.region_code
     WHERE x.listing_id = l.id ORDER BY r.sort_order, r.code LIMIT 1) lr ON true
  LEFT JOIN LATERAL (
    SELECT bb.sido, bb.sigungu FROM public.businesses bb
     WHERE bb.account_id = l.owner_account_id AND bb.verified_at IS NOT NULL
     ORDER BY bb.verified_at DESC LIMIT 1) b ON true
  LEFT JOIN public.regions rg ON rg.code = fn_sido_code(b.sido);
COMMENT ON VIEW public.v_listing_region IS
  'v10.31 — 매물 카드의 「경기 수원시」. 매물에 넣은 시 · 도가 먼저, 없으면 인증된 사업장 주소의 시 · 도 · 시군구(첫 낱말). 지역으로 거르기도 이 뷰를 씁니다.';

-- ④ 요청 항목 -------------------------------------------------------------------
ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS kind          text CHECK (kind IS NULL OR kind = ANY (ARRAY['GOODS','SERVICE','EXPERT','COMPANY','USED'])),
  ADD COLUMN IF NOT EXISTS region_code   text REFERENCES public.regions(code),
  ADD COLUMN IF NOT EXISTS region_detail text CHECK (region_detail IS NULL OR length(btrim(region_detail)) BETWEEN 1 AND 30),
  ADD COLUMN IF NOT EXISTS photo_file_id uuid REFERENCES public.files(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_requests_kind ON public.requests (gwan_code, kind, created_at DESC) WHERE status = 'PUBLISHED';
COMMENT ON COLUMN public.requests.kind IS
  'v10.31 — 요청 종류(시안 소개장터 메인 탭): GOODS 상품 구매 · SERVICE 서비스 의뢰 · EXPERT 전문가 문의 · COMPANY 업체 찾기 · USED 중고 구하기. 요청자가 고릅니다(비우면 「전체」에만).';

INSERT INTO public.code_labels (domain, code, label, short_label, sort_order) VALUES
  ('request.kind','GOODS','상품 구매','상품 구매',1), ('request.kind','SERVICE','서비스 의뢰','서비스 의뢰',2),
  ('request.kind','EXPERT','전문가 문의','전문가 문의',3), ('request.kind','COMPANY','업체 찾기','업체 찾기',4),
  ('request.kind','USED','중고 구하기','중고 구하기',5)
ON CONFLICT (domain, code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_request_photo_guard()
 RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE f public.files;
BEGIN
  IF NEW.photo_file_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN IF NEW.photo_file_id IS NOT DISTINCT FROM OLD.photo_file_id THEN RETURN NEW; END IF; END IF;
  SELECT * INTO f FROM public.files WHERE id = NEW.photo_file_id;
  IF f.id IS NULL OR f.status <> 'READY' OR f.purpose <> 'REQUEST_IMAGE' OR f.owner_account_id <> NEW.owner_account_id THEN
    RAISE EXCEPTION 'REQUEST_PHOTO_FILE: 요청자가 올리기 확인을 마친 요청 사진만 붙일 수 있습니다.';
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_request_photo_guard ON public.requests;
CREATE TRIGGER trg_request_photo_guard BEFORE INSERT OR UPDATE OF photo_file_id ON public.requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_request_photo_guard();
