"""v10.76 시험 — 소개광장 감춘 글의 회원 화면 문구(docs/130)

  KIT=… [DB=postgresql://sgb:sgb@localhost:15432/sgb] [API=http://localhost:13000/api/v1] python3 -I test_v1076.py

  ① 서버 — 신고 3건 자동 감춤만 「신고가 들어와 확인 중」 · 운영자가 감춘 글은 「운영 기준에 따라 가려진 글」 · 자동 감춤 사유가 D031 트리거와 같은 글자
  ④ (API · DB 가 있으면) 점검판 — 운영자가 감춘 글 · 자동 감춤 글을 다른 회원 · 작성자가 열어 봄
"""
import glob, json, os, re, subprocess, urllib.request, uuid

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
DB = os.environ.get('DB')
API = os.environ.get('API')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


S = rd('src/modules/community/community.service.ts')
fp = S[S.find('async post('):S.find('\n  }\n', S.find('async post(')) + 4]
m = re.search(r"const AUTO_HIDE_REASON = '([^']+)';", S)
ok('① 자동 감춤 사유를 상수로', m is not None, m.group(1) if m else '')
trig = ''.join(open(f, encoding='utf-8').read() for f in sorted(glob.glob(os.path.join(K, 'prisma/migrations/*/migration.sql'))))
ok('① 상수가 신고 트리거(D031)가 적는 사유와 같은 글자', m is not None and f"'{m.group(1)}'" in trig, '')
ok('① 다른 회원 — 자동 감춤만 「신고가 들어와 확인 중」 · 나머지 「운영 기준에 따라 가려진 글」',
   "p.hiddenReason === AUTO_HIDE_REASON ? '신고가 들어와 확인 중입니다.' : '운영 기준에 따라 가려진 글입니다.'" in fp
   and "p.state === 'HIDDEN' && !p.mine" in fp, '')
ok('① 운영자가 적은 사유는 다른 회원 답에 안 나감', 'hiddenReason' not in fp[fp.find("p.state === 'HIDDEN' && !p.mine"):fp.find("p.state === 'PENDING'")].replace('p.hiddenReason === AUTO_HIDE_REASON', ''), '')

if API and DB:
    def psql(sql):
        r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
        return r.returncode, r.stdout.strip(), r.stderr.strip()

    def call(m_, p, tok=None, body=None):
        h = {'content-type': 'application/json'}
        if tok: h['authorization'] = 'Bearer ' + tok
        req = urllib.request.Request(API + p, method=m_, data=json.dumps(body).encode() if body is not None else None, headers=h)
        try:
            r = urllib.request.urlopen(req, timeout=30); st, raw = r.status, r.read()
        except urllib.error.HTTPError as e:
            st, raw = e.code, e.read()
        try: js = json.loads(raw) if raw else None
        except Exception: js = None
        return st, js
    login = lambda e: call('POST', '/auth/login', body={'email': e, 'password': 'sgb-dev-1234'})[1]['accessToken']
    ADM, OTH = login('admin@x.com'), login(os.environ.get('OTHER', 'buyer@x.com'))

    def new_post(tag):
        # 점검판 DB 는 판을 바꿔도 이어집니다 — 하루 5개 한도에 걸리면 다음 회원으로(그 회원이 작성자)
        for who in [os.environ.get('MEMBER', 'person@x.com'), 'intro@x.com', 'seller@x.com']:
            tok = login(who)
            st, j = call('POST', '/me/community/posts', tok, {'board': 'QNA', 'title': f'점검 감춘 글 문구 {tag}', 'body': f'점검 감춘 글 문구 본문입니다 {tag}'})
            if (j or {}).get('id'):
                break
        pid = (j or {}).get('id')
        if pid and j.get('state') == 'PENDING':
            call('POST', f'/admin/community/posts/{pid}/approve', ADM)
        return pid, tok
    tag = uuid.uuid4().hex[:6]
    (p1, T1), (p2, _) = new_post(tag + 'a'), new_post(tag + 'b')
    if p1 and p2:
        call('POST', f'/admin/community/posts/{p1}/hide', ADM, {'reason': f'운영 점검 사유 {tag}'})
        psql(f"UPDATE posts SET state = 'HIDDEN', hidden_at = now(), hidden_reason = '{m.group(1) if m else ''}' WHERE id = '{p2}'")
        _, o1 = call('GET', f'/community/posts/{p1}', OTH)
        _, o2 = call('GET', f'/community/posts/{p2}', OTH)
        _, a1 = call('GET', f'/community/posts/{p1}', T1)
        _, g1 = call('GET', f'/community/posts/{p1}')
        ok('④ 운영자가 감춘 글 — 다른 회원 「운영 기준에 따라 가려진 글」 · 사유 · 본문 안 나감', (o1 or {}).get('hidden') is True and o1.get('note') == '운영 기준에 따라 가려진 글입니다.'
           and 'body' not in o1 and f'운영 점검 사유 {tag}' not in json.dumps(o1, ensure_ascii=False), o1)
        ok('④ 운영자가 감춘 글 — 로그인 안 한 사람도 같음', (g1 or {}).get('note') == '운영 기준에 따라 가려진 글입니다.', (g1 or {}).get('note'))
        ok('④ 신고 3건 자동 감춤 글 — 다른 회원 「신고가 들어와 확인 중」', (o2 or {}).get('hidden') is True and o2.get('note') == '신고가 들어와 확인 중입니다.', o2)
        ok('④ 작성자 — 본문 · 운영자가 적은 사유가 보임(지금과 같음)', (a1 or {}).get('state') == 'HIDDEN' and a1.get('hiddenReason') == f'운영 점검 사유 {tag}' and bool(a1.get('body')),
           {k: (a1 or {}).get(k) for k in ('state', 'hiddenReason')})
    else:
        ok('④ 시험 글 쓰기', False, f'{p1} {p2}')
else:
    print('     (API · DB 없음 — ④ 건너뜀 · 점검판에서 DB=… API=… 로)')

ok('VERSION v10.76 이상', re.match(r'v10\.(7[6-9]|[89]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
