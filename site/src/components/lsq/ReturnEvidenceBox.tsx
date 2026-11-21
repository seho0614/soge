import { getTranslations } from 'next-intl/server';
import { LsqReturnEvidence } from './ReturnEvidence';

/** v10.608 (docs/750) 서버 껍데기 — 사전(lsq.ret) 글자를 모아 브라우저 부품에 넘김(화면 전용 묶음을 내려보내지 않아도 됨) */
const KEYS = ['show', 'hide', 'photos', 'add', 'uploading', 'added', 'max', 'off', 'failed', 'noLog', 'inspect', 'condition', 'fault', 'note', 'visible', 'save', 'saved',
  'sideBUYER', 'sideSELLER', 'sideADMIN', 'sideSYSTEM', 'kSTATE', 'kINSPECT', 'kNOTE',
  'cUNOPENED', 'cOPENED', 'cUSED', 'cDAMAGED', 'cMISSING', 'cWRONG_ITEM', 'fBUYER', 'fSELLER', 'fCARRIER', 'fUNKNOWN',
  'sREQUESTED', 'sAPPROVED', 'sREJECTED', 'sREFUNDED'] as const;

export async function LsqReturnEvidenceBox({ returnId }: { returnId: string }) {
  const t = await getTranslations('lsq.ret');
  const labels = Object.fromEntries(KEYS.map((k) => [k, t.raw(k) as string]));
  return <LsqReturnEvidence returnId={returnId} labels={labels} />;
}
