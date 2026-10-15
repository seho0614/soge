"""v10.31.1 — 디자인 원본 그림이 킷 밖(디자인 원본 묶음)에 있을 때 쓰는 지문 대조.
원본이 제자리에 있으면 각 검사 도구는 원본과 직접 견주고, 없으면 design_fingerprints.json 의 지문
(원본과 견줘 통과한 조각 파일의 sha256 — v10.31 에서 기록)과 견줍니다."""
import hashlib, json, os
Q = os.path.dirname(os.path.abspath(__file__))
FP = json.load(open(os.path.join(Q, 'design_fingerprints.json'), encoding='utf8'))
def sha(path_or_bytes):
    b = path_or_bytes if isinstance(path_or_bytes, (bytes, bytearray)) else open(path_or_bytes, 'rb').read()
    return hashlib.sha256(b).hexdigest()
def same_fp(kind, name, path_or_bytes):
    want = FP.get(kind, {}).get(name)
    try: return bool(want) and sha(path_or_bytes) == want
    except Exception: return False
