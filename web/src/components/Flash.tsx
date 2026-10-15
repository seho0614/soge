/** 서버 안내문에 섞여 오는 마크다운 강조(**)를 걷어 냅니다 — 화면에 별표가 그대로 나갑니다. */
const plain = (s?: string | null) => (s ? s.replace(/\*\*/g, '') : s);

/** 처리 결과 한 줄. 성공은 form-ok, 실패는 경고 카드로 보입니다. */
export function Flash({ msg: m, err: e }: { msg?: string | null; err?: string | null }) {
  const msg = plain(m), err = plain(e);
  return (
    <>
      {msg && <p className="form-ok" role="status">{msg}</p>}
      {err && <p className="card warn flash-err" role="alert">{err}</p>}
    </>
  );
}
