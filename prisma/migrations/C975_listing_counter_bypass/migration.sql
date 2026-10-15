-- =====================================================================
-- C975_listing_counter_bypass · 조회수·찜 갱신이 게시 게이트를 다시 태우지 않게 (K7)
--
-- ★ 증상 (실측)
--   UPDATE listings SET view_count = view_count + 1  (상세를 열 때마다)
--   → BEFORE 트리거 14개가 전부 다시 돕니다
--   → 소개몰 매물의 중개사 인증이 만료되면 fn_broker_gate 가 예외
--   → 목록·검색에는 보이는데 **상세가 안 열립니다** · 찜도 실패
--
-- ★ 고치는 방법
--   게시 게이트 트리거를 INSERT 용과 UPDATE 용으로 나누고, UPDATE 용에는
--   "조회수·찜 수·갱신 시각 말고 다른 것이 바뀌었을 때만" 조건을 답니다.
--   트리거 함수 본문은 **한 줄도 바꾸지 않습니다.**
--
--   조회수 갱신으로 updated_at 이 바뀌는 것도 멈춥니다(trg_listings_upd 같은 조건).
--   "최근 수정" 이 실제 내용 수정을 뜻하게 됩니다.
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_listing_content_changed(o listings, n listings) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT (to_jsonb(o) - ARRAY['view_count','like_count','updated_at'])
         IS DISTINCT FROM
         (to_jsonb(n) - ARRAY['view_count','like_count','updated_at'])
$$;
COMMENT ON FUNCTION fn_listing_content_changed IS
  '조회수·찜 수·갱신 시각 말고 바뀐 것이 있는가. 게시 게이트 트리거의 UPDATE 조건입니다(K7).';

DO $$
DECLARE
  t record;
  /* INSERT OR UPDATE 로 걸린 BEFORE 행 트리거 — 이름 그대로 INSERT 용으로 두고, UPDATE 용은 _u 를 붙입니다.
     이름 순서(실행 순서)는 그대로 유지됩니다. */
  names text[] := ARRAY['trg_aa_realty_mark_kind','trg_broker_gate','trg_gated_category',
                        'trg_hlt_sale_gate','trg_listing_banned_words','trg_listing_business_gate',
                        'trg_listing_gwan_match','trg_listing_restricted','trg_listing_slots',
                        'trg_priority_label'];
  fn text;
BEGIN
  FOREACH fn IN ARRAY names LOOP
    SELECT p.proname INTO t FROM pg_trigger g JOIN pg_proc p ON p.oid = g.tgfoid
     WHERE g.tgrelid = 'public.listings'::regclass AND g.tgname = fn AND NOT g.tgisinternal;
    IF NOT FOUND THEN RAISE EXCEPTION 'C975: 트리거 % 가 없습니다 — kit 판이 다릅니다', fn; END IF;
    EXECUTE format('DROP TRIGGER %I ON listings', fn);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON listings FOR EACH ROW EXECUTE FUNCTION %I()', fn, t.proname);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON listings FOR EACH ROW
                      WHEN (fn_listing_content_changed(OLD, NEW)) EXECUTE FUNCTION %I()', fn || '_u', t.proname);
  END LOOP;

  /* UPDATE 전용 두 개 — 조건만 붙입니다 */
  FOREACH fn IN ARRAY ARRAY['trg_badge_revoke_on_edit','trg_listings_upd'] LOOP
    SELECT p.proname INTO t FROM pg_trigger g JOIN pg_proc p ON p.oid = g.tgfoid
     WHERE g.tgrelid = 'public.listings'::regclass AND g.tgname = fn AND NOT g.tgisinternal;
    IF NOT FOUND THEN RAISE EXCEPTION 'C975: 트리거 % 가 없습니다', fn; END IF;
    EXECUTE format('DROP TRIGGER %I ON listings', fn);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON listings FOR EACH ROW
                      WHEN (fn_listing_content_changed(OLD, NEW)) EXECUTE FUNCTION %I()', fn, t.proname);
  END LOOP;
END $$;

/* 감시 — 조건 없이 UPDATE 에 걸린 게이트 트리거가 새로 생기면 잡습니다 */
CREATE OR REPLACE VIEW v_listing_gate_on_counter AS
SELECT g.tgname
  FROM pg_trigger g
 WHERE g.tgrelid = 'public.listings'::regclass AND NOT g.tgisinternal
   AND (g.tgtype & 16) <> 0                      -- UPDATE
   AND (g.tgtype & 2)  <> 0                      -- BEFORE
   AND pg_get_triggerdef(g.oid) NOT LIKE '%fn_listing_content_changed%';
COMMENT ON VIEW v_listing_gate_on_counter IS
  'K7 — 조회수·찜 갱신에도 도는 BEFORE UPDATE 트리거. 0이어야 합니다. 새 게이트 트리거는 WHEN (fn_listing_content_changed(OLD, NEW)) 를 붙이십시오.';
