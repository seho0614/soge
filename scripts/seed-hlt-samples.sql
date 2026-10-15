-- 소개몰 견본 상품 — 시안의 16종 + 화장품 견본 1종(p17) (개발 · 시연용 시드 · v10.26)
--
--   10/8 확정 — 「견본 16종은 개발 · 시연용 시드로만」 · 「16종 모두 직판」(A-2) · 「p12 저분자 콜라겐은 건강식품으로, 화장품 견본은 바르는 제품 1종을 새로」(A-4).
--   값은 시안(spec/proto.html 의 PRODUCTS · 19265 ~ 19382)에서 옮겼습니다 — 이름 · 한 줄 설명 · 정가 · 옵션(개월 수 · 결제 금액 · 재고 · 꼬리 글자) · 배지 · 그림 꼴/색 · 주의사항 · 표제 성분 · 함량.
--   시안 값과 다른 곳: p12 의 갈래(화장품 → 건강식품) · 판매자(모두 직판) · p15 는 잠긴 갈래라 판매 중지로 둠 · 고시는 시안이 채운 값(유통기한 「제조일로부터 24개월」 · 화장품 제조국)만.
--   별점 · 후기 수는 넣지 않습니다(v10.27). 심의필 번호 · 기능성 문구(p15)도 넣지 않습니다 — 진짜처럼 보이는 번호를 만들지 않습니다.
--   p17 은 시안에 없는 견본입니다 — 이름 · 값을 지어 넣었고 한 줄 설명에 「견본 상품」이라고 적었습니다.
--
--   여러 번 돌려도 같습니다(이미 있는 코드는 건너뜀 — 운영자가 고친 값 · 재고를 덮지 않습니다).
--   ★ 개발 · 시연용입니다. 운영 DB 에는 돌리지 않습니다(deploy/aws 의 적용 스크립트는 이 파일을 부르지 않습니다). 운영 상품은 운영 화면 「소개몰 상품」에서 등록합니다.
DO $$
DECLARE v_seller uuid; r record; v_pid uuid; n_new integer := 0;
BEGIN
  SELECT id INTO v_seller FROM hlt_sellers WHERE type = 'DIRECT' LIMIT 1;
  IF v_seller IS NULL OR to_regclass('public.hlt_product_options') IS NULL THEN
    RAISE NOTICE '소개몰 견본: 직판 판매자 또는 옵션 표가 없어 건너뜁니다'; RETURN;
  END IF;
  CREATE TEMP TABLE _sp (code text, name text, cat text, summary text, list_price bigint, badge text, caution text, notice jsonb,
                         art_form text, art_tone text, wd text, status text, n integer, ing text, amt text) ON COMMIT DROP;
  INSERT INTO _sp VALUES
  ('p01', '메가바이탈 비타민C 3000', 'HLT_FOOD', '1일 1포 · 물 없이 먹는 분말형 · 3g × 90포', 36750, '신규입점', '위가 약한 분은 식후에 드십시오. 1일 권장량을 넘기지 마십시오.', '{"유통기한": "제조일로부터 24개월"}'::jsonb, 'BOX', 'GOLD', 'FOOD_SEALED', 'ON_SALE', 1, 'VITC', '3,000mg'),
  ('p02', '선데이 비타민D 2000', 'HLT_FOOD', '작은 알 · 목넘김 편한 소프트캡슐', 29000, NULL, '과다 섭취 시 고칼슘혈증이 나타날 수 있습니다. 권장량을 지키십시오.', '{"유통기한": "제조일로부터 24개월"}'::jsonb, 'BOTTLE', NULL, 'FOOD_SEALED', 'ON_SALE', 2, 'VITD', '2,000IU'),
  ('p03', '초임계 알티지 rTG 오메가3', 'HLT_FOOD', '저온 초임계 추출 · EPA 및 DHA 함유 유지 · 1,045mg × 30캡슐', 82500, NULL, '항응고제를 복용 중이면 전문가와 상담하십시오.', '{"유통기한": "제조일로부터 24개월"}'::jsonb, 'BOX', 'BLUE', 'FOOD_SEALED', 'ON_SALE', 3, 'OMEGA3', '600mg'),
  ('p04', '눈 건강엔 루테인 프리미엄', 'HLT_FOOD', '마리골드꽃 추출물 · 비타민 7종 · 아연 · 500mg × 60캡슐', 49000, NULL, '흡연자는 섭취에 주의하십시오.', '{"유통기한": "제조일로부터 24개월"}'::jsonb, 'BOTTLE', 'COBALT', 'FOOD_SEALED', 'ON_SALE', 4, 'LUTEIN', '20mg'),
  ('p16', '칼슘 마그네슘 아연 플러스 비타민D', 'HLT_FOOD', '1캡슐당 칼슘 300mg · 6개월분 1,350mg × 180정', 46500, '신규입점', '신장 질환이 있으면 전문가와 상담하십시오. 권장량을 지키십시오.', '{"유통기한": "제조일로부터 24개월"}'::jsonb, 'BOTTLE', 'DARK', 'FOOD_SEALED', 'ON_SALE', 5, 'CALC', '300mg'),
  ('p05', '장케어 유산균 100억', 'HLT_FOOD', '19종 복합균 · 장까지 살아가는 코팅', 54000, NULL, '항생제 복용 중에는 2시간 간격을 두십시오.', '{"유통기한": "제조일로부터 24개월"}'::jsonb, 'POUCH', NULL, 'FOOD_SEALED', 'ON_SALE', 6, 'PROBIO', '100억 CFU'),
  ('p06', '마그네슘 350 데일리', 'HLT_FOOD', '산화마그네슘 · 눈떨림 고민에', 24900, NULL, '설사가 있으면 섭취를 줄이십시오.', '{"유통기한": "제조일로부터 24개월"}'::jsonb, 'BOTTLE', NULL, 'FOOD_SEALED', 'ON_SALE', 7, 'MAGNE', '350mg'),
  ('p07', '밀크씨슬 실리마린 130', 'HLT_FOOD', '간 건강 · 1일 1정', 33000, NULL, '국화과 알레르기가 있으면 피하십시오.', '{"유통기한": "제조일로부터 24개월"}'::jsonb, 'BOTTLE', NULL, 'FOOD_SEALED', 'ON_SALE', 8, 'MILK', '130mg'),
  ('p08', 'MSM 1500 관절', 'HLT_FOOD', '식물성 유황', 39000, NULL, '수술 예정이면 2주 전 중단하십시오.', '{"유통기한": "제조일로부터 24개월"}'::jsonb, 'BOTTLE', NULL, 'FOOD_SEALED', 'ON_SALE', 9, 'MSM', '1,500mg'),
  ('p09', '쏘팔메토 320 맨케어', 'HLT_FOOD', '1일 1정', 45000, NULL, '여성·청소년은 섭취를 권하지 않습니다.', '{"유통기한": "제조일로부터 24개월"}'::jsonb, 'BOTTLE', NULL, 'FOOD_SEALED', 'ON_SALE', 10, 'SAWPAL', '320mg'),
  ('p10', '양배추 매스틱 1000', 'HLT_FOOD', '속 편한 아침을 위해', 31000, NULL, '갑상선 질환이 있으면 전문가와 상담하십시오.', '{"유통기한": "제조일로부터 24개월"}'::jsonb, 'POUCH', NULL, 'FOOD_SEALED', 'ON_SALE', 11, 'CABBAGE', '1,000mg'),
  ('p11', '여주 사포닌 500', 'HLT_FOOD', '식전 섭취 권장', 28000, '특별가격', '저혈당 약을 복용 중이면 전문가와 상담하십시오.', '{"유통기한": "제조일로부터 24개월"}'::jsonb, 'BOTTLE', NULL, 'FOOD_SEALED', 'ON_SALE', 12, 'BITTER', '500mg'),
  ('p12', '저분자 콜라겐 1500', 'HLT_FOOD', '어류 유래 · 무향 분말', 42000, NULL, '어류 알레르기가 있으면 피하십시오.', '{"유통기한": "제조일로부터 24개월"}'::jsonb, 'POUCH', NULL, 'FOOD_SEALED', 'ON_SALE', 13, 'COLLA', '1,500mg'),
  ('p13', '굿나잇 멜라토닌 3', 'HLT_FOOD', '취침 30분 전', 82500, '특별가격', '운전 전에는 섭취하지 마십시오. 임신·수유 중에는 피하십시오.', '{"유통기한": "제조일로부터 24개월"}'::jsonb, 'BOTTLE', NULL, 'FOOD_SEALED', 'ON_SALE', 14, 'MELA', '3mg'),
  ('p14', '포스파티딜세린 300', 'HLT_FOOD', '1일 1정', 96000, NULL, '항응고제 복용 중이면 전문가와 상담하십시오.', '{"유통기한": "제조일로부터 24개월"}'::jsonb, 'BOTTLE', NULL, 'FOOD_SEALED', 'ON_SALE', 15, 'PS', '300mg'),
  ('p15', '멀티비타민 데일리팩', 'HLT_FUNC', '1일 1포 · 12종 비타민 + 9종 미네랄', 66000, NULL, '의약품을 복용 중이거나 임신·수유 중이면 전문가와 상담하십시오.', '{"유통기한": "제조일로부터 24개월"}'::jsonb, 'POUCH', NULL, 'FOOD_SEALED', 'STOPPED', 16, 'MULTI', '1일분'),
  ('p17', '데일리 콜라겐 수분 크림 50ml', 'HLT_COSMETIC', '견본 상품 · 바르는 보습 크림 · 무향', 24000, NULL, '상처가 있는 부위에는 바르지 마십시오. 사용 중 붉은 반점 · 가려움 등 이상이 있으면 사용을 멈추십시오.', '{"제조국": "대한민국"}'::jsonb, 'BOTTLE', NULL, 'GENERAL', 'ON_SALE', 17, 'COLLA', '50ml');
  CREATE TEMP TABLE _so (code text, months integer, price bigint, stock integer, tag text, sort integer) ON COMMIT DROP;
  INSERT INTO _so VALUES
  ('p01', 9, 35100, 26, '2+1', 1),
  ('p01', 6, 25200, 31, '1+1', 2),
  ('p01', 3, 14700, 54, NULL, 3),
  ('p02', 12, 34800, 18, '3+1', 1),
  ('p02', 6, 18600, 40, '1+1', 2),
  ('p02', 3, 9900, 66, NULL, 3),
  ('p03', 3, 20700, 19, '2+1', 1),
  ('p03', 1, 9900, 48, NULL, 2),
  ('p04', 6, 23400, 22, '1+1', 1),
  ('p04', 2, 9800, 35, NULL, 2),
  ('p16', 12, 33600, 14, '3+1', 1),
  ('p16', 6, 18600, 27, NULL, 2),
  ('p05', 6, 28200, 17, '1+1', 1),
  ('p05', 3, 15600, 29, NULL, 2),
  ('p06', 6, 17400, 44, '1+1', 1),
  ('p06', 3, 8700, 58, NULL, 2),
  ('p07', 6, 23400, 25, '1+1', 1),
  ('p07', 3, 12900, 37, NULL, 2),
  ('p08', 6, 23400, 20, '1+1', 1),
  ('p08', 3, 12600, 33, NULL, 2),
  ('p09', 6, 26400, 15, '1+1', 1),
  ('p09', 3, 14400, 26, NULL, 2),
  ('p10', 6, 17400, 0, '1+1', 1),
  ('p10', 3, 8970, 48, NULL, 2),
  ('p11', 6, 14940, 36, '1+1', 1),
  ('p11', 3, 8700, 52, NULL, 2),
  ('p12', 6, 27600, 28, '1+1', 1),
  ('p12', 3, 14700, 41, NULL, 2),
  ('p13', 3, 29700, 11, NULL, 1),
  ('p13', 1, 9900, 24, NULL, 2),
  ('p14', 3, 44700, 8, NULL, 1),
  ('p14', 1, 15900, 19, NULL, 2),
  ('p15', 6, 35400, 30, '1+1', 1),
  ('p15', 3, 19800, 44, NULL, 2),
  ('p17', NULL, 18000, 40, NULL, 1);
  FOR r IN SELECT s.*, c.id AS category_id FROM _sp s JOIN categories c ON c.gwan_code = 'HLT' AND c.code = s.cat ORDER BY s.n LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM hlt_products WHERE code = r.code);
    INSERT INTO hlt_products (code, name, category_id, price, stock, withdrawal_code, status, seller_id, summary, list_price, badge, caution, notice, art_form, art_tone, created_at)
    VALUES (r.code, r.name, r.category_id, (SELECT price FROM _so WHERE code = r.code ORDER BY sort DESC LIMIT 1), 0, r.wd, 'DRAFT', v_seller,
            r.summary, r.list_price, r.badge, r.caution, r.notice, r.art_form, r.art_tone, now() - make_interval(mins => r.n))
    RETURNING id INTO v_pid;
    INSERT INTO hlt_product_options (product_id, months, price, stock, tag, sort)
      SELECT v_pid, months, price, stock, tag, sort FROM _so WHERE code = r.code;
    INSERT INTO hlt_product_ingredients (product_id, ingredient_code, amount, sort, is_main) VALUES (v_pid, r.ing, r.amt, 0, true);
    UPDATE hlt_products SET status = r.status WHERE id = v_pid AND r.status <> 'DRAFT';
    n_new := n_new + 1;
  END LOOP;
  RAISE NOTICE '소개몰 견본: 새로 넣은 상품 %건', n_new;
END $$;
