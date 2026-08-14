/**
 * Resolve to the first task that produces an id — not the first task to answer.
 *
 * Promise.race is the wrong tool here: it settles on whichever promise returns
 * soonest even when that answer is "no idea", and a source that reliably says
 * "no idea" quickly would then veto the slower source that actually knows.
 * Awaiting the sources in sequence is equally wrong in the other direction: a
 * source that hangs makes every lookup wait out its timeout before the useful
 * one is even started.
 *
 * So: run them all at once, take the first non-empty answer, and only give up
 * once every source has come back empty. Rejections count as empty.
 */
export function firstId(tasks: Promise<string | null>[]): Promise<string | null> {
  if (tasks.length === 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    let left = tasks.length;
    let settled = false;
    for (const t of tasks) {
      t.catch(() => null).then((id) => {
        if (settled) return;
        if (id) {
          settled = true;
          resolve(id);
        } else if (--left === 0) {
          resolve(null);
        }
      });
    }
  });
}
