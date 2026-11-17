-- v10.339 (docs/472) — 운영 화면 「업무 안내」 — 운영진 업무 순서 · 그 화면으로 가는 단추
--   대표 11/17 「업무별 워크 플로우 작성」 → 흐름표(운영진 12 · 비공개 웹 페이지) → 「다음개발」 ④ 업무 흐름표를 운영 화면에 · 「승인 + 통과하면 병합」.
--   글은 판으로 쌓습니다(고치기 · 지우기 없음 — 고치면 새 판). 고치기는 SUPER. 지우는 문장 없음 · 다시 돌려도 같음.

CREATE TABLE IF NOT EXISTS public.ops_guides (
  id         bigserial PRIMARY KEY,
  code       text NOT NULL CHECK (code ~ '^[A-Z][A-Z_]{2,29}$'),
  version    integer NOT NULL CHECK (version > 0),
  title      text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 60),
  who        text NOT NULL CHECK (char_length(who) BETWEEN 2 AND 40),
  steps      jsonb NOT NULL CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) BETWEEN 1 AND 15),
  note       text CHECK (note IS NULL OR char_length(note) <= 500),
  sort_order integer NOT NULL DEFAULT 100 CHECK (sort_order BETWEEN 0 AND 9999),
  is_active  boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);
COMMENT ON TABLE public.ops_guides IS 'v10.339 (D229) 운영 화면 「업무 안내」 — 업무마다 판을 쌓음(고치면 새 판 · 지우기 없음) · steps = [{t: 글, go: 운영 화면 탭}] · 고치기 SUPER';

CREATE OR REPLACE FUNCTION public.fn_ops_guides_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'OPS_GUIDE: 업무 안내는 고치거나 지우지 않고 새 판을 더합니다.';
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ops_guides_guard' AND tgrelid = 'public.ops_guides'::regclass) THEN
    CREATE TRIGGER trg_ops_guides_guard BEFORE UPDATE OR DELETE ON public.ops_guides FOR EACH ROW EXECUTE FUNCTION public.fn_ops_guides_guard();
  END IF;
END $$;

CREATE OR REPLACE VIEW public.v_ops_guide_current AS
SELECT DISTINCT ON (code) * FROM public.ops_guides ORDER BY code, version DESC;
COMMENT ON VIEW public.v_ops_guide_current IS 'v10.339 (D229) 업무마다 가장 높은 판';

