-- =====================================================================
-- D031 — v10.27 결함 수정판(2026-10-08 「결함은 전체 수정」)의 DB 부분
--
--   G-212 기준 데이터(B900)가 외래 키를 어긴 줄을 넣어 둠 — pg_dump 로 옮기면 외래 키 2개가 만들어지지 않았습니다.
--         없는 계정을 가리키는 「바꾼 사람」(site_settings.updated_by) · 없는 사업자를 가리키는 광고주(ad_placements.advertiser_business_id)를 비웁니다(NULL).
--         두 칸 모두 비어도 되는 칸이고, 가리키던 줄이 처음부터 없었으므로 잃는 정보가 없습니다.
--   G-172 쓰지 않는 빈 표 public._t 를 지웁니다(행 0 · 어디서도 참조하지 않음).
--   G-176 오픈 체크리스트(v_open_blockers)에 「간주 모드 켜짐」 줄 · 외부 연동 표에 「국토부 중개사 자격 대조」(BROKER).
--   G-190 제휴 주문 귀속 — 링크를 누른 방문자(aff_touches · 해시만) · 소개몰 주문의 귀속 링크(hlt_orders.aff_link_id) ·
--         결제되면 제휴 주문(partner_orders · PENDING) + 수익(partner_revenues) · 취소 · 반품이면 「취소」 + 수익 회수(− 줄).
--   G-191 소개광장 글 신고 — 신고 대상에 글(POST) · 자기 글은 신고 불가 · 서로 다른 회원 3명이 신고하면 글을 가림(HIDDEN).
--   재실행 안전.
-- =====================================================================

-- ── G-212 ──────────────────────────────────────────────────────────────
UPDATE public.site_settings s SET updated_by = NULL
 WHERE s.updated_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = s.updated_by);
UPDATE public.ad_placements p SET advertiser_business_id = NULL
 WHERE p.advertiser_business_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = p.advertiser_business_id);

-- ── G-172 ──────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS public._t;

-- ── G-176 ──────────────────────────────────────────────────────────────
INSERT INTO public.integrations (code, name, purpose, provider, status, requires_ip, secret_key_name, lead_time_weeks, blocks_open, memo, sort_order)
VALUES ('BROKER', '국토부 중개사 자격 대조', '안심소개 부동산 중개사 인증 — 개설등록 · 영업 상태 조회', '국토교통부(공공데이터)', 'NOT_STARTED', false,
        'BROKER_LOOKUP_KEY', 2, true, '키가 없으면 assume.broker(간주) 또는 운영자 수동 판정 — 오픈 전에 키를 넣고 간주를 끄십시오 (G-176 · v10.27)',
        coalesce((SELECT max(sort_order) + 10 FROM public.integrations), 100))
ON CONFLICT (code) DO NOTHING;

CREATE OR REPLACE VIEW public.v_open_blockers AS
 SELECT 'SETTING'::text AS kind,
    s.key AS item,
        CASE
            WHEN s.value IS NULL OR btrim(s.value) = ''::text THEN s.description
            WHEN (EXISTS ( SELECT 1
               FROM setting_placeholders p
              WHERE s.value ~~* (('%'::text || p.token) || '%'::text))) THEN '자리표시자가 남아 있습니다 — '::text || s.value
            WHEN s.value_pattern IS NOT NULL AND s.value !~ s.value_pattern THEN '형식 오류 — 예: '::text || COALESCE(s.value_example, ''::text)
            ELSE ('길이 부족 — '::text || COALESCE(s.min_length::text, ''::text)) || '자 이상'::text
        END AS reason
   FROM site_settings s
  WHERE s.is_required_for_open AND (s.value IS NULL OR btrim(s.value) = ''::text OR (EXISTS ( SELECT 1
           FROM setting_placeholders p
          WHERE s.value ~~* (('%'::text || p.token) || '%'::text))) OR s.value_pattern IS NOT NULL AND s.value !~ s.value_pattern OR s.min_length IS NOT NULL AND length(btrim(s.value)) < s.min_length)
UNION ALL
 SELECT 'TERM'::text AS kind,
    (t.code || ' '::text) || max(t.title) AS item,
    COALESCE(max(t.blocked_by), '내용 미작성'::text) AS reason
   FROM terms t
  WHERE t.is_required
  GROUP BY t.code
 HAVING count(*) FILTER (WHERE t.status = 'PUBLISHED'::text) = 0
UNION ALL
 SELECT 'FOOTER'::text AS kind,
    v_footer_links.label AS item,
    '목적지 없음 — '::text || COALESCE(v_footer_links.tip, '미정'::text) AS reason
   FROM v_footer_links
  WHERE NOT v_footer_links.available AND v_footer_links.section = 'LEGAL'::text
UNION ALL
 SELECT 'INTEGRATION'::text AS kind,
    integrations.name AS item,
    (('연동 미완료 ('::text || integrations.status) || ') — '::text) || integrations.purpose AS reason
   FROM integrations
  WHERE integrations.blocks_open AND integrations.status <> 'LIVE'::text
