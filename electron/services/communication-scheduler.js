/**
 * Server-side Communication Centre scheduler — runs without browser open.
 */
let timer = null;
let running = false;

function startCommunicationScheduler() {
  if (timer) return;
  const comm = require('./communication-centre');
  try { comm.ensureSchema(); } catch (e) {
    console.warn('[comm-scheduler] schema:', e.message || e);
  }
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await comm.runSchedulerTick();
      if (result?.sent > 0) {
        console.log(`[comm-scheduler] processed=${result.processed} sent=${result.sent}`);
      }
    } catch (e) {
      console.warn('[comm-scheduler] tick error:', e.message || e);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 5000);
  timer = setInterval(tick, 60_000);
  console.log('[comm-scheduler] started (60s interval)');
}

function stopCommunicationScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startCommunicationScheduler, stopCommunicationScheduler };
