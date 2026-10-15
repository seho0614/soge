-- =====================================================================
-- 광고 플랫폼 — 방어 규칙
--
-- 분리했다고 규칙이 느슨해지면 안 됩니다. 본체가 지키던 것을
-- 여기서도 같은 강도로 지킵니다.
-- =====================================================================

/* ── 인피드 ────────────────────────────────────────────────────────
 * 추천과 섞이면 목록 신뢰가 무너지고, 그러면 목록 자체를 안 봅니다. */
CREATE OR REPLACE FUNCTION fn_infeed_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.code = 'INFEED' THEN
    IF coalesce(NEW.spec->>'label', '') = '' THEN
      RAISE EXCEPTION
        'ADS: 인피드는 "광고" 표기가 필요합니다 — 추천과 섞이면 목록 신뢰가 무너집니다';
    END IF;
    IF NEW.in_ranking THEN
      RAISE EXCEPTION
        'ADS: 인피드를 추천 점수에 넣을 수 없습니다 — 돈으로 순위를 사는 것이 됩니다';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_infeed_guard BEFORE INSERT OR UPDATE ON ad_slots
  FOR EACH ROW EXECUTE FUNCTION fn_infeed_guard();

/* ── 심의 ──────────────────────────────────────────────────────────
 * 의료·보험 광고는 심의필 번호 없이 나갈 수 없습니다.
 * 의료기기법 24조 · 의료법 56조. */
CREATE OR REPLACE FUNCTION fn_review_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'ACTIVE' AND NEW.is_regulated
     AND (coalesce(btrim(NEW.review_no), '') = '' OR NEW.review_confirmed_at IS NULL) THEN
    RAISE EXCEPTION
      'ADS: 심의 대상 소재는 심의필 번호와 확인 시각이 있어야 노출됩니다';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_review_guard BEFORE INSERT OR UPDATE ON ad_creatives
  FOR EACH ROW EXECUTE FUNCTION fn_review_guard();

/* ── 광고주 실재 ───────────────────────────────────────────────────
 * 분리했으므로 외래키가 없습니다. 대신 **확인 시각**을 봅니다.
 * 휴폐업한 곳의 광고가 계속 나가면 청구도 할 수 없습니다. */
CREATE OR REPLACE FUNCTION fn_advertiser_guard() RETURNS trigger AS $$
DECLARE v_ok timestamptz; v_sus timestamptz; v_ttl int;
BEGIN
  IF NEW.status <> 'ACTIVE' THEN RETURN NEW; END IF;
  IF NEW.advertiser_id IS NULL THEN RETURN NEW; END IF;

  SELECT verified_at, suspended_at INTO v_ok, v_sus
    FROM advertisers WHERE id = NEW.advertiser_id;
  SELECT value::int INTO v_ttl FROM ad_settings WHERE key = 'verify_ttl_hours';

  IF v_sus IS NOT NULL THEN
    RAISE EXCEPTION 'ADS: 정지된 광고주의 소재는 노출할 수 없습니다';
  END IF;
  IF v_ok IS NULL THEN
    RAISE EXCEPTION 'ADS: 본체에서 사업자 실재를 확인하지 않았습니다';
  END IF;
  IF v_ok < now() - make_interval(hours => coalesce(v_ttl, 24)) THEN
    RAISE EXCEPTION
      'ADS: 사업자 확인이 %시간을 넘었습니다 — 다시 확인하십시오', coalesce(v_ttl,24);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_advertiser_guard BEFORE INSERT OR UPDATE ON ad_creatives
  FOR EACH ROW EXECUTE FUNCTION fn_advertiser_guard();

/* ── 노출 기록 ─────────────────────────────────────────────────────
 * 과금 근거라 지울 수 없습니다. */
CREATE OR REPLACE FUNCTION fn_event_ro() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ADS: 노출·클릭 기록은 수정·삭제할 수 없습니다 (과금 근거)';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_event_ro BEFORE UPDATE OR DELETE ON ad_events
  FOR EACH ROW EXECUTE FUNCTION fn_event_ro();

