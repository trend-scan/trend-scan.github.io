import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

/**
 * SpaAwareRedirect — handles GitHub Pages SPA fallback URLs.
 *
 * When a user visits a deep link like https://trend-scan.github.io/board
 * directly, GitHub Pages returns the static 404.html (because there's no
 * server-side route). That 404.html runs a script that redirects to
 * `/?/board` (with the path encoded in the query string).
 *
 * Without this component, React Router sees the URL as `/` (ignoring the
 * query string) and renders the Scanner (home) page — losing the user's
 * intended destination.
 *
 * This component detects the `?/path` query pattern and uses
 * `navigate(..., { replace: true })` to restore the original route.
 *
 * The `~and~` decoding handles the case where the original URL had query
 * parameters (the 404.html script encodes `&` as `~and~` to avoid
 * ambiguity).
 *
 * Mount this ONCE inside <Router> in App.jsx.
 */
export default function SpaAwareRedirect() {
  const navigate = useNavigate();
  const { search } = useLocation();

  useEffect(() => {
    // Match the SPA fallback pattern: starts with ?/ followed by a path
    // segment. Examples:
    //   ?/board         → /board
    //   ?/macro         → /macro
    //   ?/board&foo=bar → /board?foo=bar
    const m = search.match(/^\?\/([^&]+)/);
    if (!m) return;

    const path = '/' + m[1];
    // Everything after the matched path segment, with ~and~ decoded back to &
    const remaining = search.slice(m[0].length);
    const queryString = remaining ? remaining.replace(/~and~/g, '&') : '';

    navigate(path + queryString, { replace: true });
  }, [search, navigate]);

  return null;
}
