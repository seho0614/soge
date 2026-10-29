-- =====================================================================
-- D143 · 파일 저장 위치 옮기기 허용 (v10.149 · 2026-10-29 · sgb-core docs/229)
--   fn_files_guard(D007)는 올린 파일의 저장 위치(storage_provider)를 바꾸지 못하게 막았음 →
--   서버 디스크 → S3 옮기기(deploy/aws/files-to-s3.sh apply) 때만 바꿀 수 있게 좁게 엶:
--   그 거래에서 SET LOCAL sgb.files_move = 'on' 일 때 · LOCAL ↔ S3 만 · 다른 열(주인 · 용도 · 형식 · 크기 · 키 · 이름)은 그대로 막음
--   함수 하나 다시 만듦(트리거는 그대로) · 재실행 안전 · 자료를 바꾸지 않음
-- =====================================================================

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
     OR (NEW.storage_provider IS DISTINCT FROM OLD.storage_provider
         /* D143 — 저장 위치 옮기기(files-to-s3.sh apply)만: 그 거래가 SET LOCAL sgb.files_move = 'on' 일 때 LOCAL ↔ S3 */
         AND NOT (coalesce(current_setting('sgb.files_move', true), '') = 'on'
                  AND OLD.storage_provider IN ('LOCAL', 'S3') AND NEW.storage_provider IN ('LOCAL', 'S3')))
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
COMMENT ON FUNCTION public.fn_files_guard() IS '파일 행 지킴(D007 · D143) — 바이트 관련 열 고정 · 저장 위치는 SET LOCAL sgb.files_move = on 인 거래에서만 LOCAL ↔ S3';
