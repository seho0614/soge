-- ★ 개발 · 시연용 (운영 DB 에 넣지 마십시오) — v10.31 w3 · inventory 「개발용 시드 보기 자료」
--   시험 계정(intro@x.com · buyer@x.com)의 나의공간 화면이 빈 상태로만 보이지 않게, 실제 테이블 · 규칙을 그대로 지키는 보기 자료를 넣습니다.
--   지어낸 숫자를 화면에 박지 않습니다 — 아래 행이 있으면 화면은 그 행을 서버에서 읽어 그립니다.
--   다시 돌려도 같은 결과(이미 있으면 건너뜀). 쓰는 법: psql "$DATABASE_URL" -f scripts/seed-myspace-dev.sql
--   넣지 않는 것: 정산 · 지급(소개비 기능 feature.referral_fee 가 꺼져 있으면 DB 가 정산 줄을 만들지 않습니다 — 켜고 거래를 확정하면 생김),
--                 계약(계약서는 POST /deals/{id}/contract → …/agree 로 만드는 것이 맞습니다 — 시험 순서는 docs 의 w3 확인 기록 참고).
\set ON_ERROR_STOP on
BEGIN;

/* 알림 3건 — intro@x.com (종류 코드 그대로 → 카드 색 · 바로가기 이름이 서버 정책에서) */
INSERT INTO notifications (account_id, event_code, title, body, link_url, created_at)
SELECT a.id, v.code, v.title, v.body, v.link, now() - v.ago
  FROM accounts a,
       (VALUES ('SUBSCRIPTION_PAYMENT_FAILED', '결제에 실패했습니다', '스탠다드 요금제 결제가 실패했습니다. 결제 수단을 확인해 주세요.', '/my/payment', interval '2 days'),
               ('INTRO_INVITE', '소개 초대에 동의했습니다', '초대하신 분이 소개 연결에 동의했습니다. 이제 대화를 시작할 수 있습니다.', '/my/intro/invite', interval '3 days'),
               ('SUBSCRIPTION_RENEWED', '구독이 갱신되었습니다', '스탠다드 요금제가 갱신되었습니다.', '/my/subscription', interval '9 days')) AS v(code, title, body, link, ago)
 WHERE a.email = 'intro@x.com'
   AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.account_id = a.id AND n.event_code = v.code AND n.title = v.title);

/* 관심 2건 — intro@x.com 이 남의 게시 중 매물을 담음 */
INSERT INTO favorites (account_id, target_type, target_id)
SELECT a.id, 'LISTING', l.id
  FROM accounts a
  JOIN LATERAL (SELECT id FROM listings WHERE status = 'PUBLISHED' AND owner_account_id <> a.id ORDER BY published_at DESC NULLS LAST LIMIT 2) l ON true
 WHERE a.email = 'intro@x.com'
ON CONFLICT DO NOTHING;

/* 소개자 프로필 — buyer@x.com (분야 · 지역 · 맞춤 요청이 나오도록) */
INSERT INTO introducer_profiles (account_id, categories, regions)
SELECT a.id, '{}', ARRAY['서울 금천구','서울 구로구'] FROM accounts a WHERE a.email = 'buyer@x.com'
ON CONFLICT (account_id) DO NOTHING;

/* 포인트 3건 — buyer@x.com (적립 규칙 그대로 · 유효 연결 전이라 모두 「확인 대기」 — DB 가 연결 없는 현금화를 막음) */
INSERT INTO point_ledger (account_id, rule_code, points, redeemable, memo, earned_at)
SELECT a.id, v.rule, r.points, v.ok, '개발 · 시연용', now() - v.ago
  FROM accounts a
  JOIN (VALUES ('PROFILE_COMPLETE', false, interval '10 days'), ('FIRST_INVITE', false, interval '6 days'), ('INVITE_CONSENTED', false, interval '2 days')) AS v(rule, ok, ago) ON true
  JOIN point_rules r ON r.code = v.rule
 WHERE a.email = 'buyer@x.com'
   AND NOT EXISTS (SELECT 1 FROM point_ledger p WHERE p.account_id = a.id AND p.rule_code = v.rule AND p.memo = '개발 · 시연용');

COMMIT;
