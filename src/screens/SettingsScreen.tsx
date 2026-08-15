import { useState, type ChangeEvent } from 'react';
interface Props {
  serverUrl: string;
  apiToken: string;
  onSave: (url: string, token: string) => void;
}

export function SettingsScreen({ serverUrl, apiToken, onSave }: Props) {
  const [url, setUrl] = useState(serverUrl);
  const [token, setToken] = useState(apiToken);
  return (
    <section className="settings">
      <h1>Settings</h1>
      <label htmlFor="server-url">Macha API</label>
      <div className="settings-line">
        <input
          id="server-url"
          data-tv-focusable="true"
          value={url}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setUrl(event.target.value)}
          placeholder="same origin"
          spellCheck={false}
        />
      </div>
      <label htmlFor="api-token">Bearer token <span className="muted">(optional)</span></label>
      <div className="settings-line">
        <input
          id="api-token"
          data-tv-focusable="true"
          type="password"
          value={token}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setToken(event.target.value)}
          spellCheck={false}
        />
        <button data-tv-focusable="true" onClick={() => onSave(url, token)}>Save</button>
      </div>
      <p>No account or cloud service. An empty API URL means same-origin <code>/api/v1/catalogue/…</code>.</p>
    </section>
  );
}
