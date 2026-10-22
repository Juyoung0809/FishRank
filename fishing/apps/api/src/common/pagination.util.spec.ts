import {
  pageWindow,
  paginated,
  parseLimit,
  parsePageLimit,
} from './pagination.util';

describe('parsePageLimit', () => {
  it('정상 값은 정수로 맞춘다', () => {
    expect(parsePageLimit('2', '10.9', 20, 50)).toEqual({ page: 2, limit: 10 });
  });

  it('숫자가 아니거나 0 이하면 기본값을 쓴다', () => {
    expect(parsePageLimit('abc', '-3', 20, 50)).toEqual({ page: 1, limit: 20 });
    expect(parsePageLimit(0, Number.NaN, 20, 50)).toEqual({
      page: 1,
      limit: 20,
    });
  });

  it('limit 상한을 넘기지 않는다', () => {
    expect(parsePageLimit(1, 100000, 20, 50)).toEqual({ page: 1, limit: 50 });
    expect(parseLimit(100000, 10, 100)).toBe(100);
  });
});

describe('pageWindow / paginated', () => {
  it('skip/take 를 계산하고 범위를 맞춘다', () => {
    expect(pageWindow(3, 20)).toEqual({ page: 3, take: 20, skip: 40 });
    expect(pageWindow(0, 500, 100)).toEqual({ page: 1, take: 100, skip: 0 });
  });

  it('빈 목록도 totalPages 는 1 이다', () => {
    expect(paginated([], 0, 1, 20)).toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    expect(paginated([1], 41, 1, 20).totalPages).toBe(3);
  });
});
