"""v10.32 실제 차이 2건 시험 — 공개 문의 단독 화면(SB-HOM-MCH-020) · 분쟁 접수 증빙 · 처리 현황(SB-HOM-ETC-010)"""
import sys, json, hashlib, urllib.request, urllib.error
sys.path.insert(0, '/home/claude/qa')
from flow_lib import call, login, rows
SITE = 'http://localhost:5174'
def _lit(v): return str(int(v)) if isinstance(v, int) else "'" + str(v).replace("'", "''") + "'"
def q(sql, *a):
    r = rows(sql % tuple(_lit(x) for x in a))
    return [tuple(int(c) if c.lstrip('-').isdigit() else c for c in x) for x in r]
R = []
def ok(name, cond, info=''):
    R.append((name, bool(cond))); print(('PASS' if cond else 'FAIL'), name, info)

# ① 공개 문의 — 문의가 있는 노출 매물
row = q("""SELECT l.id, l.gwan_code, l.view_count, (SELECT count(*) FROM public_questions q WHERE q.listing_id=l.id AND NOT q.is_hidden)
             FROM listings l WHERE l.status='PUBLISHED' AND l.gwan_code IN ('MNY','MAL','BIZ')
            ORDER BY 4 DESC LIMIT 1""")[0]
lid, g, vc0, nq = row
path = {'MNY': 'money', 'MAL': 'mal', 'BIZ': 'biz'}[g]
st, d = call('GET', f'/listings/{lid}?view=0')
vc1 = q('SELECT view_count FROM listings WHERE id=%s', lid)[0][0]
ok('상세 view=0 은 조회 수를 올리지 않음', st == 200 and vc1 == vc0, f'{vc0}->{vc1}')
html = urllib.request.urlopen(f'{SITE}/{path}/{lid}/qna').read().decode()
ok('공개 문의 화면 200 · 화면 번호', 'SB-HOM-MCH-020' in html)
ok('제목 「공개 문의 N건」', f'공개 문의 {nq}건' in html, f'n={nq}')
ok('단추 3 (질문 남기기 · 1:1 문의 · 매물 상세로)', all(k in html for k in ['질문 남기기', '1:1 문의', '매물 상세로']))
ok('INV-2 안내', 'INV-2' in html)
ok('질문 줄 수 = 서버', html.count('data-qna-row=') == nq, html.count('data-qna-row='))
vc2 = q('SELECT view_count FROM listings WHERE id=%s', lid)[0][0]
ok('공개 문의 화면은 조회 수 그대로', vc2 == vc1, f'{vc1}->{vc2}')
det = urllib.request.urlopen(f'{SITE}/{path}/{lid}').read().decode()
ok('상세 「문의 내용」에 「전체 보기」 링크', f'/{path}/{lid}/qna' in det and 'data-qna-all' in det)
try:
    urllib.request.urlopen(f'{SITE}/proto/{lid}/qna'); ok('없는 관은 404', False)
except urllib.error.HTTPError as e: ok('없는 관은 404', e.code == 404, e.code)

# ② 분쟁 — 사업자 회원(intro@x.com)이 당사자인 거래 · 진행 중 분쟁 없음
tok = login('intro@x.com')
aid = q("SELECT id FROM accounts WHERE email=%s", 'intro@x.com')[0][0]
deal = q("""SELECT d.id FROM deals d WHERE %s IN (d.buyer_account_id, d.seller_account_id, d.introducer_account_id)
             AND NOT EXISTS (SELECT 1 FROM disputes x WHERE x.deal_id=d.id AND x.status IN ('OPEN','IN_REVIEW')) LIMIT 1""", aid)
if not deal: ok('분쟁 시험 거래 있음', False)
else:
    deal = deal[0][0]
    pdf = b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'
    st, f = call('POST', '/files', tok, {'purpose': 'INQUIRY_ATTACHMENT', 'name': 'evidence.pdf', 'contentType': 'application/pdf', 'size': len(pdf), 'sha256': hashlib.sha256(pdf).hexdigest()})
    ok('증빙 올릴 자리', st in (200, 201) and f.get('fileId'), st)
    req = urllib.request.Request(f['uploadUrl'] if f['uploadUrl'].startswith('http') else 'http://localhost:3000' + f['uploadUrl'], data=pdf, method=f.get('method', 'PUT'), headers=f.get('headers') or {})
    urllib.request.urlopen(req)
    st, c = call('POST', f"/files/{f['fileId']}/complete", tok, {})
    ok('증빙 올리기 확인 READY', st == 200 and c.get('status') == 'READY', st)
    # 남의 파일 id 는 막힘
    other = q("SELECT id FROM files WHERE owner_account_id <> %s AND status='READY' LIMIT 1", aid)
    if other:
        st, e = call('POST', '/disputes', tok, {'dealId': deal, 'reasonCode': 'OTHER', 'description': '남의 파일 시험입니다', 'evidenceKeys': [str(other[0][0])]})
        ok('남의 파일은 증빙으로 못 붙임(422)', st == 422, (st, e.get('code') if isinstance(e, dict) else e))
        ok('막힌 접수는 분쟁을 남기지 않음', not q("SELECT 1 FROM disputes WHERE deal_id=%s AND status='OPEN'", deal))
    st, dsp = call('POST', '/disputes', tok, {'dealId': deal, 'reasonCode': 'CONTRACT_ISSUE', 'description': 'v10.32 증빙 시험 — 계약 조건이 달랐습니다', 'evidenceKeys': [f['fileId']]})
    ok('분쟁 접수 + 증빙 1', st in (200, 201) and dsp.get('evidenceCount') == 1, (st, dsp))
    did = dsp.get('id')
    ok('DB dispute_messages 에 증빙', q('SELECT count(*) FROM dispute_messages WHERE dispute_id=%s AND attachment_key=%s', did, f['fileId'])[0][0] == 1)
    st, mine = call('GET', '/me/disputes', tok)
    m = [x for x in mine if x['id'] == did]
    ok('GET /me/disputes 처리 현황 · 증빙 수', m and m[0]['evidenceCount'] == 1 and m[0]['reasonLabel'])
    adm = login('admin@x.com')
    st, al = call('GET', '/admin/disputes', adm)
    a = [x for x in al if x['id'] == did]
    ok('운영 분쟁 목록에 증빙 이름', a and a[0]['evidence'] and a[0]['evidence'][0]['fileId'] == f['fileId'], a and a[0].get('evidence'))
    st, fo = call('GET', f"/files/{f['fileId']}", adm)
    ok('운영이 증빙 열기(GET /files/id)', st == 200 and fo.get('url'), st)
    held = q("SELECT count(*) FROM settlements WHERE held_by_dispute_id=%s", did)[0][0]
    # 정리 — 운영 처리(종결)로 보류 해제(실제 절차)
    st, _ = call('PATCH', f'/admin/disputes/{did}', adm, {'status': 'REJECTED', 'resolution': 'v10.32 시험 — 시험 자료 정리'})
    ok('시험 분쟁 종결(보류 해제)', st == 200 and q('SELECT count(*) FROM settlements WHERE held_by_dispute_id=%s AND status=%s', did, 'HELD')[0][0] == 0 if held else st == 200, st)
    # 시험 자료 지우기(사용자 화면의 처리 현황에 남지 않게)
    from flow_lib import sql
    sql(f"UPDATE settlements SET held_by_dispute_id=NULL WHERE held_by_dispute_id='{did}'; DELETE FROM dispute_messages WHERE dispute_id='{did}'; DELETE FROM disputes WHERE id='{did}'")
