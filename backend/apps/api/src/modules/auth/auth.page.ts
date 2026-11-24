// A self-contained sign-in page served by the API itself, so the login screen
// still loads when the static frontend is missing or is being replaced by a
// release. It deliberately stays small: one card, one Google button, no build
// step. Styles are inline because the CSP allows `style-src 'unsafe-inline'`;
// the script is a separate same-origin route because inline scripts are not
// allowed (`script-src` has no `'unsafe-inline'`).
export const AUTH_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="robots" content="noindex, nofollow">
  <title>Sign in</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      min-height: 100dvh;
      display: flex;
      justify-content: center;
      padding: clamp(16px, 4vw, 28px);
      background:
        radial-gradient(rgba(37, 78, 64, .08) 1.4px, transparent 1.5px) 0 0 / 26px 26px,
        radial-gradient(120% 90% at 6% 0%, #e8f2d7 0%, rgba(232, 242, 215, 0) 55%),
        radial-gradient(120% 90% at 100% 100%, #dbeee3 0%, rgba(219, 238, 227, 0) 55%),
        #f5f7f0;
      color: #202e29;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
    }
    /* Clipped outside the viewport, so the drifting blobs never add a
       scrollbar on a narrow phone. */
    .decor { position: fixed; inset: 0; overflow: hidden; pointer-events: none; }
    .decor::before,
    .decor::after { content: ''; position: absolute; border-radius: 50%; }
    .decor::before {
      top: -220px;
      left: -150px;
      width: 520px;
      height: 520px;
      background: radial-gradient(circle, rgba(183, 217, 138, .55), rgba(183, 217, 138, 0) 68%);
      animation: drift 18s ease-in-out infinite alternate;
    }
    .decor::after {
      right: -170px;
      bottom: -190px;
      width: 460px;
      height: 460px;
      background: radial-gradient(circle, rgba(133, 199, 170, .45), rgba(133, 199, 170, 0) 68%);
      animation: drift 22s ease-in-out infinite alternate-reverse;
    }
    .card {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 392px;
      margin: auto;
      padding: 34px 32px 28px;
      background:
        radial-gradient(120% 90% at 14% 0%, rgba(214, 236, 178, .5), rgba(214, 236, 178, 0) 62%),
        linear-gradient(180deg, #fff, #fcfdf8);
      border: 1px solid rgba(37, 78, 64, .09);
      border-radius: 24px;
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, .9),
        0 30px 70px -34px rgba(37, 78, 64, .38),
        0 10px 24px -18px rgba(37, 78, 64, .25);
      animation: rise .55s cubic-bezier(.2, .8, .2, 1) backwards;
      transition: transform .35s ease, box-shadow .35s ease;
    }
    .card:hover {
      transform: translateY(-3px);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, .9),
        0 36px 80px -34px rgba(37, 78, 64, .42),
        0 12px 28px -18px rgba(37, 78, 64, .28);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 26px;
      font-size: 16px;
      font-weight: 650;
      letter-spacing: -.02em;
    }
    .mark {
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border-radius: 11px;
      background: #254e40;
      color: #d9ecc0;
      font-size: 15px;
      font-weight: 700;
    }
    .logo {
      width: 34px;
      height: 34px;
      border-radius: 11px;
      object-fit: cover;
      box-shadow: 0 0 0 4px rgba(183, 217, 138, .22);
    }
    /* A lime highlighter stroke keeps the ink dark (contrast) while breaking
       the plain white page. */
    h1 {
      display: inline-block;
      margin: 0 0 14px;
      padding: 0 2px;
      font-size: 25px;
      line-height: 1.25;
      letter-spacing: -.02em;
      background: linear-gradient(transparent 68%, rgba(183, 217, 138, .55) 68%);
    }
    .intro { margin: 0 0 22px; color: #66736c; font-size: 14px; }
    .google { min-height: 44px; display: flex; justify-content: center; animation: fade .4s ease backwards; }
    .status { min-height: 20px; margin: 12px 0 0; color: #6b766f; font-size: 13px; }
    .status.error { color: #a03a2b; }
    .account {
      margin: 0 0 18px;
      padding: 14px 16px;
      border: 1px solid #e2e8dd;
      border-radius: 12px;
    }
    .account strong { display: block; font-size: 14px; }
    .account span { color: #66736c; font-size: 13px; overflow-wrap: anywhere; }
    .primary {
      display: block;
      padding: 12px 16px;
      border-radius: 12px;
      background: #254e40;
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      text-align: center;
      text-decoration: none;
    }
    .primary:hover { background: #1d3f33; }
    .link {
      margin-top: 16px;
      padding: 0;
      border: 0;
      background: none;
      color: #597457;
      font: inherit;
      font-size: 13px;
      text-decoration: underline;
      cursor: pointer;
    }
    .link:disabled { opacity: .55; cursor: wait; }
    .footnote { margin: 24px 0 0; color: #8a958e; font-size: 12px; }
    :focus-visible { outline: 3px solid #95b971; outline-offset: 3px; border-radius: 6px; }
    [hidden] { display: none !important; }
    @keyframes rise {
      from { opacity: 0; transform: translateY(16px) scale(.985); }
      to { opacity: 1; transform: none; }
    }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes drift {
      from { transform: translate3d(0, 0, 0) scale(1); }
      to { transform: translate3d(46px, 34px, 0) scale(1.08); }
    }
    @media (prefers-reduced-motion: reduce) {
      .card, .google, .decor::before, .decor::after { animation: none; }
      .card { transition: none; }
    }
    @media (max-width: 420px) {
      .card { padding: 30px 24px 24px; }
    }
  </style>
  <script src="/api/v1/auth/client.js" defer></script>
</head>
<body>
  <span class="decor" aria-hidden="true"></span>
  <main class="card">
    <div class="brand">
      <span class="mark" id="mark" aria-hidden="true">M</span>
      <img class="logo" id="logo" alt="" hidden>
      <span id="site-name">Matjari</span>
    </div>
    <section id="signed-out">
      <h1>Sign in</h1>
      <p class="intro">Continue with Google to open your studio. No password needed.</p>
      <div class="google" id="google-button"></div>
      <p class="status" id="status" role="status" aria-live="polite">Checking your session…</p>
      <button class="link" id="retry" type="button" hidden>Try again</button>
    </section>
    <section id="signed-in" hidden>
      <h1>You’re signed in</h1>
      <p class="intro">Your account is ready on this device.</p>
      <div class="account">
        <strong id="display-name"></strong>
        <span id="email"></span>
      </div>
      <a class="primary" id="continue" href="/dashboard">Continue</a>
      <button class="link" id="logout" type="button">Sign out</button>
    </section>
    <noscript><p class="status error">Enable JavaScript to sign in with Google.</p></noscript>
    <p class="footnote">Your account is created the first time you continue with Google.</p>
  </main>
</body>
</html>`;

export const AUTH_SCRIPT = String.raw`'use strict';
(() => {
  const el = (id) => document.getElementById(id);
  let identityScript;
  let busy = false;
  const message = (text, error = false) => {
    const status = el('status');
    status.textContent = text;
    status.classList.toggle('error', error);
    el('retry').hidden = !error;
  };
  const showSignedOut = () => {
    el('signed-out').hidden = false;
    el('signed-in').hidden = true;
  };
  const showSignedIn = (user, isAdmin) => {
    el('signed-out').hidden = true;
    el('signed-in').hidden = false;
    el('display-name').textContent = (user && (user.displayName || user.email)) || '';
    el('email').textContent = (user && user.email) || '';
    el('continue').href = isAdmin === true ? '/admin' : '/dashboard';
  };
  async function api(path, body) {
    const response = await fetch('/api/v1/auth/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === undefined
        ? { Accept: 'application/json' }
        : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(
        data && typeof data.message === 'string'
          ? data.message
          : 'Unable to complete this request. Please try again.',
      );
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function loadGoogle() {
    if (window.google && window.google.accounts) return Promise.resolve();
    if (!identityScript) {
      identityScript = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const fail = () => {
          script.remove();
          reject(new Error('Google could not load. Check your connection or content blocker, then try again.'));
        };
        const timeout = setTimeout(fail, 12000);
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.onload = () => {
          clearTimeout(timeout);
          resolve();
        };
        script.onerror = () => {
          clearTimeout(timeout);
          fail();
        };
        document.head.appendChild(script);
      }).catch((error) => {
        identityScript = undefined;
        throw error;
      });
    }
    return identityScript;
  }
  // The live branding belongs to the public settings API, so this page keeps
  // its plain wordmark when that read fails.
  async function loadBranding() {
    try {
      const response = await fetch('/api/v1/settings/website', { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const settings = await response.json();
      const name = settings && typeof settings.siteName === 'string' ? settings.siteName.trim() : '';
      if (name) {
        el('site-name').textContent = name;
        el('mark').textContent = name.charAt(0).toUpperCase();
        document.title = 'Sign in — ' + name;
      }
      const logo = settings && typeof settings.logoUrl === 'string' ? settings.logoUrl : '';
      if (!logo) return;
      const url = new URL(logo, window.location.origin);
      // The CSP allows only same-origin images, so an external logo is skipped
      // instead of leaving a broken image on the card.
      if (url.origin !== window.location.origin) return;
      const image = el('logo');
      image.addEventListener('load', () => {
        image.hidden = false;
        el('mark').hidden = true;
      });
      image.src = url.href;
    } catch (error) {
      // Branding is cosmetic; the wordmark stays usable.
    }
  }
  async function complete(response) {
    if (busy || !response || !response.credential) return;
    busy = true;
    message('Signing you in…');
    try {
      const session = await api('google', { credential: response.credential });
      showSignedIn(session.user, session.isAdmin);
    } catch (error) {
      message(error.message, true);
    } finally {
      busy = false;
    }
  }
  async function renderSignIn() {
    message('Preparing Google sign-in…');
    el('google-button').replaceChildren();
    const challenge = await api('bootstrap', {});
    await loadGoogle();
    window.google.accounts.id.initialize({
      client_id: challenge.clientId,
      nonce: challenge.nonce,
      callback: (response) => { void complete(response); },
      auto_select: false,
      ux_mode: 'popup',
    });
    window.google.accounts.id.renderButton(el('google-button'), {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      width: Math.min(320, el('google-button').clientWidth || 280),
    });
    message('Choose your Google account to continue.');
  }
  async function start() {
    if (busy) return;
    busy = true;
    showSignedOut();
    message('Checking your session…');
    try {
      let session = null;
      try {
        session = await api('me');
      } catch (error) {
        if (error.status !== 401) throw error;
      }
      if (session) {
        showSignedIn(session.user, session.isAdmin);
        return;
      }
      await loadBranding();
      await renderSignIn();
    } catch (error) {
      message(
        error.name === 'TimeoutError'
          ? 'The request timed out. Please try again.'
          : error.message,
        true,
      );
    } finally {
      busy = false;
    }
  }
  el('retry').addEventListener('click', () => { void start(); });
  el('logout').addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    el('logout').disabled = true;
    try {
      await api('logout', {});
      if (window.google && window.google.accounts) window.google.accounts.id.disableAutoSelect();
      showSignedOut();
      await renderSignIn();
    } catch (error) {
      message(error.message, true);
    } finally {
      busy = false;
      el('logout').disabled = false;
    }
  });
  void start();
})();`;
