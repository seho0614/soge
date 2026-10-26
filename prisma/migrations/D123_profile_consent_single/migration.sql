-- =====================================================================
-- D123 — v10.115 (2026-10-26 · 관심 성향 동의를 맞춤형 광고 약관 하나로 · docs/179)
--
--   대표 결정(2026-10-26 성향 분석 점검 → 「가. 약관(ADPERSONAL) 하나로」 → 계획 「승인」)
--   전에는 동의가 두 갈래였습니다 — 설문 화면 체크 상자(member_ad_profiles.consented_at · 늘 채워짐)와 약관 ADPERSONAL.
--   그래서 약관을 꺼도 성향이 남아 광고를 골랐고, 행동 학습의 「동의한 사람만」 조건은 늘 참이었습니다.
--
--   ① 성향 저장 · 바꾸기는 ADPERSONAL 의 지금 동의가 있을 때만(fn_profile_consent_gate) — 학습이 바꾸는 것도 같은 둑
--   ② ADPERSONAL 을 끄면(동의 기록에 「거부」 줄) 그 회원의 성향을 지우고 광고 기록의 회원 연결을 끊음(fn_ad_anonymize)
--   ③ 광고 기록(ad_events)은 여전히 고칠 · 지울 수 없음 — **회원 칸을 비우는 익명화만** 허용(과금 근거 칸은 그대로)
--      전에는 이 둑이 익명화(fn_ad_anonymize)와 계정 삭제 때의 회원 칸 비우기(ON DELETE SET NULL)까지 막았습니다.
--   ④ 행동 학습은 동의가 있는 회원의 **등록 뒤** 클릭만(v_segment_behavior) · 감시 보기는 「약관 동의 없이 바뀐 건」을 셈
--   ⑤ 지금 있는 성향 중 ADPERSONAL 동의가 없는 것은 지움(근거 없이 저장된 것)
--
--   재실행 안전. 광고 기록 · 동의 기록은 지우지 않습니다.
-- =====================================================================

/* ── 지금 동의(가장 최근 줄)가 「동의」인가 ─────────────────────────── */
CREATE OR REPLACE FUNCTION public.fn_adpersonal_on(p_account uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT agreed FROM public.v_term_consent_current
                    WHERE account_id = p_account AND term_code = 'ADPERSONAL'), false)
$$;
COMMENT ON FUNCTION public.fn_adpersonal_on(uuid) IS
  'v10.111+ D123 — 맞춤형 광고 약관(ADPERSONAL)의 지금 동의. 성향 저장 · 광고 고르기 · 행동 학습이 모두 이것 하나를 봅니다.';

/* ── ① 성향 저장 둑 ──────────────────────────────────────────────── */
CREATE OR REPLACE FUNCTION public.fn_profile_consent_gate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.consented_at IS NULL THEN
    RAISE EXCEPTION 'PRIVACY: 성향 저장에는 동의가 필요합니다';
  END IF;
  IF NEW.consented_at > now() THEN
    RAISE EXCEPTION 'PRIVACY: 동의 시각이 미래일 수 없습니다';
  END IF;
  /* v10.115 (D123) — 동의 근거는 약관 ADPERSONAL 하나 — 지금 동의가 없으면 저장도 바꾸기(학습 포함)도 안 됩니다.
   *   등록과 철회가 동시에 오면 한 회원 단위로 차례를 지킵니다(철회가 등록 중인 줄을 못 보고 지나가지 않게) */
  PERFORM pg_advisory_xact_lock(hashtext('adpersonal:' || NEW.account_id::text));
  IF NOT public.fn_adpersonal_on(NEW.account_id) THEN
    RAISE EXCEPTION 'PRIVACY: 맞춤형 광고 약관(ADPERSONAL)에 동의해야 성향을 저장할 수 있습니다';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

