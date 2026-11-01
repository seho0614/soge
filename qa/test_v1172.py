"""v10.172 시험 — 하루 요약 「지금 보기」 · 처리방침 초안 제12조 문의 메일(D161 · docs/265)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1172.py

  ① 코드 — 요약 보기 API(읽기만) · 운영 화면 단추 · 명세 · 처리방침 글 = terms-text.js = docs/terms = D161 · 게시 없음 · 지우는 문장 없음 · 199 · docs/265 · 판
  ② (API · DB) 요약 보기 → 글 · 운영 알림이 늘지 않음 · 회원 403 · 처리방침 초안에 메일 줄 · 게시된 처리방침 글은 그대로
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB')
RES = []
PW = 'sgb-dev-1234'
MAIL = '메일     privacy@sogaebank.com'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
C = rd('src/modules/admin/launch-watch.controller.ts'); W = rd('web/src/app/admin/LaunchWatch.tsx')
scr = [x for x in json.loads(rd('spec/screens.json') or '{"screens":[]}')['screens'] if x['id'] == 'SB-ADM-DSH-010']
ok('① 요약 보기 — GET digest(정기 작업과 같은 digest() · 알림 안 남김) · 운영 화면 단추 · 명세',
   "@Get('digest')" in C and 'digest() { return this.svc.digest(); }' in C and 'raise' not in C.lower()
   and 'data-digest-show' in W and 'data-digest-text' in W and "'/admin/launch-watch/digest'" in W
   and scr and 'GET /admin/launch-watch/digest' in scr[0]['apis'], '')
T = rd('scripts/terms-text.js'); D = rd('prisma/migrations/D161_privacy_contact_mail/migration.sql')
m = re.search(r"\n  PRIVACY: `((?:\\.|[^`\\])*)`", T, re.S); P = m.group(1).replace('\\`', '`').replace('\\\\', '\\') if m else ''
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(d for d in os.listdir(MD) if os.path.isdir(os.path.join(MD, d)))
ok('① D161 — 처리방침 제12조 메일 줄 = terms-text.js = docs/terms · 게시 없음 · 지우는 문장 없음 · 199 이상',
   MAIL in P and P.count('privacy@sogaebank.com') == 1 and f'$TERM${P}$TERM$' in D and P.strip() in rd('docs/terms/PRIVACY.md')
   and "SET status = 'PUBLISHED'" not in D and "'LEGAL_REVIEW'" in D and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE)\b', D)
   and len(mig) >= 199 and 'D161_privacy_contact_mail' in mig, f'{len(mig)} · {mig[-1]}')
ok('① docs/265 · 판', any(f.startswith('265_') for f in os.listdir(os.path.join(K, 'docs'))) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 172), rd('VERSION').strip())


# ── ② API · DB ─────────────────────────────────────────────────────────
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
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    n0 = psql('SELECT count(*) FROM ops_alerts')
    g = call('GET', '/admin/launch-watch/digest', t=T_)
    n1 = psql('SELECT count(*) FROM ops_alerts')
    ok('② 요약 보기 — 어제 날짜 · 글 · 숫자 · 운영 알림 늘지 않음', '소개뱅크 운영 하루 요약' in str(g.get('text')) and isinstance(g.get('signups'), int)
       and g.get('day') == psql("SELECT ((now() AT TIME ZONE 'Asia/Seoul')::date - 1)::text") and n0 == n1, f"{g.get('day')} · 알림 {n0} → {n1}")
    mt = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken')
    ok('② 회원은 요약 보기 403', call('GET', '/admin/launch-watch/digest', t=mt).get('_err') == 403, '')
    dr = psql("SELECT count(*) FROM terms WHERE code = 'PRIVACY' AND status IN ('DRAFT','LEGAL_REVIEW') AND body LIKE '%" + MAIL + "%'")
    pb = psql("SELECT count(*) FROM terms WHERE code = 'PRIVACY' AND status = 'PUBLISHED' AND body LIKE '%privacy@sogaebank.com%'")
    ok('② 처리방침 초안(검토 중)에 메일 줄 · 게시된 처리방침 글은 그대로', dr == '1' and pb == '0', f'초안 {dr} · 게시 {pb}')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
