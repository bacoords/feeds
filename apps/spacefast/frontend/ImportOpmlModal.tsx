import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, CheckboxControl, Modal, Notice } from './controls';
import { errorMessage } from './ui';
import { normalizeFeedUrl, OPML_MAX_BYTES, OPML_MAX_FEEDS, parseOpml, SOURCE_LIMIT, type OpmlImportInput, type OpmlImportResult, type OpmlPreview } from '../shared/opml';
import type { Source } from './types';

export function importCandidates(preview: OpmlPreview, sources: Source[]) {
  const existingUrls = new Set(sources.flatMap(source => { try { return [normalizeFeedUrl(source.url)]; } catch { return []; } }));
  return preview.entries.map(entry => ({ ...entry, existing: !entry.error && existingUrls.has(entry.url), eligible: !entry.error && !entry.duplicateOf && !existingUrls.has(entry.url) }));
}

export default function ImportOpmlModal({ sources, onClose, onImport }: { sources: Source[]; onClose: () => void; onImport: (input: OpmlImportInput) => Promise<OpmlImportResult> }) {
  const [xml, setXml] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<OpmlPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const readVersion = useRef(0);
  useEffect(() => () => { readVersion.current++; }, []);
  const rows = useMemo(() => preview ? importCandidates(preview, sources) : [], [preview, sources]);
  const eligible = rows.filter(row => row.eligible);
  const selectedIds = eligible.filter(row => selected.has(row.id)).map(row => row.id);
  const capacity = Math.max(0, SOURCE_LIMIT - sources.length);
  const overCapacity = selectedIds.length > capacity;
  const busy = reading || saving;

  async function chooseFile(file: File | undefined) {
    const version = ++readVersion.current;
    setReading(false); setXml(''); setPreview(null); setSelected(new Set()); setError(''); setFileName(file?.name ?? '');
    if (!file) return;
    if (file.size > OPML_MAX_BYTES) { setError('Choose an OPML file no larger than 256 KiB. Nothing was imported.'); return; }
    setReading(true);
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      const result = parseOpml(text);
      if (version !== readVersion.current) return;
      setXml(text); setPreview(result);
      // Select all only when everything eligible fits. Never silently select a
      // truncated prefix of a larger subscription list.
      const candidates = importCandidates(result, sources).filter(row => row.eligible);
      if (candidates.length <= capacity) setSelected(new Set(candidates.map(row => row.id)));
    } catch (caught) {
      if (version === readVersion.current) setError(caught instanceof TypeError ? 'The file is not valid UTF-8. Export it as UTF-8 OPML and try again.' : errorMessage(caught));
    } finally { if (version === readVersion.current) setReading(false); }
  }

  return <Modal title="Import sources from OPML" onRequestClose={() => { if (!saving) onClose(); }} className="import-modal">
    <p>Preview an OPML export, choose feeds, then save them to your account. Existing sources and read/star history are not changed. Imported feeds stay paused.</p>
    <p className="inline-notice">{sources.length} of {SOURCE_LIMIT} source slots used. You can add {capacity} more. This bounded prototype keeps the 25-source limit; larger exports are never silently truncated.</p>
    <div className="opml-file-field"><label htmlFor="opml-file">OPML file</label><input id="opml-file" type="file" accept=".opml,.xml,text/xml,application/xml,text/x-opml" disabled={saving} onChange={event => void chooseFile(event.target.files?.[0])} aria-describedby="opml-file-help" /><p id="opml-file-help">UTF-8 XML, up to 256 KiB and {OPML_MAX_FEEDS} feed outlines. Only public HTTPS feed URLs are accepted. The preview stays in your browser until you import.</p></div>
    {reading && <p role="status">Reading and validating your file…</p>}
    {error && <Notice status="error" isDismissible={false}>{error}</Notice>}
    {preview && <>
      <div className="opml-summary" aria-live="polite"><strong>{fileName}</strong><p>{rows.length} feed outlines · {eligible.length} available to add · {rows.filter(row => row.existing && !row.duplicateOf).length} already in your library · {preview.duplicateCount} duplicates · {preview.invalidCount} invalid</p><p>{selectedIds.length} selected; {capacity} slots available.</p></div>
      {!rows.length && <Notice status="info" isDismissible={false}>No feed outlines with an xmlUrl were found. Folder-only outlines do not create subscriptions.</Notice>}
      {eligible.length > capacity && <Notice status="warning" isDismissible={false}>This export exceeds your remaining capacity. Choose up to {capacity} feeds below. Nothing will be imported until you confirm a selection within the limit.</Notice>}
      {overCapacity && <Notice status="error" isDismissible={false}>Remove {selectedIds.length - capacity} selections before importing. No feeds have been saved.</Notice>}
      {eligible.length > 0 && <div className="opml-selection-actions"><Button variant="secondary" disabled={busy || eligible.length > capacity} onClick={() => setSelected(new Set(eligible.map(row => row.id)))}>Select all available</Button><Button variant="tertiary" disabled={busy || selectedIds.length === 0} onClick={() => setSelected(new Set())}>Clear selection</Button></div>}
      <ul className="opml-preview" aria-label="Feed import preview">{rows.map(row => <li key={row.id} className="opml-entry"><CheckboxControl label={row.title || 'Untitled feed'} checked={row.eligible && selected.has(row.id)} disabled={busy || !row.eligible} onCheckedChange={checked => setSelected(current => { const next = new Set(current); if (checked) next.add(row.id); else next.delete(row.id); return next; })} /><p className="opml-url">{row.url || 'Missing feed URL'}</p>{row.folder && <p>Folder: {row.folder}</p>}<p className={row.error ? 'opml-error' : 'muted'}>{row.error || (row.duplicateOf ? 'Duplicate in this file; only the first occurrence can be selected.' : row.existing ? 'Already in your library. Its settings and history will be preserved.' : 'Ready to import as paused.')}</p></li>)}</ul>
    </>}
    <div className="modal-actions"><Button variant="tertiary" disabled={saving} onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !selectedIds.length || overCapacity} isBusy={saving} onClick={async () => { if (busy || !selectedIds.length || overCapacity) return; setSaving(true); setError(''); try { await onImport({ xml, selectedIds }); onClose(); } catch (caught) { setError(errorMessage(caught)); } finally { setSaving(false); } }}>Import {selectedIds.length || ''} {selectedIds.length === 1 ? 'source' : 'sources'}</Button></div>
  </Modal>;
}
