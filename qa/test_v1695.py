"""v10.695 (docs/803) 업종 관 목록에 소개리드 · 새 관 · 새 관 만들면서 업종 복사
  ① (코드) Categories.tsx — 관 목록은 허브만 뺌(소개리드 · 준비중 새 관 보임) · 소개리드는 안심소개(MAL) · 상담(CONSULT)으로 저장(saveAs) ·
     세 상자(새 업종 추가 · 다른 관 업종 가져오기 · CSV)가 같은 길 · 상자를 열 때 관 목록 다시 읽음 · 안내 줄
     GwanNew.tsx — 「업종 복사(선택)」 고르기 → 관을 만든 뒤 POST /admin/categories/copy · screens.json SB-ADM-SIT-020
  ③ (API) 소개리드 길(MAL · CONSULT) → 승인 대기 · 축 CONSULT · LED 바로 넣기는 막힘(DB 그대로) · 복사 → 다른 관에 승인 대기 — 끝나면 지움
  ④ 문서 803 · 판
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
API = os.environ.get('API'); DB = os.environ.get('DB')
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


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=120).read()
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


def _up():   # 서버 · DB 가 응답할 때만 ③(미리 검사는 닿지 않는 주소로 돎)
    try:
        urllib.request.urlopen(API + '/health', timeout=5); api = True
    except Exception:
        api = False
    return api, bool(DB) and psql('SELECT 1') == '1'


API_UP, DB_UP = _up() if API and DB else (False, False)
VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))

# ── ① 코드 ─────────────────────────────────────────────────────────────
CA, GN, SJ = rd('web/src/app/admin/Categories.tsx'), rd('web/src/app/admin/gwans/GwanNew.tsx'), rd('spec/screens.json')
ok('① 업종 관 목록 — 허브만 뺌 · 소개리드 보임(상담 축으로 저장) · 「LED 뺌」 줄 없음',
   "(rows ?? []).filter((g) => !g.isHub)" in CA and "code === LEAD ? { gwanCode: 'MAL', axis: 'CONSULT' }" in CA
   and "g.code !== 'LED'" not in CA and '안심소개 상담 축으로 저장' in CA, '')
ok('① 세 상자 같은 길 — 새 업종 추가 · 가져오기 · CSV 모두 catTargets · saveAs · 열 때 관 목록 다시 읽음 · 안내 줄',
   CA.count('catTargets(gw.data)') == 3 and '...saveAs(f.gwanCode, f.axis.trim())' in CA and "JSON.stringify({ fromId: id, ...saveAs(to, axis) })" in CA
   and "...saveAs(to, axis), code: r.code" in CA and "parseCatCsv(text, saveAs(to, '').gwanCode)" in CA
   and CA.count('gw.reload(); }}') == 3 and CA.count('<GwanHint code=') == 3 and '「새 관 만들기」로 먼저 만들면' in CA, str(CA.count('catTargets(gw.data)')))
ok('① 새 관 만들기 — 업종 복사(선택) · 승인된 업종 고르기 · 만든 뒤 /admin/categories/copy · 실패면 화면에 남김',
   'data-gwan-new-copy' in GN and "c.status === 'APPROVED'" in GN and "'/admin/categories/copy'" in GN and 'JSON.stringify({ fromId: id, gwanCode: code })' in GN
   and 'if (fail.length) return;' in GN and 'data-gwan-new-copy-all' in GN, '')
scr = next((x for x in json.loads(SJ or '{}').get('screens', []) if isinstance(x, dict) and x.get('id') == 'SB-ADM-SIT-020'), {}) if SJ else {}
ok('① screens.json — 새 관 만들기에 업종 목록 · 복사 API', all(a in (scr.get('apis') or []) for a in ('POST /admin/gwans', 'GET /admin/categories', 'POST /admin/categories/copy')), str(scr.get('apis')))

# ── ③ API ──────────────────────────────────────────────────────────────
if API and DB and API_UP and DB_UP:
    stamp = time.strftime('%H%M%S')
    c_led, c_cp = f'MAL_T95L{stamp}', f'MNY_T95L{stamp}'
    try:
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        TS_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
        r1 = call('POST', '/admin/categories', {'gwanCode': 'MAL', 'axis': 'CONSULT', 'code': c_led, 'name': f'시험 리드 상담 {stamp}', 'laborLawFlag': 'REVIEW_REQUIRED'}, TS_)
        row = psql(f"SELECT gwan_code || '|' || status || '|' || coalesce(axis, '') FROM categories WHERE code = '{c_led}'")
        ok('③ 소개리드 길 — 안심소개 · 상담 축 승인 대기', r1.get('status') == 'PENDING' and row == 'MAL|PENDING|CONSULT', f"{r1.get('status')} · {row}")
        r2 = call('POST', '/admin/categories', {'gwanCode': 'LED', 'code': f'LED_T95{stamp}', 'name': f'시험 리드 {stamp}', 'laborLawFlag': 'REVIEW_REQUIRED'}, TS_)
        ok('③ LED 바로 넣기는 그대로 막힘(DB · D308)', '_err' in r2 and psql(f"SELECT count(*) FROM categories WHERE code = 'LED_T95{stamp}'") == '0', str(r2.get('_err')) + ' ' + str(r2.get('code')))
        src = psql("SELECT id FROM categories WHERE status = 'APPROVED' AND gwan_code = 'MAL' ORDER BY code LIMIT 1")
        r3 = call('POST', '/admin/categories/copy', {'fromId': src, 'gwanCode': 'MNY', 'code': c_cp}, TS_)
        ok('③ 복사 — 다른 관에 승인 대기(옮기지 않음 · 원래 줄 그대로)', r3.get('status') == 'PENDING'
           and psql(f"SELECT gwan_code || '|' || status FROM categories WHERE code = '{c_cp}'") == 'MNY|PENDING'
           and psql(f"SELECT status FROM categories WHERE id = '{src}'") == 'APPROVED', f"{r3.get('status')} {r3.get('_err', '')} {r3.get('code', '')}")
    finally:
        psql(f"DELETE FROM categories WHERE code IN ('{c_led}', '{c_cp}', 'LED_T95{stamp}')")
        ok('③ 끝 — 시험 업종 지움', psql(f"SELECT count(*) FROM categories WHERE code IN ('{c_led}', '{c_cp}')") == '0', '')
else:
    print('API · DB 없음 — ③ 건너뜀')

# ── ④ 문서 · 판 ─────────────────────────────────────────────────────────
d = doc('803_')
ok('④ 문서 803 — 소개리드 · 상담 축 · 새 관 · 업종 복사', all(w in d for w in ('소개리드', '상담', '새 관 만들기', '업종 복사')), str(len(d)))
ok('④ VERSION v10.695 이상', VT >= (10, 695), VER)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
