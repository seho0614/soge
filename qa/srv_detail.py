"""v10.21 매물 상세 — 서버(API · DB) 점검. 실제 PostgreSQL(개발 DB) + 운영 방식 API(3000). 결과: srv_detail.json

  A. 상세 응답      조회 수 · 등록자 가입일 · 소개자 실적(총 소개 · 성사 · 성사율) — 실제 집계 값
  B. 누적수익 공개   기본은 숨김(null) · 본인이 켜면 보임 · 끄면 다시 숨김 · 남의 설정은 못 바꿈 · 목록 카드로 새지 않음
  C. 후기 작성      거래 당사자만 · 성사 확정 뒤에만 · 한 번만 · 대상은 그 거래의 소개자
  D. 후기 공개 조회  작성자 이름 가림 · 연락처 가림 · 계정 정보 없음 · 평점 평균 · 다른 등록자의 후기 안 섞임
  S. 참 · 거짓 입력  글자 "false" 를 참으로 읽지 않음 — 서버의 불리언 입력 전부 (G-134)
  E. 요청 등록 시각  요청 목록 · 상세 응답에 createdAt (목록표 E-06 · G-128)

사용:  python3 srv_detail.py       API=http://localhost:3000 · DB=postgresql://sgb:sgb@localhost:5432/sgb
새 계정만 만들어 씁니다. 거래 3건은 시험 자료로 넣었다가 끝에 지웁니다(detail_fixture.py).
"""
import json, os, re, sys
import detail_fixture as F
from detail_fixture import call, q

OUT = os.path.dirname(os.path.abspath(__file__))
R = []
import re as _re
_src = open('/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/src/modules/public/public.dto.ts', encoding='utf8').read()
REVIEW_TAG = _re.search(r"REVIEW_TAGS\s*=\s*\[\s*'([^']+)'", _src).group(1)   # v10.31 (D047) 후기 칩 — 서버 목록의 첫 값

def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:240], file=sys.stderr)

