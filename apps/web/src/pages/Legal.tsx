export function PrivacyPage() {
  return (
    <div className="card">
      <h2>Privacy policy</h2>
      <p className="sub">
        Last updated 2026-04-20. This is the plain-language version. yrdsl.app is operated by{' '}
        <a href="https://oss.kuvop.com">Kuvop LLC</a>; this policy covers yrdsl.app specifically.
      </p>

      <h3 style={{ marginTop: 24, fontSize: 16 }}>What we collect</h3>
      <ul>
        <li>
          <b>Account:</b> email, username, password (stored as a one-way hash, so we never see the
          plaintext), optional avatar.
        </li>
        <li>
          <b>Sale content:</b> titles, descriptions, prices, photos, tags, and the contact methods
          you choose to publish (email / SMS / WhatsApp).
        </li>
        <li>
          <b>Meter events:</b> counters for storage-GB-days, published page views, API requests.
          Used to compute your bill.
        </li>
        <li>
          <b>Request logs:</b> method, path, status, duration, IP, and user agent for each HTTP
          request. Kept for 30 days for debugging / abuse investigation, then purged.
        </li>
      </ul>

      <h3 style={{ marginTop: 20, fontSize: 16 }}>What we do not collect</h3>
      <ul>
        <li>No third-party ads, trackers, analytics beacons, or remarketing pixels.</li>
        <li>No inbox. We don't mediate your conversations with buyers.</li>
        <li>No buyer accounts. Buyers are anonymous visitors.</li>
      </ul>

      <h3 style={{ marginTop: 20, fontSize: 16 }}>Who we share it with</h3>
      <ul>
        <li>
          <b>Cloudflare</b> hosts our database, storage, and workers.
        </li>
        <li>
          <b>Resend</b> sends auth emails (signup confirmation and password resets). Your email
          address is shared with them at the moment of send.
        </li>
        <li>
          <b>Stripe</b> (once billing is live) for payment processing. They see your card details,
          we don't.
        </li>
        <li>Nobody else. We do not sell data.</li>
      </ul>

      <h3 style={{ marginTop: 20, fontSize: 16 }}>Your rights</h3>
      <ul>
        <li>
          <b>Export & delete:</b> download a ZIP of any yard sale at any time from its settings,
          then remove it from our servers entirely. Your bill for that sale drops to zero.
        </li>
        <li>
          <b>Delete your account:</b> email <a href="mailto:mreider@gmail.com">mreider@gmail.com</a>{' '}
          during beta; we'll wipe you within 48 hours. Self-serve delete is coming in a near-term
          release.
        </li>
        <li>
          <b>Access & correction:</b> everything we store about you is visible in your profile. Edit
          any field or email us for anything that isn't.
        </li>
      </ul>

      <h3 style={{ marginTop: 20, fontSize: 16 }}>Beta disclaimer</h3>
      <p>
        yrdsl.app is in invite-only beta. Features change, we may occasionally lose things, and the
        product is provided "as is." We will always tell you before a change that could affect your
        data.
      </p>

      <p style={{ marginTop: 20, color: 'var(--muted)', fontSize: 13 }}>
        Questions? <a href="mailto:mreider@gmail.com">mreider@gmail.com</a>
      </p>
    </div>
  );
}

export function TermsPage() {
  return (
    <div className="card">
      <h2>Terms of service</h2>
      <p className="sub">
        Last updated 2026-04-20. This is the plain-language version. yrdsl.app is operated by{' '}
        <a href="https://oss.kuvop.com">Kuvop LLC</a>; this agreement is between you and Kuvop LLC.
      </p>

      <h3 style={{ marginTop: 24, fontSize: 16 }}>The short version</h3>
      <ul>
        <li>
          We give you a place to list your yard sale items and share one link with your neighbors.
          You handle the money, the handoff, the conversation.
        </li>
        <li>
          You own your content. We host it on your behalf and charge the metered rates published on
          the pricing page.
        </li>
        <li>
          Don't list anything illegal, obviously-scam, infringing, hateful, or CSAM. We will remove
          listings that violate this and may terminate repeat offenders.
        </li>
        <li>
          This is a beta. Bugs happen. We are not liable for lost sales, missed buyers, or downtime.
        </li>
      </ul>

      <h3 style={{ marginTop: 20, fontSize: 16 }}>Billing</h3>
      <p>
        Pricing is pure metered: storage-GB-month plus page views plus API calls. Months that total
        under $0.50 are rolled forward and not charged. They get invoiced only once they accumulate
        past the threshold. You can reach $0 at any time by exporting and deleting all your sales.
      </p>

      <h3 style={{ marginTop: 20, fontSize: 16 }}>Warranty</h3>
      <p>
        No warranty. yrdsl.app is provided as-is, with a best-effort commitment to not lose your
        data and to communicate clearly when something breaks.
      </p>

      <h3 style={{ marginTop: 20, fontSize: 16 }}>Changes</h3>
      <p>
        If these terms change meaningfully, we'll email you at least seven days before the change
        takes effect. Continuing to use the service after that is your agreement to the new terms.
      </p>

      <p style={{ marginTop: 20, color: 'var(--muted)', fontSize: 13 }}>
        Contact: <a href="mailto:mreider@gmail.com">mreider@gmail.com</a>
      </p>
    </div>
  );
}
