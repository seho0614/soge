-- v10.31 (10/10 시안 기준 · 묶음 w3 · 시안 myntf 「수신 설정」) — 알림 수신 설정이 실제로 먹게.
--   ① fn_notify 가 알림 종류를 「앞 단어」(LISTING_APPROVED → LISTING)로 잘라 적고 있었습니다 — 종류별 수신 설정 · 색(tone)을 찾을 수 없었음.
--      → 받은 종류 코드 그대로 적습니다(예전 행은 그대로 둠).
--   ② 회원이 인앱 알림을 끈 종류는 보내지 않습니다 — 단, 수신거부할 수 없는 종류(돈 · 계약)는 설정과 상관없이 보냅니다.
--   ③ 계약 「확인 요청」 알림 글(CONTRACT_NUDGE)
CREATE OR REPLACE FUNCTION public.fn_notify(p_account uuid, p_code text, p_vars jsonb, p_link text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE t record; v_body text; v_key text; v_title text;
BEGIN
  IF p_account IS NULL THEN RETURN; END IF;

  /* v10.31 — 회원이 끈 종류(수신거부 가능한 것만)는 보내지 않습니다 */
  IF EXISTS (SELECT 1 FROM notification_preferences np
               JOIN notification_event_policies ep ON ep.event_code = np.event_code AND ep.optout_allowed
              WHERE np.account_id = p_account AND np.event_code = p_code AND np.channel = 'INAPP' AND NOT np.enabled) THEN
    RETURN;
  END IF;

  SELECT * INTO t FROM notification_templates
   WHERE code = p_code || '_INAPP' AND is_active;
  IF t IS NULL THEN
    /* 템플릿이 없으면 **조용히 넘어가지 않습니다** — 알림이 안 가는
     * 것을 아무도 모르게 되기 때문입니다. */
    RAISE WARNING 'NOTIFY: 템플릿이 없습니다 — %_INAPP', p_code;
    RETURN;
  END IF;

  v_body := t.body; v_title := t.title;
  FOR v_key IN SELECT jsonb_object_keys(coalesce(p_vars, '{}'::jsonb)) LOOP
    v_body := replace(v_body, '{' || v_key || '}', coalesce(p_vars ->> v_key, ''));
    v_title := replace(v_title, '{' || v_key || '}', coalesce(p_vars ->> v_key, ''));
  END LOOP;

  INSERT INTO notifications (account_id, event_code, template_code, title, body, link_url)
  VALUES (p_account, p_code, p_code || '_INAPP', v_title, v_body, p_link);
END $function$;

INSERT INTO public.notification_templates (code, channel, title, body, variables) VALUES
  ('CONTRACT_NUDGE_INAPP', 'INAPP', '계약서를 확인해 주십시오',
   '{counterpart}님이 「{title}」 계약의 확인을 요청했습니다. 계약 진행에서 조건 · 서명 차례를 확인해 주십시오.',
   '["counterpart","title"]'::jsonb)
ON CONFLICT (code) DO NOTHING;
