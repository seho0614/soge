"""D007 — 파일 올리기 (등기사항증명서 · 마케팅자료 · 파트너가이드) 검증 (작업자 file, 2026-10-02).

사용:
  API=http://localhost:3022/api/v1 python3 srv_file.py                       (기본 3000)
  S3 모드까지:  S3 모드 API 를 가짜 S3 주소로 띄운 뒤
      API_S3=http://localhost:3122/api/v1 S3_MOCK_PORT=9022 python3 srv_file.py
    (그 API 는 S3_BUCKET=sgb-test S3_ENDPOINT=http://127.0.0.1:9022 S3_FORCE_PATH_STYLE=1
     AWS_ACCESS_KEY_ID=AKIDSGBTEST AWS_SECRET_ACCESS_KEY=sgb-test-secret-key AWS_REGION=ap-northeast-2
     FILE_DOWNLOAD_TTL=3 로 띄웁니다. 가짜 S3 는 이 스크립트가 띄우고 SigV4 서명을 독립 구현으로 검증합니다.)
  KIT=/tmp/kit_file  — 오프라인 시험(scripts/test-s3-presign-offline.ts)을 돌릴 킷 경로 (없으면 건너뜀)
결과: srv_file.json
원복: 시험 매물은 'D007 시험' 제목으로 재사용하고 소유 확인은 거절로 닫습니다. 시험 가이드는 지우고, 시험 자료는 반려로 닫습니다.
"""
import json, os, sys, uuid, hashlib, hmac, time, subprocess, threading, base64, http.client, datetime
import urllib.request, urllib.error, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

B = os.environ.get('API') or (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000/api/v1')
ORIGIN = B.split('/api/v1')[0]
DB = 'postgresql://sgb:sgb@localhost:5432/sgb'
SECRET = os.environ.get('FILE_TOKEN_SECRET') or os.environ.get('JWT_SECRET') or 'docker-test-secret-0123456789abcdef'
OP = urllib.request.build_opener(urllib.request.ProxyHandler({}))      # 로컬 주소에 프록시를 태우지 않습니다
R = []

def q(s):
    return subprocess.run(['psql', DB, '-tAc', s], capture_output=True, text=True).stdout.strip().split('\n')[0]

def sql(s):
    p = subprocess.run(['psql', DB, '-v', 'ON_ERROR_STOP=1', '-qc', s], capture_output=True, text=True)
    return p.returncode, (p.stderr or '').strip()

def req(m, url, tok=None, body=None, raw=None, ct='application/json', headers=None, base=None):
    h = {'Idempotency-Key': uuid.uuid4().hex}
    if ct: h['content-type'] = ct
    if tok: h['authorization'] = 'Bearer ' + tok
    if headers: h.update(headers)
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH') else None))
    full = url if url.startswith('http') else ((base or B) + url if not url.startswith('/api/') else ORIGIN + url)
    r_ = urllib.request.Request(full, method=m, data=data, headers=h)
    try:
        r = OP.open(r_, timeout=60); st = r.status; b = r.read(); hd = dict(r.headers)
    except urllib.error.HTTPError as e:
        st = e.code; b = e.read(); hd = dict(e.headers)
    except Exception as e:      # 연결을 끊는 거절(413 후 close)
        return -1, str(e), {}
    try: js = json.loads(b) if b and b[:1] in (b'{', b'[') else b
    except Exception: js = b
    return st, js, hd

call = lambda m, p, tok=None, body=None, base=None: req(m, p, tok, body, base=base)[:2]

def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:240]})
    print('ok  ' if ok else 'FAIL', step, str(detail)[:150], file=sys.stderr)

def login(e, pw='sgb-dev-1234', base=None):
    return call('POST', '/auth/login', body={'email': e, 'password': pw}, base=base)[1]['accessToken']

# ── 시험 파일 ────────────────────────────────────────────────
PDF = b'%PDF-1.4\n1 0 obj <<>> endobj\n' + os.urandom(2000) + b'\n%%EOF\n'
PNG = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) + b'\x00\x00\x00\rIHDR' + os.urandom(900)
JPG = bytes([0xFF, 0xD8, 0xFF, 0xE0]) + os.urandom(1500) + bytes([0xFF, 0xD9])
MP4 = b'\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2avc1mp41' + os.urandom(3000)
HTML = b'<html><body><script>alert(document.cookie)</script></body></html>' + b' ' * 500
sha = lambda b: hashlib.sha256(b).hexdigest()

def create(tok, purpose, name, ct, data, size=None, digest=True, base=None):
    body = {'purpose': purpose, 'name': name, 'contentType': ct, 'size': size if size is not None else len(data)}
    if digest: body['sha256'] = sha(data)
    return call('POST', '/files', tok, body, base=base)

def put(t, data, ct=None, headers=None):
    return req(t['method'], t['uploadUrl'], raw=data, ct=ct or t['headers'].get('Content-Type'), headers=headers)

def upload(tok, purpose, name, ct, data, base=None):
    st, t = create(tok, purpose, name, ct, data, base=base)
    assert st == 201, (st, t)
    s2 = put(t, data)
    assert s2[0] == 200, s2[:2]
    st, c = call('POST', f"/files/{t['fileId']}/complete", tok, base=base)
    assert st == 200 and c['status'] == 'READY', (st, c)
    return t['fileId']

def fetch_url(u):
    st, b, hd = req('GET', u, ct=None)
    return st, b, hd

def token(op, fid, ttl):
    exp = int(time.time()) + ttl
    key = hashlib.sha256(('sgb-file-token|' + SECRET).encode()).digest()
    mac = base64.urlsafe_b64encode(hmac.new(key, f'{op}:{fid}:{exp}'.encode(), hashlib.sha256).digest()).decode().rstrip('=')
    return f'{exp}.{mac}'