/* 노출 수를 소재에 누적합니다 — 매번 세면 느립니다. */
CREATE OR REPLACE FUNCTION fn_event_count() RETURNS trigger AS $$
BEGIN
  IF NEW.kind = 'IMPRESSION' THEN
    UPDATE ad_creatives SET impressions = impressions + 1 WHERE id = NEW.creative_id;
  ELSE
    UPDATE ad_creatives SET clicks = clicks + 1 WHERE id = NEW.creative_id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_event_count AFTER INSERT ON ad_events
  FOR EACH ROW EXECUTE FUNCTION fn_event_count();

-- ── 감시 ────────────────────────────────────────────────────────────

/* 본체에 없는 광고주를 가리키는 소재.
 * 분리했으므로 외래키가 못 잡습니다 — 이 뷰가 대신합니다. */
CREATE VIEW v_orphan_ref AS
SELECT c.code, c.advertiser_id, a.verified_at
  FROM ad_creatives c
  LEFT JOIN advertisers a ON a.id = c.advertiser_id
 WHERE c.advertiser_id IS NOT NULL AND a.id IS NULL;

/* 확인이 오래된 광고주. 휴폐업했는데 광고가 계속 나갈 수 있습니다. */
CREATE VIEW v_stale_verify AS
SELECT a.id, a.name, a.verified_at,
       (SELECT count(*) FROM ad_creatives c
         WHERE c.advertiser_id = a.id AND c.status = 'ACTIVE') AS live
  FROM advertisers a
 WHERE a.suspended_at IS NULL
   AND (a.verified_at IS NULL
        OR a.verified_at < now() - make_interval(
             hours => (SELECT value::int FROM ad_settings WHERE key='verify_ttl_hours')));

-- 한 줄 보기
CREATE VIEW v_ad_platform AS
SELECT s.code AS slot, s.name AS slot_name, s.is_active, s.in_ranking,
       (SELECT count(*) FROM ad_products p WHERE p.slot_code=s.code AND p.is_active) AS products,
       (SELECT count(*) FROM ad_creatives c WHERE c.slot_code=s.code AND c.status='ACTIVE'
          AND (c.starts_at IS NULL OR c.starts_at<=current_date)
          AND (c.ends_at IS NULL OR c.ends_at>=current_date)) AS live_creatives,
       (SELECT count(*) FROM ad_bookings b WHERE b.slot_code=s.code AND b.period @> current_date) AS booked,
       (SELECT coalesce(sum(c.impressions),0) FROM ad_creatives c WHERE c.slot_code=s.code) AS impressions,
       (SELECT coalesce(sum(c.clicks),0) FROM ad_creatives c WHERE c.slot_code=s.code) AS clicks,
       (SELECT round(100.0*sum(c.clicks)/nullif(sum(c.impressions),0),2)
          FROM ad_creatives c WHERE c.slot_code=s.code) AS ctr_pct
  FROM ad_slots s ORDER BY s.code;

CREATE VIEW v_ad_no_product AS
SELECT code, name FROM ad_slots s WHERE s.is_active
   AND NOT EXISTS (SELECT 1 FROM ad_products p WHERE p.slot_code=s.code AND p.is_active);

CREATE VIEW v_ad_expiring AS
SELECT code, slot_code, advertiser, ends_at, (ends_at - current_date) AS days_left
  FROM ad_creatives
 WHERE status='ACTIVE' AND ends_at IS NOT NULL
   AND ends_at BETWEEN current_date AND current_date + 7
 ORDER BY ends_at;

CREATE VIEW v_ad_sellable_gap AS
SELECT slot, slot_name, products, live_creatives, booked
  FROM v_ad_platform
 WHERE is_active AND ((products>0 AND live_creatives=0) OR (booked>0 AND live_creatives=0));
