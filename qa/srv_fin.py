"""v10.24 안심소개 「생활 · 금융 상담」 — 서버(API · DB) 점검. 결과: srv_fin.json

  10/7 지시 — 「안심소개 → 생활금융 부분(리스트 및 상세 보기 · 상담하기) 등을 작동 가능하게 · 디자인 모두 적용 · 시안 및 개발 적용」
  답 — ① 상세 보기 = 업종 상세  ② 디자인 = 지금 안심소개 모양으로 다듬기  ③ 준비 중 15업종 = 규칙 그대로 + 시험용 업체 넣기

  A. 업종 상세(GET /consult/categories/:code)  목록과 같은 값 · 받는 지역(시 · 도별 업체 수) · 진행 규칙(설정값 그대로)
  B. 22업종 모두                               리드형 20 · 월 정액 노출형 2
  C. 없는 것 · 이상한 입력                      404(500 아님) · 보관 업종 · 다른 축
  D. 내보내는 것                               업체 이름 · 연락처 · 번호가 실리지 않음
  E. 등록부 · 고정 SQL                         화면 등록부 연결(G-151) · 조립식 SQL 0(G-153)
  F. 시험용 업체(개발 · 시연용 시드)            리드형 20업종 모두 1곳 이상 · 두 번 돌려도 같음 · 규칙은 그대로(받는 지역이 아니면 전달하지 않음) · 법률 · 세무 시험용 사무소
  G. 상담하기                                  전에 「준비 중」이던 업종으로 신청 → 휴대폰 확인 → 업체 1곳 전달

사용:  python3 srv_fin.py        API=http://localhost:3000 · DB=postgresql://…/sgb · KIT=킷의 sgb 폴더
       SEED=1 이면 F 에서 시드를 직접 돌려 봅니다(개발 · 시연용 DB 에서만).
"""
import json, os, re, subprocess, sys, random
from urllib.parse import quote
from detail_fixture import call, q, DB, login

OUT = os.path.dirname(os.path.abspath(__file__))
KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:240], file=sys.stderr)

def rows(sql):
    p = subprocess.run(['psql', DB, '-tA', '-F', '\t', '-c', sql], capture_output=True, text=True)
    assert p.returncode == 0, p.stderr[:300]
    return [l.split('\t') for l in p.stdout.strip().split('\n') if l]

def detail(code, raw=False):
    return call('GET', '/consult/categories/' + quote(code, safe=''), raw=raw)

KEYS = {'id', 'code', 'name', 'status', 'publishMode', 'consultMode', 'partnerCount', 'regions', 'rules'}
RULE_KEYS = {'deliverTo', 'otpMinutes', 'otpMaxTries', 'dailyLimit', 'viewTtlHours'}


