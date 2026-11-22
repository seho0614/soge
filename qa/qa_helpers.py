"""v10.619 (docs/762) 시험 공통 도우미 — 새 시험은 이것을 씁니다(옛 시험은 그대로 두고 test_v1619 가 규칙만 검사).

  kst_now() · kst_night(start=21, end=8)
      서버의 밤 시간(mkx nightKst · 마케팅 isNightKst 와 같은 21 ~ 08시 KST)인지.
      밤에 막히는 기능을 시험할 때는 「밤 갈래」에서 낮에만 되는 확인(보낸 줄 · 지우기 막힘 등)까지 뺍니다.
      판정은 가능하면 서버 응답 코드(예 MKX_REBUY_NIGHT)로 하고, 이 함수는 서버 응답이 없을 때만 씁니다.

  drop_accounts_sql(where)
      시험 계정을 replica 로 지울 때 쓰는 SQL — 외래 키 검사가 꺼지므로 딸린 권한 줄(perm_account_groups ·
      perm_account_overrides · account_roles)을 먼저 지웁니다. 남기면 뒤 시험이 외래 키 409(11/22 v1566).
      where 는 accounts 를 고르는 조건(예 "email LIKE 't1619_%@x.com'").

  MigFrom(n0, name0=None)                                   — v10.629 (docs/773)
      옛 시험의 「마이그레이션 수 · 마지막 이름」 목록 대신 「이 판 이상」. `x in MigFrom(152, 'D114_seed_ad_ends_extend')`
      x 는 (수, 이름) · '수|이름' · 수 — 수가 n0 이상이고 마지막 이름의 번호(B < D · 숫자)가 name0 이상이면 참.
      묶음마다 옛 시험 58개의 목록을 늘리던 손일을 없앰(새 마이그레이션이 생겨도 그대로 통과 · 줄어들면 실패).
"""
import datetime
import re as _re

ACCOUNT_CHILDREN = ('perm_account_groups', 'perm_account_overrides', 'account_roles')


def kst_now():
    return datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)


def kst_night(start=21, end=8, now=None):
    h = (now or kst_now()).hour
    return h >= start or h < end


def drop_accounts_sql(where, extra=()):
    ids = f"(SELECT id FROM accounts WHERE {where})"
    parts = ['SET session_replication_role = replica;']
    for t in tuple(extra) + ACCOUNT_CHILDREN:
        parts.append(f'DELETE FROM {t} WHERE account_id IN {ids};')
    parts.append(f'DELETE FROM accounts WHERE {where};')
    return ' '.join(parts)


def mig_key(name):
    """마이그레이션 이름 → 비교 열쇠(B 묶음 < D 묶음 · 숫자) — 모양이 다르면 가장 작음"""
    m = _re.match(r'^([A-Z])(\d+)_', str(name or ''))
    return ((1 if m.group(1) == 'D' else 0), int(m.group(2))) if m else (-1, -1)


class MigFrom:
    """v10.629 (docs/773) 「이 판 이상」 — `x in MigFrom(n0, name0)` (x = (수, 이름) · '수|이름' · 수)"""

    def __init__(self, n0, name0=None):
        self.n0, self.name0 = int(n0), name0

    def __contains__(self, x):
        name = None
        if isinstance(x, (tuple, list)) and len(x) == 2:
            n, name = x
        elif isinstance(x, str) and '|' in x:
            a, name = x.split('|', 1)
            n = int(a) if a.strip().isdigit() else -1
        else:
            n = x
        try:
            n = int(n)
        except (TypeError, ValueError):
            return False
        if n < self.n0:
            return False
        return name is None or self.name0 is None or mig_key(name) >= mig_key(self.name0)

    def __repr__(self):
        return f'MigFrom({self.n0}, {self.name0!r})'

