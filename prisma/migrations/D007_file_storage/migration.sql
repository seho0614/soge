-- =====================================================================
-- D007 — 파일 올리기 (등기사항증명서 · 마케팅자료 · 파트너가이드)
--
--   전에는 화면이 문서 **이름**(docKey · file_key)만 받았습니다.
--   운영이 등기부를 "직접 보고 판단" 해야 하는데 볼 문서가 없었습니다.
--
--   흐름
--     1. POST /files            → files 행(UPLOADING) + 올릴 주소(S3 presigned PUT 또는 API 토큰 주소)
--     2. 브라우저가 그 주소로 파일을 PUT
--     3. POST /files/{id}/complete → 서버가 실제 바이트를 읽어 크기·해시·형식(매직바이트)을 보고 READY
--     4. 소유 확인 · 자료 · 가이드가 file id 를 가리킴 (아래 트리거가 용도·상태·주인을 봅니다)
--
--   막는 것은 DB 가 합니다
--     · 용도별 허용 형식 · 최대 크기     (file_policies — 운영이 표로 바꿉니다)
--     · 상태 전이 · 바이트 관련 열 불변    (fn_files_guard)
--     · 저장 키 형식 (경로 조작 불가)      (ck_files_storage_key)
--     · 연결 대상의 용도 · 상태 · 주인     (fn_file_ref_*)
--     · 누가 내려받을 수 있는가            (fn_file_can_read)
--   재실행 안전 (IF NOT EXISTS · ON CONFLICT · OR REPLACE)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 용도별 허용 형식 · 최대 크기
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.file_policies (
  purpose       text   NOT NULL,
  content_type  text   NOT NULL,
  max_bytes     bigint NOT NULL CHECK (max_bytes > 0 AND max_bytes <= 104857600),
  ext           text   NOT NULL CHECK (ext ~ '^[a-z0-9]{2,4}$'),
  PRIMARY KEY (purpose, content_type)
);
COMMENT ON TABLE public.file_policies IS
  '파일 용도별 허용 형식과 최대 크기. 서버가 미리 보고, files 트리거가 다시 봅니다. 형식 판정은 매직바이트 기준.';

INSERT INTO public.file_policies (purpose, content_type, max_bytes, ext) VALUES
  ('OWNERSHIP_DOC',      'application/pdf', 10485760, 'pdf'),
  ('OWNERSHIP_DOC',      'image/jpeg',      10485760, 'jpg'),
  ('OWNERSHIP_DOC',      'image/png',       10485760, 'png'),
  ('MARKETING_MATERIAL', 'application/pdf', 20971520, 'pdf'),
  ('MARKETING_MATERIAL', 'image/jpeg',      10485760, 'jpg'),
  ('MARKETING_MATERIAL', 'image/png',       10485760, 'png'),
  ('MARKETING_MATERIAL', 'video/mp4',       52428800, 'mp4'),
  ('PARTNER_GUIDE',      'application/pdf', 20971520, 'pdf'),
  ('PARTNER_GUIDE',      'image/jpeg',      10485760, 'jpg'),
  ('PARTNER_GUIDE',      'image/png',       10485760, 'png')
