-- =====================================================================
-- D194 — 파트너 본인 해지 · 축 입점 해지 알림 (v10.224 · 2026-11-10)
--
--   대표 「안심파트너 · 제휴파트너 · 판매자 등록 및 관리 절차 점검」 → 「1 · 2 · 3 모두」(11/9).
--
--   표 · 칸은 바뀌지 않음 — 본인 해지는 이미 있던 값(partners.status · aff_status = 'WITHDRAWN' · mal_partner_axes.state = 'REVOKED')을 씀.
--   ① 알림 종류 PARTNER_AXIS_REVOKED(축 입점 해지 · 운영) 새로 · PARTNER_AXIS_DECIDED(축 승인 · 반려 · 이미 쓰던 코드)는 정책 줄이 없었음 — 함께 넣음.
--   ② 칸 설명 — 탈퇴 사유는 suspended_reason · aff_reason 에 「본인 탈퇴 — …」로 남김.
-- =====================================================================

INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis, tone) VALUES
  ('PARTNER_AXIS_DECIDED', '안심소개 축 입점 승인 · 반려', false, false, '자격 상태', 'info'),
  ('PARTNER_AXIS_REVOKED', '안심소개 축 입점 해지',       false, false, '자격 상태 — 해지된 축에는 새 글을 올릴 수 없습니다', 'warn')
ON CONFLICT (event_code) DO NOTHING;

COMMENT ON COLUMN public.partners.suspended_reason IS
  '안심소개 정지 · 반려 사유(신청자에게 보임) · 본인 탈퇴면 「본인 탈퇴 — 까닭」(v10.224 D194)';
COMMENT ON COLUMN public.partners.aff_reason IS
  '제휴 정지 · 반려 사유(신청자에게 보임) · 본인 탈퇴면 「본인 탈퇴 — 까닭」(v10.224 D194)';
