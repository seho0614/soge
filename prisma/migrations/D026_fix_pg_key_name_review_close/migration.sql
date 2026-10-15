-- =====================================================================
-- D026 — 확장 점검(2026-10-08)에서 나온 자료 쪽 수정 2건 (v10.26)
--
--   ① G-174  외부 연동 표의 결제 키 이름
--        운영 화면 「외부 연동」과 설치 절차서가 결제 키 이름을 PG_SECRET_KEY 로 안내했는데,
--        서버(결제 어댑터)가 읽는 환경 변수는 TOSS_SECRET_KEY 입니다.
--        안내대로 넣으면 결제가 계속 「시험 결제」로 남습니다 → 표의 값을 서버가 읽는 이름으로 맞춥니다.
--
--   ② G-186  이미 승인된 사업자의 검수 대기 건
--        「사업자 인증」에서 승인해도 검수 큐의 그 건이 대기로 남아 쌓였습니다.
--        검수 큐는 오래된 50건만 보여 주므로 진짜 대기 건(매물 · 요청)이 뒤로 밀렸습니다.
--        이제부터는 승인할 때 서버가 함께 닫습니다(admin.service verifyBusiness).
--        여기서는 **이미 쌓인 건**을 승인으로 닫습니다 — 승인한 사람 · 시각은 사업자 승인 기록에서 가져옵니다.
--        (검수 이력 review_events 에 「승인」 한 줄씩 남습니다 — 트리거)
--
--   구조(표 · 열 · 제약)는 바꾸지 않습니다. 여러 번 돌려도 같습니다.
-- =====================================================================

UPDATE public.integrations
   SET secret_key_name = 'TOSS_SECRET_KEY'
 WHERE code = 'PG' AND secret_key_name = 'PG_SECRET_KEY';

UPDATE public.review_items r
   SET status      = 'APPROVED',
       decision_by = b.verified_by,
       decided_at  = coalesce(b.verified_at, now())
  FROM public.businesses b
 WHERE r.target_type = 'BUSINESS'
   AND r.target_id   = b.id
   AND r.status IN ('QUEUED', 'IN_PROGRESS')
   AND b.verified_at IS NOT NULL;
