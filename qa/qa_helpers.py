"""v10.619 (docs/762) 시험 공통 도우미 — 새 시험은 이것을 씁니다(옛 시험은 그대로 두고 test_v1619 가 규칙만 검사).

  kst_now() · kst_night(start=21, end=8)
      서버의 밤 시간(mkx nightKst · 마케팅 isNightKst 와 같은 21 ~ 08시 KST)인지.
      밤에 막히는 기능을 시험할 때는 「밤 갈래」에서 낮에만 되는 확인(보낸 줄 · 지우기 막힘 등)까지 뺍니다.
      판정은 가능하면 서버 응답 코드(예 MKX_REBUY_NIGHT)로 하고, 이 함수는 서버 응답이 없을 때만 씁니다.

  drop_accounts_sql(where)
      시험 계정을 replica 로 지울 때 쓰는 SQL — 외래 키 검사가 꺼지므로 딸린 권한 줄(perm_account_groups ·
      perm_account_overrides · account_roles)을 먼저 지웁니다. 남기면 뒤 시험이 외래 키 409(11/22 v1566).
      where 는 accounts 를 고르는 조건(예 "email LIKE 't1619_%@x.com'").
"""
import datetime

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
