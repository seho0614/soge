-- =====================================================================
-- D105 — v10.65 (2026-10-22 · 관리자 스위치 · docs/121)
--
--   ① 기능 스위치(feature.referral_fee · feature.success_fee)에도 형식 검사 — 소문자 on / off 만.
--      전에는 value_pattern 이 비어 있어 대문자 ON 을 넣으면 저장은 되고 fn_feature_on() 은 꺼진 채로 읽었습니다(docs/111 6-2).
--      간주 스위치(assume.*)는 처음부터 '^(on|off)$' 였습니다.
--   ② 이미 들어 있는 값이 대소문자 · 앞뒤 빈칸만 다르면(ON · ' on ') 소문자로 바로잡음 — 켜고 끈 상태는 바꾸지 않습니다.
--      ※ ON 이 들어 있었다면 지금까지는 「꺼진 채」로 읽혔고, 이 마이그레이션 뒤에는 「켜짐」으로 읽힙니다 → 운영 적용 전 precheck 에서 값을 보여 줌.
--
--   자료를 지우지 않습니다. 재실행 안전(같은 값으로 다시 씀).
-- =====================================================================

UPDATE public.site_settings
   SET value_pattern = '^(on|off)$', value_example = 'off'
 WHERE key IN ('feature.referral_fee', 'feature.success_fee')
   AND value_pattern IS DISTINCT FROM '^(on|off)$';

UPDATE public.site_settings
   SET value = lower(btrim(value))
 WHERE (key LIKE 'feature.%' OR key LIKE 'assume.%')
   AND lower(btrim(value)) IN ('on', 'off')
   AND value <> lower(btrim(value));
