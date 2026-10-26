import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Modal, Notice, Spinner, TextControl, ToggleControl } from './controls';
import { Icon, rss, starEmpty, starFilled, plus, cog, listView, unseen, seen, update, trash, external, search, moreVertical } from '@wordpress/icons';
import { signOut, useMutation, useQuery } from '@spacefast/zero/react';
import { applyArticleState, articlesInScope, dateLabel, safeExternalUrl, sourceStatus } from './state';
import { ArticleBody, Brand, errorMessage } from './ui';
import ImportOpmlModal from './ImportOpmlModal';
import { useSwipe } from './useSwipe';
import { SOURCE_LIMIT, type OpmlImportResult } from '../shared/opml';
import type { Article, ArticleState, Dashboard, ReaderScope, Source } from './types';

export default function Workspace({ displayName }: { displayName: string }) {
  const dashboard = useQuery<Dashboard>('dashboard');
  const mutateArticle = useMutation<[{ id: string } & ArticleState]>('setArticleState');
  const addSource = useMutation<[{ title: string; url: string; folder: string }]>('addSource');
  const updateSource = useMutation<[{ id: string; enabled: boolean }]>('updateSource');
  const deleteSource = useMutation<[{ id: string }]>('deleteSource');
  const refreshSource = useMutation<[{ id: string }]>('refreshSource');
  const seedDemo = useMutation<[Record<string, never>]>('seedDemo');
  const importOpml = useMutation<[{ xml: string; selectedIds: string[] }]>('importOpml');
  return <WorkspaceView displayName={displayName} dashboard={dashboard} actions={{ mutateArticle, addSource, updateSource, deleteSource, refreshSource, seedDemo, importOpml, signOut: () => signOut({ returnTo: window.location.href }) }} renderDrawer={(props) => <ArticleDrawer {...props} />} />;
}

export type WorkspaceActions = {
  mutateArticle: (input: { id: string } & ArticleState) => Promise<unknown>;
  addSource: (input: { title: string; url: string; folder: string }) => Promise<unknown>;
  updateSource: (input: { id: string; enabled: boolean }) => Promise<unknown>;
  deleteSource: (input: { id: string }) => Promise<unknown>;
  refreshSource: (input: { id: string }) => Promise<unknown>;
  seedDemo: (input: Record<string, never>) => Promise<unknown>;
  importOpml: (input: { xml: string; selectedIds: string[] }) => Promise<unknown>;
  signOut: () => Promise<unknown>;
};
export type DrawerProps = { article: Article; pending: boolean; error: string; onClose: () => void; onChange: (patch: ArticleState) => void };

