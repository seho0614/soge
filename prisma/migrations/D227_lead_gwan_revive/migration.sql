-- v10.335 (docs/466) — 리드관(소개리드 · LED) 되살림 — 꺼진 채
--   대표 11/17 「리드관 다시 열기」 → 「B. 별도 관으로 되살림」 → 「개발 + 꺼진 채로」. 10/1 폐지(D005 · gwan-structure-naming #4 · #14)를 뒤집음.
--   리드 엔진(배정 · 반려 · 소개캐시 · 세금계산서)과 업종(categories gwan MAL · axis CONSULT · CSL_*)은 **그대로** 씁니다 —
--   업종을 옮기면 상담 신청 게이트(D005 4절) · 자격 심사 · 지난 리드 기록이 함께 흔들리기 때문입니다.
--   리드관은 그 「생활 · 금융 상담」 업종을 자기 관 화면(/lead)으로 보여 주는 관입니다. 켜면 안심소개의 상담 축 탭은 사용자 웹에서 숨깁니다.
--   켜기 전 안전장치: 설정 lead.legal_ok(법무 재확인 회신 · 처음 off · SUPER) 가 on 이어야 LED 를 켤 수 있음(DB 가 막음 · SETTING: → 422).
--   지우는 문장 없음 · 다시 돌려도 같음.

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('lead.legal_ok', 'off', 'ADMIN',
        '리드관(소개리드) 법무 재확인 회신(v10.335 · docs/466) — 의료법 27조 · 보험업법 · 선불 충전(전자금융거래법) · 제3자 제공 동의 · 광고 규제 회신을 받은 뒤 on. on 이어야 리드관을 켤 수 있음. 바꾸기는 최고 관리자.',
        false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;

UPDATE public.gwans
   SET name = '소개리드',
       description = '리드관(v10.335 되살림 · docs/466) — 보험 · 의료 · 렌탈 등 생활 · 금융 상담. 업종 · 상담 신청 · 리드 엔진은 안심소개 상담 축(CSL_*)을 그대로 씀. 켜기는 법무 회신(lead.legal_ok) 뒤.'
 WHERE code = 'LED' AND description LIKE '폐지(2026-10-01)%';

CREATE OR REPLACE FUNCTION public.fn_lead_gwan_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code = 'LED' AND NEW.is_active AND NOT OLD.is_active
     AND coalesce((SELECT value FROM public.site_settings WHERE key = 'lead.legal_ok'), 'off') <> 'on' THEN
    RAISE EXCEPTION 'SETTING: 리드관(소개리드)은 법무 재확인 회신을 받은 뒤(설정 lead.legal_ok = on) 켤 수 있습니다.';
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.fn_lead_gwan_guard() IS 'v10.335 (D227) 리드관(LED)은 lead.legal_ok = on 일 때만 켬(켜는 UPDATE 만 봄 — LED 줄은 이미 있고, 점검 자료의 INSERT … ON CONFLICT DO NOTHING 을 막지 않게)';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lead_gwan_guard' AND tgrelid = 'public.gwans'::regclass) THEN
    CREATE TRIGGER trg_lead_gwan_guard BEFORE UPDATE OF is_active ON public.gwans FOR EACH ROW EXECUTE FUNCTION public.fn_lead_gwan_guard();
  END IF;
END $$;
