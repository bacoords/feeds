import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Modal, Notice, Spinner, TextControl, ToggleControl } from '@wordpress/components';
import { DataViews, filterSortAndPaginate, type Action, type Field, type View } from '@wordpress/dataviews';
import { Icon, rss, starEmpty, starFilled, plus, cog, listView, unseen, seen, update, trash, external } from '@wordpress/icons';
import { signOut, useMutation, useQuery } from '@spacefast/zero/react';
import { applyArticleState, articlesInScope, dateLabel, safeExternalUrl, sourceStatus } from './state';
import { ArticleBody, Brand, errorMessage } from './ui';
import type { Article, ArticleState, Dashboard, ReaderScope, Source } from './types';

const DEFAULT_VIEW: View = {
  type: 'list', page: 1, perPage: 20, search: '', filters: [],
  sort: { field: 'publishedAt', direction: 'desc' },
  fields: ['sourceTitle', 'publishedAt', 'read', 'starred'],
  titleField: 'title', descriptionField: 'excerpt',
};

export default function Workspace({ displayName }: { displayName: string }) {
  const dashboard = useQuery<Dashboard>('dashboard');
  const mutateArticle = useMutation<[{ id: string } & ArticleState]>('setArticleState');
  const addSource = useMutation<[{ title: string; url: string; folder: string }]>('addSource');
  const updateSource = useMutation<[{ id: string; enabled: boolean }]>('updateSource');
  const deleteSource = useMutation<[{ id: string }]>('deleteSource');
  const refreshSource = useMutation<[{ id: string }]>('refreshSource');
  const seedDemo = useMutation<[Record<string, never>]>('seedDemo');
  const [tab, setTab] = useState<'reader' | 'sources'>('reader');
  const [scope, setScope] = useState<ReaderScope>('all');
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Source | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [pending, setPending] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const [overrides, setOverrides] = useState<Record<string, ArticleState>>({});
  const [loadingDelayed, setLoadingDelayed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (dashboard !== undefined) { setLoadingDelayed(false); return; }
    const timer = window.setTimeout(() => setLoadingDelayed(true), 15000);
    return () => window.clearTimeout(timer);
  }, [dashboard]);

  useEffect(() => {
    if (!dashboard) return;
    setOverrides((current) => {
      const next = { ...current };
      let changed = false;
      for (const [id, patch] of Object.entries(current)) {
        const article = dashboard.articles.find((item) => item.id === id);
        if (!article || ((patch.read === undefined || patch.read === article.read) && (patch.starred === undefined || patch.starred === article.starred))) {
          delete next[id]; changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [dashboard]);

  const articles = useMemo(() => (dashboard?.articles ?? []).map((article) => applyArticleState(article, overrides[article.id] ?? {})), [dashboard, overrides]);
  const sources = dashboard?.sources ?? [];
  const selected = articles.find((article) => article.id === selectedId);
  const unreadCount = articles.filter((article) => !article.read).length;
  const starredCount = articles.filter((article) => article.starred).length;
  const workerConfigured = dashboard?.workerConfigured === true;
  const activeSource = scope.startsWith('source:') ? sources.find((source) => source.id === scope.slice(7)) : undefined;
  const heading = tab === 'sources' ? 'Manage sources' : activeSource?.title ?? ({ all: 'All articles', unread: 'Unread', starred: 'Starred' }[scope as 'all' | 'unread' | 'starred'] || 'All articles');

  const run = useCallback(async (key: string, task: () => Promise<unknown>, message?: string) => {
    if (pendingRef.current.has(key)) return false;
    pendingRef.current.add(key); setPending(new Set(pendingRef.current)); setError(''); setSuccess('');
    try { await task(); if (message) setSuccess(message); return true; }
    catch (caught) { setError(errorMessage(caught)); return false; }
    finally { pendingRef.current.delete(key); setPending(new Set(pendingRef.current)); }
  }, []);

  const changeArticle = useCallback(async (article: Article, patch: ArticleState) => {
    const key = `article:${article.id}`;
    if (pendingRef.current.has(key)) return;
    const previous = overrides[article.id];
    setOverrides((current) => ({ ...current, [article.id]: { ...current[article.id], ...patch } }));
    const ok = await run(key, () => mutateArticle({ id: article.id, ...patch }));
    if (!ok) setOverrides((current) => { const next = { ...current }; if (previous) next[article.id] = previous; else delete next[article.id]; return next; });
  }, [mutateArticle, overrides, run]);

  function navigate(nextScope: ReaderScope) {
    setScope(nextScope); setTab('reader'); setView((current) => ({ ...current, page: 1, filters: [], search: '' })); setSidebarOpen(false);
  }

  const fields = useMemo<Field<Article>[]>(() => [
    { id: 'title', label: 'Article', enableGlobalSearch: true, enableHiding: false, render: ({ item }) => <span className={`article-title ${item.read ? 'is-read' : ''}`}>{!item.read && <span className="unread-dot" aria-label="Unread" />}{item.title || 'Untitled article'}</span> },
    { id: 'excerpt', label: 'Excerpt', getValue: ({ item }) => item.bodyText.slice(0, 180), enableGlobalSearch: true, enableSorting: false, filterBy: false, render: ({ item }) => <span className="article-excerpt">{item.bodyText.slice(0, 180) || 'Open this article to read more.'}</span> },
    { id: 'sourceTitle', label: 'Source', enableGlobalSearch: true, elements: sources.map((source) => ({ value: source.title, label: source.title })), render: ({ item }) => <span className="article-source">{item.sourceTitle}</span> },
    { id: 'publishedAt', label: 'Published', getValue: ({ item }) => item.publishedAt ? new Date(item.publishedAt).getTime() : 0, render: ({ item }) => <span className="article-date">{dateLabel(item.publishedAt)}</span>, filterBy: false },
    { id: 'read', label: 'Read status', type: 'boolean', elements: [{ value: false, label: 'Unread' }, { value: true, label: 'Read' }], filterBy: { operators: ['is'] }, render: ({ item }) => <span className="text-status">{item.read ? 'Read' : 'Unread'}</span> },
    { id: 'starred', label: 'Star status', type: 'boolean', elements: [{ value: true, label: 'Starred' }, { value: false, label: 'Not starred' }], filterBy: { operators: ['is'] }, render: ({ item }) => <span className={item.starred ? 'starred-status' : 'muted'}>{item.starred ? 'Starred' : '—'}</span> },
    { id: 'author', label: 'Author', enableGlobalSearch: true },
  ], [sources]);
  const actions = useMemo<Action<Article>[]>(() => [
    { id: 'read-article', label: 'Open article', icon: external, isPrimary: true, callback: ([article]) => setSelectedId(article.id) },
    { id: 'toggle-read', label: ([article]) => article?.read ? 'Mark unread' : 'Mark read', icon: seen, isEligible: (article) => !pending.has(`article:${article.id}`), callback: ([article]) => void changeArticle(article, { read: !article.read }) },
    { id: 'toggle-star', label: ([article]) => article?.starred ? 'Remove star' : 'Star article', icon: starEmpty, isEligible: (article) => !pending.has(`article:${article.id}`), callback: ([article]) => void changeArticle(article, { starred: !article.starred }) },
  ], [changeArticle, pending]);
  const scopedArticles = articlesInScope(articles, scope);
  const { data, paginationInfo } = filterSortAndPaginate(scopedArticles, view, fields);
  // A mutation or filter can remove the last item on the current page.
  useEffect(() => {
    if ((view.page ?? 1) > Math.max(1, paginationInfo.totalPages)) setView((current) => ({ ...current, page: Math.max(1, paginationInfo.totalPages) }));
  }, [paginationInfo.totalPages, view.page]);

  const folders = [...new Set(sources.map((source) => source.folder || 'Your sources'))].sort();
  return <div className={`app-shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
    <a className="skip-link" href="#main-content">Skip to articles</a>
    <aside className="sidebar" aria-label="Reading navigation">
      <div className="sidebar-brand"><Brand /></div>
      <nav aria-label="Library">
        <NavItem label="All articles" icon={listView} active={tab === 'reader' && scope === 'all'} count={articles.length} onClick={() => navigate('all')} />
        <NavItem label="Unread" icon={unseen} active={tab === 'reader' && scope === 'unread'} count={unreadCount} onClick={() => navigate('unread')} />
        <NavItem label="Starred" icon={starEmpty} active={tab === 'reader' && scope === 'starred'} count={starredCount} onClick={() => navigate('starred')} />
      </nav>
      <div className="sidebar-sources"><div className="sidebar-section-heading"><span>Sources</span><Button icon={plus} label="Add a source" onClick={() => setAddOpen(true)} disabled={!dashboard || sources.length >= 25} /></div>
        {!sources.length && <p className="sidebar-empty">Your favorite sites belong here.</p>}
        {folders.map((folder) => <div className="source-group" key={folder}><p className="source-folder">{folder}</p>{sources.filter((source) => (source.folder || 'Your sources') === folder).map((source) => <button key={source.id} className={`source-nav ${tab === 'reader' && scope === `source:${source.id}` ? 'is-active' : ''}`} onClick={() => navigate(`source:${source.id}`)} aria-current={tab === 'reader' && scope === `source:${source.id}` ? 'page' : undefined}><span className="source-initial" aria-hidden="true">{source.title.slice(0, 1).toUpperCase()}</span><span>{source.title}</span><span className="nav-count">{articles.filter((article) => article.sourceId === source.id && !article.read).length}</span></button>)}</div>)}
      </div>
      <div className="sidebar-bottom"><NavItem label="Manage sources" icon={cog} active={tab === 'sources'} onClick={() => { setTab('sources'); setSidebarOpen(false); }} /><div className="account-bar"><span className="account-avatar" aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span><span title={displayName}>{displayName}</span><Button variant="tertiary" disabled={pending.has('signout')} onClick={() => void run('signout', () => signOut({ returnTo: window.location.href }))}>Sign out</Button></div></div>
    </aside>
    <main className="workspace" id="main-content" tabIndex={-1}>
      <header className="workspace-header"><div><Button className="mobile-nav-toggle" icon={listView} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}>Library</Button><p className="workspace-kicker">Your reading space</p><h1>{heading}</h1><p className="workspace-subtitle">{tab === 'sources' ? `${sources.length} ${sources.length === 1 ? 'source' : 'sources'} · Organized your way` : `${scopedArticles.length} ${scopedArticles.length === 1 ? 'article' : 'articles'} · ${unreadCount} unread in your library`}</p></div><Button variant="primary" icon={plus} __next40pxDefaultSize onClick={() => setAddOpen(true)} disabled={!dashboard || sources.length >= 25}>Add source</Button></header>
      <div className="notice-stack" aria-live="polite">{error && <Notice status="error" onRemove={() => setError('')}>{error}</Notice>}{success && <Notice status="success" onRemove={() => setSuccess('')}>{success}</Notice>}{dashboard && !workerConfigured && <Notice status="warning" isDismissible={false}><strong>Live feeds aren’t connected yet.</strong> You can organize sources and try sample articles. A feed worker must be configured before sources can refresh.</Notice>}</div>
      {!dashboard ? <div className="loading-state" aria-live="polite" aria-busy={!loadingDelayed}>{!loadingDelayed && <Spinner />}<h2>{loadingDelayed ? 'Your library is taking longer to load' : 'Loading your library'}</h2><p>{loadingDelayed ? 'The connection may be unavailable. Your saved articles are unchanged.' : 'Fetching your sources and reading history.'}</p>{loadingDelayed && <Button variant="secondary" onClick={() => window.location.reload()}>Reload and retry</Button>}</div> : tab === 'sources' ? <SourceManager sources={sources} workerConfigured={workerConfigured} pending={pending} onAdd={() => setAddOpen(true)} onToggle={(source) => void run(`source:${source.id}`, () => updateSource({ id: source.id, enabled: !source.enabled }), source.enabled ? 'Source paused.' : 'Source enabled.')} onRefresh={(source) => void run(`source:${source.id}`, () => refreshSource({ id: source.id }), 'Refresh queued. The worker will fetch this source.')} onDelete={setRemoveTarget} /> : !articles.length ? <EmptyLibrary onAdd={() => setAddOpen(true)} onDemo={() => void run('demo', () => seedDemo({}), 'Sample articles added. These are demo content, not live feed results.')} demoPending={pending.has('demo')} hasSources={sources.length > 0} /> : <section className="reader-surface" aria-label="Articles"><DataViews<Article> data={data} fields={fields} view={view} onChangeView={setView} actions={actions} paginationInfo={paginationInfo} defaultLayouts={{ list: {}, table: { layout: { density: 'comfortable' } } }} onClickItem={(article) => setSelectedId(article.id)} isItemClickable={() => true} searchLabel="Search articles" empty={<div className="empty-filter"><h2>No articles match this view</h2><p>Try another search or clear your filters.</p><Button variant="secondary" onClick={() => { setView(DEFAULT_VIEW); setScope('all'); }}>Show all articles</Button></div>} /></section>}
      <footer className="workspace-footer">Feeds web prototype<span>Up to 200 recent articles · 25 sources per account</span></footer>
    </main>
    {addOpen && <AddSourceModal workerConfigured={workerConfigured} pending={pending.has('add')} onClose={() => setAddOpen(false)} onSubmit={async (values) => { const ok = await run('add', () => addSource(values), workerConfigured ? 'Source added.' : 'Source saved as paused. Connect a worker to start fetching.'); if (ok) setAddOpen(false); return ok; }} />}
    {removeTarget && <Modal title="Remove this source?" onRequestClose={() => { if (!pending.has(`source:${removeTarget.id}`)) setRemoveTarget(null); }} className="compact-modal"><p><strong>{removeTarget.title}</strong> and its stored articles will be removed from your library. This cannot be undone.</p><div className="modal-actions"><Button variant="tertiary" disabled={pending.has(`source:${removeTarget.id}`)} onClick={() => setRemoveTarget(null)}>Cancel</Button><Button variant="primary" isDestructive isBusy={pending.has(`source:${removeTarget.id}`)} disabled={pending.has(`source:${removeTarget.id}`)} onClick={async () => { const id = removeTarget.id; const ok = await run(`source:${id}`, () => deleteSource({ id }), 'Source removed.'); if (ok) { setRemoveTarget(null); if (scope === `source:${id}`) navigate('all'); } }}>Remove source</Button></div></Modal>}
    {selected && <ArticleDrawer key={selected.id} article={selected} pending={pending.has(`article:${selected.id}`)} error={error} onClose={() => setSelectedId(null)} onChange={(patch) => void changeArticle(selected, patch)} />}
  </div>;
}

function NavItem({ label, icon, active, count, onClick }: { label: string; icon: ReactNode; active: boolean; count?: number; onClick: () => void }) {
  return <button className={`nav-item ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}><span className="nav-icon">{icon}</span><span>{label}</span>{count !== undefined && <span className="nav-count">{count}</span>}</button>;
}

function EmptyLibrary({ onAdd, onDemo, demoPending, hasSources }: { onAdd: () => void; onDemo: () => void; demoPending: boolean; hasSources: boolean }) {
  return <section className="empty-library"><div className="empty-illustration" aria-hidden="true"><Icon icon={rss} size={42} /><div /><div /><div /></div><h2>{hasSources ? 'Your sources are ready for stories' : 'Make room for good reading'}</h2><p>{hasSources ? 'Articles will appear here after a connected worker fetches your sources. In the meantime, explore the reader with clearly labeled sample articles.' : 'Add a feed to start building your library, or explore the reader with sample articles.'}</p><div className="empty-actions"><Button variant="primary" __next40pxDefaultSize onClick={onAdd}>{hasSources ? 'Add another source' : 'Add your first source'}</Button><Button variant="secondary" __next40pxDefaultSize disabled={demoPending} isBusy={demoPending} onClick={onDemo}>Try sample articles</Button></div><p className="fine-print">Sample articles are saved only to your account and labeled as demo content.</p></section>;
}

function SourceManager({ sources, workerConfigured, pending, onAdd, onToggle, onRefresh, onDelete }: { sources: Source[]; workerConfigured: boolean; pending: Set<string>; onAdd: () => void; onToggle: (source: Source) => void; onRefresh: (source: Source) => void; onDelete: (source: Source) => void }) {
  if (!sources.length) return <section className="empty-library"><Icon icon={rss} size={40} /><h2>Start with a site you love</h2><p>Add an RSS or Atom feed URL. You can group related sources into folders as your library grows.</p><Button variant="primary" onClick={onAdd}>Add a source</Button></section>;
  return <section className="source-manager" aria-label="Feed sources"><div className="source-list-heading"><span>Source and activity</span><span>Controls</span></div>{sources.map((source) => {
    const busy = pending.has(`source:${source.id}`);
    const status = sourceStatus(source, workerConfigured);
    return <article key={source.id} className="source-row"><div className="source-row-main"><div className="source-row-title"><span className="source-initial" aria-hidden="true">{source.title.slice(0, 1).toUpperCase()}</span><div><h2>{source.title}</h2><p className="source-url">{source.url}</p></div></div><div className="source-meta"><span className={`source-status ${source.error ? 'has-error' : ''}`}>{status}</span>{source.folder && <span>{source.folder}</span>}</div><dl className="source-timing"><div><dt>Last attempt</dt><dd>{dateLabel(source.lastAttemptAt, true)}</dd></div><div><dt>Last success</dt><dd>{dateLabel(source.lastSuccessAt, true)}</dd></div><div><dt>Next check</dt><dd>{source.enabled && workerConfigured ? dateLabel(source.nextPollAt, true) : 'Not scheduled'}</dd></div></dl>{source.error && <p className="source-error" role="status">{source.error}</p>}</div><div className="source-controls"><ToggleControl __nextHasNoMarginBottom label={source.enabled ? 'Enabled' : 'Paused'} checked={source.enabled} disabled={busy || source.jobStatus === 'demo' || (!workerConfigured && !source.enabled)} onChange={() => onToggle(source)} /><Button icon={update} variant="secondary" disabled={busy || source.jobStatus === 'demo' || !workerConfigured || !source.enabled} isBusy={busy} onClick={() => onRefresh(source)}>Refresh</Button><Button icon={trash} variant="tertiary" isDestructive disabled={busy} onClick={() => onDelete(source)}>Remove</Button></div></article>;
  })}</section>;
}

function AddSourceModal({ workerConfigured, pending, onClose, onSubmit }: { workerConfigured: boolean; pending: boolean; onClose: () => void; onSubmit: (value: { title: string; url: string; folder: string }) => Promise<boolean> }) {
  const [title, setTitle] = useState(''); const [url, setUrl] = useState(''); const [folder, setFolder] = useState(''); const [validation, setValidation] = useState('');
  return <Modal title="Add a source" onRequestClose={() => { if (!pending) onClose(); }} className="compact-modal"><form onSubmit={async (event) => { event.preventDefault(); const safeUrl = safeExternalUrl(url.trim()); if (!safeUrl || !safeUrl.startsWith('https:') || !title.trim()) { setValidation('Enter a source name and a valid HTTPS feed URL.'); return; } setValidation(''); const ok = await onSubmit({ title: title.trim(), url: safeUrl, folder: folder.trim() }); if (!ok) setValidation('The source could not be added. Check the connection and try again.'); }}><p className="modal-intro">Follow an RSS or Atom feed. Give it a name that feels familiar.</p>{validation && <Notice status="error" isDismissible={false}>{validation}</Notice>}<TextControl __next40pxDefaultSize __nextHasNoMarginBottom label="Source name" value={title} onChange={setTitle} placeholder="e.g. WordPress News" required maxLength={120} disabled={pending} autoComplete="off" /><TextControl __next40pxDefaultSize __nextHasNoMarginBottom label="Feed URL" value={url} onChange={setUrl} type="url" placeholder="https://example.com/feed/" help="Use the RSS or Atom feed address, not the site’s home page." required maxLength={2048} disabled={pending} autoComplete="url" /><TextControl __next40pxDefaultSize __nextHasNoMarginBottom label="Folder (optional)" value={folder} onChange={setFolder} placeholder="e.g. Design & development" maxLength={80} disabled={pending} autoComplete="off" />{!workerConfigured && <p className="inline-notice">This source will be saved as paused until a feed worker is connected.</p>}<div className="modal-actions"><Button variant="tertiary" onClick={onClose} disabled={pending}>Cancel</Button><Button variant="primary" type="submit" disabled={pending} isBusy={pending}>Add source</Button></div></form></Modal>;
}

function ArticleDrawer({ article, pending, error, onClose, onChange }: { article: Article; pending: boolean; error: string; onClose: () => void; onChange: (patch: ArticleState) => void }) {
  const detail = useQuery<Article | null>('article', { id: article.id });
  const [detailDelayed, setDetailDelayed] = useState(false);
  useEffect(() => {
    if (detail !== undefined) { setDetailDelayed(false); return; }
    const timer = window.setTimeout(() => setDetailDelayed(true), 15000);
    return () => window.clearTimeout(timer);
  }, [article.id, detail]);
  const externalUrl = safeExternalUrl(article.url);
  return <Modal title="Reading article" onRequestClose={onClose} className="article-drawer"><div className="article-toolbar"><Button icon={article.read ? unseen : seen} variant="secondary" disabled={pending} onClick={() => onChange({ read: !article.read })}>{article.read ? 'Mark unread' : 'Mark read'}</Button><Button icon={article.starred ? starFilled : starEmpty} variant={article.starred ? 'primary' : 'secondary'} aria-pressed={article.starred} disabled={pending} onClick={() => onChange({ starred: !article.starred })}>{article.starred ? 'Starred' : 'Star'}</Button>{externalUrl && <Button href={externalUrl} target="_blank" rel="noopener noreferrer" icon={external} variant="tertiary">Original article</Button>}</div><article className="article-content">{error && <Notice status="error" isDismissible={false}>{error}</Notice>}<p className="article-byline">{article.sourceTitle}<span aria-hidden="true"> · </span>{dateLabel(article.publishedAt)}{article.author && <><span aria-hidden="true"> · </span>{article.author}</>}</p><h2>{article.title || 'Untitled article'}</h2><p className="article-reading-status">{article.read ? 'Read' : 'Unread'}{article.starred ? ' · Starred' : ''}</p>{detail === undefined ? <div className="article-detail-loading" aria-live="polite" aria-busy={!detailDelayed}>{!detailDelayed && <Spinner />}<p>{detailDelayed ? 'This article is taking longer to load. You can close and reopen it to retry, or read the original.' : 'Loading the full article…'}</p></div> : detail === null ? <Notice status="warning" isDismissible={false}>This article is no longer available in your library.</Notice> : <ArticleBody text={detail.bodyText} />}<footer className="article-end">Reading and starring are separate. Closing this panel won’t change either.</footer></article></Modal>;
}
