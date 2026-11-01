"""v10.171 시험 — 운영 점검 바로잡기 · 운영 하루 요약 · 가입 급증 알림 · 손님 연락처(D160 · docs/264)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1171.py

  ① 코드 — D160(ADMIN 범위 설정 2 · 정기 작업 · privacy@ 는 처음 값일 때만 · 지우는 문장 없음 · 198) · Nginx 판정 함수 · postcheck(그려진 문장 · 실제 파일 · 운영 화면 실패 ·
     공개 + 간주 결제 + 주문 받기 실패 · AI 상담 안내) · precheck · 하루 요약 · 가입 급증 · 실행기 · 화면 · 사전 · 명세 · docs/264 · 판
  ② (함수) 운영 같은 설정 → 사용자 웹 ip+pw · 운영 화면 ip · 공개 설정 → open · 따로 있는 파일 · 내용 다름 알림 · 바로가기
  ③ (API · 화면) 공개 설정에 ops.* 없음 · 개인정보 메일 privacy@ · 지켜보기 digestTo · 고객센터 「연락처 · 신고」 · 바닥줄 개인정보 메일
"""
import json, os, re, subprocess, tempfile, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(d for d in os.listdir(MD) if os.path.isdir(os.path.join(MD, d)))
M = rd('prisma/migrations/D160_ops_digest_contact/migration.sql')
ok('① D160 — ops.digest_to · ops.signup_spike_per_hour(ADMIN 범위) · launch_digest 09:00 · privacy@ 는 처음 값일 때만 · 지우는 문장 없음 · 198 이상',
   "('ops.digest_to', 'admin@sogaebank.com', 'ADMIN'," in M and "('ops.signup_spike_per_hour', '30', 'ADMIN'," in M and "('launch_digest', 1440, 9, 0," in M
   and "WHERE key = 'footer.privacy_email' AND value = 'koreabio9981@gmail.com'" in M and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M)
   and len(mig) >= 198 and 'D160_ops_digest_contact' in mig, f'{len(mig)} · {mig[-1]}')
LB = rd('deploy/aws/lib.sh'); PC = rd('deploy/aws/postcheck.sh'); PR = rd('deploy/aws/precheck.sh')
ok('① 운영 점검 — 판정 함수 3 · postcheck 그려진 문장 · 실제 파일 · 운영 화면 허용 IP 실패 · 공개 + 간주 결제 + 주문 받기 실패 · AI 상담 안내 · precheck 실제 파일',
   'nginx_block_states()' in LB and 'nginx_enabled_files()' in LB and 'nginx_state_ko()' in LB
   and "grep -o 'home-artnote\">[^<]*' | grep -q '디자인 예시입니다'" in PC and 'nginx_enabled_files | while read' in PC and '운영 화면이 허용 IP 로 막혀 있지 않음' in PC
   and '소개몰 「주문 받기」가 켜짐' in PC and 'agent.enabled=off; do' not in PC and 'ai-agent #29' in PC and 'nginx_enabled_files | while read' in PR, '')
LS = rd('src/modules/admin/launch-watch.service.ts'); SH = rd('src/worker/scheduler.service.ts'); WC = rd('src/worker/worker.controller.ts')
ok('① 서버 — 하루 요약(어제 · 시험 결제 주문 · 메일 준비됐을 때만 보냄) · 가입 급증(1시간에 한 번) · 실행기 · 지켜보기 digestTo',
   'async digest()' in LS and 'async signupSpike()' in LS and "alert_code = 'SIGNUP_SPIKE' AND raised_at > now() - interval '1 hour'" in LS and 'AS "digestTo"' in LS
   and "case 'launch_digest':" in SH and 'await this.mail.ready()' in SH and "'DAILY_DIGEST'" in SH and "'SIGNUP_SPIKE'" in SH and "'launch_digest'" in WC, '')
SP = rd('site/src/app/support/new/page.tsx'); FT = rd('site/src/components/Footer.tsx'); WL = rd('web/src/app/admin/LaunchWatch.tsx')
dko = json.loads(rd('site/src/i18n/messages/ko/deal.json') or '{}').get('support', {}); den = json.loads(rd('site/src/i18n/messages/en/deal.json') or '{}').get('support', {})
fko = json.loads(rd('site/src/i18n/messages/ko.json') or '{}').get('footer', {}); fen = json.loads(rd('site/src/i18n/messages/en.json') or '{}').get('footer', {})
ok('① 화면 · 사전 · 문서 — 고객센터 연락처(전화 · 개인정보 · 분쟁 · 사기) · 바닥줄 개인정보 메일 · 지켜보기 요약 안내 · 사전 ko · en · docs/264 · 판',
   'data-support-contact' in SP and "st['footer.privacy_email']" in SP and '/support/dispute' in SP and "settings['footer.privacy_email']" in FT and 'data-digest-to' in WL
   and all(k in dko and k in den for k in ('contact', 'contactPhone', 'contactPrivacy', 'contactDispute', 'contactScam')) and 'privacyEmail' in fko and 'privacyEmail' in fen
   and any(f.startswith('264_') for f in os.listdir(os.path.join(K, 'docs'))) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 171), rd('VERSION').strip())

