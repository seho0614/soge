-- v10.342 (docs/475) — 리드관(소개리드) 경고를 운영 알림으로
--   대표 11/17 「다음개발」 → ③ 리드관 경고를 운영 알림으로 · 「승인 + 통과하면 병합」. 지우는 문장 없음 · 다시 돌려도 같음.
--   리드관(LED)이 켜져 있을 때만 봅니다(꺼지면 두 알림 모두 풂). 정기 작업 sla_alert(매시간)이 부릅니다.
--   ① LEAD_NO_PARTNER  WARN     공개 상담 업종(안심소개 상담 축 · 정액 노출형 뺌) 중 받을 인증 업체 0곳이 있음 — 업종 이름 목록
--   ② LEAD_UNDELIVERED CRITICAL 24시간 안 「받을 업체 없음」(NO_PARTNER) 신청 3건 이상
--   같은 종류 열린 줄이 있으면 숫자만 고침 · 원인이 없어지면 풂(D177 · D225 와 같은 방식).
CREATE OR REPLACE FUNCTION public.fn_lead_alert() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE on_ boolean; n_cat int; names text; n_und int; open_id bigint;
BEGIN
  SELECT coalesce((SELECT is_active FROM gwans WHERE code = 'LED'), false) INTO on_;
  IF NOT on_ THEN
    UPDATE ops_alerts SET resolved_at = now(), resolve_note = '리드관이 꺼짐'
     WHERE alert_code IN ('LEAD_NO_PARTNER', 'LEAD_UNDELIVERED') AND resolved_at IS NULL;
    RETURN 0;
  END IF;

  SELECT count(*), string_agg(c.name, ' · ' ORDER BY c.name) INTO n_cat, names
    FROM categories c
   WHERE c.gwan_code = 'MAL' AND c.axis = 'CONSULT' AND c.status = 'APPROVED' AND c.consult_mode IS DISTINCT FROM 'LISTING_FEE'
     AND NOT EXISTS (SELECT 1 FROM v_consult_eligible_partner e WHERE e.category_id = c.id);
  IF n_cat > 0 THEN
    SELECT id INTO open_id FROM ops_alerts
     WHERE alert_code = 'LEAD_NO_PARTNER' AND acknowledged_at IS NULL AND resolved_at IS NULL ORDER BY raised_at DESC LIMIT 1;
    IF open_id IS NOT NULL THEN
      UPDATE ops_alerts SET detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object('count', n_cat, 'categories', names, 'lastSeen', now()) WHERE id = open_id;
    ELSE
      INSERT INTO ops_alerts(alert_code, severity, title, detail)
      VALUES ('LEAD_NO_PARTNER', 'WARN', format('리드관 받을 업체 없는 공개 업종 %s개', n_cat),
              jsonb_build_object('count', n_cat, 'categories', names, 'lastSeen', now()))
      ON CONFLICT DO NOTHING;
    END IF;
  ELSE
    UPDATE ops_alerts SET resolved_at = now(), resolve_note = '받을 업체 없는 공개 업종이 0개가 됨'
     WHERE alert_code = 'LEAD_NO_PARTNER' AND resolved_at IS NULL;
  END IF;

  SELECT count(*) INTO n_und FROM consult_requests WHERE state = 'NO_PARTNER' AND created_at > now() - interval '24 hours';
  IF n_und >= 3 THEN
    SELECT id INTO open_id FROM ops_alerts
     WHERE alert_code = 'LEAD_UNDELIVERED' AND acknowledged_at IS NULL AND resolved_at IS NULL ORDER BY raised_at DESC LIMIT 1;
    IF open_id IS NOT NULL THEN
      UPDATE ops_alerts SET detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object('count', n_und, 'lastSeen', now()) WHERE id = open_id;
    ELSE
      INSERT INTO ops_alerts(alert_code, severity, title, detail)
      VALUES ('LEAD_UNDELIVERED', 'CRITICAL', format('리드관 상담 신청 전달 못 함(받을 업체 없음) 24시간 %s건', n_und),
              jsonb_build_object('count', n_und, 'lastSeen', now()))
      ON CONFLICT DO NOTHING;
    END IF;
  ELSE
    UPDATE ops_alerts SET resolved_at = now(), resolve_note = '24시간 전달 못 한 신청이 3건 아래가 됨'
     WHERE alert_code = 'LEAD_UNDELIVERED' AND resolved_at IS NULL;
  END IF;
  RETURN n_cat + n_und;
END $$;
COMMENT ON FUNCTION public.fn_lead_alert() IS 'v10.342 (D232) 리드관이 켜져 있을 때 — LEAD_NO_PARTNER(WARN · 받을 업체 0곳 공개 상담 업종) · LEAD_UNDELIVERED(CRITICAL · 24시간 NO_PARTNER 3건 이상) · 꺼지거나 원인이 없으면 풂';