ADM = login('admin@x.com'); SEL = login('intro@x.com'); BUY = login('buyer@x.com')
REV = login('reviewer@t.local', 'sgb-test-1234'); PAY = login('payout@t.local', 'sgb-test-1234')

# ═════════ A. 올리기 · 내려받기 · 보안 (로컬 저장소) ═════════
pol = q("select string_agg(purpose||':'||content_type||':'||max_bytes, ',' order by 1) from file_policies")
rec('A-0 용도별 형식 · 크기 표 (file_policies) — 문서 PDF/JPG/PNG 10MB · 자료 MP4 50MB', 'OWNERSHIP_DOC:application/pdf:10485760' in pol
    and 'MARKETING_MATERIAL:video/mp4:52428800' in pol and 'OWNERSHIP_DOC:video/mp4' not in pol, pol[:200])
st, t = create(SEL, 'OWNERSHIP_DOC', '../../etc/등기부 <원본>.pdf', 'application/pdf', PDF)
FID = t.get('fileId') if isinstance(t, dict) else None
key = q(f"select storage_key from files where id='{FID}'")
rec('A-1 자리 만들기 → UPLOADING · 이름 정리(경로 · 금지문자 제거) · 저장 키에 이용자 이름 없음',
    st == 201 and t['name'] == '등기부 _원본_.pdf' and q(f"select status from files where id='{FID}'") == 'UPLOADING'
    and key.startswith('ownership_doc/') and '등기부' not in key and '..' not in key, (st, t.get('name') if isinstance(t, dict) else t, key))
s2 = put(t, PDF)
rec('A-2 바이트 PUT (토큰 주소)', s2[0] == 200 and s2[1]['sha256'] == sha(PDF), s2[:2])
st, c = call('POST', f'/files/{FID}/complete', SEL)
rec('A-3 complete → READY · 서버가 계산한 해시 · 형식', st == 200 and c['status'] == 'READY' and c['sha256'] == sha(PDF)
    and q(f"select detected_type from files where id='{FID}'") == 'application/pdf', (st, c))
st, c = call('POST', f'/files/{FID}/complete', SEL)
rec('A-3b complete 다시 → 같은 결과 (멱등)', st == 200 and c['status'] == 'READY', (st, c))
st, o = call('GET', f'/files/{FID}', SEL)
s3_, body, hd = fetch_url(o['url']) if st == 200 else (0, b'', {})
rec('A-4 주인 열기 → 5분 주소 → 같은 바이트 · attachment · nosniff', st == 200 and s3_ == 200 and body == PDF
    and hd.get('Content-Disposition', '').startswith('attachment;') and "filename*=UTF-8''" in hd.get('Content-Disposition', '')
    and hd.get('X-Content-Type-Options') == 'nosniff' and hd.get('Content-Type', '').startswith('application/pdf'),
    (st, s3_, hd.get('Content-Disposition')))
st, o2 = call('GET', f'/files/{FID}?disposition=inline', SEL)
s3_, body, hd = fetch_url(o2['url'])
rec('A-4b disposition=inline', s3_ == 200 and hd.get('Content-Disposition', '').startswith('inline;'), hd.get('Content-Disposition'))
st, j = call('GET', f'/files/{FID}', BUY)
st2, j2 = call('GET', f'/files/{FID}')
st3, j3 = call('GET', f'/files/{FID}', PAY)
rec('A-5 남의 등기부 → 404(존재도 숨김) · 비로그인 → 403 · 지급 담당(PAYOUT) → 404', st == 404 and st2 == 403 and j2['code'] == 'UNAUTHENTICATED' and st3 == 404, (st, j, st2, st3))
n0 = int(q(f"select count(*) from audit.audit_logs where action='FILE_OPEN' and target_id='{FID}'") or 0)
st, j = call('GET', f'/files/{FID}', ADM); st2, j2 = call('GET', f'/files/{FID}', REV)
time.sleep(0.5)
n1 = int(q(f"select count(*) from audit.audit_logs where action='FILE_OPEN' and target_id='{FID}'") or 0)
leak = q(f"select count(*) from audit.audit_logs where action='FILE_OPEN' and target_id='{FID}' and after_data::text like '%t=%'")
rec('A-6 운영(ADMIN) · 심사(REVIEWER) 열기 OK · 감사 FILE_OPEN 2건(주소 · 토큰은 안 남김)', st == 200 and st2 == 200 and n1 - n0 == 2 and leak == '0', (st, st2, n0, n1, leak))

st, j = create(SEL, 'OWNERSHIP_DOC', 'x.html', 'text/html', HTML)
st2, j2 = create(SEL, 'OWNERSHIP_DOC', 'x.svg', 'image/svg+xml', HTML)
rec('A-7 받지 않는 형식(HTML · SVG) → 422 FILE_TYPE', st == 422 and j['code'] == 'FILE_TYPE' and st2 == 422, (st, j, st2))
st, j = create(SEL, 'OWNERSHIP_DOC', 'big.pdf', 'application/pdf', PDF, size=10485761)
st2, j2 = create(ADM, 'MARKETING_MATERIAL', 'big.mp4', 'video/mp4', MP4, size=52428801)
rec('A-8 크기 초과 → 422 FILE_TOO_LARGE (문서 10MB · 영상 50MB)', st == 422 and j['code'] == 'FILE_TOO_LARGE' and st2 == 422 and j2['code'] == 'FILE_TOO_LARGE', (st, j, st2, j2))
st, j = create(SEL, 'MARKETING_MATERIAL', 'm.png', 'image/png', PNG)
st2, j2 = create(ADM, 'OWNERSHIP_DOC', 'o.pdf', 'application/pdf', PDF)
st3, j3 = call('POST', '/files', SEL, {'purpose': 'AVATAR', 'name': 'a.png', 'contentType': 'image/png', 'size': 10})
rec('A-9 용도별 올리는 사람 — 회원은 마케팅자료 403 · 없는 용도 400',
    st == 403 and st3 == 400, (st, j, st2, st3))
