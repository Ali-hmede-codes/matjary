// Self-contained starter UI, bundled with the API until a full frontend is added.
export const AUTH_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Welcome to Matjary</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f5f4ef; color: #183d34; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .shell { min-height: 100svh; display: grid; grid-template-columns: 1fr 1fr; padding: 24px; gap: 24px; }
    .story { background: #183d34; color: #f9f8ed; border-radius: 28px; padding: 44px; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; }
    .brand { display: flex; align-items: center; gap: 12px; font-size: 22px; font-weight: 650; letter-spacing: -.7px; }
    .mark { background: #d5edb1; color: #183d34; width: 36px; height: 36px; border-radius: 11px; display: grid; place-items: center; font-size: 23px; }
    .story-main { padding: 70px 0; max-width: 480px; }
    .eyebrow { color: #d5edb1; font-size: 12px; letter-spacing: 2px; text-transform: uppercase; }
    h1 { font-size: clamp(38px, 4.5vw, 64px); line-height: 1.09; font-weight: 500; letter-spacing: -2.6px; margin: 22px 0; }
    .story p { color: #c5d3c9; line-height: 1.8; max-width: 350px; }
    .showcase { display: flex; gap: 12px; margin-top: 32px; align-items: end; }
    .tile { width: 94px; height: 110px; border-radius: 18px; background: #326151; display: grid; place-items: center; }
    .tile:nth-child(2) { height: 136px; background: #d5edb1; color: #183d34; }
    .tile:nth-child(3) { background: #efe6d3; color: #183d34; }
    .tile svg { width: 50px; height: 50px; fill: none; stroke: currentColor; stroke-width: 1.4; }
    .footnote { color: #c5d3c9; font-size: 12px; }
    .content { display: flex; align-items: center; justify-content: center; padding: 32px; }
    .card { width: 100%; max-width: 390px; }
    .badge { display: inline-block; border: 1px solid #d7ddd2; border-radius: 99px; padding: 7px 12px; font-size: 11px; letter-spacing: .7px; margin-bottom: 20px; }
    h2 { font-size: 34px; font-weight: 550; letter-spacing: -1.2px; margin: 0 0 12px; }
    .intro { color: #6e7a70; font-size: 15px; line-height: 1.75; margin: 0 0 28px; }
    .button-wrap { min-height: 44px; display: flex; justify-content: center; margin: 24px 0; }
    .note { border-top: 1px solid #dde1d6; padding-top: 24px; margin-top: 28px; color: #738075; font-size: 13px; line-height: 1.7; }
    .status { color: #627166; min-height: 22px; font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
    .status.error { color: #9d3b2c; }
    button.action { background: #183d34; color: white; border: 0; border-radius: 12px; padding: 13px 24px; font: inherit; cursor: pointer; margin-top: 16px; }
    button:disabled { opacity: .55; cursor: wait; }
    button:focus-visible { outline: 3px solid #95b971; outline-offset: 4px; }
    .profile { background: white; border: 1px solid #e1e5db; border-radius: 16px; padding: 20px; margin: 24px 0; overflow-wrap: anywhere; }
    .profile strong { display: block; margin-bottom: 6px; }
    .profile span { color: #6e7a70; font-size: 14px; }
    [hidden] { display: none !important; }
    @media (max-width: 760px) { .shell { grid-template-columns: 1fr; padding: 14px; gap: 10px; } .story { padding: 26px; border-radius: 20px; } .story-main { padding: 24px 0 0; } h1 { font-size: 36px; max-width: 330px; letter-spacing: -1.5px; } .story-main p, .showcase, .footnote { display: none; } .content { padding: 34px 16px; align-items: start; } h2 { font-size: 30px; } }
  </style>
  <script src="/api/v1/auth/client.js" defer></script>
</head>
<body>
  <main class="shell">
    <section class="story" aria-label="About Matjary">
      <div class="brand"><span class="mark" aria-hidden="true">m</span> matjary</div>
      <div class="story-main">
        <span class="eyebrow">A home for your products</span>
        <h1>Your next chapter starts here.</h1>
        <p>One account for your Matjary journey. Bring your ideas, your products, and your own point of view.</p>
        <div class="showcase" aria-hidden="true">
          <div class="tile"><svg viewBox="0 0 50 50"><path d="M12 18h26l3 25H9l3-25Z M18 19v-7a7 7 0 0 1 14 0v7"/></svg></div>
          <div class="tile"><svg viewBox="0 0 50 50"><rect x="6" y="7" width="38" height="36" rx="6"/><circle cx="17" cy="18" r="4"/><path d="m8 37 12-11 8 6 8-13 8 13"/></svg></div>
          <div class="tile"><svg viewBox="0 0 50 50"><path d="m25 5 5 14 15 6-15 5-5 15-6-15-14-5 14-6 6-14Z"/></svg></div>
        </div>
      </div>
      <div class="footnote">Your products. Your story. Your space.</div>
    </section>
    <section class="content" aria-label="Your account">
      <div class="card">
        <div id="signed-out">
          <span class="badge">LET’S GET YOU STARTED</span>
          <h2>Welcome to Matjary</h2>
          <p class="intro">Sign in or create your account with Google.<br>No extra password to remember.</p>
          <div id="google-button" class="button-wrap"></div>
          <p class="note">New here? Your account is created automatically the first time you continue with Google. Continue to your personal dashboard; authorized administrators have a separate admin workspace.</p>
          <details class="note"><summary>Setting up Google sign-in for this server</summary><p>In Google Auth Platform, configure branding and audience, then create a Web application client. Register this site's exact origin under Authorized JavaScript origins. Set GOOGLE_CLIENT_ID, APP_ORIGIN, and your administrator email in ADMIN_EMAILS in the server's private environment, then restart the API. Add your account as a test user if your Google audience settings require it. Use localhost consistently for local development and HTTPS in production. This sign-in flow needs no Google password or client secret.</p></details>
        </div>
        <div id="signed-in" hidden>
          <span class="badge">YOU’RE SIGNED IN</span>
          <h2>Make yourself at home.</h2>
          <p class="intro">Your Matjary account is ready.</p>
          <div class="profile"><strong id="display-name"></strong><span id="email"></span></div>
          <button id="logout" class="action" type="button">Sign out</button>
          <p class="note">You can return anytime using the same Google account.</p>
        </div>
        <p id="status" class="status" role="status" aria-live="polite">Checking your session…</p>
        <button id="retry" class="action" type="button" hidden>Try again</button>
        <noscript>Enable JavaScript to sign in with Google.</noscript>
      </div>
    </section>
  </main>
</body>
</html>`;

export const AUTH_SCRIPT = String.raw`'use strict';
(() => {
  const el = (id) => document.getElementById(id);
  let googleScript;
  let busy = false;
  const message = (text, error = false) => {
    el('status').textContent = text;
    el('status').classList.toggle('error', error);
  };
  const showUser = (user) => {
    el('signed-out').hidden = Boolean(user);
    el('signed-in').hidden = !user;
    el('display-name').textContent = user ? user.displayName : '';
    el('email').textContent = user ? user.email : '';
    el('retry').hidden = true;
    message(user ? 'Your session is securely saved on this device.' : '');
  };
  function openDashboard(data) {
    showUser(data.user);
    window.location.replace(data.isAdmin === true ? '/api/v1/admin' : '/api/v1/dashboard/home');
  }
  async function api(path, body) {
    const response = await fetch('/api/v1/auth/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = response.status === 204 ? null : await response.json();
    if (!response.ok) {
      const error = new Error(typeof data.message === 'string' ? data.message : 'Unable to complete this request. Please try again.');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function loadGoogle() {
    if (window.google && window.google.accounts) return Promise.resolve();
    if (!googleScript) {
      googleScript = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const fail = () => { script.remove(); reject(new Error('Google could not load. Check your connection or content blocker, then try again.')); };
        const timeout = setTimeout(fail, 12000);
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.onload = () => { clearTimeout(timeout); resolve(); };
        script.onerror = () => { clearTimeout(timeout); fail(); };
        document.head.appendChild(script);
      }).catch((error) => { googleScript = undefined; throw error; });
    }
    return googleScript;
  }
  function failure(error) {
    message(error.name === 'TimeoutError' ? 'The request timed out. Please try again.' : error.message, true);
    el('retry').hidden = false;
  }
  async function credentialReceived(result) {
    if (busy) return;
    busy = true;
    message('Signing you in…');
    el('google-button').hidden = true;
    try {
      const data = await api('google', { credential: result.credential });
      openDashboard(data);
    } catch (error) {
      failure(error);
    } finally {
      busy = false;
    }
  }
  async function prepareLogin() {
    message('Preparing secure Google sign-in…');
    el('google-button').replaceChildren();
    el('google-button').hidden = false;
    const config = await api('bootstrap', {});
    await loadGoogle();
    window.google.accounts.id.initialize({
      client_id: config.clientId,
      nonce: config.nonce,
      callback: credentialReceived,
      auto_select: false,
      ux_mode: 'popup',
    });
    window.google.accounts.id.renderButton(el('google-button'), {
      type: 'standard', theme: 'outline', size: 'large', text: 'continue_with',
      shape: 'pill', width: Math.min(350, el('google-button').clientWidth),
    });
    message('Choose your Google account to continue.');
  }
  async function initialize() {
    if (busy) return;
    busy = true;
    el('retry').hidden = true;
    message('Checking your session…');
    try {
      try {
        const data = await api('me');
        openDashboard(data);
        return;
      } catch (error) {
        if (error.status !== 401) throw error;
      }
      showUser(null);
      await prepareLogin();
    } catch (error) { failure(error); }
    finally { busy = false; }
  }
  el('retry').addEventListener('click', initialize);
  el('logout').addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    el('logout').disabled = true;
    try {
      await api('logout', {});
      if (window.google && window.google.accounts) window.google.accounts.id.disableAutoSelect();
      showUser(null);
      await prepareLogin();
    } catch (error) { failure(error); }
    finally { busy = false; el('logout').disabled = false; }
  });
  initialize();
})();`;
