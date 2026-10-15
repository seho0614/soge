"""v10.43 시험 — 메일(SES SMTP) 발송기 · 상담 신청 인증번호를 메일로

  KIT=… python3 test_v1043.py

  ① 메일 발송기 오프라인 시험(scripts/test-mail-offline.ts) 이 통합 검정(verify-all.sh) 과 npm 명령에 들어 있음
  ② 상담 신청 — 준비된 길(알림톡 · 메일) 모두로 같은 번호 · 메일이 유일한 길인데 실패하면 신청 삭제 + OTP_SEND_FAILED · 그 밖은 지금과 같음(NOTIFY_NOT_READY · devCode)
  ③ 새 패키지 없음(package.json · package-lock 의존성 변화 없음) · 발송기는 Node 내장 tls 만
  ④ 운영 .env 예시 · VERSION · 문서 92
  실제 발송 시험은 통합 검정의 「메일 발송기 (오프라인)」 줄 — 이 파일은 코드 모양만 봅니다.
"""
import json, os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


# ①
va = rd('scripts/verify-all.sh')
pk = json.loads(rd('package.json') or '{}')
ok('통합 검정에 메일 발송기 시험', 'scripts/test-mail-offline.ts' in va, '')
ok('npm run test:mail', 'test-mail-offline.ts' in pk.get('scripts', {}).get('test:mail', ''), '')
t = rd('scripts/test-mail-offline.ts')
ok('오프라인 시험 20항목', len(re.findall(r"^\s*ok\('", t, re.M)) == 20, str(len(re.findall(r"^\s*ok\('", t, re.M))))

# ②
cs = rd('src/modules/partner/consult.service.ts')
ok('상담 — MailService 주입', 'private readonly mail: MailService' in cs, '')
ok('상담 — 휴대폰 · 이메일 둘 다(둘 중 하나로 확인)', 'const byMail = await this.mail.ready()' in cs and 'const ready = alimtalk || byMail' in cs, '')
ok('상담 — 메일이 유일한 길일 때만 실패 → 신청 삭제 + OTP_SEND_FAILED', "if (!sent.ok && !alimtalk)" in cs and "DELETE FROM consult_requests WHERE id = $1 AND lead_id IS NULL" in cs and "'OTP_SEND_FAILED'" in cs, '')
ok('상담 — 준비 전 운영은 NOTIFY_NOT_READY 그대로', "if (!ready && !devMode)" in cs and "'NOTIFY_NOT_READY'" in cs, '')
ok('상담 — devCode 는 준비 전에만', "...(ready ? {} : { devCode: code })" in cs, '')
HINT = '인증번호는 휴대폰 또는 이메일로 보내 드립니다'
ok('상담 화면 — 「인증번호 받기」 아래 안내(대표 결정 A)', HINT in rd('site/src/app/consult/ConsultForm.tsx') and 'data-csl-otp-hint' in rd('site/src/app/consult/ConsultForm.tsx'), '')
ok('시안 두 곳에도 같은 안내', HINT in rd('spec/proto.html') and all(HINT in rd('site/public/proto/' + f) for f in os.listdir(os.path.join(K, 'site/public/proto')) if f.endswith('.html')), '')
am = rd('src/app.module.ts')
ok('MailService 등록', re.search(r'^\s+MailService,', am, re.M) is not None and "from './common/mail/mail.service'" in am, '')

# ③
sm = rd('src/common/mail/smtp.ts')
imps = re.findall(r"^import .* from '([^']+)';", sm, re.M)
ok('발송기는 Node 내장만(net · tls · crypto)', sorted(imps) == ['crypto', 'net', 'tls'], ' · '.join(imps))
deps = pk.get('dependencies', {})
ok('새 패키지 없음(nodemailer · aws-sdk)', not any(re.search(r'nodemailer|aws-sdk', d) for d in deps), '')
ms = rd('src/common/mail/mail.service.ts')
ok('보내는 주소는 notify.mail_from 우선 · notify.email_verified 로 판정', "notify.mail_from" in ms and "v_notify_channels WHERE channel = 'EMAIL'" in ms, '')
ok('머리줄 끼워 넣기 막음', r"/[\r\n]/.test(m.to)" in sm and r"/[\r\n]/.test(m.subject)" in sm, '')

# ④
env = rd('deploy/aws/env.production.example')
ok('운영 .env 예시에 SMTP_*', all(k in env for k in ('SMTP_HOST=', 'SMTP_PORT=', 'SMTP_USER=', 'SMTP_PASS=', 'MAIL_FROM=')), '')
ok('VERSION v10.43', rd('VERSION').strip() == 'v10.43', '')
ok('문서 92', any(f.startswith('92_') for f in os.listdir(os.path.join(K, 'docs'))), '')

n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