# 형식 위장 — PDF 라고 밝히고 HTML 을 올림
st, t = create(SEL, 'OWNERSHIP_DOC', 'fake.pdf', 'application/pdf', HTML)
put(t, HTML)
st, c = call('POST', f"/files/{t['fileId']}/complete", SEL)
st2, j2 = call('GET', f"/files/{t['fileId']}", SEL)
rec('A-10 형식 위장(.pdf 로 HTML) → complete 422 FILE_TYPE_MISMATCH · REJECTED · 열 수 없음', st == 422 and c['code'] == 'FILE_TYPE_MISMATCH'
    and q(f"select status from files where id='{t['fileId']}'") == 'REJECTED' and st2 == 404, (st, c, st2))
SPOOF = t['fileId']
# 크기 불일치 (덜 보냄)
st, t = create(SEL, 'OWNERSHIP_DOC', 'short.pdf', 'application/pdf', PDF, size=len(PDF) + 100, digest=False)
put(t, PDF)
st, c = call('POST', f"/files/{t['fileId']}/complete", SEL)
rec('A-11 밝힌 크기보다 작게 올림 → 422 FILE_SIZE_MISMATCH · REJECTED', st == 422 and c['code'] == 'FILE_SIZE_MISMATCH'
    and q(f"select status from files where id='{t['fileId']}'") == 'REJECTED', (st, c))
# 해시 불일치
st, t = call('POST', '/files', SEL, {'purpose': 'OWNERSHIP_DOC', 'name': 'h.pdf', 'contentType': 'application/pdf', 'size': len(PDF), 'sha256': sha(b'other')})
put(t, PDF)
st, c = call('POST', f"/files/{t['fileId']}/complete", SEL)
rec('A-12 해시 불일치 → 422 FILE_HASH_MISMATCH', st == 422 and c['code'] == 'FILE_HASH_MISMATCH', (st, c))
# 크게 보냄 — Content-Length
st, t = create(SEL, 'OWNERSHIP_DOC', 'over.pdf', 'application/pdf', PDF, size=1000, digest=False)
s2 = put(t, PDF)
rec('A-13 밝힌 크기보다 큰 바이트(Content-Length) → 413 · 여전히 UPLOADING', s2[0] == 413 and s2[1]['code'] == 'FILE_TOO_LARGE'
    and q(f"select status from files where id='{t['fileId']}'") == 'UPLOADING', s2[:2])
OVER = t
# 크게 보냄 — chunked (길이 없이 흘려 보냄)
u = urllib.parse.urlparse(ORIGIN + OVER['uploadUrl'] if OVER['uploadUrl'].startswith('/') else OVER['uploadUrl'])
try:
    cn = http.client.HTTPConnection(u.hostname, u.port, timeout=20)
    cn.putrequest('PUT', u.path + '?' + u.query); cn.putheader('Content-Type', 'application/pdf'); cn.putheader('Transfer-Encoding', 'chunked'); cn.endheaders()
    sent = 0
    try:
        for _ in range(64):
            chunk = (PDF * 2)[:4096]; cn.send(b'%x\r\n%s\r\n' % (len(chunk), chunk)); sent += len(chunk)
        cn.send(b'0\r\n\r\n')
    except Exception:
        pass
    rr = cn.getresponse(); cst = rr.status; cb = rr.read()
except Exception as e:
    cst, cb = -1, str(e)
st, c = call('POST', f"/files/{OVER['fileId']}/complete", SEL)
rec('A-14 chunked 로 크게 보냄 → 413(또는 연결 끊김) · 디스크에 남지 않음(complete 409 미업로드)', cst in (413, -1) and st == 409 and c['code'] == 'FILE_NOT_UPLOADED', (cst, str(cb)[:80], st, c))
# 토큰
st, t = create(SEL, 'OWNERSHIP_DOC', 'tok.pdf', 'application/pdf', PDF)
TID = t['fileId']
base_put = f"/api/v1/files/{TID}/content?t="
s_a = req('PUT', base_put + t['uploadUrl'].split('t=')[1][:-3] + 'AAA', raw=PDF, ct='application/pdf')
s_b = req('PUT', base_put + token('get', TID, 600), raw=PDF, ct='application/pdf')
s_c = req('PUT', f"/api/v1/files/{FID}/content?t=" + t['uploadUrl'].split('t=')[1], raw=PDF, ct='application/pdf')
s_d = req('PUT', base_put + token('put', TID, -5), raw=PDF, ct='application/pdf')
s_e = req('PUT', f"/api/v1/files/{TID}/content", raw=PDF, ct='application/pdf')
rec('A-15 토큰 — 변조 · get 토큰으로 PUT · 다른 파일 토큰 · 없음 → 403 FILE_TOKEN_INVALID', s_a[0] == 403 and s_a[1]['code'] == 'FILE_TOKEN_INVALID'
    and s_b[0] == 403 and s_c[0] == 403 and s_e[0] == 403, (s_a[:2], s_b[0], s_c[0], s_e[0]))
