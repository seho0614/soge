-- =====================================================================
-- D159 · 공개 직후 지켜보기 · 소개몰 「주문 받기」 스위치 (v10.170 · 2026-11-01 · sgb-core docs/262)
--   대표 결정(11/1 「사용자 웹 전체 공개」 · 간주 모드 · 결제대행사 계약 전 상태로 엶 — domain-dns #11 · open-blockers #27)
--   ① 설정 mall.order_open(기본 on = 지금과 같음) — off 면 소개몰 상품 보기 · 담기는 되고 주문 · 결제만 막음(결제대행사 연결 전 시험 결제 주문 방지)
--   ② 정기 작업 launch_watch(10분마다) — 시험 결제(stub)로 「결제 완료」된 소개몰 주문이 새로 생기면 운영 알림(ops_alerts STUB_PAYMENT_ORDER)
--   지우는 문장 없음 · 재실행 안전
-- =====================================================================

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('mall.order_open', 'on', 'GLOBAL',
        '소개몰 주문 받기(v10.170 · docs/262) — off 면 상품 보기 · 장바구니 담기는 되고 주문 · 결제만 막습니다. 결제대행사(PG) 연결 전 사용자 웹을 공개한 동안 시험 결제 주문을 막으려면 off(decisions/open-blockers #27).',
        false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('launch_watch', 10, NULL, NULL, NULL, true, '공개 직후 지켜보기 — 시험 결제(stub)로 결제 완료된 소개몰 주문이 새로 생기면 운영 알림(STUB_PAYMENT_ORDER) · D159')
ON CONFLICT (job) DO NOTHING;
