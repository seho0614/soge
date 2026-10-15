-- v10.31 (W5 · 10/10 시안 기준) — 성과 관리(SB-PTC-CTR-450 이행 보고) · 실적(CTR-500 성사) · 신뢰지표(CTR-600 배지)
--
--   1) 이행 보고: 계약 성사형은 파트너가 이행을 보고하고 **소비자가 확인해야 성사**입니다(시안 perf.note).
--      보고는 확인비용을 낸(연락처를 연) 배정 건에만 · 한 건에 한 번. 소비자 확인은 그 상담 신청을 낸 회원만(요청자 계정이 없는 옛 · 비회원 신청은
--      확인 화면이 없어 「고객 확인 대기」로 남습니다 — 화면에 그대로 표시).
--   2) 신뢰 배지: 파트너가 켜고 끄지 않습니다 — **조건이 만들고, 조건이 사라지면 자동으로 내려갑니다**(시안 trust.note).
--      조건(누적 성사 · 평점 · 무분쟁 기간 · 자격 제출)은 규칙 표에 두고, 값은 조회할 때 실제 자료로 셉니다(저장하지 않음).
--      「누적 ○○」 라벨은 업종별(categories.trust_label) — 시안 경고(태양광 라벨이 다른 업종에도 나옴)를 고칩니다.

CREATE TABLE public.partner_fulfillment_reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id        uuid NOT NULL REFERENCES public.partners(id),
  delivery_id       uuid NOT NULL UNIQUE REFERENCES public.lead_deliveries(id),
  service_id        uuid REFERENCES public.partner_services(id),
  content           text NOT NULL CHECK (length(btrim(content)) BETWEEN 2 AND 300),
  done_on           date NOT NULL,
  amount            bigint CHECK (amount IS NULL OR (amount > 0 AND amount <= 10000000000)),
  consumer_state    text NOT NULL DEFAULT 'WAITING' CHECK (consumer_state IN ('WAITING','CONFIRMED','DISPUTED')),
  consumer_at       timestamptz,
  consumer_rating   smallint CHECK (consumer_rating IS NULL OR consumer_rating BETWEEN 1 AND 5),
  consumer_note     text CHECK (consumer_note IS NULL OR length(consumer_note) <= 500),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_pfr_consumer CHECK ((consumer_state = 'WAITING') = (consumer_at IS NULL))
);
CREATE INDEX idx_pfr_partner ON public.partner_fulfillment_reports(partner_id, created_at DESC);
COMMENT ON TABLE public.partner_fulfillment_reports IS '이행 보고(D073) — 소비자 확인(CONFIRMED)이 「성사」입니다. 성사는 이용료와 무관합니다(정보 이용료 · 열람 시점 확정)';

CREATE FUNCTION public.fn_fulfillment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d record;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'FULFILL: 이행 보고는 지울 수 없습니다'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT ld.partner_id, ld.viewed_at, ld.state, l.requester_account_id, b.account_id AS owner
      INTO d
      FROM lead_deliveries ld JOIN leads l ON l.id = ld.lead_id
      JOIN partners p ON p.id = ld.partner_id JOIN businesses b ON b.id = p.business_id
     WHERE ld.id = NEW.delivery_id;
    IF d.partner_id IS DISTINCT FROM NEW.partner_id THEN RAISE EXCEPTION 'FULFILL: 받은 리드가 아닙니다'; END IF;
    IF d.viewed_at IS NULL THEN RAISE EXCEPTION 'FULFILL: 연락처를 연(확인비용을 낸) 건만 이행을 보고할 수 있습니다'; END IF;
    IF NEW.done_on > (now() AT TIME ZONE 'Asia/Seoul')::date THEN RAISE EXCEPTION 'FULFILL: 이행일이 오늘보다 뒤입니다'; END IF;
    IF NEW.content ~ '01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}' THEN RAISE EXCEPTION 'FULFILL: 보고 내용에 전화번호를 적지 마십시오'; END IF;
    NEW.consumer_state := 'WAITING'; NEW.consumer_at := NULL; NEW.consumer_rating := NULL; NEW.consumer_note := NULL;
    RETURN NEW;
  END IF;
  /* UPDATE — 보고 내용은 소비자 확인 전까지만, 확인 결과는 한 번만 */
  IF OLD.consumer_state <> 'WAITING' AND (NEW.consumer_state <> OLD.consumer_state OR NEW.consumer_rating IS DISTINCT FROM OLD.consumer_rating
       OR NEW.content <> OLD.content OR NEW.done_on <> OLD.done_on OR NEW.amount IS DISTINCT FROM OLD.amount) THEN
    RAISE EXCEPTION 'FULFILL: 소비자가 확인한 보고는 바꿀 수 없습니다';
  END IF;
  IF NEW.partner_id <> OLD.partner_id OR NEW.delivery_id <> OLD.delivery_id THEN
    RAISE EXCEPTION 'FULFILL: 보고 대상은 바꿀 수 없습니다';
  END IF;
  IF NEW.consumer_state <> 'WAITING' AND OLD.consumer_state = 'WAITING' THEN NEW.consumer_at := now(); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_fulfillment_guard BEFORE INSERT OR UPDATE OR DELETE ON public.partner_fulfillment_reports
  FOR EACH ROW EXECUTE FUNCTION public.fn_fulfillment_guard();

-- ---------------------------------------------------------------------
-- 신뢰 배지 규칙(시안 trust.badges 의 조건 그대로)
-- ---------------------------------------------------------------------
CREATE TABLE public.partner_badge_rules (
  code        text PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('DEALS','RATING','NO_DISPUTE','QUALIFICATION')),
  name_tpl    text NOT NULL,                 -- {label} {n} 자리표시
  threshold   numeric,
  months      int,
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  note        text
);
INSERT INTO public.partner_badge_rules(code, kind, name_tpl, threshold, months, sort_order, note) VALUES
 ('DEALS_500', 'DEALS', '누적 {label} {n}건 이상', 500, NULL, 1, '소비자가 확인한 이행 보고(성사) 수 — 라벨은 업종별(categories.trust_label)'),
 ('RATING_45', 'RATING', '평점 {n} 이상', 4.5, NULL, 2, '거래 후기(deal_reviews) · 이행 확인 평점의 평균'),
 ('NO_DISPUTE_3M', 'NO_DISPUTE', '{n}개월 무분쟁', NULL, 3, 3, '입점(승인) 뒤 그 기간 동안 거래 분쟁 · 이행 이의가 없음'),
 ('QUAL_SUBMIT', 'QUALIFICATION', '자격증 제출', NULL, NULL, 4, '규제 업종 자격 심사 — 승인되면 달성 · 심사 중이면 심사중');

/* 파트너의 배지 — 조회할 때 셉니다(저장하지 않음 → 조건이 사라지면 바로 내려감) */
CREATE FUNCTION public.fn_partner_badges(p_partner uuid)
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
   GROUP BY c.trust_label ORDER BY (c.trust_label IS NULL), count(*) DESC LIMIT 1;
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