/* ── ③ 광고 기록 — 익명화만 허용 ────────────────────────────────────── */
CREATE OR REPLACE FUNCTION public.fn_ad_events_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  /* v10.115 (D123) — 회원 칸(account_id · member_hash)을 비우는 것만 허용합니다(익명화 · 계정 삭제).
   *   과금 근거(소재 · 자리 · 종류 · 세그먼트 · 시각)는 그대로여야 하고, 지우기는 여전히 안 됩니다. */
  IF TG_OP = 'UPDATE'
     AND NEW.account_id IS NULL
     AND (NEW.member_hash IS NULL OR NEW.member_hash IS NOT DISTINCT FROM OLD.member_hash)
     AND (NEW.anonymized_at IS NOT DISTINCT FROM OLD.anonymized_at OR OLD.anonymized_at IS NULL)
     AND (to_jsonb(NEW) - 'account_id' - 'member_hash' - 'anonymized_at')
         = (to_jsonb(OLD) - 'account_id' - 'member_hash' - 'anonymized_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AD: 광고 집계 기록은 수정·삭제할 수 없습니다 (과금 근거)';
END $$;

/* 익명화 — 유출 점검은 「그 시각에 약관 동의가 없는데 세그먼트가 붙은 기록」을 셉니다 */
CREATE OR REPLACE FUNCTION public.fn_ad_anonymize(p_account uuid) RETURNS TABLE(audited integer, anonymized integer)
    LANGUAGE plpgsql
    AS $$
DECLARE v_leak int; v_n int;
BEGIN
  -- ① 감사 먼저. 동의 없이 나간 노출이 있었는지 셉니다.
  SELECT count(*) INTO v_leak
    FROM ad_events e
   WHERE e.account_id = p_account
     AND e.segment_code IS NOT NULL
     AND NOT public.fn_consent_at(p_account, 'ADPERSONAL', e.occurred_at);

  INSERT INTO ad_leak_audits(account_id, leaked_rows) VALUES (p_account, v_leak);

  -- ② 감사 기록이 남은 뒤에만 익명화합니다.
  UPDATE ad_events
     SET account_id = NULL, member_hash = NULL, anonymized_at = now()
   WHERE account_id = p_account;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN QUERY SELECT v_leak, v_n;
END $$;

/* ── ② 약관을 끄면 정리 ──────────────────────────────────────────── */
CREATE OR REPLACE FUNCTION public.fn_adpersonal_withdrawn() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.term_code = 'ADPERSONAL' AND NOT NEW.agreed THEN
    PERFORM pg_advisory_xact_lock(hashtext('adpersonal:' || NEW.account_id::text));   -- 등록 중인 성향이 끝난 뒤에 지움
    DELETE FROM public.member_ad_profiles WHERE account_id = NEW.account_id;
    /* 정리할 광고 기록이 있을 때만(가입 때 「동의 안 함」 줄마다 빈 감사 줄이 쌓이지 않게) */
    IF EXISTS (SELECT 1 FROM public.ad_events WHERE account_id = NEW.account_id) THEN
      PERFORM public.fn_ad_anonymize(NEW.account_id);
    END IF;
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.fn_adpersonal_withdrawn() IS
  'v10.115 D123 — 맞춤형 광고 약관을 끄면(거부 줄) 성향을 지우고 광고 기록의 회원 연결을 끊습니다. 다시 동의 · 등록해도 옛 클릭은 학습에 쓰이지 않습니다.';
DROP TRIGGER IF EXISTS trg_adpersonal_withdrawn ON public.term_agreements;
CREATE TRIGGER trg_adpersonal_withdrawn AFTER INSERT ON public.term_agreements
  FOR EACH ROW EXECUTE FUNCTION public.fn_adpersonal_withdrawn();

/* ── ④ 행동 학습 — 동의 있는 회원의 등록 뒤 클릭만 ───────────────────── */
CREATE OR REPLACE VIEW public.v_segment_behavior AS
SELECT e.account_id,
       p.segment_code AS current_code,
       cs.segment_code AS clicked_code,
       count(*)::int AS clicks,
       /* 그 소재가 현재 세그먼트도 겨냥하는가(C942 그대로) */
       bool_or(EXISTS (
         SELECT 1 FROM ad_creative_segments x
          WHERE x.creative_id = e.creative_id
            AND x.segment_code = p.segment_code)) AS ambiguous
  FROM ad_events e
  JOIN member_ad_profiles p ON p.account_id = e.account_id
  JOIN public.v_term_consent_current tc            -- v10.115 — 지금 약관 동의가 있는 회원만
    ON tc.account_id = e.account_id AND tc.term_code = 'ADPERSONAL' AND tc.agreed
  JOIN ad_creative_segments cs ON cs.creative_id = e.creative_id
 WHERE e.event_type = 'CLICK'
   AND e.occurred_at >= now() - interval '90 days'
   AND e.occurred_at >= p.consented_at            -- v10.115 — 등록(동의) 뒤 클릭만
   AND e.account_id IS NOT NULL
   AND e.anonymized_at IS NULL
 GROUP BY e.account_id, p.segment_code, cs.segment_code, e.creative_id;

COMMENT ON VIEW public.v_segment_behavior IS
  '회원별 광고 클릭을 세그먼트로 묶은 것. **ambiguous 가 true 면 그 소재가 현재 세그먼트도 겨냥한 것**이라 신호로 쓰지 않습니다(C942). '
  'v10.115 — 맞춤형 광고 약관에 지금 동의한 회원의, 성향을 등록한 뒤의 클릭만.';

CREATE OR REPLACE FUNCTION public.fn_segment_learn() RETURNS TABLE(
  out_account uuid, out_from text, out_to text, out_cf int, out_ct int
) AS $$
DECLARE v_on text;
BEGIN
  SELECT value INTO v_on FROM site_settings WHERE key='segment.learn.enabled';
  IF coalesce(v_on,'off') <> 'on' THEN RETURN; END IF;

  RETURN QUERY
  WITH cand AS (SELECT * FROM v_segment_shift_candidates),
  upd AS (
    UPDATE member_ad_profiles p
       SET segment_code = c.to_code,
           /* ★ 출처를 바꿉니다. 나중에 "내가 이렇게 답했나?" 할 때
              질문이 아니라 행동으로 바뀐 것임을 알 수 있습니다. */
           source = 'BEHAVIOR',
           updated_at = now()
      FROM cand c
     WHERE p.account_id = c.account_id
       /* v10.115 — 동의 근거는 약관 ADPERSONAL 하나(전에는 늘 참인 consented_at 을 봤음) */
       AND public.fn_adpersonal_on(p.account_id)
    RETURNING p.account_id, c.current_code AS f, c.to_code AS t,
              c.clicks_from AS cf, c.clicks_to AS ct
  ),
  logged AS (
    INSERT INTO segment_shift_log (account_id, from_code, to_code, clicks_from, clicks_to)
    SELECT u.account_id, u.f, u.t, u.cf, u.ct FROM upd u
    RETURNING account_id, from_code, to_code, clicks_from, clicks_to
  )
  SELECT l.account_id, l.from_code, l.to_code, l.clicks_from, l.clicks_to
    FROM logged l;
END $$ LANGUAGE plpgsql;

/* 감시 — 바뀐 그 시각에 약관 동의가 없었던 기록(0이어야 함) */
CREATE OR REPLACE VIEW public.v_segment_learn_no_consent AS
SELECT s.account_id, s.to_code, s.applied_at
  FROM segment_shift_log s
 WHERE s.reverted_at IS NULL
   AND NOT public.fn_consent_at(s.account_id, 'ADPERSONAL', s.applied_at);

COMMENT ON VIEW public.v_segment_learn_no_consent IS
  '맞춤형 광고 약관(ADPERSONAL) 동의 없이 세그먼트가 바뀐 기록. **0이어야 합니다** — v10.115 부터 실제 약관 동의를 봅니다(전에는 늘 0 이던 칸을 봤음).';

/* ── ⑤ 근거 없이 저장된 성향 정리 ────────────────────────────────────── */
-- 지울 성향의 회원 중 광고 기록이 남은 사람은 먼저 익명화(이미 동의가 꺼져 있어 철회 트리거가 다시 돌지 않으므로)
SELECT public.fn_ad_anonymize(x.account_id)
  FROM (SELECT DISTINCT p.account_id FROM public.member_ad_profiles p
         WHERE NOT public.fn_adpersonal_on(p.account_id)
           AND EXISTS (SELECT 1 FROM public.ad_events e WHERE e.account_id = p.account_id)) x;
-- 그 시각에 약관 동의 없이 옮겨진 학습 기록은 「되돌림」으로 남김(성향을 지우므로 그 이동은 더 이상 쓰이지 않음 · 기록은 지우지 않음)
UPDATE public.segment_shift_log s SET reverted_at = now()
 WHERE s.reverted_at IS NULL AND NOT public.fn_consent_at(s.account_id, 'ADPERSONAL', s.applied_at);
DELETE FROM public.member_ad_profiles p WHERE NOT public.fn_adpersonal_on(p.account_id);
