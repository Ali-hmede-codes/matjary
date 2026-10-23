export const USER_DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>My dashboard · Matjary</title>
  <link rel="stylesheet" href="/api/v1/dashboard/style.css">
  <script src="/api/v1/dashboard/client.js" defer></script>
</head>
<body>
  <a class="skip" href="#content">Skip to your dashboard</a>
  <header class="header">
    <a class="brand" href="/"><span class="mark" aria-hidden="true">m</span>matjary <small>MY WORKSPACE</small></a>
    <div class="header-actions"><a href="/">Explore feed</a><button id="logout" type="button">Sign out</button></div>
  </header>
  <main class="shell">
    <section class="welcome" aria-labelledby="welcome-title">
      <div><span class="eyebrow">YOUR SPACE, YOUR STORY</span><h1 id="welcome-title">My dashboard</h1><p>Your stores, your content, and a little room to grow.</p></div>
      <div class="profile"><span id="avatar" class="avatar" aria-hidden="true">m</span><div><strong id="account-name">Your account</strong><span id="account-email">Checking your session…</span></div></div>
    </section>
    <nav id="navigation" class="navigation" aria-label="Your workspace">
      <a href="#overview" data-view="overview">Overview</a>
      <a href="#stores" data-view="stores">My stores</a>
      <a href="#posts" data-view="posts">My posts</a>
      <a href="#products" data-view="products">My products</a>
      <a href="#subscription" data-view="subscription">My subscription</a>
    </nav>
    <div class="section-heading"><div><h2 id="view-title">Overview</h2><p id="view-description">Only your own account activity appears here.</p></div><button id="refresh" type="button">Refresh</button></div>
    <p id="status" role="status" aria-live="polite">Loading your dashboard…</p>
    <div id="content" tabindex="-1" aria-busy="true"></div>
    <div id="pagination" class="pagination" hidden><button id="previous" type="button">Previous</button><span id="page-label"></span><button id="next" type="button">Next</button></div>
    <noscript>Enable JavaScript to view your dashboard. <a href="/api/v1/auth/login">Return to sign-in</a>.</noscript>
    <footer>Your personal workspace · <a href="/pricing">Explore plans</a></footer>
  </main>