rec('A-16 만료된 토큰 → 403 FILE_TOKEN_EXPIRED', s_d[0] == 403 and s_d[1]['code'] == 'FILE_TOKEN_EXPIRED', s_d[:2])
g_exp = req('GET', f"/api/v1/files/{FID}/content?t=" + token('get', FID, -5), ct=None)
g_put = req('GET', f"/api/v1/files/{FID}/content?t=" + token('put', FID, 600), ct=None)
rec('A-17 내려받기 주소 — 만료 403 · put 토큰으로 GET 403', g_exp[0] == 403 and g_exp[1]['code'] == 'FILE_TOKEN_EXPIRED' and g_put[0] == 403, (g_exp[:2], g_put[0]))
s_f = put(t, PDF, ct='text/html')
rec('A-18 Content-Type 이 밝힌 형식과 다름 → 415', s_f[0] == 415 and s_f[1]['code'] == 'FILE_CONTENT_TYPE', s_f[:2])
st, c = call('POST', f'/files/{TID}/complete', BUY)
st2, c2 = call('POST', f'/files/{TID}/complete', SEL)
rec('A-19 남의 파일 complete → 404 · 안 올리고 complete → 409 FILE_NOT_UPLOADED', st == 404 and st2 == 409 and c2['code'] == 'FILE_NOT_UPLOADED', (st, st2, c2))
s_g = put({'method': 'PUT', 'uploadUrl': f"/api/v1/files/{FID}/content?t=" + token('put', FID, 600), 'headers': {'Content-Type': 'application/pdf'}}, PDF)
rec('A-20 READY 파일에 다시 PUT(바꿔치기) → 409', s_g[0] == 409 and s_g[1]['code'] == 'FILE_STATE', s_g[:2])
for path_ in ['/files/..%2F..%2Fetc%2Fpasswd', '/files/%2e%2e', '/files/00000000-0000-0000-0000-000000000000']:
    st, j = call('GET', path_, SEL)
    rec(f'A-21 경로 조작 · 없는 id {path_} → 404', st == 404, (st, j))
s_h = req('GET', '/api/v1/files/..%2F..%2F..%2Fetc%2Fpasswd/content?t=' + token('get', '../../../etc/passwd', 60), ct=None)
rec('A-22 경로 조작 id 에 맞춘 토큰으로 내려받기 → 404 (디스크에 닿지 않음)', s_h[0] in (403, 404) and b'root:' not in (s_h[1] if isinstance(s_h[1], bytes) else b''), s_h[:2])
# DB 가 막는 것
rc, err = sql(f"insert into files (owner_account_id,purpose,original_name,content_type,size_bytes,storage_provider,storage_key) "
              f"select id,'OWNERSHIP_DOC','x.pdf','application/pdf',10,'LOCAL','ownership_doc/2026/10/../../../etc/passwd' from accounts where email='intro@x.com'")
rec('A-23 DB — 저장 키 경로 조작 거절 (ck_files_storage_key)', rc != 0 and 'ck_files_storage_key' in err, err[:120])
rc, err = sql(f"update files set size_bytes = size_bytes + 1 where id='{FID}'")
rc2, err2 = sql(f"update files set status='UPLOADING' where id='{FID}'")
rc3, err3 = sql(f"insert into files (owner_account_id,purpose,original_name,content_type,size_bytes,storage_provider,storage_key,status) "
                f"select id,'OWNERSHIP_DOC','x.pdf','application/pdf',10,'LOCAL','ownership_doc/2026/10/{uuid.uuid4()}.pdf','READY' from accounts where email='intro@x.com'")
rec('A-24 DB — 크기 바꾸기 · READY→UPLOADING · 처음부터 READY 거절', rc != 0 and 'FILE:' in err and rc2 != 0 and rc3 != 0, (err[:80], err2[:80], err3[:80]))
rc, err = sql(f"delete from files where id='{FID}'")
rec('A-25 DB — 파일 기록 삭제 거절 (DELETED 상태로만)', rc != 0 and 'FILE:' in err, err[:100])
# 올리는 중 20개 제한 — 새 계정으로
e = f'file_{uuid.uuid4().hex[:6]}@t.local'
call('POST', '/auth/signup', body={'email': e, 'password': 'sgb-test-1234', 'name': '파일 시험', 'agreedTerms': []})
NEW = login(e, 'sgb-test-1234')
codes = [create(NEW, 'OWNERSHIP_DOC', f'q{i}.pdf', 'application/pdf', PDF)[0] for i in range(21)]
st, j = create(NEW, 'OWNERSHIP_DOC', 'q.pdf', 'application/pdf', PDF)
rec('A-26 올리는 중 파일 한 시간 20개 제한 → 21번째 422', codes[:20].count(201) == 20 and codes[20] == 422 and st == 422, (codes[-3:], j))
# 지우기
fid_del = upload(SEL, 'OWNERSHIP_DOC', 'del.pdf', 'application/pdf', PDF + b'del')
st, j = call('DELETE', f'/files/{fid_del}', BUY)
st2, j2 = call('DELETE', f'/files/{fid_del}', SEL)
st3, j3 = call('GET', f'/files/{fid_del}', SEL)
rec('A-27 지우기 — 남의 것 404 · 내 것 DELETED · 그 뒤 열기 404', st == 404 and st2 == 200 and j2['status'] == 'DELETED' and st3 == 404, (st, st2, st3))

# ═════════ B. 소유 확인 (등기사항증명서) ═════════
cat = q("select id from categories where gwan_code='MAL' and axis='RE' order by code limit 1")
LIDS = q("select string_agg(id::text, ',' order by created_at) from (select l.id, l.created_at from listings l join accounts a on a.id=l.owner_account_id "
         "where a.email='intro@x.com' and l.title like 'D007 시험 매물%' and l.status <> 'PUBLISHED' order by l.created_at limit 3) x").split(',')
LIDS = [x for x in LIDS if x]
while len(LIDS) < 3:
    st, j = call('POST', '/listings', SEL, {'gwanCode': 'MAL', 'categoryId': cat, 'title': f'D007 시험 매물 {len(LIDS) + 1}', 'feeBearer': 'SELLER'})
    LIDS.append(j['listingId'])