UNION ALL
 SELECT 'ASSUME'::text AS kind,
    s.key AS item,
    '간주 모드 켜짐 — 실제 확인 없이 통과시킵니다. 연동을 마친 뒤 끄십시오 (' || coalesce(s.description, s.key) || ')'::text AS reason
   FROM site_settings s
  WHERE s.key LIKE 'assume.%' AND s.value = 'on'
  ORDER BY 1, 2;
COMMENT ON VIEW public.v_open_blockers IS '오픈 전에 풀어야 할 것 — 설정 · 약관 · 바닥줄 · 외부 연동 · 간주 모드(D031 · G-176)';

-- ── 약관 초안의 박힌 시행일 (10/8 「운영 첫 발행은 DB 의 글」을 반영하며 찾음) ─────────────
--   기준선(B900)이 발행된 DB 에서 만들어져, 초안(DRAFT · LEGAL_REVIEW)의 본문 끝에 「시행일 2026년 11월 11일」이 박혀 있습니다.
--   그대로 발행하면 실제 시행일과 다른 날짜가 보입니다 — 발행할 때 채우는 자리표시자 〔시행일〕로 되돌립니다(발행된 판은 건드리지 않음).
UPDATE public.terms SET body = replace(body, '시행일 2026년 11월 11일', '시행일 〔시행일〕')
 WHERE status IN ('DRAFT', 'LEGAL_REVIEW') AND body LIKE '%시행일 2026년 11월 11일%';

-- ── G-190 제휴 주문 귀속 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.aff_touches (
  id           bigserial PRIMARY KEY,
  visitor_hash text NOT NULL CHECK (visitor_hash ~ '^[0-9a-f]{64}$'),
  link_id      uuid NOT NULL REFERENCES public.partner_links(id) ON DELETE CASCADE,
  clicked_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aff_touch_visitor ON public.aff_touches (visitor_hash, clicked_at DESC);
COMMENT ON TABLE public.aff_touches IS
  '제휴 링크를 누른 방문자 — 72시간 안의 소개몰 주문을 그 링크에 귀속하는 데만 씁니다. 방문자는 해시로만(쿠키 · IP 원문 없음). 7일 지난 줄은 지웁니다(D031 · G-190)';

ALTER TABLE public.hlt_orders
  ADD COLUMN IF NOT EXISTS aff_link_id uuid REFERENCES public.partner_links(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS aff_clicked_at timestamptz;
COMMENT ON COLUMN public.hlt_orders.aff_link_id IS '주문할 때 귀속된 제휴 링크(클릭 후 72시간 안 · 파트너 본인 주문 제외) — 결제되면 제휴 주문이 됩니다(D031 · G-190)';

CREATE OR REPLACE FUNCTION public.fn_hlt_aff_sync() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE l record; po record; v_day date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  /* 결제됨 — 제휴 주문(확정 전) + 수익 */
  IF NEW.aff_link_id IS NOT NULL AND OLD.status = 'PENDING' AND NEW.status = 'PAID' THEN
    SELECT pl.id, pl.partner_id, pl.product_id, ap.status AS product_status
      INTO l
      FROM public.partner_links pl JOIN public.affiliate_products ap ON ap.id = pl.product_id
     WHERE pl.id = NEW.aff_link_id;
    /* 그사이 판매가 멈춘 제휴상품이면 귀속하지 않습니다(주문 · 결제는 그대로) */
    IF l.id IS NOT NULL AND l.product_status = 'ON_SALE' THEN
      INSERT INTO public.partner_orders (order_no, link_id, partner_id, product_id, commission, clicked_at, ordered_at)
      VALUES (NEW.order_no, l.id, l.partner_id, l.product_id, 1, NEW.aff_clicked_at, NEW.created_at)
      ON CONFLICT (order_no) DO NOTHING
      RETURNING id, partner_id, commission, attributed INTO po;
      IF po.id IS NOT NULL THEN
        INSERT INTO public.partner_link_stats (link_id, stat_date, orders)
        VALUES (l.id, v_day, 1)
        ON CONFLICT (link_id, stat_date) DO UPDATE SET orders = public.partner_link_stats.orders + 1;
        IF po.attributed THEN
          INSERT INTO public.partner_revenues (partner_id, track, order_id, amount, occurred_on, memo)
          VALUES (po.partner_id, 'AFFILIATE', po.id, po.commission, v_day, '소개몰 주문 ' || NEW.order_no || ' 제휴수수료(확정 전)');
        END IF;
      END IF;
    END IF;
  END IF;

  /* 취소 · 반품 — 제휴 주문 「취소」 + 수익 회수 */
  IF NEW.status IN ('CANCELED', 'RETURNED') AND OLD.status NOT IN ('CANCELED', 'RETURNED') THEN
    UPDATE public.partner_orders
       SET state = 'CANCELED', cancel_reason = CASE WHEN NEW.status = 'CANCELED' THEN '주문 취소' ELSE '반품' END
     WHERE order_no = NEW.order_no AND state IN ('PENDING', 'CONFIRMED')
     RETURNING id, partner_id, commission, attributed INTO po;
    IF po.id IS NOT NULL AND po.attributed THEN
      INSERT INTO public.partner_revenues (partner_id, track, order_id, amount, occurred_on, memo)
      VALUES (po.partner_id, 'AFFILIATE', po.id, -po.commission, v_day,
              '소개몰 주문 ' || NEW.order_no || ' ' || CASE WHEN NEW.status = 'CANCELED' THEN '취소' ELSE '반품' END || ' — 제휴수수료 회수');
    END IF;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_hlt_aff_sync ON public.hlt_orders;
CREATE TRIGGER trg_hlt_aff_sync AFTER UPDATE OF status ON public.hlt_orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_aff_sync();

-- ── G-191 소개광장 글 신고 ─────────────────────────────────────────────
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_target_type_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type = ANY (ARRAY['LISTING','REQUEST','SERVICE','PROFILE','POST']));

CREATE OR REPLACE FUNCTION public.fn_report_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_owner uuid;
BEGIN
  IF NEW.target_type = 'LISTING' THEN
    SELECT owner_account_id INTO v_owner FROM listings WHERE id = NEW.target_id;
  ELSIF NEW.target_type = 'REQUEST' THEN
    SELECT owner_account_id INTO v_owner FROM requests WHERE id = NEW.target_id;
  ELSIF NEW.target_type = 'POST' THEN                      /* D031 · G-191 */
    SELECT author_id INTO v_owner FROM posts WHERE id = NEW.target_id;
    IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM posts WHERE id = NEW.target_id AND state IN ('PUBLISHED','HIDDEN')) THEN
      RAISE EXCEPTION 'REPORT: 신고할 수 없는 글입니다(없거나 지운 글)';
    END IF;
  END IF;

  IF v_owner IS NOT NULL AND v_owner = NEW.reporter_id THEN
    RAISE EXCEPTION 'REPORT: 자기 등록은 신고할 수 없습니다';
  END IF;

  IF NEW.state = 'UPHELD' AND coalesce(btrim(NEW.resolution), '') = '' THEN
    RAISE EXCEPTION 'REPORT: 인정할 때는 처리 내용을 적어야 합니다';
  END IF;
  IF NEW.state = 'DISMISSED' AND coalesce(btrim(NEW.resolution), '') = '' THEN
    RAISE EXCEPTION 'REPORT: 기각할 때는 사유를 적어야 합니다 — 신고자가 답을 받아야 합니다';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_report_escalate() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_cnt int; v_at int; v_gwan text; v_owner uuid; v_posters int;
