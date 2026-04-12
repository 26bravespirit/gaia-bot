import { logger } from '../utils/logger.js';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function webSearch(query: string, maxResults = 5): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) {
    logger.warn('webSearch: TAVILY_API_KEY not set');
    return [];
  }

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        search_depth: 'basic',
        include_answer: true,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const detail = await response.text();
      logger.error('webSearch: Tavily API error', { status: response.status, detail: detail.slice(0, 200) });
      return [];
    }

    const data = await response.json() as Record<string, unknown>;
    const results = (data.results ?? []) as Array<Record<string, unknown>>;

    // Truncate total snippet content to ~1500 chars to avoid bloating LLM input
    const MAX_TOTAL_SNIPPET = 1500;
    let totalLen = 0;
    const truncated: SearchResult[] = [];
    for (const r of results) {
      const title = (r.title as string) || '';
      const url = (r.url as string) || '';
      let snippet = (r.content as string) || '';
      const remaining = MAX_TOTAL_SNIPPET - totalLen;
      if (remaining <= 0) break;
      if (snippet.length > remaining) snippet = snippet.slice(0, remaining) + '...';
      totalLen += snippet.length;
      truncated.push({ title, url, snippet });
    }
    return truncated;
  } catch (err) {
    logger.error('webSearch failed', { error: String(err) });
    return [];
  }
}
