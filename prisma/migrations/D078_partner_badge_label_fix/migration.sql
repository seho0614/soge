-- v10.31 (W5) — 신뢰 배지 「누적 ○○」 라벨: 승인 서비스가 **가장 많은** 업종의 라벨(라벨 없는 업종이 많으면 「성사」).
--   D073 은 라벨이 있는 업종을 먼저 골라, 상담 업종 18곳 · 시공 업종 2곳인 파트너에게 「누적 시공」이 붙었습니다(시안이 경고한 업종 라벨 섞임).

CREATE OR REPLACE FUNCTION public.fn_partner_badges(p_partner uuid)
RETURNS TABLE(code text, name text, state text, detail text, sort_order int) LANGUAGE plpgsql STABLE AS $$
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
    IF r.kind = 'DEALS' THEN
      name := replace(replace(r.name_tpl, '{label}', v_label), '{n}', to_char(r.threshold, 'FM999,999'));
      state := CASE WHEN v_deals >= r.threshold THEN '달성' ELSE '미달' END;
      detail := '지금 ' || v_deals || '건(소비자 확인 기준)';
    ELSIF r.kind = 'RATING' THEN
      name := replace(r.name_tpl, '{n}', r.threshold::text);
      state := CASE WHEN v_rcnt > 0 AND v_rating >= r.threshold THEN '달성' WHEN v_rcnt = 0 THEN '평가 없음' ELSE '미달' END;
      detail := CASE WHEN v_rcnt > 0 THEN '현재 ' || v_rating || ' (' || v_rcnt || '건)' ELSE '아직 받은 평가가 없습니다' END;
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
    RETURN NEXT;
  END LOOP;
END $$;
