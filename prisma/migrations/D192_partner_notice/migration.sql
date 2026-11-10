-- =====================================================================
-- D192 — 파트너 · 판매자 심사 알림 · 제휴 파트너 약관 대상 (v10.222 · 2026-11-10)
--
--   대표 「안심파트너 · 제휴파트너 · 판매자 등록 및 관리 절차 점검」 → 「전체목록」 → 「1 · 2 · 3 모두」(11/9).
--
--   ① fn_term_applies('PARTNER') — 제휴만 신청한 회원(안심소개 status = 'NONE' · 제휴 aff_status 신청 · 활동 · 정지)도
--      파트너 이용약관 대상. 전에는 안심소개 자격(status)만 봐서 제휴 파트너는 파트너 약관에 동의할 수 없었음
--      (동의 API 가 TERM_NOT_APPLICABLE 로 막음 · 재동의 현황에서도 빠짐).
--   ② 알림 종류 — 승인 · 반려 · 정지 · 다시 열기를 신청자에게(사이트 안 · 메일은 메일 채널이 준비되면 notify_dispatch 가).
--      자격 상태가 바뀌는 일이라 수신 거부 불가 · 조용한 시간은 지킴(SMS · PUSH 만 해당).
--      PARTNER_REJECTED 는 이미 쓰던 코드인데 정책 줄이 없었음 — 함께 넣음.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_term_applies(p_account uuid, p_audience text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE coalesce(p_audience, 'ALL')
           WHEN 'ALL' THEN true
           WHEN 'PARTNER' THEN p_account IS NOT NULL AND EXISTS (
             SELECT 1 FROM partners p JOIN businesses b ON b.id = p.business_id
              WHERE (p.status IN ('APPLIED','ACTIVE','SUSPENDED')
                     OR p.aff_status IN ('APPLIED','ACTIVE','SUSPENDED'))   -- v10.222 (D192) — 제휴 파트너도
                AND (b.account_id = p_account
                     OR EXISTS (SELECT 1 FROM business_members m
                                 WHERE m.business_id = b.id AND m.account_id = p_account
                                   AND m.joined_at IS NOT NULL AND m.removed_at IS NULL)))
           ELSE false
         END
$$;
COMMENT ON FUNCTION public.fn_term_applies(uuid, text) IS
  '이 회원이 그 약관의 동의 대상인가(v10.31 · D090 · v10.222 D192). PARTNER = 안심소개 또는 제휴 자격이 신청 · 활동 · 일시 정지 중인 파트너의 대표 또는 합류한 직원.';

INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis, tone) VALUES
  ('PARTNER_APPROVED',  '안심소개 파트너 승인',     false, false, '자격 상태 — 리드를 받기 시작합니다', 'ok'),
  ('PARTNER_REJECTED',  '안심소개 파트너 반려',     false, false, '자격 상태 — 사유를 고쳐 다시 신청합니다', 'warn'),
  ('PARTNER_SUSPENDED', '안심소개 파트너 정지',     false, false, '자격 상태 — 정지 중에는 리드가 가지 않습니다', 'warn'),
  ('PARTNER_RESUMED',   '안심소개 파트너 다시 열림', false, false, '자격 상태', 'ok'),
  ('AFF_APPROVED',      '제휴 파트너 승인',         false, false, '자격 상태 — 링크를 발급할 수 있습니다', 'ok'),
  ('AFF_REJECTED',      '제휴 파트너 반려',         false, false, '자격 상태 — 사유를 고쳐 다시 신청합니다', 'warn'),
  ('AFF_SUSPENDED',     '제휴 파트너 정지',         false, false, '자격 상태 — 정지 중에는 제휴 활동을 할 수 없습니다', 'warn'),
  ('AFF_RESUMED',       '제휴 파트너 다시 열림',     false, false, '자격 상태', 'ok'),
  ('SELLER_APPROVED',   '소개몰 입점 승인',         false, false, '자격 상태 — 판매자센터가 열립니다', 'ok'),
  ('SELLER_REJECTED',   '소개몰 입점 반려',         false, false, '자격 상태 — 사유를 고쳐 다시 신청합니다', 'warn')
ON CONFLICT (event_code) DO NOTHING;
