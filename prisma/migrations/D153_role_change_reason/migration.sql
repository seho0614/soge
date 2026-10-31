-- =====================================================================
-- D153 · 권한 변경 기록에 사유 · 처리자를 처음부터 함께 씀 (v10.163 · 2026-11-01 · sgb-core docs/252)
--   결함: 운영 화면 「권한」(POST /admin/roles)이 역할을 주고 뺄 때마다 실패했음.
--     역할을 주면 트리거 fn_role_audit 가 role_changes 에 줄을 INSERT → 서버가 그 줄에 사유 · 처리자를 UPDATE
--     → role_changes 는 수정 · 삭제 금지(trg_role_change_ro · 감사 기록) → 오류 → 거래 전체가 되돌려짐.
--     (10/21 첫 SUPER 를 SQL 로 직접 넣은 까닭 · claude.ai 대화 대조 conversation-audit-20261031 5절)
--   고침: 서버가 같은 거래 안에서 set_config('app.role_reason' · 'app.actor_id', …, true) 를 먼저 하고,
--     트리거가 INSERT 할 때 그 값을 함께 씀. 수정 금지 트리거는 그대로(감사 기록은 여전히 못 고침).
--   SQL 로 직접 역할을 넣는 경우(설정 없음)는 지금처럼 사유 · 처리자 빈칸. 재실행 안전 · 지우는 문장 없음
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_role_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  r text := nullif(btrim(coalesce(current_setting('app.role_reason', true), '')), '');
  a text := current_setting('app.actor_id', true);
  who uuid := CASE WHEN a ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN a::uuid END;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.role IN ('ADMIN','SUPER','REVIEWER') THEN
    INSERT INTO role_changes(account_id, role, action, reason, changed_by) VALUES (NEW.account_id, NEW.role, 'GRANT', r, who);
  ELSIF TG_OP = 'DELETE' AND OLD.role IN ('ADMIN','SUPER','REVIEWER') THEN
    INSERT INTO role_changes(account_id, role, action, reason, changed_by) VALUES (OLD.account_id, OLD.role, 'REVOKE', r, who);
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;

COMMENT ON FUNCTION public.fn_role_audit() IS '관리 역할(ADMIN · SUPER · REVIEWER) 주기 · 빼기를 role_changes 에 남김 — 사유 · 처리자는 같은 거래의 app.role_reason · app.actor_id(D153 · v10.163). 기록은 수정 · 삭제 금지(trg_role_change_ro)';
