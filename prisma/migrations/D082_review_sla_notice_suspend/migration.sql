-- v10.31 (10/10 「시안 기준」 · 정책 문구는 시안대로 — 안내 글이 참이 되도록 서버 규칙까지)
--   검수 큐(SB-ADM-REV-010) 「SLA 24시간을 넘기면 등록자에게 자동 안내가 나갑니다」
--     → fn_check_sla_alert(매시간 sla_alert 작업)가 넘긴 건의 등록자에게 알림을 한 번 보냅니다(sla_notified_at).
--   검수 상세(SB-ADM-REV-020) 「같은 등록자가 제한업종 · 금칙 표현으로 3회 반려되면 등록 권한이 일시 정지 · 관리자 알림」
--     → 반려 사유 RESTRICTED(제한업종) · BANNED_WORD(금칙 표현) 반려가 최근 90일 3회가 되면 7일간 새 등록(매물 · 요청)을 막고
--       운영 경보(ops_alerts)를 남깁니다. 운영은 회원 상세에서 풀 수 있습니다.

ALTER TABLE review_items ADD COLUMN IF NOT EXISTS sla_notified_at timestamptz;

INSERT INTO review_reason_codes (code, label, category, sort_order, is_active)
SELECT 'RESTRICTED', '제한업종 — 관련 법령에 따라 등록할 수 없는 업종입니다', 'POLICY',
       coalesce((SELECT max(sort_order) FROM review_reason_codes), 0) + 1, true
WHERE NOT EXISTS (SELECT 1 FROM review_reason_codes WHERE code = 'RESTRICTED');

CREATE OR REPLACE FUNCTION public.fn_check_sla_alert() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM review_items
   WHERE status IN ('QUEUED','IN_PROGRESS') AND sla_due_at < now();
  IF n > 0 THEN
    INSERT INTO ops_alerts(alert_code, severity, title, detail)
    VALUES ('REVIEW_SLA_BREACH', CASE WHEN n >= 20 THEN 'CRITICAL' ELSE 'WARN' END,
            format('검수 SLA 위반 %s건', n), jsonb_build_object('count', n))
    ON CONFLICT DO NOTHING;
  END IF;
  /* v10.31 — 넘긴 건의 등록자에게 한 번만 안내합니다 */
  WITH due AS (
    UPDATE review_items SET sla_notified_at = now()
     WHERE status IN ('QUEUED','IN_PROGRESS') AND sla_due_at < now() AND sla_notified_at IS NULL
       AND submitted_by IS NOT NULL
    RETURNING submitted_by, target_type
  )
  INSERT INTO notifications (account_id, event_code, title, body, link_url)
  SELECT submitted_by, 'REVIEW_SLA_DELAY', '검수가 늦어지고 있습니다',
         CASE target_type WHEN 'REQUEST' THEN '올리신 요청' WHEN 'BUSINESS' THEN '사업자 신청' ELSE '올리신 매물' END
           || '의 검수가 24시간을 넘겼습니다. 순서대로 확인하고 있으니 조금만 기다려 주십시오. 결과는 바로 알려 드립니다.',
         '/my/listings'
    FROM due;
  RETURN n;
END $$;

/* ── 등록 일시 정지 ─────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS posting_suspensions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES accounts(id),
  until_at    timestamptz NOT NULL,
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  lifted_at   timestamptz,
  lifted_by   uuid REFERENCES accounts(id)
);
COMMENT ON TABLE posting_suspensions IS 'v10.31 — 제한업종 · 금칙 표현 반려 3회(90일) → 7일 등록 정지. 운영이 풀 수 있음';
CREATE INDEX IF NOT EXISTS idx_posting_susp_live ON posting_suspensions (account_id) WHERE lifted_at IS NULL;

CREATE OR REPLACE FUNCTION fn_review_reject_strikes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  IF NEW.status = 'REJECTED' AND OLD.status IS DISTINCT FROM 'REJECTED'
     AND NEW.reject_reason_code IN ('RESTRICTED','BANNED_WORD') AND NEW.submitted_by IS NOT NULL THEN
    SELECT count(*) INTO n FROM review_items
     WHERE submitted_by = NEW.submitted_by AND status = 'REJECTED'
       AND reject_reason_code IN ('RESTRICTED','BANNED_WORD')
       AND decided_at > now() - interval '90 days';
    IF n >= 3 AND NOT EXISTS (SELECT 1 FROM posting_suspensions s
                               WHERE s.account_id = NEW.submitted_by AND s.lifted_at IS NULL AND s.until_at > now()) THEN
      INSERT INTO posting_suspensions (account_id, until_at, reason)
      VALUES (NEW.submitted_by, now() + interval '7 days', format('제한업종 · 금칙 표현 반려 %s회(90일)', n));
      INSERT INTO notifications (account_id, event_code, title, body, link_url)
      VALUES (NEW.submitted_by, 'POSTING_SUSPENDED', '등록이 7일간 정지되었습니다',
              '제한업종 · 금칙 표현으로 3회 반려되어 7일간 새 등록을 할 수 없습니다. 이미 올린 것은 그대로입니다.', '/my/listings');
      INSERT INTO ops_alerts (alert_code, severity, title, detail)
      VALUES ('POSTING_SUSPENDED', 'WARN', '등록 일시 정지 1건 — 제한업종 · 금칙 표현 반려 3회',
              jsonb_build_object('accountId', NEW.submitted_by, 'count', n))
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_review_reject_strikes ON review_items;
CREATE TRIGGER trg_review_reject_strikes AFTER UPDATE ON review_items
  FOR EACH ROW EXECUTE FUNCTION fn_review_reject_strikes();

CREATE OR REPLACE FUNCTION fn_posting_suspended_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u timestamptz;
BEGIN
  SELECT max(until_at) INTO u FROM posting_suspensions
   WHERE account_id = NEW.owner_account_id AND lifted_at IS NULL AND until_at > now();
  IF u IS NOT NULL THEN
    RAISE EXCEPTION 'POSTING_SUSPENDED: 제한업종 · 금칙 표현 반려가 3회 쌓여 % 까지 새 등록을 할 수 없습니다',
      to_char(u AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_listing_posting_suspended ON listings;
CREATE TRIGGER trg_listing_posting_suspended BEFORE INSERT ON listings
  FOR EACH ROW EXECUTE FUNCTION fn_posting_suspended_guard();
DROP TRIGGER IF EXISTS trg_request_posting_suspended ON requests;
CREATE TRIGGER trg_request_posting_suspended BEFORE INSERT ON requests
  FOR EACH ROW EXECUTE FUNCTION fn_posting_suspended_guard();
