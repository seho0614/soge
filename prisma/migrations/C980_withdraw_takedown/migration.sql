-- =====================================================================
-- C980 — K6. 탈퇴 계정의 매물·요청을 내립니다
--
--   사장님 결정 (2026-09-25):
--     정지(SUSPENDED) → 그대로 둡니다. 소명하면 돌아옵니다.
--     탈퇴(WITHDRAWN) → 내립니다. 연락이 닿지 않습니다.
--
--   왜 DB 에서 막는가:
--     status='PUBLISHED' 로 거르는 곳이 앱 소스에 22군데 있습니다.
--     한 곳만 빠뜨려도 탈퇴자의 매물이 계속 노출됩니다.
--     소유자가 탈퇴하는 순간 매물 상태 자체를 바꾸면 22곳이 전부
--     저절로 따라옵니다.
--
--   ARCHIVED 를 쓰는 이유:
--     SUSPENDED 는 운영자가 제재한 것이라는 뜻입니다. 탈퇴는 제재가
--     아니므로 섞으면 나중에 통계와 이의제기 처리가 어긋납니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 탈퇴 시 내리기
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_withdraw_takedown() RETURNS trigger AS $$
BEGIN
  -- 탈퇴로 바뀌는 순간에만 돕니다. 정지는 건드리지 않습니다.
  IF NEW.status = 'WITHDRAWN' AND COALESCE(OLD.status, '') <> 'WITHDRAWN' THEN

    UPDATE listings
       SET status = 'ARCHIVED'
     WHERE owner_account_id = NEW.id
       AND status IN ('PUBLISHED', 'IN_REVIEW', 'DRAFT');

    UPDATE requests
       SET status = 'ARCHIVED'
     WHERE owner_account_id = NEW.id
       AND status IN ('PUBLISHED', 'IN_REVIEW', 'DRAFT');

  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_withdraw_takedown() IS
'탈퇴하면 그 계정의 매물·요청을 ARCHIVED 로 내립니다. 정지(SUSPENDED)는 그대로 둡니다 — 소명하면 돌아오기 때문입니다.';

DROP TRIGGER IF EXISTS trg_withdraw_takedown ON accounts;
CREATE TRIGGER trg_withdraw_takedown
  AFTER UPDATE OF status ON accounts
  FOR EACH ROW
  WHEN (NEW.status = 'WITHDRAWN' AND OLD.status IS DISTINCT FROM 'WITHDRAWN')
  EXECUTE FUNCTION fn_withdraw_takedown();

-- ---------------------------------------------------------------------
-- 2. 재발 감시 — 탈퇴자인데 아직 공개 중인 것
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_withdrawn_still_public AS
SELECT 'listing' AS kind, l.id, l.title, a.id AS account_id, a.withdrawn_at
  FROM listings l
  JOIN accounts a ON a.id = l.owner_account_id
 WHERE a.status = 'WITHDRAWN'
   AND l.status IN ('PUBLISHED', 'IN_REVIEW')
UNION ALL
SELECT 'request', r.id, r.title, a.id, a.withdrawn_at
  FROM requests r
  JOIN accounts a ON a.id = r.owner_account_id
 WHERE a.status = 'WITHDRAWN'
   AND r.status IN ('PUBLISHED', 'IN_REVIEW');

COMMENT ON VIEW v_withdrawn_still_public IS
'탈퇴한 계정인데 아직 공개 중인 매물·요청. **0이어야 정상** — 연락이 닿지 않는 사람의 글이 팔리고 있다는 뜻입니다.';

-- ---------------------------------------------------------------------
-- 3. 이미 탈퇴한 계정이 있으면 지금 한 번 정리합니다
-- ---------------------------------------------------------------------
UPDATE listings l
   SET status = 'ARCHIVED'
  FROM accounts a
 WHERE a.id = l.owner_account_id
   AND a.status = 'WITHDRAWN'
   AND l.status IN ('PUBLISHED', 'IN_REVIEW', 'DRAFT');

UPDATE requests r
   SET status = 'ARCHIVED'
  FROM accounts a
 WHERE a.id = r.owner_account_id
   AND a.status = 'WITHDRAWN'
   AND r.status IN ('PUBLISHED', 'IN_REVIEW', 'DRAFT');
