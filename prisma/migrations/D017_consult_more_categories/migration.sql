-- =====================================================================
-- D017 — 안심소개 상담 축 업종 추가 (대표 결정 2026-10-01)
--   (v10.4.7 kit 의 D007 을 그대로 옮겼습니다 — 번호만 D017 입니다)
--   전문 업체 업종 목록 중 공공·기관을 뺀 나머지를 안심소개(인증 후 등록)에 넣습니다.
--   광고·마케팅 · 디자인 · IT·소프트웨어 · 제조·생산 · 유통·무역 — 법정 자격이 없어
--   사업자 인증 + 축별 입점 승인만 봅니다(일반 업종). 소개장터의 같은 분야와는 별개입니다.
--   법률 · 세무는 D016 그대로 준비 중입니다(소개 대가 금지 여부 법무 확인 전).
-- =====================================================================
INSERT INTO public.categories (gwan_code, code, name, status, restricted_code, labor_law_flag, approved_at, axis) VALUES
  ('MAL','CSL_MARKETING','광고·마케팅','APPROVED',NULL,'NOT_APPLICABLE',now(),'CONSULT'),
  ('MAL','CSL_DESIGN','디자인','APPROVED',NULL,'NOT_APPLICABLE',now(),'CONSULT'),
  ('MAL','CSL_IT','IT·소프트웨어','APPROVED',NULL,'NOT_APPLICABLE',now(),'CONSULT'),
  ('MAL','CSL_MANUFACTURE','제조·생산','APPROVED',NULL,'NOT_APPLICABLE',now(),'CONSULT'),
  ('MAL','CSL_TRADE','유통·무역','APPROVED',NULL,'NOT_APPLICABLE',now(),'CONSULT')
ON CONFLICT (gwan_code, code) DO NOTHING;
