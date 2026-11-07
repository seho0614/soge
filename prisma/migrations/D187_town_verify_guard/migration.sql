-- =====================================================================
-- D187 — 동네 인증(GPS) 켜기 전 안전장치 (v10.210 · 2026-11-07)
--
--   대표 「위치 약관 · 동네 인증 GPS」(11/7 「다음개발 모두」 · 「승인」) — 위치기반서비스사업 신고 · 법률 확인이 먼저라
--   지금은 켜지 못하게 막는 장치와 준비 상태만 만듦(community #17 · docs/253 · docs/335).
--
--   ① 설정 community.lbs_report_no(위치기반서비스사업 신고번호 · 처음 비어 있음).
--   ② community.town_verify 를 on 으로 바꾸려면 둘 다 있어야 함(DB 가 막음 · SETTING: → 422 INVALID_SETTING):
--      · 위치기반서비스 이용약관(LOCATION)이 게시돼 시행 중(PUBLISHED · 시행일 지남)
--      · 신고번호가 들어 있음
--      카카오 REST 키는 운영 화면 연동 키 또는 .env 라 DB 가 볼 수 없음 — 준비 상태 줄에서 보이고, 없으면 인증 때 TOWN_GEO_NOT_READY.
--   재실행 안전. 표 · 자료를 지우는 문장 없음.
-- =====================================================================

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('community.lbs_report_no', NULL, 'GLOBAL',
        '위치기반서비스사업 신고번호(v10.210 · D187 · docs/335) — 방송통신위원회 신고 뒤 받은 번호. 이 값과 위치기반서비스 이용약관(LOCATION) 게시가 있어야 동네 인증(community.town_verify)을 켤 수 있음.',
        false, '^[^[:space:]].{1,59}$', '제2026-0000호')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_town_verify_on_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.key = 'community.town_verify' AND NEW.value = 'on'
     AND (TG_OP = 'INSERT' OR OLD.value IS DISTINCT FROM 'on') THEN
    IF NOT EXISTS (SELECT 1 FROM public.terms WHERE code = 'LOCATION' AND status = 'PUBLISHED' AND effective_from <= now()) THEN
      RAISE EXCEPTION 'SETTING: 동네 인증은 위치기반서비스 이용약관(LOCATION)을 게시해 시행된 뒤에 켤 수 있습니다.';
    END IF;
    IF coalesce(trim((SELECT value FROM public.site_settings WHERE key = 'community.lbs_report_no')), '') = '' THEN
      RAISE EXCEPTION 'SETTING: 동네 인증은 위치기반서비스사업 신고번호(community.lbs_report_no)를 넣은 뒤에 켤 수 있습니다.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_town_verify_on_guard ON public.site_settings;
CREATE TRIGGER trg_town_verify_on_guard BEFORE INSERT OR UPDATE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.fn_town_verify_on_guard();
