-- 안심소개 「생활 · 금융 상담」 — 시연용 인증업체가 리드형 업종을 모두 받게 합니다 (개발 · 시연용 시드 · v10.24).
--
--   10/7 결정 — 「준비 중 업종: 규칙은 그대로 두고 시험용 업체를 넣는다」.
--   규칙(받을 인증업체가 0곳이면 상담 신청 단추를 막는다)은 바꾸지 않습니다. 개발 DB 에는 「청소」만 받는 시연용 업체 1곳뿐이라
--   나머지 19업종이 「준비 중」으로 보였고, 상담 신청을 끝까지 눌러 볼 수 없었습니다.
--
--   하는 일 — 처음 준비(local-setup.sh)가 만든 시연용 인증업체(intro@x.com 의 사업자) **1곳에만** 더합니다. 업체 · 계정을 새로 만들지 않습니다.
--     1) 리드형 상담 업종마다 승인된 서비스 1건(제목 「(시험) ○○ 상담」)
--     2) 자격 확인 업종에 필요한 자격 심사 승인 기록(서류 번호 「개발시드-…」) — 자격 규칙을 끄지 않고, 규칙이 보는 기록을 넣습니다
--     3) 활동 지역 서울 · 경기 · 인천 전체 (다른 시 · 도로 신청하면 전과 같이 「받을 업체 없음」)
--     4) 월 정액 노출형(법률 · 세무)에는 그 업체 이름으로 시험용 사무소를 업종마다 1건 게재합니다(10/7 답 「시험용 사무소를 넣음」).
--        이름은 「(시험) …」, 전화는 쓰이지 않는 번호(02-0000-…), 입금 기록은 「개발 시드 — 실제 입금 아님」입니다.
--        한 업체는 한 업종에 한 건만 게재할 수 있습니다(DB 규칙).
--     5) (v10.25 · 10/7 답 「시험용 사무소 2곳」) 둘째 사무소 — 처음 준비 때 있는 다른 사업자(seller@x.com 의 「시험판매사」)를 **게재만 하는 업체**로 올려
--        법률 · 세무에 한 건씩 더 싣습니다(업종마다 2곳). 이 업체에는 서비스 · 활동 지역을 넣지 않으므로 상담 신청(리드)은 받지 않습니다 —
--        리드형 업종의 인증업체 수는 그대로 1곳입니다. 그 사업자가 없으면 이 단계만 건너뜁니다. 계정 · 사업자를 새로 만들지 않습니다.
--        게재 기간이 30일 안으로 남으면 1년 뒤로 늘립니다(개발 DB 를 오래 써도 목록이 비지 않게). 자격 심사 기록(LEGAL · TAX)도 함께 넣습니다 — 규칙이 봅니다.
--
--   여러 번 돌려도 같습니다(있는 것은 건너뜁니다). 이미 있는 자격 심사 기록(대기 · 반려 포함)은 고치지 않습니다.
--   ★ 개발 · 시연용입니다. 운영 DB 에는 돌리지 않습니다(deploy/aws 의 적용 스크립트는 이 파일을 부르지 않습니다).
--     운영에서는 업체가 파트너센터에서 입점 · 서비스 · 자격 서류를 내고 운영자가 심사합니다.
DO $$
DECLARE
  v_partner uuid; v_biz uuid; v_adm uuid; v_partner2 uuid; v_biz2 uuid; n_dir2 integer := 0;
  n_svc integer := 0; n_qual integer := 0; n_reg integer := 0; n_dir integer := 0; n_ext integer := 0;
  v_fee numeric; v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  SELECT p.id, p.business_id INTO v_partner, v_biz
    FROM partners p
    JOIN businesses b ON b.id = p.business_id
    JOIN accounts a   ON a.id = b.account_id
   WHERE a.email = 'intro@x.com' AND p.status = 'ACTIVE'
   LIMIT 1;
  IF v_partner IS NULL THEN
    RAISE NOTICE '상담 시드 — 시연용 인증업체(intro@x.com)가 없어 건너뜁니다';
    RETURN;
  END IF;
  /* 상담 축 입점 승인이 없는 업체에는 넣지 않습니다 — 입점 승인은 local-setup.sh 가 넣습니다 */
  IF NOT EXISTS (SELECT 1 FROM mal_partner_axes ax WHERE ax.business_id = v_biz AND ax.axis = 'CONSULT' AND ax.state = 'APPROVED') THEN
    RAISE NOTICE '상담 시드 — 시연용 인증업체에 상담 축 입점 승인이 없어 건너뜁니다';
    RETURN;
  END IF;
  SELECT id INTO v_adm FROM accounts WHERE email = 'admin@x.com' LIMIT 1;

  INSERT INTO partner_services (partner_id, category_id, title, body, status)
  SELECT v_partner, c.id, '(시험) ' || c.name || ' 상담',
         '개발 · 시연용 시드 — 상담 신청을 끝까지 눌러 볼 수 있게 넣은 시험용 서비스입니다.', 'APPROVED'
    FROM categories c
   WHERE c.gwan_code = 'MAL' AND c.axis = 'CONSULT' AND c.status = 'APPROVED' AND c.consult_mode = 'LEAD'
     AND NOT EXISTS (SELECT 1 FROM partner_services s WHERE s.partner_id = v_partner AND s.category_id = c.id);
  GET DIAGNOSTICS n_svc = ROW_COUNT;

  INSERT INTO qualification_reviews (business_id, category_code, doc_no, lookup_done, lookup_by, lookup_at, state, decided_by)
  SELECT DISTINCT v_biz, coalesce(ri.qual_code, ri.code), '개발시드-' || coalesce(ri.qual_code, ri.code), true, v_adm, now(), 'APPROVED', v_adm
    FROM categories c
    JOIN restricted_industries ri
      ON ri.code = c.restricted_code AND ri.gwan_code = c.gwan_code AND ri.is_active AND ri.mode = 'GATED'
   WHERE c.gwan_code = 'MAL' AND c.axis = 'CONSULT' AND c.status = 'APPROVED' AND c.consult_mode = 'LEAD'
  ON CONFLICT (business_id, category_code) DO NOTHING;
  GET DIAGNOSTICS n_qual = ROW_COUNT;

  INSERT INTO partner_regions (partner_id, sido, sigungu)
  VALUES (v_partner, '서울', '전체'), (v_partner, '경기', '전체'), (v_partner, '인천', '전체')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n_reg = ROW_COUNT;

  /* ── 월 정액 노출형(법률 · 세무) — 시험용 사무소 ── */
  INSERT INTO qualification_reviews (business_id, category_code, doc_no, lookup_done, lookup_by, lookup_at, state, decided_by)
  SELECT DISTINCT v_biz, coalesce(ri.qual_code, ri.code), '개발시드-' || coalesce(ri.qual_code, ri.code), true, v_adm, now(), 'APPROVED', v_adm
    FROM categories c
    JOIN restricted_industries ri
      ON ri.code = c.restricted_code AND ri.gwan_code = c.gwan_code AND ri.is_active AND ri.mode = 'GATED'
   WHERE c.gwan_code = 'MAL' AND c.axis = 'CONSULT' AND c.status = 'APPROVED' AND c.consult_mode = 'LISTING_FEE'
  ON CONFLICT (business_id, category_code) DO NOTHING;

  SELECT coalesce((SELECT value::numeric FROM site_settings WHERE key = 'directory.monthly_fee' AND value ~ '^[0-9]+$'), 300000) INTO v_fee;
  INSERT INTO consult_directory_entries
    (partner_id, category_id, display_name, intro, contact_phone, sido, state, monthly_fee, paid_from, paid_to, payment_ref, decided_by, decided_at)
  SELECT v_partner, c.id,
         CASE c.code WHEN 'CSL_LEGAL' THEN '(시험) 가나다 법률사무소' WHEN 'CSL_TAX' THEN '(시험) 가나다 세무회계' ELSE '(시험) ' || c.name END,
         '개발 · 시연용 시드 — 실제 사무소가 아닙니다',
         CASE c.code WHEN 'CSL_LEGAL' THEN '02-0000-0001' WHEN 'CSL_TAX' THEN '02-0000-0002' ELSE '02-0000-0009' END,
         '서울', 'ACTIVE', v_fee, v_today, v_today + 365, '개발 시드 — 실제 입금 아님', v_adm, now()
    FROM categories c
   WHERE c.gwan_code = 'MAL' AND c.axis = 'CONSULT' AND c.status = 'APPROVED' AND c.consult_mode = 'LISTING_FEE'
     AND NOT EXISTS (SELECT 1 FROM consult_directory_entries d WHERE d.partner_id = v_partner AND d.category_id = c.id);
  GET DIAGNOSTICS n_dir = ROW_COUNT;
  /* 시드가 넣은 것만(입금 기록으로 가려냄) 기간을 늘립니다 — 운영자가 손댄 건은 건드리지 않습니다 */
  UPDATE consult_directory_entries d
     SET paid_to = v_today + 365
   WHERE d.partner_id = v_partner AND d.state = 'ACTIVE' AND d.payment_ref = '개발 시드 — 실제 입금 아님' AND d.paid_to < v_today + 30;
  GET DIAGNOSTICS n_ext = ROW_COUNT;

  /* ── 둘째 시험용 사무소 (v10.25) — seller@x.com 의 사업자를 게재만 하는 업체로 ── */
  SELECT b.id INTO v_biz2
    FROM businesses b JOIN accounts a ON a.id = b.account_id
   WHERE a.email = 'seller@x.com' AND b.verified_at IS NOT NULL
   ORDER BY b.created_at LIMIT 1;
  IF v_biz2 IS NULL THEN
    RAISE NOTICE '상담 시드 — 둘째 사무소용 사업자(seller@x.com)가 없어 그 단계는 건너뜁니다';
  ELSE
    INSERT INTO partners (business_id, status, approved_at, approved_by)
    VALUES (v_biz2, 'ACTIVE', now(), v_adm)
    ON CONFLICT (business_id) DO NOTHING;                      -- 이미 업체라면 상태를 바꾸지 않습니다(멈춰 둔 업체를 다시 켜지 않음)
    SELECT id INTO v_partner2 FROM partners WHERE business_id = v_biz2 AND status = 'ACTIVE';
    IF v_partner2 IS NOT NULL THEN
      INSERT INTO mal_partner_axes (business_id, axis, state, source, reason, decided_at, decided_by)
      VALUES (v_biz2, 'CONSULT', 'APPROVED', 'ADMIN', '개발 시드 — 둘째 시험용 사무소(게재만)', now(), v_adm)
      ON CONFLICT (business_id, axis) DO NOTHING;
      INSERT INTO qualification_reviews (business_id, category_code, doc_no, lookup_done, lookup_by, lookup_at, state, decided_by)
      SELECT DISTINCT v_biz2, coalesce(ri.qual_code, ri.code), '개발시드2-' || coalesce(ri.qual_code, ri.code), true, v_adm, now(), 'APPROVED', v_adm
        FROM categories c
        JOIN restricted_industries ri
          ON ri.code = c.restricted_code AND ri.gwan_code = c.gwan_code AND ri.is_active AND ri.mode = 'GATED'
       WHERE c.gwan_code = 'MAL' AND c.axis = 'CONSULT' AND c.status = 'APPROVED' AND c.consult_mode = 'LISTING_FEE'
      ON CONFLICT (business_id, category_code) DO NOTHING;
      INSERT INTO consult_directory_entries
        (partner_id, category_id, display_name, intro, contact_phone, sido, state, monthly_fee, paid_from, paid_to, payment_ref, decided_by, decided_at)
      SELECT v_partner2, c.id,
             CASE c.code WHEN 'CSL_LEGAL' THEN '(시험) 라마바 법률사무소' WHEN 'CSL_TAX' THEN '(시험) 라마바 세무회계' ELSE '(시험) 둘째 ' || c.name END,
             '개발 · 시연용 시드 — 실제 사무소가 아닙니다',
             CASE c.code WHEN 'CSL_LEGAL' THEN '02-0000-0003' WHEN 'CSL_TAX' THEN '02-0000-0004' ELSE '02-0000-0008' END,
             '경기', 'ACTIVE', v_fee, v_today, v_today + 365, '개발 시드 — 실제 입금 아님', v_adm, now()
        FROM categories c
       WHERE c.gwan_code = 'MAL' AND c.axis = 'CONSULT' AND c.status = 'APPROVED' AND c.consult_mode = 'LISTING_FEE'
         AND NOT EXISTS (SELECT 1 FROM consult_directory_entries d WHERE d.partner_id = v_partner2 AND d.category_id = c.id);
      GET DIAGNOSTICS n_dir2 = ROW_COUNT;
      UPDATE consult_directory_entries d
         SET paid_to = v_today + 365
       WHERE d.partner_id = v_partner2 AND d.state = 'ACTIVE' AND d.payment_ref = '개발 시드 — 실제 입금 아님' AND d.paid_to < v_today + 30;
    END IF;
  END IF;

  RAISE NOTICE '상담 시드 — 서비스 +% · 자격 기록 +% · 지역 +% · 시험용 사무소 +% · 둘째 사무소 +% (기간 연장 %)', n_svc, n_qual, n_reg, n_dir, n_dir2, n_ext;
END $$;
