---
name: keydrop-setup
description: Set up, adapt or build a "keydrop" for the user, so that secrets (API keys, tokens) move from the human into the macOS keychain through a one-shot link on their tailnet instead of being pasted into chat. Use when the user wants to hand an agent a secret safely, when a task needs a credential you don't have, or when asked to install or port keydrop. Covers the design, the security properties that must hold and why, the known traps, which steps only the human can do, and how to use it day to day.
---

# keydrop: get secrets without asking for them in chat

The rule this skill exists for: **never ask the user to paste a secret into
the conversation, and never echo one into it.** Everything in a chat
transcript, a terminal scrollback or a tool log should be assumed to be
kept, synced and read later. When you need a credential, send a link
instead.

keydrop is that link. A local command prints a one-shot HTTPS URL on the
user's tailnet. The page behind it is one password field. The user opens it
on their phone or laptop, pastes the value, and it goes straight into the
macOS login keychain. The page shuts itself down. You read the value back
with a local command and pass it to whatever needs it, without printing it.

The repo this skill ships in has a working reference implementation:
`keydrop` (one Python file, standard library only), its two test suites in
`tests/`, and a launchd template in `launchd/`. Use it as is, or adapt it to
the user's setup. If you change it, keep every property listed under
"Properties that must hold" and keep the tests passing.

## Dependencies

- **macOS**, for the login keychain and `/usr/bin/security`. On another OS
  you would swap the vault (libsecret, pass, a cloud secret manager). The
  web half carries over; the storage half doesn't.
- **Tailscale**, with `tailscale serve` enabled for the tailnet and **HTTPS
  certificates** turned on (admin console, DNS, HTTPS Certificates). Serve
  is what puts the page on the tailnet and what vouches for who is asking.
- **python3** 3.9 or later. No packages.

## How it works

1. `keydrop request <name> --note "what it's for"` picks a free port P, binds
   127.0.0.1:P, runs `tailscale serve --bg --yes --https=P
   http://127.0.0.1:P`, then starts listening. It prints
   `https://<machine>.<tailnet>.ts.net:P/<token>` and detaches.
2. The user opens the link. Serve terminates TLS, looks up who is connecting,
   sets `Tailscale-User-Login`, and proxies to 127.0.0.1:P.
3. keydrop checks the route, the Host, the login and the token, takes the
   value, writes it with `security -i`, reads it back to confirm, says
   "Stored", removes the serve route and exits.
4. `keydrop get <name>` prints the value for local tools.

`keydrop vault` is the same page held open as a session for listing, adding,
replacing and deleting entries. `keydrop home` is the vault without a TTL,
run by launchd, with a persistent lockout, rate limits and an audit log
standing in for the TTL.

## Properties that must hold

If you build or modify a keydrop, each of these is load-bearing. The reason
is given so you can judge an equivalent on another platform.

1. **The value never touches argv.** `security add-generic-password -w
   VALUE` puts the value on the command line, and any process on the machine
   can read every command line with `ps -axww`. Write with `security -i` and
   send the command on stdin, with the value hex-encoded:
   `add-generic-password -U -a ACCOUNT -s SERVICE -l SERVICE -X <hex>`. Hex
   also removes any quoting problem. Validate the name, account and service
   against strict character sets before building that line, because `-i`
   parses it with shell-like quoting.
2. **Use the `security` binary, not the Security framework from Python.** A
   keychain item's ACL trusts the application that created it. Create an
   item from Python and every later `security find-generic-password` read
   raises a keychain dialog. Created by `security`, `security` reads it back
   silently.
3. **Verify every write by reading it back.** Under `-i`, `security`'s exit
   status is the low 8 bits of an OSStatus. Some failures, and a silent
   no-op update over an old value, come back as 0. Only "the keychain now
   returns exactly this value" counts as stored. If it doesn't match, the
   page must not say "Stored", and the error must not contain either value.
4. **Nothing secret in logs.** Python's `http.server` logs every request
   line by default, and the request line holds the path, which is the
   token. Override `log_message` to do nothing. Log only name, time and
   outcome. Never write the token or the value to the state dir; keep only
   the token's SHA-256 where one must persist.
5. **Pin the login, and refuse lookalike headers.** Accept a request only if
   it carries exactly one `Tailscale-User-Login` and that header equals the
   configured owner login (case-insensitive). Serve strips incoming
   `Tailscale-User-*` headers and sets its own from WhoIs, so a tailnet peer
   can't forge the real one. But serve passes `Tailscale_User_Login`
   (underscores) through untouched, and some stacks treat `_` and `-` the
   same. Refuse the request if any header other than the single real one
   normalises (lowercase, keep only the letters) to `tailscaleuserlogin`. If no
   owner login is configured, refuse to start. Never fall back to open.
