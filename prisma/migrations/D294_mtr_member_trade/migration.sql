/* =====================================================================
 * 11차 회원 · 거래 (v10.573 ~ 576 · docs/715 ~ 718 · 대표 11/21 「16개 모두 동시에」) — 앞머리 mtr_
 *   ① v10.573 신고 → 이의 제기   mtr_appeals · fn_mtr_appeal_guard
 *   ② v10.574 가짜 후기 · 리뷰 탐지 mtr_review_flags(의심 목록만 · 자동 삭제 없음)
 *   ③ v10.575 소개자 신뢰 점수     mtr_trust_rules · mtr_trust_scores · fn_mtr_trust(운영 · 본인 화면만 — 노출 순위 · 소개비 계산에 쓰지 않음)
 *   ④ v10.576 회원 휴면 계정       accounts.status 'DORMANT' · mtr_dormant · pii.mtr_dormant_vault · fn_mtr_dormant_apply · fn_mtr_dormant_wake · fn_mtr_dormant_guard
 *   ⑤ 설정(스위치 모두 처음 off) · ⑥ 정기 작업 mtr_hourly · mtr_daily · ⑦ ㉕ 권한 시드
 *   다시 돌려도 같음(IF NOT EXISTS · CREATE OR REPLACE · ON CONFLICT DO NOTHING · DROP CONSTRAINT IF EXISTS)
 *   기존 함수(fn_report_guard · fn_report_escalate · fn_trust_score)는 고치지 않음
 * ===================================================================== */


/* ── ① v10.573 이의 제기 — 신고로 내려간 매물 · 소개광장 글 · 댓글의 작성자가 한 번 ── */
CREATE TABLE IF NOT EXISTS public.mtr_appeals (
  id                  bigserial PRIMARY KEY,
  target_type         text NOT NULL CHECK (target_type IN ('LISTING', 'POST', 'COMMENT')),
  target_id           uuid NOT NULL,
  author_id           uuid NOT NULL REFERENCES public.accounts(id),
  body                text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 10 AND 1000),
  target_state        text CHECK (target_state IS NULL OR target_state IN ('REJECTED', 'SUSPENDED', 'HIDDEN')),
  reasons             jsonb NOT NULL DEFAULT '[]'::jsonb,
  state               text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'ACCEPTED', 'REJECTED')),
  due_at              timestamptz NOT NULL,
  overdue_alerted_at  timestamptz,
  decided_by          uuid REFERENCES public.accounts(id),
  decided_at          timestamptz,
  decision_note       text CHECK (decision_note IS NULL OR char_length(btrim(decision_note)) BETWEEN 2 AND 500),
  restored            text CHECK (restored IS NULL OR restored IN ('PUBLISHED', 'IN_REVIEW')),
  dismissed_reports   integer NOT NULL DEFAULT 0 CHECK (dismissed_reports >= 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_mtr_appeal_decided CHECK (state = 'OPEN' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_note IS NOT NULL)),
  CONSTRAINT ck_mtr_appeal_restored CHECK (restored IS NULL OR state = 'ACCEPTED')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mtr_appeal_target ON public.mtr_appeals (target_type, target_id);
CREATE INDEX IF NOT EXISTS ix_mtr_appeal_state ON public.mtr_appeals (state, due_at);
CREATE INDEX IF NOT EXISTS ix_mtr_appeal_author ON public.mtr_appeals (author_id, created_at DESC);
COMMENT ON TABLE public.mtr_appeals IS 'v10.573 신고 → 이의 제기 — 신고로 내려간(매물 반려 · 정지 / 글 · 댓글 가림) 대상의 작성자가 대상마다 한 번(uq_mtr_appeal_target) · 운영 재판단(받아들임 · 받아들이지 않음 · 사유 필수) · 기한 due_at(mtr.appeal_sla_hours) · 결정 뒤 고칠 수 없음 · 지우지 않음';

/* 결정은 한 번 — 결정한 줄의 상태 · 사유 · 결정한 사람은 바꿀 수 없음 · 지우지 않음 */
CREATE OR REPLACE FUNCTION public.fn_mtr_appeal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'MTR_APPEAL: 이의 제기 기록은 지우지 않습니다';
  END IF;
  IF OLD.state <> 'OPEN' AND (NEW.state IS DISTINCT FROM OLD.state OR NEW.decision_note IS DISTINCT FROM OLD.decision_note
                              OR NEW.decided_by IS DISTINCT FROM OLD.decided_by OR NEW.restored IS DISTINCT FROM OLD.restored) THEN
    RAISE EXCEPTION 'MTR_APPEAL: 이미 결정한 이의 제기는 바꿀 수 없습니다';
  END IF;
  IF NEW.target_type IS DISTINCT FROM OLD.target_type OR NEW.target_id IS DISTINCT FROM OLD.target_id
     OR NEW.author_id IS DISTINCT FROM OLD.author_id OR NEW.body IS DISTINCT FROM OLD.body THEN
    RAISE EXCEPTION 'MTR_APPEAL: 이의 내용은 바꿀 수 없습니다';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_mtr_appeal_guard ON public.mtr_appeals;
