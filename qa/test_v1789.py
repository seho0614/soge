"""v10.789 (docs/904) 사내 웹메일 W1-1 — 공용 메일함 받기(SES 받기 → SNS → 웹훅) · 코드 시험
  ① D330 — 표 5 · 공용 주소 4 · 설정 2(처음 off) · 열람 기록 쌓기만 트리거 · 업무 권한 3 · 주소 표 · 정규식 반복 255 안
  ② 받기 — 공개 웹훅 /webhooks/ses/inbound · 스위치 · 주제 · AWS 서명(v10.209 snsVerify) · SNS 번호 한 번만 · S3 · SNS 두 알림 합침 · 새 패키지 없음
  ③ verify-all 에 scripts/test-mail-inbound.ts(MIME · 서명 · 합침 · 알림 · 지우기 막음 — 진짜 DB 거래 안) · 영어 문장 · 화면 ID
  ④ 문서 904 · 판
  (파일만 읽음 — 두 번 돌아도 통과)
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
API = os.environ.get('API')
DB = os.environ.get('DB')
ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def doc(prefix):
    d = os.path.join(K, 'docs')
    return next((open(os.path.join(d, x), encoding='utf-8').read() for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith(prefix)), '')


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=180).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()



M = rd('prisma/migrations/D330_mail_inbound_shared_boxes/migration.sql')
MI, MP, MC = rd('src/common/mail/mail-inbound.ts'), rd('src/common/mail/mime-parse.ts'), rd('src/modules/support/mailbox.controller.ts')
UT, VA, EN, SC, AM, PK = rd('scripts/test-mail-inbound.ts'), rd('scripts/verify-all.sh'), rd('src/common/i18n/server-text.en.ts'), rd('spec/screens.json'), rd('src/app.module.ts'), rd('package.json')
SH = rd('src/common/security-headers.ts')
ok('① D330 — 표 5 · 공용 주소 4 · 설정 mail.inbound off · 주제 · 열람 기록 쌓기만 · 업무 권한 3 · 주소 표 · 반복 255 안',
   all(f'CREATE TABLE IF NOT EXISTS public.{t}' in M for t in ('mail_boxes', 'mail_messages', 'mail_attachments', 'mail_inbound_events', 'mail_access_log'))
   and all(a in M for a in ('privacy@sogaebank.com', 'help@sogaebank.com', 'admin@sogaebank.com', 'dmarc@sogaebank.com'))
   and "('mail.inbound', 'off', 'SUPER'" in M and "'mail.inbound_topic_arn', NULL" in M and 'MAIL_LOG_APPEND_ONLY' in M and 'BEFORE UPDATE OR DELETE ON public.mail_access_log' in M
   and all(k in M for k in ("'mailbox-privacy'", "'mailbox-help'", "'mailbox-admin'")) and "'/admin/mailbox/messages/{id}/reply'" in M
   and not re.search(r'\{[0-9]*,(2[6-9][0-9]|[3-9][0-9][0-9])\}', M), str(len(M)))
ok('② 공개 웹훅 /webhooks/ses/inbound(SNS 글 읽기 /webhooks/ses 아래 · 256KB) · 스위치 · 주제 · snsVerify · AWS 인증서 주소만 · SNS 번호 한 번만',
   "@Post('webhooks/ses/inbound')" in MC and "app.use('/api/v1/webhooks/ses'" in SH and "this.setting('mail.inbound')) !== 'on'" in MI and "this.setting('mail.inbound_topic_arn')" in MI
   and 'snsVerify(m, await this.cert(m.SigningCertURL))' in MI and 'snsUrlOk(m.SigningCertURL, true)' in MI and 'ON CONFLICT (sns_message_id) DO NOTHING' in MI, '')
ok('② S3 · SNS 두 알림을 같은 줄로(ON CONFLICT (ses_message_id, box_id)) · 첨부는 처음 한 번 · 스팸 · 바이러스 FAIL → SPAM · 새 패키지 없음(TextDecoder)',
   'ON CONFLICT (ses_message_id, box_id) WHERE ses_message_id IS NOT NULL DO UPDATE' in MI and "CASE WHEN $18 = 'FAIL' OR $19 = 'FAIL' THEN 'SPAM'" in MI
   and 'new TextDecoder(name)' in MP and "'ks_c_5601-1987': 'euc-kr'" in MP and not re.search(r'"(mailparser|sanitize-html|dompurify)"', PK)
   and 'MailboxController' in AM and 'MailboxService' in AM, '')
ok('③ verify-all 에 test-mail-inbound.ts · 시험이 MIME · 서명 · 합침 · 알림 · 지우기 막음 · 답장 머리를 봄',
   'scripts/test-mail-inbound.ts' in VA and '공용 메일함 받기 시험 — 전체 통과' in UT and all(w in UT for w in ('EUC-KR', 'DUPLICATE', 'MAIL_PRIVACY_NEW', 'MAIL_LOG_APPEND_ONLY', 'In-Reply-To')), '')
ok('③ 영어 문장 · 화면 ID SB-ADM-MAIL-010(웹훅 · 상태)', '"공용 메일함 열람 기록은 고치거나 지울 수 없습니다":' in EN and '"메일이 없습니다.":' in EN
   and '"SB-ADM-MAIL-010"' in SC and '"POST /webhooks/ses/inbound"' in SC and '"GET /admin/mailbox/state"' in SC, '')
ok('④ 문서 904 · 판 v10.789', all(w in doc('904_') for w in ('mail.inbound', 'D330', '/webhooks/ses/inbound')) and VT >= (10, 789), VER)
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
