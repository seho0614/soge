-- =====================================================================
-- D109 — v10.78 운영 몰아치기 징후에서 "사람 없는 기록" 제외 (2026-10-23 · docs/132)
--
--   대표 결정(2026-10-23 「1」)
--
--   「운영자 몰아치기」(ADMIN_BURST · 24시간 50건 넘음)는 **운영 계정이 한꺼번에 무엇을 했는가**(계정 탈취 의심)를 봅니다.
--   그런데 자동검수 자동 승인(fn · REVIEW_AUTO_APPROVED · actor_role SYSTEM · actor_account_id 없음)까지 함께 세어
--   하루에 매물 50건 넘게 자동 승인되면 거짓 경보가 뜨고, 아무도 확인하지 않으면 「확인 밀림」(v_audit_review_overdue)도 뜹니다.
--   개발 서버 점검판에서 realcheck 를 하루 여러 번 돌리자 검정 DB 에 자동 승인 기록 54건이 쌓여 BS-05 · CR-03 이 실패해 드러났습니다.
--   같은 결함을 밤 운영 행위 징후(ADMIN_NIGHT)는 D004(2026-10-02)에서 고쳤습니다 — 같은 조건(actor_account_id IS NOT NULL)을 더합니다.
--
--   열 · 순서 · 이름은 그대로(CREATE OR REPLACE VIEW). v_audit_anomalies · v_audit_review_overdue 는 이 뷰를 그대로 씁니다.
--   자료를 지우지 않습니다. 재실행 안전.
-- =====================================================================
CREATE OR REPLACE VIEW public.v_audit_admin_burst AS
 WITH t AS (
         SELECT audit_thresholds.threshold,
            audit_thresholds.window_hrs
           FROM public.audit_thresholds
          WHERE ((audit_thresholds.code = 'ADMIN_BURST'::text) AND audit_thresholds.is_active)
        )
 SELECT l.actor_account_id,
    a.name,
    l.actor_role,
    count(*) AS actions,
    count(DISTINCT l.action) AS kinds,
    max(l.occurred_at) AS last_at,
    ( SELECT t.threshold
           FROM t) AS threshold
   FROM (audit.audit_logs l
     LEFT JOIN public.accounts a ON ((a.id = l.actor_account_id)))
  WHERE ((l.occurred_at > (now() - ((( SELECT t.window_hrs
           FROM t) || ' hours'::text))::interval)) AND (l.action !~~ '%TEST%'::text)
         AND l.actor_account_id IS NOT NULL)          -- D109 — 사람 없는 기록(배치 · 트리거 · 자동 승인)은 대상이 아님
  GROUP BY l.actor_account_id, a.name, l.actor_role
 HAVING (count(*) > ( SELECT t.threshold
           FROM t));

COMMENT ON VIEW public.v_audit_admin_burst IS
  '운영 계정이 정해진 시간 안에 문턱보다 많이 처리한 것(계정 탈취 의심). 사람 없는 기록(SYSTEM · 자동 승인)은 세지 않습니다(D109 · D004 와 같음).';
