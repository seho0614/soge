"""공격 검정(sgb/scripts/attack-check.sh)의 「남의 거래로 후기」 시험(CF-02 · CG-02)이 줄 순서에 따라 결과가 달라지지 않는지 봅니다 (G-144). 결과: attack_pick.json

  전에는 「아무 회원 1명」과 「아무 거래 1건」을 순서 지정 없이 따로 골랐습니다. 고른 회원이 마침 그 거래의 당사자(소개자)이고 거래가 성사 상태면
  정당한 후기가 들어가 「▲뚫림」으로 나옵니다 — 10/7 Docker 검정(`./dev.sh check`)의 두 번째 실행에서 2건(같은 DB 를 한 번 더 돌리니 0건).
  이 시험은 검정 스크립트가 회원을 고르는 SQL 을 꺼내, 검정 DB 의 **모든 거래**에 대해 「고른 회원이 그 거래의 당사자가 아닌지」를 봅니다.

사용:  DATABASE_URL=postgresql://…/sgb_check python3 attack_pick_test.py     (읽기만 합니다)
"""
import json, os, re, subprocess, sys
_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'scripts')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
DB = os.environ.get('DATABASE_URL', 'postgresql://sgb:sgb@localhost:5432/sgb_check')
OUT = os.path.dirname(os.path.abspath(__file__))
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:400]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:300], file=sys.stderr)
def q(sql):
    p = subprocess.run(['psql', DB, '-t', '-A', '-c', sql], capture_output=True, text=True)
    return [l for l in p.stdout.strip().split('\n') if l], p.stderr.strip()

src = open(K + '/scripts/attack-check.sh', encoding='utf-8').read()
def pick(var):
    m = re.search(r'^' + var + r'=\$\(\$Q -c "(.*?)" 2>/dev/null', src, re.S | re.M)
    return re.sub(r'\s+', ' ', m.group(1)) if m else None
deals, _ = q("SELECT id, status, buyer_account_id, seller_account_id, coalesce(introducer_account_id::text,'') FROM deals ORDER BY created_at, id")
rec(f'검정 DB 에 거래 {len(deals)}건(성사 상태 포함)', len(deals) >= 1 and any('|CONFIRMED|' in d for d in deals), deals[:3])
for acc, dl in (('CFA', 'CFD'), ('CGA', 'CGD')):
    sa, sd = pick(acc), pick(dl)
    rec(f'{dl} — 거래를 고르는 SQL 에 순서(ORDER BY)가 있음', bool(sd) and 'ORDER BY' in sd.upper(), sd)
    rec(f'{acc} — 회원을 고르는 SQL 이 고른 거래(${dl})를 보고 당사자를 뺌', bool(sa) and ('$' + dl) in sa, sa)
    bad = []
    for d in deals:
        did, st, bu, se, intro = d.split('|')
        got, err = q((sa or 'SELECT NULL').replace('$' + dl, did))
        a = got[0] if got else ''
        if not a or a in (bu, se, intro): bad.append((did[:8], st, a[:8] or err[:60]))
    rec(f'{acc} — 거래 {len(deals)}건 어느 것을 골라도, 고른 회원은 그 거래의 당사자(구매자 · 판매자 · 소개자)가 아님', not bad, bad)
ok = sum(1 for r in R if r['ok'])
json.dump({'items': R, 'pass': ok, 'total': len(R)}, open(os.path.join(OUT, 'attack_pick.json'), 'w'), ensure_ascii=False, indent=1)
print(f'통과 {ok} / {len(R)}')