INSERT INTO public.ops_guides (code, title, who, steps, note, sort_order, version)
SELECT v.code, v.title, v.who, v.steps, v.note, v.ord, 1 FROM (VALUES
  ('INQUIRY_ANSWER', '1:1 문의 답변', 'ADMIN', '[{"t": "상태 단추 「답변 전」 · 「기한 넘김」부터 엽니다(기한 = 접수 뒤 영업일 1일).", "go": "inquiries"}, {"t": "제목을 눌러 본문 · 첨부 · 이 회원의 지난 문의를 봅니다."}, {"t": "「답변 틀 고르기」로 칸을 채우고 고칩니다."}, {"t": "「답변 보내기」, 끝난 건이면 「보내고 닫기」 → 회원에게 알림이 갑니다."}, {"t": "필요하면 담당 지정 · 운영 메모(회원에게 안 보임)를 남깁니다."}]'::jsonb, '거래 분쟁은 여기서 답하지 말고 거래 › 분쟁으로 보냅니다(정산 보류). 기한 넘김 10건 이상이면 운영 알림 CRITICAL.', 10),
  ('FAQ_MANAGE', '자주 묻는 질문 관리', 'ADMIN', '[{"t": "표의 30일 「펼침 · 도움 됨 / 안 됨」을 봅니다.", "go": "faq"}, {"t": "「많이 찾는 질문 후보」에서 많이 찾는 질문으로 올릴 것을 고릅니다(최대 10개)."}, {"t": "「못 찾은 낱말 30일」에서 자주 나온 낱말은 「이 낱말로 새 질문」, 다룰 필요 없으면 「다룸」."}, {"t": "「도움 안 됨」이 많은 질문은 답을 고칩니다."}, {"t": "「숨김」 초안은 읽고 고친 뒤 「보이기」를 누릅니다."}]'::jsonb, '저장하면 사용자 웹 고객센터 · 이용안내 · 챗봇에 바로 나갑니다. 지우기는 없습니다(숨기기).', 20),
  ('MEMBER_ROLE', '회원에게 운영 권한 주기 · 거두기', 'SUPER', '[{"t": "회원을 찾아 상세를 엽니다.", "go": "members"}, {"t": "권한(운영 · 최고 관리자 · 검수 담당 · 안심 · 제휴 파트너 담당)을 고릅니다."}, {"t": "사유를 꼭 적고 「권한 주기」. 거둘 때는 그 권한 줄의 「거두기」."}]'::jsonb, '자기 권한은 바꿀 수 없고 마지막 SUPER 는 거둘 수 없습니다. 지급 담당은 여기서 주지 않습니다. 같은 기능: 권한 계층 › 권한 관리.', 30),
  ('REVIEW_QUEUE', '매물 · 글 검수', 'REVIEWER', '[{"t": "검수 큐에서 기한 가까운 순으로 엽니다(자동검수 · AI 보조 이유가 함께 보임).", "go": "queue"}, {"t": "승인 · 반려(사유)를 정합니다. 반려하면 등록자에게 알림이 갑니다."}, {"t": "표본 감사로 승인 건 일부를 다시 봅니다.", "go": "audit"}]'::jsonb, '검수 기한을 넘기면 매시간 정기 작업이 운영 알림을 띄웁니다.', 40),
  ('CATEGORY_APPROVE', '업종 승인', 'ADMIN', '[{"t": "회원이 요청한 새 업종을 봅니다.", "go": "category"}, {"t": "면허 · 등록이 필요한 업종인지 확인합니다(보험 · 의료는 자격 확인 업체만)."}, {"t": "승인하면 등록 폼에 나옵니다. 관을 켜려면 그 관에 승인 업종이 1개 이상 있어야 합니다."}]'::jsonb, NULL, 50),
  ('PARTNER_QUAL', '파트너 입점 · 자격 심사', 'ADMIN', '[{"t": "입점 신청을 열어 서류(사업자 · 면허 · 등록증)를 봅니다.", "go": "partners"}, {"t": "자격 심사에서 업종별 자격을 승인 · 반려합니다.", "go": "quals"}, {"t": "승인된 업체만 상담 신청을 배정받습니다 — 파트너사 › 파트너 › 리드 현황에서 받을 업체 0곳 업종을 봅니다.", "go": "partners"}, {"t": "법률 · 세무는 리드가 아니라 법률·세무 정액 노출로 관리합니다.", "go": "directory"}]'::jsonb, NULL, 60),
  ('DISPUTE', '거래 분쟁 처리', 'ADMIN', '[{"t": "분쟁 접수 건을 엽니다. 접수되면 그 거래 정산이 보류됩니다.", "go": "disputes"}, {"t": "양쪽 자료(계약 · 대화 · 첨부)를 확인합니다."}, {"t": "결정(지급 · 환불 · 나눔)을 사유와 함께 남깁니다."}, {"t": "결정 뒤 정산 보류가 풀리고 정산 흐름으로 넘어갑니다."}]'::jsonb, NULL, 70),
  ('SETTLE_PAYOUT', '정산 · 지급 · 포인트 출금', 'ADMIN', '[{"t": "정산 대상을 확인합니다(받을 계좌 확인이 안 된 회원은 「계좌 확인 필요」).", "go": "settlement"}, {"t": "ADMIN 이 확정합니다."}, {"t": "지급 담당(PAYOUT)이 지급합니다 — 확정한 사람과 다른 사람이어야 합니다.", "go": "payouts"}, {"t": "포인트 출금도 같은 순서입니다(신고 자료 CSV 는 PAYOUT)."}]'::jsonb, NULL, 80),
  ('MALL_OPS', '소개몰 판매자 · 주문', 'ADMIN', '[{"t": "입점 신청을 심사합니다(정지 · 폐점 · 수수료율도 여기서).", "go": "hlt-sellers"}, {"t": "상품 검수 → 노출.", "go": "hlt-products"}, {"t": "주문 · 반품을 처리합니다(화면의 배송비 · 반품 규칙을 따름).", "go": "hlt-orders"}, {"t": "개봉 반품은 재고 대장에 보관 · 폐기 · 반송으로 남깁니다(식품 · 화장품 재판매 금지).", "go": "hlt-open"}]'::jsonb, '「주문 받기」 · 입점 신청 켜기는 SUPER + 확인 문구 · 사유.', 90),
  ('OPS_ALERTS', '운영 알림 매일 확인', 'ADMIN', '[{"t": "CRITICAL 부터 봅니다(급한 것은 텔레그램 · 메일로도 옴).", "go": "ops-alerts"}, {"t": "원인을 처리하면 저절로 「풀림」. 처리할 것이 없으면 「확인」(여러 건 한꺼번에 가능)."}, {"t": "서버 오류는 서버 오류 탭, 개인정보 접속기록은 월 1회(SUPER).", "go": "server-errors"}]'::jsonb, NULL, 100),
  ('TERMS_PUBLISH', '약관 고치기 · 게시', 'SUPER', '[{"t": "「새 초안 고치기」로 새 판을 만듭니다.", "go": "terms"}, {"t": "빈칸 도우미로 〔 〕 빈칸을 채웁니다."}, {"t": "법무 검토 묶음을 보내고, 회신을 「법무 회신」에 적습니다."}, {"t": "「게시 준비」 한 장에서 남은 것을 봅니다. 「아직」이 있으면 「게시」를 입력해야 게시됩니다."}, {"t": "게시하면 시행일부터 「지금 판」. 재동의가 필요한 약관은 재동의 현황을 봅니다."}]'::jsonb, NULL, 110),
  ('LEAD_HALL_ON', '리드관(소개리드) 켜기 · 끄기', 'SUPER', '[{"t": "정책 › 전체 설정에서 lead.legal_ok 를 on 으로 바꾸고 사유(법무 회신 날짜)를 적습니다.", "go": "settings"}, {"t": "노출 › 메인 운영 › 관 노출에서 「소개리드」를 켭니다.", "go": "mainops/gwan"}, {"t": "사용자 웹 머리줄에 「소개리드」, /lead 가 열리는지, 안심소개 「생활 · 금융 상담」 탭이 빠졌는지 봅니다."}, {"t": "파트너사 › 파트너 › 리드 현황에서 신청 · 받을 업체 0곳 업종을 봅니다.", "go": "partners/status"}]'::jsonb, '끄기: 관 노출에서 소개리드를 숨기면 안심소개 상담 탭이 다시 나옵니다(자료 그대로).', 120)
) AS v(code, title, who, steps, note, ord)
WHERE NOT EXISTS (SELECT 1 FROM public.ops_guides g WHERE g.code = v.code);
