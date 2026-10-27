import type { Dashboard } from './types';

/** Public synthetic QA data. Never a snapshot of an account or a fetched feed. */
export function createSampleDashboard(): Dashboard {
  const sources = [
    { id: 'preview-design', title: 'Design notes — sample', url: 'https://example.com/design.xml', folder: 'Design / Reading', enabled: false, nextPollAt: 0, lastAttemptAt: 0, lastSuccessAt: 0, error: '', jobStatus: 'demo' },
    { id: 'preview-web', title: 'The open web — sample', url: 'https://example.org/feed.xml', folder: 'Technology', enabled: false, nextPollAt: 0, lastAttemptAt: 0, lastSuccessAt: 0, error: '', jobStatus: 'demo' },
  ];
  return {
    sources, workerConfigured: false,
    articles: Array.from({ length: 45 }, (_, index) => ({
      id: `preview-${index}`, sourceId: sources[index % 2].id, sourceTitle: sources[index % 2].title,
      title: index === 0 ? 'A long sample headline about making room for thoughtful reading on the smallest screens' : `${index + 1}. ${index % 2 ? 'Building a more readable web' : 'Small details that make a reading space feel right'}`,
      url: '', author: 'Sample author', publishedAt: new Date(Date.UTC(2026, 9, 24, 12, 0) - index * 3600000).toISOString(),
      bodyText: `This is synthetic sample article ${index + 1}, created only to test the reader. It was not fetched from a website or copied from an account.\n\n` + 'Readable interfaces should keep text, actions, and navigation within reach. Scroll this panel to check the toolbar, close control, and article ending. '.repeat(index === 0 ? 60 : 12),
      read: index % 4 === 3, starred: index % 7 === 0,
    })),
  };
}
