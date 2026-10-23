"""v10.85 시험 — 알림 메일 실제 발송 · /health 판 번호 · 자동검수 통계 SQL(docs/139)

  KIT=… [DB=postgresql://sgb:sgb@localhost:15432/sgb] [API=http://localhost:13000/api/v1] python3 -I test_v1085.py
"""
import json, os, re, subprocess, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
DB = os.environ.get('DB'); API = os.environ.get('API')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


rd = lambda rel: open(os.path.join(K, rel), encoding='utf-8').read() if os.path.exists(os.path.join(K, rel)) else ''
N, SCH, H, SQL, V = rd('src/common/mail/notify-mail.ts'), rd('src/worker/scheduler.service.ts'), rd('src/modules/public/health.controller.ts'), rd('deploy/aws/review-stats.sql'), rd('scripts/verify-all.sh')
ok('F 보내는 조건 = MailService.ready() — 새 스위치 없음', 'if (!(await this.mail.ready())) return out;' in N and 'notify.email_verified' not in re.sub(r'/\*.*?\*/', '', N, flags=re.S), '')
ok('F 결과 기록 — SENT · FAILED · RETRY(3번) · OPTED_OUT · ACCOUNT_INACTIVE · EXPIRED · NO_EMAIL', all(t in N for t in ("status = 'SENT'", "status = 'FAILED'", 'RETRY ', 'MAX_TRY = 3', 'OPTED_OUT', 'ACCOUNT_INACTIVE', 'EXPIRED', 'NO_EMAIL')), '')
ok('F 끄기 — 정책이 허락할 때만(optout_allowed)', 'coalesce(pol.optout_allowed, true)' in N, '')
ok('F 링크 — 사이트 안 주소만 · 제목 줄바꿈 제거', r"/^\/(?!\/)[^\s]*$/" in N and r".replace(/[\r\n]+/g, ' ')" in N, '')
ok('F 받는 주소를 기록하지 않음(UPDATE 에 email 없음)', not re.search(r'UPDATE notification_deliveries[^`]*email', N), '')
lits = [m.group(1) for m in re.finditer(r'`([^`]*)`', N) if re.match(r'\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b', m.group(1), re.I)]
ok('F SQL 고정 글', lits and not [x for x in lits if '${' in x], len(lits))
ok('F 배치에 연결(notify_dispatch · MailService 주입)', 'new NotifyMailSender(this.db, this.mail).run()' in SCH and 'private readonly mail: MailService,' in SCH, '')
ok('F 통합 검정에 시험', 'scripts/test-notify-mail.ts' in V and os.path.exists(os.path.join(K, 'scripts/test-notify-mail.ts')), '')
ok('G /health 에 version — VERSION 파일 한 번 읽음 · 없으면 ?', "readFileSync(join(process.cwd(), 'VERSION'), 'utf8')" in H and 'version: VERSION' in H and "return '?'" in H, '')
body = re.sub(r'--[^\n]*', '', SQL)
ok('E 읽기 전용 거래 · 끝에 되돌림 · 바꾸는 문장 없음', 'BEGIN READ ONLY;' in SQL and SQL.rstrip().endswith('ROLLBACK;') and not re.search(r'\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b', body), '')
ok('E 개인정보 안 냄(제목 · 이름 · 연락처 없음 · 매물 번호만)', not re.search(r'\b(l\.title|a\.name|email|phone)\b', body) and 'l.listing_no' in body, '')
if DB:
    r = subprocess.run(['psql', DB, '-X', '-v', 'days=30', '-f', os.path.join(K, 'deploy/aws/review-stats.sql')], capture_output=True, text=True)
    ok('E 점검판 DB 에서 끝까지 돎(6묶음)', r.returncode == 0 and r.stdout.count('== ') == 6, (r.stderr or r.stdout)[-200:])
if API:
    js = json.loads(urllib.request.urlopen(API + '/health', timeout=20).read())
    ok('G 점검판 /health → version', js.get('version') == rd('VERSION').strip() and js.get('status') == 'ok', js)
ok('VERSION v10.85 이상', re.match(r'v10\.(8[5-9]|9\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
