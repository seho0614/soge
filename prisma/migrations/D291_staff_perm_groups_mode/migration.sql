-- v10.561 ~ 564 (docs/702 ~ 706) — 회원 · 직원 권한 분리 A안 + 업무 목록 → 업무그룹 → 권한그룹 → 사원에게 부여 + 판정 바꾸기(perm.mode)
--   대표 11/21 A안 승인 · 같은 날 「업무 목록 → 업무그룹 → 권한그룹 → 사원에게 부여(사원 권한은 권한그룹이 정함 · 회원은 기존 규칙)」를 A안과 합쳐 한 번에.
--   마이그레이션은 이것 하나(v10.561 · 562 · 563 · 564 모두 · #329). 다시 돌려도 같음. 표 · 칸을 지우지 않음(DELETE 는 기본 메뉴 그룹을 옮길 때 그 업무그룹 항목 하나를 옮기는 트리거 안 · DROP 은 perm_shadow_log mode 검사를 넓히려고 옛 검사를 바꾸는 것뿐).
--   RAISE 글자에 퍼센트 기호 없음 · 트리거 이름 고유 · 운영 알림은 clock_timestamp().

/* ── ① 메뉴 이름 · 그룹 옮김 (v10.561 · docs/703) ───────────────────────────────────
 *   운영 화면 그룹 acl 「권한 계층」 → 「직원 · 권한」(키 그대로) · 사무 › 권한 관리(perm-admin) → 직원 · 권한 › 업무별 권한
 *   위험감지 › 운영자 권한(role-review) → 직원 · 권한 › 권한 점검 · 권한 계층 › 권한 관리(roles) → 역할 주기
 *   업무(perm_tasks) 이름 · 기본 메뉴 그룹도 같게(처음 이름 그대로일 때만 — SUPER 가 고친 이름은 그대로) */
UPDATE public.perm_task_groups SET name = '직원 · 권한', updated_at = now() WHERE key = 'acl' AND name = '권한 계층';
UPDATE public.perm_tasks SET group_key = 'acl' WHERE key IN ('perm-admin', 'role-review') AND group_key IN ('admoff', 'admrsk');
UPDATE public.perm_tasks SET name = '업무별 권한' WHERE key = 'perm-admin' AND name = '권한 관리';
UPDATE public.perm_tasks SET name = '권한 점검' WHERE key = 'role-review' AND name = '운영자 권한';
UPDATE public.perm_tasks SET name = '역할 주기' WHERE key = 'roles' AND name = '권한 관리';

/* ── ② 업무 · 업무그룹 · 권한그룹 표 넓힘 (v10.562 · docs/704) ──────────────────────────
 *   업무: 설명 · 업무그룹: 켜고 끄기 · 메모 · 업무 하나가 여러 업무그룹에(perm_task_group_items · 처음은 지금 group_key)
 *   perm_tasks.group_key 는 「기본 메뉴 그룹」 — 새 업무가 생기거나 기본 메뉴 그룹을 옮기면 트리거가 그 업무그룹 항목도 맞춤
 *   권한그룹 항목 = 업무그룹 × 수준(perm_role_group_sets) + 업무 단위 더하기 · 빼기(perm_role_group_items.effect · 옛 줄은 모두 ALLOW) */
ALTER TABLE public.perm_tasks ADD COLUMN IF NOT EXISTS description text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'perm_tasks_description_len' AND conrelid = 'public.perm_tasks'::regclass) THEN
    ALTER TABLE public.perm_tasks ADD CONSTRAINT perm_tasks_description_len CHECK (description IS NULL OR char_length(description) <= 300);
  END IF;
END $$;
ALTER TABLE public.perm_task_groups ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE public.perm_task_groups ADD COLUMN IF NOT EXISTS note text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'perm_task_groups_note_len' AND conrelid = 'public.perm_task_groups'::regclass) THEN
    ALTER TABLE public.perm_task_groups ADD CONSTRAINT perm_task_groups_note_len CHECK (note IS NULL OR char_length(note) <= 200);
  END IF;
END $$;
COMMENT ON COLUMN public.perm_task_groups.active IS 'v10.562 (D291) 끄면 이 업무그룹으로 붙인 권한(세트)이 모두 빠짐 · 메뉴와 같은 처음 업무그룹은 지우지 않고 끄기만';

CREATE TABLE IF NOT EXISTS public.perm_task_group_items (
  group_key   text NOT NULL REFERENCES public.perm_task_groups(key),
  task_key    text NOT NULL REFERENCES public.perm_tasks(key),
  PRIMARY KEY (group_key, task_key)
);
COMMENT ON TABLE public.perm_task_group_items IS 'v10.562 (D291) 업무그룹에 든 업무 — 업무 하나가 여러 업무그룹에 들 수 있음 · 처음은 perm_tasks.group_key(기본 메뉴 그룹)로 채움';
CREATE INDEX IF NOT EXISTS ix_perm_task_group_items_task ON public.perm_task_group_items (task_key);
INSERT INTO public.perm_task_group_items (group_key, task_key)
SELECT t.group_key, t.key FROM public.perm_tasks t ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_perm_task_menu_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.group_key IS NOT DISTINCT FROM OLD.group_key THEN RETURN NEW; END IF;
    DELETE FROM public.perm_task_group_items WHERE group_key = OLD.group_key AND task_key = NEW.key;
  END IF;
  INSERT INTO public.perm_task_group_items (group_key, task_key) VALUES (NEW.group_key, NEW.key) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_perm_task_menu_item' AND tgrelid = 'public.perm_tasks'::regclass) THEN
    CREATE TRIGGER trg_perm_task_menu_item AFTER INSERT OR UPDATE OF group_key ON public.perm_tasks FOR EACH ROW EXECUTE FUNCTION public.fn_perm_task_menu_item();
  END IF;
END $$;

ALTER TABLE public.perm_role_group_items ADD COLUMN IF NOT EXISTS effect text NOT NULL DEFAULT 'ALLOW';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'perm_role_group_items_effect_chk' AND conrelid = 'public.perm_role_group_items'::regclass) THEN
    ALTER TABLE public.perm_role_group_items ADD CONSTRAINT perm_role_group_items_effect_chk CHECK (effect IN ('ALLOW', 'DENY'));
  END IF;
END $$;
COMMENT ON COLUMN public.perm_role_group_items.effect IS 'v10.562 (D291) ALLOW = 업무 단위 더하기(옛 항목 모두) · DENY = 이 권한그룹의 세트에서 그 업무 · 수준만 빼기(다른 권한그룹이 주면 그대로)';

CREATE TABLE IF NOT EXISTS public.perm_role_group_sets (
  group_key       text NOT NULL REFERENCES public.perm_role_groups(key),
  task_group_key  text NOT NULL REFERENCES public.perm_task_groups(key),
  level           text NOT NULL CHECK (level IN ('VIEW', 'EDIT', 'APPROVE', 'EXPORT')),
  PRIMARY KEY (group_key, task_group_key, level)
);
COMMENT ON TABLE public.perm_role_group_sets IS 'v10.562 (D291) 권한그룹 항목 — 업무그룹 × 수준(그 업무그룹에 든 모든 업무 · 업무가 쓸 수 있는 수준만 · 꺼진 업무 · 업무그룹 빼고 펼침)';

/* 함께 못 갖는 조합 — 한 권한그룹 · 한 사람의 실제 권한에 A 쪽 하나와 B 쪽 하나가 함께 있으면 서버가 저장을 막음(422 PERM_CONFLICT)
 *   처음 3줄 = 역할 겸직 금지(C710 ADMIN · PAYOUT · D173 PAYOUT · PARTNER_*)를 업무로 옮긴 것 — 각 쪽은 그 역할만 가진 업무로 골라 지금 R_ 그룹 하나로는 걸리지 않음 */
CREATE TABLE IF NOT EXISTS public.perm_conflict_rules (
  code        text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,40}$'),
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  note        text CHECK (note IS NULL OR char_length(note) <= 200),
  active      boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.perm_conflict_items (
  code        text NOT NULL REFERENCES public.perm_conflict_rules(code),
  side        text NOT NULL CHECK (side IN ('A', 'B')),
  task_key    text NOT NULL REFERENCES public.perm_tasks(key),
  level       text NOT NULL CHECK (level IN ('VIEW', 'EDIT', 'APPROVE', 'EXPORT')),
  PRIMARY KEY (code, side, task_key, level)
);
COMMENT ON TABLE public.perm_conflict_rules IS 'v10.562 (D291) 함께 못 갖는 권한 조합 — 승인과 지급 실행을 한 사람이 갖지 못하게(C710 · D173 을 권한그룹으로)';
INSERT INTO public.perm_conflict_rules (code, name, note) VALUES
  ('C710_APPROVE_PAY', '정산 승인 ↔ 지급 실행', 'C710 — 승인하는 사람과 돈을 보내는 사람을 나눔(ADMIN · PAYOUT 겸직 금지와 같음)'),
  ('D173_PAY_MAL', '지급 실행 ↔ 안심 파트너 담당', 'D173 — 지급 담당은 안심 파트너 담당과 함께 가질 수 없음'),
  ('D173_PAY_AFF', '지급 실행 ↔ 제휴 파트너 담당', 'D173 — 지급 담당은 제휴 파트너 담당과 함께 가질 수 없음')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.perm_conflict_items (code, side, task_key, level)
SELECT v.c, v.s, v.t, v.l FROM (VALUES
  ('C710_APPROVE_PAY', 'A', 'settlement', 'APPROVE'), ('C710_APPROVE_PAY', 'A', 'settlement', 'EDIT'),
  ('C710_APPROVE_PAY', 'B', 'fin-transfer', 'EDIT'), ('C710_APPROVE_PAY', 'B', 'fin-transfer', 'APPROVE'), ('C710_APPROVE_PAY', 'B', 'acct-bank', 'EDIT'),
  ('D173_PAY_MAL', 'A', 'fin-transfer', 'EDIT'), ('D173_PAY_MAL', 'A', 'fin-transfer', 'APPROVE'),
  ('D173_PAY_MAL', 'B', 'partners', 'EDIT'), ('D173_PAY_MAL', 'B', 'partner-axes', 'EDIT'),
  ('D173_PAY_AFF', 'A', 'fin-transfer', 'EDIT'), ('D173_PAY_AFF', 'A', 'fin-transfer', 'APPROVE'),
  ('D173_PAY_AFF', 'B', 'affiliates', 'EDIT')
) AS v(c, s, t, l)
WHERE EXISTS (SELECT 1 FROM public.perm_tasks k WHERE k.key = v.t)
ON CONFLICT DO NOTHING;

/* 권한그룹 하나를 펼친 실제 업무 · 수준 — 세트(업무그룹 × 수준) + 더하기 − 이 그룹의 빼기 */
CREATE OR REPLACE FUNCTION public.fn_perm_group_expand(p_group text)
 RETURNS TABLE (task_key text, level text) LANGUAGE sql STABLE AS $$
  SELECT y.task_key, y.level FROM (
    SELECT i.task_key, i.level FROM public.perm_role_group_items i WHERE i.group_key = p_group AND i.effect = 'ALLOW'
    UNION
    SELECT gi.task_key, s.level
      FROM public.perm_role_group_sets s
      JOIN public.perm_task_groups tg ON tg.key = s.task_group_key AND tg.active
      JOIN public.perm_task_group_items gi ON gi.group_key = s.task_group_key
      JOIN public.perm_tasks t ON t.key = gi.task_key AND t.active AND s.level = ANY (t.levels)
     WHERE s.group_key = p_group
  ) y
  WHERE NOT EXISTS (SELECT 1 FROM public.perm_role_group_items d
                     WHERE d.group_key = p_group AND d.effect = 'DENY' AND d.task_key = y.task_key AND d.level = y.level)
