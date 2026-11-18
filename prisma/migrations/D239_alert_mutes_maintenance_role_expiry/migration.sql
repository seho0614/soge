-- v10.370 ~ 372 (docs/505 ~ 507) — 운영 알림 잠시 끄기 · 사이트 점검 중 화면 · 운영 권한 기한
--   대표 11/18 「다음」 → 「다음 개발」 → ① 운영자 비밀번호 운영 화면에서 ② 운영 알림 잠시 끄기 ③ 사이트 점검 중 화면 ④ 운영 권한 기한 「모두」 → 「승인 + 통과하면 병합」.
--   ① 칸 · 표 없음(v10.360 규칙 · password_history 그대로)
--   ② alert_mutes — 알림 종류마다 끝 시각까지 텔레그램 · 슬랙 · 메일 · 당번 보내기만 멈춤(기록 · 화면은 그대로) · 쌓기만 · 일찍 풀기는 칸만 채움
--      감사 기록 위변조(AUDIT_CHAIN_BROKEN)는 끌 수 없음(CHECK)
--   ③ 설정 site.maintenance_from · site.maintenance_until · site.maintenance_note · site.maintenance_note_en(GLOBAL — 사용자 웹이 읽음 · 비면 점검 없음)
--   ④ 칸 account_roles.expires_at(비면 기한 없음) — 지나면 매시간 정기 작업이 거둠(role_changes 에 사유 「기한 지남」)
--   지우는 문장 없음 · 다시 돌려도 같음.

CREATE TABLE IF NOT EXISTS public.alert_mutes (
  id          bigserial PRIMARY KEY,
  alert_code  text NOT NULL CHECK (alert_code ~ '^[A-Z][A-Z0-9_]{1,59}$' AND alert_code <> 'AUDIT_CHAIN_BROKEN'),
  until_at    timestamptz NOT NULL,
  reason      text NOT NULL CHECK (char_length(reason) BETWEEN 2 AND 200),
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  lifted_at   timestamptz,
  lifted_by   uuid REFERENCES public.accounts(id),
  lift_reason text CHECK (lift_reason IS NULL OR char_length(lift_reason) BETWEEN 2 AND 200),
  CONSTRAINT ck_alert_mutes_until CHECK (until_at > created_at AND until_at <= created_at + interval '24 hours 1 minute'),
  CONSTRAINT ck_alert_mutes_lifted CHECK ((lifted_at IS NULL) = (lift_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_alert_mutes_code ON public.alert_mutes (alert_code, until_at DESC);
COMMENT ON TABLE public.alert_mutes IS 'v10.370 (D239) 운영 알림 잠시 끄기 — 종류마다 until_at 까지 텔레그램 · 슬랙 · 메일 · 당번 보내기만 멈춤(알림 기록 · 화면은 그대로) · 끄기 SUPER(1 · 4 · 24시간) · 쌓기만 · 일찍 풀기는 lifted_* 만 · AUDIT_CHAIN_BROKEN 은 끌 수 없음';

CREATE OR REPLACE FUNCTION public.fn_alert_mutes_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ALERT_MUTE: 알림 끄기 기록은 지우지 않습니다.'; END IF;
  IF OLD.lifted_at IS NOT NULL OR NEW.lifted_at IS NULL
     OR (NEW.alert_code, NEW.until_at, NEW.reason, NEW.created_by, NEW.created_at)
        IS DISTINCT FROM (OLD.alert_code, OLD.until_at, OLD.reason, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'ALERT_MUTE: 알림 끄기는 일찍 풀기(한 번)만 기록합니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_alert_mutes_guard' AND tgrelid = 'public.alert_mutes'::regclass) THEN
    CREATE TRIGGER trg_alert_mutes_guard BEFORE UPDATE OR DELETE ON public.alert_mutes FOR EACH ROW EXECUTE FUNCTION public.fn_alert_mutes_guard();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('site.maintenance_from', '', 'GLOBAL',
   '사이트 점검 시작(v10.371 · docs/506) — 이 시각부터 끝 시각까지 사용자 웹 모든 화면이 「점검 중」 안내(운영 화면 · API 는 그대로). 시작 24시간 전부터 안내 띠. 비면 점검 없음. 정하기는 운영 화면 첫 화면 「점검 예약」(SUPER).',
   false, '^$|^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?\+09:00$', '2026-11-20T02:00+09:00'),
  ('site.maintenance_until', '', 'GLOBAL',
   '사이트 점검 끝(v10.371 · docs/506) — 지나면 저절로 풀림(최대 12시간).',
   false, '^$|^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?\+09:00$', '2026-11-20T04:00+09:00'),
  ('site.maintenance_note', '', 'GLOBAL',
   '사이트 점검 안내 글(v10.371 · 200자까지 · 비면 기본 문장).', false, NULL, '서비스 개선 작업 중입니다.'),
  ('site.maintenance_note_en', '', 'GLOBAL',
   '사이트 점검 안내 글 영어(v10.371 · 비면 기본 영어 문장).', false, NULL, 'We are improving the service.')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.account_roles ADD COLUMN IF NOT EXISTS expires_at timestamptz;
COMMENT ON COLUMN public.account_roles.expires_at IS 'v10.372 (D239) 운영 권한 기한 — 비면 없음 · 지나면 매시간 정기 작업(sla_alert)이 거둠(role_changes 사유 「기한 지남」) · 회원 역할(MEMBER) · 사업자 역할에는 쓰지 않음';
CREATE INDEX IF NOT EXISTS ix_account_roles_expires ON public.account_roles (expires_at) WHERE expires_at IS NOT NULL;
