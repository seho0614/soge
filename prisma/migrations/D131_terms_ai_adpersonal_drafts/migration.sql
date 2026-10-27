-- =====================================================================
-- D131 — v10.133 (2026-10-27 · 처리방침 · 위탁 안내 · 맞춤형 광고 약관 새 판 초안 · docs/199)
--
--   대표 「4.4 초안으로 넣어 두기」 — **게시하지 않습니다.** 법무가 운영 화면 「약관」에서 읽고 고친 뒤 게시.
--   글의 원본은 scripts/terms-text.js(PRIVACY · OUTSOURCE · ADPERSONAL) — 이 파일과 같아야 함(test_v1133).
--   판마다: ① 초안(DRAFT · LEGAL_REVIEW)이 있으면 그 글만 바꿈 ② 게시된 판만 있고 글이 다르면 다음 번호로 LEGAL_REVIEW 초안을 만듦
--           ③ 게시된 판과 글이 같으면 아무것도 안 함. 게시 · 시행일 · 동의 기록은 건드리지 않음.
--   〔확인 필요〕 칸(Anthropic 연락처 · 보관 기간)은 그대로 — 법무 확인 때 채움. 재실행 안전 · 자료를 지우지 않음.
-- =====================================================================

DO $$
DECLARE v_body text := $TERM$# 개인정보처리방침

**(주)한국바이오헬스케어 소개뱅크 사업부**(이하 "회사")는 회원의
개인정보를 소중히 다룹니다.

## 제1조 (수집하는 것)

### 가입하고 인증할 때
가입할 때는 **이름 · 연락처 · 이메일만** 필수로 받습니다.

| 항목 | 언제 | 왜 |
|---|---|---|
| 이름 · 연락처 · 이메일 | 가입할 때(필수) | 본인 확인 · 안내 |
| 본인인증 결과(CI) | 본인인증을 하실 때 | 중복 가입 방지 |
| 사업자등록번호 · 상호 · 대표자 | 사업자 인증을 하실 때 | 사업자 확인 |

> **본인인증 원문은 저장하지 않습니다.** 해시값(CI)만 남깁니다.

### 상담을 신청할 때
회원이 아니어도 안심소개에서 상담을 신청하실 수 있습니다.

| 항목 | 왜 |
|---|---|
| 이름 · 휴대폰 번호 · **이메일** · 지역 · 상담 내용 | 상담 연결 |

이메일은 **확인 번호를 보내는 데** 쓰고, 상담을 맡는 업체에도 전달합니다.
**확인을 마치기 전에는 업체에 아무것도 전달하지 않습니다.**

### 쓰시는 동안
```
접속 기록 · 기기 정보 · 서비스 이용 기록
거래 · 정산 내역
```

### 돈을 주고받을 때
```
정산 계좌 (은행 · 계좌번호 · 예금주)
```
**계좌번호는 암호화해 보관하고 화면에는 뒤 4자리만 보여 드립니다.**

## 제2조 (쓰는 목적)
- 회원 확인과 서비스 제공
- 거래 기록 보존과 분쟁 대응
- 정산과 세무 처리
- 부정 이용 방지
- 법령이 정한 의무 이행

## 제3조 (보관 기간)

| 무엇 | 얼마 | 근거 |
|---|---|---|
| 회원 정보 | 탈퇴 시까지 | — |
| 계약·청약철회 기록 | **5년** | 전자상거래법 |
| 대금결제·재화공급 기록 | **5년** | 전자상거래법 |
| 소비자 불만·분쟁 기록 | **3년** | 전자상거래법 |
| 접속 기록 | **3개월** | 통신비밀보호법 |
| 세금계산서 | **5년** | 국세기본법 |
| 상담 신청 정보 | 상담이 끝나거나 **6개월** | 신청할 때 받은 동의 |
| AI 상담 대화 | **5년** | 상담 품질 확인 · 분쟁 대응 |

탈퇴하셔도 위 기간 동안은 **법령에 따라** 보관합니다. 그 기간이
지나면 지웁니다.

## 제4조 (제3자에게 주는 경우)
회사는 원칙적으로 개인정보를 남에게 주지 않습니다. 다만 다음은
예외입니다.

