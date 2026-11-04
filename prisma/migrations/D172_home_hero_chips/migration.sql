-- =====================================================================
-- D172 (v10.189 · docs/296) — 메인 Hero 추천 칩을 운영이 고르기
--
--   ① 설정 home.hero_chips '' — 메인 검색칸 아래 추천 칩. 쉼표로 최대 4개(낱말마다 2 ~ 20자 · 예: 인테리어,세무,청소,간판)
--      비어 있으면 v10.188 처럼 인기 검색어(결과가 나온 말 3개 이상) · 그것도 모자라면 사전의 예시 칩
--      고른 말도 제한업종 낱말(restrict_vocab · BLOCK · AD_ONLY)이 든 것은 서버가 뺍니다(GET /search/keywords?place=hero)
--
--   지우는 문장 없음.
-- =====================================================================

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('home.hero_chips', '', 'ADMIN',
   '메인 Hero 추천 칩(v10.189 · docs/296) — 쉼표로 최대 4개(낱말마다 2 ~ 20자). 비어 있으면 인기 검색어(3개 이상일 때) · 아니면 예시 칩. 제한업종 낱말이 든 말은 나가지 않습니다.',
   false, '^$|^[^,]{2,20}(,[^,]{2,20}){0,3}$', '인테리어,세무,청소,간판')
ON CONFLICT (key) DO NOTHING;
