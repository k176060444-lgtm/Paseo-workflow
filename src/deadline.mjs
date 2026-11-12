// A wall-clock deadline also bounds promises that ignore an SDK timeout.
// Expiry never means a remote mutation was rejected or terminated.
export async function withDeadline(operation, ms, label) {
  if (!Number.isFinite(ms) || ms <= 0) throw new Error('invalid deadline: '+label);
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('P0 deadline exceeded: '+label+'; outcome UNKNOWN');
      error.code = 'P0_DEADLINE';
      reject(error);
      controller.abort();
    }, ms);
  });
  try { return await Promise.race([Promise.resolve().then(()=>operation(controller.signal)), expired]); }
  finally { clearTimeout(timer); }
}