$$;
COMMENT ON FUNCTION public.fn_perm_group_expand(text) IS 'v10.562 (D291) 권한그룹 펼침 — 세트 + 업무 더하기 − 그 그룹 업무 빼기';

/* 사람의 실제 권한 — 붙은 권한그룹(기한 · 켜짐)마다 펼친 것의 합 + 개별 더하기 − 개별 빼기(D258 판과 같은 이름 · 옛 데이터는 같은 결과) */
CREATE OR REPLACE FUNCTION public.fn_perm_effective(p_account uuid)
 RETURNS TABLE (task_key text, level text) LANGUAGE sql STABLE AS $$
  SELECT x.task_key, x.level FROM (
    SELECT e.task_key, e.level
      FROM public.perm_account_groups g JOIN public.perm_role_groups r ON r.key = g.group_key AND r.active
      CROSS JOIN LATERAL public.fn_perm_group_expand(g.group_key) e
     WHERE g.account_id = p_account AND (g.expires_at IS NULL OR g.expires_at > now())
    UNION
    SELECT o.task_key, o.level FROM public.perm_account_overrides o
     WHERE o.account_id = p_account AND o.effect = 'ALLOW' AND (o.expires_at IS NULL OR o.expires_at > now())
  ) x
  WHERE NOT EXISTS (SELECT 1 FROM public.perm_account_overrides d
                     WHERE d.account_id = p_account AND d.effect = 'DENY' AND d.task_key = x.task_key AND d.level = x.level
                       AND (d.expires_at IS NULL OR d.expires_at > now()))
$$;
CREATE OR REPLACE FUNCTION public.fn_perm_widen_effective(p_account uuid)
 RETURNS TABLE (task_key text, level text) LANGUAGE sql STABLE AS $$
  SELECT x.task_key, x.level FROM (
    SELECT e.task_key, e.level
      FROM public.perm_account_groups g JOIN public.perm_role_groups r ON r.key = g.group_key AND r.active AND r.from_role IS NULL
      CROSS JOIN LATERAL public.fn_perm_group_expand(g.group_key) e
     WHERE g.account_id = p_account AND (g.expires_at IS NULL OR g.expires_at > now())
    UNION
    SELECT o.task_key, o.level FROM public.perm_account_overrides o
     WHERE o.account_id = p_account AND o.effect = 'ALLOW' AND (o.expires_at IS NULL OR o.expires_at > now())
  ) x
  WHERE NOT EXISTS (SELECT 1 FROM public.perm_account_overrides d
                     WHERE d.account_id = p_account AND d.effect = 'DENY' AND d.task_key = x.task_key AND d.level = x.level
                       AND (d.expires_at IS NULL OR d.expires_at > now()))
$$;

/* ── ③ 새 탭 업무 · 권한 시드 (v10.561 ~ 564 · gen_seed 규칙 — GET = VIEW · 그 밖 변경 = EDIT) ─────────────
 *   staff-list 운영자 목록(ADMIN · SUPER) · perm-log 바뀐 기록(ADMIN · SUPER) · perm-staff · perm-roles · perm-groups · perm-tasks(SUPER 만 — R_ 그룹에 넣지 않음) */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort, description) VALUES
  ('staff-list',  '운영자 목록', 'acl', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 1081, '운영 역할이 있는 계정 · 연결 직원 · 역할 · 기한 · 2단계 · 마지막 로그인(v10.561)'),
  ('perm-staff',  '사원 권한',   'acl', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 1082, '사원마다 권한그룹 · 기한 · 개별 더하기/빼기 · 실제 권한 미리보기(v10.563 · SUPER)'),
  ('perm-roles',  '권한그룹',    'acl', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 1083, '업무그룹 × 수준 · 업무 더하기/빼기 · 함께 못 갖는 조합(v10.562 · SUPER)'),
  ('perm-groups', '업무그룹',    'acl', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 1084, '업무를 묶음 · 업무 하나가 여러 업무그룹에(v10.562 · SUPER)'),
  ('perm-tasks',  '업무 목록',   'acl', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 1085, '업무(탭) 이름 · 설명 · 수준 · 켜고 끄기 · 주소 연결(v10.562 · SUPER)'),
  ('perm-log',    '바뀐 기록',   'acl', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 1086, '역할 · 업무 권한 바뀐 기록(v10.563)')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'staff-list', 'VIEW'), ('R_ADMIN', 'staff-list', 'EDIT'), ('R_ADMIN', 'staff-list', 'APPROVE'), ('R_ADMIN', 'staff-list', 'EXPORT'),
  ('R_ADMIN', 'perm-log', 'VIEW'), ('R_ADMIN', 'perm-log', 'EDIT'), ('R_ADMIN', 'perm-log', 'APPROVE'), ('R_ADMIN', 'perm-log', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/staff', 'staff-list', 'VIEW'),
  ('GET', '/admin/staff/employees/{id}/roles', 'staff-list', 'VIEW'),
  ('POST', '/admin/staff/{accountId}/revoke-all', 'staff-list', 'EDIT'),
  ('GET', '/admin/perm/tasks', 'perm-tasks', 'VIEW'),
  ('POST', '/admin/perm/tasks', 'perm-tasks', 'EDIT'),
  ('PUT', '/admin/perm/tasks/{key}', 'perm-tasks', 'EDIT'),
  ('GET', '/admin/perm/task-groups', 'perm-groups', 'VIEW'),
  ('PUT', '/admin/perm/task-groups/{key}', 'perm-groups', 'EDIT'),
  ('GET', '/admin/perm/role-groups/{key}/sets', 'perm-roles', 'VIEW'),
  ('PUT', '/admin/perm/role-groups/{key}/sets', 'perm-roles', 'EDIT'),
  ('GET', '/admin/perm/conflicts', 'perm-roles', 'VIEW'),
  ('PUT', '/admin/perm/conflicts/{code}', 'perm-roles', 'EDIT'),
  ('GET', '/admin/perm/staff', 'perm-staff', 'VIEW'),
  ('GET', '/admin/perm/mode', 'perm-admin', 'VIEW'),
  ('PUT', '/admin/perm/mode', 'perm-admin', 'EDIT'),
  ('GET', '/admin/perm/unmapped-routes', 'perm-admin', 'VIEW')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

/* ── ④ 직원 퇴사 → 운영 역할 남음 알림 STAFF_LEFT_ROLE (v10.563 · docs/705) ──────────────────────────
 *   급여 › 직원 「퇴사」(left_on 넣음) · 이미 퇴사한 직원에 계정을 이음 → 그 계정에 운영 역할이 있으면 운영 알림(WARN · 열린 같은 계정 알림이 있으면 안 넣음)
 *   풀림 = 운영 역할을 모두 거둠(POST /admin/staff/{id}/revoke-all · 역할 주기 화면에서 마지막 역할을 거둠). 알림이 실패해도 직원 고치기는 그대로. */
CREATE OR REPLACE FUNCTION public.fn_staff_left_role() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_roles text[];
BEGIN
  IF NEW.left_on IS NULL OR NEW.account_id IS NULL THEN RETURN NEW; END IF;
  IF OLD.left_on IS NOT NULL AND OLD.account_id IS NOT DISTINCT FROM NEW.account_id THEN RETURN NEW; END IF;
  BEGIN
    SELECT array_agg(r.role ORDER BY r.role) INTO v_roles FROM public.account_roles r
     WHERE r.account_id = NEW.account_id AND r.role IN ('SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT');
    IF v_roles IS NULL THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM public.ops_alerts o WHERE o.alert_code = 'STAFF_LEFT_ROLE' AND o.resolved_at IS NULL AND o.detail->>'accountId' = NEW.account_id::text) THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.ops_alerts (alert_code, severity, title, detail, raised_at)
    VALUES ('STAFF_LEFT_ROLE', 'WARN',
            left('퇴사(예정 포함) 직원 계정에 운영 역할 남음 — ' || NEW.name || ' · ' || array_to_string(v_roles, ', ') || ' · 직원 · 권한 › 운영자 목록에서 거두기', 280),
            jsonb_build_object('employeeId', NEW.id, 'accountId', NEW.account_id::text, 'roles', to_jsonb(v_roles), 'leftOn', NEW.left_on::text),
            clock_timestamp())
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN others THEN
    RAISE WARNING USING MESSAGE = 'staff left alert skipped ' || SQLERRM;
  END;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.fn_staff_left_role() IS 'v10.563 (D291) 직원 퇴사(left_on) · 퇴사 직원에 계정 연결 때 그 계정에 운영 역할이 남으면 STAFF_LEFT_ROLE(WARN · 열린 알림 있으면 안 넣음)';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_staff_left_role' AND tgrelid = 'public.acct_employees'::regclass) THEN
    CREATE TRIGGER trg_staff_left_role AFTER UPDATE OF left_on, account_id ON public.acct_employees FOR EACH ROW EXECUTE FUNCTION public.fn_staff_left_role();
  END IF;
END $$;

/* ── ⑤ 판정 바꾸기 perm.mode (v10.564 · docs/706) ───────────────────────────────────
 *   ROLE(처음 · 지금처럼) · COMPARE(역할로 판정 · 권한그룹과 다르면 「다름」 기록) · GROUPS(운영 역할 API 는 권한그룹이 정함)
 *   GROUPS 는 서버(PUT /admin/perm/mode)가 「연결 안 된 /admin 주소 0 · 최근 24시간 다름 0」을 본 뒤 거래 설정 app.perm_mode_ok = yes 로만 넣음
 *   — 전체 설정 화면 · 직접 DB 로 GROUPS 를 넣으면 이 트리거가 막음(되돌리기 ROLE · COMPARE 는 막지 않음) */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('perm.mode', 'ROLE', 'ADMIN',
   'v10.564 (D291) 운영 화면 권한 판정 — ROLE(처음 · @Roles 먼저 · 권한그룹은 perm.enforce 대로 좁히기만) · COMPARE(역할로 판정 · 권한그룹과 다르면 기록) · GROUPS(운영 역할 API 는 권한그룹이 정함 · 회원 API · SUPER 전용은 역할 그대로 · SUPER 는 늘 통과). GROUPS 는 직원 · 권한 › 업무별 권한 › 판정 방식에서만(연결 안 된 주소 0 · 24시간 다름 0)',
   false, '^(ROLE|COMPARE|GROUPS)$', 'ROLE')
