/* D277 (v10.517 ~ 520 · docs/655 ~ 658) ㊼ 회원 · 광고 — 메인 팝업 공지 · 기간 한정 추천 이벤트(시행 전 확인 뒤 시작 · off) · 광고 성과 보고서(매일 · 매주 · 매달) · 광고 소재 비교 시험 */

-- =====================================================================
-- D277 — ㊼ 회원 · 광고 (v10.517 ~ 520 · 2026-11-20 · 마이그레이션 #315 · D277_popup_referral_event_ad_report_ab)
--
--   ① v10.517 메인 팝업 공지 — prx_popups(기간 · 대상 GUEST · MEMBER · PARTNER · 순서 · 켜짐) · fn_prx_popup_audience(보는 사람 대상)
--      「오늘 하루 안 보기」는 브라우저에만(서버 기록 없음 · 메인 공지 띠 v10.326 과 같은 방식)
--   ② v10.518 기간 한정 추천 이벤트 — prx_ref_events · prx_ref_event_uses(쌓기만)
--      직접 추천 1단계 보상(REFERRAL_DIRECT · D189 · D190)의 **점수만** 기간 동안 바꿈 · 예산 상한 · 끝나면 원래 점수(규칙 표는 고치지 않음)
--      대표 11/20 「관리자가 이벤트 시행 전 확인 후 등록」 — 시행 전 확인(약관 · 안내 문구 둘 다 예 · 확인한 곳 · 날짜) 없이는 DB 가 ACTIVE 를 막음
--      fn_referral_reward 를 D190 그대로 다시 쓰고 점수 고르는 몇 줄만 더함(1단계 · 한 사람 한 번 · 한 달 상한 · 가드 트리거 그대로)
--   ③ v10.519 광고 성과 보고서 — prx_ad_owner(소재 → 광고주 · 없으면 이름 같음) · prx_ad_reports(광고주 · 기간 열쇠 하루 · 주 · 달 · 숫자만)
--      새 추적 없음 — ad_events(노출 · 클릭) · ad_invoices(청구) 를 읽기만 · 회원 정보 칸 없음
--   ④ v10.520 광고 소재 비교 시험 — prx_ab_tests · fn_prx_ab_hidden · fn_prx_ab_pick(번갈아)
--      두 소재 모두 기존 ad_placements 줄 · 기록은 기존 ad_events 그대로(소재마다) · ad_slots(인피드 표기 · 순위 제외) 고치지 않음
--   ⑤ 설정 prx.* · 정기 작업 prx_hourly · prx_ad_report · ㉕ 권한 시드(탭 4)
--   재실행 안전. 표 · 자료를 지우는 문장 없음. RAISE 글자에 퍼센트 기호 없음.
-- =====================================================================

-- ① 메인 팝업 공지 -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prx_popups (
  id          bigserial PRIMARY KEY,
  title       text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 80),
  body        text NOT NULL DEFAULT '' CHECK (length(body) <= 1000),
  link_url    text CHECK (link_url IS NULL OR link_url ~ '^(/[A-Za-z0-9/_?=&#.-]{0,300}|https://[A-Za-z0-9.-]{3,100}(/[A-Za-z0-9/_?=&#.%-]{0,300})?)$'),
  link_label  text CHECK (link_label IS NULL OR length(btrim(link_label)) BETWEEN 1 AND 20),
  audience    text[] NOT NULL DEFAULT ARRAY['GUEST', 'MEMBER']::text[],
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  priority    int NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 999),
  is_on       boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES public.accounts(id),
  updated_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_prx_popups_period CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '366 days'),
  CONSTRAINT ck_prx_popups_audience CHECK (cardinality(audience) >= 1 AND audience <@ ARRAY['GUEST', 'MEMBER', 'PARTNER']::text[])
);
CREATE INDEX IF NOT EXISTS ix_prx_popups_live ON public.prx_popups (is_on, starts_at, ends_at);
COMMENT ON TABLE public.prx_popups IS
  'v10.517 (D277) 메인 팝업 공지 — 기간 · 대상(GUEST 로그인 안 함 · MEMBER 로그인 회원 · PARTNER 안심 · 제휴 파트너) · 순서(priority 작은 것 먼저) · 켜짐. 「오늘 하루 안 보기」는 브라우저 localStorage 에만(서버 · 회원 기록 없음)';