① 회원이 **따로 동의**하신 경우 (「제3자 제공 동의」 참조)
② 법령에 따라 **수사기관이 적법한 절차**로 요구한 경우
③ **상담을 신청하며 동의**하신 경우 — 그 업종의 **인증업체 1곳**에
   이름 · 휴대폰 번호 · **이메일** · 지역 · 상담 내용을 전달합니다.

## 제5조 (처리를 맡기는 곳)

| 맡는 곳 | 무엇을 |
|---|---|
| Amazon Web Services | 서버 · 저장소 운영 |
| 본인인증 기관 | 본인 확인 |
| 전자결제 대행사 | 결제 처리 |
| 알림톡 · 문자 발송사 | 알림 발송 |
| 전자계약 사업자 | 계약서 서명 |
| Anthropic, PBC(미국) | AI 상담 답변 · 등록 글 · 게시글 번역 · 등록 글 검수 의견 만들기 |

맡기는 곳이 바뀌면 **미리 알려 드립니다.**

## 제6조 (국외 이전)
서버는 **대한민국(서울)** 에 있습니다. 다만 아래 AI 기능을 쓰실 때에는
개인정보가 담긴 글이 국외로 전송됩니다(개인정보 보호법 제28조의8).

| 항목 | 내용 |
|---|---|
| 받는 곳 | Anthropic, PBC (미국) · 연락처 〔확인 필요〕 |
| 받는 나라 | 미국 |
| 보내는 때 · 방법 | 기능을 쓸 때마다 암호화된 통신(HTTPS)으로 전송 |
| 보내는 것 | ① AI 상담 질문 — 전화번호 · 이메일 · 링크 · 메신저 아이디 · 주민등록번호 · 카드번호 · 계좌번호는 **가리고** 보냅니다 |
|  | ② 검수할 등록 글 — 전화번호 · 이메일 · 링크 · 메신저 아이디는 가리고, 등록한 분의 이름 · 연락처 · 사업자번호는 보내지 않습니다 |
|  | ③ 번역할 등록 글 · 게시글의 제목 · 본문 — 누구나 볼 수 있게 공개되는 글을 그대로 보냅니다 |
| 쓰는 목적 | 답변 · 번역 · 검수 의견을 만드는 것 |
| 받는 곳의 보관 기간 | 〔확인 필요 — Anthropic API 의 데이터 보관 정책〕 |
| 원하지 않으실 때 | AI 상담 대신 고객센터 1:1 문의를 쓰시면 국외로 보내지 않습니다 |

## 제7조 (회원의 권리)
언제든지 다음을 하실 수 있습니다.

```
내 정보 보기 · 고치기 · 지우기 · 처리 정지 요구
```

마이페이지에서 직접 하시거나, 아래 연락처로 요청하시면 **10일 안에**
처리합니다.

> **인증이 끝난 사업자 정보는 바로 못 고칩니다.** 국세청이 확인한
> 내용과 달라지기 때문입니다 — 다시 인증하셔야 합니다.

## 제8조 (검색어)
① 검색어는 **무엇을 찾으시는지 알아내기 위해 일시적으로만**
   처리하며, **저장하지 않습니다.**
② 검색할 때 회원의 계정 정보를 함께 보내지 않습니다. 로그인
   여부와 무관하게 같은 결과가 나옵니다.

## 제9조 (안전 조치)
```
접속 권한 관리 · 접근 기록 보관
계좌번호 암호화 · 전송 구간 암호화(HTTPS)
```
운영자가 회원 정보를 열어 본 기록도 남깁니다(개인정보 보호법 29조).

## 제10조 (자동 수집 장치)
① 서비스 이용에 꼭 필요한 쿠키만 씁니다.
② 브라우저 설정에서 거부하실 수 있으나, 일부 기능이 제한됩니다.
③ 방문자 쿠키와, 접속 주소를 알아볼 수 없게 바꾼 값은 **유입 기록과
   투표 중복 방지**에 씁니다.

## 제11조 (만 14세 미만)
회사는 **만 19세 이상만 가입**할 수 있으므로 만 14세 미만의 개인정보를
수집하지 않습니다.

## 제12조 (개인정보 보호책임자)

```
책임자   노명석
전화     1688-2887
주소     서울 금천구 디지털로9길 65 (가산동, 백상스타타워1차) 307호
```

