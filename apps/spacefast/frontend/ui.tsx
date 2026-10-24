import { Icon, rss } from '@wordpress/icons';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export function Brand() {
  return <div className="brand"><Icon icon={rss} size={26} /><span>Feeds</span><span className="prototype-label">Prototype</span></div>;
}


/** React escapes feed text; this component deliberately never accepts HTML. */
export function ArticleBody({ text }: { text: string }) {
  return <div className="article-body">{text || 'This feed did not include article text. Open the original article to keep reading.'}</div>;
}