-- 보는 사람의 대상 — 공지 등급(fn_notice_grades · D210)으로 한 곳에서 판단
CREATE OR REPLACE FUNCTION public.fn_prx_popup_audience(p_account uuid) RETURNS text[]
    LANGUAGE sql STABLE
    AS $$
  SELECT CASE WHEN NOT ('MEMBER' = ANY (g)) THEN ARRAY['GUEST']::text[]
              ELSE ARRAY['MEMBER']::text[] || CASE WHEN g && ARRAY['MAL_PARTNER', 'AFF_PARTNER']::text[] THEN ARRAY['PARTNER']::text[] ELSE ARRAY[]::text[] END
         END
    FROM (SELECT public.fn_notice_grades(p_account) AS g) x
$$;

-- ② 기간 한정 추천 이벤트 ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prx_ref_events (
  id            bigserial PRIMARY KEY,
  title         text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 80),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  points        int NOT NULL CHECK (points BETWEEN 1 AND 100000),
  budget        int NOT NULL CHECK (budget BETWEEN 1 AND 100000000),
  used          int NOT NULL DEFAULT 0,
  state         text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'ACTIVE', 'ENDED', 'CANCELED')),
  end_reason    text CHECK (end_reason IS NULL OR end_reason IN ('PERIOD', 'BUDGET', 'MANUAL', 'CANCELED')),
  notice_text   text NOT NULL CHECK (length(btrim(notice_text)) BETWEEN 20 AND 2000),
  -- 시행 전 확인(대표 11/20) — 둘 다 「예」 · 확인한 곳 · 날짜가 있어야 ACTIVE
  check_terms   boolean NOT NULL DEFAULT false,
  check_notice  boolean NOT NULL DEFAULT false,
  check_by      text CHECK (check_by IS NULL OR length(btrim(check_by)) BETWEEN 2 AND 60),
  check_on      date,
  check_memo    text CHECK (check_memo IS NULL OR length(check_memo) <= 500),
  checked_by    uuid REFERENCES public.accounts(id),
  checked_at    timestamptz,
  created_by    uuid REFERENCES public.accounts(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_by    uuid REFERENCES public.accounts(id),
  started_at    timestamptz,
  ended_by      uuid REFERENCES public.accounts(id),
  ended_at      timestamptz,
  CONSTRAINT ck_prx_ref_events_period CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '92 days'),
  CONSTRAINT ck_prx_ref_events_used CHECK (used >= 0 AND used <= budget),
  CONSTRAINT ck_prx_ref_events_checked CHECK (
    state NOT IN ('ACTIVE', 'ENDED') OR
    (check_terms AND check_notice AND check_by IS NOT NULL AND check_on IS NOT NULL AND started_at IS NOT NULL))
);
-- 한 번에 하나만 진행
CREATE UNIQUE INDEX IF NOT EXISTS ux_prx_ref_events_one_active ON public.prx_ref_events ((true)) WHERE state = 'ACTIVE';
COMMENT ON TABLE public.prx_ref_events IS
  'v10.518 (D277) 기간 한정 추천 이벤트 — 직접 추천 1단계 보상(REFERRAL_DIRECT) 점수만 기간 동안 바꿈 · 예산(points 합) 상한 · 끝나면 규칙 점수 그대로. 시행 전 확인(약관 · 안내 문구 둘 다 예 · 확인한 곳 · 날짜) 없이는 ACTIVE 불가(CHECK + 트리거). 한 번에 하나만';

