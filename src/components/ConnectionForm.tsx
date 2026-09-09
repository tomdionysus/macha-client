import { useState, type ChangeEvent, type FormEvent } from 'react';
import { errorMessage } from '@macha/core';

export interface ConnectionFormProps {
  bootstrapEndpoints: readonly string[];
  onSave: (urls: readonly string[]) => Promise<string | undefined>;
  submitLabel?: string;
  notice?: string;
}

export function ConnectionForm({ bootstrapEndpoints, onSave, submitLabel = 'Check and save', notice }: ConnectionFormProps) {
  const [urls, setUrls] = useState(bootstrapEndpoints.join('\n'));
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (checking) return;
    setChecking(true);
    setError(undefined);
    try {
      setError(await onSave(urls.split(/[\n,]/)));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setChecking(false);
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
      disabled={checking}
    />
    {(error ?? notice) && <p className="settings-status-error" role="alert">{error ?? notice}</p>}
    <button className="primary-button" type="submit" disabled={checking} data-tv-focusable="true">
      {checking ? 'Checking endpoints…' : submitLabel}
    </button>
    <p>Each endpoint is checked before it is saved. The client can learn additional node APIs after connecting.</p>
  </form>;
}
