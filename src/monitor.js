// Bot monitoring & health metrics

const metrics = {
  startedAt: Date.now(),
  commands: { total: 0, errors: 0 },
  api: { calls: 0, errors: 0, retries: 0, totalMs: 0 },
  messages: { sent: 0, failed: 0 },
  errors: [], // last 20 errors
};

function trackCommand(command, success = true) {
  metrics.commands.total++;
  if (!success) metrics.commands.errors++;
}

function trackApiCall(durationMs, success = true, retried = false) {
  metrics.api.calls++;
  metrics.api.totalMs += durationMs;
  if (!success) metrics.api.errors++;
  if (retried) metrics.api.retries++;
}

function trackMessage(success = true) {
  if (success) metrics.messages.sent++;
  else metrics.messages.failed++;
}

function trackError(context, error) {
  metrics.errors.push({
    context,
    message: error.message || String(error),
    timestamp: new Date().toISOString(),
  });
  // Keep only last 20 errors
  if (metrics.errors.length > 20) metrics.errors.shift();
}

function getMetrics() {
  const uptimeMs = Date.now() - metrics.startedAt;
  const uptimeSec = Math.floor(uptimeMs / 1000);
  const d = Math.floor(uptimeSec / 86400);
  const h = Math.floor((uptimeSec % 86400) / 3600);
  const m = Math.floor((uptimeSec % 3600) / 60);
  const uptimeStr = `${d}d ${h}h ${m}m`;

  const avgApiMs = metrics.api.calls > 0
    ? Math.round(metrics.api.totalMs / metrics.api.calls)
    : 0;

  const cmdErrorRate = metrics.commands.total > 0
    ? ((metrics.commands.errors / metrics.commands.total) * 100).toFixed(1)
    : '0.0';

  const apiErrorRate = metrics.api.calls > 0
    ? ((metrics.api.errors / metrics.api.calls) * 100).toFixed(1)
    : '0.0';

  return {
    uptime: uptimeStr,
    uptimeMs,
    commands: { ...metrics.commands, errorRate: cmdErrorRate },
    api: { ...metrics.api, avgMs: avgApiMs, errorRate: apiErrorRate },
    messages: { ...metrics.messages },
    recentErrors: metrics.errors.slice(-5),
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    memoryTotalMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
  };
}

function resetMetrics() {
  metrics.commands = { total: 0, errors: 0 };
  metrics.api = { calls: 0, errors: 0, retries: 0, totalMs: 0 };
  metrics.messages = { sent: 0, failed: 0 };
  metrics.errors = [];
}

module.exports = { trackCommand, trackApiCall, trackMessage, trackError, getMetrics, resetMetrics };
