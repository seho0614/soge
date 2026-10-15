-- v10.31 (w2) — 소개 신뢰도를 한 군데(fn_trust_score · trust_weights)에서 계산하도록 합칩니다.
--   D051 · D058 에서 따로 만든 배점표(trust_score_rules)는 이미 있던 4관 공통 점수 fn_trust_score(B075 — 시작 36.5 · 본인인증 · 사업자 ·
--   초대 동의율 · 유효 연결 · 성사 · 인정된 신고 · 표본 감쇠)와 같은 뜻이라 두 숫자가 달라질 수 있었습니다.
--   v_account_trust 의 칸 이름 · 순서 · 형은 그대로 두고(매물 카드 · 상세 · 공급자 카드가 씀) score 만 fn_trust_score 값으로 바꿉니다.
--   W3(D060)가 trust_weights 에 거래 후기 가중치를 더하면 여기에도 그대로 반영됩니다.

CREATE OR REPLACE VIEW public.v_account_trust AS
SELECT a.id AS account_id,
       t.score AS score,
       EXISTS (SELECT 1 FROM public.businesses b WHERE b.account_id = a.id AND b.verified_at IS NOT NULL) AS biz,
       (a.identity_verified_at IS NOT NULL) AS idv,
       (SELECT count(*) FROM public.deals d
         WHERE d.status IN ('CONFIRMED','SETTLED')
           AND a.id IN (d.seller_account_id, d.buyer_account_id, d.introducer_account_id))::int AS deals,
       ops.success_rate, ops.rating, ops.review_count,
       (SELECT count(*) FROM public.disputes x JOIN public.deals d ON d.id = x.deal_id
         WHERE x.raised_by <> a.id AND x.status <> 'REJECTED' AND x.opened_at > now() - interval '365 days'
           AND a.id IN (d.seller_account_id, d.buyer_account_id, d.introducer_account_id))::int AS disputes,
       CASE WHEN coalesce((t.detail->>'invitesSent')::int, 0) > 0
            THEN round((t.detail->>'invitesConsented')::numeric * 100.0 / (t.detail->>'invitesSent')::numeric, 1) END AS consent_rate
  FROM public.accounts a
  JOIN public.v_owner_public_stats ops ON ops.account_id = a.id
  CROSS JOIN LATERAL public.fn_trust_score(a.id) t;
COMMENT ON VIEW public.v_account_trust IS
  'v10.31 — 소개 신뢰도(0~99 · 소수 1자리 · 36.5 에서 시작 · 시안 trustBadge). 점수는 4관 공통 fn_trust_score(trust_weights) 그대로 — 따로 계산하지 않습니다. 금액 · 개인 정보는 들어가지 않습니다.';

DROP TABLE IF EXISTS public.trust_score_rules;