ON CONFLICT (purpose, content_type) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. 파일
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  purpose           text NOT NULL,
  original_name     text NOT NULL,
  content_type      text NOT NULL,           -- 올리는 사람이 밝힌 형식 (정책 표에 있어야 함)
  detected_type     text,                    -- 실제 바이트로 판정한 형식 (complete 때)
  size_bytes        bigint NOT NULL,
  sha256            text,
  storage_provider  text NOT NULL,
  storage_key       text NOT NULL UNIQUE,
  status            text NOT NULL DEFAULT 'UPLOADING',
  reject_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  deleted_at        timestamptz,
  CONSTRAINT ck_files_purpose  CHECK (purpose IN ('OWNERSHIP_DOC','MARKETING_MATERIAL','PARTNER_GUIDE')),
  CONSTRAINT ck_files_status   CHECK (status IN ('UPLOADING','READY','REJECTED','DELETED')),
  CONSTRAINT ck_files_provider CHECK (storage_provider IN ('S3','LOCAL')),
  CONSTRAINT ck_files_size     CHECK (size_bytes > 0),
  CONSTRAINT ck_files_sha256   CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  /* ★ 저장 키는 서버가 만듭니다. 이용자가 준 파일 이름은 키에 들어가지 않습니다 —
   *   ../ · 절대경로 · 역슬래시가 끼어들 자리가 없습니다. */
  CONSTRAINT ck_files_storage_key CHECK (
    storage_key ~ '^[a-z_]{3,30}/[0-9]{4}/[0-9]{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,4}$'),
  /* 보여 줄 이름에도 경로 구분자 · 제어문자가 없습니다 (내려받을 때 Content-Disposition 에 들어갑니다) */
  CONSTRAINT ck_files_name CHECK (
    length(original_name) BETWEEN 1 AND 160 AND original_name !~ '[/\\[:cntrl:]]'),
  CONSTRAINT ck_files_ready CHECK (
    status <> 'READY' OR (sha256 IS NOT NULL AND detected_type = content_type AND completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_files_owner  ON public.files (owner_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_status ON public.files (status, created_at);
COMMENT ON TABLE public.files IS
  '올린 파일. 바이트는 저장소(S3 또는 로컬)에 있고 여기에는 메타만 둡니다. READY 가 되어야 다른 표가 가리킬 수 있습니다.';

CREATE OR REPLACE FUNCTION public.fn_files_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_max bigint;
  v_pending int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'UPLOADING' THEN
      RAISE EXCEPTION 'FILE: 새 파일은 올리는 중(UPLOADING) 상태로만 만듭니다';
    END IF;
    SELECT max_bytes INTO v_max FROM public.file_policies
     WHERE purpose = NEW.purpose AND content_type = NEW.content_type;
    IF v_max IS NULL THEN
      RAISE EXCEPTION 'FILE: 이 용도에는 받지 않는 형식입니다 (%)', NEW.content_type;
    END IF;
    IF NEW.size_bytes > v_max THEN
      RAISE EXCEPTION 'FILE: 파일이 너무 큽니다 — 최대 % MB', round(v_max / 1048576.0, 1);
    END IF;
    /* 올리다 만 파일이 쌓이지 않게 — 한 시간에 20개까지 */
    SELECT count(*) INTO v_pending FROM public.files
     WHERE owner_account_id = NEW.owner_account_id AND status = 'UPLOADING'
       AND created_at > now() - interval '1 hour';
    IF v_pending >= 20 THEN
      RAISE EXCEPTION 'FILE: 올리는 중인 파일이 너무 많습니다. 잠시 후 다시 시도해 주십시오';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE — 바이트와 관련된 열은 바뀌지 않습니다
  IF NEW.owner_account_id IS DISTINCT FROM OLD.owner_account_id
     OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.content_type IS DISTINCT FROM OLD.content_type
     OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
     OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
     OR NEW.storage_provider IS DISTINCT FROM OLD.storage_provider
     OR NEW.original_name IS DISTINCT FROM OLD.original_name
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'FILE: 올린 파일의 주인 · 용도 · 형식 · 크기 · 위치는 바꿀 수 없습니다';
  END IF;
  IF OLD.status <> 'UPLOADING' AND (NEW.sha256 IS DISTINCT FROM OLD.sha256
                                     OR NEW.detected_type IS DISTINCT FROM OLD.detected_type) THEN
    RAISE EXCEPTION 'FILE: 확인이 끝난 파일의 해시 · 형식은 바꿀 수 없습니다';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
         (OLD.status = 'UPLOADING' AND NEW.status IN ('READY','REJECTED','DELETED'))
      OR (OLD.status IN ('READY','REJECTED') AND NEW.status = 'DELETED')) THEN
      RAISE EXCEPTION 'FILE: % 에서 % 로 바꿀 수 없습니다', OLD.status, NEW.status;
    END IF;
    IF NEW.status = 'READY' THEN NEW.completed_at := coalesce(NEW.completed_at, now()); END IF;
    IF NEW.status = 'REJECTED' AND coalesce(btrim(NEW.reject_reason), '') = '' THEN
      RAISE EXCEPTION 'FILE: 거절에는 사유가 필요합니다';
    END IF;
    IF NEW.status = 'DELETED' THEN
      IF EXISTS (SELECT 1 FROM public.owner_verifications WHERE doc_file_id = OLD.id)
         OR EXISTS (SELECT 1 FROM public.marketing_materials WHERE file_id = OLD.id)
         OR EXISTS (SELECT 1 FROM public.partner_guides WHERE file_id = OLD.id) THEN
        RAISE EXCEPTION 'FILE: 제출 · 등록에 쓰인 파일은 지울 수 없습니다';
      END IF;
      NEW.deleted_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_files_guard ON public.files;
CREATE TRIGGER trg_files_guard BEFORE INSERT OR UPDATE ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.fn_files_guard();

-- 행은 지우지 않습니다 (DELETED 상태로 남김). 감사 · 분쟁 때 무엇을 냈는지 보여야 합니다.
CREATE OR REPLACE FUNCTION public.fn_files_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  /* 계정이 지워지며 같이 지워지는 경우(ON DELETE CASCADE)는 통과시킵니다 */
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = OLD.owner_account_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'FILE: 파일 기록은 지우지 않습니다 — 상태를 DELETED 로 바꾸십시오';
END $$;
DROP TRIGGER IF EXISTS trg_files_no_delete ON public.files;
CREATE TRIGGER trg_files_no_delete BEFORE DELETE ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.fn_files_no_delete();

-- ---------------------------------------------------------------------
-- 3. 파일을 가리키는 곳
-- ---------------------------------------------------------------------
ALTER TABLE public.owner_verifications ADD COLUMN IF NOT EXISTS doc_file_id uuid
  REFERENCES public.files(id) ON DELETE SET NULL;
ALTER TABLE public.marketing_materials ADD COLUMN IF NOT EXISTS file_id uuid
  REFERENCES public.files(id) ON DELETE SET NULL;
ALTER TABLE public.partner_guides ADD COLUMN IF NOT EXISTS file_id uuid
  REFERENCES public.files(id) ON DELETE SET NULL;
ALTER TABLE public.partner_guides ADD COLUMN IF NOT EXISTS created_by uuid
  REFERENCES public.accounts(id) ON DELETE SET NULL;

/* 같은 등기부 파일로 매물 두 개를 확인받을 수 없습니다 */
CREATE UNIQUE INDEX IF NOT EXISTS ux_owner_verif_doc_file
  ON public.owner_verifications (doc_file_id) WHERE doc_file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mmat_file  ON public.marketing_materials (file_id) WHERE file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pguide_file ON public.partner_guides (file_id) WHERE file_id IS NOT NULL;

COMMENT ON COLUMN public.owner_verifications.doc_file_id IS '올린 등기사항증명서 (files). doc_key 는 호환용으로 파일 이름을 담습니다.';
COMMENT ON COLUMN public.marketing_materials.file_id IS '자료 파일 (files). file_key 는 호환용으로 파일 이름을 담습니다.';
COMMENT ON COLUMN public.partner_guides.file_id IS '가이드 첨부 (files)';

/* 공통 — 가리킬 파일이 READY 이고 용도가 맞는가 */
CREATE OR REPLACE FUNCTION public.fn_file_ref_check(p_file uuid, p_purpose text)
RETURNS public.files LANGUAGE plpgsql AS $$
DECLARE f public.files;
BEGIN
  SELECT * INTO f FROM public.files WHERE id = p_file;
  IF f.id IS NULL THEN
    RAISE EXCEPTION 'FILE: 없는 파일입니다';
  END IF;
  IF f.status <> 'READY' THEN
    RAISE EXCEPTION 'FILE: 올리기가 끝나지 않았거나 쓸 수 없는 파일입니다 (%)', f.status;
  END IF;
  IF f.purpose <> p_purpose THEN
    RAISE EXCEPTION 'FILE: 다른 용도로 올린 파일입니다 (% ≠ %)', f.purpose, p_purpose;
  END IF;
  RETURN f;
END $$;

CREATE OR REPLACE FUNCTION public.fn_file_ref_owner_verif() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE f public.files;
BEGIN
  IF NEW.doc_file_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.doc_file_id IS DISTINCT FROM OLD.doc_file_id) THEN
    f := public.fn_file_ref_check(NEW.doc_file_id, 'OWNERSHIP_DOC');
    /* ★ 남이 올린 파일로 소유 확인을 받을 수 없습니다 */
    IF f.owner_account_id <> NEW.applicant_id THEN
      RAISE EXCEPTION 'FILE: 신청자가 올린 파일이 아닙니다';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_file_ref_owner_verif ON public.owner_verifications;
CREATE TRIGGER trg_file_ref_owner_verif BEFORE INSERT OR UPDATE ON public.owner_verifications
  FOR EACH ROW EXECUTE FUNCTION public.fn_file_ref_owner_verif();

CREATE OR REPLACE FUNCTION public.fn_file_ref_material() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE f public.files;
BEGIN
  IF NEW.file_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.file_id IS DISTINCT FROM OLD.file_id) THEN
    f := public.fn_file_ref_check(NEW.file_id, 'MARKETING_MATERIAL');
    IF NEW.kind IN ('IMAGE','BANNER') AND f.content_type NOT IN ('image/jpeg','image/png') THEN
      RAISE EXCEPTION 'FILE: 이미지 · 배너 자료는 JPG · PNG 파일이어야 합니다';
    END IF;
    IF NEW.kind = 'VIDEO' AND f.content_type <> 'video/mp4' THEN
      RAISE EXCEPTION 'FILE: 영상 자료는 MP4 파일이어야 합니다';
    END IF;
    IF NEW.kind = 'DOC' AND f.content_type = 'video/mp4' THEN
      RAISE EXCEPTION 'FILE: 문서 자료는 PDF · JPG · PNG 파일이어야 합니다';
    END IF;
  END IF;
  /* ★ 심의를 통과한 뒤 파일만 바꿔치면 심의를 건너뜁니다 */
  IF TG_OP = 'UPDATE' AND OLD.state = 'APPROVED' AND NEW.state = 'APPROVED'
     AND (NEW.file_id IS DISTINCT FROM OLD.file_id OR NEW.body IS DISTINCT FROM OLD.body) THEN
    RAISE EXCEPTION 'FILE: 심의를 통과한 자료의 파일 · 문구는 바꿀 수 없습니다 — 새 자료로 올려 다시 심의받으십시오';
  END IF;
  IF NEW.kind <> 'COPY' AND NEW.file_id IS NULL AND NEW.state = 'APPROVED'
     AND (TG_OP = 'INSERT' OR OLD.state <> 'APPROVED') AND NEW.file_key IS NULL THEN
    RAISE EXCEPTION 'FILE: 파일이 없는 % 자료는 승인할 수 없습니다', NEW.kind;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_file_ref_material ON public.marketing_materials;