def main():
    st, cats = call('GET', '/consult/categories'); assert st == 200 and cats, (st, cats)
    by = {c['code']: c for c in cats}
    lead = [c for c in cats if c['status'] == 'APPROVED' and c['consultMode'] == 'LEAD']
    dirs = [c for c in cats if c['status'] == 'APPROVED' and c['consultMode'] == 'LISTING_FEE']

    # ── A ── 업종 상세 한 건
    one = by['CSL_CLEANING']
    st, d = detail('CSL_CLEANING'); d = d if isinstance(d, dict) else {}
    rec('A-1 GET /consult/categories/CSL_CLEANING → 200 · 정해 둔 칸만(id · code · name · status · publishMode · consultMode · partnerCount · regions · rules)', st == 200 and set(d) == KEYS, (st, sorted(d)))
    rec('A-2 목록(GET /consult/categories)의 그 줄과 값이 같음', st == 200 and all(d.get(k) == one[k] for k in ('id', 'code', 'name', 'status', 'publishMode', 'consultMode', 'partnerCount')), {k: (d.get(k), one[k]) for k in ('name', 'partnerCount', 'publishMode')})
    truth = {r[0]: int(r[1]) for r in rows(f"select e.sido, count(distinct e.partner_id) from v_consult_eligible_partner e where e.category_id = '{one['id']}' group by 1")}
    got = {r['sido']: r['partnerCount'] for r in d.get('regions', [])} if st == 200 else None
    rec('A-3 받는 지역 = DB 의 「받을 수 있는 업체」를 시 · 도로 묶은 것(업체 수 많은 순 · 같으면 이름순)', got == truth and [r['sido'] for r in d.get('regions', [])] == [k for k, _ in sorted(truth.items(), key=lambda x: (-x[1], x[0]))], (got, truth))
    rec('A-4 지역마다 업체 수는 1 이상 · 전체 업체 수를 넘지 않음', st == 200 and all(1 <= r['partnerCount'] <= d['partnerCount'] for r in d.get('regions', [])) and (d['partnerCount'] == 0) == (len(d['regions']) == 0), d.get('regions'))
    sv = lambda k, dflt: int(q(f"select coalesce((select value from site_settings where key='{k}' and value ~ '^[0-9]+$'), '{dflt}')"))
    ru = d.get('rules') or {}
    rec('A-5 진행 규칙 — 전달 업체 수 · 하루 신청 한도 · 업체가 열어 볼 기한은 설정값 그대로 · 인증번호 5분 · 5회',
        set(ru) == RULE_KEYS and ru.get('deliverTo') == sv('lead.assign.target', 1) and ru.get('dailyLimit') == sv('lead.intake.daily_limit', 5) and ru.get('viewTtlHours') == sv('lead.assign.view_ttl_hours', 24) and ru.get('otpMinutes') == 5 and ru.get('otpMaxTries') == 5, ru)

    # ── B ── 22업종 모두
    bad = []
    for c in cats:
        s, x = detail(c['code'])
        if s != 200 or not isinstance(x, dict) or any(x.get(k) != c[k] for k in ('id', 'name', 'status', 'publishMode', 'consultMode', 'partnerCount')): bad.append((c['code'], s))
    rec(f'B-1 업종 {len(cats)}종 모두 200 · 목록과 같은 값', len(cats) >= 22 and not bad, bad[:5])
    okd = True; det = []
    for c in dirs:
        s, x = detail(c['code']); t = {r[0]: int(r[1]) for r in rows(f"select d.sido, count(*) from v_consult_directory_public d where d.category_id = '{c['id']}' group by 1")}
        g = {r['sido']: r['partnerCount'] for r in (x or {}).get('regions', [])}
        if s != 200 or x.get('rules') is not None or g != t: okd = False; det.append((c['code'], s, x.get('rules') if isinstance(x, dict) else x, g, t))
    rec('B-2 월 정액 노출형(법률 · 세무) — 진행 규칙 없음(null · 상담 신청을 받지 않음) · 지역은 게재 중인 사무소 기준', len(dirs) == 2 and okd, det)
    rs = [(detail(c['code'])[1] or {}).get('rules') for c in lead]
    rec('B-3 리드형 20업종 — 진행 규칙이 있고 모두 같음', len(lead) == 20 and all(rs) and len({json.dumps(x, sort_keys=True) for x in rs}) == 1, (len(lead), rs[:1]))

    # ── C ── 없는 것 · 이상한 입력
    codes = [('없는 코드', 'CSL_NOPE'), ('보관한 업종(카드)', 'CSL_CARD'), ('소문자', 'csl_cleaning'), ('작은따옴표', "CSL_'X"), ('긴 값', 'C' * 300), ('한글', '청소'), ('빈칸', 'CSL CLEANING'), ('%00', 'CSL%00')]
    other = q("select code from categories where gwan_code = 'MAL' and axis is distinct from 'CONSULT' and status = 'APPROVED' limit 1")
    if other: codes.append(('매물 축의 분류', other))
    mny = q("select code from categories where gwan_code = 'MNY' and status = 'APPROVED' limit 1")
    if mny: codes.append(('다른 관의 분류', mny))
    res = [(n, detail(c)[0]) for n, c in codes]
    rec(f'C-1 없는 것 · 이상한 입력 {len(codes)}가지 → 모두 404(500 아님)', all(s == 404 for _, s in res), res)
    s, body = detail('CSL_NOPE', raw=True)
    rec('C-2 404 응답에 DB 오류 글 · 조회문이 실리지 않음', s == 404 and not re.search(r'select |syntax|relation|column', body, re.I), body[:160])

    # ── D ── 내보내는 것
    s, raw = detail('CSL_CLEANING', raw=True)
    names = [r[0] for r in rows(f"select b.company_name from v_consult_eligible_partner e join businesses b on b.id = e.business_id where e.category_id = '{one['id']}' limit 5")]
    pids = [r[0] for r in rows(f"select e.partner_id from v_consult_eligible_partner e where e.category_id = '{one['id']}' limit 5")]
    rec('D-1 응답에 업체 이름 · 업체 번호 · 전화번호 모양이 없음', s == 200 and not any(n and n in raw for n in names) and not any(p in raw for p in pids) and not re.search(r'01[016789][-. ]?\d{3,4}[-. ]?\d{4}', raw), [n for n in names if n in raw][:2])
    rec('D-2 로그인하지 않고 볼 수 있음(공개 길) · 저장하지 않음(GET)', s == 200 and call('POST', '/consult/categories/CSL_CLEANING', body={})[0] in (404, 405), s)

    # ── E ── 등록부 · 고정 SQL
    try:
        sj = open(KIT + '/spec/screens.json', encoding='utf-8').read()
        rec('E-1 화면 등록부(spec/screens.json)에 새 길이 연결돼 있음 — 빠지면 통합 검정이 실패함(G-151)', '"GET /consult/categories/{code}"' in sj, 'spec/screens.json 에 없음')
        src = open(KIT + '/src/modules/partner/consult.service.ts', encoding='utf-8').read()
        lits = [m.group(1) for m in re.finditer(r'`([^`]*)`', src) if re.match(r'\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b', m.group(1), re.I)]
        rec('E-2 상담 서비스의 SQL 이 모두 고정 글 — 통합 검정의 「SQL 대조」가 건너뛰는 것 0(G-153)', lits and not [x for x in lits if '${' in x], [x.strip()[:50] for x in lits if '${' in x])
        ctl = open(KIT + '/src/modules/partner/consult.controller.ts', encoding='utf-8').read()
        rec('E-3 새 길에 응답 모양이 적혀 있음(@ApiOkResponse) — 없으면 문서 정합성이 실패함(G-151)', re.search(r"@Get\('categories/:code'\)[\s\S]{0,600}@ApiOkResponse", ctl) is not None, '없음')
    except FileNotFoundError as ex:
        rec('E-1 킷 파일을 읽지 못함', False, ex)

    # ── F ── 시험용 업체(개발 · 시연용 시드)
    seed = KIT + '/scripts/seed-consult-demo.sql'
    rec('F-1 시드 파일이 있음(scripts/seed-consult-demo.sql) · 처음 준비(local-setup.sh)와 다시 올릴 때(docker/bootstrap.sh) 모두 돌림',
        os.path.exists(seed) and 'seed-consult-demo.sql' in open(KIT + '/scripts/local-setup.sh', encoding='utf-8').read() and 'seed-consult-demo.sql' in open(KIT + '/../docker/bootstrap.sh', encoding='utf-8').read() if os.path.exists(KIT + '/../docker/bootstrap.sh') else os.path.exists(seed), seed)
    if os.environ.get('SEED') == '1' and os.path.exists(seed):
        snap = lambda: (q("select count(*) from partners"), q("select count(*) from partner_services"), q("select count(*) from partner_regions"), q("select count(*) from qualification_reviews"), q("select count(*) from businesses"), q("select count(*) from accounts"))
        run = lambda: subprocess.run(['psql', DB, '-q', '-v', 'ON_ERROR_STOP=1', '-f', seed], capture_output=True, text=True)
        p1 = run(); s1 = snap(); p2 = run(); s2 = snap()
        rec('F-2 시드를 두 번 돌려도 오류 없이 같은 결과(두 번째는 더하는 것 0)', p1.returncode == 0 and p2.returncode == 0 and s1 == s2, (p1.stderr[:150], p2.stderr[:150], s1, s2))
        rec('F-3 시드는 계정 · 사업자를 새로 만들지 않음(두 번 돌려도 계정 · 사업자 · 업체 수가 같음) · 시드가 손대는 업체는 처음 준비 때 있던 사업자 2곳(소개사 · 시험판매사)뿐',
            s1[0] == s2[0] and s1[4] == s2[4] and s1[5] == s2[5]
            and q("select count(distinct p.id) from consult_directory_entries d join partners p on p.id = d.partner_id join businesses b on b.id = p.business_id join accounts a on a.id = b.account_id where d.payment_ref like '개발 시드%' and a.email not in ('intro@x.com', 'seller@x.com')") == '0', s1)
    st, cats2 = call('GET', '/consult/categories')
    zero = [c['code'] for c in cats2 if c['status'] == 'APPROVED' and c['consultMode'] == 'LEAD' and c['partnerCount'] == 0]
    rec('F-4 리드형 20업종 모두 받을 수 있는 인증업체가 1곳 이상(「준비 중」 0)', st == 200 and not zero, zero)
    gated = [c for c in cats2 if c['status'] == 'APPROVED' and c['consultMode'] == 'LEAD' and c['publishMode'] == 'GATED']
    noq = rows("""select c.code from categories c join restricted_industries ri on ri.code = c.restricted_code and ri.gwan_code = c.gwan_code and ri.is_active and ri.mode = 'GATED'
                   where c.gwan_code = 'MAL' and c.axis = 'CONSULT' and c.status = 'APPROVED' and c.consult_mode = 'LEAD'
                     and not exists (select 1 from v_consult_eligible_partner e join qualification_reviews qr on qr.business_id = e.business_id and qr.state = 'APPROVED' and qr.category_code = coalesce(ri.qual_code, ri.code) where e.category_id = c.id)""")
    rec(f'F-5 자격 확인 업종 {len(gated)}종 — 받는 업체는 모두 자격 심사 승인 기록이 있음(규칙을 건너뛰지 않음)', len(gated) == 10 and not noq, noq)

    # F-6 · F-7 — 법률 · 세무(월 정액 노출형)의 시험용 사무소 (10/7 답 「시험용 사무소를 넣음」)
    okd = True; det = []
    for c in [x for x in cats2 if x['status'] == 'APPROVED' and x['consultMode'] == 'LISTING_FEE']:
        s, dj = call('GET', '/consult/directory/' + c['code']); ent = (dj or {}).get('entries', []) if isinstance(dj, dict) else []
        demo = [x for x in ent if x['displayName'].startswith('(시험)')]
        if s != 200 or len(demo) != 2 or len({x['displayName'] for x in demo}) != 2 or len({x['contactPhone'] for x in demo}) != 2 or c['partnerCount'] != len(ent) or not all(re.fullmatch(r'02-0000-\d{4}', x['contactPhone']) for x in demo) or (dj or {}).get('adLabel') != '광고':
            okd = False; det.append((c['code'], s, [(x['displayName'], x['contactPhone']) for x in ent], c['partnerCount']))
    rec('F-6 법률 · 세무 — 「(시험)」으로 시작하는 시험용 사무소가 업종마다 2곳(10/7 답 「2곳」 · 이름 · 전화가 서로 다름) 게재 중 · 전화는 쓰이지 않는 번호(02-0000-…) · 「광고」 표시 · 목록의 게재 수와 같음', okd, det)
    rows_d = rows("select d.display_name, d.state, d.payment_ref, (d.paid_to >= (now() at time zone 'Asia/Seoul')::date + 30) from consult_directory_entries d where d.display_name like '(시험)%'")
    rec('F-7 시험용 사무소 — 입금 기록에 「개발 시드」라고 적혀 있고(실제 입금이 아님) 게재 기간이 30일 넘게 남아 있음', len(rows_d) == 4 and all(r[1] == 'ACTIVE' and '개발 시드' in r[2] and r[3] == 't' for r in rows_d), rows_d)
    # F-7b — 둘째 사무소를 실은 업체(시험판매사)는 게재만 합니다: 상담 신청(리드)을 받는 업체가 되지 않아, 리드형 업종의 인증업체 수 · 전달 대상이 그대로입니다
    n2 = q("select count(*) from v_consult_eligible_partner e join partners p on p.id = e.partner_id join businesses b on b.id = p.business_id join accounts a on a.id = b.account_id where a.email = 'seller@x.com'")
    rec('F-7b 둘째 사무소의 업체(시험판매사)는 게재만 함 — 상담 신청을 받는 업체 목록에 없음(리드형 업종의 인증업체 수가 늘지 않음)', n2 == '0', n2)

    # F-8 — 시험용 시드는 개발 · 시연용입니다. 운영 적용 길(deploy/aws 의 스크립트 · 마이그레이션 · package.json 의 명령)이 이 파일을 부르면 안 됩니다
    hit = []
    for root in (KIT + '/deploy', KIT + '/migrations'):
        for dp, dn, fn in os.walk(root):
            for f in fn:
                try:
                    if 'seed-consult-demo' in open(os.path.join(dp, f), encoding='utf-8', errors='ignore').read(): hit.append(os.path.relpath(os.path.join(dp, f), KIT))
                except OSError: pass
    if os.path.exists(KIT + '/package.json') and 'seed-consult-demo' in open(KIT + '/package.json', encoding='utf-8').read(): hit.append('package.json')
    rec('F-8 운영 적용 길(deploy/aws · migrations · package.json)은 시험용 시드를 부르지 않음 — 운영 서버에는 시험용 업체가 들어가지 않음', os.path.isdir(KIT + '/deploy/aws') and not hit, hit)

    # ── G ── 상담하기 — 전에 「준비 중」이던 업종(이사짐 · 자격 확인)으로
    mv = next((c for c in cats2 if c['code'] == 'CSL_MOVING'), None)
    dm = detail('CSL_MOVING')[1] if mv else {}
    sidos = [r['sido'] for r in (dm or {}).get('regions', [])] if isinstance(dm, dict) else []
    if mv and mv['partnerCount'] > 0 and sidos:
        ph = lambda: '010' + ''.join(random.choice('0123456789') for _ in range(8))
        s1, cr = call('POST', '/consult/requests', body={'categoryCode': 'CSL_MOVING', 'name': '시험 신청', 'phone': ph(), 'email': 'consult.test@example.com', 'sido': sidos[0], 'memo': '생활금융 점검(v10.24) — 이사 견적', 'agree': True})
        s2, dv = call('POST', f"/consult/requests/{(cr or {}).get('id')}/verify", body={'code': (cr or {}).get('devCode', '')}) if s1 < 300 else (0, None)
        rec(f'G-1 이사짐 · {sidos[0]} — 신청 → 휴대폰 확인 → 업체 1곳 전달(DELIVERED)', s1 < 300 and s2 < 300 and (dv or {}).get('state') == 'DELIVERED', (s1, cr, s2, dv))
        n = q(f"select count(*) from lead_deliveries d join consult_requests c on c.lead_id = d.lead_id where c.id = '{(cr or {}).get('id')}' and d.state = 'DELIVERED'") if s1 < 300 else '?'
        rec('G-2 전달된 곳은 정확히 1곳', n == '1', n)
        far = next((x for x in ('제주', '강원', '울산', '세종') if x not in sidos), None)
        s3, cr2 = call('POST', '/consult/requests', body={'categoryCode': 'CSL_MOVING', 'name': '시험 신청', 'phone': ph(), 'email': 'consult.test@example.com', 'sido': far, 'agree': True})
        s4, dv2 = call('POST', f"/consult/requests/{(cr2 or {}).get('id')}/verify", body={'code': (cr2 or {}).get('devCode', '')}) if s3 < 300 else (0, None)
        rec(f'G-3 규칙은 그대로 — 받는 지역이 아닌 곳({far})은 전달하지 않음(NO_PARTNER)', s3 < 300 and (dv2 or {}).get('state') == 'NO_PARTNER', (s3, s4, dv2))
        # (정리) 시험 신청 2건을 운영 API 로 종료 — 시연용 업체에 미열람 배정이 쌓이면 다음 시험(파트너 리드 목록 · 열람)이 이 신청을 집습니다(G-155)
        ops = login('admin@x.com'); left = []
        for rid in ((cr or {}).get('id'), (cr2 or {}).get('id')):
            lid = q(f"select lead_id from consult_requests where id = '{rid}'") if rid else ''
            if lid:
                stc, _ = call('POST', f'/admin/leads/{lid}/close', ops, {'reason': 'srv_fin 점검 신청 — 시험 뒤 정리'})
                if stc >= 300 or q(f"select count(*) from lead_deliveries where lead_id = '{lid}' and ended_at is null") != '0' or q(f"select (closed_at is not null)::text from leads where id = '{lid}'") != 'true': left.append((lid, stc))
        rec('G-4 (정리) 시험 신청을 운영 API 로 종료 — 열려 있는 배정이 남지 않음', not left, left)
    else:
        rec('G-1 이사짐 상담 신청 → 전달', False, ('받을 업체가 없음', mv and mv['partnerCount'], sidos))


if __name__ == '__main__':
    try: main()
    except Exception as ex:
        import traceback; traceback.print_exc(); rec('실행 중 오류', False, repr(ex)[:300])
    ok = sum(1 for r in R if r['ok'])
    json.dump({'items': R, 'pass': ok, 'total': len(R)}, open(os.path.join(OUT, 'srv_fin.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'통과 {ok} / {len(R)}')
