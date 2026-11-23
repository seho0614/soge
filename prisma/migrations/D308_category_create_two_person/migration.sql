-- =====================================================================
-- D308 (v10.643 · docs/787) 새 업종 추가 — 운영 화면에서 「승인 대기」로 만들고, 만든 사람은 승인하지 못함
--
--   대표 11/23 「업종을 관에 배정하는 화면」 → 「모두 반영」 · 「다른 사람이 승인」.
--   함수 fn_category_guard + 트리거 trg_category_guard(BEFORE INSERT OR UPDATE) 하나:
--     ① 허브 관(gwans.is_hub) · 리드관(LED)에는 업종을 새로 넣지 않음 — 허브는 하위 관에 · 리드관은 안심소개 상담 축(gwan-structure-naming #32)
--     ② 만든 뒤 관(gwan_code)은 바꾸지 않음 — 매물 · 검수 · 정산이 관에 딸림
--     ③ 승인(→ APPROVED)할 때 만든 사람(requested_by)과 승인한 사람(approved_by)이 같으면 막음 — requested_by 가 빈 옛 업종(마이그레이션으로 넣은 것)은 그대로
--   표 · 칸 바꿈 없음(requested_by · approved_by 는 B040 부터 있음) · 지우는 문장 없음 · 다시 돌려도 같음 · RAISE 글자에 퍼센트 기호 없음
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_category_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_hub boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT is_hub INTO v_hub FROM public.gwans WHERE code = NEW.gwan_code;
    IF coalesce(v_hub, false) OR NEW.gwan_code = 'LED' THEN
      RAISE EXCEPTION 'CATEGORY_GWAN_NOT_ALLOWED: 허브 관과 소개리드에는 업종을 넣지 않습니다 — 허브는 하위 관에, 소개리드는 안심소개 상담 축 업종을 씁니다.';
    END IF;
  ELSE
    IF NEW.gwan_code IS DISTINCT FROM OLD.gwan_code THEN
      RAISE EXCEPTION 'CATEGORY_GWAN_LOCKED: 업종의 관은 만든 뒤 바꿀 수 없습니다 — 새 관에 업종을 새로 만드십시오.';
    END IF;
    IF NEW.status = 'APPROVED' AND OLD.status IS DISTINCT FROM 'APPROVED'
       AND NEW.requested_by IS NOT NULL AND NEW.approved_by IS NOT DISTINCT FROM NEW.requested_by THEN
      RAISE EXCEPTION 'CATEGORY_SAME_PERSON: 업종을 만든 사람은 그 업종을 승인할 수 없습니다 — 다른 관리자가 승인하십시오.';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_category_guard ON public.categories;
CREATE TRIGGER trg_category_guard BEFORE INSERT OR UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.fn_category_guard();

COMMENT ON FUNCTION public.fn_category_guard() IS 'v10.643 (D308 · docs/787) 업종 — 허브 관 · LED 에 새로 넣지 않음 · 관 바꾸지 않음 · 만든 사람(requested_by)은 승인(approved_by) 못 함(옛 업종 requested_by 없음은 그대로).';
