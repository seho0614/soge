-- =====================================================================
-- D217 (v10.295 ~ 297 · docs/416) — 공지 첨부 · 공지 자동 번역 대기열 · 요율 알림 메일 · 문자 발송 현황
--
--   대표 「다음」 → 공지 · 요율 후속 묶음 3 · 계획 「승인 + 통과하면 병합」(11/14).
--   ① v10.295 공지 첨부 — 파일 용도 NOTICE_ATTACHMENT(그림 JPG · PNG · PDF · 10MB) · notices.attachments(파일 id · 3개까지)
--      공지에 붙은 파일은 지울 수 없음(trg_files_notice_guard) · 게시한 수수료율 공지는 첨부도 잠금(fn_notice_lock_guard)
--   ② v10.296 공지 자동 번역 — translation_jobs 대상에 NOTICE · 공지가 게시(예약 포함)되거나 게시 뒤 제목 · 본문 · 등급이 바뀌면
--      자동 번역 스위치(i18n.auto_translate.enabled)가 켜져 있을 때만 작업 줄(D118 fn_translation_enqueue 그대로) · 관리자만 공지는 넣지 않음
--   ③ v10.297 요율 알림 발송 현황 — hlt_rate_notifications(요율 예약 · 알림 · 종류) · 예약 · 취소 · 다시 알림 때 쌓음(앱)
--      운영 화면이 알림마다 메일 · 문자 발송 상태(notification_deliveries)를 셈
--   지우는 문장 없음. 재실행 안전.
-- =====================================================================

/* ① 공지 첨부 ----------------------------------------------------------- */
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS ck_files_purpose;
ALTER TABLE public.files ADD CONSTRAINT ck_files_purpose
  /* 합침 — 모든 묶음의 용도 합집합(D049 · D050 · D072 · D090) + NOTICE_ATTACHMENT(D217). 빠지면 있는 파일이 있는 DB 에서 실패합니다 */
  CHECK (purpose = ANY (ARRAY['OWNERSHIP_DOC','MARKETING_MATERIAL','PARTNER_GUIDE','PRODUCT_IMAGE','PARTNER_MEDIA',
                              'LISTING_IMAGE','REQUEST_IMAGE','INQUIRY_ATTACHMENT','BROKER_DOC','NOTICE_ATTACHMENT']));
INSERT INTO public.file_policies (purpose, content_type, max_bytes, ext) VALUES
  ('NOTICE_ATTACHMENT', 'image/jpeg', 10485760, 'jpg'), ('NOTICE_ATTACHMENT', 'image/png', 10485760, 'png'),
  ('NOTICE_ATTACHMENT', 'application/pdf', 10485760, 'pdf')
ON CONFLICT DO NOTHING;

ALTER TABLE public.notices ADD COLUMN IF NOT EXISTS attachments uuid[] NOT NULL DEFAULT '{}'::uuid[];
ALTER TABLE public.notices DROP CONSTRAINT IF EXISTS ck_notices_attachments;
ALTER TABLE public.notices ADD CONSTRAINT ck_notices_attachments CHECK (cardinality(attachments) <= 3);
COMMENT ON COLUMN public.notices.attachments IS 'v10.295 (D217) 첨부 파일 id(files · NOTICE_ATTACHMENT · 그림 · PDF · 3개까지) — 공지를 볼 수 있는 사람만 GET /notices/{id}/files/{n}';

-- 공지에 붙은 파일은 지울 수 없음(fn_files_guard 는 그대로 두고 따로 지킴)
CREATE OR REPLACE FUNCTION public.fn_files_notice_guard() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'DELETED' AND OLD.status IS DISTINCT FROM 'DELETED'
     AND EXISTS (SELECT 1 FROM public.notices n WHERE OLD.id = ANY(n.attachments)) THEN
    RAISE EXCEPTION 'FILE: 공지에 붙은 파일은 지울 수 없습니다 — 공지에서 먼저 빼십시오';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_files_notice_guard ON public.files;
