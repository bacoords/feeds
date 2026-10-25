import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Button, Notice, Spinner } from './controls';
import { Icon, seen, starFilled } from '@wordpress/icons';
import { retryAuth, signInWithSpacefast, useAuth } from '@spacefast/zero/react';
import { Brand, errorMessage } from './ui';

const Workspace = lazy(() => import('./Workspace'));
const SamplePreview = lazy(() => import('./SamplePreview'));

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="standalone-state"><h1>Feeds couldn’t open this view</h1><p>Reload to try again. Your library will be fetched from your account.</p><Button variant="primary" onClick={() => window.location.reload()}>Reload Feeds</Button></main>;
    return this.props.children;
  }
}

export default function App() {
  return <ErrorBoundary>{new URLSearchParams(window.location.search).get('preview') === 'sample' ? <Suspense fallback={<main className="standalone-state"><Spinner /><p>Loading sample preview…</p></main>}><SamplePreview /></Suspense> : <AuthRouter />}</ErrorBoundary>;
}

function AuthRouter() {
  const auth = useAuth();
  const [authActionError, setAuthActionError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [authDelayed, setAuthDelayed] = useState(false);
  useEffect(() => {
    if (!auth.isLoading) { setAuthDelayed(false); return; }
    const timer = window.setTimeout(() => setAuthDelayed(true), 12000);
    return () => window.clearTimeout(timer);
  }, [auth.isLoading]);

  async function startSignIn() {
    setAuthActionError(''); setSigningIn(true);
    try { await signInWithSpacefast({ returnTo: window.location.href }); }
    catch (error) { setAuthActionError(errorMessage(error)); }
    finally { setSigningIn(false); }
  }

  if (auth.isLoading) {
    return <main className="standalone-state" aria-busy="true"><Brand /><Spinner /><h1>Opening your reading space</h1><p>Checking your secure session.</p>{authDelayed && <><p>Sign-in is taking longer than expected.</p><Button variant="secondary" onClick={() => void retryAuth().catch((error) => setAuthActionError(errorMessage(error)))}>Retry sign-in check</Button></>}{authActionError && <Notice status="error" isDismissible={false}>{authActionError}</Notice>}</main>;
  }
  if (!auth.isAuthenticated || !auth.isSignedIn) {
    return <div className="auth-page">
      <header className="auth-header"><Brand /><span>Web-first, WordPress-inspired</span></header>
      <main className="auth-main" id="main-content">
        <div className="auth-copy"><span className="section-label">A quieter place to read</span><h1>Your feeds.<br />Your reading space.</h1><p>Keep the sites you follow in one place. Read at your own pace, save what matters, and leave the endless scroll behind.</p><div className="auth-action">{(auth.error || authActionError) && <Notice status="error" isDismissible={false}>{authActionError || auth.error}</Notice>}<Button variant="primary" disabled={signingIn} isBusy={signingIn} onClick={() => void startSignIn()}>Sign in with Spacefast</Button><p className="fine-print">Your sources and reading history stay in your account.</p></div></div>
        <div className="auth-preview" aria-label="Preview of the reading interface, not live articles"><div className="preview-heading"><span>Reading, simplified</span><span className="preview-demo">Interface preview</span></div><div className="preview-item"><span className="preview-dot" /><div><strong>A place for the sites you follow</strong><p>Bring your reading together, one source at a time.</p><span>Organize your sources</span></div></div><div className="preview-item"><Icon icon={starFilled} /><div><strong>Save a story for another day</strong><p>Star an article without changing its read status.</p><span>Keep the good ones</span></div></div><div className="preview-item"><Icon icon={seen} /><div><strong>Pick up where you left off</strong><p>See what’s unread and choose your next story.</p><span>Read at your own pace</span></div></div><div className="preview-footer">Built with WordPress UI + DataViews</div></div>
      </main><footer className="auth-footer">Early web prototype. Scheduled feed fetching is not enabled yet.</footer>
    </div>;
  }
  return <Suspense fallback={<main className="standalone-state" aria-busy="true"><Spinner /><p>Loading your reader…</p></main>}><Workspace key={auth.userId} displayName={auth.displayName || 'Your account'} /></Suspense>;
}
