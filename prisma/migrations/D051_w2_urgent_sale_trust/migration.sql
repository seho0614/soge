-- v10.31 (w2 · 10/10 「시안 기준」) — 급구 / 급매 구분 · 소개 신뢰도 점수
--
--   ① 급매 배지(URGENT_SALE) — 시안 급구 · 급매 화면의 「전체 · 급구 · 급매」 탭.
--      급구(URGENT)는 「급하게 구함」, 급매(URGENT_SALE)는 「빠르게 팔아야 함」입니다. 둘 다 기한(valid_until)과 사유가 있어야 하고,
--      같은 검수(fn_badge_enqueue → 운영 배지 심사)를 거칩니다. 기한 · 동시 개수 한도는 급구와 같은 정책값을 함께 씁니다.
--   ② 소개 신뢰도(시안 카드의 점수 띠 「87.9」 · 상세 「신용 86점」 자리) — 등록자 계정 단위 점수.
--      **지어낸 숫자가 아닙니다** — 이미 있는 사실(사업자 인증 · 본인인증 · 성사 확정 · 성사율 · 후기 평점 · 분쟁)만으로 계산합니다.
--      「신용」이라는 말은 쓰지 않습니다(신용정보법의 개인신용평가로 오해될 수 있음 — 결정 기록 w2 참고). 화면 이름은 「소개 신뢰도」입니다.

-- ① 급매 ------------------------------------------------------------------------
ALTER TABLE public.listing_badges DROP CONSTRAINT IF EXISTS listing_badges_badge_type_check;
ALTER TABLE public.listing_badges ADD CONSTRAINT listing_badges_badge_type_check
  CHECK (badge_type = ANY (ARRAY['URGENT'::text, 'URGENT_SALE'::text, 'VERIFIED_DOC'::text]));
ALTER TABLE public.listing_badges DROP CONSTRAINT IF EXISTS listing_badges_check1;
ALTER TABLE public.listing_badges ADD CONSTRAINT listing_badges_check1
  CHECK (badge_type NOT IN ('URGENT','URGENT_SALE') OR (urgent_reason IS NOT NULL AND valid_until IS NOT NULL));

INSERT INTO public.code_labels (domain, code, label, short_label, ui_tone, sort_order) VALUES
  ('badge.type','URGENT_SALE','급매','급매','warning',2)
ON CONFLICT (domain, code) DO UPDATE SET label = EXCLUDED.label, short_label = EXCLUDED.short_label;
UPDATE public.code_labels SET sort_order = 3 WHERE domain = 'badge.type' AND code = 'VERIFIED_DOC' AND sort_order < 3;

CREATE OR REPLACE FUNCTION public.fn_badge_enqueue()
 RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE l record; cnt int; max_days int; max_active int;
BEGIN
  SELECT * INTO l FROM listings WHERE id = NEW.listing_id;
  IF l.status <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'BADGE_LISTING_NOT_PUBLISHED: 노출 중인 매물에만 신청할 수 있습니다.';
  END IF;
  IF l.owner_account_id <> NEW.requested_by THEN
    RAISE EXCEPTION 'BADGE_NOT_OWNER: 본인 매물에만 신청할 수 있습니다.';
  END IF;

  /* v10.31 — 급매(URGENT_SALE)도 급구와 같은 기한 · 동시 개수 한도(둘을 합쳐 셉니다) */
  IF NEW.badge_type IN ('URGENT','URGENT_SALE') THEN
    SELECT num_value::int INTO max_days FROM auto_review_policies WHERE key = 'urgent_max_days';
    IF NEW.valid_until > now() + (max_days || ' days')::interval THEN
      RAISE EXCEPTION 'URGENT_PERIOD_TOO_LONG: 급구 · 급매 기한은 최대 %일입니다.', max_days;
    END IF;
    IF NEW.valid_until <= now() THEN
      RAISE EXCEPTION 'URGENT_PERIOD_PAST: 기한은 지금보다 뒤여야 합니다.';
    END IF;

    SELECT num_value::int INTO max_active FROM auto_review_policies WHERE key = 'urgent_max_active';
    SELECT count(*) INTO cnt FROM listing_badges b
      JOIN listings x ON x.id = b.listing_id
     WHERE x.owner_account_id = NEW.requested_by
       AND b.badge_type IN ('URGENT','URGENT_SALE') AND b.status = 'GRANTED'
       AND b.valid_until > now();
    IF cnt >= max_active THEN
      RAISE EXCEPTION 'URGENT_TOO_MANY: 동시에 유지할 수 있는 급구 · 급매는 %건입니다.', max_active;
    END IF;
    /* 한 매물에 급구 · 급매를 같이 걸지 않습니다 — 「구함」과 「팖」이 동시에 참일 수 없습니다 */
    IF EXISTS (SELECT 1 FROM listing_badges b WHERE b.listing_id = NEW.listing_id AND b.id <> NEW.id
                  AND b.badge_type IN ('URGENT','URGENT_SALE') AND b.badge_type <> NEW.badge_type
                  AND b.status IN ('REQUESTED','IN_REVIEW','GRANTED')) THEN
      RAISE EXCEPTION 'URGENT_KIND_CONFLICT: 한 매물에는 급구 · 급매 가운데 하나만 신청할 수 있습니다.';
    END IF;
  END IF;

  INSERT INTO review_items (target_type, target_id, gwan_code, submitted_by, sla_due_at)
  VALUES ('LISTING_BADGE', NEW.id, l.gwan_code, NEW.requested_by,
          now() + interval '24 hours');

  UPDATE listing_badges SET status = 'IN_REVIEW' WHERE id = NEW.id;
  RETURN NEW;