6. **Bind, add the route, then listen, on the same port number.** With
   userspace networking (netstack), tailscaled forwards inbound tailnet TCP
   for the node's IP to `127.0.0.1:<same port>` whenever no serve handler
   claims that port. A plain loopback listener can then be reached by every
   peer, with whatever headers they like, and the login pin means nothing.
   Using the tailnet port number for the loopback port, and listening only
   after the route exists, closes that window. A bound socket that isn't
   listening drops the SYN. Refuse a port serve already uses. Offer no
   `--local` mode for the same reason. (This analysis is for netstack. A
   kernel-TUN tailscaled, like the macOS app, probably doesn't forward
   loopback this way, but that hasn't been verified, so keep the ordering.)
7. **Check the route on every request.** Someone can run `tailscale serve
   reset`, or repoint the port, while a page is up. From then on netstack
   forwards peers straight to the listener. So before anything else, every
   request reads `tailscale serve status --json` and checks the route is
   still a single `/` handler proxying to `http://127.0.0.1:<this port>`. If
   it isn't, or the status can't be read or parsed, answer a bare 404 and
   exit. "Couldn't read it" is not evidence that the route is there. A
   long-lived page should also poll while idle.
8. **Exact Host allowlist.** Answer only the tailnet name (with and without
   the port) and `127.0.0.1`/`localhost` on the page's own port. Anything
   else is a DNS-rebinding page in a local browser: bare 404, no strike.
9. **Token in the path, compared in constant time, with a lockout.** 256 bits
   from `secrets.token_urlsafe(32)`, compared with `hmac.compare_digest`
   against its SHA-256. A handful of wrong guesses ends a one-shot page. On
   the always-on page, the strike count persists across restarts, and a
   strike only counts when the request carries the owner's login and a
   same-origin (or absent) `Sec-Fetch-Site`. Otherwise any web page the
   owner visits could lock them out with an `<img>` tag.
10. **Write-only pages, CSRF tokens on every POST.** The vault lists names,
    notes and times and takes new values. It never renders a stored value,
    so a screenshot or the browser cache can't leak one. Every POST needs a
    form token as well as the path token, a cross-site `Sec-Fetch-Site` is
    refused, a GET never changes anything, and delete asks for confirmation
    first. Deletes reach only `<prefix><valid name>` under the configured
    account, never another keychain item.
11. **Tear down on every exit, and reap what SIGKILL leaves behind.** Remove
    the serve route on submit, TTL, lockout, signals and exceptions. Keep a
    record per pending page, so a later command can find routes whose
    process died. A teardown only counts once `serve status` shows the port
    gone; until then keep the record and retry. For routes whose record was
    lost too, keep a ledger of every route you create (written before
    `serve` runs, cleared once the route is confirmed gone) and sweep only
    ledger entries with no live record whose route still points where you
    pointed it. Never sweep by shape: another tool's `serve` route can look
    exactly like yours, and removing it takes their service down.
12. **Never `tailscale funnel`.** The page must not be reachable from the
    internet. The per-request route check also treats Funnel being on for
    the page's port as the route being gone.

## Steps only the human can do

Say so plainly and wait. Don't try to work around any of these.

- **Confirm the owner's tailnet login.** Ask the user which login should be
  allowed to submit values (for example `you@example.com` or
  `someone@github`). Don't guess it from git config, an email address or
  `tailscale status` output. Those (and the admin console) are fine places to
  show the user where to look, but the user decides which login it is. A
  wrong login either locks them out or, worse, lets someone else in. Show
  them what you are about to set and get a yes.
- **Enable Serve and HTTPS certificates** for the tailnet in the Tailscale
  admin console. The first `tailscale serve` on a tailnet may print a URL to
  approve; the user has to open it.
- **Keychain prompts.** If macOS asks to allow access to the login keychain,
  or asks for the keychain password, the human answers. Never script around
  these dialogs.
- **Loading the launchd agent** for the always-on page. It is a
  secret-intake surface that stays up, so the user should load it
  themselves. Hand them the rendered plist and the `launchctl bootstrap`
  line.
- **Refusing to save the value in the browser.** If the browser or a
  password manager offers to save what they typed into a keydrop page, tell
  them to choose "Never" for that site. The field asks it not to
  (`autocomplete="new-password"` plus the managers' opt-out attributes), but
  browsers don't always listen.
- **Bookmarking the home link.** `keydrop home --new-link` prints the link
  once. Have the user run it in their own terminal, or relay it to them over
  a channel they trust, and tell them to bookmark it. Don't store it
  anywhere yourself.

## Installing the reference implementation

1. Clone the repo, for example to `~/src/keydrop`.
2. Install with the README's steps, into `~/.local/bin/keydrop`: fetch,
   show the user the `git log -p` review (or the whole file on a first
   install), and install only the commit they read, never the working tree. Check that `~/.local/bin` is on
   PATH.
3. Write `~/.config/keydrop/config.json` with at least
   `{"owner_login": "<the login the user confirmed>"}`. `config.example.json`
   lists every key. Environment variables (`KEYDROP_OWNER_LOGIN` and so on)
   override the file.
4. Run `keydrop config` and check the output with the user.
5. Do one end-to-end test with a throwaway name: `keydrop request
   keydrop-smoke-test --note "test, paste anything"`, have the user submit
   any string, check that `keydrop get keydrop-smoke-test` returns it
   (compare it in a script, don't print it), then delete it through
   `keydrop vault`.
6. If they want the always-on page: run `keydrop home --new-link` (see
   above), render `launchd/keydrop-home.plist.template` with the README's
   sed line, and hand the `launchctl bootstrap` step to the user.

To run the tests, use `tests/keydrop-test` and `tests/keydrop-home-test`.
They use a fake `security` and a stub `tailscale`, so they touch no real
keychain and no real tailnet. Don't point them, or any experiment of yours,
at the real ones.

## Using it

When a task needs a secret you don't have:

1. Pick a name: lowercase, digits, `.`, `_`, `-`, up to 64 characters. For
   example, `openai-api-key`.
2. Run `keydrop list` first. If the key is already there, use it.
3. Otherwise run `keydrop request openai-api-key --note "for the summariser
   in ~/proj"`, and send the user the printed link with one line saying what
   it's for. Don't say anything that suggests they could paste the value to
   you instead.
4. Wait until the name drops out of `keydrop status`. `request` exits
   immediately, so poll gently or ask the user to tell you when it's done.
   The link expires after 15 minutes by default (`--ttl`, an hour at most).
5. Consume the value without printing it:

       OPENAI_API_KEY="$(keydrop get openai-api-key)" some-command

   Don't `echo` it, don't `cat` a file containing it, and don't put it in a
   file in the repo. If a command would print it, redirect that output. If
   you need to check that it's there, test the exit status of `keydrop get
   name >/dev/null`.

If the user pastes a secret into the chat anyway, don't repeat it. Tell them
it is now in the transcript and suggest they rotate it, then offer a link
for the new one.

## Gotchas from the original

- **`ps` sees argv, and with `-E` your own processes' environment.** A
  value passed as `--key=VALUE` is visible to every local user and process
  for as long as that process runs. On macOS `ps -E` shows the environment
  only for processes you own, so an exported value is exposed to anything
  running as you rather than to everyone, which is still the agent and every
  tool it starts. The reference tests poll `ps -axwwE` during real writes to prove
  the value never shows up.
- **`find-generic-password -g` has two output formats on stderr:**
  `password: "text"` for printable ASCII, and `password: 0xHEX  "..."` for
  anything else, including non-ASCII UTF-8. Parse both, or non-ASCII values
  come back wrong.
- **`dump-keychain` lists attributes without decrypting** (no `-d`), so it
  can list names and times without a prompt. Items start at lines beginning
  `keychain:`. Created and modified times are `cdat`/`mdat`.
- **`tailscale serve` can block forever** if Serve isn't enabled for the
  tailnet. Always run it with a timeout.
- **Notes aren't secrets, and they're stored as plain JSON.** `security -i`
  has no quoting that is safe for free text, so notes live in the state dir.
  Tell users not to put secrets in a note.
- **The fakes in `tests/fakes.py` reproduce today's `security` output.** If
  macOS changes its format, the tests still pass and real reads break.
  After an OS or Tailscale upgrade, do one manual round trip.
- **A kill switch has to check the port, not just its own records.** The
  launchd job reads only the config file. A `home --stop` run with
  `KEYDROP_*` variables pointing at another state dir finds no record and
  no flag to honour there, so it must still look at `serve status` on the
  home port and only report success once nothing there points at the page.
  Run home's `--stop`, `--new-link` and `--unlock` with those variables
  unset.
