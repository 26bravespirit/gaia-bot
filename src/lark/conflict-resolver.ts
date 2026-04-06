import { execFileSync, execSync } from 'child_process';
import { readdirSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';

export class ConflictResolver {
  /**
   * Detect and resolve conflicts for a given app's lark-cli subscribe.
   * Returns true if the conflict was resolved (or no conflict found).
   */
  async resolve(appId: string, larkHome: string): Promise<boolean> {
    const locksDir = join(larkHome, '.lark-cli', 'locks');

    if (!existsSync(locksDir)) {
      logger.debug(`ConflictResolver: no locks dir at ${locksDir}`);
      return true;
    }

    const lockFiles = readdirSync(locksDir).filter(f => f.startsWith('subscribe'));
    if (lockFiles.length === 0) {
      logger.debug('ConflictResolver: no subscribe lock files found');
      return true;
    }

    for (const lockFile of lockFiles) {
      const lockPath = join(locksDir, lockFile);
      let pid: number;

      try {
        const content = readFileSync(lockPath, 'utf-8').trim();
        pid = parseInt(content, 10);
        if (isNaN(pid)) {
          logger.warn(`ConflictResolver: invalid PID in ${lockPath}, removing stale lock`);
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        logger.warn(`ConflictResolver: failed to read ${lockPath}, removing`);
        try { unlinkSync(lockPath); } catch { /* ignore */ }
        continue;
      }

      // Never kill ourselves
      if (pid === process.pid) {
        logger.info(`ConflictResolver: PID ${pid} is our own process, removing stale lock ${lockFile}`);
        try { unlinkSync(lockPath); } catch { /* ignore */ }
        continue;
      }

      // Check if process is alive
      if (!this.isProcessAlive(pid)) {
        logger.info(`ConflictResolver: PID ${pid} is dead, removing stale lock ${lockFile}`);
        try { unlinkSync(lockPath); } catch { /* ignore */ }
        continue;
      }

      // Process is alive — determine its manager type
      logger.info(`ConflictResolver: live process PID ${pid} holds lock for subscribe`);

      const launchdLabel = this.findLaunchdLabel(pid);
      if (launchdLabel) {
        // It's a launchd service — bootout (not kill, which triggers KeepAlive respawn)
        logger.info(`ConflictResolver: PID ${pid} is managed by launchd label="${launchdLabel}", booting out`);
        const bootedOut = this.launchdBootout(launchdLabel);
        if (!bootedOut) {
          logger.error(`ConflictResolver: failed to bootout launchd service ${launchdLabel}`);
          return false;
        }
      } else {
        // Regular process — SIGTERM
        logger.info(`ConflictResolver: PID ${pid} is a regular process, sending SIGTERM`);
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          logger.warn(`ConflictResolver: SIGTERM failed for PID ${pid}`);
        }
      }

      // Wait briefly for process to die
      await this.waitForProcessExit(pid, 5000);

      // Clean up lock file
      if (existsSync(lockPath)) {
        try { unlinkSync(lockPath); } catch { /* ignore */ }
      }
    }

    // Phase 2: Kill any orphan subscribe processes for the same appId
    // These may exist without lock files (PM2 respawns, launchd workers, stale orphans)
    await this.killOrphanSubscribes(appId);

    return true;
  }

  /**
   * Scan ps aux for any lark-cli subscribe processes NOT owned by us.
   * This catches orphans from PM2 restarts, launchd workers, or crashed parents.
   */
  private async killOrphanSubscribes(appId: string): Promise<void> {
    try {
      const output = execSync('ps -eo pid,ppid,command', { encoding: 'utf-8', timeout: 5000 });
      const myPid = process.pid;
      const escapedAppId = appId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`lark-cli.*subscribe`);

      for (const line of output.split('\n')) {
        if (!pattern.test(line)) continue;
        if (line.includes('grep')) continue;

        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[0], 10);
        const ppid = parseInt(parts[1], 10);
        if (isNaN(pid)) continue;

        // Skip our own children (ppid === us) or ourselves
        if (pid === myPid || ppid === myPid) continue;

        // Skip if parent is alive and is our process (grandchild — node wrapper → lark-cli binary)
        if (this.isOurDescendant(ppid, myPid)) continue;

        logger.warn(`ConflictResolver: killing orphan subscribe PID ${pid} (parent=${ppid})`);
        try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
      }

      // Brief wait for processes to exit
      await new Promise(r => setTimeout(r, 1000));

      // SIGKILL any survivors
      const output2 = execSync('ps -eo pid,ppid,command', { encoding: 'utf-8', timeout: 5000 });
      for (const line of output2.split('\n')) {
        if (!pattern.test(line)) continue;
        if (line.includes('grep')) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[0], 10);
        const ppid = parseInt(parts[1], 10);
        if (isNaN(pid) || pid === myPid || ppid === myPid) continue;
        if (this.isOurDescendant(ppid, myPid)) continue;
        logger.warn(`ConflictResolver: SIGKILL orphan subscribe PID ${pid}`);
        try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
      }
    } catch (err) {
      logger.warn(`ConflictResolver: orphan scan failed: ${err}`);
    }
  }

  /**
   * Check if a PID is a descendant of targetPid by walking the ppid chain.
   */
  private isOurDescendant(pid: number, targetPid: number): boolean {
    if (pid === targetPid) return true;
    try {
      const output = execSync(`ps -p ${pid} -o ppid=`, { encoding: 'utf-8', timeout: 2000 }).trim();
      const ppid = parseInt(output, 10);
      if (isNaN(ppid) || ppid <= 1) return false;
      return ppid === targetPid || this.isOurDescendant(ppid, targetPid);
    } catch {
      return false;
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Try to find if a PID belongs to a launchd-managed service.
   * Returns the launchd label or null.
   */
  private findLaunchdLabel(pid: number): string | null {
    try {
      // launchctl list outputs: PID\tStatus\tLabel
      const output = execFileSync('launchctl', ['list'], {
        encoding: 'utf-8',
        timeout: 5000,
      });

      for (const line of output.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3 && parts[0] === String(pid)) {
          return parts[2];
        }
      }
    } catch {
      logger.debug('ConflictResolver: failed to query launchctl list');
    }
    return null;
  }

  private launchdBootout(label: string): boolean {
    try {
      const uid = process.getuid?.() ?? 501;
      execSync(`launchctl bootout gui/${uid}/${label}`, {
        timeout: 10000,
        encoding: 'utf-8',
      });
      logger.info(`ConflictResolver: bootout gui/${uid}/${label} succeeded`);
      return true;
    } catch (err) {
      logger.error(`ConflictResolver: bootout failed`, { error: String(err) });
      return false;
    }
  }

  private async waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    const interval = 200;
    while (Date.now() - start < timeoutMs) {
      if (!this.isProcessAlive(pid)) return true;
      await new Promise(r => setTimeout(r, interval));
    }
    // Last resort: SIGKILL
    if (this.isProcessAlive(pid)) {
      logger.warn(`ConflictResolver: PID ${pid} didn't exit in ${timeoutMs}ms, sending SIGKILL`);
      try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, 500));
    }
    return !this.isProcessAlive(pid);
  }
}