BEGIN
  /* D031 · G-191 — 글은 사유와 관계없이 서로 다른 신고자 수를 세어 둡니다. 3명이면 가립니다(지우지 않음 — 운영이 확인) */
  IF NEW.target_type = 'POST' THEN
    SELECT count(DISTINCT reporter_id) INTO v_posters
      FROM reports WHERE target_type = 'POST' AND target_id = NEW.target_id AND state IN ('OPEN','QUEUED','UPHELD');
    UPDATE posts SET report_count = v_posters,
                     state = CASE WHEN v_posters >= 3 AND state = 'PUBLISHED' THEN 'HIDDEN' ELSE state END,
                     hidden_at = CASE WHEN v_posters >= 3 AND state = 'PUBLISHED' THEN now() ELSE hidden_at END,
                     hidden_reason = CASE WHEN v_posters >= 3 AND state = 'PUBLISHED' THEN '신고 3건 — 운영 확인 대기' ELSE hidden_reason END
     WHERE id = NEW.target_id;
  END IF;

  SELECT auto_queue_at INTO v_at FROM report_reasons WHERE code = NEW.reason_code;
  SELECT count(DISTINCT reporter_id) INTO v_cnt
    FROM reports
   WHERE target_type = NEW.target_type AND target_id = NEW.target_id
     AND reason_code = NEW.reason_code AND state IN ('OPEN','QUEUED');

  IF v_cnt >= coalesce(v_at, 3) OR (NEW.target_type = 'POST' AND v_posters >= 3) THEN
    UPDATE reports SET state = 'QUEUED'
     WHERE target_type = NEW.target_type AND target_id = NEW.target_id
       AND state = 'OPEN';

    IF NEW.target_type = 'LISTING'
       AND NOT EXISTS (SELECT 1 FROM review_items ri
                        WHERE ri.target_id = NEW.target_id AND ri.status = 'QUEUED') THEN
      SELECT gwan_code, owner_account_id INTO v_gwan, v_owner
        FROM listings WHERE id = NEW.target_id;
      IF v_owner IS NOT NULL THEN
        INSERT INTO review_items
          (target_type, target_id, gwan_code, submitted_by, status, decision_mode,
           sla_due_at)
        VALUES ('LISTING', NEW.target_id, coalesce(v_gwan,'MNY'), v_owner,
                'QUEUED', 'MANUAL', now() + interval '24 hours');
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END $$;
