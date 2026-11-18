const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/**
 * Minimal leveled logger: one line per event on stdout/stderr.
 * Swap for pino (JSON logs) when shipping logs to a log service.
 */
export function createLogger(level = 'info') {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const writer = (name, stream) => (message, fields) => {
    if (LEVELS[name] < threshold) return;
    const extra = fields === undefined ? '' : ` ${JSON.stringify(fields)}`;
    stream.write(`${new Date().toISOString()} ${name.toUpperCase().padEnd(5)} ${message}${extra}\n`);
  };

  return {
    debug: writer('debug', process.stdout),
    info: writer('info', process.stdout),
    warn: writer('warn', process.stderr),
    error: writer('error', process.stderr),
  };
}

export const silentLogger = createLogger('silent');
