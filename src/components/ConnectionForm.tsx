import { useState, type ChangeEvent, type FormEvent } from 'react';
import { errorMessage } from '@machafoundation/core';

export interface ConnectionFormProps {
  bootstrapEndpoints: readonly string[];
  onSave: (urls: readonly string[]) => Promise<string | undefined>;
  submitLabel?: string;
  notice?: string;
}

export function ConnectionForm({ bootstrapEndpoints, onSave, submitLabel = 'Save endpoints', notice }: ConnectionFormProps) {
  const [urls, setUrls] = useState(bootstrapEndpoints.join('\n'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      setError(await onSave(urls.split(/[\n,]/)));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return <form className="connection-form" onSubmit={(event) => void submit(event)}>
    <label htmlFor="server-url">Macha bootstrap API endpoints</label>
    <textarea
      id="server-url"
      data-tv-focusable="true"
      value={urls}
      rows={Math.max(3, bootstrapEndpoints.length)}
      onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setUrls(event.target.value)}
      placeholder="One endpoint per line, for example http://macha-node:7438"
      spellCheck={false}
      disabled={saving}
    />
    {(error ?? notice) && <p className="settings-status-error" role="alert">{error ?? notice}</p>}
    <button className="primary-button" type="submit" disabled={saving} data-tv-focusable="true">
      {saving ? 'Saving…' : submitLabel}
    </button>
    {/* No longer "each endpoint is checked before it is saved". It never was,
        and saying so invited a viewer to read a saved endpoint as a verified
        one. The client reports what it can actually reach once it tries. */}
    <p>Endpoints are tried in order, and whichever answers is used. The client can learn additional node APIs after connecting.</p>
  </form>;
}
