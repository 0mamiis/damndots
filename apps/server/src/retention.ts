import type { RecordStore } from '@dots/contracts';
import { SqliteStore } from './storage.js';

/**
 * Old operational records are trimmed so lookups and polling stay fast as the install ages.
 * Chat messages, tasks, outputs, memories, schedules and settings are never touched.
 */
export const RETENTION = {
  /** Replay log for the live dashboard stream; a reconnecting client older than this simply refreshes. */
  events: 2000,
  /** Raw Codex notifications (token counters, reasoning deltas...) shown in task details. */
  activityKeep: 20000,
  activityAgeDays: 90,
  /** Payload-heavy computer jobs that finished long ago. */
  finishedJobsKeep: 100,
  finishedJobAgeHours: 24,
};

export function applyRetention(store: RecordStore, now = Date.now()): { events: number; activity: number; jobs: number } {
  if (!(store instanceof SqliteStore)) return { events: 0, activity: 0, jobs: 0 };
  return store.transaction(() => {
    const events = store.trim('events', RETENTION.events);
    const activity = store.trim('activity', RETENTION.activityKeep, new Date(now - RETENTION.activityAgeDays * 86400000).toISOString());
    const cutoff = new Date(now - RETENTION.finishedJobAgeHours * 3600000).toISOString();
    let jobs = 0;
    for (const status of ['completed', 'failed', 'cancelled']) jobs += store.trim('worker_jobs', RETENTION.finishedJobsKeep, cutoff, { status });
    return { events, activity, jobs };
  });
}

/** Runs once now and then periodically; the timer never keeps the process alive. */
export function scheduleRetention(store: RecordStore, log: (message: string) => void = () => {}): () => void {
  const run = () => {
    try {
      const removed = applyRetention(store);
      if (removed.events || removed.activity || removed.jobs) log('retention removed ' + JSON.stringify(removed));
    } catch (error) { log('retention failed: ' + (error instanceof Error ? error.message : 'unknown error')); }
  };
  run();
  const timer = setInterval(run, 30 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
