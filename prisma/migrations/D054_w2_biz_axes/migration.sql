-- v10.31 (w2 · 10/10 「시안 기준」) — 소개창업 축 4개(창업 · 인력 · 운영지원 · 정보)의 자료 · 정책 원문
--
--   시안 소개창업(SB-BIZ-MAIN-010 · #/g/biz · /jobs · /advisory · /info)과 상세 4종
--   (공고 SB-BIZ-JOB-020 · 자문 서비스 SB-BIZ-SVC-020 · 정책 SB-BIZ-POL-020 · 교육 SB-BIZ-EDU-020) · 정책 원문(SB-BIZ-POL-030).
--   전에는 서버에 이 자료가 없어 「창업」 축 하나만 그렸습니다.
--
--   · 인력(JOB) — **도급으로만 잇습니다 · 개인은 노출하지 않습니다**(A-09 회신 · 직업안정법 · 파견법).
--       인증 사업자(인력대행 · 헤드헌팅 · 채용 기업)만 올리고, 표는 contract_type = 'OUTSOURCE' 로만 받습니다.
--       「업체 소개 요청」(JOB_INTRO)은 요청한 사람의 「지원」 갈래에 쌓입니다. 「빠른 매칭」은 biz_quick_matches.
--   · 운영지원(SVC) — 창업 컨설팅 · 회사 운영 자문. 인증 사업자가 올리고, 「견적 요청」(SVC_QUOTE)을 받습니다.
--   · 정보(POL · EDU) — 정책 소개 · 창업 교육. **소개비 구조 밖**(거래 없음 · INV-9 대상 아님). 운영이 올립니다.
--       정책은 원문 자료(공고명 · 주관 기관 · 지원 규모 · 신청 기한 · 원문 주소 · 지원 내용 표)를 함께 둡니다.
--   · 번호(item_no)는 사람이 읽는 번호 — 시안처럼 9101 부터. 주소 /biz/job/{번호} · /biz/advisory/{번호} · /policy/{번호} · /biz/edu/{번호}.
--   · is_sample = 시연용 자료(개발 시드 scripts/seed-w2-demo.sql). 화면에 「시연용」이라고 붙입니다.

CREATE SEQUENCE IF NOT EXISTS public.biz_axis_item_no_seq START 9101;
CREATE TABLE IF NOT EXISTS public.biz_axis_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_no          bigint NOT NULL DEFAULT nextval('public.biz_axis_item_no_seq') UNIQUE,
  kind             text NOT NULL CHECK (kind IN ('JOB','SVC','POL','EDU')),
  badge            text NOT NULL CHECK (length(btrim(badge)) BETWEEN 1 AND 12),
  is_hot           boolean NOT NULL DEFAULT false,
  title            text NOT NULL CHECK (length(btrim(title)) BETWEEN 5 AND 100),
  price_text       text CHECK (price_text IS NULL OR length(price_text) <= 60),
  cond_text        text CHECK (cond_text IS NULL OR length(cond_text) <= 80),
  sub_text         text CHECK (sub_text IS NULL OR length(sub_text) <= 120),
  description      text CHECK (description IS NULL OR length(description) <= 3000),
  spec             jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(spec) = 'array'),
  org              text CHECK (org IS NULL OR length(org) <= 60),
  region_text      text CHECK (region_text IS NULL OR length(region_text) <= 40),
  headcount        int CHECK (headcount IS NULL OR headcount BETWEEN 1 AND 9999),
  period_text      text CHECK (period_text IS NULL OR length(period_text) <= 40),
  due_date         date,
  contract_type    text CHECK (contract_type IS NULL OR contract_type = 'OUTSOURCE'),
  source_title     text CHECK (source_title IS NULL OR length(source_title) <= 120),
  source_org       text CHECK (source_org IS NULL OR length(source_org) <= 60),
  source_scale     text CHECK (source_scale IS NULL OR length(source_scale) <= 80),
  source_url       text CHECK (source_url IS NULL OR source_url ~ '^https://[^\s]{4,500}$'),
  source_rows      jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_rows) = 'array'),
  status           text NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('DRAFT','PUBLISHED','CLOSED','HIDDEN')),
  hidden_reason    text,
  owner_account_id uuid NOT NULL REFERENCES public.accounts(id),
  business_id      uuid REFERENCES public.businesses(id),
  is_sample        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'JOB' OR contract_type = 'OUTSOURCE'),
  CHECK (kind NOT IN ('JOB','SVC') OR business_id IS NOT NULL),
  CHECK (status <> 'HIDDEN' OR hidden_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_biz_axis_items_pub ON public.biz_axis_items (kind, is_hot DESC, created_at DESC) WHERE status = 'PUBLISHED';
COMMENT ON TABLE public.biz_axis_items IS
  'v10.31 — 소개창업 축 자료. JOB 공고(도급만 · 개인 노출 없음) · SVC 자문 서비스 · POL 정책 소개(원문 자료 포함) · EDU 창업 교육. 정보 축(POL · EDU)은 소개비 구조 밖입니다.';
COMMENT ON COLUMN public.biz_axis_items.price_text IS '대금 · 요금 · 지원 한도 · 수강료 — 올린 사람이 적은 글 그대로(플랫폼이 계산하지 않음).';
COMMENT ON COLUMN public.biz_axis_items.spec IS '내용표 [[항목, 값], …] — 시안 상세의 표.';
COMMENT ON COLUMN public.biz_axis_items.source_rows IS '정책 원문의 「지원 내용」 표 [[항목, 내용], …].';

/* 올리는 사람 — 공고 · 자문은 인증 사업자 본인, 정책 · 교육은 운영(앱이 역할을 봅니다). 금칙어는 같은 사전으로 막습니다 */
CREATE OR REPLACE FUNCTION public.fn_biz_axis_item_guard()
 RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE hit record; b record;
BEGIN
  SELECT * INTO hit FROM fn_check_banned_words(coalesce(NEW.title,'') || ' ' || coalesce(NEW.description,'') || ' ' || coalesce(NEW.sub_text,''), 'BIZ')
   WHERE severity = 'BLOCK' LIMIT 1;
  IF hit.word IS NOT NULL THEN RAISE EXCEPTION 'BANNED_WORD: "%"는 사용할 수 없는 표현입니다.', hit.word; END IF;
  IF NEW.kind IN ('JOB','SVC') THEN
    SELECT * INTO b FROM public.businesses WHERE id = NEW.business_id;
    IF b.id IS NULL OR b.verified_at IS NULL OR b.account_id <> NEW.owner_account_id THEN
      RAISE EXCEPTION 'BIZ_AXIS_BUSINESS: 공고 · 자문 서비스는 인증된 사업자 본인만 올릴 수 있습니다.';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_biz_axis_item_guard ON public.biz_axis_items;
CREATE TRIGGER trg_biz_axis_item_guard BEFORE INSERT OR UPDATE ON public.biz_axis_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_biz_axis_item_guard();

/* 업체 소개 요청(공고) · 견적 요청(자문) */
CREATE TABLE IF NOT EXISTS public.biz_axis_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      uuid NOT NULL REFERENCES public.biz_axis_items(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES public.accounts(id),
  kind         text NOT NULL CHECK (kind IN ('JOB_INTRO','SVC_QUOTE')),
  memo         text CHECK (memo IS NULL OR length(memo) <= 1000),
  status       text NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT','ANSWERED','CLOSED')),
  answer       text CHECK (answer IS NULL OR length(answer) <= 1000),
  answered_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, requester_id)
);
COMMENT ON TABLE public.biz_axis_requests IS
  'v10.31 — 공고의 「업체 소개 요청」 · 자문 서비스의 「견적 요청」. 요청자의 「지원」 갈래와 올린 업체의 받은 요청 목록이 이 표를 씁니다. 연락처는 담지 않습니다(답은 1:1 대화로).';