CREATE OR REPLACE FUNCTION public.fn_prx_ref_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'DRAFT' THEN RAISE EXCEPTION 'PRX_EVENT: 시작한 추천 이벤트는 지울 수 없습니다.'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'DRAFT' OR NEW.used <> 0 THEN RAISE EXCEPTION 'PRX_EVENT: 추천 이벤트는 초안으로만 만듭니다.'; END IF;
    RETURN NEW;
  END IF;
  -- 상태 차례: DRAFT → ACTIVE · CANCELED / ACTIVE → ENDED / 끝난 것은 그대로
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'DRAFT' AND NEW.state IN ('ACTIVE', 'CANCELED')) OR (OLD.state = 'ACTIVE' AND NEW.state = 'ENDED')) THEN
    RAISE EXCEPTION 'PRX_EVENT: 추천 이벤트 상태를 이 차례로 바꿀 수 없습니다.';
  END IF;
  IF NEW.state = 'ACTIVE' AND OLD.state = 'DRAFT' THEN
    IF NOT (NEW.check_terms AND NEW.check_notice) OR NEW.check_by IS NULL OR NEW.check_on IS NULL THEN
      RAISE EXCEPTION 'PRX_EVENT_CHECK: 시행 전 확인(약관 · 안내 문구 모두 예 · 확인한 곳 · 날짜)이 없어 시작할 수 없습니다.';
    END IF;
    IF NEW.ends_at <= now() THEN RAISE EXCEPTION 'PRX_EVENT: 끝 시각이 이미 지났습니다.'; END IF;
  END IF;
  -- 시작한 뒤에는 기간 · 점수 · 예산 · 안내 문구 · 확인 칸을 고치지 않음(쓴 점수 · 끝 표시만)
  IF OLD.state <> 'DRAFT' AND (NEW.title, NEW.starts_at, NEW.ends_at, NEW.points, NEW.budget, NEW.notice_text, NEW.check_terms, NEW.check_notice, NEW.check_by, NEW.check_on, NEW.check_memo)
       IS DISTINCT FROM (OLD.title, OLD.starts_at, OLD.ends_at, OLD.points, OLD.budget, OLD.notice_text, OLD.check_terms, OLD.check_notice, OLD.check_by, OLD.check_on, OLD.check_memo) THEN
    RAISE EXCEPTION 'PRX_EVENT: 시작한 추천 이벤트의 기간 · 점수 · 예산 · 안내 문구 · 확인 칸은 고칠 수 없습니다.';
  END IF;
  IF OLD.state IN ('ENDED', 'CANCELED') AND NEW.used IS DISTINCT FROM OLD.used THEN
    RAISE EXCEPTION 'PRX_EVENT: 끝난 추천 이벤트의 쓴 점수는 바꿀 수 없습니다.';
  END IF;
  IF NEW.used < OLD.used THEN RAISE EXCEPTION 'PRX_EVENT: 쓴 점수는 줄일 수 없습니다.'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_prx_ref_event_guard ON public.prx_ref_events;
CREATE TRIGGER trg_prx_ref_event_guard BEFORE INSERT OR UPDATE OR DELETE ON public.prx_ref_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_prx_ref_event_guard();

