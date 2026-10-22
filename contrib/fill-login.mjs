#!/usr/bin/env node
// fill-login.mjs: sign a browser profile in to a site with a credential read
// from stdin, for `keydrop run`. An example consumer of SPEC 6.2, not part of
// keydrop itself.
//
//   keydrop run example-site --field username --field password --field url -- \
//     node contrib/fill-login.mjs --profile ~/.local/state/browser-profiles/example-site \
//       --url https://example.com/login
//
// stdin is one JSON object with `password` and/or `username`, and `url`, the
// credential's stored website. Without `url` it refuses: --url has to be on
// the site the credential was stored for, and the page has to stay there
// before each field is filled. The values go into the page's form fields and
// nowhere else: never argv, never the environment, never this script's
// output, not even their lengths. Output is status lines only.
//
// It runs headed, because the person usually has a second factor to enter.
// The window stays open until the page has left the login flow (no password
// or one-time-code field, and a different URL), the window is closed, or
// --timeout passes. The signed-in session stays in --profile for whatever
// opens that profile next.
//
// Playwright isn't bundled. It's looked up next to this file, then from the
// current directory, NODE_PATH and node's global modules.

import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const USAGE = `usage: keydrop run <name> --field username --field password -- \\
  node fill-login.mjs --profile <dir> --url <login url>
    [--user-selector <css>] [--pass-selector <css>] [--timeout <seconds>] [--headless]
    [--allow-http-localhost]   (testing only: also accept http://localhost and 127.0.0.1)`;

const USER_SELECTORS = [
  'input[autocomplete~="username"]',
  'input[autocomplete~="email"]',
  'input[type="email"]',
  'input[name="username" i]', 'input[name="email" i]', 'input[name="login" i]',
  'input[id="username" i]', 'input[id="email" i]', 'input[id="login" i]',
];
const PASS_SELECTOR = 'input[type="password"]';
const CODE_SELECTOR = 'input[autocomplete="one-time-code"]';
const SUBMIT_IN_FORM = "xpath=ancestor::form[1]//*[self::button[not(@type) or @type='submit']"
  + " or self::input[@type='submit']]";

const FIELD_WAIT_MS = 10_000;     // for a login form to render, or a second step to appear
const SETTLE_MS = 2_000;          // after a submit, before looking at the result
const POLL_MS = 500;
const DEFAULT_TIMEOUT_S = 300;    // long enough for a person to find their phone
const STDIN_MAX = 64 * 1024;

// Exit codes: 0 left the login flow, 1 didn't, 2 usage or input, 3 no Playwright.
const EXIT = { ok: 0, failed: 1, usage: 2, setup: 3 };

function status(line) {
  process.stdout.write(`${line}\n`);
}