/** The real reader view also powers an isolated, in-memory visual test fixture. */
export function WorkspaceView({ displayName, dashboard, actions: api, renderDrawer, demo = false }: { displayName: string; dashboard: Dashboard | undefined; actions: WorkspaceActions; renderDrawer: (props: DrawerProps) => ReactNode; demo?: boolean }) {
  const { mutateArticle, addSource, updateSource, deleteSource, refreshSource, seedDemo } = api;
  const [tab, setTab] = useState<'reader' | 'sources'>('reader');
  const [scope, setScope] = useState<ReaderScope>('all');
  const [query, setQuery] = useState('');
  const [readFilter, setReadFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');
  const [visibleCount, setVisibleCount] = useState(40);
  const [searchOpen, setSearchOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
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
  const heading = tab === 'sources' ? 'Manage sources' : activeSource?.title ?? ({ all: 'All', unread: 'Unread', starred: 'Starred' }[scope as 'all' | 'unread' | 'starred'] || 'All');

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
    setScope(nextScope); setTab('reader'); setQuery(''); setReadFilter('all'); setVisibleCount(40); setSidebarOpen(false);
  }

  const scopedArticles = articlesInScope(articles, scope);
  const filteredArticles = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return articlesInScope(articles, scope).filter(article =>
      (readFilter === 'all' || article.read === (readFilter === 'read')) &&
      (!needle || [article.title, article.sourceTitle, article.author, article.bodyText].some(value => value?.toLocaleLowerCase().includes(needle)))
    ).sort((a, b) => {
      const difference = (Date.parse(b.publishedAt || '') || 0) - (Date.parse(a.publishedAt || '') || 0);
      return sortOrder === 'oldest' ? -difference : difference;
    });
  }, [articles, scope, query, readFilter, sortOrder]);
  const visibleArticles = filteredArticles.slice(0, visibleCount);

  const folders = [...new Set(sources.map((source) => source.folder || 'Your sources'))].sort();
  const sidebarContent = <>
      <div className="sidebar-brand"><Brand /></div>
      <nav aria-label="Feeds">
        <NavItem label="All articles" icon={listView} active={tab === 'reader' && scope === 'all'} count={articles.length} onClick={() => navigate('all')} />
        <NavItem label="Unread" icon={unseen} active={tab === 'reader' && scope === 'unread'} count={unreadCount} onClick={() => navigate('unread')} />
        <NavItem label="Starred" icon={starEmpty} active={tab === 'reader' && scope === 'starred'} count={starredCount} onClick={() => navigate('starred')} />
      </nav>
      <div className="sidebar-sources"><div className="sidebar-section-heading"><span>Sources</span><Button icon={plus} label="Add a source" onClick={() => { setSidebarOpen(false); setAddOpen(true); }} disabled={!dashboard || sources.length >= SOURCE_LIMIT} /></div>
        {!sources.length && <p className="sidebar-empty">Your favorite sites belong here.</p>}
        {folders.map((folder) => <div className="source-group" key={folder}><p className="source-folder">{folder}</p>{sources.filter((source) => (source.folder || 'Your sources') === folder).map((source) => <button key={source.id} className={`source-nav ${tab === 'reader' && scope === `source:${source.id}` ? 'is-active' : ''}`} onClick={() => navigate(`source:${source.id}`)} aria-current={tab === 'reader' && scope === `source:${source.id}` ? 'page' : undefined}><span className="source-initial" aria-hidden="true">{source.title.slice(0, 1).toUpperCase()}</span><span>{source.title}</span><span className="nav-count">{articles.filter((article) => article.sourceId === source.id && !article.read).length}</span></button>)}</div>)}
      </div>
      <div className="sidebar-bottom"><NavItem label="Manage sources" icon={cog} active={tab === 'sources'} onClick={() => { setTab('sources'); setSidebarOpen(false); }} /><div className="account-bar"><span className="account-avatar" aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span><span title={displayName}>{displayName}</span><Button variant="tertiary" disabled={pending.has('signout')} onClick={() => void run('signout', api.signOut)}>Sign out</Button></div></div>
    </>;
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to articles</a>
    <aside className="sidebar" aria-label="Reading navigation">{sidebarContent}</aside>
    {sidebarOpen && <Modal title="Feeds" onRequestClose={() => setSidebarOpen(false)} className="library-dialog"><div className="sidebar mobile-sidebar">{sidebarContent}</div></Modal>}
    <main className="workspace" id="main-content" tabIndex={-1}>
      <header className="workspace-header">
        <Button className="mobile-nav-toggle" icon={listView} label="Choose feed" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)} />
        <h1>{heading}</h1>
        <div className="header-actions">
          {tab === 'reader' && <Button icon={search} label="Search articles" aria-expanded={searchOpen} onClick={() => { if (searchOpen) setQuery(''); setSearchOpen(!searchOpen); }} />}
          <Button icon={moreVertical} label="Reader options" onClick={() => setOptionsOpen(true)} />
        </div>
      </header>
      {searchOpen && tab === 'reader' && <div className="reader-search"><TextControl label="Search articles" type="search" value={query} onChange={value => { setQuery(value); setVisibleCount(40); }} autoFocus /><Button onClick={() => { setSearchOpen(false); setQuery(''); }}>Cancel</Button></div>}
      {demo && <p className="reader-status">Sample articles · not saved</p>}
      {!demo && dashboard && !workerConfigured && <p className="reader-status"><button onClick={() => setOptionsOpen(true)}>Fetching paused</button></p>}
      {readFilter !== 'all' && tab === 'reader' && <div className="active-filter"><span>{readFilter === 'read' ? 'Read articles' : 'Unread articles'}</span><Button onClick={() => setReadFilter('all')}>Clear filter</Button></div>}
      <div className="notice-stack" aria-live="polite">{error && <Notice status="error" onRemove={() => setError('')}>{error}</Notice>}{success && <Notice status="success" onRemove={() => setSuccess('')}>{success}</Notice>}</div>
      {!dashboard ? <div className="loading-state" aria-live="polite" aria-busy={!loadingDelayed}>{!loadingDelayed && <Spinner />}<h2>{loadingDelayed ? 'Your feeds are taking longer to load' : 'Loading articles'}</h2><p>{loadingDelayed ? 'The connection may be unavailable. Your saved articles are unchanged.' : 'Fetching your sources and reading history.'}</p>{loadingDelayed && <Button variant="secondary" onClick={() => window.location.reload()}>Reload and retry</Button>}</div> : tab === 'sources' ? <SourceManager sources={sources} workerConfigured={workerConfigured} pending={pending} onAdd={() => setAddOpen(true)} onToggle={(source) => void run(`source:${source.id}`, () => updateSource({ id: source.id, enabled: !source.enabled }), source.enabled ? 'Source paused.' : 'Source enabled.')} onRefresh={(source) => void run(`source:${source.id}`, () => refreshSource({ id: source.id }), 'Refresh queued. The next scheduled check will fetch this source.')} onDelete={setRemoveTarget} /> : !articles.length ? <EmptyLibrary onAdd={() => setAddOpen(true)} onDemo={() => void run('demo', () => seedDemo({}), 'Sample articles added. These are demo content, not live feed results.')} demoPending={pending.has('demo')} hasSources={sources.length > 0} /> : <section className="reader-surface" aria-label="Articles">
        {visibleArticles.length ? <ul className="article-list">{visibleArticles.map(article => <SwipeArticleRow key={article.id} article={article} pending={pending.has(`article:${article.id}`)} onOpen={() => setSelectedId(article.id)} onChange={patch => void changeArticle(article, patch)} />)}</ul> : <div className="empty-filter"><h2>No articles found</h2><p>Try another search or clear your filters.</p><Button variant="secondary" onClick={() => { setQuery(''); setReadFilter('all'); setScope('all'); }}>Show all articles</Button></div>}
        {filteredArticles.length > visibleCount && <div className="load-more"><Button variant="secondary" onClick={() => setVisibleCount(count => count + 40)}>Show more articles</Button></div>}
      </section>}

    </main>
    {optionsOpen && <Modal title="Reader options" onRequestClose={() => setOptionsOpen(false)} className="compact-modal reader-options">
      {tab === 'reader' && <div className="reader-option-fields"><label>Read status<select value={readFilter} onChange={event => { setReadFilter(event.target.value); setVisibleCount(40); }}><option value="all">All articles</option><option value="unread">Unread</option><option value="read">Read</option></select></label><label>Sort by<select value={sortOrder} onChange={event => { setSortOrder(event.target.value); setVisibleCount(40); }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label></div>}
      <div className="reader-option-actions"><Button variant="secondary" onClick={() => { setOptionsOpen(false); setImportOpen(true); }} disabled={!dashboard}>Import OPML</Button><Button variant="secondary" icon={plus} onClick={() => { setOptionsOpen(false); setAddOpen(true); }} disabled={!dashboard || sources.length >= SOURCE_LIMIT}>Add source</Button><Button onClick={() => { setOptionsOpen(false); setTab('sources'); }}>Manage sources</Button></div>
      {demo && <p className="fine-print">Synthetic articles only. Changes stay in this tab and reset on reload. No account data or network writes.</p>}
      {dashboard && !workerConfigured && <p className="fine-print">Live fetching is paused. You can organize sources and read sample articles. Scheduled ingestion has not been enabled.</p>}
      <p className="fine-print">{scopedArticles.length} articles in this view. Up to 200 recent articles and 25 sources per account.</p>
      <div className="modal-actions"><Button variant="primary" onClick={() => setOptionsOpen(false)}>Done</Button></div>
    </Modal>}
    {importOpen && <ImportOpmlModal sources={sources} onClose={() => setImportOpen(false)} onImport={async input => { const result = await api.importOpml(input) as OpmlImportResult; setSuccess(`${result.imported} sources imported as paused. ${result.existing} existing sources left unchanged.`); return result; }} />}
    {addOpen && <AddSourceModal workerConfigured={workerConfigured} pending={pending.has('add')} onClose={() => setAddOpen(false)} onSubmit={async (values) => { const ok = await run('add', () => addSource(values), workerConfigured ? 'Source added.' : 'Source saved as paused. Enable scheduled ingestion to start fetching.'); if (ok) setAddOpen(false); return ok; }} />}
    {removeTarget && <Modal title="Remove this source?" onRequestClose={() => { if (!pending.has(`source:${removeTarget.id}`)) setRemoveTarget(null); }} className="compact-modal"><p><strong>{removeTarget.title}</strong> and its stored articles will be removed from your library. This cannot be undone.</p><div className="modal-actions"><Button variant="tertiary" disabled={pending.has(`source:${removeTarget.id}`)} onClick={() => setRemoveTarget(null)}>Cancel</Button><Button variant="primary" isDestructive isBusy={pending.has(`source:${removeTarget.id}`)} disabled={pending.has(`source:${removeTarget.id}`)} onClick={async () => { const id = removeTarget.id; const ok = await run(`source:${id}`, () => deleteSource({ id }), 'Source removed.'); if (ok) { setRemoveTarget(null); if (scope === `source:${id}`) navigate('all'); } }}>Remove source</Button></div></Modal>}
    {selected && renderDrawer({ article: selected, pending: pending.has(`article:${selected.id}`), error, onClose: () => setSelectedId(null), onChange: (patch) => void changeArticle(selected, patch) })}
  </div>;
}