CREATE TRIGGER trg_mtr_appeal_guard BEFORE UPDATE OR DELETE ON public.mtr_appeals FOR EACH ROW EXECUTE FUNCTION public.fn_mtr_appeal_guard();


/* ── ② v10.574 가짜 후기 · 리뷰 의심 목록 — 거래 후기(deal_reviews) · 소개몰 리뷰(hlt_reviews) ── */
CREATE TABLE IF NOT EXISTS public.mtr_review_flags (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('DEAL', 'HLT')),
  review_id   uuid NOT NULL,
  author_id   uuid NOT NULL REFERENCES public.accounts(id),
  target_key  text NOT NULL CHECK (target_key ~ '^[0-9a-f-]{36}$'),
  signals     text[] NOT NULL DEFAULT '{}'::text[] CHECK (signals <@ ARRAY['SAME_DEVICE', 'BURST', 'SIMILAR', 'NO_DEAL', 'NEW_ACCOUNT']::text[]),
  score       integer NOT NULL CHECK (score BETWEEN 0 AND 200),
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  state       text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'FAKE', 'OK')),
  hidden      boolean NOT NULL DEFAULT false,
  note        text CHECK (note IS NULL OR char_length(btrim(note)) BETWEEN 2 AND 300),
  decided_by  uuid REFERENCES public.accounts(id),
  decided_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_mtr_review_decided CHECK (state = 'OPEN' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND note IS NOT NULL)),
  CONSTRAINT ck_mtr_review_hidden CHECK (NOT hidden OR (state = 'FAKE' AND kind = 'HLT'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mtr_review_flag ON public.mtr_review_flags (kind, review_id);
CREATE INDEX IF NOT EXISTS ix_mtr_review_flag_state ON public.mtr_review_flags (state, score DESC, id);
COMMENT ON TABLE public.mtr_review_flags IS 'v10.574 가짜 후기 · 리뷰 의심 — 신호(같은 기기 · 짧은 시간 몰림 · 비슷한 문장 · 거래 없음 · 새 계정) 점수가 기준(mtr.review_threshold) 이상인 것만 · 자동 삭제 · 자동 가림 없음 · 운영이 가짜(FAKE) · 문제없음(OK) 결정 · 가짜로 정한 거래 후기는 v10.575 소개자 신뢰 점수에서 뺌';


/* ── ③ v10.575 소개자 신뢰 점수 — 산식 초안(SUPER 가 점수 · 기준 고침) ── */
CREATE TABLE IF NOT EXISTS public.mtr_trust_rules (
  code        text PRIMARY KEY CHECK (code IN ('BASE', 'IDENTITY', 'BUSINESS', 'DEAL', 'REVIEW', 'RESPONSE', 'REPORT')),
  label       text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40),
  points      numeric(5,1) NOT NULL CHECK (points BETWEEN -50 AND 50),
  full_at     numeric(6,1) CHECK (full_at IS NULL OR full_at > 0),
  note        text CHECK (note IS NULL OR char_length(note) <= 300),
  sort        integer NOT NULL DEFAULT 0,
  updated_by  uuid REFERENCES public.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_mtr_trust_sign CHECK ((code = 'REPORT' AND points <= 0) OR (code <> 'REPORT' AND points >= 0)),
  CONSTRAINT ck_mtr_trust_full CHECK (code IN ('BASE', 'IDENTITY', 'BUSINESS') OR full_at IS NOT NULL),
  CONSTRAINT ck_mtr_trust_resp CHECK (code <> 'RESPONSE' OR full_at > 1)
);
INSERT INTO public.mtr_trust_rules (code, label, points, full_at, note, sort) VALUES
  ('BASE',     '시작 점수',   15, NULL, '모든 회원이 같은 점수로 시작합니다.', 1),
  ('IDENTITY', '본인인증',    15, NULL, '본인인증을 마쳤으면 다 줍니다.', 2),
  ('BUSINESS', '사업자 인증',  5, NULL, '사업자 인증을 마쳤으면 다 줍니다(개인 회원도 다른 칸으로 100점까지 갈 수 없게 하지 않으려고 작게).', 3),
  ('DEAL',     '성사',        25, 10,   '소개자 · 당사자로 성사(확정 · 정산)된 거래 수 ÷ 기준 건수(처음 10건이면 다 줌).', 4),
  ('REVIEW',   '받은 후기',   25, 5,    '받은 거래 후기 평균(1점 0 · 5점 만점) × 후기 수 ÷ 기준 건수(처음 5건). 가짜로 정한 후기(v10.574)는 뺍니다.', 5),
  ('RESPONSE', '응답 속도',   15, 48,   '최근 90일 남이 먼저 연 대화에 첫 답까지 걸린 시간의 가운데 값 — 1시간 안이면 다 주고 기준 시간(처음 48시간) 넘으면 0. 답 안 한 대화는 기준 시간으로 셈. 대화 3건 미만이면 0(표본 부족).', 6),
  ('REPORT',   '인정된 신고', -15, 3,   '최근 1년 내 매물 · 글 · 댓글 · 프로필에 인정(UPHELD)된 신고 수 ÷ 기준 건수(처음 3건이면 다 깎음). 신고만으로는 깎지 않습니다 — 이의 제기가 받아들여진 신고는 기각으로 바뀌어 빠집니다.', 7)
ON CONFLICT (code) DO NOTHING;
COMMENT ON TABLE public.mtr_trust_rules IS 'v10.575 소개자 신뢰 점수 산식(초안 · SUPER 가 점수 · 기준 고침 · 사유는 감사 MTR_TRUST_RULES) — 점수는 운영 화면 · 본인 화면에만 · 노출 순위 · 검색 정렬 · 광고 · 소개비 계산에 쓰지 않음';

CREATE TABLE IF NOT EXISTS public.mtr_trust_scores (
  account_id   uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  score        numeric(5,1) NOT NULL CHECK (score BETWEEN 0 AND 100),
  sample       integer NOT NULL DEFAULT 0 CHECK (sample >= 0),
  items        jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_mtr_trust_scores_at ON public.mtr_trust_scores (computed_at);
COMMENT ON TABLE public.mtr_trust_scores IS 'v10.575 소개자 신뢰 점수 하루 한 번 셈(mtr_daily · mtr.trust on 일 때) — 운영 분포 · 본인 화면 참고용 · 노출 순위 · 소개비 계산에 쓰지 않음(쓰는 코드가 생기면 시험 test_v1575 가 막음)';

CREATE OR REPLACE FUNCTION public.fn_mtr_trust(p_account uuid) RETURNS TABLE(score numeric, sample integer, items jsonb)
  LANGUAGE plpgsql STABLE AS $$
DECLARE
  rb record; ri record; rz record; rd record; rv record; rr record; rp record;
  v_id boolean; v_biz boolean; v_deals int := 0; v_rev_n int := 0; v_rev_avg numeric;
  v_conv int := 0; v_med numeric; v_rep int := 0;
  g_base numeric := 0; g_id numeric := 0; g_biz numeric := 0; g_deal numeric := 0; g_rev numeric := 0; g_resp numeric := 0; g_rep numeric := 0;
  v_items jsonb;
BEGIN
  SELECT (a.identity_verified_at IS NOT NULL) INTO v_id FROM accounts a WHERE a.id = p_account;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT r.label, r.points, r.full_at INTO rb FROM mtr_trust_rules r WHERE r.code = 'BASE';
  SELECT r.label, r.points, r.full_at INTO ri FROM mtr_trust_rules r WHERE r.code = 'IDENTITY';
  SELECT r.label, r.points, r.full_at INTO rz FROM mtr_trust_rules r WHERE r.code = 'BUSINESS';
  SELECT r.label, r.points, r.full_at INTO rd FROM mtr_trust_rules r WHERE r.code = 'DEAL';
  SELECT r.label, r.points, r.full_at INTO rv FROM mtr_trust_rules r WHERE r.code = 'REVIEW';
  SELECT r.label, r.points, r.full_at INTO rr FROM mtr_trust_rules r WHERE r.code = 'RESPONSE';
  SELECT r.label, r.points, r.full_at INTO rp FROM mtr_trust_rules r WHERE r.code = 'REPORT';

  v_biz := EXISTS (SELECT 1 FROM businesses b WHERE b.account_id = p_account AND b.verified_at IS NOT NULL);

  SELECT count(*)::int INTO v_deals FROM deals d
   WHERE p_account IN (d.introducer_account_id, d.buyer_account_id, d.seller_account_id) AND d.status IN ('CONFIRMED', 'SETTLED');

  SELECT count(*)::int, avg(x.rating) INTO v_rev_n, v_rev_avg FROM deal_reviews x
   WHERE x.target_id = p_account AND x.author_id <> p_account
     AND NOT EXISTS (SELECT 1 FROM mtr_review_flags f WHERE f.kind = 'DEAL' AND f.review_id = x.id AND f.state = 'FAKE');

  /* 응답 속도 — 남이 먼저 연 대화(최근 90일 · 1시간 넘게 지난 것)에 내 첫 답까지 시간(시간) · 답 안 했으면 기준 시간 */
  SELECT count(*)::int,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY least(coalesce(q.h, coalesce(rr.full_at, 48)), coalesce(rr.full_at, 48)))
    INTO v_conv, v_med
    FROM (SELECT extract(epoch FROM ((SELECT min(m.created_at) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id = p_account) - c.created_at)) / 3600.0 AS h
            FROM conversations c
           WHERE c.counterpart_id = p_account AND c.initiator_id <> p_account
             AND c.created_at > now() - interval '90 days' AND c.created_at < now() - interval '1 hour') q;

  /* 인정된 신고 — 남이 한 신고 · 최근 1년 · 매물 · 글 · 댓글 · 프로필 */
  SELECT count(*)::int INTO v_rep FROM reports x
   WHERE x.state = 'UPHELD' AND x.reporter_id IS DISTINCT FROM p_account
     AND coalesce(x.handled_at, x.created_at) > now() - interval '365 days'
     AND ((x.target_type = 'LISTING' AND x.target_id IN (SELECT l.id FROM listings l WHERE l.owner_account_id = p_account))
       OR (x.target_type = 'POST' AND x.target_id IN (SELECT p.id FROM posts p WHERE p.author_id = p_account))
       OR (x.target_type = 'COMMENT' AND x.target_id IN (SELECT c.id FROM post_comments c WHERE c.author_id = p_account))
       OR (x.target_type = 'PROFILE' AND x.target_id = p_account));

  g_base := coalesce(rb.points, 0);
  g_id   := CASE WHEN v_id THEN coalesce(ri.points, 0) ELSE 0 END;
  g_biz  := CASE WHEN v_biz THEN coalesce(rz.points, 0) ELSE 0 END;
  g_deal := coalesce(rd.points, 0) * least(1.0, v_deals::numeric / coalesce(rd.full_at, 10));
  g_rev  := CASE WHEN v_rev_n > 0 THEN coalesce(rv.points, 0) * least(1.0, v_rev_n::numeric / coalesce(rv.full_at, 5)) * greatest(0, (v_rev_avg - 1.0) / 4.0) ELSE 0 END;
  g_resp := CASE WHEN v_conv >= 3 AND v_med IS NOT NULL
                 THEN coalesce(rr.points, 0) * greatest(0, least(1.0, (coalesce(rr.full_at, 48) - v_med::numeric) / (coalesce(rr.full_at, 48) - 1.0))) ELSE 0 END;
  g_rep  := coalesce(rp.points, 0) * least(1.0, v_rep::numeric / coalesce(rp.full_at, 3));

  v_items := jsonb_build_array(
    jsonb_build_object('code', 'BASE', 'label', rb.label, 'max', rb.points, 'got', round(g_base, 1), 'basis', jsonb_build_object()),
    jsonb_build_object('code', 'IDENTITY', 'label', ri.label, 'max', ri.points, 'got', round(g_id, 1), 'basis', jsonb_build_object('verified', v_id)),
    jsonb_build_object('code', 'BUSINESS', 'label', rz.label, 'max', rz.points, 'got', round(g_biz, 1), 'basis', jsonb_build_object('verified', v_biz)),
    jsonb_build_object('code', 'DEAL', 'label', rd.label, 'max', rd.points, 'got', round(g_deal, 1), 'basis', jsonb_build_object('deals', v_deals, 'fullAt', rd.full_at)),
    jsonb_build_object('code', 'REVIEW', 'label', rv.label, 'max', rv.points, 'got', round(g_rev, 1), 'basis', jsonb_build_object('reviews', v_rev_n, 'avg', round(coalesce(v_rev_avg, 0), 2), 'fullAt', rv.full_at)),
    jsonb_build_object('code', 'RESPONSE', 'label', rr.label, 'max', rr.points, 'got', round(g_resp, 1), 'basis', jsonb_build_object('conversations', v_conv, 'medianHours', round(coalesce(v_med, 0)::numeric, 1), 'fullAt', rr.full_at, 'enough', v_conv >= 3)),
    jsonb_build_object('code', 'REPORT', 'label', rp.label, 'max', rp.points, 'got', round(g_rep, 1), 'basis', jsonb_build_object('upheld', v_rep, 'fullAt', rp.full_at)));

  RETURN QUERY SELECT greatest(0, least(100, round(g_base + g_id + g_biz + g_deal + g_rev + g_resp + g_rep, 1)))::numeric,
                      (v_deals + v_rev_n + v_conv)::int, v_items;
END $$;
COMMENT ON FUNCTION public.fn_mtr_trust(uuid) IS 'v10.575 소개자 신뢰 점수 0 ~ 100(산식 mtr_trust_rules) · 칸마다 얻은 점수와 근거 수 — 운영 · 본인 화면 전용 · 노출 순위 · 검색 정렬 · 광고 · 소개비 계산에 쓰지 않음(기존 소개 신뢰도 fn_trust_score 와 따로 — 그것은 공급자 정렬에 쓰여 고치면 노출이 바뀜)';


/* ── ④ v10.576 회원 휴면 계정 — 1년(설정) 미접속 · 30일 전 알림 · 이름 · 전화 분리 보관 · 로그인하면 풀림 ── */
ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_status_check;
ALTER TABLE public.accounts ADD CONSTRAINT accounts_status_check
  CHECK (status = ANY (ARRAY['ACTIVE'::text, 'SUSPENDED'::text, 'WITHDRAWN'::text, 'DORMANT'::text]));

CREATE TABLE IF NOT EXISTS public.mtr_dormant (
  account_id        uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  state             text NOT NULL CHECK (state IN ('NOTICED', 'DORMANT', 'RESTORED')),
  basis_at          timestamptz NOT NULL,
  noticed_at        timestamptz,
  notice_mailed_at  timestamptz,
  dormant_at        timestamptz,
  restored_at       timestamptz,
  restored_via      text CHECK (restored_via IS NULL OR restored_via IN ('LOGIN', 'SOCIAL', 'PW_RESET', 'ADMIN', 'STATUS')),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_mtr_dormant_state CHECK ((state <> 'DORMANT' OR dormant_at IS NOT NULL) AND (state <> 'RESTORED' OR (restored_at IS NOT NULL AND restored_via IS NOT NULL)) AND (state <> 'NOTICED' OR noticed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_mtr_dormant_state ON public.mtr_dormant (state, noticed_at);
COMMENT ON TABLE public.mtr_dormant IS 'v10.576 휴면 — 알림(NOTICED) · 휴면(DORMANT) · 풀림(RESTORED) · basis_at = 알릴 때 기준(마지막 로그인 또는 가입) · 이름 · 전화 원문은 pii.mtr_dormant_vault(암호화)에만';

CREATE TABLE IF NOT EXISTS pii.mtr_dormant_vault (
  account_id  uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  name_enc    bytea NOT NULL,
  phone_enc   bytea,
  moved_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE pii.mtr_dormant_vault IS 'v10.576 휴면 계정 이름 · 전화 분리 보관(pgp_sym_encrypt · fn_enc_key) — 휴면이 풀리면 accounts 로 되돌리고 지움 · 로그인 아이디(이메일)는 accounts 에 남음(로그인으로 풀어야 하므로)';

/* 휴면 후보 — 쓰는 계정 중 운영 역할 · 진행 중 거래(성사 · 정산 · 취소 전) · 유료 구독 · 안심 · 제휴 파트너(신청 · 활동)는 뺌 */
CREATE OR REPLACE VIEW public.v_mtr_dormant_pool AS
SELECT a.id, a.email, a.last_login_at, a.created_at
  FROM public.accounts a
 WHERE a.status = 'ACTIVE' AND a.withdrawn_at IS NULL AND a.purged_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.account_roles r WHERE r.account_id = a.id
                    AND r.role IN ('ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT', 'ACCOUNTANT', 'PARTNER_MAL', 'PARTNER_AFF'))
   AND NOT EXISTS (SELECT 1 FROM public.deals d WHERE a.id IN (d.buyer_account_id, d.seller_account_id, d.introducer_account_id)
                    AND d.status NOT IN ('CONFIRMED', 'SETTLED', 'CANCELLED'))
   AND NOT EXISTS (SELECT 1 FROM public.subscriptions s JOIN public.subscription_plans p ON p.code = s.plan_code
                    WHERE s.account_id = a.id AND s.status IN ('ACTIVE', 'PAST_DUE') AND p.monthly_price > 0)
   AND NOT EXISTS (SELECT 1 FROM public.partners pt JOIN public.businesses b ON b.id = pt.business_id
                    WHERE b.account_id = a.id AND (pt.status IN ('APPLIED', 'ACTIVE') OR pt.aff_status IN ('APPLIED', 'ACTIVE')));
COMMENT ON VIEW public.v_mtr_dormant_pool IS 'v10.576 휴면 후보가 될 수 있는 계정(미접속 기간은 작업이 봄) — 운영 역할 · 진행 중 거래 · 유료 구독 · 파트너 뺌';

/* 상태 지킴 — DORMANT 로 바꾸는 것은 휴면 함수만(app.mtr_dormant = on) · DORMANT 에서 다른 상태로 가면 어디서 바꾸든 이름 · 전화를 되돌림 */
CREATE OR REPLACE FUNCTION public.fn_mtr_dormant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_name text; v_phone text; v_via text;
BEGIN
  IF NEW.status = 'DORMANT' AND OLD.status IS DISTINCT FROM 'DORMANT' AND coalesce(current_setting('app.mtr_dormant', true), '') <> 'on' THEN
    RAISE EXCEPTION 'MTR_DORMANT: 휴면 전환은 휴면 작업(fn_mtr_dormant_apply)만 합니다';
  END IF;
  IF OLD.status = 'DORMANT' AND NEW.status IS DISTINCT FROM 'DORMANT' THEN
    SELECT pgp_sym_decrypt(v.name_enc, fn_enc_key()), CASE WHEN v.phone_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(v.phone_enc, fn_enc_key()) END
      INTO v_name, v_phone FROM pii.mtr_dormant_vault v WHERE v.account_id = NEW.id;
    IF FOUND THEN
      NEW.name := coalesce(v_name, NEW.name);
      NEW.phone := v_phone;
      DELETE FROM pii.mtr_dormant_vault WHERE account_id = NEW.id;
    END IF;
    v_via := coalesce(nullif(current_setting('app.mtr_wake_via', true), ''), 'STATUS');
    IF v_via NOT IN ('LOGIN', 'SOCIAL', 'PW_RESET', 'ADMIN', 'STATUS') THEN v_via := 'STATUS'; END IF;
    UPDATE mtr_dormant SET state = 'RESTORED', restored_at = clock_timestamp(), restored_via = v_via, updated_at = now()
     WHERE account_id = NEW.id AND state = 'DORMANT';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_mtr_dormant_guard ON public.accounts;
CREATE TRIGGER trg_mtr_dormant_guard BEFORE UPDATE OF status ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.fn_mtr_dormant_guard();

/* 휴면으로 — 알림을 보낸 지 알림 일수가 지났고 그 뒤 로그인하지 않은 쓰는 계정만 · 이름 · 전화는 금고로 · 다른 기기 로그인은 상태 바뀜 트리거가 풂 */
CREATE OR REPLACE FUNCTION public.fn_mtr_dormant_apply(p_account uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM 1 FROM accounts WHERE id = p_account AND status = 'ACTIVE' AND withdrawn_at IS NULL AND purged_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO pii.mtr_dormant_vault (account_id, name_enc, phone_enc, moved_at)
  SELECT a.id, pgp_sym_encrypt(a.name, fn_enc_key()), CASE WHEN a.phone IS NULL THEN NULL ELSE pgp_sym_encrypt(a.phone, fn_enc_key()) END, clock_timestamp()
    FROM accounts a WHERE a.id = p_account
  ON CONFLICT (account_id) DO UPDATE SET name_enc = EXCLUDED.name_enc, phone_enc = EXCLUDED.phone_enc, moved_at = EXCLUDED.moved_at;
  PERFORM set_config('app.mtr_dormant', 'on', true);
  UPDATE accounts SET status = 'DORMANT', name = '휴면 회원', phone = NULL, token_version = token_version + 1 WHERE id = p_account AND status = 'ACTIVE';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('app.mtr_dormant', 'off', true);
  IF n = 0 THEN RETURN false; END IF;
  UPDATE mtr_dormant SET state = 'DORMANT', dormant_at = clock_timestamp(), restored_at = NULL, restored_via = NULL, updated_at = now() WHERE account_id = p_account;
  RETURN true;
END $$;
COMMENT ON FUNCTION public.fn_mtr_dormant_apply(uuid) IS 'v10.576 휴면으로 바꿈 — 이름 · 전화 암호화 보관 · 이름 「휴면 회원」 · 로그인 증표 무효(token_version) · 작업(mtr_daily)만 부름';

/* 휴면 풀기 — 로그인 · 간편 로그인 · 비밀번호 재설정 링크 · SUPER(사유) */
CREATE OR REPLACE FUNCTION public.fn_mtr_dormant_wake(p_account uuid, p_via text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  IF p_via NOT IN ('LOGIN', 'SOCIAL', 'PW_RESET', 'ADMIN') THEN RAISE EXCEPTION 'MTR_DORMANT: 풀기 길이 맞지 않습니다'; END IF;
  PERFORM set_config('app.mtr_wake_via', p_via, true);
  UPDATE accounts SET status = 'ACTIVE' WHERE id = p_account AND status = 'DORMANT';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('app.mtr_wake_via', '', true);
  RETURN n > 0;
END $$;
COMMENT ON FUNCTION public.fn_mtr_dormant_wake(uuid, text) IS 'v10.576 휴면 풀기 — 상태를 ACTIVE 로(이름 · 전화는 fn_mtr_dormant_guard 가 금고에서 되돌림) · 풀린 길 기록';


/* ── ⑤ 설정 — 스위치 모두 처음 off(켜기 · 값 바꾸기 SUPER · 바뀐 기록은 「전체 설정」 기록) ── */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('mtr.appeal', 'off', 'ADMIN', '신고 이의 제기(v10.573) — on 이면 신고로 내려간 매물 · 글 · 댓글의 작성자가 나의공간에서 사유를 보고 대상마다 한 번 이의를 냄 · 운영이 재판단 · 처음 off', false, '^(on|off)$', 'off'),
  ('mtr.appeal_days', '30', 'ADMIN', '이의를 낼 수 있는 기간(내려간 뒤 일 · 1 ~ 90 · 처음 30 · v10.573)', false, '^([1-9]|[1-8][0-9]|90)$', '30'),
  ('mtr.appeal_sla_hours', '72', 'ADMIN', '이의 제기 운영 처리 기한(시간 · 24 ~ 336 · 처음 72 · 넘으면 운영 알림 MTR_APPEAL_OVERDUE · v10.573)', false, '^(2[4-9]|[3-9][0-9]|[12][0-9]{2}|3[0-2][0-9]|33[0-6])$', '72'),
  ('mtr.review_watch', 'off', 'ADMIN', '가짜 후기 · 리뷰 탐지(v10.574) — on 이면 매시간 최근 후기 · 리뷰를 신호(같은 기기 · 몰림 · 비슷한 문장 · 거래 없음 · 새 계정)로 보고 기준 넘으면 의심 목록에만 · 자동 삭제 없음 · 처음 off', false, '^(on|off)$', 'off'),
  ('mtr.review_threshold', '50', 'ADMIN', '가짜 후기 의심 기준 점수(20 ~ 100 · 처음 50 · v10.574)', false, '^([2-9][0-9]|100)$', '50'),
  ('mtr.review_burst_count', '5', 'ADMIN', '몰림 — 같은 대상에 이 수 이상(2 ~ 50 · 처음 5 · v10.574)', false, '^([2-9]|[1-4][0-9]|50)$', '5'),
  ('mtr.review_burst_hours', '24', 'ADMIN', '몰림 — 이 시간 안(앞뒤 · 1 ~ 168 · 처음 24 · v10.574)', false, '^([1-9]|[1-9][0-9]|1[0-5][0-9]|16[0-8])$', '24'),
  ('mtr.review_similar_pct', '80', 'ADMIN', '비슷한 문장 — 글자 짝 겹침 % 이상(50 ~ 100 · 처음 80 · v10.574)', false, '^([5-9][0-9]|100)$', '80'),
  ('mtr.review_scan_days', '30', 'ADMIN', '탐지가 보는 기간(최근 쓰거나 고친 후기 · 일 · 1 ~ 90 · 처음 30 · v10.574)', false, '^([1-9]|[1-8][0-9]|90)$', '30'),
  ('mtr.trust', 'off', 'ADMIN', '소개자 신뢰 점수(v10.575) — on 이면 매일 셈 · 나의공간 「내 신뢰 점수」에 보임 · 운영 화면 · 본인 화면만(노출 순위 · 소개비 계산에 쓰지 않음) · 처음 off', false, '^(on|off)$', 'off'),
  ('mtr.dormant', 'off', 'ADMIN', '회원 휴면 계정(v10.576 · 법무 확인 필요 · 회사 선택) — on 이면 매일 미접속 기간이 다가온 회원에게 알림 · 기간이 지나면 휴면(이름 · 전화 분리 보관) · 로그인하면 풀림 · 처음 off', false, '^(on|off)$', 'off'),
  ('mtr.dormant_days', '365', 'ADMIN', '휴면 기준 미접속 일수(180 ~ 1095 · 처음 365 · v10.576)', false, '^(1[89][0-9]|[2-9][0-9]{2}|10[0-8][0-9]|109[0-5])$', '365'),
  ('mtr.dormant_notice_days', '30', 'ADMIN', '휴면 전 알림 일수(7 ~ 60 · 처음 30 · 알림 뒤 이 날 수가 지나야 휴면 · v10.576)', false, '^([7-9]|[1-5][0-9]|60)$', '30'),
  ('mtr.dormant_mail', 'off', 'ADMIN', '휴면 전 알림 메일(v10.576) — on 이면 사이트 알림에 더해 메일 한 통(반송 · 수신 거부 주소 뺌 · 메일 준비 안 됐으면 사이트 알림만) · 처음 off', false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;


/* ── ⑥ 정기 작업 ── */
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('mtr_hourly', 60, NULL, NULL, NULL, true, '회원 · 거래 매시간 작업(v10.573 · 574) — 이의 제기 처리 기한 넘김 알림(mtr.appeal) · 가짜 후기 탐지(mtr.review_watch) · 스위치 꺼져 있으면 아무것도 안 함'),
  ('mtr_daily', 1440, 4, 40, NULL, true, '회원 · 거래 하루 작업(v10.575 · 576) — 매일 04:40 · 소개자 신뢰 점수 셈(mtr.trust) · 휴면 전 알림 · 휴면 전환(mtr.dormant) · 스위치 꺼져 있으면 아무것도 안 함')
ON CONFLICT (job) DO NOTHING;


/* ── ⑦ ㉕ 권한 시드(D258 모양) — 위험감지(admrsk) 이의 제기 · 가짜 후기 의심 / 회원(admusr) 신뢰 점수 · 휴면 계정 · 운영 관리자 모두 · 세무사 없음(mtr- 앞머리) ── */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('mtr-appeals', '이의 제기', 'admrsk', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 22),
  ('mtr-reviews', '가짜 후기 의심', 'admrsk', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 23),
  ('mtr-trust', '소개자 신뢰 점수', 'admusr', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 160),
  ('mtr-dormant', '휴면 계정', 'admusr', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 161)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'mtr-appeals', 'VIEW'), ('R_ADMIN', 'mtr-appeals', 'EDIT'), ('R_ADMIN', 'mtr-appeals', 'APPROVE'), ('R_ADMIN', 'mtr-appeals', 'EXPORT'),
  ('R_ADMIN', 'mtr-reviews', 'VIEW'), ('R_ADMIN', 'mtr-reviews', 'EDIT'), ('R_ADMIN', 'mtr-reviews', 'APPROVE'), ('R_ADMIN', 'mtr-reviews', 'EXPORT'),
  ('R_ADMIN', 'mtr-trust', 'VIEW'), ('R_ADMIN', 'mtr-trust', 'EDIT'), ('R_ADMIN', 'mtr-trust', 'APPROVE'), ('R_ADMIN', 'mtr-trust', 'EXPORT'),
  ('R_ADMIN', 'mtr-dormant', 'VIEW'), ('R_ADMIN', 'mtr-dormant', 'EDIT'), ('R_ADMIN', 'mtr-dormant', 'APPROVE'), ('R_ADMIN', 'mtr-dormant', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/mtr/overview', 'mtr-appeals', 'VIEW'),
  ('GET', '/admin/mtr/overview', 'mtr-reviews', 'VIEW'),
  ('GET', '/admin/mtr/overview', 'mtr-trust', 'VIEW'),
  ('GET', '/admin/mtr/overview', 'mtr-dormant', 'VIEW'),
  ('PUT', '/admin/mtr/settings', 'mtr-appeals', 'EDIT'),
  ('GET', '/admin/mtr/appeals', 'mtr-appeals', 'VIEW'),
  ('POST', '/admin/mtr/appeals/{id}/decide', 'mtr-appeals', 'APPROVE'),
  ('GET', '/admin/mtr/reviews', 'mtr-reviews', 'VIEW'),
  ('GET', '/admin/mtr/reviews/{id}', 'mtr-reviews', 'VIEW'),
  ('POST', '/admin/mtr/reviews/{id}/decide', 'mtr-reviews', 'APPROVE'),
  ('POST', '/admin/mtr/reviews/scan', 'mtr-reviews', 'EDIT'),
  ('GET', '/admin/mtr/trust', 'mtr-trust', 'VIEW'),
  ('GET', '/admin/mtr/trust/lookup', 'mtr-trust', 'VIEW'),
  ('PUT', '/admin/mtr/trust/rules', 'mtr-trust', 'EDIT'),
  ('POST', '/admin/mtr/trust/recompute', 'mtr-trust', 'EDIT'),
  ('GET', '/admin/mtr/dormant', 'mtr-dormant', 'VIEW'),
  ('POST', '/admin/mtr/dormant/{id}/wake', 'mtr-dormant', 'APPROVE')
ON CONFLICT (method, pattern, task_key) DO NOTHING;
