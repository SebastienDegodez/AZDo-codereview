/**
 * Infrastructure utility — lightweight structured logger.
 *
 * Supported log levels (in ascending verbosity order):
 *   error < warn < info < verbose
 *
 * Control verbosity via the LOG_LEVEL environment variable:
 *   LOG_LEVEL=verbose  — show all messages
 *   LOG_LEVEL=info     — show info, warn, error  (default)
 *   LOG_LEVEL=warn     — show warn, error
 *   LOG_LEVEL=error    — show only error
 *
 * @module logger
 */

const LEVELS = { error: 0, warn: 1, info: 2, verbose: 3 };

function currentLevel() {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return LEVELS[raw] ?? LEVELS.info;
}

function timestamp() {
  return new Date().toISOString();
}

function formatMessage(level, message, ...args) {
  const ts = timestamp();
  const prefix = `[${ts}] [${level.toUpperCase()}]`;
  if (args.length === 0) return `${prefix} ${message}`;
  const extra = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  return `${prefix} ${message} ${extra}`;
}

function shouldLog(level) {
  return LEVELS[level] <= currentLevel();
}

/** Log an informational message. */
function info(message, ...args) {
  if (shouldLog("info")) {
    console.log(formatMessage("info", message, ...args));
  }
}

/** Log a warning message. */
function warn(message, ...args) {
  if (shouldLog("warn")) {
    console.warn(formatMessage("warn", message, ...args));
  }
}

/** Log an error message. */
function error(message, ...args) {
  if (shouldLog("error")) {
    console.error(formatMessage("error", message, ...args));
  }
}

/** Log a verbose/debug message (only shown when LOG_LEVEL=verbose). */
function verbose(message, ...args) {
  if (shouldLog("verbose")) {
    console.log(formatMessage("verbose", message, ...args));
  }
}

export const logger = { info, warn, error, verbose };