CREATE TABLE IF NOT EXISTS public.prx_ref_event_uses (
  id           bigserial PRIMARY KEY,
  event_id     bigint NOT NULL REFERENCES public.prx_ref_events(id),
  invitee_id   uuid NOT NULL UNIQUE REFERENCES public.accounts(id),
  inviter_id   uuid NOT NULL REFERENCES public.accounts(id),
  points       int NOT NULL CHECK (points > 0),
  base_points  int NOT NULL CHECK (base_points > 0),
  used_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_prx_ref_event_uses_event ON public.prx_ref_event_uses (event_id, used_at);
COMMENT ON TABLE public.prx_ref_event_uses IS
  'v10.518 (D277) 이벤트 점수로 준 추천 보상 한 줄(가입한 사람 한 명에 한 번 · 직접 추천한 사람 · 이벤트 점수 · 그때 규칙 점수) — 고치거나 지울 수 없음';

CREATE OR REPLACE FUNCTION public.fn_prx_ref_event_uses_ro() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'PRX_EVENT: 이벤트 보상 기록은 고치거나 지울 수 없습니다.';
END $$;
DROP TRIGGER IF EXISTS trg_prx_ref_event_uses_ro ON public.prx_ref_event_uses;
CREATE TRIGGER trg_prx_ref_event_uses_ro BEFORE UPDATE OR DELETE ON public.prx_ref_event_uses
  FOR EACH ROW EXECUTE FUNCTION public.fn_prx_ref_event_uses_ro();

-- fn_referral_reward — D190 판 그대로 + 이벤트 점수(진행 중 · 스위치 on · 예산 안)
--   예산이 이 한 건을 못 덮으면 규칙 점수로 주고 이벤트를 일찍 끝냄(BUDGET). 직접 추천한 한 사람 · 한 번 · 한 달 상한 · 가드는 그대로.
CREATE OR REPLACE FUNCTION public.fn_referral_reward(p_invitee uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_rule point_rules%ROWTYPE; v_ref introducer_referrals%ROWTYPE; v_month int;
        v_ev prx_ref_events%ROWTYPE; v_points int; v_use boolean := false;
BEGIN
  SELECT * INTO v_rule FROM point_rules WHERE code = 'REFERRAL_DIRECT';
  IF NOT FOUND OR NOT v_rule.is_active THEN RETURN false; END IF;
  SELECT * INTO v_ref FROM introducer_referrals WHERE invitee_id = p_invitee AND rewarded_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_rule.monthly_cap IS NOT NULL THEN
    SELECT count(*) INTO v_month FROM point_ledger
     WHERE account_id = v_ref.inviter_id AND rule_code = 'REFERRAL_DIRECT'
       AND earned_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul';
    IF v_month >= v_rule.monthly_cap THEN RETURN false; END IF;
  END IF;
  v_points := v_rule.points;
  /* v10.518 (D277) 기간 한정 추천 이벤트 — 점수만 바꿈 */
  IF coalesce((SELECT value FROM site_settings WHERE key = 'prx.ref_event'), 'off') = 'on' THEN
    SELECT * INTO v_ev FROM prx_ref_events
     WHERE state = 'ACTIVE' AND starts_at <= now() AND ends_at > now() FOR UPDATE;
    IF FOUND THEN
      IF v_ev.used + v_ev.points <= v_ev.budget THEN
        v_points := v_ev.points; v_use := true;
      ELSE
        UPDATE prx_ref_events SET state = 'ENDED', end_reason = 'BUDGET', ended_at = now() WHERE id = v_ev.id;
      END IF;
    END IF;
  END IF;
  PERFORM set_config('sgb.referral_reward', p_invitee::text, true);
  /* D190 — 현금화 가능(redeemable true) · 전에는 false */
  INSERT INTO point_ledger (account_id, rule_code, points, redeemable, memo)
  VALUES (v_ref.inviter_id, 'REFERRAL_DIRECT', v_points, true, 'invitee ' || p_invitee::text);
  PERFORM set_config('sgb.referral_reward', '', true);
  UPDATE introducer_referrals SET rewarded_at = now() WHERE id = v_ref.id;
  IF v_use THEN
    INSERT INTO prx_ref_event_uses (event_id, invitee_id, inviter_id, points, base_points)
    VALUES (v_ev.id, p_invitee, v_ref.inviter_id, v_points, v_rule.points);
    UPDATE prx_ref_events SET used = used + v_points WHERE id = v_ev.id;
    IF v_ev.used + v_points + v_ev.points > v_ev.budget THEN
      UPDATE prx_ref_events SET state = 'ENDED', end_reason = 'BUDGET', ended_at = now() WHERE id = v_ev.id;
    END IF;
  END IF;
  RETURN true;
END $$;

-- ③ 광고 성과 보고서 -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prx_ad_owner (
  creative_id    uuid PRIMARY KEY REFERENCES public.ad_placements(id),
  advertiser_id  uuid NOT NULL REFERENCES public.advertisers(id),
  set_by         uuid REFERENCES public.accounts(id),
  set_at         timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.prx_ad_owner IS
  'v10.519 (D277) 광고 소재(ad_placements) → 광고주(advertisers) 잇기 — 없으면 소재의 광고주 이름 = 광고주 이름(대소문자 · 앞뒤 빈칸 무시)으로 봄';

CREATE TABLE IF NOT EXISTS public.prx_ad_reports (
  id             bigserial PRIMARY KEY,
  advertiser_id  uuid NOT NULL REFERENCES public.advertisers(id),
  -- 기간 열쇠(대표 11/20 보내는 주기) — DAILY '2026-11-19' · WEEKLY 'W2026-11-16'(그 주 월요일) · MONTHLY '2026-10'
  cycle          text NOT NULL CHECK (cycle IN ('DAILY', 'WEEKLY', 'MONTHLY')),
  period_key     text NOT NULL CHECK (period_key ~ '^(W?20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])|20[0-9]{2}-(0[1-9]|1[0-2]))$'),
  period_from    date NOT NULL,
  period_to      date NOT NULL,
  impressions    bigint NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  clicks         bigint NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  cost           bigint NOT NULL DEFAULT 0 CHECK (cost >= 0),
  cost_total     bigint NOT NULL DEFAULT 0 CHECK (cost_total >= 0),
  lines          jsonb NOT NULL DEFAULT '[]'::jsonb,
  made_at        timestamptz NOT NULL DEFAULT now(),
  made_by        uuid REFERENCES public.accounts(id),
  mail_state     text CHECK (mail_state IS NULL OR mail_state IN ('SENT', 'FAILED', 'NOT_READY', 'NO_ADDRESS', 'OFF')),
  mailed_at      timestamptz,
  to_masked      text CHECK (to_masked IS NULL OR length(to_masked) <= 80),
  CONSTRAINT uq_prx_ad_reports UNIQUE (advertiser_id, period_key),
  -- CASE 로 차례를 못 박음(다른 주기 열쇠를 날짜로 바꾸다 오류 나지 않게)
  CONSTRAINT ck_prx_ad_reports_period CHECK (CASE
    WHEN cycle = 'DAILY' THEN CASE WHEN period_key ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' THEN period_from = period_key::date AND period_to = period_from ELSE false END
    WHEN cycle = 'WEEKLY' THEN CASE WHEN period_key ~ '^W20[0-9]{2}-[0-9]{2}-[0-9]{2}$' THEN period_from = substr(period_key, 2)::date AND extract(isodow FROM period_from) = 1 AND period_to = period_from + 6 ELSE false END
    ELSE CASE WHEN period_key ~ '^20[0-9]{2}-[0-9]{2}$' THEN period_from = (period_key || '-01')::date AND period_to = (period_from + interval '1 month')::date - 1 ELSE false END
  END)
);
COMMENT ON TABLE public.prx_ad_reports IS
  'v10.519 (D277) 광고주 성과 보고서 — 기간(하루 · 주 · 달 · 열쇠 period_key 로 광고주마다 한 줄 = 같은 기간 두 번 안 보냄) · 노출 · 클릭(ad_events · 한국 시각) · 비용(그 기간에 걸친 청구를 날수로 나눔 · 공급가 cost · 부가세 포함 cost_total) · 소재별 줄(lines). 숫자만 · 회원 정보 없음. 보낸 메일 주소는 가린 값만';

CREATE OR REPLACE FUNCTION public.fn_prx_ad_report_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PRX_AD_REPORT: 광고 성과 보고서는 지울 수 없습니다.'; END IF;
  IF OLD.mail_state = 'SENT' AND (NEW.impressions, NEW.clicks, NEW.cost, NEW.cost_total, NEW.lines, NEW.advertiser_id, NEW.cycle, NEW.period_key, NEW.period_from, NEW.period_to)
       IS DISTINCT FROM (OLD.impressions, OLD.clicks, OLD.cost, OLD.cost_total, OLD.lines, OLD.advertiser_id, OLD.cycle, OLD.period_key, OLD.period_from, OLD.period_to) THEN
    RAISE EXCEPTION 'PRX_AD_REPORT: 메일로 보낸 보고서는 숫자를 다시 만들 수 없습니다.';
  END IF;
  -- 같은 기간 두 번 안 보냄 — 보낸 표시는 되돌릴 수 없음
  IF OLD.mail_state = 'SENT' AND NEW.mail_state IS DISTINCT FROM 'SENT' THEN
    RAISE EXCEPTION 'PRX_AD_REPORT: 보낸 보고서의 보낸 표시는 되돌릴 수 없습니다.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_prx_ad_report_guard ON public.prx_ad_reports;
CREATE TRIGGER trg_prx_ad_report_guard BEFORE UPDATE OR DELETE ON public.prx_ad_reports
  FOR EACH ROW EXECUTE FUNCTION public.fn_prx_ad_report_guard();

-- ④ 광고 소재 비교 시험 --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prx_ab_tests (
  id            bigserial PRIMARY KEY,
  title         text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 80),
  creative_a    uuid NOT NULL REFERENCES public.ad_placements(id),
  creative_b    uuid NOT NULL REFERENCES public.ad_placements(id),
  slot_code     text NOT NULL REFERENCES public.ad_slots(code),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  state         text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'RUNNING', 'ENDED', 'CANCELED')),
  served        bigint NOT NULL DEFAULT 0 CHECK (served >= 0),
  result        jsonb,
  created_by    uuid REFERENCES public.accounts(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_by    uuid REFERENCES public.accounts(id),
  started_at    timestamptz,
  ended_at      timestamptz,
  CONSTRAINT ck_prx_ab_pair CHECK (creative_a <> creative_b),
  CONSTRAINT ck_prx_ab_period CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '92 days'),
  CONSTRAINT ck_prx_ab_result CHECK (state <> 'ENDED' OR result IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_prx_ab_running_a ON public.prx_ab_tests (creative_a) WHERE state = 'RUNNING';
CREATE INDEX IF NOT EXISTS ix_prx_ab_running_b ON public.prx_ab_tests (creative_b) WHERE state = 'RUNNING';
COMMENT ON TABLE public.prx_ab_tests IS
  'v10.520 (D277) 광고 소재 비교 시험 — 같은 슬롯 · 같은 광고주의 두 소재(A · B)를 진행 중 기간에 노출마다 번갈아(served 홀수 A · 짝수 B). 기록은 기존 ad_events(소재마다) · 결과(result)는 노출 · 클릭 · 클릭률 숫자만';

CREATE OR REPLACE FUNCTION public.fn_prx_ab_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'DRAFT' THEN RAISE EXCEPTION 'PRX_AB: 시작한 비교 시험은 지울 수 없습니다.'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.state <> 'DRAFT' THEN RAISE EXCEPTION 'PRX_AB: 비교 시험은 초안으로만 만듭니다.'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
         (OLD.state = 'DRAFT' AND NEW.state IN ('RUNNING', 'CANCELED')) OR (OLD.state = 'RUNNING' AND NEW.state IN ('ENDED', 'CANCELED'))) THEN
      RAISE EXCEPTION 'PRX_AB: 비교 시험 상태를 이 차례로 바꿀 수 없습니다.';
    END IF;
    IF OLD.state <> 'DRAFT' AND (NEW.creative_a, NEW.creative_b, NEW.slot_code, NEW.starts_at, NEW.ends_at)
         IS DISTINCT FROM (OLD.creative_a, OLD.creative_b, OLD.slot_code, OLD.starts_at, OLD.ends_at) THEN
      RAISE EXCEPTION 'PRX_AB: 시작한 비교 시험의 소재 · 기간은 고칠 수 없습니다.';
    END IF;
    IF OLD.state = 'ENDED' AND NEW.result IS DISTINCT FROM OLD.result THEN
      RAISE EXCEPTION 'PRX_AB: 끝난 비교 시험 결과는 고칠 수 없습니다.';
    END IF;
  END IF;
  -- 한 소재는 진행 중 시험 하나에만
  IF NEW.state = 'RUNNING' AND EXISTS (
       SELECT 1 FROM prx_ab_tests t WHERE t.state = 'RUNNING' AND t.id <> NEW.id
          AND (t.creative_a IN (NEW.creative_a, NEW.creative_b) OR t.creative_b IN (NEW.creative_a, NEW.creative_b))) THEN
    RAISE EXCEPTION 'PRX_AB_BUSY: 이 소재는 이미 다른 비교 시험이 진행 중입니다.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_prx_ab_guard ON public.prx_ab_tests;
CREATE TRIGGER trg_prx_ab_guard BEFORE INSERT OR UPDATE OR DELETE ON public.prx_ab_tests
  FOR EACH ROW EXECUTE FUNCTION public.fn_prx_ab_guard();

-- B 소재는 진행 중에는 뽑기 목록에서 빠짐(A 가 뽑히면 번갈아 고름 — 다른 소재보다 두 배 뽑히지 않게)
CREATE OR REPLACE FUNCTION public.fn_prx_ab_hidden(p_creative uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT EXISTS (SELECT 1 FROM prx_ab_tests t
                  WHERE t.state = 'RUNNING' AND t.creative_b = p_creative AND t.starts_at <= now() AND t.ends_at > now())
$$;

-- 뽑힌 소재가 진행 중 시험의 A 면 차례(served)를 하나 올리고 홀수 A · 짝수 B — 시험이 아니면 그대로
CREATE OR REPLACE FUNCTION public.fn_prx_ab_pick(p_creative uuid) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE v_id bigint; v_n bigint; v_a uuid; v_b uuid;
BEGIN
  SELECT id INTO v_id FROM prx_ab_tests
   WHERE state = 'RUNNING' AND (creative_a = p_creative OR creative_b = p_creative) AND starts_at <= now() AND ends_at > now()
   LIMIT 1;
  IF v_id IS NULL THEN RETURN p_creative; END IF;
  UPDATE prx_ab_tests SET served = served + 1 WHERE id = v_id RETURNING served, creative_a, creative_b INTO v_n, v_a, v_b;
  RETURN CASE WHEN v_n % 2 = 1 THEN v_a ELSE v_b END;
END $$;

-- ⑤ 설정 · 정기 작업 -------------------------------------------------------
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('prx.popup_max', '3', 'ADMIN', '메인 팝업 공지 한 번에 보이는 수(1 ~ 5 · 처음 3 · v10.517 · D277) — 순서가 앞선 것부터', false, '^[1-5]$', '3'),
  ('prx.ref_event', 'off', 'ADMIN', '기간 한정 추천 이벤트(v10.518 · D277) — 처음 off · on 이고 진행 중(ACTIVE) 이벤트가 있을 때만 직접 추천 보상 점수를 이벤트 점수로. 켜기 SUPER · 법무 확인 뒤', false, '^(on|off)$', 'off'),
  ('prx.ad_report_mail', 'off', 'ADMIN', '광고 성과 보고서 메일(v10.519 · D277 · 법무 확인 대표 11/20) — 처음 off · on 이면 매일 08:10 보내는 주기(prx.ad_report_cycle)의 지난 기간 보고서를 광고주 담당 메일로(메일 준비가 된 뒤) · 켜기 SUPER(운영 화면)', false, '^(on|off)$', 'off'),
  ('prx.ad_report_cycle', 'MONTHLY', 'ADMIN', '광고 성과 보고서 주기(v10.519 · D277 · 대표 11/20) — DAILY 매일 어제 하루분 · WEEKLY 월요일 지난주(월 ~ 일)분 · MONTHLY 1일 지난달분(처음) · 같은 기간은 두 번 안 보냄 · 바꾸기 SUPER', false, '^(DAILY|WEEKLY|MONTHLY)$', 'MONTHLY'),
  ('prx.ab_min_impr', '1000', 'ADMIN', '광고 소재 비교 시험 — 소재마다 이만큼 노출돼야 「이긴 소재」를 말함(1 ~ 9,999,999 · 처음 1000 · v10.520 · D277)', false, '^[1-9][0-9]{0,6}$', '1000')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('prx_hourly', 60, NULL, NULL, NULL, true, '추천 이벤트 기간 끝 · 비교 시험 기간 끝 정리(결과 고정) — 매시간 · D277 · v10.518 · 520'),
  ('prx_ad_report', 1440, 8, 10, NULL, true, '광고 성과 보고서 — 매일 08:10 · 주기(prx.ad_report_cycle)의 지난 기간(어제 · 지난주 · 지난달) 보고서가 없는 광고주만 만듦 · prx.ad_report_mail on 이면 안 보낸 것 메일 · D277 · v10.519')
ON CONFLICT (job) DO NOTHING;

/* ── ⑥ ㉕ 권한(D258) 시드 — gen_seed.py 와 같은 규칙
 *   prx-popup(노출 admdsp) · prx-refevent(제휴 affapl) · prx-adreport · prx-adab(광고 admad) — 모두 TAB_ROLES ADMIN · SUPER → R_ADMIN 4단계
 *   주소 규칙: GET = VIEW · /send · /run 끝 = APPROVE · 그 밖 변경 = EDIT (이벤트 시작은 /start 라 EDIT — 서버 @Roles 가 SUPER 만) */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('prx-popup', '메인 팝업', 'admdsp', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3150),
  ('prx-refevent', '추천 이벤트', 'affapl', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3160),
  ('prx-adreport', '광고 성과 보고서', 'admad', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3170),
  ('prx-adab', '광고 소재 비교', 'admad', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3180)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'prx-popup', 'VIEW'), ('R_ADMIN', 'prx-popup', 'EDIT'), ('R_ADMIN', 'prx-popup', 'APPROVE'), ('R_ADMIN', 'prx-popup', 'EXPORT'),
  ('R_ADMIN', 'prx-refevent', 'VIEW'), ('R_ADMIN', 'prx-refevent', 'EDIT'), ('R_ADMIN', 'prx-refevent', 'APPROVE'), ('R_ADMIN', 'prx-refevent', 'EXPORT'),
  ('R_ADMIN', 'prx-adreport', 'VIEW'), ('R_ADMIN', 'prx-adreport', 'EDIT'), ('R_ADMIN', 'prx-adreport', 'APPROVE'), ('R_ADMIN', 'prx-adreport', 'EXPORT'),
  ('R_ADMIN', 'prx-adab', 'VIEW'), ('R_ADMIN', 'prx-adab', 'EDIT'), ('R_ADMIN', 'prx-adab', 'APPROVE'), ('R_ADMIN', 'prx-adab', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/prx/popups', 'prx-popup', 'VIEW'),
  ('POST', '/admin/prx/popups', 'prx-popup', 'EDIT'),
  ('PUT', '/admin/prx/popups/{id}', 'prx-popup', 'EDIT'),
  ('POST', '/admin/prx/popups/{id}/toggle', 'prx-popup', 'EDIT'),
  ('GET', '/admin/prx/ref-events', 'prx-refevent', 'VIEW'),
  ('POST', '/admin/prx/ref-events', 'prx-refevent', 'EDIT'),
  ('PUT', '/admin/prx/ref-events/{id}', 'prx-refevent', 'EDIT'),
  ('PUT', '/admin/prx/ref-events/{id}/check', 'prx-refevent', 'EDIT'),
  ('POST', '/admin/prx/ref-events/{id}/start', 'prx-refevent', 'EDIT'),
  ('POST', '/admin/prx/ref-events/{id}/end', 'prx-refevent', 'EDIT'),
  ('PUT', '/admin/prx/ref-events/switch', 'prx-refevent', 'EDIT'),
  ('GET', '/admin/prx/ad-reports', 'prx-adreport', 'VIEW'),
  ('GET', '/admin/prx/ad-reports/{id}', 'prx-adreport', 'VIEW'),
  ('POST', '/admin/prx/ad-reports/make', 'prx-adreport', 'EDIT'),
  ('POST', '/admin/prx/ad-reports/{id}/send', 'prx-adreport', 'APPROVE'),
  ('PUT', '/admin/prx/ad-owners/{id}', 'prx-adreport', 'EDIT'),
  ('PUT', '/admin/prx/ad-reports/switch', 'prx-adreport', 'EDIT'),
  ('GET', '/admin/prx/ab-tests', 'prx-adab', 'VIEW'),
  ('GET', '/admin/prx/ab-tests/{id}', 'prx-adab', 'VIEW'),
  ('POST', '/admin/prx/ab-tests', 'prx-adab', 'EDIT'),
  ('POST', '/admin/prx/ab-tests/{id}/start', 'prx-adab', 'EDIT'),
  ('POST', '/admin/prx/ab-tests/{id}/end', 'prx-adab', 'EDIT'),
  ('POST', '/admin/prx/ab-tests/{id}/cancel', 'prx-adab', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

