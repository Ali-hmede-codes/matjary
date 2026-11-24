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
      display: grid;
      place-items: center;
      padding: 24px;
      background: #f4f6f1;
      color: #202e29;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
    }
    .card {
      width: 100%;
      max-width: 380px;
      padding: 34px 30px 26px;
      background: #fff;
      border: 1px solid #e2e8dd;
      border-radius: 22px;
      box-shadow: 0 18px 45px rgba(32, 46, 41, .06);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 28px;
      font-size: 16px;
      font-weight: 650;
      letter-spacing: -.02em;
    }
    .mark {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: 10px;
      background: #254e40;
      color: #d9ecc0;
      font-size: 15px;
      font-weight: 700;
    }
    .logo { width: 32px; height: 32px; border-radius: 10px; object-fit: cover; }
    h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.25; letter-spacing: -.02em; }
    .intro { margin: 0 0 22px; color: #66736c; font-size: 14px; }
    .google { min-height: 44px; display: flex; justify-content: center; }
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
    @media (max-width: 420px) { .card { padding: 28px 22px 22px; } }
  </style>
  <script src="/api/v1/auth/client.js" defer></script>
</head>
<body>
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
