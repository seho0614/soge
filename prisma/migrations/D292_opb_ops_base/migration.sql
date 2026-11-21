-- =====================================================================
-- (메인이 D292 ~ 중 한 번호에 붙임) 10차 운영 기반 (v10.569 ~ 572 · docs/711 ~ 714) — 앞머리 opb_
--
--   v10.569 회귀 시간 줄이기(infra 만 · SQL 없음) · ⑤ 처리방침 스위치 SUPER(코드만 · SQL 없음)
--   v10.570 화면 비교(infra 만 · SQL 없음)
--   v10.571 대표 한눈에 — 표 없음(읽기만) · 업무 opb-glance 시드만(SUPER 만이라 권한그룹 줄 없음)
--   v10.572 운영 알림 받을 사람 규칙
--     ① opb_alert_routes — 알림 종류(ops_alerts.alert_code)마다 받을 길(텔레그램 · 메일 · 슬랙 · 게시판) · 급함 기준(min_severity) ·
--        같은 종류 묶음 간격(throttle_min) · 받을 권한그룹(groups) · '*' 줄 = 목록에 없는 종류의 기본
--        처음 값 = 지금 동작 그대로: '*' = CRITICAL 만 네 길 · D220 목록 13종 = 급함 상관없이 네 길 · 60분
--     ② opb_alert_route_log — 바꾼 기록(쌓기만 · 고치기 · 지우기 막음)
--     ③ opb_alert_route_pending(길, 수) — 규칙으로 고른 보낼 알림(지금 fn_ops_alert_*_pending 과 같은 모양) · 수 NULL = 모두(대기 수)
--     ④ 스위치 opb.alert_routes(처음 off = 지금 함수 그대로 · 규칙을 쓰지 않음) · opb.alert_group_mail(처음 off = 권한그룹 사람에게 따로 메일 안 보냄)
--   지우는 문장 없음(쌓인 데이터 그대로) · 다시 돌려도 같음 · RAISE 글자에 퍼센트 기호 없음
-- =====================================================================

/* ── ① 규칙 표 ─────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.opb_alert_routes (
  alert_code    text PRIMARY KEY CHECK (alert_code ~ '^([A-Z][A-Z0-9_]{1,59}|[*])$' AND alert_code <> 'AUDIT_CHAIN_BROKEN'),
  to_telegram   boolean NOT NULL DEFAULT true,
  to_mail       boolean NOT NULL DEFAULT true,
  to_slack      boolean NOT NULL DEFAULT true,
  to_board      boolean NOT NULL DEFAULT true,
  min_severity  text NOT NULL DEFAULT 'CRITICAL' CHECK (min_severity IN ('INFO', 'WARN', 'CRITICAL')),
  throttle_min  integer NOT NULL DEFAULT 60 CHECK (throttle_min BETWEEN 0 AND 1440),
  groups        text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(groups) <= 10),
  note          text CHECK (note IS NULL OR char_length(note) <= 200),
  updated_by    uuid REFERENCES public.accounts(id),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.opb_alert_routes IS 'v10.572 (docs/714) 운영 알림 받을 사람 규칙 — 종류마다 길 · 급함 기준(이 등급 이상이면 보냄) · 같은 종류 묶음 간격(분) · 받을 권한그룹(perm_role_groups.key · 메일 따로 보내기는 opb.alert_group_mail) · ''*'' = 기본 줄(지울 수 없음) · AUDIT_CHAIN_BROKEN 은 규칙을 만들 수 없음(늘 네 길) · CRITICAL 은 늘 게시판에 · 스위치 opb.alert_routes 가 on 일 때만 씀';

/* 처음 값 = 지금 동작(D220 fn_ops_alert_mail_pending · push · slack · scheduler alertBoard 의 목록과 같음) */
INSERT INTO public.opb_alert_routes (alert_code, min_severity, note) VALUES
  ('*', 'CRITICAL', '기본 — 급함(CRITICAL)만 네 길(지금 동작)')
ON CONFLICT (alert_code) DO NOTHING;
INSERT INTO public.opb_alert_routes (alert_code, min_severity, note)
SELECT c, 'INFO', '처음 값 — D220 목록(급함 상관없이 네 길 · 지금 동작)'
  FROM unnest(ARRAY['SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'ORDER_OPEN_EXPIRED', 'STAFF_LOGIN_NEW',
                    'AGENT_LIVE', 'AGENT_READY_GAP', 'AGENT_CAP_NEAR', 'AGENT_STEP_READY',
                    'STAFF_IP_PASS_NEW', 'STAFF_IP_LOCKED', 'STAFF_IP_DAY_LIMIT', 'ASSUME_READY']) c
