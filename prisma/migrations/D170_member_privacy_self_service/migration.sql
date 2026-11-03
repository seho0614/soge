-- =====================================================================
-- D170 (v10.181 · docs/283) — 회원 스스로 하는 개인정보 관리
--
--   ① login_history — 회원 로그인 기록(성공 · 가입된 계정의 비밀번호 틀림) · IP 는 앞 두 마디만 · 브라우저/OS 종류만
--      privacy.login_history_days(180)일 지나면 매일 03:00 파기(fn_purge_auth_records) · 파기된 계정 기록도 지움
--   ② privacy_requests — 개인정보 열람 · 정정 · 삭제 · 처리정지 요청 · 처리 기한(privacy.request_due_days 10일)
--      끝난 요청(DONE · REJECTED)은 고칠 수 없음 · 연장은 한 번 · 요청 내용은 암호화(fn_enc_key) · 계정 파기 때 내용만 지움
--   ③ 설정 privacy.export_daily 3 · privacy.login_history_days 180 · privacy.request_due_days 10(모두 ADMIN)
--
--   ★ 처리 기한 · 연장 · 로그인 기록 보관 기간은 최신 법령 확인이 필요합니다(docs/283 5절). 지우는 문장 없음.
-- =====================================================================

-- 1. 로그인 기록 -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.login_history (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT now(),
  ok          boolean NOT NULL,
  ip_masked   text CHECK (ip_masked IS NULL OR length(ip_masked) <= 60),
  ua_kind     text CHECK (ua_kind IS NULL OR length(ua_kind) <= 60)
);
CREATE INDEX IF NOT EXISTS ix_login_history_account_at ON public.login_history (account_id, at DESC);
CREATE INDEX IF NOT EXISTS ix_login_history_at ON public.login_history (at);
COMMENT ON TABLE public.login_history IS
  '회원 로그인 기록(D170 · v10.181). ok = 성공 / 비밀번호 틀림(가입된 계정만) · ip_masked = IP 앞 두 마디(121.168.*.*) · ua_kind = 브라우저 · OS 종류(Chrome · Windows). 원래 IP · 브라우저 글자는 남기지 않음. privacy.login_history_days 지나면 매일 파기.';

