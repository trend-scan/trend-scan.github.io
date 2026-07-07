/**
 * LegalDisclaimer — compact footer shown on every page.
 *
 * Industry standard for financial/trading tools. Covers:
 * 1. Not financial advice (explicit)
 * 2. Entertainment/educational purposes only
 * 3. No warranty (data may be inaccurate, incomplete, or delayed)
 * 4. Do your own research (DYOR)
 * 5. Past performance ≠ future results (SEC standard)
 * 6. Not a registered investment adviser
 * 7. Consult a qualified professional
 *
 * Styled to be unobtrusive: small font, muted color, border-top separator.
 * Always visible at the bottom of every page.
 */
export default function LegalDisclaimer() {
  return (
    <footer
      className="px-5 md:px-8 py-4 mt-auto"
      style={{
        background: 'var(--scanner-bg1)',
        borderTop: '1px solid var(--scanner-border2)',
      }}
    >
      <div
        className="font-mono text-[8px] leading-relaxed max-w-5xl mx-auto"
        style={{ color: 'var(--scanner-text3)' }}
      >
        <p>
          <strong style={{ color: 'var(--scanner-text2)' }}>
            For entertainment and educational purposes only.
          </strong>{' '}
          TrendScan is not a registered investment adviser, broker-dealer, or financial advisor.
          Nothing on this site constitutes financial, investment, trading, or other advice.
          All data is sourced from third-party APIs and may be inaccurate, incomplete, delayed, or unavailable.
          Past performance does not guarantee future results. Cryptocurrency and digital asset trading
          involves significant risk of loss. Always do your own research (DYOR) and consult a qualified
          licensed financial professional before making any investment decisions. Use of this site
          constitutes acceptance of these terms.
        </p>
      </div>
    </footer>
  );
}
