/** 모든 API 응답의 공통 래퍼 `{ success: true, data }`. */
export const ok = <T>(data: T) => ({ success: true, data });
