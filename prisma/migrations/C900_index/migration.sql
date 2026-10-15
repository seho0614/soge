-- ── 부하 시험으로 찾은 인덱스 (C900) ───────────────────────────────
--
-- ★ 10만 건을 넣고 재보니 두 뷰가 첫 실행에서 300~500ms 였습니다.
--   두 번째부터는 3ms — **캐시가 없을 때만 느립니다.**
--   운영에서는 새벽에 처음 열 때 그 느림이 나옵니다.
--
--   30건으로는 이것을 알 수 없습니다. 인덱스가 빠져 있어도
--   전부 훑어서 1밀리초입니다.

/* 부동산 매물을 구분으로 거릅니다.
 *
 * 부분 인덱스로 둡니다 — 부동산은 전체의 일부이고,
 * 삭제된 것은 볼 일이 없습니다. */
CREATE INDEX IF NOT EXISTS idx_listings_seller_kind
  ON listings(seller_kind, status)
  WHERE seller_kind IS NOT NULL AND status <> 'DELETED';

/* 관 + 상태 + 최신순 — 목록 화면이 매번 쓰는 조합입니다. */
CREATE INDEX IF NOT EXISTS idx_listings_gwan_status_created
  ON listings(gwan_code, status, created_at DESC)
  WHERE status <> 'DELETED';

/* 소유자별 등록 — 마이페이지와 회원 상세가 씁니다. */
CREATE INDEX IF NOT EXISTS idx_listings_owner_created
  ON listings(owner_account_id, created_at DESC);

ANALYZE listings;
