import { webSearch } from './web-search.js';
import { readUrl } from './read-url.js';
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

    default:
      return JSON.stringify({ error: `未知工具: ${name}` });
  }
}

/** Tool definitions for OpenAI Responses API */
export const TOOL_DEFINITIONS = [
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
