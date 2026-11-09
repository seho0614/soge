-- =====================================================================
-- D189 — 회원 추천인 · 추천 관계도 (v10.218 · 2026-11-09)
--
--   대표 「회원가입 때 추천인 입력 · 파트너(제휴) 페이지에서 관계도(트리)」 → 보상 「직접 추천 1단계만」 · 트리는 운영자 전체 ·
--   파트너도 자기 아래 전체 · 입력은 추천 코드 · 변경은 가입 때만(그 뒤 운영자 · 사유) · 코드는 모든 회원 · 보상은 가입자 본인인증 뒤(11/9 「승인」).
--
--   ① accounts.recommend_code — 회원마다 6자 추천 코드(헷갈리는 0 · O · 1 · I 뺌 · 겹치지 않음 · 한 번 정하면 바뀌지 않음).
--      새 회원은 DB 가 만들고, 있는 회원은 이 마이그레이션이 채움.
--   ② introducer_referrals(B040 · 초대 관계 · 한 사람에 한 번)를 추천 관계로 씀 — **칸을 더하지 않음**(단계 · 부모 칸 없음 · 시험 N-12).
--      순환 막기를 맞추천(A↔B)에서 고리 전체(A→B→C→A)로 넓힘 · 운영자가 고칠 때(UPDATE)도 · 가입한 사람(invitee)은 못 바꿈.
--   ③ recommend_changes — 운영자가 추천인을 고치거나 지운 기록(전 → 후 · 사유 · 누가). 고치거나 지울 수 없음.
--   ④ 보상 REFERRAL_DIRECT — 가입한 사람이 처음 본인인증을 마치면 **그 사람을 직접 추천한 한 사람에게만 · 한 번**.
--      규칙은 꺼진 채(is_active false · 점수 1000 은 임시 — 운영 화면에서 SUPER 가 정함) · 꺼져 있을 때 인증한 사람은 나중에 켜도 주지 않음.
--      point_ledger 에 REFERRAL_DIRECT 줄은 fn_referral_reward 로만 들어감(직접 추천 · 아직 안 받음을 DB 가 확인) — 여러 단계 보상 길이 없음.
--   재실행 안전. 표 · 자료를 지우는 문장 없음.
-- =====================================================================

-- ① 추천 코드 -----------------------------------------------------------
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS recommend_code text;

CREATE OR REPLACE FUNCTION public.fn_recommend_code_new() RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  abc constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- 0 · O · 1 · I 뺀 32자
  c text; i int; n int := 0;
BEGIN
  LOOP
    c := '';
    FOR i IN 1..6 LOOP
      c := c || substr(abc, 1 + floor(random() * 32)::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM accounts WHERE recommend_code = c);
    n := n + 1;
    IF n > 50 THEN RAISE EXCEPTION 'RECOMMEND: 추천 코드를 만들지 못했습니다.'; END IF;
  END LOOP;
  RETURN c;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM accounts WHERE recommend_code IS NULL LOOP
    UPDATE accounts SET recommend_code = fn_recommend_code_new() WHERE id = r.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_accounts_recommend_code ON public.accounts (recommend_code);
ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS ck_accounts_recommend_code;
ALTER TABLE public.accounts ADD CONSTRAINT ck_accounts_recommend_code
  CHECK (recommend_code IS NULL OR recommend_code ~ '^[A-HJ-NP-Z2-9]{6}$');
COMMENT ON COLUMN public.accounts.recommend_code IS
  '추천 코드(D189) — 6자 · 0 · O · 1 · I 없음 · 겹치지 않음 · 가입 때 DB 가 만들고 바뀌지 않음. 가입 화면 「추천 코드」 · 링크 ?rc=';

CREATE OR REPLACE FUNCTION public.fn_recommend_code_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.recommend_code IS NULL THEN NEW.recommend_code := fn_recommend_code_new(); END IF;
  ELSIF OLD.recommend_code IS NOT NULL AND NEW.recommend_code IS DISTINCT FROM OLD.recommend_code THEN
    RAISE EXCEPTION 'RECOMMEND: 추천 코드는 바꿀 수 없습니다.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_recommend_code ON public.accounts;
CREATE TRIGGER trg_recommend_code BEFORE INSERT OR UPDATE OF recommend_code ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.fn_recommend_code_guard();

-- ② 추천 관계(introducer_referrals) — 고리 막기 · 가입한 사람 못 바꿈 ------------
CREATE INDEX IF NOT EXISTS ix_introducer_referrals_inviter ON public.introducer_referrals (inviter_id, created_at);

CREATE OR REPLACE FUNCTION public.fn_referral_no_chain() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_hit boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.invitee_id IS DISTINCT FROM OLD.invitee_id THEN
    RAISE EXCEPTION 'INV-1: 추천 관계의 가입한 사람은 바꿀 수 없습니다';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.rewarded_at IS NOT NULL AND NEW.inviter_id IS DISTINCT FROM OLD.inviter_id THEN
    RAISE EXCEPTION 'INV-1: 보상을 준 추천 관계는 추천인을 바꿀 수 없습니다';
  END IF;
  -- 순환 초대 차단(D189 — 맞추천뿐 아니라 고리 전체): 새 추천인의 위로 올라가다 가입한 사람이 나오면 막음
  WITH RECURSIVE up(id, n) AS (
    SELECT NEW.inviter_id, 1
    UNION ALL
    SELECT r.inviter_id, up.n + 1 FROM introducer_referrals r JOIN up ON r.invitee_id = up.id
     WHERE up.n < 1000 AND r.id IS DISTINCT FROM NEW.id
  )
  SELECT EXISTS (SELECT 1 FROM up WHERE id = NEW.invitee_id) INTO v_hit;
  IF v_hit THEN
    RAISE EXCEPTION 'INV-1: 서로 초대하는 관계는 만들 수 없습니다';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_referral_no_chain_upd ON public.introducer_referrals;