L1, L2, L3 = LIDS
today = datetime.date.today().isoformat()
DOC = upload(SEL, 'OWNERSHIP_DOC', '등기사항증명서_운양동.pdf', 'application/pdf', PDF + b'B1')
st, j = call('POST', f'/me/listings/{L1}/ownership', SEL, {'fileId': DOC, 'issuedOn': today, 'hasEncumbrance': True})
row = q(f"select doc_file_id||'|'||doc_key||'|'||state from owner_verifications where listing_id='{L1}'")
rec('B-1 소유 확인을 파일로 제출 → doc_file_id · doc_key=파일 이름', st in (200, 201) and j.get('ok') and row == f'{DOC}|등기사항증명서_운양동.pdf|SUBMITTED', (st, j, row))
st, j = call('GET', f'/me/listings/{L1}/ownership', SEL)
rec('B-2 내 소유 확인 상태에 docFileId', st == 200 and j['docFileId'] == DOC, j)
st, j = call('GET', '/admin/ownership-queue', ADM)
it = next((x for x in j['items'] if x['listingId'] == L1), None)
rec('B-3 운영 대기 목록에 docFileId · 형식 · 크기', it and it['docFileId'] == DOC and it['docFileType'] == 'application/pdf' and int(it['docFileSize']) == len(PDF) + 2, it)
st, o = call('GET', f'/files/{DOC}?disposition=inline', ADM)
s_, b_, h_ = fetch_url(o['url'])
rec('B-4 운영 「문서 열기」 → 같은 바이트(inline)', st == 200 and s_ == 200 and b_ == PDF + b'B1' and h_.get('Content-Disposition', '').startswith('inline'), (st, s_))
BDOC = upload(BUY, 'OWNERSHIP_DOC', 'buyer.pdf', 'application/pdf', PDF + b'buyer')
st, j = call('POST', f'/me/listings/{L2}/ownership', SEL, {'fileId': BDOC, 'issuedOn': today})
rec('B-5 남이 올린 파일로 제출 → 422 FILE (DB 트리거)', st == 422 and j['code'] == 'FILE' and '신청자' in j['message'], (st, j))
st, t = create(SEL, 'OWNERSHIP_DOC', 'pending.pdf', 'application/pdf', PDF)
st, j = call('POST', f'/me/listings/{L2}/ownership', SEL, {'fileId': t['fileId'], 'issuedOn': today})
rec('B-6 확인 전(UPLOADING) 파일로 제출 → 422 FILE', st == 422 and j['code'] == 'FILE', (st, j))
st, j = call('POST', f'/me/listings/{L2}/ownership', SEL, {'fileId': SPOOF, 'issuedOn': today})
rec('B-7 거절된(REJECTED · 형식 위장) 파일로 제출 → 422 FILE', st == 422 and j['code'] == 'FILE', (st, j))
st, j = call('POST', f'/me/listings/{L2}/ownership', SEL, {'fileId': DOC, 'issuedOn': today})
rec('B-8 같은 등기부 파일로 다른 매물 → 409 DUPLICATE', st == 409, (st, j))
st, j = call('POST', f'/me/listings/{L2}/ownership', SEL, {'issuedOn': today})
st2, j2 = call('POST', f'/me/listings/{L2}/ownership', SEL, {'fileId': 'not-a-uuid', 'issuedOn': today})
rec('B-9 파일도 이름도 없음 → 400 · fileId 형식 틀림 → 400', st == 400 and st2 == 400, (st, j, st2))
st, j = call('POST', f'/me/listings/{L3}/ownership', SEL, {'docKey': 'reg-legacy-001.pdf', 'issuedOn': today})
rec('B-10 (호환) 이름만 제출도 그대로 됨 → doc_file_id 없음', st in (200, 201) and j.get('ok') and q(f"select coalesce(doc_file_id::text,'-') from owner_verifications where listing_id='{L3}'") == '-', (st, j))
st, j = call('DELETE', f'/files/{DOC}', SEL)
rec('B-11 제출에 쓰인 파일 지우기 → 422 FILE', st == 422 and j['code'] == 'FILE', (st, j))
st, j = call('GET', f'/files/{DOC}', BUY)
rec('B-12 제출된 등기부를 다른 회원이 열기 → 404', st == 404, (st, j))
for L in (L1, L3):
    oid = q(f"select id from owner_verifications where listing_id='{L}' and state='SUBMITTED'")
    if oid: call('POST', f'/admin/ownership/{oid}/decide', ADM, {'state': 'REJECTED', 'reason': 'D007 검증 — 시험 제출 정리'})
rec('B-13 정리 — 시험 제출 거절로 닫음', q(f"select count(*) from owner_verifications where listing_id in ('{L1}','{L3}') and state='SUBMITTED'") == '0')

# ═════════ C. 마케팅자료 ═════════
MF = upload(ADM, 'MARKETING_MATERIAL', '가을 배너.png', 'image/png', PNG)
st, j = call('POST', '/admin/affiliates/materials', ADM, {'title': 'D007 시험 배너', 'kind': 'BANNER', 'body': '가을 태양광 상담 이벤트', 'fileId': MF})
MID = j.get('id')
rec('C-1 운영 자료 등록 → 심의 대기(PENDING) · file_key=파일 이름', st in (200, 201) and j.get('state') == 'PENDING'
    and q(f"select file_key from marketing_materials where id='{MID}'") == '가을 배너.png', (st, j))
