import { Link } from 'react-router-dom';
import { machaLogoUrl as logoUrl } from '../uiAssets';
import { routes } from '../routing';

export function SponsorScreen() {
  return (
    <section className="sponsor-page">
      <Link className="back-button sponsor-back" data-tv-focusable="true" to={routes.settings}>← Settings</Link>
      <div className="sponsor-heading">
        <img className="sponsor-logo" src={logoUrl} alt="" />
        <div>
          <p className="eyebrow">Support the project</p>
          <h1>Donate / Sponsor Macha</h1>
          <p className="synopsis">Macha is free and open source. Financial support is optional and should never get in the way of using the software.</p>
        </div>
      </div>

      <div className="sponsor-options">
        <article>
          <h2>Recurring sponsorship</h2>
          <p>Regular sponsorship can help pay for development time, CI, hosting, test infrastructure and long-running compatibility work.</p>
        </article>
        <article>
          <h2>One-off donations</h2>
          <p>One-off contributions can fund specific project costs without creating an account, subscription or feature tier inside Macha.</p>
        </article>
        <article>
          <h2>Hardware and testing</h2>
          <p>Relevant storage, client devices and test hardware can reduce the cost of validating Macha across real deployments.</p>
        </article>
      </div>

      <p className="sponsor-stub">Payment and sponsorship links will be added here. There are no paid features, nags or donor-only functionality.</p>
    </section>
  );
}