# ── ② 판정 함수 ────────────────────────────────────────────────────────
EX = rd('deploy/aws/nginx-sgb.conf.example').replace('__OFFICE_IP__', '121.168.92.13').replace('__DOMAIN__', 'sogaebank.com').replace('__ADMIN_DOMAIN__', 'admin.sogaebank.com').replace('__APP__', '/home/ubuntu/sgb')
ops_like = EX.replace('    allow 121.168.92.13;\n    deny all;\n\n    proxy_pass http://127.0.0.1:5174;',
                      '    allow 121.168.92.13;\n    deny all;\n    satisfy any;\n    auth_basic "SGB test";\n    auth_basic_user_file /etc/nginx/.p;\n\n    proxy_pass http://127.0.0.1:5174;', 1)
i = EX.index('location / {'); j = EX.index('proxy_pass http://127.0.0.1:5174')
opened = EX[:i] + 'location / {\n    ' + EX[j:]


def states(conf):
    r = subprocess.run(['bash', '-c', f'source "{K}/deploy/aws/lib.sh"; sed "s/#.*//" | nginx_block_states'], input=conf, capture_output=True, text=True)
    return dict(l.split() for l in r.stdout.strip().splitlines() if l.strip())


s1, s2 = states(ops_like), states(opened)
ok('② 판정 — 운영 같은 설정: 사용자 웹 ip+pw · 운영 화면 ip / 공개 설정: 사용자 웹 open · 운영 화면 ip', s1 == {'user': 'ip+pw', 'admin': 'ip'} and s2 == {'user': 'open', 'admin': 'ip'}, f'{s1} · {s2}')
with tempfile.TemporaryDirectory() as td:
    en, av = os.path.join(td, 'en'), os.path.join(td, 'av'); os.makedirs(en); os.makedirs(av)
    open(os.path.join(en, 'sgb'), 'w').write(ops_like); open(os.path.join(av, 'sgb'), 'w').write(EX)
    open(os.path.join(av, 'two'), 'w').write(EX); os.symlink(os.path.join(av, 'two'), os.path.join(en, 'two'))
    r = subprocess.run(['bash', '-c', f'source "{K}/deploy/aws/lib.sh"; nginx_enabled_files "{en}" "{av}"'], capture_output=True, text=True).stdout
ok('② 실제 파일 — 따로 있는 파일 · sites-available 와 내용이 다름 알림 · 바로가기는 대상 경로', 'sgb 따로 있는 파일 · sites-available/sgb 와 내용이 다름' in r and 'two 바로가기 →' in r, r.strip().replace('\n', ' | ')[:160])


# ── ③ API · 화면 ───────────────────────────────────────────────────────
def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        raw = urllib.request.urlopen(r, timeout=60).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        return {'_err': e.code}


def psql(sql):
    return subprocess.run(['psql', DB, '-X', '-q', '-At', '-c', sql], capture_output=True, text=True).stdout.strip()


if API and DB:
    pub = call('GET', '/site-settings/public')
    ok('③ 공개 설정 — ops.* 없음(운영 전용) · 개인정보 메일 privacy@sogaebank.com', not any(k.startswith('ops.') for k in pub) and pub.get('footer.privacy_email') == 'privacy@sogaebank.com',
       str(pub.get('footer.privacy_email')))
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    w = call('GET', '/admin/launch-watch', t=T_)
    ok('③ 지켜보기 — 하루 요약 받는 주소(digestTo) · DB 에 정기 작업 launch_digest', w.get('digestTo') == 'admin@sogaebank.com' and psql("SELECT count(*) FROM job_schedules WHERE job = 'launch_digest'") == '1', str(w.get('digestTo')))
    if SITE:
        try:
            h1 = urllib.request.urlopen(SITE + '/support/new', timeout=120).read().decode('utf-8', 'replace')
            h2 = urllib.request.urlopen(SITE + '/community', timeout=120).read().decode('utf-8', 'replace')
        except Exception as e:
            h1 = h2 = str(e)
        ok('③ 사용자 웹 — 고객센터 「연락처 · 신고」(개인정보 메일 · 분쟁) · 바닥줄 개인정보 메일', 'data-support-contact' in h1 and 'privacy@sogaebank.com' in h1 and '/support/dispute' in h1
           and 'data-privacy-email' in h2 and 'privacy@sogaebank.com' in h2, f"{'data-support-contact' in h1} · {'data-privacy-email' in h2}")
else:
    print('  (API · DB 없음 — ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
