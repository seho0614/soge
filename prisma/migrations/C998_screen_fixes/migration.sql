-- =====================================================================
-- C998 — 73화면 구현 중 발견한 DB 쪽 결함 (2026-10-02)
--
--   1. 제휴 입점 반려 — partners.status 에 'REJECTED' 가 없어
--      BO 「제휴 › 입점 심사」의 반려가 CHECK 위반이었습니다.
--      (목록이 'PENDING' 을 찾던 앱 결함은 affiliate.service 에서 'APPLIED' 로 고침)
--   2. 품목 없는 건강몰 주문 — 주문 생성이 트랜잭션이 아니던 시절 생긴 것을 닫습니다.
--      (앱은 health-shop.service 에서 트랜잭션으로 고침. 재실행 안전)
-- =====================================================================

ALTER TABLE partners DROP CONSTRAINT IF EXISTS partners_status_check;
ALTER TABLE partners ADD CONSTRAINT partners_status_check
  CHECK (status = ANY (ARRAY['APPLIED','ACTIVE','SUSPENDED','WITHDRAWN','REJECTED']));
COMMENT ON COLUMN partners.status IS
  'APPLIED(심사 대기) · ACTIVE · SUSPENDED · WITHDRAWN(본인 탈퇴) · REJECTED(입점 반려, 사유는 suspended_reason) — C998';

UPDATE hlt_orders o SET status = 'CANCELED'
 WHERE o.status = 'PENDING'
   AND NOT EXISTS (SELECT 1 FROM hlt_order_items i WHERE i.order_id = o.id);