CREATE TRIGGER trg_file_ref_material BEFORE INSERT OR UPDATE ON public.marketing_materials
  FOR EACH ROW EXECUTE FUNCTION public.fn_file_ref_material();

CREATE OR REPLACE FUNCTION public.fn_file_ref_guide() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.file_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.file_id IS DISTINCT FROM OLD.file_id) THEN
    PERFORM public.fn_file_ref_check(NEW.file_id, 'PARTNER_GUIDE');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_file_ref_guide ON public.partner_guides;
CREATE TRIGGER trg_file_ref_guide BEFORE INSERT OR UPDATE ON public.partner_guides
  FOR EACH ROW EXECUTE FUNCTION public.fn_file_ref_guide();

-- ---------------------------------------------------------------------
-- 4. 누가 내려받을 수 있는가
--    'OK' · 'PARTNER_ONLY'(파트너 승인 계정만) · 'NOT_FOUND'(없거나 볼 수 없음 — 존재를 알리지 않음)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_file_can_read(p_file uuid, p_account uuid, p_roles text[])
RETURNS text LANGUAGE plpgsql STABLE AS $$
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
  /* 등기부는 신청자와 운영만 봅니다 */
  RETURN 'NOT_FOUND';
END $$;
COMMENT ON FUNCTION public.fn_file_can_read(uuid, uuid, text[]) IS
  '파일 열람 권한. 주인 · ADMIN/SUPER/REVIEWER · (승인된 자료/활성 가이드면) ACTIVE 파트너. 그 밖은 NOT_FOUND.';
