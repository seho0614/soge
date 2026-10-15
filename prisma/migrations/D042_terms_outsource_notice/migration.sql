-- v10.28 (G-218 · 10/9 답 「알림으로」) — 개인정보 처리 위탁은 「동의」가 아니라 「알림」.
--   개인정보 보호법 제26조 — 처리 업무를 맡길 때는 맡기는 일과 맡는 곳을 정보주체가 언제든 쉽게 볼 수 있게 공개합니다(동의 대상이 아님).
--   전에는 위탁 약관의 제목이 「… 위탁 동의」 · 제4조가 「동의를 거부할 권리 — 거부하면 가입 · 이용이 어렵다」였고,
--   선택 약관(is_required = false)으로 가입 · 「선택 항목 바꾸기」에 동의 칸이 그려졌습니다(동의를 거부해도 아무 일이 없는 「동의」).
--
--   1) terms.is_notice — 알림(동의를 받지 않음). 동의 목록(/terms/required) · 가입 동의 · 「선택 항목 바꾸기」에 나오지 않고,
--      약관 목록 · 전문(/terms/OUTSOURCE)에는 「알림」으로 나옵니다.
--   2) 알림인 판에는 동의 기록을 남길 수 없습니다(트리거 — 서버가 422 NOTICE_ONLY 로 먼저 막고, 이것은 마지막 둑).
--      예전 판(1.0)에 남은 동의 · 거부 기록은 그때의 기록이라 그대로 둡니다(지우거나 고치지 않음).
--   3) 글 — scripts/terms-text.js 의 OUTSOURCE(= docs/terms/OUTSOURCE.md). D041 과 같은 방식:
--      초안이면 본문 · 제목만 고침(운영 서버 — 발행하면 1.0 이 알림으로 나감) · 발행된 판이면 다음 번호의 판을 알림으로 발행(이전 판은 보관).
--      필수 약관이 아니라 다시 동의 받을 것이 없습니다.

ALTER TABLE public.terms ADD COLUMN IF NOT EXISTS is_notice boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.terms.is_notice IS '알림(동의를 받지 않는 안내 — 예: 개인정보 처리 위탁) — v10.28 G-218';

DO $$
DECLARE
  r record; v_ver text; v_day text := to_char((now() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY"년" FMMM"월" FMDD"일"');
  v_body text := $TERM$# 개인정보 처리 위탁 안내

> 이 글은 **알림**입니다. 동의를 받는 항목이 아니며, 따로 동의하실
> 것은 없습니다. 개인정보 보호법 제26조에 따라 회사가 개인정보 처리
> 업무를 맡기는 곳과 그 일을 알려 드립니다.

## 제1조 (왜 맡기는가)
서비스를 돌리려면 서버 · 결제 · 발송을 전문 업체에 맡겨야
합니다. 그 과정에서 개인정보가 전달됩니다.

## 제2조 (맡기는 곳과 하는 일)

| 맡는 곳 | 무엇을 | 무엇이 전달되나 |
|---|---|---|
| Amazon Web Services | 서버 · 저장소 | 저장된 모든 정보 |
| 본인인증 기관 | 본인 확인 | 이름 · 생년월일 · 연락처 |
| 전자결제 대행사 | 결제 처리 | 결제 정보 |
| 알림톡 · 문자 발송사 | 알림 발송 | 연락처 |
| 전자계약 사업자 | 계약서 서명 | 이름 · 연락처 |

## 제3조 (관리)
① 맡기는 곳과 **위탁 계약**을 맺고, 개인정보를 목적 밖으로 쓰지
   않도록 정합니다.
② 맡기는 곳이나 맡기는 일이 바뀌면 **이 안내를 고쳐 미리 알려
   드립니다.**
③ 서버는 **대한민국(서울)** 에 있습니다. 국외로 보내지 않습니다.

## 제4조 (알림)
① 이 안내는 **동의를 받는 항목이 아닙니다.** 가입이나 이용 때 따로
   고르실 것이 없습니다.
② 이 안내는 개인정보처리방침과 함께 언제든 보실 수 있도록
   공개합니다.

---

시행일 〔시행일〕$TERM$;
  v_title text := '개인정보 처리업무 위탁 안내';
  v_note text := '「동의」 → 「알림」 — 동의를 받는 항목이 아니라 맡기는 곳 · 일을 알려 드리는 안내(개인정보 보호법 제26조) · 바뀌면 이 안내를 고쳐 미리 알림';
BEGIN
  /* 필수 약관인 위탁은 알림으로 바꾸지 않습니다(그런 판이 있으면 사람이 봐야 함) */
  IF EXISTS (SELECT 1 FROM public.terms WHERE code = 'OUTSOURCE' AND is_required AND status <> 'ARCHIVED') THEN
    RAISE EXCEPTION 'OUTSOURCE 가 필수 약관으로 되어 있습니다 — 알림으로 바꾸기 전에 확인하십시오';
  END IF;
  /* 초안 — 본문 · 제목 · 알림 표시 */
  UPDATE public.terms SET body = v_body, title = v_title, is_notice = true, change_note = v_note
   WHERE code = 'OUTSOURCE' AND status IN ('DRAFT','LEGAL_REVIEW');
  /* 발행된 판 — 같은 글이면 알림 표시만(재실행 안전) · 다르면 다음 번호의 판을 알림으로 발행 */
  SELECT * INTO r FROM public.terms WHERE code = 'OUTSOURCE' AND status = 'PUBLISHED' ORDER BY effective_from DESC LIMIT 1;
  IF r.code IS NULL THEN RETURN; END IF;
  IF fn_term_body_norm(r.body) = fn_term_body_norm(v_body) THEN
    UPDATE public.terms SET is_notice = true WHERE code = r.code AND version = r.version AND NOT is_notice;
    RETURN;
  END IF;
  v_ver := split_part(r.version, '.', 1) || '.' || (split_part(r.version, '.', 2)::int + 1);
  WHILE EXISTS (SELECT 1 FROM public.terms WHERE code = r.code AND version = v_ver) LOOP
    v_ver := split_part(v_ver, '.', 1) || '.' || (split_part(v_ver, '.', 2)::int + 1);
  END LOOP;
  INSERT INTO public.terms (code, version, title, body, is_required, effective_from, status, display_order, gwan_code, change_note, is_notice)
  VALUES (r.code, v_ver, v_title, replace(v_body, '〔시행일〕', v_day), false, 'infinity', 'LEGAL_REVIEW', r.display_order, r.gwan_code, v_note, true);
  UPDATE public.terms SET status = 'PUBLISHED', effective_from = now(), blocked_by = NULL WHERE code = r.code AND version = v_ver;
  RAISE NOTICE 'OUTSOURCE % 발행 — 알림(이전 % 는 보관 · 그 판의 동의 기록은 그대로)', v_ver, r.version;
END $$;

/* 알림인 판에는 동의 기록을 남기지 않습니다 — 마지막 둑 */
CREATE OR REPLACE FUNCTION public.fn_term_agreement_no_notice() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.terms t WHERE t.code = NEW.term_code AND t.version = NEW.term_version AND t.is_notice) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOTICE_ONLY',
      DETAIL = '알림(동의를 받지 않는 안내)에는 동의 기록을 남기지 않습니다: ' || NEW.term_code || ' ' || NEW.term_version;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_term_agreement_no_notice ON public.term_agreements;
CREATE TRIGGER trg_term_agreement_no_notice BEFORE INSERT ON public.term_agreements
  FOR EACH ROW EXECUTE FUNCTION public.fn_term_agreement_no_notice();
