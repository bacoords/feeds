import { useMemo, useState } from 'react';
import { ArticleDrawerView, WorkspaceView, type WorkspaceActions } from './Workspace';
import { createSampleDashboard } from './sample-data';
import { useThemeChoice } from './Theme';

/** Standalone fixture: deliberately never mounts native auth/query/mutation hooks. */
export default function SamplePreview() {
  const { choice, setChoice } = useThemeChoice();
  const [dashboard, setDashboard] = useState(createSampleDashboard);
  const [state, setState] = useState<'sample' | 'empty' | 'loading' | 'error'>('sample');
  const api = useMemo<WorkspaceActions>(() => ({
    mutateArticle: async ({ id, ...patch }) => { setDashboard(current => ({ ...current, articles: current.articles.map(article => article.id === id ? { ...article, ...patch } : article) })); },
    addSource: async () => { throw new Error('Source changes are not saved in this preview. Return to Feeds to manage your account.'); },
    updateSource: async () => { throw new Error('Fetching stays disabled in the sample preview.'); },
    deleteSource: async ({ id }) => { setDashboard(current => ({ ...current, sources: current.sources.filter(source => source.id !== id), articles: current.articles.filter(article => article.sourceId !== id) })); },
    refreshSource: async () => { throw new Error('No network requests run in the sample preview.'); },
    seedDemo: async () => { setDashboard(createSampleDashboard()); setState('sample'); },
    importOpml: async () => { throw new Error('This preview cannot import into an account. Return to Feeds to save an import.'); },
    signOut: async () => { window.location.assign('/'); },
  }), []);
  const shown = state === 'empty' ? { ...dashboard, articles: [], sources: [] } : state === 'loading' ? undefined : dashboard;
  return <>
    <WorkspaceView displayName="Sample reader" dashboard={shown} actions={api} demo renderDrawer={props => <ArticleDrawerView key={props.article.id} {...props} detail={state === 'error' ? null : dashboard.articles.find(article => article.id === props.article.id)} error={state === 'error' ? 'Sample error: this article is unavailable. No account data was changed.' : props.error} />} />
    <details className="sample-preview-tools"><summary>Sample preview settings</summary><section className="sample-controls" aria-label="Sample preview controls">
      <strong>UI test preview</strong>
      <label>Theme <select value={choice} onChange={event => setChoice(event.target.value as typeof choice)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <label>Reader state <select value={state} onChange={event => setState(event.target.value as typeof state)}><option value="sample">Sample articles</option><option value="empty">Empty reader</option><option value="loading">Loading</option><option value="error">Article error</option></select></label>
      <button onClick={() => { setDashboard(createSampleDashboard()); setState('sample'); }}>Reset preview</button>
      <a href="/">Exit preview</a>
    </section></details>

  </>;
}