-- 2. 개인정보 권리 요청 ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.privacy_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES public.accounts(id),
  kind           text NOT NULL CHECK (kind IN ('ACCESS','CORRECT','DELETE','SUSPEND')),
  body_enc       bytea,
  status         text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','EXTENDED','DONE','REJECTED')),
  due_on         date NOT NULL,
  extend_reason  text CHECK (extend_reason IS NULL OR length(btrim(extend_reason)) BETWEEN 5 AND 500),
  result_note    text CHECK (result_note IS NULL OR length(btrim(result_note)) BETWEEN 5 AND 1000),
  handled_by     uuid REFERENCES public.accounts(id),
  handled_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('DONE','REJECTED') OR (result_note IS NOT NULL AND handled_by IS NOT NULL AND handled_at IS NOT NULL)),
  CHECK (status <> 'EXTENDED' OR extend_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_privacy_requests_account ON public.privacy_requests (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_privacy_requests_open ON public.privacy_requests (due_on) WHERE status IN ('OPEN','EXTENDED');
CREATE INDEX IF NOT EXISTS ix_privacy_requests_handled_by ON public.privacy_requests (handled_by);
COMMENT ON TABLE public.privacy_requests IS
  '개인정보 권리 요청(D170 · v10.181) — 열람 ACCESS · 정정 CORRECT · 삭제 DELETE · 처리정지 SUSPEND. due_on = 접수일 + privacy.request_due_days · 연장은 한 번(사유) · 끝난 요청(DONE · REJECTED)은 고칠 수 없음(계정 파기 때 body_enc 를 지우는 것만 됨). body_enc = 요청 내용(pgp_sym_encrypt · fn_enc_key).';

CREATE OR REPLACE FUNCTION public.fn_privacy_request_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PRIVACY_REQUEST_LOCKED: 권리 요청 기록은 지울 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.id <> OLD.id OR NEW.account_id <> OLD.account_id OR NEW.kind <> OLD.kind OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'PRIVACY_REQUEST_LOCKED: 요청 내용은 바꿀 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status IN ('DONE','REJECTED') THEN
    -- 끝난 요청은 계정 파기 때 내용을 지우는 것만
    IF NEW.body_enc IS NULL AND (NEW.status, NEW.due_on, NEW.extend_reason, NEW.result_note, NEW.handled_by, NEW.handled_at)
         IS NOT DISTINCT FROM (OLD.status, OLD.due_on, OLD.extend_reason, OLD.result_note, OLD.handled_by, OLD.handled_at) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'PRIVACY_REQUEST_LOCKED: 끝난 요청은 고칠 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.body_enc IS DISTINCT FROM OLD.body_enc AND NEW.body_enc IS NOT NULL THEN
    RAISE EXCEPTION 'PRIVACY_REQUEST_LOCKED: 요청 내용은 바꿀 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'EXTENDED' AND NEW.status = 'EXTENDED' AND NEW.due_on <> OLD.due_on THEN
    RAISE EXCEPTION 'PRIVACY_REQUEST_EXTENDED_ONCE: 처리 기한 연장은 한 번만 할 수 있습니다.' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'EXTENDED' AND NEW.status = 'OPEN' THEN
    RAISE EXCEPTION 'PRIVACY_REQUEST_EXTENDED_ONCE: 연장한 요청을 되돌릴 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_privacy_requests_guard ON public.privacy_requests;
CREATE TRIGGER trg_privacy_requests_guard BEFORE UPDATE OR DELETE ON public.privacy_requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_privacy_request_guard();

-- 3. 파기 — 로그인 기록 보관 기간 · 파기된 계정의 기록 · 요청 내용 ----------------
CREATE OR REPLACE FUNCTION public.fn_purge_auth_records() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int; m int; h int; p int; days int;
BEGIN
  DELETE FROM password_reset_tokens WHERE created_at < now() - interval '7 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM auth_throttle WHERE last_at < now() - interval '2 days' AND (locked_until IS NULL OR locked_until < now());
  GET DIAGNOSTICS m = ROW_COUNT;
  -- v10.181 (D170) — 로그인 기록 보관 기간 · 파기된 계정
  days := greatest(fn_setting_int('privacy.login_history_days', 180), 1);
  DELETE FROM login_history lh
   WHERE lh.at < now() - make_interval(days => days)
      OR EXISTS (SELECT 1 FROM accounts a WHERE a.id = lh.account_id AND a.purged_at IS NOT NULL);
  GET DIAGNOSTICS h = ROW_COUNT;
  UPDATE privacy_requests pr SET body_enc = NULL
    FROM accounts a
   WHERE a.id = pr.account_id AND a.purged_at IS NOT NULL AND pr.body_enc IS NOT NULL
     AND pr.status IN ('DONE','REJECTED');
  GET DIAGNOSTICS p = ROW_COUNT;
  RETURN n + m + h + p;
END $$;

-- 4. 설정 --------------------------------------------------------------
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('privacy.export_daily', '3', 'ADMIN',
   '내 정보 내려받기(v10.181 · docs/283) — 회원 한 사람이 하루에 내려받을 수 있는 횟수(1 ~ 20).',
   false, '^([1-9]|1[0-9]|20)$', '3'),
  ('privacy.login_history_days', '180', 'ADMIN',
   '회원 로그인 기록 보관 날수(v10.181) — 지나면 매일 03:00 파기. 법이 정한 기간은 최신 법령 확인이 필요합니다.',
   false, '^[1-9][0-9]{0,3}$', '180'),
  ('privacy.request_due_days', '10', 'ADMIN',
   '개인정보 권리 요청 처리 기한(v10.181) — 접수일 + 이 날수. 연장은 한 번(같은 날수). 법이 정한 기한은 최신 법령 확인이 필요합니다.',
   false, '^([1-9]|[1-5][0-9]|60)$', '10')
ON CONFLICT (key) DO NOTHING;