CREATE TRIGGER trg_referral_no_chain_upd BEFORE UPDATE ON public.introducer_referrals
  FOR EACH ROW EXECUTE FUNCTION public.fn_referral_no_chain();
COMMENT ON TABLE public.introducer_referrals IS
  '초대 · 추천 관계(D189 — 가입 때 추천 코드). invitee 가 UNIQUE 이므로 한 사람은 한 번만 추천받습니다. 하위의 하위를 표현할 열이 없습니다 — 보상은 직접 추천 1단계만(fn_referral_reward) · 고리는 DB 가 막음.';

-- ③ 운영자 변경 기록 ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recommend_changes (
  id           bigserial PRIMARY KEY,
  invitee_id   uuid NOT NULL REFERENCES public.accounts(id),
  old_inviter  uuid REFERENCES public.accounts(id),
  new_inviter  uuid REFERENCES public.accounts(id),
  reason       text NOT NULL CHECK (length(btrim(reason)) BETWEEN 2 AND 300),
  changed_by   uuid,
  changed_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_recommend_changes_diff CHECK (old_inviter IS DISTINCT FROM new_inviter)
);
CREATE INDEX IF NOT EXISTS ix_recommend_changes_invitee ON public.recommend_changes (invitee_id, changed_at DESC);
COMMENT ON TABLE public.recommend_changes IS
  '추천인 변경 기록(D189) — 운영자가 추천인을 고치거나 지운 것 · 전 → 후 · 사유 · 누가. 고치거나 지울 수 없음';

CREATE OR REPLACE FUNCTION public.fn_recommend_changes_ro() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'RECOMMEND: 추천인 변경 기록은 고치거나 지울 수 없습니다.';
END $$;
DROP TRIGGER IF EXISTS trg_recommend_changes_ro ON public.recommend_changes;
CREATE TRIGGER trg_recommend_changes_ro BEFORE UPDATE OR DELETE ON public.recommend_changes
  FOR EACH ROW EXECUTE FUNCTION public.fn_recommend_changes_ro();

-- ④ 보상 — 직접 추천 1단계만 · 가입한 사람 첫 본인인증 때 한 번 ---------------------
INSERT INTO public.point_rules (code, name, points, needs_valid, monthly_cap, is_active, sort_order)
VALUES ('REFERRAL_DIRECT', '내가 추천한 분의 본인인증 완료(직접 추천만 · 한 사람에 한 번)', 1000, true, NULL, false, 9)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_referral_reward(p_invitee uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_rule point_rules%ROWTYPE; v_ref introducer_referrals%ROWTYPE; v_month int;
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
  PERFORM set_config('sgb.referral_reward', p_invitee::text, true);
  INSERT INTO point_ledger (account_id, rule_code, points, redeemable, memo)
  VALUES (v_ref.inviter_id, 'REFERRAL_DIRECT', v_rule.points, false, 'invitee ' || p_invitee::text);
  PERFORM set_config('sgb.referral_reward', '', true);
  UPDATE introducer_referrals SET rewarded_at = now() WHERE id = v_ref.id;
  RETURN true;
END $$;

-- point_ledger 의 REFERRAL_DIRECT 줄은 fn_referral_reward 로만(직접 추천한 사람 · 아직 안 받은 관계)
CREATE OR REPLACE FUNCTION public.fn_referral_reward_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_inv text := coalesce(current_setting('sgb.referral_reward', true), '');
BEGIN
  IF NEW.rule_code <> 'REFERRAL_DIRECT' THEN RETURN NEW; END IF;
  IF v_inv = '' OR NOT EXISTS (
       SELECT 1 FROM introducer_referrals
        WHERE invitee_id = v_inv::uuid AND inviter_id = NEW.account_id AND rewarded_at IS NULL) THEN
    RAISE EXCEPTION 'RECOMMEND: 추천 보상은 직접 추천한 한 사람에게 한 번만 줄 수 있습니다.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_referral_reward_guard ON public.point_ledger;
CREATE TRIGGER trg_referral_reward_guard BEFORE INSERT ON public.point_ledger
  FOR EACH ROW EXECUTE FUNCTION public.fn_referral_reward_guard();

CREATE OR REPLACE FUNCTION public.fn_referral_on_verify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.identity_verified_at IS NULL AND NEW.identity_verified_at IS NOT NULL THEN
    PERFORM fn_referral_reward(NEW.id);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_referral_on_verify ON public.accounts;
CREATE TRIGGER trg_referral_on_verify AFTER UPDATE OF identity_verified_at ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.fn_referral_on_verify();