END $function$;

/* 급구 · 급매 화면의 「마감임박」 — 표시 중인 급구 · 급매의 기한(가장 이른 것) */
CREATE OR REPLACE VIEW public.v_listing_urgent AS
SELECT b.listing_id,
       (array_agg(b.badge_type ORDER BY b.valid_until))[1] AS kind,
       min(b.valid_until) AS until
  FROM public.listing_badges b
 WHERE b.badge_type IN ('URGENT','URGENT_SALE') AND b.status = 'GRANTED'
   AND b.valid_until > now()
 GROUP BY b.listing_id;

-- ② 소개 신뢰도 -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trust_score_rules (
  code       text PRIMARY KEY,
  name       text NOT NULL,
  points     numeric(5,2) NOT NULL,
  max_points numeric(5,2) NOT NULL,
  note       text NOT NULL CHECK (length(btrim(note)) >= 5),
  sort_order int NOT NULL DEFAULT 0
);
COMMENT ON TABLE public.trust_score_rules IS
  'v10.31 — 소개 신뢰도 점수의 항목 · 배점(데이터). 점수 = 기본 + 항목 합, 0~100 으로 자릅니다. 배점을 바꾸면 모든 카드의 점수가 바뀝니다(운영이 정함).';
INSERT INTO public.trust_score_rules (code, name, points, max_points, note, sort_order) VALUES
  ('BASE',    '기본',            50,   50,  '가입한 계정은 모두 50점에서 시작합니다.', 0),
  ('BIZ',     '사업자 인증',      10,   10,  '국세청 상태조회 · 서류 확인을 마친 사업자(businesses.verified_at).', 1),
  ('IDV',     '본인인증',          5,    5,  '휴대폰 본인인증을 마친 계정(accounts.identity_verified_at).', 2),
  ('DEALS',   '성사 확정',         1.5, 15,  '성사 확정(CONFIRMED · SETTLED) 1건에 1.5점, 10건(15점)까지 — 판매자 · 구매자 · 소개자 어느 쪽이든.', 3),
  ('RATE',    '성사율',            0.1, 10,  '소개자로 참여한 거래의 성사율(%) × 0.1 — 참여한 거래가 없으면 0.', 4),
  ('RATING',  '후기 평점',         5,   10,  '받은 후기 평균이 있으면 (평균 - 3) × 5 — 1점이면 -10, 5점이면 +10.', 5),
  ('DISPUTE', '분쟁',             -3,  -15,  '최근 1년, 상대가 연 분쟁 1건에 -3점(최대 -15). 기각(REJECTED)된 분쟁은 세지 않습니다.', 6)
ON CONFLICT (code) DO NOTHING;

CREATE OR REPLACE VIEW public.v_account_trust AS
WITH r AS (SELECT code, points, max_points FROM public.trust_score_rules),
p AS (
  SELECT a.id AS account_id,
         EXISTS (SELECT 1 FROM public.businesses b WHERE b.account_id = a.id AND b.verified_at IS NOT NULL) AS biz,
         (a.identity_verified_at IS NOT NULL) AS idv,
         (SELECT count(*) FROM public.deals d
           WHERE d.status IN ('CONFIRMED','SETTLED')
             AND a.id IN (d.seller_account_id, d.buyer_account_id, d.introducer_account_id)) AS deals,
         ops.success_rate, ops.rating, ops.review_count,
         (SELECT count(*) FROM public.disputes x JOIN public.deals d ON d.id = x.deal_id
           WHERE x.raised_by <> a.id AND x.status <> 'REJECTED' AND x.opened_at > now() - interval '365 days'
             AND a.id IN (d.seller_account_id, d.buyer_account_id, d.introducer_account_id)) AS disputes
    FROM public.accounts a
    JOIN public.v_owner_public_stats ops ON ops.account_id = a.id
)
SELECT p.account_id,
       round(greatest(0, least(100,
         (SELECT points FROM r WHERE code = 'BASE')
         + CASE WHEN p.biz THEN (SELECT points FROM r WHERE code = 'BIZ') ELSE 0 END
         + CASE WHEN p.idv THEN (SELECT points FROM r WHERE code = 'IDV') ELSE 0 END
         + least((SELECT max_points FROM r WHERE code = 'DEALS'), p.deals * (SELECT points FROM r WHERE code = 'DEALS'))
         + least((SELECT max_points FROM r WHERE code = 'RATE'), coalesce(p.success_rate, 0) * (SELECT points FROM r WHERE code = 'RATE'))
         + CASE WHEN p.review_count > 0 AND p.rating IS NOT NULL
                THEN greatest(-(SELECT max_points FROM r WHERE code = 'RATING'),
                              least((SELECT max_points FROM r WHERE code = 'RATING'), (p.rating - 3) * (SELECT points FROM r WHERE code = 'RATING')))
                ELSE 0 END
         + greatest((SELECT max_points FROM r WHERE code = 'DISPUTE'), p.disputes * (SELECT points FROM r WHERE code = 'DISPUTE'))
       ))::numeric, 1) AS score,
       p.biz, p.idv, p.deals::int AS deals, p.success_rate, p.rating, p.review_count, p.disputes::int AS disputes
  FROM p;
COMMENT ON VIEW public.v_account_trust IS
  'v10.31 — 소개 신뢰도(0~100 · 소수 1자리). 항목 · 배점은 trust_score_rules. 매물 카드 · 상세 · 공급자 카드가 이 값을 씁니다. 금액 · 개인 정보는 들어가지 않습니다.';
