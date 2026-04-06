import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { logger } from './logger.js';

const PID_FILE = resolve(import.meta.dirname || '.', '../../data/persona-bot.pid');

/**
 * Ensure only one instance of persona-bot is running.
 * If an old instance exists, kill it and its entire process tree.
 */
export function acquirePidLock(): void {
  if (existsSync(PID_FILE)) {
    const oldPid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    if (oldPid && isProcessAlive(oldPid)) {
      logger.warn(`Found running instance (PID ${oldPid}), killing it...`);
      killProcessTree(oldPid);
      // Wait for it to die
      for (let i = 0; i < 10; i++) {
        if (!isProcessAlive(oldPid)) break;
        execSync('sleep 0.5');
      }
      if (isProcessAlive(oldPid)) {
        logger.error(`Failed to kill old instance PID ${oldPid}`);
        process.exit(1);
      }
      logger.info(`Old instance PID ${oldPid} stopped`);
    }
  }

  // Kill any stale persona-bot processes (covers old code without PID lock)
  killStaleInstances();

  // Write our PID
  writeFileSync(PID_FILE, String(process.pid));
  logger.info(`PID lock acquired: ${process.pid}`);
}

/**
 * Release the PID lock on shutdown.
 */
export function releasePidLock(): void {
  try {
    if (existsSync(PID_FILE)) {
      const storedPid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
      // Only remove if it's our PID (another instance might have taken over)
      if (storedPid === process.pid) {
        unlinkSync(PID_FILE);
      }
    }
  } catch {
    // ignore
  }
}

/**
 * Kill any other node processes running dist/index.js in the same project directory.
 * This catches old-version processes that don't have PID lock mechanism.
 */
function killStaleInstances(): void {
  try {
    const output = execSync('ps aux', { encoding: 'utf-8', timeout: 5000 });
    const myPid = process.pid;
    for (const line of output.split('\n')) {
      if (!line.includes('dist/index.js')) continue;
      if (line.includes('grep')) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[1], 10);
      if (pid === myPid || isNaN(pid)) continue;
      // Check if it's the same project by looking for our data dir in its cwd
      try {
        const lsofOut = execSync(`lsof -p ${pid} 2>/dev/null | grep cwd`, { encoding: 'utf-8', timeout: 3000 });
        if (lsofOut.includes('gaia-bot') || lsofOut.includes('persona-bot')) {
          logger.warn(`killStaleInstances: found stale process PID ${pid}, killing`);
          killProcessTree(pid);
        }
      } catch { /* ignore lsof errors */ }
    }
  } catch {
    // Non-fatal: best effort cleanup
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill an entire process tree (parent + all children).
 * macOS doesn't have pkill --signal -P, so we find children manually.
 */
function killProcessTree(pid: number): void {
  try {
    // Find all child processes recursively
    const children = findChildren(pid);

    // Kill children first (deepest first), then parent
    for (const childPid of children.reverse()) {
      try { process.kill(childPid, 'SIGTERM'); } catch { /* already dead */ }
    }
    try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }

    // Wait 2 seconds, then SIGKILL any survivors
    setTimeout(() => {
      for (const childPid of [...children, pid]) {
        if (isProcessAlive(childPid)) {
          try { process.kill(childPid, 'SIGKILL'); } catch { /* already dead */ }
        }
      }
    }, 2000);
  } catch {
    // Fallback: just kill the main PID
    try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
  }
}

function findChildren(parentPid: number): number[] {
  try {
    const output = execSync(`ps -eo pid,ppid`, { encoding: 'utf-8' });
    const children: number[] = [];
    const queue = [parentPid];

    while (queue.length > 0) {
      const parent = queue.shift()!;
      for (const line of output.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const childPid = parseInt(parts[0], 10);
          const ppid = parseInt(parts[1], 10);
          if (ppid === parent && childPid !== parentPid && !children.includes(childPid)) {
            children.push(childPid);
            queue.push(childPid);
          }
        }
      }
    }

    return children;
  } catch {
    return [];
  }
}
