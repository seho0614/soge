/* =====================================================================
 * v10.597 (docs/739) ⑬ 가입 퍼널 분석 — 16차 회원 · 성장(grw_) · 대표 11/21 「모두 개발진행」
 *   ① grw_signup_steps_daily — 가입 화면 단계(1 ~ 5)에 닿은 하루 수만(계정 · IP · 브라우저 · 쿠키 칸 없음)
 *   ② fn_grw_step_add — 하루 × 단계 한 줄에 1 더함
 *   ③ 설정 grw.signup_steps(처음 off) — 켜기 SUPER · 켜기 전 처리방침 「서비스 이용 기록(가입 화면 단계 수)」 확인(처리방침 1.2 게시 뒤)
 *   ④ ㉕ 권한(D258) 시드 — 업무 grw-ops(회원 묶음 admusr · 따로 적지 않은 탭 = ADMIN) · 주소 규칙 GET = VIEW · 그 밖 = EDIT
 *   퍼널 셈 자체는 이미 있는 표를 읽기만(accounts · attribution_events · introducer_referrals · site_usage_daily · favorites · conversations · listings · requests · deals)
 *   재실행 안전. 표 · 자료를 지우는 문장 없음. RAISE 글자에 퍼센트 기호 없음.
 * ===================================================================== */

-- ① 가입 화면 단계 하루 수 -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grw_signup_steps_daily (
  day   date     NOT NULL,
  step  smallint NOT NULL CHECK (step BETWEEN 1 AND 5),
  n     integer  NOT NULL DEFAULT 0 CHECK (n >= 0),
  PRIMARY KEY (day, step)
);
COMMENT ON TABLE public.grw_signup_steps_daily IS
  'v10.597 (docs/739) 가입 화면 단계(1 유형 · 2 기업 인증 · 3 정보 · 4 약관 · 5 관심 성향)에 닿은 하루(한국 날짜) 수만 — 누가 닿았는지 · IP · 브라우저 정보 없음 · grw.signup_steps on 일 때만 · 보관 site.usage_keep_days(정기 작업 grw_daily)';

-- ② 더하기 ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_grw_step_add(p_day date, p_step int) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_step IS NULL OR p_step < 1 OR p_step > 5 THEN
    RAISE EXCEPTION 'GRW_STEP: 가입 단계는 1 ~ 5 입니다.';
  END IF;
  INSERT INTO grw_signup_steps_daily (day, step, n) VALUES (p_day, p_step, 1)
  ON CONFLICT (day, step) DO UPDATE SET n = grw_signup_steps_daily.n + 1;
END $$;

