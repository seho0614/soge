-- =====================================================================
-- D127 — v10.124 (2026-10-27 · 신뢰지표 배지를 코드 · 숫자로도 · docs/188)
--
--   대표 「승인」(남은 영어 빈칸 ① · ② · ③ 중 ①). fn_partner_badges 는 배지 이름 · 상태 · 설명을 한국어 글로만 지어 내서
--   다른 언어 화면이 옮길 수 없었습니다. 같은 글은 그대로 두고, 화면이 글을 만들 재료를 칸으로 더합니다.
--     state_code  ACHIEVED · NOT_MET · NO_RATING · PERIOD_SHORT · IN_REVIEW · REJECTED · NOT_SUBMITTED(state 한국어와 1:1)
--     badge_kind(규칙 kind) · badge_label(누적 배지의 업종 라벨) · need_n(기준 수) · need_months(기간)
--     cur_n(지금 건수 — 성사 · 평가 · 분쟁) · cur_rating(지금 평점) · since_on(무분쟁을 센 첫날)
--   돌려주는 칸이 바뀌어 DROP 뒤 다시 만듭니다(이 함수를 쓰는 보기 · 함수 없음 — API partner.service 한 곳).
--   code · name · state · detail · sort_order 는 D078 과 같은 값 · 재실행 안전 · 자료를 바꾸지 않습니다.
-- =====================================================================

DROP FUNCTION IF EXISTS public.fn_partner_badges(uuid);

CREATE FUNCTION public.fn_partner_badges(p_partner uuid)
RETURNS TABLE(code text, name text, state text, detail text, sort_order int,
               state_code text, badge_kind text, badge_label text, need_n numeric, need_months int, cur_n int, cur_rating numeric, since_on date) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE
  v_owner uuid; v_biz uuid; v_since timestamptz; v_label text; v_deals int; v_rating numeric; v_rcnt int;
  v_disp int; v_qual text; r record;
BEGIN
  SELECT b.account_id, b.id, p.approved_at INTO v_owner, v_biz, v_since
    FROM partners p JOIN businesses b ON b.id = p.business_id WHERE p.id = p_partner;
  /* 라벨 — 승인 서비스가 가장 많은 업종의 라벨(없으면 성사) */
  SELECT coalesce(c.trust_label, '성사') INTO v_label
    FROM partner_services s JOIN categories c ON c.id = s.category_id
   WHERE s.partner_id = p_partner AND s.status = 'APPROVED'
   GROUP BY c.trust_label ORDER BY count(*) DESC, (c.trust_label IS NULL) LIMIT 1;
  v_label := coalesce(v_label, '성사');
  SELECT count(*) INTO v_deals FROM partner_fulfillment_reports WHERE partner_id = p_partner AND consumer_state = 'CONFIRMED';
  SELECT round(avg(x.r)::numeric, 1), count(*) INTO v_rating, v_rcnt FROM (
    SELECT rating::numeric AS r FROM deal_reviews WHERE target_id = v_owner AND rating IS NOT NULL
    UNION ALL
    SELECT consumer_rating FROM partner_fulfillment_reports WHERE partner_id = p_partner AND consumer_rating IS NOT NULL) x;
  FOR r IN SELECT * FROM partner_badge_rules WHERE is_active ORDER BY sort_order LOOP
    code := r.code; sort_order := r.sort_order;
    badge_kind := r.kind; badge_label := NULL; need_n := r.threshold; need_months := r.months; cur_n := NULL; cur_rating := NULL; since_on := NULL;
    IF r.kind = 'DEALS' THEN
      name := replace(replace(r.name_tpl, '{label}', v_label), '{n}', to_char(r.threshold, 'FM999,999'));
      state := CASE WHEN v_deals >= r.threshold THEN '달성' ELSE '미달' END;
      detail := '지금 ' || v_deals || '건(소비자 확인 기준)';
      badge_label := v_label; cur_n := v_deals;
    ELSIF r.kind = 'RATING' THEN
      name := replace(r.name_tpl, '{n}', r.threshold::text);
      state := CASE WHEN v_rcnt > 0 AND v_rating >= r.threshold THEN '달성' WHEN v_rcnt = 0 THEN '평가 없음' ELSE '미달' END;
      detail := CASE WHEN v_rcnt > 0 THEN '현재 ' || v_rating || ' (' || v_rcnt || '건)' ELSE '아직 받은 평가가 없습니다' END;
      cur_n := v_rcnt; cur_rating := v_rating;
    ELSIF r.kind = 'NO_DISPUTE' THEN
      name := replace(r.name_tpl, '{n}', r.months::text);
      SELECT count(*) INTO v_disp FROM (
        SELECT 1 FROM disputes dp JOIN deals dl ON dl.id = dp.deal_id
         WHERE (dl.seller_account_id = v_owner OR dl.buyer_account_id = v_owner)
           AND dp.opened_at > now() - make_interval(months => r.months)
        UNION ALL
        SELECT 1 FROM partner_fulfillment_reports f
         WHERE f.partner_id = p_partner AND f.consumer_state = 'DISPUTED'
           AND f.consumer_at > now() - make_interval(months => r.months)) z;
      state := CASE WHEN v_since IS NULL OR v_since > now() - make_interval(months => r.months) THEN '기간 미달'
                    WHEN v_disp = 0 THEN '달성' ELSE '미달' END;
      detail := CASE WHEN v_since IS NULL THEN '입점 승인 전'
                     ELSE to_char(greatest(v_since, now() - make_interval(months => r.months)) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') || '부터 · 분쟁 ' || v_disp || '건' END;
      cur_n := v_disp;
      since_on := CASE WHEN v_since IS NULL THEN NULL ELSE (greatest(v_since, now() - make_interval(months => r.months)) AT TIME ZONE 'Asia/Seoul')::date END;
    ELSE
      name := r.name_tpl;
      SELECT CASE WHEN bool_or(q.state = 'APPROVED') THEN '달성'
                  WHEN bool_or(q.state IN ('SUBMITTED','PENDING','IN_REVIEW','REQUESTED')) THEN '심사중'
                  WHEN count(*) > 0 THEN '반려' END
        INTO v_qual FROM qualification_reviews q WHERE q.business_id = v_biz;
      state := coalesce(v_qual, '미제출');
      detail := CASE coalesce(v_qual, '미제출') WHEN '심사중' THEN '규제 업종 자격 승인은 본사가 합니다'
                     WHEN '미제출' THEN '규제 업종이 아니면 필요 없습니다' ELSE NULL END;
    END IF;
    state_code := CASE state WHEN '달성' THEN 'ACHIEVED' WHEN '미달' THEN 'NOT_MET' WHEN '평가 없음' THEN 'NO_RATING' WHEN '기간 미달' THEN 'PERIOD_SHORT'
                    WHEN '심사중' THEN 'IN_REVIEW' WHEN '반려' THEN 'REJECTED' WHEN '미제출' THEN 'NOT_SUBMITTED' ELSE NULL END;
    RETURN NEXT;
  END LOOP;
END $$;