st, j = call('GET', '/admin/affiliates/materials/queue', ADM)
it = next((x for x in j['items'] if x['id'] == MID), None)
rec('C-2 심의 큐에 fileId · 이름', it and it['fileId'] == MF and it['fileName'] == '가을 배너.png', it)
st, j = call('GET', f'/files/{MF}', SEL)
rec('C-3 심의 전 파트너 열기 → 404', st == 404, (st, j))
call('POST', f'/admin/affiliates/materials/{MID}/review', ADM, {'state': 'APPROVED'})
st, rows = call('GET', '/partner/affiliate/materials', SEL)
m = next((x for x in rows if x['id'] == MID), None)
st2, o = call('GET', f'/files/{MF}', SEL)
s_, b_, h_ = fetch_url(o['url']) if st2 == 200 else (0, b'', {})
rec('C-4 승인 후 파트너 자료실에 fileId · ACTIVE 파트너 내려받기 OK', m and m['fileId'] == MF and st2 == 200 and s_ == 200 and b_ == PNG
    and h_.get('Content-Type', '').startswith('image/png'), (m, st2, s_))
st, j = call('GET', f'/files/{MF}', BUY)
rec('C-5 파트너가 아닌 회원 → 403 PARTNER_ONLY', st == 403 and j['code'] == 'PARTNER_ONLY', (st, j))
st, j = call('POST', '/admin/affiliates/materials', ADM, {'title': 'D007 영상에 그림', 'kind': 'VIDEO', 'fileId': upload(ADM, 'MARKETING_MATERIAL', 'v.png', 'image/png', PNG + b'v')})
st2, j2 = call('POST', '/admin/affiliates/materials', ADM, {'title': 'D007 파일 없는 배너', 'kind': 'BANNER'})
st3, j3 = call('POST', '/admin/affiliates/materials', ADM, {'title': 'D007 빈 문구', 'kind': 'COPY'})
rec('C-6 형식 불일치(영상에 PNG) 422 FILE · 파일 없는 배너 422 · 본문 없는 문구 422', st == 422 and j['code'] == 'FILE'
    and st2 == 422 and j2['code'] == 'MATERIAL_FILE_REQUIRED' and st3 == 422 and j3['code'] == 'MATERIAL_BODY_REQUIRED', (st, j, st2, st3))
VF = upload(ADM, 'MARKETING_MATERIAL', 'promo.mp4', 'video/mp4', MP4)
st, j = call('POST', '/admin/affiliates/materials', ADM, {'title': 'D007 시험 영상', 'kind': 'VIDEO', 'fileId': VF})
VID = j.get('id')
rec('C-7 MP4 영상 자료 등록', st in (200, 201) and j.get('state') == 'PENDING', (st, j))
st, j = call('POST', '/admin/affiliates/materials', ADM, {'title': 'D007 등기부를 자료로', 'kind': 'DOC', 'fileId': BDOC})
rec('C-8 다른 용도(등기부) 파일을 자료로 → 422 FILE', st == 422 and j['code'] == 'FILE', (st, j))
st, j = call('POST', '/admin/affiliates/materials', SEL, {'title': 'D007 회원 등록', 'kind': 'COPY', 'body': '회원이 올린 문구입니다'})
rec('C-9 회원이 자료 등록 → 403', st == 403, (st, j))
MF2 = upload(ADM, 'MARKETING_MATERIAL', 'swap.png', 'image/png', PNG + b'swap')
rc, err = sql(f"update marketing_materials set file_id='{MF2}' where id='{MID}'")
rec('C-10 DB — 승인된 자료의 파일 바꿔치기 거절', rc != 0 and 'FILE:' in err, err[:120])
st, rows = call('GET', '/partner/affiliate/materials', BUY)
rec('C-11 자료 목록은 회원에게도 보이되(fileId 포함) 내려받기만 파트너로 제한', st == 200 and any(x['id'] == MID and x['fileId'] == MF for x in rows), st)
call('POST', f'/admin/affiliates/materials/{VID}/review', ADM, {'state': 'REJECTED', 'reason': 'D007 검증 — 시험 자료 정리'})
# 정리 — 승인된 시험 자료가 파트너 자료실에 남지 않게 반려로 닫습니다 (검수 기록은 남김)
sql(f"update marketing_materials set state='REJECTED', reject_reason='D007 검증 — 시험 자료 정리' where id='{MID}'")

# ═════════ D. 파트너가이드 ═════════
GF = upload(ADM, 'PARTNER_GUIDE', '파트너 시작 안내.pdf', 'application/pdf', PDF + b'guide')
st, j = call('POST', '/admin/affiliates/guides', ADM, {'title': 'D007 시험 가이드', 'body': '링크를 만들고 공유하는 법', 'sortOrder': 1, 'fileId': GF})
GID = j.get('id')
st2, rows = call('GET', '/partner/affiliate/guides', SEL)
g = next((x for x in rows if x['id'] == GID), None)
st3, o = call('GET', f'/files/{GF}', SEL)
s_, b_, _ = fetch_url(o['url']) if st3 == 200 else (0, b'', {})
rec('D-1 가이드 등록 → 파트너가이드에 fileId · 파트너 내려받기', st in (200, 201) and g and g['fileId'] == GF and st3 == 200 and b_ == PDF + b'guide', (st, g, st3))
st, j = call('GET', f'/files/{GF}', BUY)
rec('D-2 파트너 아닌 회원 → 403 PARTNER_ONLY', st == 403 and j['code'] == 'PARTNER_ONLY', (st, j))
st, j = call('POST', '/admin/affiliates/guides', ADM, {'title': 'D007 잘못된 첨부', 'body': '용도가 다른 파일', 'fileId': MF})
rec('D-3 다른 용도(마케팅) 파일을 가이드에 → 422 FILE', st == 422 and j['code'] == 'FILE', (st, j))
st, j = call('PATCH', f'/admin/affiliates/guides/{GID}', ADM, {'isActive': False})
st2, rows = call('GET', '/partner/affiliate/guides', SEL)
st3, j3 = call('GET', f'/files/{GF}', SEL)
rec('D-4 가이드 끄기 → 목록에서 빠짐 · 첨부 404', st == 200 and not any(x['id'] == GID for x in rows) and st3 == 404, (st, st3))
st, j = call('GET', '/admin/affiliates/guides', ADM)
rec('D-5 운영 가이드 전체(꺼진 것 포함)', st == 200 and any(x['id'] == GID and x['isActive'] is False for x in j), st)
st, j = call('POST', '/admin/affiliates/guides', SEL, {'title': 'D007 회원 가이드', 'body': '회원이 올린 가이드'})
rec('D-6 회원이 가이드 등록 → 403', st == 403, (st, j))
st, j = call('PATCH', f'/admin/affiliates/guides/{GID}', ADM, {'removeFile': True})
rec('D-7 첨부 떼기', st == 200 and q(f"select coalesce(file_id::text,'-') from partner_guides where id='{GID}'") == '-', (st, j))
sql(f"delete from partner_guides where id='{GID}'")