-- ③ 설정 -----------------------------------------------------------------
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('grw.signup_steps', 'off', 'ADMIN', '가입 화면 단계 수 세기(v10.597 · docs/739) — on 이면 가입 화면 1 ~ 5단계에 닿은 하루 수만 셈(계정 · IP · 쿠키 없음 · DNT · GPC 무시) · 처음 off · 켜기 SUPER · 켜기 전 처리방침 확인(처리방침 1.2 게시 뒤)', false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;

-- ④ ㉕ 권한 시드 ----------------------------------------------------------
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('grw-ops', '회원 성장', 'admusr', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2960)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT 'R_ADMIN', 'grw-ops', l FROM (VALUES ('VIEW'), ('EDIT'), ('APPROVE'), ('EXPORT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = 'R_ADMIN')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/grw/overview', 'grw-ops', 'VIEW'),
  ('PUT', '/admin/grw/settings', 'grw-ops', 'EDIT'),
  ('GET', '/admin/grw/funnel', 'grw-ops', 'VIEW')
ON CONFLICT (method, pattern, task_key) DO NOTHING;
/* =====================================================================
 * v10.598 (docs/740) ⑭ 첫 거래 안내 체크리스트 — 16차 회원 · 성장(grw_)
 *   ① grw_first_steps — 회원 한 사람 한 줄(그만 보기 · 다 끝낸 때) · 단계 끝남은 이미 있는 기록을 볼 때마다 셈(새로 모으는 정보 없음)
 *   ② 설정 grw.first_steps(on — 본인 것만 보여 주는 표시 · NOTES.md 이유) · grw.first_steps_days(60)
 *   ③ ㉕ 권한 주소 한 줄(업무 grw-ops 는 grw_597)
 *   재실행 안전. 표 · 자료를 지우는 문장 없음.
 * ===================================================================== */

CREATE TABLE IF NOT EXISTS public.grw_first_steps (
  account_id   uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  hidden_at    timestamptz,
  all_done_at  timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.grw_first_steps IS
  'v10.598 (docs/740) 첫 거래 안내 — 그만 보기(hidden_at) · 여덟 단계를 다 끝낸 때(all_done_at · 한 번만) · 단계 끝남은 본인인증 · 관심 성향 · 관심 담기 · 문의 · 매물/요청 · 거래 · 알림 설정 · 추천 코드 기록을 볼 때마다 셈';

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('grw.first_steps', 'on', 'ADMIN', '첫 거래 안내 체크리스트(v10.598 · docs/740) — on 이면 가입 grw.first_steps_days 일 안 회원의 나의공간 첫 화면에 남은 단계 카드(본인 기록만 · 새로 모으는 정보 없음 · 표시만이라 처음 on) · 끄기 SUPER', false, '^(on|off)$', 'on'),
  ('grw.first_steps_days', '60', 'ADMIN', '첫 거래 안내를 보여 주는 가입 뒤 날 수(7 ~ 365 · 처음 60 · v10.598)', false, '^([7-9]|[1-9][0-9]|[12][0-9]{2}|3[0-5][0-9]|36[0-5])$', '60')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/grw/first-steps', 'grw-ops', 'VIEW')
ON CONFLICT (method, pattern, task_key) DO NOTHING;
/* =====================================================================
 * v10.599 (docs/741) ⑮ 알림 하루 요약 받기 — 16차 회원 · 성장(grw_)
 *   ① grw_digest_prefs — 회원이 켠 「하루 요약 받기」(한 사람 한 줄)
 *   ② grw_digest_sends — 요약 보낸 날(회원마다 하루 한 번 · 건수만 · 400일 뒤 정기 작업이 지움)
 *   ③ 알림 종류 GRW_DIGEST(회원이 끌 수 있음) · 글 GRW_DIGEST_INAPP
 *   ④ trg_grw_digest_mail_hold — 메일이 준비된 뒤: 하루 요약을 켠 회원의 「끌 수 있는 알림」 메일 한 통 한 통은 대기열에 들어갈 때 DIGEST 로 닫음
 *      (끌 수 없는 돈 · 계약 알림 · 요약 알림 자체 · 스위치 off · 메일 아닌 길은 그대로) · 메일 준비 전에는 메일 줄이 FAILED(채널 준비 안 됨)로 들어가 이 트리거와 상관없음
 *   ⑤ 설정 grw.digest(처음 off) · 정기 작업 grw_daily(매일 08:00 · 요약 · 오래된 단계 수 · 요약 기록 정리)
 *   ⑥ ㉕ 권한 주소 한 줄
 *   재실행 안전. 표 · 자료를 지우는 문장 없음. RAISE 글자에 퍼센트 기호 없음.
 * ===================================================================== */

CREATE TABLE IF NOT EXISTS public.grw_digest_prefs (
  account_id  uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  enabled     boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.grw_digest_prefs IS
  'v10.599 (docs/741) 알림 하루 요약 받기(회원 설정) — 켜면 매일 08:00 지난 24시간 알림을 한 통으로 · 메일 준비 뒤에는 끌 수 있는 알림 메일을 묶음 · grw.digest off 면 아무것도 하지 않음';

CREATE TABLE IF NOT EXISTS public.grw_digest_sends (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  sent_on     date NOT NULL,
  items       integer NOT NULL CHECK (items >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_grw_digest_sends UNIQUE (account_id, sent_on)
);
COMMENT ON TABLE public.grw_digest_sends IS
  'v10.599 (docs/741) 하루 요약 보낸 날 — 회원마다 하루 한 번 · 묶은 알림 건수만(알림 글 · 제목 없음) · 400일 뒤 grw_daily 가 지움';

INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis, tone) VALUES
  ('GRW_DIGEST', '알림 하루 요약', true, false, '회원이 직접 켠 하루 요약 — 매일 아침 한 번(v10.599)', 'info')
ON CONFLICT (event_code) DO NOTHING;
INSERT INTO public.notification_templates (code, channel, title, body, variables) VALUES
  ('GRW_DIGEST_INAPP', 'INAPP', '어제부터 받은 알림 {count}건',
   E'{lines}\n\n나의공간 › 알림에서 하나하나 볼 수 있습니다. 하루 요약은 알림 설정에서 끌 수 있습니다.', '["count","lines"]'::jsonb)
ON CONFLICT (code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_grw_digest_mail_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.channel = 'EMAIL' AND NEW.status = 'QUEUED' AND NEW.notification_id IS NOT NULL
     AND coalesce((SELECT value FROM site_settings WHERE key = 'grw.digest'), 'off') = 'on'
     AND EXISTS (SELECT 1 FROM notifications n
                   JOIN grw_digest_prefs g ON g.account_id = n.account_id AND g.enabled
                   JOIN notification_event_policies p ON p.event_code = n.event_code AND p.optout_allowed IS TRUE
                  WHERE n.id = NEW.notification_id AND n.event_code <> 'GRW_DIGEST') THEN
    NEW.status := 'FAILED';
    NEW.failed_reason := 'DIGEST: 하루 요약으로 묶어 보냄';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_grw_digest_mail_hold ON public.notification_deliveries;
CREATE TRIGGER trg_grw_digest_mail_hold BEFORE INSERT ON public.notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.fn_grw_digest_mail_hold();

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('grw.digest', 'off', 'ADMIN', '알림 하루 요약(v10.599 · docs/741) — on 이면 회원이 나의공간 › 알림에서 「하루 요약 받기」를 켤 수 있음 · 매일 08:00 한 통(메일 준비 전에는 사이트 알림만) · 처음 off · 켜기 SUPER', false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('grw_daily', 1440, 8, 0, NULL, true, '회원 · 성장 — 매일 08:00 · 알림 하루 요약(GRW_DIGEST · grw.digest on 일 때만) · 가입 단계 수 보관 끝(site.usage_keep_days) · 요약 기록 400일 · v10.597 · 599')
ON CONFLICT (job) DO NOTHING;

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/grw/digest', 'grw-ops', 'VIEW')
ON CONFLICT (method, pattern, task_key) DO NOTHING;
/* =====================================================================
 * v10.600 (docs/742) ⑯ 여러 단계 추천 보상 — 16차 회원 · 성장(grw_) · **처음 off · 법무 확인 필요(방문판매법 다단계판매 해당 여부)**
 *   11/9 대표 「다단계 해당 안 됨」은 직접 추천 1단계(REFERRAL_DIRECT · D189) 기준 — 여러 단계는 partner-affiliate 미정 #5 「법무 확인 대기」 그대로.
 *   D189 · D190 · D277 은 고치지 않음: introducer_referrals 에 칸을 더하지 않고(N-12 그대로) · fn_referral_reward 를 다시 쓰지 않음 ·
 *   REFERRAL_DIRECT 가드(trg_referral_reward_guard)도 그대로.
 *   ① 보상 규칙 REFERRAL_TIER(point_rules · 꺼진 채 · 표시용 — 지급 여부는 설정 두 줄 · 한 달 상한 칸만 씀)
 *   ② grw_tier_rewards — 가입한 사람 한 명 · 단계(2 ~ 4) 하나에 한 번(고유) · 고칠 수 없음(계정이 지워질 때만 함께 지워짐)
 *   ③ fn_grw_tier_reward(AFTER INSERT ON point_ledger · REFERRAL_DIRECT 줄만) — grw.tier_reward 와 grw.tier_legal_ok 가 **둘 다 on** 일 때만
 *      직접 추천한 사람의 추천인(2단계) → 그 추천인(3단계) … grw.tier_points 개수만큼 · 탈퇴 · 정지 건너뜀 · 고리 막음 · 한 달 상한 · 현금화 안 됨
 *   ④ fn_grw_tier_guard(BEFORE INSERT ON point_ledger) — REFERRAL_TIER 줄은 ③ 안에서만 · redeemable false 만
 *   ⑤ 설정 grw.tier_reward(off) · grw.tier_legal_ok(off) · grw.tier_points('300') · ⑥ ㉕ 권한 주소 한 줄
 *   재실행 안전. 표 · 자료를 지우는 문장 없음. RAISE 글자에 퍼센트 기호 없음.
 * ===================================================================== */

-- ① 보상 규칙 ---------------------------------------------------------------
INSERT INTO public.point_rules (code, name, points, needs_valid, monthly_cap, is_active, sort_order)
VALUES ('REFERRAL_TIER', '내가 추천한 분이 추천한 분의 본인인증(여러 단계 · 법무 확인 뒤 · 처음 꺼짐 · 현금화 안 됨)', 300, false, NULL, false, 10)
ON CONFLICT DO NOTHING;

-- ② 여러 단계 보상 기록 -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grw_tier_rewards (
  id                bigserial PRIMARY KEY,
  invitee_id        uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  beneficiary_id    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  level             smallint NOT NULL CHECK (level BETWEEN 2 AND 4),
  points            integer NOT NULL CHECK (points > 0),
  direct_ledger_id  bigint,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_grw_tier_rewards UNIQUE (invitee_id, level),
  CONSTRAINT ck_grw_tier_rewards_self CHECK (invitee_id <> beneficiary_id)
);
CREATE INDEX IF NOT EXISTS ix_grw_tier_rewards_beneficiary ON public.grw_tier_rewards (beneficiary_id, created_at);
COMMENT ON TABLE public.grw_tier_rewards IS
  'v10.600 (docs/742) 여러 단계 추천 보상 한 줄 — 가입한 사람(invitee) 한 명 · 단계 하나에 한 번 · 받은 사람(beneficiary) · 점수(현금화 안 됨) · 직접 보상 줄 번호 · 고칠 수 없음 · grw.tier_reward · grw.tier_legal_ok 둘 다 on 일 때만 생김(법무 확인 필요)';

CREATE OR REPLACE FUNCTION public.fn_grw_tier_rewards_ro() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'GRW_TIER: 여러 단계 추천 보상 기록은 고칠 수 없습니다.';
END $$;
DROP TRIGGER IF EXISTS trg_grw_tier_rewards_ro ON public.grw_tier_rewards;
CREATE TRIGGER trg_grw_tier_rewards_ro BEFORE UPDATE ON public.grw_tier_rewards
  FOR EACH ROW EXECUTE FUNCTION public.fn_grw_tier_rewards_ro();

-- ④ REFERRAL_TIER 줄 가드 -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_grw_tier_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_ctx text := coalesce(current_setting('sgb.grw_tier', true), '');
BEGIN
  IF NEW.rule_code <> 'REFERRAL_TIER' THEN RETURN NEW; END IF;
  IF v_ctx = '' OR split_part(v_ctx, '|', 2) <> NEW.account_id::text OR NEW.redeemable THEN
    RAISE EXCEPTION 'GRW_TIER: 여러 단계 추천 보상 줄은 정해진 함수 안에서만 · 현금화 안 됨으로만 넣을 수 있습니다.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_grw_tier_guard ON public.point_ledger;
CREATE TRIGGER trg_grw_tier_guard BEFORE INSERT ON public.point_ledger
  FOR EACH ROW EXECUTE FUNCTION public.fn_grw_tier_guard();

-- ③ 직접 보상 뒤 따라 붙는 여러 단계 보상 ------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_grw_tier_reward() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_invitee uuid; v_pts text; v_arr text[]; v_cur uuid; v_next uuid; v_lv int; v_p int; v_cap int; v_month int; v_seen uuid[];
BEGIN
  IF coalesce((SELECT value FROM site_settings WHERE key = 'grw.tier_reward'), 'off') <> 'on'
     OR coalesce((SELECT value FROM site_settings WHERE key = 'grw.tier_legal_ok'), 'off') <> 'on' THEN
    RETURN NULL;
  END IF;
  IF NEW.memo IS NULL OR NEW.memo !~ '^invitee [0-9a-f-]{36}$' THEN RETURN NULL; END IF;
  v_invitee := substr(NEW.memo, 9)::uuid;
  v_pts := coalesce((SELECT value FROM site_settings WHERE key = 'grw.tier_points'), '');
  IF v_pts !~ '^[1-9][0-9]{0,4}(,[1-9][0-9]{0,4}){0,2}$' THEN RETURN NULL; END IF;
  v_arr := string_to_array(v_pts, ',');
  SELECT monthly_cap INTO v_cap FROM point_rules WHERE code = 'REFERRAL_TIER';
  v_cur := NEW.account_id;                       -- 직접 추천한 사람(1단계 · 이미 받음)
  v_seen := ARRAY[v_invitee, NEW.account_id];
  FOR v_lv IN 2 .. (1 + array_length(v_arr, 1)) LOOP
    v_next := NULL;
    SELECT inviter_id INTO v_next FROM introducer_referrals WHERE invitee_id = v_cur;
    EXIT WHEN v_next IS NULL OR v_next = ANY(v_seen);
    v_seen := v_seen || v_next;
    v_cur := v_next;
    v_p := v_arr[v_lv - 1]::int;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM accounts WHERE id = v_next AND status = 'ACTIVE' AND withdrawn_at IS NULL);
    CONTINUE WHEN EXISTS (SELECT 1 FROM grw_tier_rewards WHERE invitee_id = v_invitee AND level = v_lv);
    IF v_cap IS NOT NULL THEN
      SELECT count(*) INTO v_month FROM grw_tier_rewards
       WHERE beneficiary_id = v_next AND created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul';
      CONTINUE WHEN v_month >= v_cap;
    END IF;
    PERFORM set_config('sgb.grw_tier', v_invitee::text || '|' || v_next::text, true);
    INSERT INTO point_ledger (account_id, rule_code, points, redeemable, memo)
    VALUES (v_next, 'REFERRAL_TIER', v_p, false, 'invitee ' || v_invitee::text || ' level ' || v_lv::text);
    PERFORM set_config('sgb.grw_tier', '', true);
    INSERT INTO grw_tier_rewards (invitee_id, beneficiary_id, level, points, direct_ledger_id)
    VALUES (v_invitee, v_next, v_lv, v_p, NEW.id);
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_grw_tier_reward ON public.point_ledger;
CREATE TRIGGER trg_grw_tier_reward AFTER INSERT ON public.point_ledger
  FOR EACH ROW WHEN (NEW.rule_code = 'REFERRAL_DIRECT') EXECUTE FUNCTION public.fn_grw_tier_reward();

-- ⑤ 설정 ---------------------------------------------------------------------
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('grw.tier_reward', 'off', 'ADMIN', '여러 단계 추천 보상(v10.600 · docs/742) — on 이고 grw.tier_legal_ok 도 on 일 때만 직접 추천 보상 뒤 2 ~ 4단계 추천인에게 점수(현금화 안 됨) · 처음 off · **법무 확인 필요(방문판매법 다단계판매 해당 여부)** · 켜기 SUPER', false, '^(on|off)$', 'off'),
  ('grw.tier_legal_ok', 'off', 'ADMIN', '여러 단계 추천 보상 법무 확인 끝(v10.600) — 확인한 곳 · 날짜를 사유에 적고 SUPER 가 on · off 면 보상도 함께 꺼짐', false, '^(on|off)$', 'off'),
  ('grw.tier_points', '300', 'ADMIN', '여러 단계 추천 보상 점수(v10.600) — 2단계부터 쉼표로 최대 3개(2 · 3 · 4단계 · 1 ~ 99999) · 처음 300(2단계만 · 일반 초안 · SUPER 가 정함)', false, '^[1-9][0-9]{0,4}(,[1-9][0-9]{0,4}){0,2}$', '300,100')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/grw/tier', 'grw-ops', 'VIEW')
ON CONFLICT (method, pattern, task_key) DO NOTHING;
/* =====================================================================
 * v10.601 (docs/743) ⑰ 매물 충실도 점수 · 등록 도우미 — 16차 회원 · 성장(grw_)
 *   표 · 칸 없음 — 점수는 볼 때마다 서버가 셈(src/modules/grw/fill.ts) · DB 에 적지 않음
 *   ★ 노출 순위 · 검색 순서 · 소개비 · 배지 · 검수 판정에 쓰지 않음(listings 칸 · 뷰 · 정렬 함수 고치지 않음)
 *   ① 설정 grw.fill_helper(on — 본인 매물 고칠 곳 안내만 · 새로 모으는 정보 없음) · ② ㉕ 권한 주소 한 줄
 *   재실행 안전. 표 · 자료를 지우는 문장 없음.
 * ===================================================================== */

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('grw.fill_helper', 'on', 'ADMIN', '매물 충실도 안내(v10.601 · docs/743) — on 이면 내 매물 · 매물 고치기 화면에 충실도 점수와 더 적으면 좋은 칸(본인 매물만 · 표시만이라 처음 on) · 노출 순위 · 소개비에 쓰지 않음 · 끄기 SUPER', false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/grw/fill', 'grw-ops', 'VIEW')
ON CONFLICT (method, pattern, task_key) DO NOTHING;