/* 빠른 매칭 — 「언제까지 · 몇 분 · 어디」. 개인을 잇지 않고 인력대행업체가 회신합니다 */
CREATE TABLE IF NOT EXISTS public.biz_quick_matches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  need_when    text NOT NULL CHECK (need_when IN ('TODAY','TOMORROW','WEEK')),
  headcount    int NOT NULL CHECK (headcount BETWEEN 1 AND 500),
  task         text NOT NULL CHECK (length(btrim(task)) BETWEEN 2 AND 40),
  place_text   text NOT NULL CHECK (length(btrim(place_text)) BETWEEN 2 AND 60),
  region_code  text REFERENCES public.regions(code),
  requester_id uuid NOT NULL REFERENCES public.accounts(id),
  status       text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.biz_quick_offers (
  match_id    uuid NOT NULL REFERENCES public.biz_quick_matches(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, business_id)
);
COMMENT ON TABLE public.biz_quick_matches IS
  'v10.31 — 소개창업 인력 축 「빠른 매칭」. 도급으로만 잇습니다 — 인증 사업자(인력대행업체)만 회신(biz_quick_offers)합니다. 요청자 이름 · 연락처는 공개 목록에 내보내지 않습니다(장소는 시 · 도만).';

/* 피해 사례 게시판(D053)도 같은 금칙어 사전 */
CREATE OR REPLACE FUNCTION public.fn_safety_case_banned()
 RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE hit record;
BEGIN
  SELECT * INTO hit FROM fn_check_banned_words(coalesce(NEW.title,'') || ' ' || coalesce(NEW.body,''), 'MNY')
   WHERE severity = 'BLOCK' LIMIT 1;
  IF hit.word IS NOT NULL THEN RAISE EXCEPTION 'BANNED_WORD: "%"는 사용할 수 없는 표현입니다.', hit.word; END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_safety_case_banned ON public.safety_cases;
CREATE TRIGGER trg_safety_case_banned BEFORE INSERT OR UPDATE OF title, body ON public.safety_cases
  FOR EACH ROW EXECUTE FUNCTION public.fn_safety_case_banned();