# ③ 운영 — 분쟁 숫자 4칸 · 의료 심의 반려(12시 추가 반영) — 실제 소재는 누르지 않음(없는 코드로 거절만 봄)
adm = login('admin@x.com'); mem = login('intro@x.com')
st, sm = call('GET', '/admin/disputes/summary', adm)
ok('분쟁 요약 4칸(처리 중 · 종결 · 이번 달 · 72시간)', st == 200 and all(k in sm for k in ('open', 'closed', 'openedThisMonth', 'over72h')), sm)
ok('분쟁 요약 — 회원은 403', call('GET', '/admin/disputes/summary', mem)[0] == 403)
ok('분쟁 목록 state=all · days', call('GET', '/admin/disputes?state=all&days=30', adm)[0] == 200)
ok('의료 심의 반려 — 사유 없으면 400', call('POST', '/admin/ad-creatives/NOPE-1/review-reject', adm, {})[0] == 400)
ok('의료 심의 반려 — 대기 아닌 소재 409 NOT_PENDING', (call('POST', '/admin/ad-creatives/NOPE-1/review-reject', adm, {'reason': '시험 사유 — 없는 소재'})[1] or {}).get('code') == 'NOT_PENDING')
ok('의료 심의 반려 — 회원은 403', call('POST', '/admin/ad-creatives/NOPE-1/review-reject', mem, {'reason': '시험 사유 — 없는 소재'})[0] == 403)
# ④ v10.33 (10/11 대표 「분쟁 접수는 모두 가능」) — 개인 회원(MEMBER 만)도 자기 거래면 접수 · 남의 거래는 409 NOT_A_PARTY(전: 403)
from flow_lib import sql as _sql
btok = login('buyer@x.com'); bid = q("SELECT id FROM accounts WHERE email=%s", 'buyer@x.com')[0][0]
ok('buyer@x.com 은 개인 회원(MEMBER 만)', not q("SELECT 1 FROM account_roles WHERE account_id=%s AND role<>'MEMBER'", bid))
bd = q("""SELECT d.id FROM deals d WHERE %s IN (d.buyer_account_id, d.seller_account_id, d.introducer_account_id)
             AND NOT EXISTS (SELECT 1 FROM disputes x WHERE x.deal_id=d.id AND x.status IN ('OPEN','IN_REVIEW')) LIMIT 1""", bid)
if bd:
    st, bj = call('POST', '/disputes', btok, {'dealId': bd[0][0], 'reasonCode': 'OTHER', 'description': 'v10.33 개인 회원 분쟁 접수 시험입니다'})
    ok('개인 회원이 자기 거래 분쟁 접수 → 201', st in (200, 201) and (bj or {}).get('id'), (st, bj))
    if (bj or {}).get('id'):
        _d = bj['id']; _sql(f"UPDATE settlements SET held_by_dispute_id=NULL WHERE held_by_dispute_id='{_d}'; DELETE FROM dispute_messages WHERE dispute_id='{_d}'; DELETE FROM disputes WHERE id='{_d}'")
else:
    ok('개인 회원 시험 거래 있음', False)
st, nj = call('POST', '/disputes', login('member@t.local'), {'dealId': bd[0][0] if bd else '00000000-0000-0000-0000-000000000000', 'reasonCode': 'OTHER', 'description': '남의 거래 분쟁 접수 시험입니다'})
ok('개인 회원 · 남의 거래 → 409 NOT_A_PARTY(권한 403 아님)', st == 409 and (nj or {}).get('code') == 'NOT_A_PARTY', (st, nj))
print(json.dumps({'pass': sum(1 for _, x in R if x), 'fail': sum(1 for _, x in R if not x)}))
