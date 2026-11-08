"""v10.215 (docs/345) — AI 잠금 글을 「지금 판」 기준으로 바로잡음

  ① (코드) 운영 상태 한눈에 AI 줄 · 하루 요약 AI 잠김 줄 · AI 켜기 거절 글(PRIVACY_FIRST) · AI 스위치 화면 · postcheck 안내 · docs/345 · 판
  ② (DB · 거래 안에서 되돌림) fn_privacy_ai_ready 는 지금 판(v_terms_current) 기준 — 국외 이전 조항을 잠시 가리고
     앞 판이 있으면 조항이 든 새 판(5일 뒤)을 게시해도 잠김 · 시행일이 지나면 풀림 / 앞 판이 없으면 게시 순간 풀림
  ③ (API) 운영 상태 한눈에 AI 줄 · 하루 요약 AI 줄에 「게시됨」 · 「시행 중」 없음
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


SV, LW, AD = rd('src/modules/admin/state-check.service.ts'), rd('src/modules/admin/launch-watch.service.ts'), rd('src/modules/admin/admin.service.ts')
SW, POST = rd('web/src/app/admin/ailearn/AgentSwitches.tsx'), rd('deploy/aws/postcheck.sh')
ok('① 운영 상태 한눈에 AI 줄 — 「지금 판(첫 판은 게시 순간부터)」 · 「지금 판이 되기 전(첫 판은 게시 · 새 판은 시행일부터」 · 「게시됨」 없음',
   '`풀림 — 국외 이전 조항이 든 처리방침이 지금 판(첫 판은 게시 순간부터) · AI 스위치' in SV
   and '`잠김 — 국외 이전 조항이 든 처리방침이 지금 판이 되기 전(첫 판은 게시 · 새 판은 시행일부터 · AI 스위치' in SV
   and '처리방침 게시됨' not in SV and '처리방침이 게시되기 전' not in SV, '')
ok('① 하루 요약 AI 잠김 줄 · AI 켜기 거절 글 · AI 스위치 화면 · postcheck 안내 — 같은 「지금 판」 글',
   "'AI — 잠김(국외 이전 조항이 든 처리방침이 지금 판이 되기 전 — 첫 판은 게시 · 새 판은 시행일부터)'" in LW and '처리방침이 시행되기 전' not in LW
   and '개인정보처리방침이 지금 판이어야 합니다(첫 판은 게시 순간 · 새 판은 시행일부터 · 지금 판 ${g?.ver' in AD and '먼저 게시되어야 합니다' not in AD
   and SW.count('지금 판이 되기 전(첫 판은 게시 · 새 판은 시행일부터)') == 2 and '게시되기 전' not in SW
   and '처리방침이 지금 판이 되기 전(첫 판은 게시 · 새 판은 시행일부터)에는 AI 전체를 켤 수 없음(D145 · D149 · D151)' in POST, '')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('345_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 345 · docs/344 바로잡음 줄 · 판 v10.215 이상',
   bool(DOC) and 'v10.215(docs/345)에서 바로잡음' in ''.join(rd('docs/' + f) for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('344_'))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 215), f'{DOC} · {rd("VERSION").strip()}')


def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m)
    try:
        raw = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip()[:200])


if API and DB:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok
    # ② 한 거래 안에서만 바꾸고 ROLLBACK — 점검판 약관은 그대로(두 번 돌려도 같음)
    got = psql("""BEGIN;
SET LOCAL sgb.terms_fix = 'on';
UPDATE terms SET body = replace(body, '국외 이전', '국외 이관') WHERE code = 'PRIVACY';
CREATE TEMP TABLE t1215 ON COMMIT DROP AS SELECT EXISTS (SELECT 1 FROM v_terms_current WHERE code = 'PRIVACY') AS cur, fn_privacy_ai_ready() AS r0;
INSERT INTO terms(code, version, title, body, is_required, effective_from, status)
  VALUES ('PRIVACY', '9.9215', '시험 처리방침 1215', E'## 제9조 개인정보의 국외 이전\\n시험 본문', false, now() + interval '5 days', 'PUBLISHED');
ALTER TABLE t1215 ADD COLUMN r1 boolean; UPDATE t1215 SET r1 = fn_privacy_ai_ready();
UPDATE terms SET effective_from = now() - interval '1 second' WHERE code = 'PRIVACY' AND version = '9.9215';
ALTER TABLE t1215 ADD COLUMN r2 boolean; UPDATE t1215 SET r2 = fn_privacy_ai_ready();
SELECT cur || '|' || r0 || '|' || r1 || '|' || r2 FROM t1215;
ROLLBACK;""")
    cur, r0, r1, r2 = (got.split('|') + ['', '', '', ''])[:4]
    ok('② 지금 판 기준 — 조항 가리면 잠김 · 조항 든 새 판(5일 뒤) 게시: 앞 판 있으면 잠김 그대로 · 앞 판 없으면(첫 판) 바로 풀림 · 시행일 지나면 풀림',
       not got.startswith('!') and r0 == 'false' and r1 == ('false' if cur == 'true' else 'true') and r2 == 'true', f'앞 판={cur} · 가림={r0} · 게시={r1} · 시행일 지남={r2} · {got[:80]}')
    ok('② 되돌림 — 시험 판 없음 · 처리방침 본문 「국외 이관」 없음',
       psql("SELECT count(*) FROM terms WHERE code = 'PRIVACY' AND (version = '9.9215' OR body LIKE '%국외 이관%')") == '0', '')

    consent_ok.agree('admin@x.com', PW)
    TA = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    st = call('GET', '/admin/launch-watch/state', None, TA)
    ai = next((r for r in (st if isinstance(st, list) else []) if r.get('key') == 'ai'), {})
    an = ai.get('now') or ''
    ready = psql('SELECT fn_privacy_ai_ready()') == 't'
    ok('③ 운영 상태 한눈에 AI 줄 — DB 잠금 상태와 맞는 「지금 판」 글 · 「게시됨」 · 「시행 중」 없음',
       (an.startswith('풀림 — 국외 이전 조항이 든 처리방침이 지금 판(') if ready else an.startswith('잠김 — 국외 이전 조항이 든 처리방침이 지금 판이 되기 전('))
       and '게시됨' not in an and '시행 중' not in an, f'ready={ready} · {an}')
    dg = call('GET', '/admin/launch-watch', None, TA)
    al = dg.get('ai') if isinstance(dg, dict) else None
    al = al if isinstance(al, list) else []
    ok('③ 하루 요약(지켜보기) AI 줄 — 잠김이면 「지금 판이 되기 전」 · 옛 「시행되기 전」 없음',
       bool(al) and all('시행되기 전' not in x for x in al) and (ready or any('지금 판이 되기 전' in x for x in al) or not any('잠김' in x for x in al)), f'{al[:2]}')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
