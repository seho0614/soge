"""v10.149 시험 — 파일 저장 위치 S3 옮기기(docs/229) · 서버에서 직접(bash · psql · 가짜 aws)

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1149.py

  ① 코드 — API(ADMIN · SUPER · 읽기만) · DTO · 화면 목록 · 운영 화면 한 줄 · 스크립트 4방식 · 지우는 명령 없음 · docs/229 · 판
  ② (API) 점검판 LOCAL · 파일 수가 DB 와 같음 · 손님 403
  ③ (스크립트 · 가짜 aws) 시험 파일 3개(쓰는 것 2 · 올리다 만 것 1) → check · copy · verify · apply(no → 그대로 · yes → S3) · 화면 API pendingMove · 지움
"""
import json, os, re, shutil, stat, subprocess, tempfile, urllib.error, urllib.request, uuid

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
FC = rd('src/modules/file/file.controller.ts'); FS = rd('src/modules/file/file.service.ts'); FD = rd('src/modules/file/file.dto.ts')
DM = rd('prisma/migrations/D143_files_move/migration.sql')
mig = sorted(x for x in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', x)))
ok('① D143 — fn_files_guard 다시 만듦 · 저장 위치만 · sgb.files_move 표시 · LOCAL ↔ S3 · 다른 열 그대로 · 지우는 문장 없음 · 181 이상',
   'CREATE OR REPLACE FUNCTION public.fn_files_guard()' in DM and "current_setting('sgb.files_move', true)" in DM
   and all(f'NEW.{c} IS DISTINCT FROM OLD.{c}' in DM for c in ('owner_account_id', 'purpose', 'content_type', 'size_bytes', 'storage_key', 'original_name'))
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP TRIGGER|TRUNCATE|UPDATE )\b', DM) and len(mig) >= 181 and 'D143_files_move' in mig, f'{len(mig)} · {mig[-1]}')
ok('① API — GET /admin/storage-status(ADMIN · SUPER) · DTO · 읽기만(UPDATE 없음) · 버킷 이름만',
   "@Get('admin/storage-status')" in FC and re.search(r"@Get\('admin/storage-status'\)\s*\n\s*@Roles\('ADMIN', 'SUPER'\)", FC)
   and 'class StorageStatusDto' in FD and 'async storageStatus()' in FS
   and 'UPDATE' not in FS.split('async storageStatus()')[1].split('private async row')[0] and 'pendingMove' in FS, '')
scr = {s['id']: s for s in json.loads(rd('spec/screens.json') or '{}').get('screens', [])}
ok('① 화면 목록 — 오픈 체크리스트에 API 연결', 'GET /admin/storage-status' in scr.get('SB-ADM-SIT-040', {}).get('apis', []), '')
OC = rd('web/src/app/admin/OpenChecklist.tsx')
ok('① 운영 화면 — 「파일 저장 위치」 한 줄 · 옮기기 덜 끝남', "'/admin/storage-status'" in OC and 'data-storage=' in OC and '옮기기 덜 끝남' in OC, '')
SH = rd('deploy/aws/files-to-s3.sh')
body = '\n'.join(l for l in SH.splitlines() if not l.lstrip().startswith('#'))
ok('① 스크립트 — check · copy · verify · apply · apply 는 yes · 한 거래 · 지우는 명령 없음(시험 파일 rm 하나만) · 실행 권한',
   all(f'"$MODE" = {m}' in SH for m in ('check', 'copy', 'verify')) and 'read -r yn' in SH and "BEGIN; SET LOCAL sgb.files_move = 'on'; UPDATE files SET storage_provider = 'S3'" in SH
   and "SET LOCAL sgb.files_move = 'on'" in SH and '--delete' not in body and 'DELETE FROM' not in body and 'rm -rf' not in body
   and len(re.findall(r'aws s3 rm ', body)) == 1 and os.access(os.path.join(K, 'deploy/aws/files-to-s3.sh'), os.X_OK), '')
D229 = next((rd('docs/' + f) for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('229_')), '')
ok('① docs/229 — 준비(공개 차단 · 역할 · CORS) · 순서 7단계 · 되돌리기 · 디스크 안 지움', 'AllowedOrigins' in D229 and 's3:PutObject' in D229
   and 'files-to-s3.sh apply' in D229 and '되돌리기' in D229 and '지우지 않습니다' in D229, '')
ok('① 판 v10.149 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 149), rd('VERSION').strip())


# ── ② API ────────────────────────────────────────────────────────────
def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        return {'_err': e.code}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


FAKE_AWS = r'''#!/usr/bin/env bash
# 가짜 aws — 버킷 = $FAKE_S3 폴더
B="$FAKE_S3"; mkdir -p "$B"
case "$1 $2" in
  "s3api head-bucket") exit 0 ;;
  "s3api get-public-access-block") printf 'True\tTrue\tTrue\tTrue\n' ;;
  "s3api get-bucket-cors") echo 'https://sogaebank.com' ;;
  "s3api list-objects-v2") (cd "$B" && find . -type f -printf '%P\t%s\n') ;;
  "s3 cp") k="${4#s3://*/}"; mkdir -p "$B/$(dirname "$k")"; cat > "$B/$k" ;;
  "s3 rm") k="${3#s3://*/}"; rm -f "$B/$k" ;;
  "s3 sync") cp -r "$3"/. "$B"/ ;;
  *) echo "fake aws: $*" >&2; exit 2 ;;
esac
'''

if API and DB:
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW})['accessToken']
    BT = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW})['accessToken']
    st = call('GET', '/admin/storage-status', t=T_)
    n_local = psql("SELECT count(*) FROM files WHERE storage_provider = 'LOCAL' AND status <> 'DELETED'")
    ok('② 점검판 = 서버 디스크(LOCAL) · 버킷 없음 · 파일 수가 DB 와 같음 · 옮기기 아님',
       st.get('kind') == 'LOCAL' and st.get('bucket') is None and str(st.get('localFiles')) == n_local and st.get('pendingMove') is False, json.dumps(st)[:160])
    ok('② 손님 403', call('GET', '/admin/storage-status', t=BT).get('_err') == 403, '')

    # ── ③ 스크립트 ───────────────────────────────────────────────────
    tmp = tempfile.mkdtemp(prefix='v1149_', dir=os.environ.get('TMPDIR') or None)
    app, up, s3, binp, data = (os.path.join(tmp, x) for x in ('app', 'uploads', 's3', 'bin', 'data'))
    for d in (app, up, s3, binp, data): os.makedirs(d)
    open(os.path.join(app, '.env'), 'w').write(f'DATABASE_URL={DB}\nUPLOAD_DIR={up}\n')
    open(os.path.join(app, 'VERSION'), 'w').write('v10.149-test\n')
    fa = os.path.join(binp, 'aws'); open(fa, 'w').write(FAKE_AWS); os.chmod(fa, os.stat(fa).st_mode | stat.S_IEXEC)
    owner = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
    ids = []
    try:
        for i, status in enumerate(('READY', 'READY', 'UPLOADING')):
            fid = str(uuid.uuid4()); key = f'listing_image/2026/10/{fid}.png'; body = f'v1149-{i}'.encode() * 10
            # 새 파일은 UPLOADING 으로만 만들 수 있음(DB 규칙) → 쓰는 것은 READY 로 바꿈
            psql(f"INSERT INTO files (id, owner_account_id, purpose, original_name, content_type, size_bytes, storage_provider, storage_key) "
                 f"VALUES ('{fid}', '{owner}', 'LISTING_IMAGE', 'v1149_{i}.png', 'image/png', {len(body)}, 'LOCAL', '{key}')")
            if status == 'READY':
                psql(f"UPDATE files SET status = 'READY', detected_type = 'image/png', sha256 = '{'a' * 64}', completed_at = now() WHERE id = '{fid}'")
            ids.append(fid)
            if status == 'READY':
                os.makedirs(os.path.join(up, os.path.dirname(key)), exist_ok=True); open(os.path.join(up, key), 'wb').write(body)
        env = dict(os.environ, PATH=binp + ':' + os.environ['PATH'], FAKE_S3=s3, APP_LINK=app, DATA_DIR=data, S3_BUCKET='sgb-test-bucket', HOME=tmp)
        SCR = os.path.join(K, 'deploy/aws/files-to-s3.sh')
        run = lambda mode, inp='': subprocess.run(['bash', SCR, mode], input=inp, capture_output=True, text=True, env=env, timeout=300)
        c = run('check')
        ok('③ check — 버킷 · 공개 차단 · CORS · 쓰기 · 디스크 파일 모두 통과 · 시험 파일 지움', c.returncode == 0 and '실패' not in c.stdout.replace('실패 0', '')
           and not any(os.scandir(os.path.join(s3, 'sgb-s3-check'))) if os.path.isdir(os.path.join(s3, 'sgb-s3-check')) else c.returncode == 0, c.stdout[-300:])
        v0 = run('verify')
        ok('③ copy 전 verify — 쓰는 파일 2개가 S3 에 없음 → 실패', v0.returncode != 0 and 'S3 에 없거나 다른 것 2' in v0.stdout, v0.stdout[-200:])
        cp = run('copy')
        ok('③ copy — 디스크 → S3 · 같은 키', cp.returncode == 0 and sum(len(f) for _, _, f in os.walk(s3)) >= 2, cp.stdout[-160:])
        v1 = run('verify')
        ok('③ verify — 쓰는 파일 모두 같음 · 올리다 만 것 1은 없음으로 셈', v1.returncode == 0 and '같음 2' in v1.stdout and 'S3 에 없음 1' in v1.stdout, v1.stdout[-200:])
        a0 = run('apply', 'no\n')
        ok('③ apply → no — 아무것도 안 바꿈', a0.returncode != 0 and psql(f"SELECT count(*) FROM files WHERE id IN ({','.join(repr(x) for x in ids)}) AND storage_provider = 'S3'") == '0', '')
        a1 = run('apply', 'yes\n')
        moved = psql(f"SELECT string_agg(status || ':' || storage_provider, ' ' ORDER BY status) FROM files WHERE id IN ({','.join(repr(x) for x in ids)})")
        ok('③ apply → yes — 같은 것(2)만 S3 · 올리다 만 것은 LOCAL · 디스크 파일 그대로', a1.returncode == 0 and moved == 'READY:S3 READY:S3 UPLOADING:LOCAL'
           and sum(len(f) for _, _, f in os.walk(up)) == 2, moved)
        blocked = subprocess.run(['psql', DB, '-X', '-q', '-At', '-c', f"UPDATE files SET storage_provider = 'LOCAL' WHERE id = '{ids[0]}'"], capture_output=True, text=True)
        ok('③ 표시(sgb.files_move) 없이 저장 위치를 바꾸면 여전히 막힘', blocked.returncode != 0 and '바꿀 수 없습니다' in blocked.stderr, blocked.stderr.strip()[:100])
        st2 = call('GET', '/admin/storage-status', t=T_)
        ok('③ 화면 API — S3 기록 수에 반영', st2.get('s3Files', 0) >= 2, json.dumps(st2)[:120])
    finally:
        # 파일 기록은 지울 수 없음(DB 규칙) → DELETED 로
        psql("UPDATE files SET status = 'DELETED', deleted_at = now() WHERE original_name LIKE 'v1149_%' AND status <> 'DELETED'")
        shutil.rmtree(tmp, ignore_errors=True)
    ok('③ 되돌림 — 시험 파일 행 DELETED', psql("SELECT count(*) FROM files WHERE original_name LIKE 'v1149_%' AND status <> 'DELETED'") == '0', '')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
