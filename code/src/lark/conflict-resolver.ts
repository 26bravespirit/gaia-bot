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

    return true;
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