ON CONFLICT (key) DO NOTHING;
CREATE OR REPLACE FUNCTION public.fn_perm_mode_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.key = 'perm.mode' AND NEW.value = 'GROUPS' AND NEW.value IS DISTINCT FROM OLD.value
     AND coalesce(current_setting('app.perm_mode_ok', true), '') <> 'yes' THEN
    RAISE EXCEPTION 'PERM_MODE_GROUPS: GROUPS 는 직원 · 권한 › 업무별 권한 › 판정 방식에서만 바꿉니다(연결 안 된 주소 0 · 24시간 다름 0 확인).';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_perm_mode_guard' AND tgrelid = 'public.site_settings'::regclass) THEN
    CREATE TRIGGER trg_perm_mode_guard BEFORE UPDATE OF value ON public.site_settings FOR EACH ROW EXECUTE FUNCTION public.fn_perm_mode_guard();
  END IF;
END $$;
INSERT INTO public.opx_switch_docs (key, initial_value, cond, doc_ref) VALUES
  ('perm.mode', 'ROLE', 'COMPARE 로 하루 이상 돌려 「다름」 0 · 연결 안 된 /admin 주소 0 을 확인한 뒤 SUPER 가 GROUPS(되돌리기는 언제든)', 'docs/706')
ON CONFLICT (key) DO NOTHING;

