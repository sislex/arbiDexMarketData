import { WriteMetricsService } from '../write-metrics.service';

describe('WriteMetricsService', () => {
  let service: WriteMetricsService;
  let nowSpy: jest.SpyInstance<number, []>;
  let nowMs: number;

  const setMinute = (minute: number) => {
    nowMs = minute * 60_000;
    nowSpy.mockReturnValue(nowMs);
  };

  beforeEach(() => {
    service = new WriteMetricsService();
    nowMs = 0;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('should calculate activeKeys by longest requested window', () => {
    setMinute(1_000);
    service.recordAttempt('rest', 'k-old', 'accepted');

    setMinute(1_100);
    service.recordAttempt('rest', 'k-recent', 'accepted');

    const shortWindow = service.getServiceMetrics({ windows: ['1h'] });
    expect(shortWindow.activeKeys).toBe(1);

    const longWindow = service.getServiceMetrics({ windows: ['1h', '12h'] });
    expect(longWindow.activeKeys).toBe(2);
  });

  it('should count activeKeys for keys endpoint only within provided keys', () => {
    setMinute(2_000);
    service.recordAttempt('rest', 'k1', 'accepted');
    service.recordAttempt('rest', 'k-outside', 'accepted');

    const grouped = service.getKeysMetrics(['k1'], { windows: ['24h'] });
    expect(grouped.activeKeys).toBe(1);
    expect(Object.keys(grouped.perKey)).toEqual(['k1']);
  });

  it('should return perKey block with same windows/series shape as single-key endpoint', () => {
    setMinute(3_000);
    service.recordAttempt('ws', 'k1', 'accepted');

    const single = service.getKeyMetrics('k1', { windows: ['1m', '1h'], seriesMinutes: 15 });
    const grouped = service.getKeysMetrics(['k1'], { windows: ['1m', '1h'], seriesMinutes: 15 });

    const perKey = grouped.perKey['k1'];
    expect(Object.keys(perKey.windows)).toEqual(Object.keys(single.windows));
    expect(perKey.series.rangeMinutes).toBe(single.series.rangeMinutes);
    expect(perKey.series.points).toHaveLength(single.series.points.length);
    expect(perKey.isActive).toBe(single.isActive);
  });
});