**신고·상담 기관**
```
개인정보침해신고센터   privacy.kisa.or.kr · 118
개인정보분쟁조정위원회  kopico.go.kr · 1833-6972
대검찰청 사이버수사과   spo.go.kr · 1301
경찰청 사이버수사국    ecrm.police.go.kr · 182
```

## 제13조 (변경)
이 방침이 바뀌면 **시행 7일 전**에 알려 드립니다.

---

시행일 〔시행일〕$TERM$;
  v_note text := $N$v10.133 초안 — AI 기능(Anthropic · 미국) 국외 이전 · 처리 위탁 · AI 상담 대화 5년 보관(docs/176 · 법무 확인 전)$N$;
  r record; v_ver text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.terms WHERE code = 'PRIVACY' AND status IN ('DRAFT','LEGAL_REVIEW')) THEN
    UPDATE public.terms SET body = v_body, change_note = v_note
     WHERE code = 'PRIVACY' AND status IN ('DRAFT','LEGAL_REVIEW') AND body IS DISTINCT FROM v_body;
    RETURN;
  END IF;
  SELECT * INTO r FROM public.terms WHERE code = 'PRIVACY' AND status = 'PUBLISHED' ORDER BY effective_from DESC LIMIT 1;
  IF r.code IS NULL OR fn_term_body_norm(r.body) = fn_term_body_norm(v_body) THEN RETURN; END IF;
  v_ver := split_part(r.version, '.', 1) || '.' || (split_part(r.version, '.', 2)::int + 1);
  WHILE EXISTS (SELECT 1 FROM public.terms WHERE code = r.code AND version = v_ver) LOOP
    v_ver := split_part(v_ver, '.', 1) || '.' || (split_part(v_ver, '.', 2)::int + 1);
  END LOOP;
  INSERT INTO public.terms (code, version, title, body, is_required, effective_from, status, display_order, gwan_code, change_note, is_notice)
  VALUES (r.code, v_ver, r.title, v_body, r.is_required, 'infinity', 'LEGAL_REVIEW', r.display_order, r.gwan_code, v_note, r.is_notice);
  RAISE NOTICE 'PRIVACY % 초안(LEGAL_REVIEW) — 게시된 % 는 그대로', v_ver, r.version;
END $$;

DO $$
DECLARE v_body text := $TERM$# 개인정보 처리 위탁 안내

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
| Anthropic, PBC(미국) | AI 답변 · 번역 · 검수 의견 | AI 상담 질문(연락처 · 주민등록번호 · 계좌번호 등은 가림) · 등록 글 · 게시글(검수용은 연락처를 가림 · 번역용은 공개 글 그대로) |

## 제3조 (관리)
① 맡기는 곳과 **위탁 계약**을 맺고, 개인정보를 목적 밖으로 쓰지
   않도록 정합니다.
② 맡기는 곳이나 맡기는 일이 바뀌면 **이 안내를 고쳐 미리 알려
   드립니다.**
③ 서버는 **대한민국(서울)** 에 있습니다. AI 기능을 쓸 때에는 위
   업체(미국)로 전송됩니다 — 개인정보처리방침 제6조.

## 제4조 (알림)
① 이 안내는 **동의를 받는 항목이 아닙니다.** 가입이나 이용 때 따로
   고르실 것이 없습니다.
② 이 안내는 개인정보처리방침과 함께 언제든 보실 수 있도록
   공개합니다.

---

시행일 〔시행일〕$TERM$;
  v_note text := $N$v10.133 초안 — Anthropic(미국) 위탁 한 줄 · 국외 전송 안내(docs/176 · 법무 확인 전)$N$;
  r record; v_ver text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.terms WHERE code = 'OUTSOURCE' AND status IN ('DRAFT','LEGAL_REVIEW')) THEN
    UPDATE public.terms SET body = v_body, change_note = v_note
     WHERE code = 'OUTSOURCE' AND status IN ('DRAFT','LEGAL_REVIEW') AND body IS DISTINCT FROM v_body;
    RETURN;
  END IF;
  SELECT * INTO r FROM public.terms WHERE code = 'OUTSOURCE' AND status = 'PUBLISHED' ORDER BY effective_from DESC LIMIT 1;
  IF r.code IS NULL OR fn_term_body_norm(r.body) = fn_term_body_norm(v_body) THEN RETURN; END IF;
  v_ver := split_part(r.version, '.', 1) || '.' || (split_part(r.version, '.', 2)::int + 1);
  WHILE EXISTS (SELECT 1 FROM public.terms WHERE code = r.code AND version = v_ver) LOOP
    v_ver := split_part(v_ver, '.', 1) || '.' || (split_part(v_ver, '.', 2)::int + 1);
  END LOOP;
  INSERT INTO public.terms (code, version, title, body, is_required, effective_from, status, display_order, gwan_code, change_note, is_notice)
  VALUES (r.code, v_ver, r.title, v_body, r.is_required, 'infinity', 'LEGAL_REVIEW', r.display_order, r.gwan_code, v_note, r.is_notice);
  RAISE NOTICE 'OUTSOURCE % 초안(LEGAL_REVIEW) — 게시된 % 는 그대로', v_ver, r.version;
