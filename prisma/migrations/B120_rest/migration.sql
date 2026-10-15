-- =====================================================================
-- B120_rest
--
-- 위 단계에 들지 않은 나머지 문장.
--
-- 검증된 상태(불변식 135 · 공격 37 · 문서 22 통과)에서 생성된 기준선입니다.
-- 손으로 고치지 마십시오.
-- 스키마를 바꾸려면 prisma/migrations/ 에 새 파일을 추가하십시오.
-- =====================================================================

CREATE CONSTRAINT TRIGGER trg_grade_rate_monotone AFTER INSERT OR UPDATE ON public.lead_grade_rates DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fn_grade_rate_monotone();

CREATE CONSTRAINT TRIGGER trg_gwan_order_unique AFTER INSERT OR UPDATE ON public.gwans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fn_gwan_order_unique();