</body>
</html>`;

export const USER_DASHBOARD_CSS = String.raw`
* { box-sizing: border-box; }
:root { color-scheme: light; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #183d34; background: #f5f4ef; }
body { margin: 0; }
a { color: inherit; text-underline-offset: 4px; }
button, a { -webkit-tap-highlight-color: transparent; }
button { font: inherit; font-size: 13px; font-weight: 600; color: #183d34; background: #fff; border: 1px solid #d6ddd4; border-radius: 10px; padding: 10px 16px; cursor: pointer; }
button:hover { background: #eaf0e4; }
button:disabled { opacity: .5; cursor: default; }
:focus-visible { outline: 3px solid #709352; outline-offset: 4px; }
[hidden] { display: none !important; }
.skip { position: absolute; left: 16px; top: -70px; background: white; padding: 12px; z-index: 2; }
.skip:focus { top: 12px; }
.header { background: #fff; min-height: 84px; padding: 20px max(24px, calc((100% - 1120px) / 2)); display: flex; align-items: center; justify-content: space-between; gap: 20px; border-bottom: 1px solid #e2e5dc; }
.brand { display: flex; gap: 10px; align-items: center; font-size: 23px; font-weight: 650; letter-spacing: -.8px; text-decoration: none; }
.mark { display: grid; place-items: center; background: #183d34; color: #d5edb1; width: 35px; height: 35px; border-radius: 11px; }
.brand small { letter-spacing: 1.4px; font-size: 9px; font-weight: 500; padding-left: 14px; margin-left: 8px; border-left: 1px solid #d6ddd4; }
.header-actions { display: flex; gap: 24px; align-items: center; font-size: 13px; }
.shell { max-width: 1168px; padding: 40px 24px 20px; margin: auto; }
.welcome { background: #183d34; color: #fff; border-radius: 24px; padding: 36px; display: flex; align-items: center; justify-content: space-between; gap: 30px; }
.eyebrow { color: #d5edb1; font-size: 10px; letter-spacing: 2px; }
h1 { font-size: clamp(28px, 4vw, 38px); font-weight: 550; letter-spacing: -1.3px; margin: 12px 0; overflow-wrap: anywhere; }
.welcome p { color: #c5d3c9; font-size: 14px; line-height: 1.7; margin-bottom: 0; }
.profile { display: flex; align-items: center; gap: 12px; min-width: 0; }
.avatar { width: 44px; height: 44px; flex-shrink: 0; border-radius: 50%; background: #d5edb1; color: #183d34; display: grid; place-items: center; font-size: 20px; }
.profile strong, .profile span:not(.avatar) { display: block; font-size: 13px; overflow-wrap: anywhere; }
.profile span:not(.avatar) { color: #c5d3c9; font-size: 12px; margin-top: 5px; }
.navigation { display: flex; gap: 8px; padding: 24px 0; overflow-x: auto; border-bottom: 1px solid #dde1d6; }
.navigation a { flex-shrink: 0; text-decoration: none; padding: 11px 18px; border-radius: 10px; font-size: 13px; }
.navigation a[aria-current="page"] { background: #e1eaca; font-weight: 650; }
.section-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin: 28px 0 0; }
h2 { font-size: 23px; font-weight: 550; letter-spacing: -.6px; margin: 0; }
h3 { font-size: 17px; font-weight: 600; margin: 0; overflow-wrap: anywhere; }
p { line-height: 1.7; }
.section-heading p, .muted { color: #69776c; font-size: 13px; }
#status { color: #69776c; font-size: 13px; min-height: 20px; margin: 12px 0; }
#status.error { color: #a1372b; }
.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-bottom: 28px; }
.stat, .card { background: #fff; border: 1px solid #e0e5da; border-radius: 16px; padding: 24px; }
.stat strong { display: block; font-size: 32px; font-weight: 500; margin: 8px 0; }
.stat small { color: #69776c; font-size: 12px; }
.cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.card p { font-size: 13px; color: #69776c; overflow-wrap: anywhere; }
.card a { display: inline-block; font-size: 13px; font-weight: 600; margin-top: 10px; }
.badge { display: inline-block; padding: 5px 9px; background: #edf2e6; border-radius: 7px; font-size: 11px; text-transform: capitalize; white-space: nowrap; }
.subheading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 28px 0 16px; }
.subheading a { font-size: 12px; }
.table-wrap { overflow-x: auto; background: #fff; border: 1px solid #e0e5da; border-radius: 16px; }
table { width: 100%; text-align: left; border-collapse: collapse; font-size: 13px; }
th { font-size: 11px; font-weight: 600; color: #69776c; background: #fafbf7; }
th, td { padding: 16px 20px; border-bottom: 1px solid #eef0e9; }
td:first-child { min-width: 180px; max-width: 350px; overflow-wrap: anywhere; }
tr:last-child td { border-bottom: 0; }
.empty { padding: 40px 24px; border: 1px dashed #ced6c7; border-radius: 16px; color: #69776c; font-size: 14px; text-align: center; }
.limits { margin: 20px 0 0; }
.limits div { display: flex; justify-content: space-between; gap: 20px; padding: 12px 0; border-top: 1px solid #eef0e9; font-size: 13px; }
.limits dt { color: #69776c; }
.limits dd { margin: 0; font-weight: 600; }
.pagination { display: flex; justify-content: center; align-items: center; gap: 18px; margin: 24px 0; font-size: 13px; }
footer { padding: 36px 0 14px; text-align: center; color: #69776c; font-size: 12px; }
@media (max-width: 760px) { .header { padding: 16px; } .brand small, .header-actions > a { display: none; } .shell { padding: 20px 16px; } .welcome { padding: 24px; align-items: flex-start; flex-direction: column; gap: 24px; } .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; } .stat, .card { padding: 20px; } .cards { grid-template-columns: 1fr; } .navigation { margin-right: -16px; padding-right: 16px; } }
`;
