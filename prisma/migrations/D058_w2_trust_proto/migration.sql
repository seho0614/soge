-- v10.31 (w2) — 소개 신뢰도를 시안 규칙에 맞춤(시안 trustBadge: 「36.5 에서 시작 · 인증 · 동의율 · 성사 기록이 쌓이면 올라감 · 표본이 적으면 크게 움직이지 않음(감쇠)」)
--   D051 의 기본 50 → 36.5, 「동의율」 항목 추가(소개 초대에 상대가 동의한 비율), 성사율 · 평점 · 동의율은 표본 5건 미만이면 그 비율만큼만 반영.
--   띠 색(시안): 70 이상 hi · 50 이상 mid · 그 밖 low — 화면이 정합니다.

UPDATE public.trust_score_rules SET points = 36.5, max_points = 36.5, note = '시안 — 모든 계정은 36.5 에서 시작합니다(신규도 0 이 아님).' WHERE code = 'BASE';
UPDATE public.trust_score_rules SET note = '소개자로 참여한 거래의 성사율(%) × 0.1 — 참여 5건 미만이면 (건수 ÷ 5)만큼만(감쇠).' WHERE code = 'RATE';
UPDATE public.trust_score_rules SET note = '받은 후기 평균이 있으면 (평균 - 3) × 5 — 후기 5건 미만이면 (건수 ÷ 5)만큼만(감쇠).' WHERE code = 'RATING';
INSERT INTO public.trust_score_rules (code, name, points, max_points, note, sort_order) VALUES
  ('CONSENT', '동의율', 0.1, 10, '보낸 소개 초대 가운데 상대가 동의한 비율(%) × 0.1 — 초대 5건 미만이면 (건수 ÷ 5)만큼만(감쇠). 기한이 지나지 않은 대기 건은 세지 않습니다.', 5)
ON CONFLICT (code) DO NOTHING;
UPDATE public.trust_score_rules SET sort_order = 6 WHERE code = 'RATING';
UPDATE public.trust_score_rules SET sort_order = 7 WHERE code = 'DISPUTE';

CREATE OR REPLACE VIEW public.v_account_trust AS
WITH r AS (SELECT code, points, max_points FROM public.trust_score_rules),
p AS (
  SELECT a.id AS account_id,
         EXISTS (SELECT 1 FROM public.businesses b WHERE b.account_id = a.id AND b.verified_at IS NOT NULL) AS biz,
         (a.identity_verified_at IS NOT NULL) AS idv,
         (SELECT count(*) FROM public.deals d
           WHERE d.status IN ('CONFIRMED','SETTLED')
             AND a.id IN (d.seller_account_id, d.buyer_account_id, d.introducer_account_id)) AS deals,
         ops.total_deals, ops.success_rate, ops.rating, ops.review_count,
         iv.decided, iv.consented,
         (SELECT count(*) FROM public.disputes x JOIN public.deals d ON d.id = x.deal_id
           WHERE x.raised_by <> a.id AND x.status <> 'REJECTED' AND x.opened_at > now() - interval '365 days'
             AND a.id IN (d.seller_account_id, d.buyer_account_id, d.introducer_account_id)) AS disputes
    FROM public.accounts a
    JOIN public.v_owner_public_stats ops ON ops.account_id = a.id
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE i.state IN ('CONSENTED','DECLINED','EXPIRED') OR i.expires_at < now()) AS decided,
             count(*) FILTER (WHERE i.state = 'CONSENTED') AS consented
        FROM public.introduction_invites i WHERE i.introducer_id = a.id) iv ON true
)
SELECT p.account_id,
       round(greatest(0, least(100,
         (SELECT points FROM r WHERE code = 'BASE')
         + CASE WHEN p.biz THEN (SELECT points FROM r WHERE code = 'BIZ') ELSE 0 END
         + CASE WHEN p.idv THEN (SELECT points FROM r WHERE code = 'IDV') ELSE 0 END
         + least((SELECT max_points FROM r WHERE code = 'DEALS'), p.deals * (SELECT points FROM r WHERE code = 'DEALS'))
         + least((SELECT max_points FROM r WHERE code = 'RATE'), coalesce(p.success_rate, 0) * (SELECT points FROM r WHERE code = 'RATE'))
             * least(1, coalesce(p.total_deals, 0) / 5.0)
         + CASE WHEN p.decided > 0
                THEN least((SELECT max_points FROM r WHERE code = 'CONSENT'), (p.consented * 100.0 / p.decided) * (SELECT points FROM r WHERE code = 'CONSENT'))
                     * least(1, p.decided / 5.0)
                ELSE 0 END
         + CASE WHEN p.review_count > 0 AND p.rating IS NOT NULL
                THEN greatest(-(SELECT max_points FROM r WHERE code = 'RATING'),
                              least((SELECT max_points FROM r WHERE code = 'RATING'), (p.rating - 3) * (SELECT points FROM r WHERE code = 'RATING')))
                     * least(1, p.review_count / 5.0)
                ELSE 0 END
         + greatest((SELECT max_points FROM r WHERE code = 'DISPUTE'), p.disputes * (SELECT points FROM r WHERE code = 'DISPUTE'))
       ))::numeric, 1) AS score,
       p.biz, p.idv, p.deals::int AS deals, p.success_rate, p.rating, p.review_count,
       p.disputes::int AS disputes,
       CASE WHEN p.decided > 0 THEN round(p.consented * 100.0 / p.decided, 1) END AS consent_rate
  FROM p;
COMMENT ON VIEW public.v_account_trust IS
  'v10.31 — 소개 신뢰도(0~100 · 소수 1자리 · 36.5 에서 시작 · 시안 trustBadge). 항목 · 배점은 trust_score_rules. 매물 카드 · 상세 · 공급자 카드가 이 값을 씁니다. 금액 · 개인 정보는 들어가지 않습니다.';
