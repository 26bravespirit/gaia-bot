import { webSearch } from './web-search.js';
import { readUrl } from './read-url.js';
import { calendarAgenda, calendarCreateEvent, calendarFreeBusy, calendarSuggestTime, calendarRsvp, calendarUpdateEvent } from './calendar.js';
import { logger } from '../utils/logger.js';

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  logger.info(`tool: executing ${name}`, { args });

  switch (name) {
    case 'web_search': {
      const query = String(args.query ?? '');
      const maxResults = typeof args.max_results === 'number' ? args.max_results : 5;
      const results = await webSearch(query, maxResults);
      if (results.length === 0) return JSON.stringify({ error: '搜索无结果' });
      return JSON.stringify(results);
    }

    case 'read_url': {
      const url = String(args.url ?? '');
      if (!url) return JSON.stringify({ error: '缺少 url 参数' });
      const content = await readUrl(url);
      return JSON.stringify(content);
    }

    case 'calendar_agenda': {
      const start = args.start ? String(args.start) : undefined;
      const end = args.end ? String(args.end) : undefined;
      return JSON.stringify(calendarAgenda(start, end));
    }

    case 'calendar_create_event': {
      const summary = String(args.summary ?? '');
      const start = String(args.start ?? '');
      const end = String(args.end ?? '');
      const description = args.description ? String(args.description) : undefined;
      const attendeeIds = args.attendee_ids ? String(args.attendee_ids) : undefined;
      return JSON.stringify(calendarCreateEvent(summary, start, end, description, attendeeIds));
    }

    case 'calendar_free_busy': {
      const start = args.start ? String(args.start) : undefined;
      const end = args.end ? String(args.end) : undefined;
      const userId = args.user_id ? String(args.user_id) : undefined;
      return JSON.stringify(calendarFreeBusy(start, end, userId));
    }

    case 'calendar_suggest_time': {
      const attendeeIds = String(args.attendee_ids ?? '');
      const duration = typeof args.duration_minutes === 'number' ? args.duration_minutes : 30;
      const start = args.start ? String(args.start) : undefined;
      const end = args.end ? String(args.end) : undefined;
      return JSON.stringify(calendarSuggestTime(attendeeIds, duration, start, end));
    }

    case 'calendar_rsvp': {
      const eventId = String(args.event_id ?? '');
      const status = String(args.status ?? '');
      return JSON.stringify(calendarRsvp(eventId, status));
    }

    case 'calendar_update_event': {
      const eventId = String(args.event_id ?? '');
      const action = String(args.action ?? 'update');
      return JSON.stringify(calendarUpdateEvent(eventId, action, {
        summary: args.summary ? String(args.summary) : undefined,
        start: args.start ? String(args.start) : undefined,
        end: args.end ? String(args.end) : undefined,
        description: args.description ? String(args.description) : undefined,
      }));
    }

    default:
      return JSON.stringify({ error: `未知工具: ${name}` });
  }
}

/** Tool definitions for OpenAI Responses API */
export const SEARCH_TOOLS = [
  {
    type: 'function' as const,
    name: 'web_search',
    description: '搜索互联网获取实时信息。仅在用户明确要求搜索时使用。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        max_results: { type: 'number', description: '最大结果数，默认5' },
      },
      required: ['query'],
    },
  },
  {
    type: 'function' as const,
    name: 'read_url',
    description: '读取指定网页的文本内容。仅在用户提供了具体 URL 并要求查看时使用。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要读取的网页 URL' },
      },
      required: ['url'],
    },
  },
];

export const CALENDAR_TOOLS = [
  {
    type: 'function' as const,
    name: 'calendar_agenda',
    description: '查看日历日程安排。用户问到"今天有什么会""明天的安排""这周日程"时使用。',
    parameters: {
      type: 'object',
      properties: {
        start: { type: 'string', description: '起始时间 ISO 8601，默认今天' },
        end: { type: 'string', description: '结束时间 ISO 8601，默认当天结束' },
      },
      required: [],
    },
  },
  {
    type: 'function' as const,
    name: 'calendar_create_event',
    description: '创建日历日程并可邀请参会人。用户要求"帮我约""创建会议""安排一个"时使用。',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '日程标题' },
        start: { type: 'string', description: '开始时间 ISO 8601' },
        end: { type: 'string', description: '结束时间 ISO 8601' },
        description: { type: 'string', description: '日程描述（可选）' },
        attendee_ids: { type: 'string', description: '参会人ID逗号分隔 ou_/oc_/omm_（可选）' },
      },
      required: ['summary', 'start', 'end'],
    },
  },
  {
    type: 'function' as const,
    name: 'calendar_free_busy',
    description: '查询忙闲状态。用户问"我下午有空吗""XX什么时候有空"时使用。',
    parameters: {
      type: 'object',
      properties: {
        start: { type: 'string', description: '查询起始时间 ISO 8601' },
        end: { type: 'string', description: '查询结束时间 ISO 8601' },
        user_id: { type: 'string', description: '目标用户 open_id（可选，默认自己）' },
      },
      required: [],
    },
  },
  {
    type: 'function' as const,
    name: 'calendar_suggest_time',
    description: '为多人找空闲会议时间。用户要求"找个时间""什么时候大家都有空"时使用。',
    parameters: {
      type: 'object',
      properties: {
        attendee_ids: { type: 'string', description: '参会人ID逗号分隔' },
        duration_minutes: { type: 'number', description: '会议时长（分钟）' },
        start: { type: 'string', description: '搜索起始时间 ISO 8601' },
        end: { type: 'string', description: '搜索结束时间 ISO 8601' },
      },
      required: ['attendee_ids', 'duration_minutes'],
    },
  },
  {
    type: 'function' as const,
    name: 'calendar_rsvp',
    description: '回复日历邀请（接受/拒绝/待定）。用户说"接受那个会""拒绝""那个会我可能去"时使用。',
    parameters: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: '日程 event_id' },
        status: { type: 'string', description: 'accept | decline | tentative' },
      },
      required: ['event_id', 'status'],
    },
  },
  {
    type: 'function' as const,
    name: 'calendar_update_event',
    description: '修改或删除日程。用户要求"改时间""取消会议""改标题"时使用。',
    parameters: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: '日程 event_id' },
        action: { type: 'string', description: '"update" 或 "delete"' },
        summary: { type: 'string', description: '新标题（可选）' },
        start: { type: 'string', description: '新开始时间 ISO 8601（可选）' },
        end: { type: 'string', description: '新结束时间 ISO 8601（可选）' },
        description: { type: 'string', description: '新描述（可选）' },
      },
      required: ['event_id', 'action'],
    },
  },
];

export const ALL_TOOLS = [...SEARCH_TOOLS, ...CALENDAR_TOOLS];