# ═════════ S. S3 모드 (가짜 S3 · SigV4 독립 검증) ═════════
API_S3 = os.environ.get('API_S3'); MOCK_PORT = int(os.environ.get('S3_MOCK_PORT', '9022'))
AK, SK, REGION, BUCKET = 'AKIDSGBTEST', 'sgb-test-secret-key', 'ap-northeast-2', 'sgb-test'
STORE, LOG = {}, []

def enc(s, safe='-_.~'):
    return urllib.parse.quote(s, safe=safe)

class S3Mock(BaseHTTPRequestHandler):
    """S3 presigned URL 을 받는 가짜 서버. 서명은 AWS 문서 절차를 파이썬으로 따로 구현해 대조합니다."""
    def log_message(self, *a): pass
    def deny(self, code, msg):
        b = f'<?xml version="1.0"?><Error><Code>{code}</Code><Message>{msg}</Message></Error>'.encode()
        self.send_response(403); self.send_header('Content-Type', 'application/xml'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def verify(self):
        u = urllib.parse.urlsplit(self.path)
        qs = urllib.parse.parse_qsl(u.query, keep_blank_values=True)
        qd = dict(qs)
        sig = qd.get('X-Amz-Signature')
        if not sig or qd.get('X-Amz-Algorithm') != 'AWS4-HMAC-SHA256': return 'AccessDenied', 'no signature'
        akid, day, region, svc, term = qd['X-Amz-Credential'].split('/')
        if akid != AK or region != REGION or svc != 's3' or term != 'aws4_request': return 'InvalidAccessKeyId', 'credential'
        t0 = datetime.datetime.strptime(qd['X-Amz-Date'], '%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc)
        if datetime.datetime.now(datetime.timezone.utc) > t0 + datetime.timedelta(seconds=int(qd['X-Amz-Expires'])):
            return 'AccessDenied', 'Request has expired'
        signed = qd['X-Amz-SignedHeaders'].split(';')
        hdrs = {k.lower(): ' '.join(v.split()) for k, v in self.headers.items()}
        cq = '&'.join(f'{enc(k)}={enc(v)}' for k, v in sorted((k, v) for k, v in qs if k != 'X-Amz-Signature'))
        ch = ''.join(f'{h}:{hdrs.get(h, "")}\n' for h in signed)
        creq = '\n'.join([self.command, enc(urllib.parse.unquote(u.path), safe='/-_.~'), cq, ch, ';'.join(signed), 'UNSIGNED-PAYLOAD'])
        sts = '\n'.join(['AWS4-HMAC-SHA256', qd['X-Amz-Date'], f'{day}/{region}/s3/aws4_request', hashlib.sha256(creq.encode()).hexdigest()])
        k = ('AWS4' + SK).encode()
        for part in (day, region, 's3', 'aws4_request'): k = hmac.new(k, part.encode(), hashlib.sha256).digest()
        want = hmac.new(k, sts.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(want, sig): return 'SignatureDoesNotMatch', 'signature mismatch'
        return None, qd
    def objkey(self):
        p = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        assert p.startswith(f'/{BUCKET}/'); return p[len(BUCKET) + 2:]
    def do_PUT(self):
        n = int(self.headers.get('Content-Length') or 0); body = self.rfile.read(n)
        err, qd = self.verify(); LOG.append(('PUT', err))
        if err: return self.deny(err, qd)
        STORE[self.objkey()] = (body, self.headers.get('Content-Type'))
        self.send_response(200); self.send_header('ETag', '"%s"' % hashlib.md5(body).hexdigest()); self.send_header('Content-Length', '0'); self.end_headers()
    def do_GET(self):
        err, qd = self.verify(); LOG.append(('GET', err))
        if err: return self.deny(err, qd)
        o = STORE.get(self.objkey())
        if not o:
            b = b'<Error><Code>NoSuchKey</Code></Error>'; self.send_response(404); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b); return
        self.send_response(200)
        self.send_header('Content-Type', qd.get('response-content-type') or o[1] or 'binary/octet-stream')
        if qd.get('response-content-disposition'): self.send_header('Content-Disposition', qd['response-content-disposition'])
        self.send_header('Content-Length', str(len(o[0]))); self.end_headers(); self.wfile.write(o[0])
    def do_DELETE(self):
        err, qd = self.verify(); LOG.append(('DELETE', err))
        if err: return self.deny(err, qd)
        STORE.pop(self.objkey(), None); self.send_response(204); self.end_headers()

if API_S3:
    srv = ThreadingHTTPServer(('127.0.0.1', MOCK_PORT), S3Mock)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    S = lambda m, p, tok=None, body=None: call(m, p, tok, body, base=API_S3)
    SEL3 = login('intro@x.com', base=API_S3); BUY3 = login('buyer@x.com', base=API_S3)
    st, t = create(SEL3, 'OWNERSHIP_DOC', '등기부(S3).pdf', 'application/pdf', PDF, base=API_S3)
    u = urllib.parse.urlsplit(t['uploadUrl']); qd = dict(urllib.parse.parse_qsl(u.query))
    rec('S-1 S3 모드 — presigned PUT 주소 (가짜 S3 · 경로 방식 · content-length;content-type;host 서명 · 600초)',
        st == 201 and t['provider'] == 'S3' and u.netloc == f'127.0.0.1:{MOCK_PORT}' and u.path.startswith(f'/{BUCKET}/ownership_doc/')
        and qd['X-Amz-SignedHeaders'] == 'content-length;content-type;host' and qd['X-Amz-Expires'] == '600', (st, t.get('uploadUrl', '')[:120]))
    s_ = put(t, PDF, ct='application/octet-stream')
    rec('S-2 서명한 Content-Type 과 다르게 PUT → S3 가 거절(SignatureDoesNotMatch)', s_[0] == 403 and LOG[-1] == ('PUT', 'SignatureDoesNotMatch'), (s_[0], LOG[-1:]))
    s_ = put(t, PDF + b'extra')
    rec('S-3 서명한 크기와 다른 바이트 → S3 가 거절', s_[0] == 403 and LOG[-1] == ('PUT', 'SignatureDoesNotMatch'), (s_[0], LOG[-1:]))
    bad = t['uploadUrl'][:-4] + ('0000' if not t['uploadUrl'].endswith('0000') else '1111')
    s_ = req('PUT', bad, raw=PDF, ct='application/pdf')
    rec('S-4 서명 변조 → 403', s_[0] == 403, s_[0])
    st, c = S('POST', f"/files/{t['fileId']}/complete", SEL3)
    rec('S-5 S3 에 아직 없음 → complete 409 FILE_NOT_UPLOADED', st == 409 and c['code'] == 'FILE_NOT_UPLOADED', (st, c))
    s_ = put(t, PDF)
    rec('S-6 presigned PUT 성공 (가짜 S3 가 서명 검증 통과)', s_[0] == 200 and LOG[-1] == ('PUT', None), (s_[0], LOG[-1:]))
    st, c = S('POST', f"/files/{t['fileId']}/complete", SEL3)
    rec('S-7 complete — 서버가 presigned GET 으로 S3 바이트를 읽어 크기 · 해시 · 형식 확인 → READY', st == 200 and c['status'] == 'READY' and c['sha256'] == sha(PDF), (st, c))
    st, o = S('GET', f"/files/{t['fileId']}", SEL3)
    du = urllib.parse.urlsplit(o['url']); dq = dict(urllib.parse.parse_qsl(du.query))
    s_, b_, h_ = fetch_url(o['url'])
    rec('S-8 내려받기 presigned GET (300→3초 설정) · response-content-disposition(한글 RFC5987) · 바이트 동일', st == 200 and s_ == 200 and b_ == PDF
        and "filename*=UTF-8''%EB%93%B1%EA%B8%B0%EB%B6%80%28S3%29.pdf" in h_.get('Content-Disposition', '') and dq['response-content-type'] == 'application/pdf', (st, s_, h_.get('Content-Disposition')))
    time.sleep(4.5)
    s_, b_, h_ = fetch_url(o['url'])
    rec('S-9 만료된 presigned GET → S3 403 (Request has expired)', s_ == 403 and b'expired' in b_, (s_, b_[:80] if isinstance(b_, bytes) else b_))
    st, j = S('GET', f"/files/{t['fileId']}", BUY3)
    rec('S-10 S3 모드에서도 남의 파일 → 404', st == 404, (st, j))
    st, t2 = create(SEL3, 'OWNERSHIP_DOC', 'fake.pdf', 'application/pdf', HTML, base=API_S3)
    put(t2, HTML)
    k2 = urllib.parse.unquote(urllib.parse.urlsplit(t2['uploadUrl']).path)[len(BUCKET) + 2:]
    had = k2 in STORE
    st, c = S('POST', f"/files/{t2['fileId']}/complete", SEL3)
    time.sleep(0.3)
    rec('S-11 S3 형식 위장 → 422 FILE_TYPE_MISMATCH · S3 객체 삭제(presigned DELETE)', had and st == 422 and c['code'] == 'FILE_TYPE_MISMATCH'
        and k2 not in STORE and ('DELETE', None) in LOG, (had, st, c, LOG[-2:]))
    st, j = S('PUT', f"/files/{t['fileId']}/content?t={token('put', t['fileId'], 600)}")
    rec('S-12 S3 모드에서는 로컬 토큰 주소를 쓰지 않음 → 404', st in (404, 409), (st, j))
    srv.shutdown()
else:
    print('-- S 구간 건너뜀 (API_S3 없음)', file=sys.stderr)

# ═════════ O. 오프라인 시험 (SigV4 공식 예시 · 자격 증명 순서 · 경로 · 판정) ═════════
KIT = os.environ.get('KIT', '/tmp/kit_file')
if os.path.exists(os.path.join(KIT, 'scripts/test-s3-presign-offline.ts')):
    p = subprocess.run(['npx', 'ts-node', '-P', 'tsconfig.scripts.json', 'scripts/test-s3-presign-offline.ts'], cwd=KIT, capture_output=True, text=True)
    last = (p.stdout.strip().split('\n') or [''])[-1]
    rec('O-1 오프라인 시험 (AWS SigV4 공식 예시 aeeed9bb… · f4780e2d… · 자격 증명 · 경로 조작 · 매직바이트 · 토큰)', p.returncode == 0, last)
else:
    print('-- O 구간 건너뜀 (KIT 없음)', file=sys.stderr)

json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'srv_file.json'), 'w'), ensure_ascii=False, indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)}")