ON CONFLICT (alert_code) DO NOTHING;

/* 기본 줄('*')은 지우지 못함 */
CREATE OR REPLACE FUNCTION public.opb_alert_routes_keep_default() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.alert_code = '*' THEN
    RAISE EXCEPTION 'OPB_ROUTE_DEFAULT: 기본 줄(*)은 지울 수 없습니다 — 길 · 기준만 고칩니다.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_opb_alert_routes_keep_default' AND tgrelid = 'public.opb_alert_routes'::regclass) THEN
    CREATE TRIGGER trg_opb_alert_routes_keep_default BEFORE DELETE ON public.opb_alert_routes
      FOR EACH ROW EXECUTE FUNCTION public.opb_alert_routes_keep_default();
  END IF;
END $$;

/* ── ② 바꾼 기록(쌓기만) ───────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.opb_alert_route_log (
  id          bigserial PRIMARY KEY,
  alert_code  text NOT NULL CHECK (alert_code ~ '^([A-Z][A-Z0-9_]{1,59}|[*])$'),
  action      text NOT NULL CHECK (action IN ('SET', 'REMOVE', 'SWITCH')),
  before_data jsonb,
  after_data  jsonb,
  reason      text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 2 AND 200),
  actor_id    uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_opb_alert_route_log_at ON public.opb_alert_route_log (created_at DESC);
COMMENT ON TABLE public.opb_alert_route_log IS 'v10.572 (docs/714) 운영 알림 규칙 바꾼 기록 — 쌓기만(고치기 · 지우기 막음) · SWITCH 는 스위치 바꿈(alert_code = ''*'')';

CREATE OR REPLACE FUNCTION public.opb_alert_route_log_ro() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'OPB_ROUTE_LOG_RO: 운영 알림 규칙 기록은 쌓기만 합니다(고치기 · 지우기 안 됨).' USING ERRCODE = 'check_violation';
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_opb_alert_route_log_ro' AND tgrelid = 'public.opb_alert_route_log'::regclass) THEN
    CREATE TRIGGER trg_opb_alert_route_log_ro BEFORE UPDATE OR DELETE ON public.opb_alert_route_log
      FOR EACH ROW EXECUTE FUNCTION public.opb_alert_route_log_ro();
  END IF;
END $$;

/* ── ③ 규칙으로 고르기 ─────────────────────────────────────────────── */
CREATE OR REPLACE FUNCTION public.opb_sev_rank(p text) RETURNS integer
    LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'CRITICAL' THEN 3 WHEN 'WARN' THEN 2 WHEN 'INFO' THEN 1 ELSE 0 END
$$;

/* 길: mail · telegram · slack · board. 지금 함수와 같은 바탕(확인 · 풀림 빼고 · 24시간 안) ·
 *   종류마다 규칙 줄(없으면 '*') · 급함 기준 이상 · 그 길이 켜져 있음 · 같은 종류 throttle_min 분 안에 그 길로 보낸 것이 있으면 뺌(게시판은 묶음 간격 없음) ·
 *   AUDIT_CHAIN_BROKEN 은 늘 네 길 · CRITICAL 은 늘 게시판 · 순서는 지금과 같음(CRITICAL 먼저 · 보내기는 최근 순 · 게시판은 오래된 순) · p_limit NULL = 모두 */
