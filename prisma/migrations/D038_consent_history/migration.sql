-- v10.28 (G-214 · 10/9 결정 「v10.28에서」) — 선택 약관(마케팅 · 맞춤형 광고 · 야간 광고) 동의를 바꿀 수 있게.
--   동의 기록(term_agreements)은 지금처럼 **고치거나 지우지 않는 줄**입니다(trg_term_agr_ro). 대신 「약관 · 판마다 한 줄」 제한(uq_term_agreement)을 없애
--   바꿀 때마다 한 줄씩 쌓고, 읽는 곳은 모두 **가장 최근 줄**을 봅니다 — 약관 동의 상태 · AI 맞춤 동의 · 광고 대상 · 마케팅/야간 광고 감시.
--   필수 약관은 끌 수 없습니다(서비스 — 탈퇴로만). 같은 값을 다시 보내면 줄을 더하지 않습니다(서비스).

ALTER TABLE term_agreements DROP CONSTRAINT IF EXISTS uq_term_agreement;
CREATE INDEX IF NOT EXISTS idx_term_agr_latest ON term_agreements (account_id, term_code, agreed_at DESC, id DESC);

/* 회원 · 약관마다 가장 최근 줄(판과 관계없이) — 지금 상태 */
CREATE OR REPLACE VIEW public.v_term_consent_current AS
 SELECT DISTINCT ON (account_id, term_code) id, account_id, term_code, term_version, agreed, agreed_at
   FROM term_agreements
  ORDER BY account_id, term_code, agreed_at DESC, id DESC;

/* 어느 시각에 유효했던 동의(그 시각 이전의 가장 최근 줄) */
CREATE OR REPLACE FUNCTION public.fn_consent_at(p_account uuid, p_code text, p_at timestamptz) RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT agreed FROM term_agreements
                    WHERE account_id = p_account AND term_code = p_code AND agreed_at <= p_at
                    ORDER BY agreed_at DESC, id DESC LIMIT 1), false)
$$;

/* 필수 약관 미동의 — 지금 판의 가장 최근 줄이 동의인지 */
CREATE OR REPLACE VIEW public.v_term_not_agreed AS
 SELECT a.id AS account_id, a.email, t.code, t.title
   FROM accounts a CROSS JOIN terms t
  WHERE t.status = 'PUBLISHED' AND t.is_required AND a.status = 'ACTIVE'
    AND NOT EXISTS (SELECT 1 FROM v_term_consent_current g
                     WHERE g.account_id = a.id AND g.term_code = t.code AND g.term_version = t.version AND g.agreed);

/* 마케팅 · 야간 광고 감시 — 보낸 그 시각에 유효했던 동의로 봄(나중에 끈 사람도 그때 동의했으면 위반 아님 · 끈 뒤에 보낸 것은 위반) */
CREATE OR REPLACE VIEW public.v_marketing_no_consent AS
 SELECT id, account_id, event_code, created_at
   FROM notifications n
  WHERE event_code ~ 'MARKETING|PROMO|EVENT|AD_' AND NOT fn_consent_at(n.account_id, 'MARKETING', n.created_at);

CREATE OR REPLACE VIEW public.v_marketing_night_violation AS
 SELECT id, account_id, event_code, created_at, '야간 동의 없이 21시~08시에 광고를 보냈습니다'::text AS note
   FROM notifications n
  WHERE event_code ~~ 'MARKETING%'
    AND (EXTRACT(hour FROM (created_at AT TIME ZONE 'Asia/Seoul')) >= 21 OR EXTRACT(hour FROM (created_at AT TIME ZONE 'Asia/Seoul')) < 8)
    AND NOT fn_consent_at(n.account_id, 'MARKETING_NIGHT', n.created_at);

/* 2년 재확인 — 지금 동의 상태인 사람의 그 동의가 2년을 넘음 */
CREATE OR REPLACE VIEW public.v_marketing_consent_stale AS
 SELECT account_id, agreed_at, ((now() AT TIME ZONE 'Asia/Seoul')::date - (agreed_at AT TIME ZONE 'Asia/Seoul')::date) AS days_old
   FROM v_term_consent_current
  WHERE term_code = 'MARKETING' AND agreed AND agreed_at < now() - interval '2 years';

CREATE OR REPLACE VIEW public.v_marketing_reconfirm_due AS
 SELECT account_id, agreed_at, ((now() AT TIME ZONE 'Asia/Seoul')::date - (agreed_at AT TIME ZONE 'Asia/Seoul')::date) AS days_since
   FROM v_term_consent_current
  WHERE term_code = 'MARKETING' AND agreed AND agreed_at < now() - interval '2 years';
