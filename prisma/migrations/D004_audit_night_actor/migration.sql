-- =====================================================================
-- D004 — 야간 운영 행위 징후에서 "사람 없는 기록" 제외 (2026-10-02)
--
--   검정(attack-check BS-05 · CR-03)이 **밤 10시~아침 7시에 돌리면** 실패했습니다.
--   배치 · 트리거 · 시험 픽스처가 남기는 행위 기록(actor_account_id 가 없음)이
--   'ADMIN_NIGHT' 로 묶여 문턱(10)을 넘었기 때문입니다(10/1 02:58 실측 13건).
--   이 징후는 "운영 계정이 밤에 무엇을 했는가"(계정 탈취 의심)를 보는 것이므로
--   사람이 없는 기록은 대상이 아닙니다. 사람 기록은 그대로 봅니다.
-- =====================================================================
CREATE OR REPLACE VIEW public.v_audit_admin_night AS
 WITH t AS (
         SELECT audit_thresholds.threshold, audit_thresholds.window_hrs
           FROM audit_thresholds
          WHERE audit_thresholds.code = 'ADMIN_NIGHT' AND audit_thresholds.is_active
        )
 SELECT l.actor_account_id,
    a.name,
    count(*) AS actions,
    string_agg(DISTINCT l.action, ', ') AS kinds,
    max(l.occurred_at) AS last_at,
    (SELECT t.threshold FROM t) AS threshold
   FROM audit.audit_logs l
     LEFT JOIN accounts a ON a.id = l.actor_account_id
  WHERE l.occurred_at > (now() - (((SELECT t.window_hrs FROM t) || ' hours'))::interval)
    AND l.action !~~ '%TEST%'
    AND l.actor_account_id IS NOT NULL
    AND (EXTRACT(hour FROM (l.occurred_at AT TIME ZONE 'Asia/Seoul')) >= 22
         OR EXTRACT(hour FROM (l.occurred_at AT TIME ZONE 'Asia/Seoul')) < 7)
  GROUP BY l.actor_account_id, a.name
 HAVING count(*) > (SELECT t.threshold FROM t);