/* COMPARE 「다름」 기록 — perm_shadow_log 에 mode COMPARE · diff(ROLE_ONLY = 역할은 열고 권한그룹은 막음 · GROUP_ONLY = 역할은 막고 권한그룹은 엶) */
ALTER TABLE public.perm_shadow_log ADD COLUMN IF NOT EXISTS diff text;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'perm_shadow_log_mode_check' AND conrelid = 'public.perm_shadow_log'::regclass) THEN
    ALTER TABLE public.perm_shadow_log DROP CONSTRAINT perm_shadow_log_mode_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'perm_shadow_log_mode_chk2' AND conrelid = 'public.perm_shadow_log'::regclass) THEN
    ALTER TABLE public.perm_shadow_log ADD CONSTRAINT perm_shadow_log_mode_chk2 CHECK (mode IN ('SHADOW', 'ON', 'COMPARE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'perm_shadow_log_diff_chk' AND conrelid = 'public.perm_shadow_log'::regclass) THEN
    ALTER TABLE public.perm_shadow_log ADD CONSTRAINT perm_shadow_log_diff_chk CHECK (diff IS NULL OR diff IN ('ROLE_ONLY', 'GROUP_ONLY'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_perm_shadow_log_diff ON public.perm_shadow_log (created_at DESC) WHERE diff IS NOT NULL;

/* ── ⑥ 빠진 /admin 주소 · 역할 같은 범위(R_역할) 채우기 (v10.564 · tools/perm_unmapped.py 로 만듦 · c1559 + 이 묶음 src 기준) ──
 *   주소: 운영 역할만 요구 · SUPER 전용 아님 · 표에 없던 것 → 업무(화면 목록 bo 탭 · 같은 앞머리 · 사람이 정한 앞머리 표) · 수준(GET = VIEW · 승인 낱말 = APPROVE · 그 밖 EDIT)
 *   R_역할: 그 역할이 @Roles 로 열던 주소의 업무 · 수준을 같은 이름 권한그룹에(GROUPS 로 바꿔도 같은 범위 · ROLE 모드에서는 좁히기 기록만 줄어듦)
 *   표에 없는 업무 · 권한그룹 줄은 건너뜀(WHERE EXISTS). 운영 서버 실제 주소는 GET /admin/perm/unmapped-routes 로 다시 확인. */
INSERT INTO public.perm_route_map (method, pattern, task_key, level)
SELECT v.m, v.p, v.t, v.l FROM (VALUES
  ('GET', '/admin/audit/search', 'gov-audit', 'VIEW'),
  ('GET', '/admin/audit/logs/{id}', 'gov-audit', 'VIEW'),
  ('POST', '/admin/risk/learn', 'risk', 'EDIT'),
  ('GET', '/admin/risk/exemptions', 'risk', 'VIEW'),
  ('POST', '/admin/risk/exemptions', 'risk', 'EDIT'),
  ('DELETE', '/admin/risk/exemptions/{id}', 'risk', 'EDIT'),
  ('GET', '/admin/health/products/{code}', 'hlt-products', 'VIEW'),
  ('PATCH', '/admin/health/products/{code}', 'hlt-products', 'EDIT'),
  ('POST', '/admin/health/products/{code}/status', 'hlt-products', 'EDIT'),
  ('POST', '/admin/health/products/{code}/options', 'hlt-products', 'EDIT'),
  ('PATCH', '/admin/health/products/{code}/options/{optionId}', 'hlt-products', 'EDIT'),
  ('GET', '/admin/health/products/{code}/history', 'hlt-products', 'VIEW'),
  ('GET', '/admin/health/ingredients', 'hlt-products', 'VIEW'),
  ('POST', '/admin/health/ingredients', 'hlt-products', 'EDIT'),
  ('PATCH', '/admin/health/ingredients/{code}', 'hlt-products', 'EDIT'),
  ('GET', '/admin/health/sale-categories', 'hlt-products', 'VIEW'),
  ('GET', '/admin/leads', 'partners', 'VIEW'),
  ('POST', '/admin/leads/run', 'partners', 'EDIT'),
  ('GET', '/admin/leads/{id}', 'partners', 'VIEW'),
  ('POST', '/admin/leads/{id}/assign', 'partners', 'EDIT'),
  ('POST', '/admin/leads/{id}/reassign', 'partners', 'EDIT'),
  ('POST', '/admin/leads/{id}/close', 'partners', 'APPROVE'),
  ('GET', '/admin/accounts/{id}/settlement-summary', 'members', 'VIEW'),
  ('GET', '/admin/etax/status', 'acct-tax', 'VIEW'),
  ('POST', '/admin/etax/{kind}/{id}/resend', 'acct-tax', 'EDIT'),
  ('POST', '/admin/etax/{kind}/{id}/refresh', 'acct-tax', 'EDIT'),
  ('POST', '/admin/etax/{kind}/{id}/cancel', 'acct-tax', 'EDIT'),
  ('GET', '/admin/partner-axes', 'partner-axes', 'VIEW'),
  ('POST', '/admin/partner-axes/{id}/decide', 'partner-axes', 'APPROVE'),
  ('POST', '/admin/partner-axes/{id}/revoke', 'partner-axes', 'EDIT'),
  ('GET', '/admin/partner-center/cash', 'partners', 'VIEW'),
  ('POST', '/admin/partner-center/cash/auto-run', 'partners', 'EDIT'),
  ('GET', '/admin/partner-center/cash/{partnerId}', 'partners', 'VIEW'),
  ('POST', '/admin/partner-center/cash/{partnerId}/adjust', 'partners', 'EDIT'),
  ('POST', '/admin/partner-center/leads/{leadId}/grade', 'partners', 'EDIT'),
  ('GET', '/admin/partner-center/change-requests', 'partners', 'VIEW'),
  ('POST', '/admin/partner-center/change-requests/{id}/decide', 'partners', 'APPROVE'),
  ('GET', '/admin/partner-center/lead-cash-invoices', 'partners', 'VIEW'),
  ('POST', '/admin/partner-center/lead-cash-invoices/run', 'partners', 'EDIT'),
  ('POST', '/admin/partner-center/lead-cash-invoices/{id}/issue', 'partners', 'EDIT'),
  ('GET', '/admin/partner-center/rules', 'partners', 'VIEW'),
  ('PUT', '/admin/partner-center/rules/bonus-rates/{grade}', 'partners', 'EDIT'),
  ('PUT', '/admin/partner-center/rules/grades/{grade}', 'partners', 'EDIT'),
  ('GET', '/admin/lead-status', 'partners', 'VIEW'),
  ('GET', '/admin/directory', 'directory', 'VIEW'),
  ('GET', '/admin/directory/invoices', 'directory', 'VIEW'),
  ('POST', '/admin/directory/invoices/{id}/issue', 'directory', 'EDIT'),
  ('GET', '/admin/directory/{id}/history', 'directory', 'VIEW'),
  ('POST', '/admin/directory/{id}/activate', 'directory', 'EDIT'),
  ('POST', '/admin/directory/{id}/reject', 'directory', 'EDIT'),
  ('POST', '/admin/directory/{id}/end', 'directory', 'EDIT'),
  ('POST', '/admin/directory/{id}/renew/confirm', 'directory', 'APPROVE'),
  ('POST', '/admin/directory/{id}/renew/reject', 'directory', 'EDIT'),
  ('GET', '/admin/brokers/{id}/evidence', 'quals', 'VIEW'),
  ('GET', '/admin/brokers/{id}', 'quals', 'VIEW'),
  ('POST', '/admin/brokers/{id}/lookup', 'quals', 'EDIT'),
  ('GET', '/admin/qualifications/rules', 'quals', 'VIEW'),
  ('GET', '/admin/qualifications/category-master', 'quals', 'VIEW'),
  ('GET', '/admin/qualifications', 'quals', 'VIEW'),
  ('POST', '/admin/qualifications/{id}/lookup', 'quals', 'EDIT'),
  ('POST', '/admin/qualifications/{id}/decide', 'quals', 'APPROVE'),
  ('GET', '/admin/qualifications/medical', 'quals', 'VIEW'),
  ('GET', '/admin/qualifications/properties', 'quals', 'VIEW'),
  ('POST', '/admin/qualifications/properties/{id}/decide', 'quals', 'APPROVE'),
  ('POST', '/admin/partners/{id}/approve', 'partners', 'APPROVE'),
  ('POST', '/admin/partners/{id}/suspend', 'partners', 'EDIT'),
  ('POST', '/admin/partners/{id}/resume', 'partners', 'EDIT'),
  ('POST', '/admin/partners/{id}/reject', 'partners', 'EDIT'),
  ('GET', '/admin/partners/services/pending', 'partners', 'VIEW'),
  ('GET', '/admin/partners/fees/void-requests', 'partners', 'VIEW'),
  ('POST', '/admin/partners/fees/void-requests/{id}/accept', 'partners', 'EDIT'),
  ('POST', '/admin/partners/fees/void-requests/{id}/dismiss', 'partners', 'EDIT'),
  ('POST', '/admin/partners/services/{id}/review', 'partners', 'EDIT'),
  ('POST', '/admin/partners/fees/{id}/void', 'partners', 'EDIT'),
  ('GET', '/admin/partners/fees', 'partners', 'VIEW'),
  ('GET', '/admin/partners/{id}/docs', 'partners', 'VIEW'),
  ('GET', '/admin/partners/{id}', 'partners', 'VIEW'),
  ('GET', '/admin/review-reasons', 'queue', 'VIEW'),
  ('GET', '/admin/accounts/{id}', 'members', 'VIEW'),
  ('GET', '/admin/accounts/{id}/activity', 'members', 'VIEW'),
  ('GET', '/admin/export-requests', 'gov-audit', 'EXPORT'),
  ('GET', '/admin/segments/preview', 'ai-ops', 'VIEW'),
  ('GET', '/admin/segments/log', 'ai-ops', 'VIEW'),
  ('POST', '/admin/segments/log/{id}/revert', 'ai-ops', 'EDIT'),
  ('POST', '/admin/its/suggestions', 'its-suggest', 'EDIT'),
  ('GET', '/admin/its/suggestions/mine', 'its-suggest', 'VIEW'),
  ('POST', '/admin/its/suggestions/lookup', 'its-suggest', 'EDIT'),
  ('GET', '/admin/its/my-surveys', 'its-survey', 'VIEW'),
  ('GET', '/admin/its/my-surveys/{id}', 'its-survey', 'VIEW'),
  ('POST', '/admin/its/my-surveys/{id}/answer', 'its-survey', 'EDIT'),
  ('POST', '/admin/accounts/{id}/notes', 'members', 'EDIT'),
  ('GET', '/admin/reviews/{id}', 'queue', 'VIEW'),
  ('GET', '/admin/search/parser', 'mainops', 'VIEW'),
  ('GET', '/admin/search/terms', 'mainops', 'VIEW'),
  ('POST', '/admin/search/terms/hide', 'mainops', 'EDIT'),
  ('POST', '/admin/search/synonyms', 'mainops', 'EDIT'),
  ('DELETE', '/admin/search/synonyms/{id}', 'mainops', 'EDIT'),
  ('GET', '/admin/segments/candidates', 'ai-ops', 'VIEW'),
  ('POST', '/admin/segments/learn', 'ai-ops', 'EDIT'),
  ('GET', '/admin/accounts/{id}/login-lock', 'members', 'VIEW'),
  ('DELETE', '/admin/accounts/{id}/login-lock', 'members', 'EDIT'),
  ('POST', '/admin/classify/correct', 'ai-ops', 'EDIT'),
  ('POST', '/admin/classify/learn', 'ai-ops', 'EDIT'),
  ('GET', '/admin/classify/learn/log', 'ai-ops', 'VIEW'),
  ('POST', '/admin/classify/learn/revert', 'ai-ops', 'EDIT'),
  ('GET', '/admin/affiliates/recommend', 'affiliates', 'VIEW'),
  ('GET', '/admin/affiliates/recommend/{id}', 'affiliates', 'VIEW'),
  ('PATCH', '/admin/affiliates/recommend/{id}', 'affiliates', 'EDIT'),
  ('GET', '/admin/affiliates/recommend-reward', 'affiliates', 'VIEW'),
  ('GET', '/admin/affiliates/recommend-reward/check', 'affiliates', 'VIEW'),
  ('GET', '/admin/affiliates/products', 'affiliates', 'VIEW'),
  ('POST', '/admin/affiliates/products', 'affiliates', 'EDIT'),
  ('PATCH', '/admin/affiliates/products/{id}', 'affiliates', 'EDIT'),
  ('GET', '/admin/affiliates/goals', 'affiliates', 'VIEW'),
  ('POST', '/admin/affiliates/goals', 'affiliates', 'EDIT'),
  ('GET', '/admin/affiliates/settlements', 'affiliates', 'VIEW'),
  ('POST', '/admin/affiliates/settlements/run', 'affiliates', 'EDIT'),
  ('POST', '/admin/affiliates/materials', 'affiliates', 'EDIT'),
  ('GET', '/admin/affiliates/guides', 'affiliates', 'VIEW'),
  ('POST', '/admin/affiliates/guides', 'affiliates', 'EDIT'),
  ('PATCH', '/admin/affiliates/guides/{id}', 'affiliates', 'EDIT'),
  ('GET', '/admin/affiliates/materials/queue', 'affiliates', 'VIEW'),
  ('POST', '/admin/affiliates/materials/{id}/review', 'affiliates', 'EDIT'),
  ('POST', '/admin/ad-creatives/{code}/review-reject', 'ads', 'EDIT'),
  ('GET', '/admin/listings/{id}/geo', 'queue', 'VIEW'),
  ('POST', '/admin/listings/{id}/geo/retry', 'queue', 'EDIT'),
  ('GET', '/admin/me/hrx', 'hrx-booking', 'VIEW'),
  ('POST', '/admin/me/hrx/overtime', 'hrx-booking', 'EDIT'),
  ('POST', '/admin/me/hrx/overtime/{id}/cancel', 'hrx-booking', 'EDIT'),
  ('GET', '/admin/me/hr/more', 'my-hr', 'VIEW'),
  ('POST', '/admin/me/hr/training', 'my-hr', 'EDIT'),
  ('GET', '/admin/me/hr/contracts/{id}', 'my-hr', 'VIEW'),
  ('POST', '/admin/me/hr/contracts/{id}/sign', 'my-hr', 'EDIT'),
  ('PUT', '/admin/me/hr/reviews/{cycleId}/goals', 'my-hr', 'EDIT'),
  ('POST', '/admin/me/hr/reviews/{cycleId}/self', 'my-hr', 'EDIT'),
  ('GET', '/admin/me/notify', 'ofc-notify', 'VIEW'),
  ('PUT', '/admin/me/notify', 'ofc-notify', 'EDIT'),
  ('GET', '/admin/me/notify/feed', 'ofc-notify', 'VIEW'),
  ('GET', '/admin/me/hr', 'my-hr', 'VIEW'),
  ('POST', '/admin/me/hr/clock', 'my-hr', 'EDIT'),
  ('POST', '/admin/me/hr/leave', 'my-hr', 'EDIT'),
  ('POST', '/admin/me/hr/leave/{id}/cancel', 'my-hr', 'EDIT'),
  ('GET', '/admin/me/hr/payslips/{lineId}', 'my-hr', 'VIEW'),
  ('GET', '/admin/dash-layout', 'home', 'VIEW'),
  ('PUT', '/admin/dash-layout', 'home', 'EDIT'),
  ('DELETE', '/admin/dash-layout', 'home', 'EDIT'),
  ('GET', '/admin/agent/chats', 'ai-ops', 'VIEW'),
  ('GET', '/admin/agent/chats/stats', 'ai-ops', 'VIEW'),
  ('GET', '/admin/agent/chats/{id}', 'ai-ops', 'VIEW'),
  ('GET', '/admin/agent/rollout', 'ai-ops', 'VIEW'),
  ('GET', '/admin/agent/week', 'ai-ops', 'VIEW'),
  ('GET', '/admin/agent/status', 'ai-ops', 'VIEW'),
  ('GET', '/admin/staff', 'staff-list', 'VIEW')
) AS v(m, p, t, l)
 WHERE EXISTS (SELECT 1 FROM public.perm_tasks k WHERE k.key = v.t)
ON CONFLICT (method, pattern, task_key) DO NOTHING;

INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT v.g, v.t, v.l FROM (VALUES
  ('R_ACCOUNTANT', 'acct-accountant', 'EDIT'),
  ('R_ACCOUNTANT', 'acct-accountant', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-accounts', 'EXPORT'),
  ('R_ACCOUNTANT', 'acct-accounts', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-accrual', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-aging', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-archive', 'EXPORT'),
  ('R_ACCOUNTANT', 'acct-archive', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-assets', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-bank', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-bankfeed', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-budget', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-cardlimit', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-cash', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-cashbook', 'EXPORT'),
  ('R_ACCOUNTANT', 'acct-cashbook', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-cashplan', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-contracts', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-corptax', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-daybook', 'EXPORT'),
  ('R_ACCOUNTANT', 'acct-daybook', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-depts', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-docs', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-dunning', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-exemptinv', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-expense', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-exports', 'EXPORT'),
  ('R_ACCOUNTANT', 'acct-fxreval', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-imports', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-insurance', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-journal', 'EXPORT'),
  ('R_ACCOUNTANT', 'acct-journal', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-ledger', 'EXPORT'),
  ('R_ACCOUNTANT', 'acct-ledger', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-manual', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-month', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-parties', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-partyledger', 'EXPORT'),
  ('R_ACCOUNTANT', 'acct-partyledger', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-payroll', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-payslip', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-pg', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-po', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-purchase', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-receipt', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-reorder', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-report', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-requisitions', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-severance', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-statements', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-stock', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-target', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-tax', 'EXPORT'),
  ('R_ACCOUNTANT', 'acct-tax', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-taxinbox', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-vatform', 'EXPORT'),
  ('R_ACCOUNTANT', 'acct-vatform', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-vehicle', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-wagestmt', 'EXPORT'),
  ('R_ACCOUNTANT', 'acct-wagestmt', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-wh', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-whtreturn', 'EXPORT'),
  ('R_ACCOUNTANT', 'acct-whtreturn', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-yearclose', 'VIEW'),
  ('R_ACCOUNTANT', 'acct-yearend', 'EXPORT'),
  ('R_ACCOUNTANT', 'acct-yearend', 'VIEW'),
  ('R_ACCOUNTANT', 'approval-lines', 'VIEW'),
  ('R_ACCOUNTANT', 'approvals', 'VIEW'),
  ('R_ACCOUNTANT', 'gov-audit', 'EXPORT'),
  ('R_ACCOUNTANT', 'hlt-settle', 'EXPORT'),
  ('R_ACCOUNTANT', 'hr-card', 'VIEW'),
  ('R_ACCOUNTANT', 'my-password', 'EDIT'),
  ('R_ACCOUNTANT', 'payouts', 'EXPORT'),
  ('R_ACCOUNTANT', 'perm-admin', 'VIEW'),
  ('R_ADMIN', 'acct-accounts', 'EDIT'),
  ('R_ADMIN', 'acct-accounts', 'VIEW'),
  ('R_ADMIN', 'acct-docs', 'EDIT'),
  ('R_ADMIN', 'acct-docs', 'VIEW'),
  ('R_ADMIN', 'acct-expense', 'EDIT'),
  ('R_ADMIN', 'acct-expense', 'VIEW'),
  ('R_ADMIN', 'acct-journal', 'VIEW'),
  ('R_ADMIN', 'acct-reorder', 'APPROVE'),
  ('R_ADMIN', 'acct-reorder', 'EDIT'),
  ('R_ADMIN', 'acct-reorder', 'VIEW'),
  ('R_ADMIN', 'acct-requisitions', 'EDIT'),
  ('R_ADMIN', 'acct-requisitions', 'VIEW'),
  ('R_ADMIN', 'acct-tax', 'APPROVE'),
  ('R_ADMIN', 'acct-tax', 'EDIT'),
  ('R_ADMIN', 'acct-tax', 'VIEW'),
  ('R_ADMIN', 'acct-vehicle', 'EDIT'),
  ('R_ADMIN', 'acct-vehicle', 'VIEW'),
  ('R_ADMIN', 'acct-wh', 'VIEW'),
  ('R_ADMIN', 'ad-billing', 'EDIT'),
  ('R_ADMIN', 'ad-billing', 'VIEW'),
  ('R_ADMIN', 'ads', 'EDIT'),
  ('R_ADMIN', 'ads', 'VIEW'),
  ('R_ADMIN', 'adx', 'APPROVE'),
  ('R_ADMIN', 'adx', 'EDIT'),
  ('R_ADMIN', 'adx', 'VIEW'),
  ('R_ADMIN', 'adx-payout', 'APPROVE'),
  ('R_ADMIN', 'adx-payout', 'EDIT'),
  ('R_ADMIN', 'adx-payout', 'VIEW'),
  ('R_ADMIN', 'affiliates', 'APPROVE'),
  ('R_ADMIN', 'affiliates', 'EDIT'),
  ('R_ADMIN', 'affiliates', 'VIEW'),
  ('R_ADMIN', 'ai-ops', 'EDIT'),
  ('R_ADMIN', 'ai-ops', 'VIEW'),
  ('R_ADMIN', 'approval-lines', 'VIEW'),
  ('R_ADMIN', 'approvals', 'EDIT'),
  ('R_ADMIN', 'approvals', 'VIEW'),
  ('R_ADMIN', 'audit', 'EDIT'),
  ('R_ADMIN', 'audit', 'VIEW'),
  ('R_ADMIN', 'badges', 'EDIT'),
  ('R_ADMIN', 'badges', 'VIEW'),
  ('R_ADMIN', 'bi-export', 'APPROVE'),
  ('R_ADMIN', 'bi-export', 'EXPORT'),
  ('R_ADMIN', 'bi-export', 'VIEW'),
  ('R_ADMIN', 'billing', 'EDIT'),
  ('R_ADMIN', 'billing', 'VIEW'),
  ('R_ADMIN', 'category', 'EDIT'),
  ('R_ADMIN', 'category', 'VIEW'),
  ('R_ADMIN', 'checklist', 'VIEW'),
  ('R_ADMIN', 'collect', 'APPROVE'),
  ('R_ADMIN', 'collect', 'EDIT'),
  ('R_ADMIN', 'collect', 'VIEW'),
  ('R_ADMIN', 'community', 'APPROVE'),
  ('R_ADMIN', 'community', 'EDIT'),
  ('R_ADMIN', 'community', 'VIEW'),
  ('R_ADMIN', 'corp-docs', 'EDIT'),
  ('R_ADMIN', 'corp-docs', 'VIEW'),
  ('R_ADMIN', 'csx-aidraft', 'EDIT'),
  ('R_ADMIN', 'csx-aidraft', 'VIEW'),
  ('R_ADMIN', 'csx-churn', 'EDIT'),
  ('R_ADMIN', 'csx-churn', 'VIEW'),
  ('R_ADMIN', 'csx-mailtpl', 'VIEW'),
  ('R_ADMIN', 'csx-merge', 'EDIT'),
  ('R_ADMIN', 'csx-merge', 'VIEW'),
  ('R_ADMIN', 'deals', 'EDIT'),
  ('R_ADMIN', 'deals', 'VIEW'),
  ('R_ADMIN', 'directory', 'APPROVE'),
  ('R_ADMIN', 'directory', 'EDIT'),
  ('R_ADMIN', 'directory', 'VIEW'),
  ('R_ADMIN', 'disputes', 'EDIT'),
  ('R_ADMIN', 'disputes', 'VIEW'),
  ('R_ADMIN', 'events', 'EDIT'),
  ('R_ADMIN', 'events', 'VIEW'),
  ('R_ADMIN', 'faq', 'EDIT'),
  ('R_ADMIN', 'faq', 'VIEW'),
  ('R_ADMIN', 'gov-audit', 'EDIT'),
  ('R_ADMIN', 'gov-audit', 'VIEW'),
  ('R_ADMIN', 'guide-flows', 'VIEW'),
  ('R_ADMIN', 'gwan-ux', 'EDIT'),
  ('R_ADMIN', 'gwan-ux', 'VIEW'),
  ('R_ADMIN', 'hlt-cashrcpt', 'APPROVE'),
  ('R_ADMIN', 'hlt-cashrcpt', 'EDIT'),
  ('R_ADMIN', 'hlt-cashrcpt', 'VIEW'),
  ('R_ADMIN', 'hlt-coupons', 'EDIT'),
  ('R_ADMIN', 'hlt-coupons', 'VIEW'),
  ('R_ADMIN', 'hlt-giftcards', 'APPROVE'),
  ('R_ADMIN', 'hlt-giftcards', 'EDIT'),
  ('R_ADMIN', 'hlt-giftcards', 'VIEW'),
  ('R_ADMIN', 'hlt-open', 'EDIT'),
  ('R_ADMIN', 'hlt-open', 'VIEW'),
  ('R_ADMIN', 'hlt-orders', 'EDIT'),
  ('R_ADMIN', 'hlt-orders', 'VIEW'),
  ('R_ADMIN', 'hlt-points', 'EDIT'),
  ('R_ADMIN', 'hlt-points', 'VIEW'),
  ('R_ADMIN', 'hlt-products', 'EDIT'),
  ('R_ADMIN', 'hlt-products', 'VIEW'),
  ('R_ADMIN', 'hlt-restock', 'APPROVE'),
  ('R_ADMIN', 'hlt-restock', 'VIEW'),
  ('R_ADMIN', 'hlt-reviews', 'APPROVE'),
  ('R_ADMIN', 'hlt-reviews', 'EDIT'),
  ('R_ADMIN', 'hlt-reviews', 'VIEW'),
  ('R_ADMIN', 'hlt-sellers', 'APPROVE'),
  ('R_ADMIN', 'hlt-sellers', 'EDIT'),
  ('R_ADMIN', 'hlt-sellers', 'VIEW'),
  ('R_ADMIN', 'hlt-settle', 'APPROVE'),
  ('R_ADMIN', 'hlt-settle', 'EDIT'),
  ('R_ADMIN', 'hlt-settle', 'VIEW'),
  ('R_ADMIN', 'hlt-subscribe', 'APPROVE'),
  ('R_ADMIN', 'hlt-subscribe', 'EDIT'),
  ('R_ADMIN', 'hlt-subscribe', 'VIEW'),
  ('R_ADMIN', 'hlt-tiers', 'APPROVE'),
  ('R_ADMIN', 'hlt-tiers', 'EDIT'),
  ('R_ADMIN', 'hlt-tiers', 'VIEW'),
  ('R_ADMIN', 'home', 'EDIT'),
  ('R_ADMIN', 'home', 'VIEW'),
  ('R_ADMIN', 'hr-attend', 'APPROVE'),
  ('R_ADMIN', 'hr-attend', 'EDIT'),
  ('R_ADMIN', 'hr-attend', 'VIEW'),
  ('R_ADMIN', 'hr-contract', 'APPROVE'),
  ('R_ADMIN', 'hr-contract', 'EDIT'),
  ('R_ADMIN', 'hr-contract', 'VIEW'),
  ('R_ADMIN', 'hr-leave', 'APPROVE'),
  ('R_ADMIN', 'hr-leave', 'VIEW'),
  ('R_ADMIN', 'hr-recruit', 'APPROVE'),
  ('R_ADMIN', 'hr-recruit', 'EDIT'),
  ('R_ADMIN', 'hr-recruit', 'VIEW'),
  ('R_ADMIN', 'hr-review', 'APPROVE'),
  ('R_ADMIN', 'hr-review', 'EDIT'),
  ('R_ADMIN', 'hr-review', 'VIEW'),
  ('R_ADMIN', 'hr-training', 'APPROVE'),
  ('R_ADMIN', 'hr-training', 'EDIT'),
  ('R_ADMIN', 'hr-training', 'VIEW'),
  ('R_ADMIN', 'hrx-booking', 'APPROVE'),
  ('R_ADMIN', 'hrx-booking', 'EDIT'),
  ('R_ADMIN', 'hrx-booking', 'VIEW'),
  ('R_ADMIN', 'hrx-overtime', 'APPROVE'),
  ('R_ADMIN', 'hrx-overtime', 'EDIT'),
  ('R_ADMIN', 'hrx-overtime', 'VIEW'),
  ('R_ADMIN', 'hrx-shifts', 'EDIT'),
  ('R_ADMIN', 'hrx-shifts', 'VIEW'),
  ('R_ADMIN', 'hrx-stocktake', 'APPROVE'),
  ('R_ADMIN', 'hrx-stocktake', 'EDIT'),
  ('R_ADMIN', 'hrx-stocktake', 'VIEW'),
  ('R_ADMIN', 'i18n', 'APPROVE'),
  ('R_ADMIN', 'i18n', 'EDIT'),
  ('R_ADMIN', 'i18n', 'VIEW'),
  ('R_ADMIN', 'i18n-review', 'VIEW'),
  ('R_ADMIN', 'inquiries', 'EDIT'),
  ('R_ADMIN', 'inquiries', 'VIEW'),
  ('R_ADMIN', 'integrations', 'VIEW'),
  ('R_ADMIN', 'invariants', 'VIEW'),
  ('R_ADMIN', 'its-assets', 'EDIT'),
  ('R_ADMIN', 'its-assets', 'VIEW'),
  ('R_ADMIN', 'its-suggest', 'APPROVE'),
  ('R_ADMIN', 'its-suggest', 'EDIT'),
  ('R_ADMIN', 'its-suggest', 'VIEW'),
  ('R_ADMIN', 'its-survey', 'APPROVE'),
  ('R_ADMIN', 'its-survey', 'EDIT'),
  ('R_ADMIN', 'its-survey', 'EXPORT'),
  ('R_ADMIN', 'its-survey', 'VIEW'),
  ('R_ADMIN', 'lgl-cases', 'APPROVE'),
  ('R_ADMIN', 'lgl-cases', 'EDIT'),
  ('R_ADMIN', 'lgl-cases', 'VIEW'),
  ('R_ADMIN', 'lgl-insurance', 'APPROVE'),
  ('R_ADMIN', 'lgl-insurance', 'EDIT'),
  ('R_ADMIN', 'lgl-insurance', 'VIEW'),
  ('R_ADMIN', 'lgl-licenses', 'APPROVE'),
  ('R_ADMIN', 'lgl-licenses', 'EDIT'),
  ('R_ADMIN', 'lgl-licenses', 'VIEW'),
  ('R_ADMIN', 'lgl-reviews', 'EDIT'),
  ('R_ADMIN', 'lgl-reviews', 'VIEW'),
  ('R_ADMIN', 'lpx-away', 'VIEW'),
  ('R_ADMIN', 'lpx-offers', 'VIEW'),
  ('R_ADMIN', 'lpx-photo', 'VIEW'),
  ('R_ADMIN', 'lpx-stats', 'VIEW'),
  ('R_ADMIN', 'lsx-bump', 'VIEW'),
  ('R_ADMIN', 'lsx-expiry', 'APPROVE'),
  ('R_ADMIN', 'lsx-expiry', 'EDIT'),
  ('R_ADMIN', 'lsx-expiry', 'VIEW'),
  ('R_ADMIN', 'lsx-saved', 'VIEW'),
  ('R_ADMIN', 'lsx-summary', 'APPROVE'),
  ('R_ADMIN', 'lsx-summary', 'EDIT'),
  ('R_ADMIN', 'lsx-summary', 'VIEW'),
  ('R_ADMIN', 'lsy-dups', 'APPROVE'),
  ('R_ADMIN', 'lsy-dups', 'EDIT'),
  ('R_ADMIN', 'lsy-dups', 'VIEW'),
  ('R_ADMIN', 'lsy-photos', 'EDIT'),
  ('R_ADMIN', 'lsy-photos', 'VIEW'),
  ('R_ADMIN', 'lsy-triage', 'APPROVE'),
  ('R_ADMIN', 'lsy-triage', 'VIEW'),
  ('R_ADMIN', 'lsy-videos', 'APPROVE'),
  ('R_ADMIN', 'lsy-videos', 'VIEW'),
  ('R_ADMIN', 'mainops', 'EDIT'),
  ('R_ADMIN', 'mainops', 'VIEW'),
  ('R_ADMIN', 'manual', 'VIEW'),
  ('R_ADMIN', 'mbx-dm', 'APPROVE'),
  ('R_ADMIN', 'mbx-dm', 'EDIT'),
  ('R_ADMIN', 'mbx-dm', 'VIEW'),
  ('R_ADMIN', 'mbx-ops', 'VIEW'),
  ('R_ADMIN', 'members', 'EDIT'),
  ('R_ADMIN', 'members', 'VIEW'),
  ('R_ADMIN', 'mkt-campaign', 'EDIT'),
  ('R_ADMIN', 'mkt-campaign', 'VIEW'),
  ('R_ADMIN', 'mkx-groupbuy', 'APPROVE'),
  ('R_ADMIN', 'mkx-groupbuy', 'EDIT'),
  ('R_ADMIN', 'mkx-groupbuy', 'VIEW'),
  ('R_ADMIN', 'mkx-push', 'APPROVE'),
  ('R_ADMIN', 'mkx-push', 'VIEW'),
  ('R_ADMIN', 'mkx-rebuy', 'APPROVE'),
  ('R_ADMIN', 'mkx-rebuy', 'EDIT'),
  ('R_ADMIN', 'mkx-rebuy', 'VIEW'),
  ('R_ADMIN', 'mkx-sms', 'EDIT'),
  ('R_ADMIN', 'mkx-sms', 'VIEW'),
  ('R_ADMIN', 'mob-scan', 'EDIT'),
  ('R_ADMIN', 'mob-scan', 'VIEW'),
  ('R_ADMIN', 'my-hr', 'EDIT'),
  ('R_ADMIN', 'my-hr', 'VIEW'),
  ('R_ADMIN', 'my-mfa', 'EDIT'),
  ('R_ADMIN', 'my-password', 'EDIT'),
  ('R_ADMIN', 'ofc-calendar', 'EDIT'),
  ('R_ADMIN', 'ofc-calendar', 'VIEW'),
  ('R_ADMIN', 'ofc-notify', 'EDIT'),
  ('R_ADMIN', 'ofc-notify', 'VIEW'),
  ('R_ADMIN', 'ofc-tasks', 'EDIT'),
  ('R_ADMIN', 'ofc-tasks', 'VIEW'),
  ('R_ADMIN', 'ofc-trips', 'APPROVE'),
  ('R_ADMIN', 'ofc-trips', 'EDIT'),
  ('R_ADMIN', 'ofc-trips', 'VIEW'),
  ('R_ADMIN', 'ops-alerts', 'EDIT'),
  ('R_ADMIN', 'ops-alerts', 'VIEW'),
  ('R_ADMIN', 'ops-board', 'EDIT'),
  ('R_ADMIN', 'ops-board', 'VIEW'),
  ('R_ADMIN', 'ops-guide', 'VIEW'),
  ('R_ADMIN', 'opx-bulk', 'EDIT'),
  ('R_ADMIN', 'opx-bulk', 'VIEW'),
  ('R_ADMIN', 'opx-risk', 'EDIT'),
  ('R_ADMIN', 'opx-risk', 'VIEW'),
  ('R_ADMIN', 'opx-switches', 'VIEW'),
  ('R_ADMIN', 'opz-incident', 'APPROVE'),
  ('R_ADMIN', 'opz-incident', 'EDIT'),
  ('R_ADMIN', 'opz-incident', 'VIEW'),
  ('R_ADMIN', 'opz-newsletter', 'EDIT'),
  ('R_ADMIN', 'opz-newsletter', 'VIEW'),
  ('R_ADMIN', 'ownership', 'APPROVE'),
  ('R_ADMIN', 'ownership', 'VIEW'),
  ('R_ADMIN', 'partner-axes', 'APPROVE'),
  ('R_ADMIN', 'partner-axes', 'EDIT'),
  ('R_ADMIN', 'partner-axes', 'VIEW'),
  ('R_ADMIN', 'partners', 'APPROVE'),
  ('R_ADMIN', 'partners', 'EDIT'),
  ('R_ADMIN', 'partners', 'VIEW'),
  ('R_ADMIN', 'payouts', 'APPROVE'),
  ('R_ADMIN', 'payouts', 'EDIT'),
  ('R_ADMIN', 'payouts', 'VIEW'),
  ('R_ADMIN', 'perm-admin', 'VIEW'),
  ('R_ADMIN', 'plz-rank', 'APPROVE'),
  ('R_ADMIN', 'plz-rank', 'EDIT'),
  ('R_ADMIN', 'plz-rank', 'VIEW'),
  ('R_ADMIN', 'policy', 'EDIT'),
  ('R_ADMIN', 'policy', 'VIEW'),
  ('R_ADMIN', 'polls', 'EDIT'),
  ('R_ADMIN', 'polls', 'VIEW'),
  ('R_ADMIN', 'privacy-requests', 'APPROVE'),
  ('R_ADMIN', 'privacy-requests', 'VIEW'),
  ('R_ADMIN', 'prx-adab', 'EDIT'),
  ('R_ADMIN', 'prx-adab', 'VIEW'),
  ('R_ADMIN', 'prx-adreport', 'EDIT'),
  ('R_ADMIN', 'prx-adreport', 'VIEW'),
  ('R_ADMIN', 'prx-popup', 'EDIT'),
  ('R_ADMIN', 'prx-popup', 'VIEW'),
  ('R_ADMIN', 'prx-refevent', 'EDIT'),
  ('R_ADMIN', 'prx-refevent', 'VIEW'),
  ('R_ADMIN', 'ptn-bulk', 'APPROVE'),
  ('R_ADMIN', 'ptn-bulk', 'EDIT'),
  ('R_ADMIN', 'ptn-bulk', 'VIEW'),
  ('R_ADMIN', 'ptn-openapi', 'EDIT'),
  ('R_ADMIN', 'ptn-openapi', 'VIEW'),
  ('R_ADMIN', 'purge-log', 'VIEW'),
  ('R_ADMIN', 'qlt-claims', 'APPROVE'),
  ('R_ADMIN', 'qlt-claims', 'EDIT'),
  ('R_ADMIN', 'qlt-claims', 'VIEW'),
  ('R_ADMIN', 'qlt-lots', 'EDIT'),
  ('R_ADMIN', 'qlt-lots', 'VIEW'),
  ('R_ADMIN', 'qlt-supeval', 'APPROVE'),
  ('R_ADMIN', 'qlt-supeval', 'EDIT'),
  ('R_ADMIN', 'qlt-supeval', 'VIEW'),
  ('R_ADMIN', 'quals', 'APPROVE'),
  ('R_ADMIN', 'quals', 'EDIT'),
  ('R_ADMIN', 'quals', 'VIEW'),
  ('R_ADMIN', 'queue', 'EDIT'),
  ('R_ADMIN', 'queue', 'VIEW'),
  ('R_ADMIN', 'report-queue', 'EDIT'),
  ('R_ADMIN', 'report-queue', 'VIEW'),
  ('R_ADMIN', 'risk', 'APPROVE'),
  ('R_ADMIN', 'risk', 'EDIT'),
  ('R_ADMIN', 'risk', 'VIEW'),
  ('R_ADMIN', 'roles', 'VIEW'),
  ('R_ADMIN', 'rpt-day', 'EDIT'),
  ('R_ADMIN', 'rpt-day', 'EXPORT'),
  ('R_ADMIN', 'rpt-day', 'VIEW'),
  ('R_ADMIN', 'rpt-month', 'EDIT'),
  ('R_ADMIN', 'rpt-month', 'EXPORT'),
  ('R_ADMIN', 'rpt-month', 'VIEW'),
  ('R_ADMIN', 'rpt-trend', 'VIEW'),
  ('R_ADMIN', 'rpt-week', 'EDIT'),
  ('R_ADMIN', 'rpt-week', 'EXPORT'),
  ('R_ADMIN', 'rpt-week', 'VIEW'),
  ('R_ADMIN', 'rpt-worklog', 'EDIT'),
  ('R_ADMIN', 'rpt-worklog', 'VIEW'),
  ('R_ADMIN', 'rules', 'EDIT'),
  ('R_ADMIN', 'rules', 'VIEW'),
  ('R_ADMIN', 'sal-crm', 'EDIT'),
  ('R_ADMIN', 'sal-crm', 'VIEW'),
  ('R_ADMIN', 'sec-geo', 'VIEW'),
  ('R_ADMIN', 'server-errors', 'VIEW'),
  ('R_ADMIN', 'settings', 'EDIT'),
  ('R_ADMIN', 'settings', 'VIEW'),
  ('R_ADMIN', 'settlement', 'EDIT'),
  ('R_ADMIN', 'settlement', 'VIEW'),
  ('R_ADMIN', 'sfx-device', 'VIEW'),
  ('R_ADMIN', 'sfx-retention', 'EDIT'),
  ('R_ADMIN', 'sfx-retention', 'VIEW'),
  ('R_ADMIN', 'sfx-tm', 'EDIT'),
  ('R_ADMIN', 'sfx-tm', 'VIEW'),
  ('R_ADMIN', 'site-usage', 'VIEW'),
  ('R_ADMIN', 'siteinfo', 'EDIT'),
  ('R_ADMIN', 'siteinfo', 'VIEW'),
  ('R_ADMIN', 'slx-ptn-perf', 'VIEW'),
  ('R_ADMIN', 'slx-review-points', 'EDIT'),
  ('R_ADMIN', 'slx-review-points', 'VIEW'),
  ('R_ADMIN', 'slx-statements', 'APPROVE'),
  ('R_ADMIN', 'slx-statements', 'VIEW'),
  ('R_ADMIN', 'smx-bundles', 'APPROVE'),
  ('R_ADMIN', 'smx-bundles', 'EDIT'),
  ('R_ADMIN', 'smx-bundles', 'VIEW'),
  ('R_ADMIN', 'smx-remote', 'EDIT'),
  ('R_ADMIN', 'smx-remote', 'VIEW'),
  ('R_ADMIN', 'smx-replies', 'APPROVE'),
  ('R_ADMIN', 'smx-replies', 'EDIT'),
  ('R_ADMIN', 'smx-replies', 'VIEW'),
  ('R_ADMIN', 'soc-login', 'VIEW'),
  ('R_ADMIN', 'staff-access', 'EDIT'),
  ('R_ADMIN', 'staff-access', 'VIEW'),
  ('R_ADMIN', 'staff-list', 'VIEW'),
  ('R_ADMIN', 'terms', 'EDIT'),
  ('R_ADMIN', 'terms', 'VIEW'),
  ('R_ADMIN', 'upt-status', 'EDIT'),
  ('R_ADMIN', 'upt-status', 'VIEW'),
  ('R_ADMIN', 'users', 'EDIT'),
  ('R_ADMIN', 'users', 'VIEW'),
  ('R_ADMIN', 'vsx-map', 'VIEW'),
  ('R_ADMIN', 'vsx-papi-bill', 'VIEW'),
  ('R_ADMIN', 'vsx-ptn-export', 'VIEW'),
  ('R_ADMIN', 'vsx-visits', 'VIEW'),
  ('R_PARTNER_AFF', 'acct-expense', 'EDIT'),
  ('R_PARTNER_AFF', 'acct-expense', 'VIEW'),
  ('R_PARTNER_AFF', 'acct-requisitions', 'EDIT'),
  ('R_PARTNER_AFF', 'acct-requisitions', 'VIEW'),
  ('R_PARTNER_AFF', 'affiliates', 'APPROVE'),
  ('R_PARTNER_AFF', 'affiliates', 'EDIT'),
  ('R_PARTNER_AFF', 'affiliates', 'VIEW'),
  ('R_PARTNER_AFF', 'approval-lines', 'VIEW'),
  ('R_PARTNER_AFF', 'approvals', 'EDIT'),
  ('R_PARTNER_AFF', 'approvals', 'VIEW'),
  ('R_PARTNER_AFF', 'home', 'VIEW'),
  ('R_PARTNER_AFF', 'hrx-booking', 'EDIT'),
  ('R_PARTNER_AFF', 'hrx-booking', 'VIEW'),
  ('R_PARTNER_AFF', 'its-suggest', 'EDIT'),
  ('R_PARTNER_AFF', 'its-suggest', 'VIEW'),
  ('R_PARTNER_AFF', 'its-survey', 'EDIT'),
  ('R_PARTNER_AFF', 'its-survey', 'VIEW'),
  ('R_PARTNER_AFF', 'my-hr', 'EDIT'),
  ('R_PARTNER_AFF', 'my-hr', 'VIEW'),
  ('R_PARTNER_AFF', 'my-password', 'EDIT'),
  ('R_PARTNER_AFF', 'ofc-calendar', 'EDIT'),
  ('R_PARTNER_AFF', 'ofc-calendar', 'VIEW'),
  ('R_PARTNER_AFF', 'ofc-notify', 'EDIT'),
  ('R_PARTNER_AFF', 'ofc-notify', 'VIEW'),
  ('R_PARTNER_AFF', 'ofc-tasks', 'EDIT'),
  ('R_PARTNER_AFF', 'ofc-tasks', 'VIEW'),
  ('R_PARTNER_AFF', 'ofc-trips', 'APPROVE'),
  ('R_PARTNER_AFF', 'ofc-trips', 'EDIT'),
  ('R_PARTNER_AFF', 'ofc-trips', 'VIEW'),
  ('R_PARTNER_AFF', 'ops-board', 'EDIT'),
  ('R_PARTNER_AFF', 'ops-board', 'VIEW'),
  ('R_PARTNER_AFF', 'ops-guide', 'VIEW'),
  ('R_PARTNER_AFF', 'perm-admin', 'VIEW'),
  ('R_PARTNER_AFF', 'rpt-worklog', 'EDIT'),
  ('R_PARTNER_AFF', 'rpt-worklog', 'VIEW'),
  ('R_PARTNER_MAL', 'acct-expense', 'EDIT'),
  ('R_PARTNER_MAL', 'acct-expense', 'VIEW'),
  ('R_PARTNER_MAL', 'acct-requisitions', 'EDIT'),
  ('R_PARTNER_MAL', 'acct-requisitions', 'VIEW'),
  ('R_PARTNER_MAL', 'approval-lines', 'VIEW'),
  ('R_PARTNER_MAL', 'approvals', 'EDIT'),
  ('R_PARTNER_MAL', 'approvals', 'VIEW'),
  ('R_PARTNER_MAL', 'directory', 'APPROVE'),
  ('R_PARTNER_MAL', 'directory', 'EDIT'),
  ('R_PARTNER_MAL', 'directory', 'VIEW'),
  ('R_PARTNER_MAL', 'home', 'VIEW'),
  ('R_PARTNER_MAL', 'hrx-booking', 'EDIT'),
  ('R_PARTNER_MAL', 'hrx-booking', 'VIEW'),
  ('R_PARTNER_MAL', 'its-suggest', 'EDIT'),
  ('R_PARTNER_MAL', 'its-suggest', 'VIEW'),
  ('R_PARTNER_MAL', 'its-survey', 'EDIT'),
  ('R_PARTNER_MAL', 'its-survey', 'VIEW'),
  ('R_PARTNER_MAL', 'my-hr', 'EDIT'),
  ('R_PARTNER_MAL', 'my-hr', 'VIEW'),
  ('R_PARTNER_MAL', 'my-password', 'EDIT'),
  ('R_PARTNER_MAL', 'ofc-calendar', 'EDIT'),
  ('R_PARTNER_MAL', 'ofc-calendar', 'VIEW'),
  ('R_PARTNER_MAL', 'ofc-notify', 'EDIT'),
  ('R_PARTNER_MAL', 'ofc-notify', 'VIEW'),
  ('R_PARTNER_MAL', 'ofc-tasks', 'EDIT'),
  ('R_PARTNER_MAL', 'ofc-tasks', 'VIEW'),
  ('R_PARTNER_MAL', 'ofc-trips', 'APPROVE'),
  ('R_PARTNER_MAL', 'ofc-trips', 'EDIT'),
  ('R_PARTNER_MAL', 'ofc-trips', 'VIEW'),
  ('R_PARTNER_MAL', 'ops-board', 'EDIT'),
  ('R_PARTNER_MAL', 'ops-board', 'VIEW'),
  ('R_PARTNER_MAL', 'ops-guide', 'VIEW'),
  ('R_PARTNER_MAL', 'partner-axes', 'APPROVE'),
  ('R_PARTNER_MAL', 'partner-axes', 'EDIT'),
  ('R_PARTNER_MAL', 'partner-axes', 'VIEW'),
  ('R_PARTNER_MAL', 'partners', 'APPROVE'),
  ('R_PARTNER_MAL', 'partners', 'EDIT'),
  ('R_PARTNER_MAL', 'partners', 'VIEW'),
  ('R_PARTNER_MAL', 'perm-admin', 'VIEW'),
  ('R_PARTNER_MAL', 'ptn-bulk', 'APPROVE'),
  ('R_PARTNER_MAL', 'ptn-bulk', 'EDIT'),
  ('R_PARTNER_MAL', 'ptn-bulk', 'VIEW'),
  ('R_PARTNER_MAL', 'ptn-openapi', 'EDIT'),
  ('R_PARTNER_MAL', 'ptn-openapi', 'VIEW'),
  ('R_PARTNER_MAL', 'quals', 'APPROVE'),
  ('R_PARTNER_MAL', 'quals', 'EDIT'),
  ('R_PARTNER_MAL', 'quals', 'VIEW'),
  ('R_PARTNER_MAL', 'rpt-worklog', 'EDIT'),
  ('R_PARTNER_MAL', 'rpt-worklog', 'VIEW'),
  ('R_PARTNER_MAL', 'slx-ptn-perf', 'VIEW'),
  ('R_PARTNER_MAL', 'vsx-papi-bill', 'VIEW'),
  ('R_PARTNER_MAL', 'vsx-ptn-export', 'VIEW'),
  ('R_PAYOUT', 'acct-accountant', 'VIEW'),
  ('R_PAYOUT', 'acct-accounts', 'EDIT'),
  ('R_PAYOUT', 'acct-accounts', 'EXPORT'),
  ('R_PAYOUT', 'acct-accounts', 'VIEW'),
  ('R_PAYOUT', 'acct-accrual', 'VIEW'),
  ('R_PAYOUT', 'acct-aging', 'VIEW'),
  ('R_PAYOUT', 'acct-archive', 'EXPORT'),
  ('R_PAYOUT', 'acct-archive', 'VIEW'),
  ('R_PAYOUT', 'acct-assets', 'VIEW'),
  ('R_PAYOUT', 'acct-bank', 'EDIT'),
  ('R_PAYOUT', 'acct-bank', 'VIEW'),
  ('R_PAYOUT', 'acct-bankfeed', 'APPROVE'),
  ('R_PAYOUT', 'acct-bankfeed', 'VIEW'),
  ('R_PAYOUT', 'acct-budget', 'VIEW'),
  ('R_PAYOUT', 'acct-cardlimit', 'VIEW'),
  ('R_PAYOUT', 'acct-cash', 'EDIT'),
  ('R_PAYOUT', 'acct-cash', 'VIEW'),
  ('R_PAYOUT', 'acct-cashbook', 'EXPORT'),
  ('R_PAYOUT', 'acct-cashbook', 'VIEW'),
  ('R_PAYOUT', 'acct-cashplan', 'VIEW'),
  ('R_PAYOUT', 'acct-contracts', 'EDIT'),
  ('R_PAYOUT', 'acct-contracts', 'VIEW'),
  ('R_PAYOUT', 'acct-corptax', 'VIEW'),
  ('R_PAYOUT', 'acct-daybook', 'EXPORT'),
  ('R_PAYOUT', 'acct-daybook', 'VIEW'),
  ('R_PAYOUT', 'acct-depts', 'EDIT'),
  ('R_PAYOUT', 'acct-depts', 'VIEW'),
  ('R_PAYOUT', 'acct-docs', 'EDIT'),
  ('R_PAYOUT', 'acct-docs', 'VIEW'),
  ('R_PAYOUT', 'acct-dunning', 'APPROVE'),
  ('R_PAYOUT', 'acct-dunning', 'EDIT'),
  ('R_PAYOUT', 'acct-dunning', 'VIEW'),
  ('R_PAYOUT', 'acct-exemptinv', 'APPROVE'),
  ('R_PAYOUT', 'acct-exemptinv', 'EDIT'),
  ('R_PAYOUT', 'acct-exemptinv', 'VIEW'),
  ('R_PAYOUT', 'acct-expense', 'APPROVE'),
  ('R_PAYOUT', 'acct-expense', 'EDIT'),
  ('R_PAYOUT', 'acct-expense', 'VIEW'),
  ('R_PAYOUT', 'acct-exports', 'EXPORT'),
  ('R_PAYOUT', 'acct-fxreval', 'VIEW'),
  ('R_PAYOUT', 'acct-imports', 'EDIT'),
  ('R_PAYOUT', 'acct-imports', 'VIEW'),
  ('R_PAYOUT', 'acct-insurance', 'VIEW'),
  ('R_PAYOUT', 'acct-journal', 'EXPORT'),
  ('R_PAYOUT', 'acct-journal', 'VIEW'),
  ('R_PAYOUT', 'acct-ledger', 'EXPORT'),
  ('R_PAYOUT', 'acct-ledger', 'VIEW'),
  ('R_PAYOUT', 'acct-manual', 'EDIT'),
  ('R_PAYOUT', 'acct-manual', 'VIEW'),
  ('R_PAYOUT', 'acct-month', 'VIEW'),
  ('R_PAYOUT', 'acct-parties', 'EDIT'),
  ('R_PAYOUT', 'acct-parties', 'VIEW'),
  ('R_PAYOUT', 'acct-partyledger', 'EXPORT'),
  ('R_PAYOUT', 'acct-partyledger', 'VIEW'),
  ('R_PAYOUT', 'acct-payroll', 'APPROVE'),
  ('R_PAYOUT', 'acct-payroll', 'VIEW'),
  ('R_PAYOUT', 'acct-payslip', 'VIEW'),
  ('R_PAYOUT', 'acct-pg', 'EDIT'),
  ('R_PAYOUT', 'acct-pg', 'VIEW'),
  ('R_PAYOUT', 'acct-po', 'EDIT'),
  ('R_PAYOUT', 'acct-po', 'VIEW'),
  ('R_PAYOUT', 'acct-purchase', 'EDIT'),
  ('R_PAYOUT', 'acct-purchase', 'VIEW'),
  ('R_PAYOUT', 'acct-receipt', 'EDIT'),
  ('R_PAYOUT', 'acct-receipt', 'VIEW'),
  ('R_PAYOUT', 'acct-reorder', 'APPROVE'),
  ('R_PAYOUT', 'acct-reorder', 'EDIT'),
  ('R_PAYOUT', 'acct-reorder', 'VIEW'),
  ('R_PAYOUT', 'acct-report', 'VIEW'),
  ('R_PAYOUT', 'acct-requisitions', 'EDIT'),
  ('R_PAYOUT', 'acct-requisitions', 'VIEW'),
  ('R_PAYOUT', 'acct-severance', 'EDIT'),
  ('R_PAYOUT', 'acct-severance', 'VIEW'),
  ('R_PAYOUT', 'acct-statements', 'VIEW'),
  ('R_PAYOUT', 'acct-stock', 'EDIT'),
  ('R_PAYOUT', 'acct-stock', 'VIEW'),
  ('R_PAYOUT', 'acct-target', 'VIEW'),
  ('R_PAYOUT', 'acct-tax', 'EDIT'),
  ('R_PAYOUT', 'acct-tax', 'EXPORT'),
  ('R_PAYOUT', 'acct-tax', 'VIEW'),
  ('R_PAYOUT', 'acct-taxinbox', 'APPROVE'),
  ('R_PAYOUT', 'acct-taxinbox', 'EDIT'),
  ('R_PAYOUT', 'acct-taxinbox', 'VIEW'),
  ('R_PAYOUT', 'acct-vatform', 'EXPORT'),
  ('R_PAYOUT', 'acct-vatform', 'VIEW'),
  ('R_PAYOUT', 'acct-vehicle', 'EDIT'),
  ('R_PAYOUT', 'acct-vehicle', 'VIEW'),
  ('R_PAYOUT', 'acct-wagestmt', 'EXPORT'),
  ('R_PAYOUT', 'acct-wagestmt', 'VIEW'),
  ('R_PAYOUT', 'acct-wh', 'EDIT'),
  ('R_PAYOUT', 'acct-wh', 'VIEW'),
  ('R_PAYOUT', 'acct-whtreturn', 'EXPORT'),
  ('R_PAYOUT', 'acct-whtreturn', 'VIEW'),
  ('R_PAYOUT', 'acct-yearclose', 'VIEW'),
  ('R_PAYOUT', 'acct-yearend', 'EDIT'),
  ('R_PAYOUT', 'acct-yearend', 'EXPORT'),
  ('R_PAYOUT', 'acct-yearend', 'VIEW'),
  ('R_PAYOUT', 'ad-billing', 'EDIT'),
  ('R_PAYOUT', 'ad-billing', 'VIEW'),
  ('R_PAYOUT', 'adx', 'VIEW'),
  ('R_PAYOUT', 'adx-payout', 'EDIT'),
  ('R_PAYOUT', 'adx-payout', 'VIEW'),
  ('R_PAYOUT', 'affiliates', 'VIEW'),
  ('R_PAYOUT', 'approval-lines', 'VIEW'),
  ('R_PAYOUT', 'approvals', 'EDIT'),
  ('R_PAYOUT', 'approvals', 'VIEW'),
  ('R_PAYOUT', 'corp-docs', 'VIEW'),
  ('R_PAYOUT', 'fin-transfer', 'APPROVE'),
  ('R_PAYOUT', 'fin-transfer', 'EDIT'),
  ('R_PAYOUT', 'fin-transfer', 'VIEW'),
  ('R_PAYOUT', 'gov-audit', 'EXPORT'),
  ('R_PAYOUT', 'hlt-settle', 'EXPORT'),
  ('R_PAYOUT', 'home', 'VIEW'),
  ('R_PAYOUT', 'hr-card', 'VIEW'),
  ('R_PAYOUT', 'hrx-booking', 'EDIT'),
  ('R_PAYOUT', 'hrx-booking', 'VIEW'),
  ('R_PAYOUT', 'hrx-stocktake', 'APPROVE'),
  ('R_PAYOUT', 'hrx-stocktake', 'EDIT'),
  ('R_PAYOUT', 'hrx-stocktake', 'VIEW'),
  ('R_PAYOUT', 'its-assets', 'EDIT'),
  ('R_PAYOUT', 'its-assets', 'VIEW'),
  ('R_PAYOUT', 'its-suggest', 'EDIT'),
  ('R_PAYOUT', 'its-suggest', 'VIEW'),
  ('R_PAYOUT', 'its-survey', 'EDIT'),
  ('R_PAYOUT', 'its-survey', 'VIEW'),
  ('R_PAYOUT', 'lgl-insurance', 'EDIT'),
  ('R_PAYOUT', 'lgl-insurance', 'VIEW'),
  ('R_PAYOUT', 'mob-scan', 'EDIT'),
  ('R_PAYOUT', 'mob-scan', 'VIEW'),
  ('R_PAYOUT', 'my-hr', 'EDIT'),
  ('R_PAYOUT', 'my-hr', 'VIEW'),
  ('R_PAYOUT', 'my-password', 'EDIT'),
  ('R_PAYOUT', 'ofc-calendar', 'EDIT'),
  ('R_PAYOUT', 'ofc-calendar', 'VIEW'),
  ('R_PAYOUT', 'ofc-notify', 'EDIT'),
  ('R_PAYOUT', 'ofc-notify', 'VIEW'),
  ('R_PAYOUT', 'ofc-tasks', 'EDIT'),
  ('R_PAYOUT', 'ofc-tasks', 'VIEW'),
  ('R_PAYOUT', 'ofc-trips', 'APPROVE'),
  ('R_PAYOUT', 'ofc-trips', 'EDIT'),
  ('R_PAYOUT', 'ofc-trips', 'VIEW'),
  ('R_PAYOUT', 'ops-board', 'EDIT'),
  ('R_PAYOUT', 'ops-board', 'VIEW'),
  ('R_PAYOUT', 'ops-guide', 'VIEW'),
  ('R_PAYOUT', 'payouts', 'APPROVE'),
  ('R_PAYOUT', 'payouts', 'EDIT'),
  ('R_PAYOUT', 'payouts', 'EXPORT'),
  ('R_PAYOUT', 'payouts', 'VIEW'),
  ('R_PAYOUT', 'perm-admin', 'VIEW'),
  ('R_PAYOUT', 'qlt-claims', 'APPROVE'),
  ('R_PAYOUT', 'qlt-claims', 'EDIT'),
  ('R_PAYOUT', 'qlt-claims', 'VIEW'),
  ('R_PAYOUT', 'qlt-lots', 'EDIT'),
  ('R_PAYOUT', 'qlt-lots', 'VIEW'),
  ('R_PAYOUT', 'qlt-supeval', 'APPROVE'),
  ('R_PAYOUT', 'qlt-supeval', 'EDIT'),
  ('R_PAYOUT', 'qlt-supeval', 'VIEW'),
  ('R_PAYOUT', 'rpt-worklog', 'EDIT'),
  ('R_PAYOUT', 'rpt-worklog', 'VIEW'),
  ('R_PAYOUT', 'sal-crm', 'EDIT'),
  ('R_PAYOUT', 'sal-crm', 'VIEW'),
  ('R_REVIEWER', 'acct-expense', 'EDIT'),
  ('R_REVIEWER', 'acct-expense', 'VIEW'),
  ('R_REVIEWER', 'acct-requisitions', 'EDIT'),
  ('R_REVIEWER', 'acct-requisitions', 'VIEW'),
  ('R_REVIEWER', 'ai-ops', 'EDIT'),
  ('R_REVIEWER', 'approval-lines', 'VIEW'),
  ('R_REVIEWER', 'approvals', 'EDIT'),
  ('R_REVIEWER', 'approvals', 'VIEW'),
  ('R_REVIEWER', 'audit', 'EDIT'),
  ('R_REVIEWER', 'audit', 'VIEW'),
  ('R_REVIEWER', 'badges', 'EDIT'),
  ('R_REVIEWER', 'badges', 'VIEW'),
  ('R_REVIEWER', 'home', 'VIEW'),
  ('R_REVIEWER', 'hrx-booking', 'EDIT'),
  ('R_REVIEWER', 'hrx-booking', 'VIEW'),
  ('R_REVIEWER', 'its-suggest', 'EDIT'),
  ('R_REVIEWER', 'its-suggest', 'VIEW'),
  ('R_REVIEWER', 'its-survey', 'EDIT'),
  ('R_REVIEWER', 'its-survey', 'VIEW'),
  ('R_REVIEWER', 'lsx-expiry', 'APPROVE'),
  ('R_REVIEWER', 'lsx-expiry', 'EDIT'),
  ('R_REVIEWER', 'lsx-expiry', 'VIEW'),
  ('R_REVIEWER', 'lsx-saved', 'VIEW'),
  ('R_REVIEWER', 'lsx-summary', 'APPROVE'),
  ('R_REVIEWER', 'lsx-summary', 'EDIT'),
  ('R_REVIEWER', 'lsx-summary', 'VIEW'),
  ('R_REVIEWER', 'lsy-dups', 'APPROVE'),
  ('R_REVIEWER', 'lsy-dups', 'EDIT'),
  ('R_REVIEWER', 'lsy-dups', 'VIEW'),
  ('R_REVIEWER', 'lsy-photos', 'EDIT'),
  ('R_REVIEWER', 'lsy-photos', 'VIEW'),
  ('R_REVIEWER', 'lsy-videos', 'APPROVE'),
  ('R_REVIEWER', 'lsy-videos', 'VIEW'),
  ('R_REVIEWER', 'my-hr', 'EDIT'),
  ('R_REVIEWER', 'my-hr', 'VIEW'),
  ('R_REVIEWER', 'my-password', 'EDIT'),
  ('R_REVIEWER', 'ofc-calendar', 'EDIT'),
  ('R_REVIEWER', 'ofc-calendar', 'VIEW'),
  ('R_REVIEWER', 'ofc-notify', 'EDIT'),
  ('R_REVIEWER', 'ofc-notify', 'VIEW'),
  ('R_REVIEWER', 'ofc-tasks', 'EDIT'),
  ('R_REVIEWER', 'ofc-tasks', 'VIEW'),
  ('R_REVIEWER', 'ofc-trips', 'APPROVE'),
  ('R_REVIEWER', 'ofc-trips', 'EDIT'),
  ('R_REVIEWER', 'ofc-trips', 'VIEW'),
  ('R_REVIEWER', 'ops-board', 'EDIT'),
  ('R_REVIEWER', 'ops-board', 'VIEW'),
  ('R_REVIEWER', 'ops-guide', 'VIEW'),
  ('R_REVIEWER', 'opx-bulk', 'EDIT'),
  ('R_REVIEWER', 'opx-bulk', 'VIEW'),
  ('R_REVIEWER', 'perm-admin', 'VIEW'),
  ('R_REVIEWER', 'queue', 'EDIT'),
  ('R_REVIEWER', 'queue', 'VIEW'),
  ('R_REVIEWER', 'rpt-worklog', 'EDIT'),
  ('R_REVIEWER', 'rpt-worklog', 'VIEW'),
  ('R_REVIEWER', 'rules', 'VIEW')
) AS v(g, t, l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = v.g) AND EXISTS (SELECT 1 FROM public.perm_tasks k WHERE k.key = v.t)
ON CONFLICT DO NOTHING;