END $$;

DO $$
DECLARE v_body text := $TERM$# 맞춤형 광고 동의

## 제1조 (무엇을 하는가)
회원이 **관심 성향 설문에 답한 내용**과, 이 동의를 하신 **뒤에 광고를
누른 기록**으로 관심 있을 만한 광고를 골라 보여 드립니다.

## 제2조 (쓰는 정보)
```
관심 성향 설문에서 고르신 답
이 동의를 하신 뒤 누르신 광고의 분류
```

**동의하시기 전의 기록, 검색하신 글의 원문, 회원의 이름 · 연락처 ·
사업자등록번호는 쓰지 않습니다.**

## 제3조 (거부할 권리)
① 이 동의는 **선택 사항**입니다.
② 동의하지 않으셔도 서비스를 그대로 쓰실 수 있습니다. 다만
   **모든 분에게 똑같이 나가는 광고**가 보입니다.
③ 언제든지 마이페이지에서 철회하실 수 있습니다. 철회하시면 성향
   정보를 **바로 지우고**, 광고를 보고 누른 기록에서 회원과의 연결을
   끊어 누구의 기록인지 알 수 없게 합니다.

## 제4조 (제3자에게 주지 않습니다)
① 회사는 이 정보를 **광고주에게 넘기지 않습니다.**
② 광고주는 "몇 명이 보았고 몇 명이 눌렀다"는 **집계만** 받습니다.
   누가 보았는지는 알 수 없습니다.

## 제5조 (보관)
```
성향 정보            철회하시거나 탈퇴하실 때까지 (철회하면 바로 지움)
광고 노출 · 클릭 기록  3년 (광고비 정산 근거 · 철회하시면 회원과의 연결을 끊음)
```

---

시행일 〔시행일〕$TERM$;
  v_note text := $N$v10.133 초안 — 실제 동작(설문 답 + 동의 뒤 광고 클릭 · 철회하면 바로 지움 · v10.115 D123)에 맞춤(docs/179 4절 · 법무 확인 전)$N$;
  r record; v_ver text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.terms WHERE code = 'ADPERSONAL' AND status IN ('DRAFT','LEGAL_REVIEW')) THEN
    UPDATE public.terms SET body = v_body, change_note = v_note
     WHERE code = 'ADPERSONAL' AND status IN ('DRAFT','LEGAL_REVIEW') AND body IS DISTINCT FROM v_body;
    RETURN;
  END IF;
  SELECT * INTO r FROM public.terms WHERE code = 'ADPERSONAL' AND status = 'PUBLISHED' ORDER BY effective_from DESC LIMIT 1;
  IF r.code IS NULL OR fn_term_body_norm(r.body) = fn_term_body_norm(v_body) THEN RETURN; END IF;
  v_ver := split_part(r.version, '.', 1) || '.' || (split_part(r.version, '.', 2)::int + 1);
  WHILE EXISTS (SELECT 1 FROM public.terms WHERE code = r.code AND version = v_ver) LOOP
    v_ver := split_part(v_ver, '.', 1) || '.' || (split_part(v_ver, '.', 2)::int + 1);
  END LOOP;
  INSERT INTO public.terms (code, version, title, body, is_required, effective_from, status, display_order, gwan_code, change_note, is_notice)
  VALUES (r.code, v_ver, r.title, v_body, r.is_required, 'infinity', 'LEGAL_REVIEW', r.display_order, r.gwan_code, v_note, r.is_notice);
  RAISE NOTICE 'ADPERSONAL % 초안(LEGAL_REVIEW) — 게시된 % 는 그대로', v_ver, r.version;
END $$;
