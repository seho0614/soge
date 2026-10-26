"""v10.117 시험 — 성향 학습 「되돌리기」(docs/181 · 마이그레이션 없음)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1117.py

  ① 마이그레이션 없음(161 · 마지막 D123) · 학습은 막지 않음(대표 「막지 않음」) — 안내 문구가 그렇게 말함
  ② 코드 — 되돌리기 API(운영 · 최고 관리자 · 감사) · 가장 최근 이동만 · 성향이 그대로이고 동의가 있을 때만 돌림 · 화면 단추
  ③ (API · DB) 권한 · 되돌림(성향 · 출처 · 기록) · 두 번 → 409 · 뒤에 또 옮겨진 회원의 앞 기록 → 409 · 성향이 바뀐 뒤면 기록만
"""
import json, os, re, subprocess, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d)))
ok('① 마이그레이션 없음 — 161 · 마지막 D123(v10.118 부터 D124 · 162 — test_v1118)', (len(mig), mig[-1] if mig else '') in ((161, 'D123_profile_consent_single'), (162, 'D124_i18n_profile'), (163, 'D125_i18n_more_targets')), f'{len(mig)} · {mig[-1] if mig else ""}')
S = rd('src/modules/admin/admin-v31.service.ts'); C = rd('src/modules/admin/admin-v31.controller.ts'); W = rd('web/src/app/admin/ailearn/SegmentLearn.tsx')
ok('② API — POST /admin/segments/log/:id/revert · 운영 · 최고 관리자(컨트롤러 기본) · 감사 SEGMENT_REVERT',
   "@Post('segments/log/:id/revert')" in C and "@Audit('SEGMENT_REVERT', 'SEGMENT')" in C and "@Roles('ADMIN', 'SUPER')" in C, '')
ok('② 가장 최근 이동만(NEWER_SHIFT) · 두 번 안 됨(ALREADY_REVERTED) · 성향이 그대로이고 동의가 있을 때만 돌림 · 기록에 되돌린 사람',
   "'NEWER_SHIFT'" in S and "'ALREADY_REVERTED'" in S and 'AND p.segment_code = $3 AND fn_adpersonal_on(p.account_id)' in S and 'reverted_by = $2' in S, '')
ok('① 학습은 막지 않음 — 서버 안내 · 화면 확인 창이 「다시 옮길 수 있습니다」 · 90일 약속 없음',
   S.count('학습을 다시 돌리면 같은 클릭으로 다시 옮길 수 있습니다') >= 2 and '다시 옮길 수 있습니다' in W and '90일' not in S + W + C, '')
ok('② 화면 — 되돌리지 않은 줄에 「되돌리기」 · 확인 창 · 화면 목록 등록', 'data-seg-revert' in W and 'confirm(' in W
   and 'POST /admin/segments/log/{id}/revert' in rd('spec/screens.json'), '')


def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        try: body = json.loads(e.read().decode('utf-8', 'replace'))
        except Exception: body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


if API and DB:
    TA = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    EM = 'seller@x.com'
    TS = call('POST', '/auth/login', {'email': EM, 'password': 'sgb-dev-1234'})['accessToken']
    ME = psql(f"SELECT id FROM accounts WHERE email = '{EM}'")
    A, B, Cc = psql("SELECT string_agg(code, ' ' ORDER BY sort_order) FROM (SELECT code, sort_order FROM ad_segments ORDER BY sort_order LIMIT 3) x").split()
    try:
        call('POST', '/me/profile', {'answers': {'q1': ['re']}, 'consent': True}, TS)   # 약관 동의 + 성향(첫 세그먼트)
        psql(f"DELETE FROM segment_shift_log WHERE account_id = '{ME}';")
        psql(f"UPDATE member_ad_profiles SET segment_code = '{B}', source = 'BEHAVIOR' WHERE account_id = '{ME}';")
        L1 = psql(f"INSERT INTO segment_shift_log(account_id, from_code, to_code, clicks_from, clicks_to) VALUES ('{ME}', '{A}', '{B}', 1, 5) RETURNING id")
        ok('③ 운영 권한 없는 회원 → 403', call('POST', f'/admin/segments/log/{L1}/revert', t=TS).get('_err') == 403, '')
        r1 = call('POST', f'/admin/segments/log/{L1}/revert', t=TA)
        st = psql(f"SELECT segment_code || ' ' || source FROM member_ad_profiles WHERE account_id = '{ME}'")
        lg = psql(f"SELECT (reverted_at IS NOT NULL)::text || ' ' || (reverted_by IS NOT NULL)::text FROM segment_shift_log WHERE id = '{L1}'")
        ok('③ 되돌림 — 옮기기 전 세그먼트 · 출처 MEMBER · 기록에 되돌림 · 되돌린 사람', r1.get('restored') is True and st == f'{A} MEMBER' and lg == 'true true', f'{r1.get("note")} · {st} · {lg}')
        ok('③ 두 번 → 409 ALREADY_REVERTED', call('POST', f'/admin/segments/log/{L1}/revert', t=TA).get('code') == 'ALREADY_REVERTED', '')
        L2 = psql(f"INSERT INTO segment_shift_log(account_id, from_code, to_code, applied_at) VALUES ('{ME}', '{A}', '{B}', now() - interval '2 hours') RETURNING id")
        L3 = psql(f"INSERT INTO segment_shift_log(account_id, from_code, to_code, applied_at) VALUES ('{ME}', '{B}', '{Cc}', now() - interval '1 hour') RETURNING id")
        psql(f"UPDATE member_ad_profiles SET segment_code = '{Cc}', source = 'BEHAVIOR' WHERE account_id = '{ME}';")
        ok('③ 뒤에 또 옮겨진 회원의 앞 기록 → 409 NEWER_SHIFT', call('POST', f'/admin/segments/log/{L2}/revert', t=TA).get('code') == 'NEWER_SHIFT', '')
        r3 = call('POST', f'/admin/segments/log/{L3}/revert', t=TA)
        st3 = psql(f"SELECT segment_code || ' ' || source FROM member_ad_profiles WHERE account_id = '{ME}'")
        ok('③ 최근 기록 되돌림 — 앞 이동이 아직 살아 있으면 출처 BEHAVIOR 유지', r3.get('restored') is True and st3 == f'{B} BEHAVIOR', st3)
        psql(f"UPDATE member_ad_profiles SET segment_code = '{Cc}' WHERE account_id = '{ME}';")
        r2 = call('POST', f'/admin/segments/log/{L2}/revert', t=TA)
        ok('③ 성향이 그 뒤 바뀌었으면 기록에만 되돌림(성향은 그대로)', r2.get('ok') is True and r2.get('restored') is False
           and psql(f"SELECT segment_code FROM member_ad_profiles WHERE account_id = '{ME}'") == Cc, r2.get('note') or '')
        ok('③ 감시 — 동의 없이 바뀐 학습 0', psql('SELECT count(*) FROM v_segment_learn_no_consent') == '0', '')
        aud = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'SEGMENT_REVERT' AND occurred_at > now() - interval '5 minutes'")
        ok('③ 감사 기록 SEGMENT_REVERT', aud not in ('', '0'), aud)
    finally:
        psql(f"DELETE FROM segment_shift_log WHERE account_id = '{ME}';")
        call('DELETE', '/me/profile', t=TS)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