function fail(line, code) {
  process.stderr.write(`fill-login: ${line}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = { timeout: DEFAULT_TIMEOUT_S, headless: false, httpLocal: false };
  const takes = { "--url": "url", "--profile": "profile", "--user-selector": "userSelector",
                  "--pass-selector": "passSelector", "--timeout": "timeout" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--headless") opts.headless = true;
    else if (a === "--allow-http-localhost") opts.httpLocal = true;
    else if (a === "-h" || a === "--help") { status(USAGE); process.exit(EXIT.ok); }
    else if (takes[a] && i + 1 < argv.length) opts[takes[a]] = argv[++i];
    // Never echo an argument: a value passed by mistake would end up in a log.
    else fail(`unexpected argument\n${USAGE}`, EXIT.usage);
  }
  if (!opts.url || !opts.profile) fail(`--url and --profile are required\n${USAGE}`, EXIT.usage);
  opts.timeout = Number(opts.timeout);
  if (!Number.isFinite(opts.timeout) || opts.timeout <= 0) fail("--timeout takes seconds", EXIT.usage);
  opts.origin = loginOrigin(opts.url, "--url", opts.httpLocal);
  return opts;
}

// https only. Plain http to this machine needs --allow-http-localhost, which
// is for testing against a local page.
function loginOrigin(raw, what, httpLocal) {
  let u;
  try { u = new URL(raw); } catch { fail(`${what} is not a URL`, EXIT.usage); }
  if (u.protocol === "https:") return u.origin;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol === "http:" && local && httpLocal) return u.origin;
  fail(`${what} must be https`, EXIT.usage);
}

// The page is still on the site --url names. Checked after loading and again
// immediately before each field is filled.
function onSite(page, opts) {
  try { return new URL(page.url()).origin === opts.origin; } catch { return false; }
}

// Whatever selector found it, the password only goes into a password input,
// never a text or search box that could carry it into a URL or history.
async function isPasswordInput(el) {
  return el.evaluate((e) => e instanceof HTMLInputElement && e.type === "password").catch(() => false);
}

async function readCredential() {
  if (process.stdin.isTTY) fail("pipe the credential in, e.g. with keydrop run", EXIT.usage);
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > STDIN_MAX) fail("stdin is too large", EXIT.usage);
    chunks.push(chunk);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { data = null; }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    fail("stdin is not a JSON object (run keydrop with --field username --field password)", EXIT.usage);
  }
  const pick = (k) => (typeof data[k] === "string" && data[k] !== "" ? data[k] : null);
  const cred = { username: pick("username"), password: pick("password"), url: pick("url") };
  if (!cred.username && !cred.password) fail("stdin has no username or password", EXIT.usage);
  if (!cred.url) fail("the credential has no stored website (run keydrop with --field url)", EXIT.usage);
  return cred;
}

async function loadPlaywright() {
  const prefix = path.dirname(path.dirname(process.execPath));
  const bases = [
    import.meta.url,
    path.join(process.cwd(), "noop.js"),
    path.join(prefix, "lib", "node_modules", "noop.js"),        // unix global installs
    path.join(path.dirname(process.execPath), "node_modules", "noop.js"),   // windows
  ];
  for (const name of ["playwright", "playwright-core"]) {
    for (const base of bases) {
      let resolved;
      try { resolved = createRequire(base).resolve(name); } catch { continue; }
      const mod = await import(pathToFileURL(resolved).href);
      const chromium = mod.chromium ?? mod.default?.chromium;
      if (chromium) return chromium;
    }
  }
  return null;
}

async function firstVisible(page, selectors, waitMs) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    for (const sel of selectors) {
      const all = page.locator(sel);
      const n = await all.count().catch(() => 0);
      for (let i = 0; i < n; i++) {
        const el = all.nth(i);
        if (await el.isVisible().catch(() => false)) return el;
      }
    }
    if (Date.now() >= deadline) return null;
    await page.waitForTimeout(POLL_MS);
  }
}

async function submit(field) {
  const button = field.locator(SUBMIT_IN_FORM).first();
  if (await button.isVisible().catch(() => false)) await button.click();
  else await field.press("Enter");
}

// Still in the login flow: a password or one-time-code field is showing, or
// we haven't left the URL the form was on.
async function inLoginFlow(page, formUrl) {
  if (page.isClosed()) return false;
  if (page.url() === formUrl) return true;
  for (const sel of [PASS_SELECTOR, CODE_SELECTOR]) {
    if (await page.locator(sel).first().isVisible().catch(() => false)) return true;
  }
  return false;
}

const OFF_SITE = "page moved to another site; not filling";
const NOT_PASSWORD = "the password selector isn't a password field; not filling";

// Fills username and password and submits. There is no second-factor step to
// fill: a one-time code is left for the person at the window.
async function fill(page, opts, cred) {
  const userSelectors = opts.userSelector ? [opts.userSelector] : USER_SELECTORS;
  const passSelectors = [opts.passSelector ?? PASS_SELECTOR];
  let pass = cred.password ? await firstVisible(page, passSelectors, FIELD_WAIT_MS) : null;
  const user = cred.username ? await firstVisible(page, userSelectors, pass ? 0 : FIELD_WAIT_MS) : null;
  if (cred.username && !user && !pass) return "no login form found";
  if (pass && !(await isPasswordInput(pass))) return NOT_PASSWORD;
  if (user) {
    if (!onSite(page, opts)) return OFF_SITE;
    await user.fill(cred.username);
  }
  if (cred.password && !pass && user) {
    // Two-step sign-in: the username goes first and the password field follows.
    await submit(user);
    pass = await firstVisible(page, passSelectors, FIELD_WAIT_MS);
  }
  if (cred.password && !pass) return "no password field found";
  if (pass) {
    if (!(await isPasswordInput(pass))) return NOT_PASSWORD;
    if (!onSite(page, opts)) return OFF_SITE;
    await pass.fill(cred.password);
    await submit(pass);
  } else {
    await submit(user);
  }
  return "filled";
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cred = await readCredential();
  // The credential knows its site: refuse to type it into a different one.
  const stored = loginOrigin(cred.url, "the credential's url", opts.httpLocal);
  if (stored !== opts.origin) fail("--url is not the credential's site", EXIT.usage);
  const chromium = await loadPlaywright();
  if (!chromium) {
    fail("Playwright isn't installed. Install it where this runs, e.g.\n"
      + "  npm install playwright && npx playwright install chromium", EXIT.setup);
  }
  mkdirSync(opts.profile, { recursive: true, mode: 0o700 });   // it will hold session cookies

  let context;
  try {
    context = await chromium.launchPersistentContext(opts.profile, { headless: opts.headless });
  } catch (e) {
    fail(`couldn't start the browser: ${String(e.message).split("\n")[0]}`, EXIT.setup);
  }
  let closing = false;
  const shutdown = async (code) => {
    if (closing) return;
    closing = true;
    await context.close().catch(() => {});
    process.exit(code);
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => { status("stopped"); shutdown(EXIT.failed); });
  }

  let outcome;
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(opts.url, { waitUntil: "domcontentloaded" });
    const formUrl = page.url();
    outcome = onSite(page, opts) ? await fill(page, opts, cred) : OFF_SITE;
    cred.username = cred.password = null;
    status(outcome);
    if (outcome !== "filled") return shutdown(EXIT.failed);

    await page.waitForTimeout(SETTLE_MS);
    const deadline = Date.now() + opts.timeout * 1000;
    while (Date.now() < deadline) {
      if (page.isClosed()) {
        status("browser closed");
        return shutdown(EXIT.failed);
      }
      if (!(await inLoginFlow(page, formUrl))) {
        status("signed in");
        return shutdown(EXIT.ok);
      }
      await page.waitForTimeout(POLL_MS).catch(() => {});
    }
    status("timed out waiting for the sign-in to finish");
    return shutdown(EXIT.failed);
  } catch {
    // Playwright's messages can quote the page and the call; say nothing of either.
    if (!closing) status(outcome === "filled" ? "browser closed" : "couldn't fill the form");
    return shutdown(EXIT.failed);
  }
}

main();
