import { ConnectionForm, type ConnectionFormProps } from '../components/ConnectionForm';
import { machaLogoUrl as logoUrl } from '../uiAssets';

interface Props extends Pick<ConnectionFormProps, 'bootstrapEndpoints' | 'onSave'> {
  welcome: boolean;
  notice?: string;
}

export function ConnectionGateScreen({ welcome, notice, ...form }: Props) {
  return <main className="connection-gate">
    <section className="connection-gate-panel">
      <img className="connection-gate-logo" src={logoUrl} alt="" />
      <p className="eyebrow">Macha media client</p>
      <h1>{welcome ? 'Welcome' : 'Connection'}</h1>
      <p>{welcome
        ? 'Configure at least one available Macha node to begin.'
        : 'Check or replace the configured endpoints to reconnect.'}</p>
      <ConnectionForm {...form} notice={notice} submitLabel={welcome ? 'Connect to Macha' : 'Save and reconnect'} />
    </section>
  </main>;
}