export function SwipeArticleRow({ article, pending, onOpen, onChange }: { article: Article; pending: boolean; onOpen: () => void; onChange: (patch: ArticleState) => void }) {
  const swipe = useSwipe({ disabled: pending, onSwipe: direction => {
    if (direction === 'left') onChange({ read: !article.read });
    if (direction === 'right') onChange({ starred: !article.starred });
  } });
  const feedback = pending ? 'Saving' : swipe.offset < 0 ? article.read ? 'Mark unread' : 'Mark read' : article.starred ? 'Unstar' : 'Star';
  return <li {...swipe.handlers} className={`swipe-row ${swipe.ready ? 'is-ready' : ''}`}>
    <span className={`swipe-feedback ${swipe.offset < 0 ? 'swipe-left' : 'swipe-right'}`} aria-hidden="true" style={{ opacity: swipe.offset ? 1 : 0 }}>{swipe.offset < 0 ? article.read ? '○' : '✓' : article.starred ? '☆' : '★'} {feedback}</span>
    <button className={`article-row ${article.read ? 'is-read' : ''} ${swipe.tracking ? 'is-swiping' : ''}`} style={{ transform: `translateX(${swipe.offset}px)` }} onClick={onOpen} aria-label={article.title || 'Untitled article'} aria-busy={pending || undefined}>
      <span className="article-row-copy">
      <span className="article-title">{article.title || 'Untitled article'}</span>
      <span className="article-meta"><span className="article-source">{article.sourceTitle}</span><span aria-hidden="true"> / </span><time dateTime={article.publishedAt || undefined} title={dateLabel(article.publishedAt)}>{relativeDate(article.publishedAt)}</time>{article.starred && <span className="article-star" aria-label="Starred">★</span>}{!article.read && <span className="screen-reader-text">Unread</span>}</span>
      {article.bodyText && <span className="article-excerpt">{article.bodyText.slice(0, 240)}</span>}
      </span>
    </button>
  </li>;
}

