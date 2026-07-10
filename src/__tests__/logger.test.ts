import { createLogger, NOOP_LOGGER, Logger } from '../logger';

describe('createLogger', () => {
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let infoSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    infoSpy.mockRestore();
    debugSpy.mockRestore();
  });

  it('should_log_error_level_to_console_error', () => {
    const log = createLogger('test-id');
    log.error('Something broke', { code: 'ERR' });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(errorSpy.mock.calls[0][0]);
    expect(entry.level).toBe('ERROR');
    expect(entry.message).toBe('Something broke');
    expect(entry.correlationId).toBe('test-id');
    expect(entry.data).toEqual({ code: 'ERR' });
    expect(entry.timestamp).toBeDefined();
  });

  it('should_log_warn_level_to_console_warn', () => {
    const log = createLogger('cid-1');
    log.warn('Heads up');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(warnSpy.mock.calls[0][0]);
    expect(entry.level).toBe('WARN');
  });

  it('should_log_info_level_to_console_info', () => {
    const log = createLogger('cid-2');
    log.info('Scan started', { count: 10 });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(infoSpy.mock.calls[0][0]);
    expect(entry.level).toBe('INFO');
    expect(entry.data).toEqual({ count: 10 });
  });

  it('should_log_debug_level_to_console_debug', () => {
    const log = createLogger('cid-3');
    log.debug('Processing file');

    expect(debugSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(debugSpy.mock.calls[0][0]);
    expect(entry.level).toBe('DEBUG');
  });

  it('should_include_correlation_id_in_all_logs', () => {
    const log = createLogger('my-correlation-id');
    log.error('e');
    log.warn('w');
    log.info('i');
    log.debug('d');

    const entries = [
      JSON.parse(errorSpy.mock.calls[0][0]),
      JSON.parse(warnSpy.mock.calls[0][0]),
      JSON.parse(infoSpy.mock.calls[0][0]),
      JSON.parse(debugSpy.mock.calls[0][0]),
    ];

    for (const entry of entries) {
      expect(entry.correlationId).toBe('my-correlation-id');
    }
  });

  it('should_allow_data_to_be_undefined', () => {
    const log = createLogger('test');
    log.info('No data');

    const entry = JSON.parse(infoSpy.mock.calls[0][0]);
    expect(entry.data).toBeUndefined();
  });
});

describe('NOOP_LOGGER', () => {
  it('should_not_throw_when_calling_any_level', () => {
    expect(() => NOOP_LOGGER.error('msg')).not.toThrow();
    expect(() => NOOP_LOGGER.warn('msg')).not.toThrow();
    expect(() => NOOP_LOGGER.info('msg')).not.toThrow();
    expect(() => NOOP_LOGGER.debug('msg')).not.toThrow();
  });

  it('should_not_output_to_console', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    NOOP_LOGGER.info('test');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