CREATE TRIGGER trg_files_notice_guard BEFORE UPDATE OF status ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.fn_files_notice_guard();

-- 요율 예약 공지는 게시한 뒤 잠금 — D211 그대로 + 첨부(attachments)
CREATE OR REPLACE FUNCTION public.fn_notice_lock_guard() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM hlt_rate_schedules r WHERE r.notice_id = OLD.id OR r.cancel_notice_id = OLD.id) THEN
      RAISE EXCEPTION 'NTCL: 수수료율 변경 공지는 지울 수 없습니다';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.published_at IS NOT NULL AND OLD.published_at <= now()
     AND EXISTS (SELECT 1 FROM hlt_rate_schedules r WHERE r.notice_id = OLD.id OR r.cancel_notice_id = OLD.id)
     AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body OR NEW.grades IS DISTINCT FROM OLD.grades
          OR NEW.published_at IS DISTINCT FROM OLD.published_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
          OR NEW.gwan_code IS DISTINCT FROM OLD.gwan_code OR NEW.attachments IS DISTINCT FROM OLD.attachments) THEN
    RAISE EXCEPTION 'NTCL: 게시한 수수료율 변경 공지는 고치거나 내릴 수 없습니다 — 입점 약관 제17조 4항 공지 기록';
  END IF;
  RETURN NEW;
END $$;

/* ② 공지 자동 번역 대기열 ---------------------------------------------- */
ALTER TABLE public.translation_jobs DROP CONSTRAINT IF EXISTS translation_jobs_target_type_check;
ALTER TABLE public.translation_jobs ADD CONSTRAINT translation_jobs_target_type_check
  CHECK (target_type IN ('LISTING','REQUEST','NOTICE'));

CREATE OR REPLACE FUNCTION public.fn_notice_translation_enqueue_trg() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
  -- 게시(예약 포함) · 끝나지 않음 · 사용자 웹에 보이는 등급이 있음(관리자만인 공지는 번역하지 않음)
  IF NEW.published_at IS NOT NULL AND (NEW.ends_at IS NULL OR NEW.ends_at > now())
     AND EXISTS (SELECT 1 FROM unnest(NEW.grades) g WHERE g <> 'STAFF')
     AND (TG_OP = 'INSERT' OR OLD.published_at IS NULL
          OR OLD.title IS DISTINCT FROM NEW.title OR OLD.body IS DISTINCT FROM NEW.body
          OR OLD.grades IS DISTINCT FROM NEW.grades) THEN
    PERFORM public.fn_translation_enqueue('NOTICE', NEW.id::text);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notice_translation_enqueue ON public.notices;
CREATE TRIGGER trg_notice_translation_enqueue AFTER INSERT OR UPDATE OF published_at, title, body, grades ON public.notices
  FOR EACH ROW EXECUTE FUNCTION public.fn_notice_translation_enqueue_trg();

UPDATE public.site_settings SET description = '등록 글(매물 · 요청) · 공지(v10.296) 자동 번역(3-2 · docs/162 · docs/416) — 켜려면 AI 전체(agent.enabled) · 월 상한(agent.monthly_cap_usd)도'
 WHERE key = 'i18n.auto_translate.enabled' AND description NOT LIKE '%공지%';

/* ③ 요율 알림 발송 현황 ------------------------------------------------- */
CREATE TABLE IF NOT EXISTS public.hlt_rate_notifications (
  notification_id bigint PRIMARY KEY REFERENCES public.notifications(id) ON DELETE CASCADE,
  schedule_id     uuid NOT NULL REFERENCES public.hlt_rate_schedules(id),
  kind            text NOT NULL CHECK (kind IN ('SCHEDULE', 'CANCEL', 'REMIND')),
  at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_hlt_rate_notifications_schedule ON public.hlt_rate_notifications (schedule_id);
COMMENT ON TABLE public.hlt_rate_notifications IS
  'v10.297 (D217) 요율 예약이 보낸 판매자 알림(예약 안내 · 취소 · 다시 알림) — 운영 화면이 메일 · 문자 발송 상태(notification_deliveries)를 셈';
