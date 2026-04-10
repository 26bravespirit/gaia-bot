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

    return results.map(r => ({
      title: (r.title as string) || '',
      url: (r.url as string) || '',
      snippet: (r.content as string) || '',
    }));
  } catch (err) {
    logger.error('webSearch failed', { error: String(err) });
    return [];
  }
}