export function relativeDate(value: string | null) {
  if (!value) return 'Undated';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Undated';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp);
}

function NavItem({ label, icon, active, count, onClick }: { label: string; icon: ReactNode; active: boolean; count?: number; onClick: () => void }) {
  return <button className={`nav-item ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}><span className="nav-icon">{icon}</span><span>{label}</span>{count !== undefined && <span className="nav-count">{count}</span>}</button>;
}

function EmptyLibrary({ onAdd, onDemo, demoPending, hasSources }: { onAdd: () => void; onDemo: () => void; demoPending: boolean; hasSources: boolean }) {
  return <section className="empty-library"><div className="empty-illustration" aria-hidden="true"><Icon icon={rss} size={42} /><div /><div /><div /></div><h2>{hasSources ? 'Your sources are ready for stories' : 'Make room for good reading'}</h2><p>{hasSources ? 'Articles will appear here after scheduled ingestion fetches your sources. In the meantime, explore the reader with clearly labeled sample articles.' : 'Add a feed to start building your library, or explore the reader with sample articles.'}</p><div className="empty-actions"><Button variant="primary" onClick={onAdd}>{hasSources ? 'Add another source' : 'Add your first source'}</Button><Button variant="secondary" disabled={demoPending} isBusy={demoPending} onClick={onDemo}>Try sample articles</Button></div><p className="fine-print">Sample articles are saved only to your account and labeled as demo content.</p></section>;
}

function SourceManager({ sources, workerConfigured, pending, onAdd, onToggle, onRefresh, onDelete }: { sources: Source[]; workerConfigured: boolean; pending: Set<string>; onAdd: () => void; onToggle: (source: Source) => void; onRefresh: (source: Source) => void; onDelete: (source: Source) => void }) {
  if (!sources.length) return <section className="empty-library"><Icon icon={rss} size={40} /><h2>Start with a site you love</h2><p>Add an RSS or Atom feed URL. You can group related sources into folders as your library grows.</p><Button variant="primary" onClick={onAdd}>Add a source</Button></section>;
  return <section className="source-manager" aria-label="Feed sources"><div className="source-list-heading"><span>Source and activity</span><span>Controls</span></div>{sources.map((source) => {
    const busy = pending.has(`source:${source.id}`);
    const status = sourceStatus(source, workerConfigured);
    return <article key={source.id} className="source-row"><div className="source-row-main"><div className="source-row-title"><span className="source-initial" aria-hidden="true">{source.title.slice(0, 1).toUpperCase()}</span><div><h2>{source.title}</h2><p className="source-url">{source.url}</p></div></div><div className="source-meta"><span className={`source-status ${source.error ? 'has-error' : ''}`}>{status}</span>{source.folder && <span>{source.folder}</span>}</div><dl className="source-timing"><div><dt>Last attempt</dt><dd>{dateLabel(source.lastAttemptAt, true)}</dd></div><div><dt>Last success</dt><dd>{dateLabel(source.lastSuccessAt, true)}</dd></div><div><dt>Next check</dt><dd>{source.enabled && workerConfigured ? dateLabel(source.nextPollAt, true) : 'Not scheduled'}</dd></div></dl>{source.error && <p className="source-error" role="status">{source.error}</p>}</div><div className="source-controls"><ToggleControl label={source.enabled ? 'Enabled' : 'Paused'} checked={source.enabled} disabled={busy || source.jobStatus === 'demo' || (!workerConfigured && !source.enabled)} onChange={() => onToggle(source)} /><Button icon={update} variant="secondary" disabled={busy || source.jobStatus === 'demo' || !workerConfigured || !source.enabled} isBusy={busy} onClick={() => onRefresh(source)}>Refresh</Button><Button icon={trash} variant="tertiary" isDestructive disabled={busy} onClick={() => onDelete(source)}>Remove</Button></div></article>;
  })}</section>;
}

function AddSourceModal({ workerConfigured, pending, onClose, onSubmit }: { workerConfigured: boolean; pending: boolean; onClose: () => void; onSubmit: (value: { title: string; url: string; folder: string }) => Promise<boolean> }) {
  const [title, setTitle] = useState(''); const [url, setUrl] = useState(''); const [folder, setFolder] = useState(''); const [validation, setValidation] = useState('');
  return <Modal title="Add a source" onRequestClose={() => { if (!pending) onClose(); }} className="compact-modal"><form onSubmit={async (event) => { event.preventDefault(); const safeUrl = safeExternalUrl(url.trim()); if (!safeUrl || !safeUrl.startsWith('https:') || !title.trim()) { setValidation('Enter a source name and a valid HTTPS feed URL.'); return; } setValidation(''); const ok = await onSubmit({ title: title.trim(), url: safeUrl, folder: folder.trim() }); if (!ok) setValidation('The source could not be added. Check the connection and try again.'); }}><p className="modal-intro">Follow an RSS or Atom feed. Give it a name that feels familiar.</p>{validation && <Notice status="error" isDismissible={false}>{validation}</Notice>}<TextControl label="Source name" value={title} onChange={setTitle} placeholder="e.g. WordPress News" required maxLength={120} disabled={pending} autoComplete="off" /><TextControl label="Feed URL" value={url} onChange={setUrl} type="url" placeholder="https://example.com/feed/" help="Use the RSS or Atom feed address, not the site’s home page." required maxLength={2048} disabled={pending} autoComplete="url" /><TextControl label="Folder (optional)" value={folder} onChange={setFolder} placeholder="e.g. Design & development" maxLength={80} disabled={pending} autoComplete="off" />{!workerConfigured && <p className="inline-notice">This source will be saved as paused until scheduled ingestion is enabled.</p>}<div className="modal-actions"><Button variant="tertiary" onClick={onClose} disabled={pending}>Cancel</Button><Button variant="primary" type="submit" disabled={pending} isBusy={pending}>Add source</Button></div></form></Modal>;
}

function ArticleDrawer(props: DrawerProps) {
  const { article } = props;
  const detail = useQuery<Article | null>('article', { id: article.id });
  const [detailDelayed, setDetailDelayed] = useState(false);
  useEffect(() => {
    if (detail !== undefined) { setDetailDelayed(false); return; }
    const timer = window.setTimeout(() => setDetailDelayed(true), 15000);
    return () => window.clearTimeout(timer);
  }, [article.id, detail]);
  return <ArticleDrawerView {...props} detail={detail} detailDelayed={detailDelayed} />;
}

export function ArticleDrawerView({ article, pending, error, onClose, onChange, detail, detailDelayed = false }: DrawerProps & { detail: Article | null | undefined; detailDelayed?: boolean }) {
  const externalUrl = safeExternalUrl(article.url);
  const swipe = useSwipe({ rightOnly: true, ignoreInteractive: true, onSwipe: onClose });
  return <Modal title="Reading article" onRequestClose={onClose} className="article-drawer"><div className="drawer-swipe-region" {...swipe.handlers}><span className={`drawer-swipe-feedback ${swipe.ready ? 'is-ready' : ''}`} aria-hidden="true" style={{ opacity: swipe.offset ? 1 : 0 }}>← Close</span><div className={`drawer-swipe-content ${swipe.tracking ? 'is-swiping' : ''}`} style={{ transform: `translateX(${swipe.offset}px)` }}><div className="article-toolbar"><Button icon={article.read ? unseen : seen} variant="secondary" disabled={pending} onClick={() => onChange({ read: !article.read })}>{article.read ? 'Mark unread' : 'Mark read'}</Button><Button icon={article.starred ? starFilled : starEmpty} variant={article.starred ? 'primary' : 'secondary'} aria-pressed={article.starred} disabled={pending} onClick={() => onChange({ starred: !article.starred })}>{article.starred ? 'Starred' : 'Star'}</Button>{externalUrl && <Button href={externalUrl} target="_blank" rel="noopener noreferrer" icon={external} variant="tertiary">Original article</Button>}</div><article className="article-content">{error && <Notice status="error" isDismissible={false}>{error}</Notice>}<p className="article-byline">{article.sourceTitle}<span aria-hidden="true"> · </span>{dateLabel(article.publishedAt)}{article.author && <><span aria-hidden="true"> · </span>{article.author}</>}</p><h2>{article.title || 'Untitled article'}</h2><p className="article-reading-status">{article.read ? 'Read' : 'Unread'}{article.starred ? ' · Starred' : ''}</p>{detail === undefined ? <div className="article-detail-loading" aria-live="polite" aria-busy={!detailDelayed}>{!detailDelayed && <Spinner />}<p>{detailDelayed ? 'This article is taking longer to load. You can close and reopen it to retry, or read the original.' : 'Loading the full article…'}</p></div> : detail === null ? <Notice status="warning" isDismissible={false}>This article is no longer available in your library.</Notice> : <ArticleBody text={detail.bodyText} />}<footer className="article-end">Reading and starring are separate. Closing this panel won’t change either.</footer></article></div></div></Modal>;
}
