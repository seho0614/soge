'use client';
import { createContext } from 'react';

/* v10.697 (D321 · docs/805) 메인 구역 제목 — 운영이 페이지 목록 › 메인에서 넣은 글(texts['h.<구역>'])이 있으면 그것, 없으면 사전 글
 *   구역 함수 맨 위에서 useContext(HTitles) 로 읽음(조건에 따라 먼저 끝나는 구역도 훅 차례가 같게) */
export const HTitles = createContext<Record<string, string>>({});
