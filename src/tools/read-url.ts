import { convert } from 'html-to-text';
import { logger } from '../utils/logger.js';

export interface UrlContent {
  title: string;
  content: string;
}

export async function readUrl(url: string): Promise<UrlContent> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GaiaBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });

    if (!response.ok) {
      return { title: '', content: `[HTTP ${response.status}] 无法访问该网页` };
    }

    const html = await response.text();

    // Extract <title>
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch?.[1]?.trim() ?? '';

    // Convert HTML to plain text
    const text = convert(html, {
      wordwrap: false,
      selectors: [
        { selector: 'img', format: 'skip' },
        { selector: 'script', format: 'skip' },
        { selector: 'style', format: 'skip' },
        { selector: 'nav', format: 'skip' },
        { selector: 'footer', format: 'skip' },
        { selector: 'header', format: 'skip' },
        { selector: 'a', options: { ignoreHref: true } },
      ],
    });

    // Truncate to 2000 chars
    const content = text.slice(0, 2000).trim();

    return { title, content };
  } catch (err) {
    logger.error('readUrl failed', { url, error: String(err) });
    return { title: '', content: `[错误] 无法读取网页: ${String(err)}` };
  }
}