CREATE OR REPLACE FUNCTION public.opb_alert_route_pending(p_channel text, p_limit integer DEFAULT 50)
RETURNS TABLE (id bigint, alert_code text, severity text, title text, raised_at timestamptz)
    LANGUAGE sql STABLE AS $$
  SELECT o.id, o.alert_code, o.severity, o.title, o.raised_at
    FROM public.ops_alerts o
    CROSS JOIN LATERAL (
      SELECT x.to_telegram, x.to_mail, x.to_slack, x.to_board, x.min_severity, x.throttle_min
        FROM public.opb_alert_routes x
       WHERE x.alert_code = o.alert_code OR x.alert_code = '*'
       ORDER BY (x.alert_code = '*') LIMIT 1) r
   WHERE o.acknowledged_at IS NULL AND o.resolved_at IS NULL
     AND o.raised_at > now() - interval '24 hours'
     AND CASE p_channel
           WHEN 'mail'     THEN o.mailed_at IS NULL       AND (o.alert_code = 'AUDIT_CHAIN_BROKEN' OR (r.to_mail     AND public.opb_sev_rank(o.severity) >= public.opb_sev_rank(r.min_severity)))
           WHEN 'telegram' THEN o.pushed_at IS NULL       AND (o.alert_code = 'AUDIT_CHAIN_BROKEN' OR (r.to_telegram AND public.opb_sev_rank(o.severity) >= public.opb_sev_rank(r.min_severity)))
           WHEN 'slack'    THEN o.slack_pushed_at IS NULL AND (o.alert_code = 'AUDIT_CHAIN_BROKEN' OR (r.to_slack    AND public.opb_sev_rank(o.severity) >= public.opb_sev_rank(r.min_severity)))
           WHEN 'board'    THEN o.board_posted_at IS NULL AND (o.alert_code = 'AUDIT_CHAIN_BROKEN' OR o.severity = 'CRITICAL'
                                                               OR (r.to_board AND public.opb_sev_rank(o.severity) >= public.opb_sev_rank(r.min_severity)))
           ELSE false END
     AND (p_channel = 'board' OR r.throttle_min = 0 OR NOT EXISTS (
           SELECT 1 FROM public.ops_alerts m
            WHERE m.alert_code = o.alert_code
              AND CASE p_channel WHEN 'mail' THEN m.mailed_at WHEN 'telegram' THEN m.pushed_at ELSE m.slack_pushed_at END
                  > now() - make_interval(mins => r.throttle_min)))
   ORDER BY (o.severity = 'CRITICAL') DESC, CASE WHEN p_channel = 'board' THEN o.id ELSE -o.id END
   LIMIT p_limit
$$;
COMMENT ON FUNCTION public.opb_alert_route_pending(text, integer) IS 'v10.572 (docs/714) 규칙(opb_alert_routes)으로 고른 보낼 운영 알림 — 길 mail · telegram · slack · board · 처음 규칙이면 fn_ops_alert_*_pending · 게시판 목록과 같은 결과 · p_limit NULL = 모두(대기 수) · 스위치 opb.alert_routes on 일 때만 서버가 부름';

/* ── ④ 스위치 ───────────────────────────────────────────────────────── */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('opb.alert_routes', 'off', 'ADMIN', '운영 알림 받을 사람 규칙 쓰기(v10.572 · docs/714) — 처음 off = 지금 동작(DB 함수 fn_ops_alert_*_pending · 게시판 목록 그대로) · on 이면 위험감지 › 알림 받을 사람 규칙(opb_alert_routes)으로 길 · 급함 기준 · 묶음 간격을 고름 · 바꾸기 SUPER', false, '^(on|off)$', 'off'),
  ('opb.alert_group_mail', 'off', 'ADMIN', '규칙의 받을 권한그룹 사람에게 급한 알림 메일을 따로 보내기(v10.572) — 처음 off · opb.alert_routes 도 on 이어야 · 대표 메일(ops.digest_to)로 한 통 보낸 뒤 그 묶음의 권한그룹 사람(재직 · 운영 역할 · 20명까지)에게 한 통씩 · 바꾸기 SUPER', false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;

/* ── ㉕ 권한(D258) 시드 — 두 탭 모두 SUPER 만(권한그룹 줄 없음 · SUPER 는 늘 통과) ───────────── */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('opb-glance', '대표 한눈에', 'adm', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 5),
  ('opb-alert-routes', '알림 받을 사람 규칙', 'admrsk', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 495)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/opb/glance', 'opb-glance', 'VIEW'),
  ('GET', '/admin/opb/alert-routes', 'opb-alert-routes', 'VIEW'),
  ('PUT', '/admin/opb/alert-routes/{code}', 'opb-alert-routes', 'EDIT'),
  ('POST', '/admin/opb/alert-routes/{code}/remove', 'opb-alert-routes', 'EDIT'),
  ('PUT', '/admin/opb/alert-route-settings', 'opb-alert-routes', 'APPROVE')
ON CONFLICT (method, pattern, task_key) DO NOTHING;