ISO = re.compile(r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d')


def main(f):
    O, U, X, L = f['owner'], f['buyer'], f['seller'], f['listing']

    # ── A ── 상세 응답
    st, d = call('GET', f'/listings/{L}')
    ow = (d or {}).get('owner') or {}
    rec('A-1 상세 응답 200 · 조회 수(viewCount)가 숫자', st == 200 and isinstance(d.get('viewCount'), int), (st, (d or {}).get('viewCount')))
    st, d2 = call('GET', f'/listings/{L}')
    rec('A-2 다시 열면 조회 수가 1 늘어 있음', st == 200 and isinstance(d.get('viewCount'), int) and d2.get('viewCount') == d.get('viewCount') + 1, (d.get('viewCount'), (d2 or {}).get('viewCount')))
    joined = q(f"select to_char(created_at at time zone 'UTC','YYYY-MM-DD') from accounts where id='{O['id']}'")
    rec('A-3 등록자 가입일(owner.joinedAt) = 계정을 만든 날', bool(ISO.match(str(ow.get('joinedAt') or ''))) and str(ow.get('joinedAt'))[:10] == joined, (ow.get('joinedAt'), joined))
    rec('A-4 소개자 실적 — 총 소개 3 · 성사 2(성사 확정 1 + 정산 완료 1) · 성사율 66.7', ow.get('totalDeals') == 3 and ow.get('confirmedDeals') == 2 and ow.get('successRate') == 66.7, {k: ow.get(k) for k in ('totalDeals', 'confirmedDeals', 'successRate')})
    rec('A-5 등록자 이름 · 사업자 인증 표시는 그대로', ow.get('companyName') == O['company'] and ow.get('verified') is True, (ow.get('companyName'), ow.get('verified')))
    other = q(f"select l.id from listings l where l.status='PUBLISHED' and l.owner_account_id <> '{O['id']}' and not exists (select 1 from deals d where d.introducer_account_id = l.owner_account_id) limit 1")
    st, d3 = call('GET', f'/listings/{other}'); o3 = (d3 or {}).get('owner') or {}
    rec('A-6 소개 실적이 없는 등록자 — 총 소개 0 · 성사 0 · 성사율 null(0으로 나누지 않음)', st == 200 and o3.get('totalDeals') == 0 and o3.get('confirmedDeals') == 0 and o3.get('successRate') is None and 'successRate' in o3, {k: o3.get(k, '(없음)') for k in ('totalDeals', 'confirmedDeals', 'successRate')})

    # ── B ── 누적수익 공개
    col = q("select is_nullable||'|'||column_default||'|'||data_type from information_schema.columns where table_name='accounts' and column_name='earnings_public'")
    rec('B-1 DB — accounts.earnings_public 불리언 · NOT NULL · 기본 false', col == 'NO|false|boolean', col)
    rec('B-2 기본은 숨김 — 상세 응답의 누적수익(settledAmount)이 null · earningsPublic false', 'settledAmount' in ow and ow.get('settledAmount') is None and ow.get('earningsPublic') is False, (ow.get('settledAmount', '(없음)'), ow.get('earningsPublic')))
    st, a = call('GET', '/me/account', O['tok'])
    rec('B-3 내 프로필(GET /me/account)에 공개 여부가 나옴 — 기본 false', st == 200 and (a or {}).get('account', {}).get('earningsPublic') is False, (st, (a or {}).get('account', {}).get('earningsPublic', '(없음)')))
    st, r = call('PATCH', '/me/account', O['tok'], {'name': O['name'], 'earningsPublic': True})
    st2, d = call('GET', f'/listings/{L}'); ow = (d or {}).get('owner') or {}
    rec('B-4 본인이 켜면(PATCH /me/account earningsPublic:true) 상세에 누적수익 700,000 이 보임', st == 200 and ow.get('earningsPublic') is True and ow.get('settledAmount') == f['settled'], (st, r if st >= 300 else '', ow.get('settledAmount'), ow.get('earningsPublic')))
    rec('B-5 켜도 본인인증은 풀리지 않음(이름을 바꾸지 않았으므로)', st == 200 and (r or {}).get('identityReset') is False and q(f"select identity_verified_at is not null from accounts where id='{O['id']}'") == 't', (r or {}).get('identityReset'))
    st, r = call('PATCH', '/me/account', O['tok'], {'name': O['name']})
    rec('B-6 공개 여부를 보내지 않은 수정은 설정을 건드리지 않음(켠 채로 유지)', st == 200 and q(f"select earnings_public from accounts where id='{O['id']}'") == 't', (st, q(f"select earnings_public from accounts where id='{O['id']}'")))
    st, r = call('PATCH', '/me/account', U['tok'], {'name': U['name'], 'earningsPublic': False})
    rec('B-7 다른 회원이 자기 설정을 바꿔도 이 등록자의 설정은 그대로', q(f"select earnings_public from accounts where id='{O['id']}'") == 't' and q(f"select earnings_public from accounts where id='{U['id']}'") == 'f', '')
    st, r = call('PATCH', '/me/account', O['tok'], {'name': O['name'], 'earningsPublic': 'yes'})
    rec('B-8 공개 여부에 참 · 거짓이 아닌 값("yes") → 400', st == 400, (st, str(r)[:80]))
    call('PATCH', '/me/account', O['tok'], {'name': O['name'], 'earningsPublic': False})
    st, r = call('PATCH', '/me/account', O['tok'], {'name': O['name'], 'earningsPublic': 'false'})
    rec('B-8b 글자 "false" 를 보내도 켜지지 않음(400 · 설정은 꺼진 채) — 글자를 참으로 바꿔 읽지 않습니다', st == 400 and q(f"select earnings_public from accounts where id='{O['id']}'") == 'f', (st, q(f"select earnings_public from accounts where id='{O['id']}'")))
    call('PATCH', '/me/account', O['tok'], {'name': O['name'], 'earningsPublic': True})
    st, lst = call('GET', '/listings?gwanCode=MNY&limit=50')
    cards = ((lst or {}).get('organic') or []) + ((lst or {}).get('promoted') or [])
    mine = next((c for c in cards if c['id'] == L), None)
    rec('B-9 목록 카드에는 누적수익이 실리지 않음(켠 상태에서도)', mine is not None and 'settledAmount' not in (mine.get('owner') or {}) and '700000' not in json.dumps(mine), (mine or {}).get('owner'))
    st, r = call('PATCH', '/me/account', O['tok'], {'name': O['name'], 'earningsPublic': False})
    st2, d = call('GET', f'/listings/{L}'); ow = (d or {}).get('owner') or {}
    rec('B-10 끄면 다시 숨김(null) — 총 소개 · 성사는 그대로 보임', st == 200 and ow.get('settledAmount') is None and ow.get('earningsPublic') is False and ow.get('totalDeals') == 3, (ow.get('settledAmount'), ow.get('earningsPublic')))
    st, raw = call('GET', f'/listings/{L}', raw=True)
    rec('B-11 숨김 상태의 상세 응답 어디에도 700000 이 없음', st == 200 and '700000' not in raw, raw[:0])

    # ── C ── 후기 작성
    TAG = REVIEW_TAG   # v10.31 칩(태그) 하나
    dc, ds, di = f['deals']['confirmed'], f['deals']['settled'], f['deals']['inquiry']
    st, r = call('POST', f'/deals/{dc}/reviews', U['tok'], {'rating': 5, 'body': '소통이 빠르고 조건에 맞는 곳을 소개받았습니다. 문의는 010-1234-5678 또는 kim@example.com 으로 주세요.'})
    tgt = q(f"select target_id from deal_reviews where deal_id='{dc}' and author_id='{U['id']}'")
    rec('C-1 구매자가 성사 확정된 거래에 후기 작성 → 201 · 대상(target)은 그 거래의 소개자', st in (200, 201) and tgt == O['id'], (st, str(r)[:120], tgt))
    # v10.31 (w1 D047 · 10/10 시안 「후기는 수정할 수 있지만 삭제되지 않습니다」) — 같은 거래에 다시 쓰면 고칩니다(전: 409 ALREADY_REVIEWED) · 빈 후기는 422 REVIEW_EMPTY
    st0, r0 = call('POST', f'/deals/{dc}/reviews', U['tok'], {'rating': 4, 'body': '두 번째'})
    st, r = call('POST', f'/deals/{dc}/reviews', U['tok'], {'rating': 5, 'body': '소통이 빠르고 조건에 맞는 곳을 소개받았습니다. 문의는 010-1234-5678 또는 kim@example.com 으로 주세요.'})
    n_dc = q(f"select count(*) from deal_reviews where deal_id='{dc}' and author_id='{U['id']}'")
    rec('C-2 같은 거래에 다시 쓰면 고쳐 씀(edited · 한 줄 그대로) · 칩 없이 10자 미만은 422 REVIEW_EMPTY', st0 == 422 and (r0 or {}).get('code') == 'REVIEW_EMPTY'
        and st in (200, 201) and (r or {}).get('edited') is True and n_dc == '1', (st0, (r0 or {}).get('code'), st, r, n_dc))
    st, r = call('POST', f'/deals/{ds}/reviews', U['tok'], {'rating': 4, 'tags': [TAG]})
    rec('C-3 정산 완료된 거래에도 작성 가능(내용 없이 평점 + 칩 하나 — v10.31 빈 후기 막음)', st in (200, 201), (st, str(r)[:120]))
    st, r = call('POST', f'/deals/{di}/reviews', U['tok'], {'rating': 5, 'body': '문의 중', 'tags': [TAG]})
    rec('C-4 성사 확정 전(문의 중) 거래 → 422 NOT_CONFIRMED', st == 422 and (r or {}).get('code') == 'NOT_CONFIRMED', (st, r))
    st, r = call('POST', f'/deals/{dc}/reviews', O['tok'], {'rating': 5, 'body': '제 실적입니다', 'tags': [TAG]})
    n_self = q(f"select count(*) from deal_reviews where deal_id='{dc}' and author_id='{O['id']}'")
    rec('C-5 거래 당사자(구매자 · 판매자)가 아닌 회원 — 소개자 본인 포함 — 은 쓸 수 없음(403 · 저장 0)', st == 403 and n_self == '0', (st, r, n_self))
    st, r = call('POST', f'/deals/{dc}/reviews', U['tok'], {'rating': 6})
    rec('C-6 평점 1~5 밖 → 400', st == 400, (st, str(r)[:80]))
    st, r = call('POST', '/deals/00000000-0000-4000-8000-000000000000/reviews', U['tok'], {'rating': 5, 'tags': [TAG]})
    rec('C-7 없는 거래 → 404 · 500 이 아님', st in (404, 409) and st != 500, (st, r))

    # ── D ── 후기 공개 조회
    st, rv = call('GET', f'/listings/{L}/reviews')
    items = (rv or {}).get('items') or []
    rec('D-1 로그인 없이 조회(GET /listings/{id}/reviews) 200 · 후기 2건 · 평균 4.5', st == 200 and (rv or {}).get('count') == 2 and len(items) == 2 and (rv or {}).get('average') == 4.5, (st, (rv or {}).get('count'), (rv or {}).get('average')))
    names = [i.get('authorName') for i in items]
    rec('D-2 작성자 이름은 첫 글자만 — 「김○○」(전체 이름 · 회사 이름 없음)', bool(items) and all(n == '김○○' for n in names) and U['name'] not in json.dumps(rv, ensure_ascii=False) and (U['company'] or 'x') not in json.dumps(rv, ensure_ascii=False), names)
    keys = set().union(*[set(i.keys()) for i in items]) if items else set()
    rec('D-3 항목은 id · authorName · rating · body · createdAt 뿐 — 계정 id · 이메일 · 거래 id 가 없음', keys == {'id', 'authorName', 'rating', 'body', 'createdAt'} and U['id'] not in json.dumps(rv) and U['email'] not in json.dumps(rv) and dc not in json.dumps(rv), sorted(keys))
    body5 = next((i['body'] for i in items if i.get('rating') == 5), '')
    rec('D-4 본문의 전화번호 · 이메일은 가려서 나감(v10.31 w1 — 저장할 때 ***-****-**** · ***@*** 로 가림)', ('[연락처]' in body5 or '***-****-****' in body5) and ('[이메일]' in body5 or '***@***' in body5) and '010-1234-5678' not in body5 and 'kim@example.com' not in body5, body5[:80])
    rec('D-5 최신 글이 먼저 · 작성 시각(ISO)', len(items) == 2 and all(ISO.match(str(i.get('createdAt') or '')) for i in items) and items[0]['createdAt'] >= items[1]['createdAt'], [i.get('createdAt') for i in items])
    st, rv3 = call('GET', f'/listings/{other}/reviews')
    rec('D-6 다른 등록자의 매물에는 이 후기가 섞이지 않음(0건 · 평균 null)', st == 200 and (rv3 or {}).get('count') == 0 and (rv3 or {}).get('items') == [] and (rv3 or {}).get('average') is None, (st, rv3))
    st, r = call('GET', '/listings/00000000-0000-4000-8000-000000000000/reviews'); st2, r2 = call('GET', '/listings/not-a-uuid/reviews')
    rec('D-7 없는 매물 → 404 · 번호 형식이 틀리면 400 (500 아님)', st == 404 and st2 == 400, (st, st2))
    st, d = call('GET', f'/listings/{L}'); ow = (d or {}).get('owner') or {}
    rec('D-8 상세 응답의 등록자에 후기 수 · 평균(reviewCount 2 · rating 4.5)', ow.get('reviewCount') == 2 and ow.get('rating') == 4.5, (ow.get('reviewCount', '(없음)'), ow.get('rating', '(없음)')))

    # ── S ── 참 · 거짓 입력 (G-134) — 글자를 참으로 바꿔 읽는 곳이 없어야 합니다
    st, r = call('POST', '/invites/nope-token/consent', None, {'agree': 'false'})
    st2, r2 = call('POST', '/invites/nope-token/consent', None, {'agree': False})
    rec('S-1 초대 동의에 글자 "false" → 400(전에는 동의로 읽혔습니다) · 진짜 거짓 값은 검사를 통과해 「없는 초대」 응답', st == 400 and st2 in (404, 409), (st, st2, str(r2)[:60]))
    import glob
    kit = os.environ.get('KIT') or os.path.join(os.path.dirname(OUT), 'sgb')
    kit = kit if os.path.isdir(os.path.join(kit, 'src')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb'
    bare = []
    for fp in glob.glob(kit + '/src/**/*.ts', recursive=True):
        for i, line in enumerate(open(fp, encoding='utf-8'), 1):
            if '@IsBoolean()' in line and not fp.endswith('strict-boolean.ts'): bare.append(f'{os.path.relpath(fp, kit)}:{i}')
    used = sum(open(fp, encoding='utf-8').read().count('@StrictBoolean()') for fp in glob.glob(kit + '/src/**/*.ts', recursive=True))
    rec(f'S-2 서버 소스의 참 · 거짓 입력 {used}곳이 모두 받은 값 그대로 검사(@StrictBoolean) — 그냥 @IsBoolean() 0곳', not bare and used >= 8, bare[:8])

    # ── E ── 요청 등록 시각
    st, rq = call('GET', '/requests?gwanCode=MNY')
    rows = rq if isinstance(rq, list) else (rq or {}).get('items') or []
    rec(f'E-1 요청 목록 {len(rows)}건 모두 등록 시각(createdAt · ISO)이 있음', st == 200 and len(rows) >= 1 and all(ISO.match(str(x.get('createdAt') or '')) for x in rows), (st, [x.get('createdAt', '(없음)') for x in rows[:3]]))
    rid = rows[0]['id'] if rows else q("select id from requests limit 1")
    st, one = call('GET', f'/requests/{rid}', U['tok'])
    dbt = q(f"select to_char(created_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI') from requests where id='{rid}'")
    rec('E-2 요청 상세에도 등록 시각 — DB 의 값과 같음', st == 200 and str((one or {}).get('createdAt') or '')[:16] == dbt, (st, (one or {}).get('createdAt', '(없음)'), dbt))


if __name__ == '__main__':
    f = None
    try:
        f = F.make(); main(f)
    except Exception as ex:
        import traceback; traceback.print_exc(); rec('실행 중 오류', False, repr(ex)[:300])
    finally:
        try: rec('Z-1 시험 자료(거래 3건)를 지웠고 거래 표의 규칙이 모두 켜져 있음', F.cleanup(f) and (not f or q("select count(*) from deals where id in (" + ",".join("'" + d + "'" for d in f['deals'].values()) + ")") == '0'), '')
        except Exception as ex: rec('Z-1 시험 자료 지우기', False, repr(ex)[:200])
    ok = sum(1 for r in R if r['ok'])
    json.dump({'items': R, 'pass': ok, 'total': len(R)}, open(os.path.join(OUT, 'srv_detail.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'통과 {ok} / {len(R)}')
