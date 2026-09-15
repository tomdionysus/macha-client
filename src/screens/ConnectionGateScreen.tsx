import { ConnectionForm, type ConnectionFormProps } from '../components/ConnectionForm';
import { machaLogoUrl as logoUrl } from '../uiAssets';

interface Props extends Pick<ConnectionFormProps, 'bootstrapEndpoints' | 'usingHost' | 'onSave'> {
  welcome: boolean;
  notice?: string;
}

export function ConnectionGateScreen({ welcome, notice, ...form }: Props) {
  return <main className="connection-gate">
    <section className="connection-gate-panel">
      <img className="connection-gate-logo" src={logoUrl} alt="" />
      <p className="eyebrow">Macha media client</p>
      <h1>{welcome ? 'Welcome' : 'Connection'}</h1>
      {/* "Check or replace the configured endpoints" is the wrong sentence for
          a client that was using the host it was served from: there is nothing
          configured to check, and telling somebody to re-read a list they never
          wrote sends them looking for a mistake they did not make. */}
      <p>{welcome
        ? 'Configure at least one available Macha node to begin.'
        : form.usingHost
          ? 'The host this page was served from has stopped answering. Enter an endpoint to connect to another node.'
          : 'Check or replace the configured endpoints to reconnect.'}</p>
      <ConnectionForm {...form} notice={notice} submitLabel={welcome ? 'Connect to Macha' : 'Save and reconnect'} />
    </section>
  </main>;
}
