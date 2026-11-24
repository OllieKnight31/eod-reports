// Sign-in guard + the top bar, shared by every page.
//
//   <script src="/auth.js" data-allow="owner,manager"></script>      (in <head>)
//
// Not signed in → the login page. Signed in but not allowed here → that role's home.
// This only decides what is SHOWN; the API enforces the same rules on the data.
//
// Pages can wait for `window.EOD_AUTH` (a promise of the signed-in user) and mark any
// element with data-roles="owner,manager" to have it removed for everyone else.
(function () {
  var allow = (document.currentScript.dataset.allow || 'owner,manager,setter,dialler,closer').split(',');
  var root = document.documentElement;
  root.style.visibility = 'hidden';                       // no flash of a page you can't use
  var never = new Promise(function () {});
  var ROLE_NAME = { owner: 'Owner', manager: 'Manager', setter: 'Setter', dialler: 'Dialler', closer: 'Closer' };

  function ready(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  function el(tag, props, kids) {
    var n = Object.assign(document.createElement(tag), props || {});
    (kids || []).forEach(function (k) { if (k) n.append(k); });
    return n;
  }

  function bar(user) {
    var manages = user.role === 'owner' || user.role === 'manager';
    var links = manages
      ? [['/overview', 'Overview'], ['/eod', 'EOD Deep Dive'], ['/scorecard', 'Scorecard'], ['/eod-report', 'Submit EOD']]
      : [['/eod-report', 'Submit EOD'], ['/scorecard', 'My scorecard']];
    var here = location.pathname.replace(/\/$/, '') || '/';
    if (/^\/(setter-eod|dialler-eod|closer-outcome)$/.test(here)) here = '/eod-report';
    var nav = el('nav', { className: 'authbar__nav' }, links.map(function (l) {
      return el('a', { href: l[0], textContent: l[1], className: here === l[0] ? 'on' : '' });
    }));
    var out = el('button', { type: 'button', className: 'authbar__out', textContent: 'Log out' });
    out.onclick = function () {
      fetch('/api?source=auth_logout', { method: 'POST' }).finally(function () { location.href = '/login'; });
    };
    var right = el('div', { className: 'authbar__who' }, [
      el('span', { className: 'authbar__name', textContent: user.name }),
      el('span', { className: 'authbar__role', textContent: ROLE_NAME[user.role] || user.role }),
      out,
    ]);
    if (user.role === 'owner') {
      var gear = el('a', { href: '/settings', className: 'authbar__gear' + (here === '/settings' ? ' on' : ''), title: 'Settings' });
      gear.setAttribute('aria-label', 'Settings');
      gear.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03z"/></svg>';
      right.append(gear);
    }
    return el('div', { className: 'authbar' }, [nav, right]);
  }

  var CSS = '.authbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;max-width:1500px;margin:0 auto 6px;padding:0 0 10px;'
    + 'border-bottom:1px solid var(--border,var(--rule-2,#e5e5e5));font-family:inherit;text-align:left}'
    + '.authbar__nav{display:flex;gap:2px;flex-wrap:wrap}'
    + '.authbar__nav a{padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;color:var(--text-dim,var(--ink-2,#525252));white-space:nowrap}'
    + '.authbar__nav a:hover{color:var(--text,var(--ink,#0a0a0a))}'
    + '.authbar__nav a.on{color:var(--accent,#EF4444);background:color-mix(in srgb,var(--accent,#EF4444) 10%,transparent)}'
    + '.authbar__who{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text-dim,var(--ink-2,#525252))}'
    + '.authbar__name{font-weight:600;color:var(--text,var(--ink,#0a0a0a))}'
    + '.authbar__role{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:2px 8px;border-radius:999px;border:1px solid var(--border,var(--rule-2,#e5e5e5))}'
    + '.authbar__out{font:inherit;font-size:13px;font-weight:600;color:inherit;background:none;border:1px solid var(--border,var(--rule-2,#e5e5e5));border-radius:8px;padding:7px 12px;cursor:pointer}'
    + '.authbar__out:hover,.authbar__gear:hover,.authbar__gear.on{color:var(--accent,#EF4444);border-color:var(--accent,#EF4444)}'
    + '.authbar__gear{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border:1px solid var(--border,var(--rule-2,#e5e5e5));border-radius:8px;color:inherit}'
    + '.authbar__gear svg{width:18px;height:18px}'
    + '.authbar a:focus-visible,.authbar button:focus-visible{outline:2px solid var(--accent,#EF4444);outline-offset:2px}';

  window.EOD_AUTH = fetch('/api?action=me', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.status !== 'ok') { location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search)); return never; }
      if (allow.indexOf(d.user.role) < 0) { location.replace(d.home); return never; }
      window.EOD_USER = d.user;
      ready(function () {
        document.head.append(el('style', { textContent: CSS }));
        document.body.prepend(bar(d.user));
        document.querySelectorAll('[data-roles]').forEach(function (node) {
          if (node.dataset.roles.split(',').indexOf(d.user.role) < 0) node.remove();
        });
        root.style.visibility = '';
      });
      return d.user;
    })
    .catch(function () { root.style.visibility = ''; return never; });
})();
