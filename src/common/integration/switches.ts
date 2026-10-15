import { DatabaseService } from '../../db/database.service';

/* ---------------------------------------------------------------------
 * v10.44 (2026-10-15 · 외부 연동 틀 통일) — 연동 판단을 한 곳에서
 *
 * 전에는 같은 SQL 이 서비스마다 따로 있었습니다(assume.broker 4곳 · assume.etax 1곳 · 알림톡 상태 1곳).
 * 판단을 바꿀 때 한 곳만 고치면 되도록 모았습니다. **동작은 전과 같습니다.**
 *
 *   assumeOn(db, 'broker', false)   설정 assume.broker 가 'on' 인가 — 줄이 없을 때의 값은 부르는 쪽이 정합니다.
 *                                   ★ 연동마다 다릅니다(전과 같게): broker 는 꺼짐(false) · etax 는 켜짐(true).
 *                                     줄이 있는데 값이 비어(NULL) 있으면 꺼짐입니다.
 *   integrationLive(db, 'ALIMTALK') integrations 표의 그 연동이 LIVE 인가(운영 화면에서 바꾸는 상태)
 * ------------------------------------------------------------------- */

/** 간주 스위치 이름 — site_settings 의 assume.<이름> */
export type AssumeName = 'payment' | 'broker' | 'bank' | 'etax';

export async function assumeOn(db: DatabaseService, name: AssumeName, whenMissing: boolean): Promise<boolean> {
  const [r] = await db.query<{ on: boolean | null }>(
    `SELECT value = 'on' AS on FROM site_settings WHERE key = $1`, [`assume.${name}`]);
  return r ? !!r.on : whenMissing;
}

export async function integrationLive(db: DatabaseService, code: string): Promise<boolean> {
  const [r] = await db.query<{ status: string }>(`SELECT status FROM integrations WHERE code = $1`, [code]);
  return r?.status === 'LIVE';
}
