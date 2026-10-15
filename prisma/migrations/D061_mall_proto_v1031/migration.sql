-- v10.31 (10/10 지시 「시안을 기준으로」 · 묶음 w3 · 소개몰) — 시안 구역 중 서버 자료가 없던 것.
--   ① 주문서 「배송 요청사항」 — 주문에 저장하고 판매자(운영) 발송 화면 · 내 주문 상세에 보임
--   ② 「오늘의 건강상품」 특가 배너 — 운영이 바꾸는 배너 자료(시안의 글은 견본 · 광고 심의 전이라 is_sample 로 표시)
--   ③ 「택배사에서 보기」 — 택배사별 조회 주소(택배사 코드 · 송장번호만 넘김 · 이름 · 주소 · 연락처는 넘기지 않음)

/* ── ① 배송 요청사항 ─────────────────────────────────────────────── */
ALTER TABLE public.hlt_orders ADD COLUMN IF NOT EXISTS ship_memo text
  CHECK (ship_memo IS NULL OR length(ship_memo) <= 50);
COMMENT ON COLUMN public.hlt_orders.ship_memo IS '배송 요청사항(시안 주문서 「부재 시 경비실에 맡겨 주세요」 · 50자) — 연락처 · 계좌 같은 글은 화면 · 서버가 거릅니다 · v10.31';

/* ── ② 특가 배너 ─────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.hlt_promos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot        text NOT NULL DEFAULT 'TODAY' CHECK (slot IN ('TODAY')),
  tag         text NOT NULL CHECK (length(btrim(tag)) BETWEEN 1 AND 30),
  title       text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 40),
  title_em    text CHECK (title_em IS NULL OR length(title_em) <= 40),
  body        text CHECK (body IS NULL OR length(body) <= 80),
  link_url    text NOT NULL CHECK (link_url ~ '^/health(/|$)'),
  cta         text NOT NULL DEFAULT '지금 바로 보기',
  is_sample   boolean NOT NULL DEFAULT true,
  is_active   boolean NOT NULL DEFAULT true,
  starts_at   timestamptz,
  ends_at     timestamptz,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
COMMENT ON TABLE public.hlt_promos IS '소개몰 메인 「오늘의 건강상품」 특가 배너(시안 · v10.31). is_sample=true 면 화면에 「견본 문구 — 광고 심의 확인 전」을 붙입니다 — 건강기능식품 기능성 문구는 인정 범위 · 광고 심의를 확인한 뒤 씁니다';
INSERT INTO public.hlt_promos (slot, tag, title, title_em, body, link_url, cta, is_sample, sort_order)
SELECT 'TODAY', '지금 가장 많이 찾는 건강상품', '환절기 면역력 강화', '비타민C 특가전', '온 가족이 함께하는 건강한 하루를 시작하세요.',
       '/health/i/VITC', '지금 바로 보기', true, 1
 WHERE NOT EXISTS (SELECT 1 FROM public.hlt_promos);

/* ── ③ 택배사 조회 주소 ─────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.hlt_carriers (
  name        text PRIMARY KEY,
  track_url   text NOT NULL CHECK (track_url ~ '^https://' AND position('{no}' in track_url) > 0),
  checked_at  timestamptz,
  note        text
);
COMMENT ON TABLE public.hlt_carriers IS '택배사 공개 조회 주소({no} = 송장번호) — 「택배사에서 보기」가 새 창으로 엽니다. 택배사 코드 · 송장번호만 넘깁니다(이름 · 주소 · 연락처 X). checked_at 이 비면 운영이 주소를 확인하기 전 · v10.31';
INSERT INTO public.hlt_carriers (name, track_url, note) VALUES
  ('CJ대한통운', 'https://trace.cjlogistics.com/next/tracking.html?wblNo={no}', '공개 조회 주소 — 운영 확인 전'),
  ('한진택배',   'https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&schLang=KR&wblnumText2={no}', '공개 조회 주소 — 운영 확인 전'),
  ('롯데택배',   'https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo={no}', '공개 조회 주소 — 운영 확인 전'),
  ('우체국택배', 'https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1={no}', '공개 조회 주소 — 운영 확인 전'),
  ('로젠택배',   'https://www.ilogen.com/web/personal/trace/{no}', '공개 조회 주소 — 운영 확인 전')
ON CONFLICT (name) DO NOTHING;
