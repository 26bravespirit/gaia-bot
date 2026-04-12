import { execFileSync } from 'child_process';
import { logger } from '../utils/logger.js';

/** Commands that support --format flag */
const FORMAT_SUPPORTED = new Set(['+agenda', '+freebusy', '+suggestion']);

function runCalendarCmd(args: string[]): Record<string, unknown> {
  const binary = process.env.LARK_CLI_BIN || '/opt/homebrew/bin/lark-cli';
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  env.PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin';
  if (process.env.LARK_HOME) env.HOME = process.env.LARK_HOME;

  const fullArgs = ['calendar', ...args, '--as', 'user'];
  // Only add --format json for commands that support it
  if (args.length > 0 && FORMAT_SUPPORTED.has(args[0])) {
    fullArgs.push('--format', 'json');
  }
  logger.debug('calendar cmd', { args: fullArgs });

  const output = execFileSync(binary, fullArgs, {
    encoding: 'utf-8',
    timeout: 15000,
    env,
  });
  return JSON.parse(output);
}

/** 查看日程安排 */
export function calendarAgenda(start?: string, end?: string): Record<string, unknown> {
  try {
    const args = ['+agenda'];
    if (start) args.push('--start', start);
    if (end) args.push('--end', end);
    const result = runCalendarCmd(args);
    if (!result.ok) return { error: result.error || '查询日程失败' };

    const events = (result.data ?? []) as Array<Record<string, unknown>>;
    return {
      count: events.length,
      events: events.map(e => ({
        event_id: e.event_id,
        summary: e.summary,
        start: (e.start_time as Record<string, unknown>)?.datetime ?? e.start_time,
        end: (e.end_time as Record<string, unknown>)?.datetime ?? e.end_time,
        organizer: (e.event_organizer as Record<string, unknown>)?.display_name,
        status: e.self_rsvp_status,
        location: e.location,
      })),
    };
  } catch (err) {
    logger.error('calendarAgenda failed', { error: String(err) });
    return { error: String(err) };
  }
}

/** 创建日程 */
export function calendarCreateEvent(
  summary: string, start: string, end: string,
  description?: string, attendeeIds?: string,
): Record<string, unknown> {
  try {
    const args = ['+create', '--summary', summary, '--start', start, '--end', end];
    if (description) args.push('--description', description);
    if (attendeeIds) args.push('--attendee-ids', attendeeIds);
    const result = runCalendarCmd(args);
    if (!result.ok) return { error: result.error || '创建日程失败' };
    return { ok: true, data: result.data };
  } catch (err) {
    logger.error('calendarCreateEvent failed', { error: String(err) });
    return { error: String(err) };
  }
}

/** 查询忙闲 */
export function calendarFreeBusy(start?: string, end?: string, userId?: string): Record<string, unknown> {
  try {
    const args = ['+freebusy'];
    if (start) args.push('--start', start);
    if (end) args.push('--end', end);
    if (userId) args.push('--user-id', userId);
    const result = runCalendarCmd(args);
    if (!result.ok) return { error: result.error || '查询忙闲失败' };
    return { ok: true, data: result.data };
  } catch (err) {
    logger.error('calendarFreeBusy failed', { error: String(err) });
    return { error: String(err) };
  }
}

/** 推荐会议时间 */
export function calendarSuggestTime(
  attendeeIds: string, durationMinutes: number,
  start?: string, end?: string,
): Record<string, unknown> {
  try {
    const args = ['+suggestion', '--attendee-ids', attendeeIds, '--duration-minutes', String(durationMinutes)];
    if (start) args.push('--start', start);
    if (end) args.push('--end', end);
    const result = runCalendarCmd(args);
    if (!result.ok) return { error: result.error || '推荐时间失败' };
    return { ok: true, data: result.data };
  } catch (err) {
    logger.error('calendarSuggestTime failed', { error: String(err) });
    return { error: String(err) };
  }
}

/** 回复日程邀请 */
export function calendarRsvp(eventId: string, status: string): Record<string, unknown> {
  try {
    const args = ['+rsvp', '--event-id', eventId, '--rsvp-status', status];
    const result = runCalendarCmd(args);
    if (!result.ok) return { error: result.error || '回复邀请失败' };
    return { ok: true, event_id: eventId, status };
  } catch (err) {
    logger.error('calendarRsvp failed', { error: String(err) });
    return { error: String(err) };
  }
}

/** 修改或删除日程 */
export function calendarUpdateEvent(
  eventId: string, action: string,
  patches?: { summary?: string; start?: string; end?: string; description?: string },
): Record<string, unknown> {
  try {
    const binary = process.env.LARK_CLI_BIN || '/opt/homebrew/bin/lark-cli';
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    env.PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin';
    if (process.env.LARK_HOME) env.HOME = process.env.LARK_HOME;

    if (action === 'delete') {
      const output = execFileSync(binary, [
        'calendar', 'events', 'delete',
        '--as', 'user',
        '--params', JSON.stringify({ calendar_id: 'primary', event_id: eventId }),
      ], { encoding: 'utf-8', timeout: 15000, env });
      const result = JSON.parse(output);
      return result.ok !== false ? { ok: true, action: 'deleted', event_id: eventId } : { error: result.error || '删除失败' };
    }

    // Update (patch)
    const data: Record<string, unknown> = {};
    if (patches?.summary) data.summary = patches.summary;
    if (patches?.description) data.description = patches.description;
    if (patches?.start) data.start_time = { datetime: patches.start, timezone: 'Asia/Shanghai' };
    if (patches?.end) data.end_time = { datetime: patches.end, timezone: 'Asia/Shanghai' };

    const output = execFileSync(binary, [
      'calendar', 'events', 'patch',
      '--as', 'user',
      '--params', JSON.stringify({ calendar_id: 'primary', event_id: eventId }),
      '--data', JSON.stringify(data),
    ], { encoding: 'utf-8', timeout: 15000, env });
    const result = JSON.parse(output);
    return result.ok !== false ? { ok: true, action: 'updated', event_id: eventId } : { error: result.error || '更新失败' };
  } catch (err) {
    logger.error('calendarUpdateEvent failed', { error: String(err) });
    return { error: String(err) };
  }
}
