-- =====================================================================
-- C890_audit  ·  감사 확인 기록
--
-- ── 지금 무엇이 있었나 ──────────────────────────────────────────────
--   기록    audit.audit_logs · audit.pii_access_logs
--   감시    v_audit_anomalies 외 7종
--   임계값  audit_thresholds 5종
--
-- ── 무엇이 없었나 ───────────────────────────────────────────────────
--   ① **확인했다는 기록** — 징후를 보고 어떻게 판단했는지
--   ② **API** — 운영이 터미널을 열어야 봅니다
--   ③ **보관 기간** — 언제까지 두는지 정해진 바가 없습니다
--
-- ── ★ 왜 ①이 중요한가 ──────────────────────────────────────────────
--   징후가 떠도 **누가 보았고 어떻게 판단했는지** 남지 않으면
--   나중에 "그때 왜 그냥 넘어갔느냐" 에 답할 수 없습니다.
--   감시만 있고 확인이 없으면 감사가 아니라 **경고음**일 뿐입니다.
-- =====================================================================

-- ── ① 확인 기록 ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /* 무엇을 보았나 — 뷰 이름과 그 안의 대상 */
  signal_code  text NOT NULL,
  target_kind  text,
  target_id    text,
  /* 어떻게 판단했나 */
  verdict      text NOT NULL,
  reason       text NOT NULL,
  reviewed_by  uuid NOT NULL REFERENCES accounts(id),
  reviewed_at  timestamptz NOT NULL DEFAULT now(),
  /* 조치했다면 무엇을 */
  action_taken text,

  CONSTRAINT areview_verdict_check
    CHECK (verdict IN ('NORMAL','WATCH','ESCALATED','ACTION_TAKEN'))
);

COMMENT ON TABLE audit_reviews IS
  '감사 징후를 확인한 기록. **징후가 떠도 누가 보고 어떻게 '
  '판단했는지 남지 않으면** 나중에 "왜 그냥 넘어갔느냐" 에 답할 수 '
  '없습니다.';
COMMENT ON COLUMN audit_reviews.verdict IS
  'NORMAL(정상) · WATCH(지켜봄) · ESCALATED(윗선 보고) · ACTION_TAKEN(조치함)';
COMMENT ON COLUMN audit_reviews.reason IS
  '★ 왜 그렇게 판단했는지. **비워 둘 수 없습니다** — "확인함" 만 '
  '남으면 확인 안 한 것과 같습니다.';

CREATE INDEX IF NOT EXISTS idx_areview_signal
  ON audit_reviews(signal_code, reviewed_at DESC);

/* 사유 없이 넘어갈 수 없습니다. */
CREATE OR REPLACE FUNCTION fn_audit_review_guard() RETURNS trigger AS $$
BEGIN
  IF coalesce(btrim(NEW.reason),'') = '' THEN
    RAISE EXCEPTION
      'AUDIT: 판단 사유를 적으십시오 — "확인함" 만 남으면 확인 안 한 것과 같습니다';
  END IF;
  /* ★ 조치했다면서 무엇을 했는지 안 적으면 조치가 아닙니다. */
  IF NEW.verdict = 'ACTION_TAKEN' AND coalesce(btrim(NEW.action_taken),'') = '' THEN
    RAISE EXCEPTION 'AUDIT: 무슨 조치를 했는지 적으십시오';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_review_guard ON audit_reviews;
CREATE TRIGGER trg_audit_review_guard BEFORE INSERT OR UPDATE ON audit_reviews
  FOR EACH ROW EXECUTE FUNCTION fn_audit_review_guard();

-- ── ② 보관 기간 ───────────────────────────────────────────────────
INSERT INTO site_settings (key, value, scope, description, value_example, value_pattern)
VALUES
 ('audit.retention_days', '1095', 'GLOBAL',
  '감사 기록 보관 일수. 개인정보 보호법은 최소 1년(접속기록 2년)을 '
  '요구하지만, 분쟁이 늦게 오는 것을 생각하면 **3년(1095일)** 을 '
  '권합니다. 너무 짧으면 정작 필요할 때 없습니다.',
  '1095', '^[0-9]{2,5}$'),
 ('audit.review_sla_hours', '48', 'GLOBAL',
  '징후가 뜬 뒤 확인해야 하는 시간. 넘기면 v_audit_review_overdue 에 '
  '잡힙니다. **밀리면 아무도 안 봅니다.**',
  '48', '^[0-9]{1,3}$')
ON CONFLICT (key) DO NOTHING;

-- ── ③ 감시 ────────────────────────────────────────────────────────

/* ★ 징후가 떴는데 아무도 확인하지 않은 것.
 *
 *   감시 뷰가 아무리 많아도 **보는 사람이 없으면 소용없습니다.**
 *   이것이 0이 아니면 감사 체계가 도는 것이 아니라 쌓이는 것입니다. */
CREATE OR REPLACE VIEW v_audit_review_overdue AS
WITH sig AS (
  SELECT 'PII_BURST'::text AS code, count(*)::int AS n FROM v_audit_pii_burst
  UNION ALL SELECT 'PII_NIGHT', count(*)::int FROM v_audit_night_access
  UNION ALL SELECT 'ADMIN_BURST', count(*)::int FROM v_audit_admin_burst
  UNION ALL SELECT 'ADMIN_NIGHT', count(*)::int FROM v_audit_admin_night
  UNION ALL SELECT 'SAME_TARGET', count(*)::int FROM v_audit_same_target
  UNION ALL SELECT 'NO_REASON', count(*)::int FROM v_audit_no_reason
)
SELECT s.code, s.n AS signal_count,
       (SELECT max(reviewed_at) FROM audit_reviews r WHERE r.signal_code = s.code) AS last_reviewed
  FROM sig s
 WHERE s.n > 0
   AND NOT EXISTS (
     SELECT 1 FROM audit_reviews r
      WHERE r.signal_code = s.code
        AND r.reviewed_at >= now() - (
          (SELECT coalesce(nullif(value,''),'48')::int FROM site_settings
            WHERE key = 'audit.review_sla_hours') || ' hours')::interval);

COMMENT ON VIEW v_audit_review_overdue IS
  '징후가 떴는데 정해진 시간 안에 확인하지 않은 것. **0이어야 '
  '합니다** — 감시 뷰가 아무리 많아도 보는 사람이 없으면 '
  '감사가 아니라 경고음일 뿐입니다.';

/* 판단 사유가 부실한 기록 */
CREATE OR REPLACE VIEW v_audit_review_thin AS
SELECT id, signal_code, verdict, reason, reviewed_at
  FROM audit_reviews
 WHERE length(btrim(reason)) < 10;

COMMENT ON VIEW v_audit_review_thin IS
  '사유가 열 자도 안 되는 확인 기록. **0이어야 합니다** — '
  '"이상 없음" 같은 말은 나중에 아무 근거가 되지 않습니다.';

/* 보관 기간을 넘긴 기록 */
CREATE OR REPLACE VIEW v_audit_over_retention AS
SELECT 'audit_logs'::text AS tbl, count(*)::int AS n
  FROM audit.audit_logs
 WHERE occurred_at < now() - (
   (SELECT coalesce(nullif(value,''),'1095')::int FROM site_settings
     WHERE key = 'audit.retention_days') || ' days')::interval
HAVING count(*) > 0;

COMMENT ON VIEW v_audit_over_retention IS
  '보관 기간을 넘긴 감사 기록. **0이어야 합니다** — 필요 이상으로 '
  '오래 두는 것도 개인정보 보호법 위반입니다.';
