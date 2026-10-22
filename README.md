# keydrop

keydrop gets a secret, such as an API key, from you into the macOS login
keychain without anyone pasting it into a chat, a terminal history or a
config file. A local tool or an agent asks for a key by name. keydrop
prints a one-shot link on your tailnet, and the page behind it is a single
password field (or, for a typed item such as a credential, the fields that
type needs). You open the link on a device signed in to your tailnet,
paste the value, or pick a text file such as a `.pem` or `.p8` key, and
submit, and the page shuts itself down. The tool then
reads the value back with `keydrop get <name>`.

It is one Python file with no dependencies beyond the standard library, the
`security` CLI that ships with macOS, and `tailscale`.

This repo holds two things. `SPEC.md` describes what any keydrop must do:
the flow, the item types, the page and its wording, the invariants, the
vault and transport adapter interfaces, and the conformance checks. It is
written so that keydrop can be rebuilt on Linux or Windows, with 1Password,
Bitwarden, pass, KeePassXC or another store, and with or without Tailscale.
The `keydrop` script is the reference implementation of that spec, for macOS,
the login keychain and `tailscale serve`. Section 12 of the spec lists where
it doesn't match the spec yet.

## Requirements

- macOS. The vault is the login keychain, driven through `/usr/bin/security`.
- Tailscale, with `tailscale serve` available to your user and HTTPS
  certificates enabled for the tailnet (admin console, DNS, HTTPS
  Certificates). Without certificates, every page refuses to start unless
  you pass `--http`, and the home page doesn't run at all.
- python3 (3.9 or later).

## Install

Clone the repo somewhere (these examples use `~/src/keydrop`). Installing
and upgrading are the same three steps: fetch, read what changed, then
install exactly the commit you read.

    mkdir -p ~/.local/bin
    git -C ~/src/keydrop fetch -q origin
    sha=$(git -C ~/src/keydrop rev-parse origin/main) && echo "$sha"
    git -C ~/src/keydrop log -p HEAD.."$sha" -- keydrop
    t=$(mktemp) && git -C ~/src/keydrop show "$sha":keydrop > "$t" && install -m 0755 "$t" ~/.local/bin/keydrop && rm -f "$t"

The `log -p` line is the review: every change to `keydrop` between your
checkout and `$sha`. On a first install that range is empty, so read the
file itself instead (`git -C ~/src/keydrop show "$sha":keydrop`). The last
line installs `$sha`, the commit you read, not whatever `origin/main` points
at by then, and never the working tree, so a branch, an uncommitted edit or a
push that lands while you're reading can't end up installed. Afterwards move
the checkout to `$sha` (`git -C ~/src/keydrop merge --ff-only "$sha"`) so the
next review starts from what's installed. `~/.local/bin` needs to be on your
PATH.

## Configure

keydrop reads `~/.config/keydrop/config.json`, or the file named by
`KEYDROP_CONFIG`. Environment variables override the file.

    {
      "owner_login": "you@example.com"
    }

The other keys (`account`, `service_prefix`, `state_dir`, `launchd_label`,
`home_port`, `tailscale`, `tailscale_socket`) have working defaults and are
listed in `config.example.json`. Each one also has an environment variable,
such as `KEYDROP_OWNER_LOGIN`; the docstring at the top of `keydrop` lists
them.

`owner_login` is the Tailscale login of the person who is allowed to submit
values, exactly as `tailscale status` or the admin console shows it. It has
no default. Without it, `request`, `vault` and `home` refuse to start; keydrop
never falls back to accepting any login. `keydrop config` prints the settings
in effect.

## Use

    keydrop request <name> [--note "what it's for"] [--ttl 15m] [--http]
                    [--type secret|credential|<template>] [--fields totp,url,notes]
    keydrop vault [--ttl 15m] [--http]
    keydrop get <name> [--field F]
    keydrop run <name> [--field F]... -- <cmd> [args...]
    keydrop put <name> --generate [--length N] [--username U] [--note "..."] [--replace]
    keydrop put <name> --stdin [--username U] [--note "..."] [--replace]
    keydrop list [--long]
    keydrop status
    keydrop cancel <name>          (cancel vault ends a vault session)
    keydrop home                   always-on vault page, for launchd
    keydrop home --new-link | --stop | --unlock
    keydrop config

Names are lowercase letters, digits, `.`, `_` and `-`, up to 64 characters.
A key named `openai-api-key` is stored as the generic password with service
`keydrop.openai-api-key` and account `keydrop` (with the default prefix and
account).

Asking for a key:

    $ keydrop request openai-api-key --note "for the summariser"
    https://your-mac.your-tailnet.ts.net:61234/3vQx...

`request` prints the link and returns; the page runs in the background. It
stops after one good submit, after the TTL (15 minutes by default, an hour at
most), after five bad requests, or on `keydrop cancel <name>`. `keydrop
status` lists what's still pending. Once the name is gone from `status`,
`keydrop get openai-api-key` prints the value, with no trailing newline when
stdout isn't a terminal, so `KEY=$(keydrop get openai-api-key)` works.

`keydrop vault` prints a session link to a page that lists names, notes and
times and lets you add, replace and delete entries under the service prefix.
It never shows a stored value.

### Storing a value from this machine

`request` is for a value a person has. When the tool or agent on the Mac makes
the value itself (say, the password for an account it is signing up for),
`put` stores it directly, with no link and no page:

    $ keydrop put example-site --generate --username agent@example.com
    stored example-site (username agent@example.com)
    $ some-tool --print-token | keydrop put example-token --stdin
    stored example-token

`--generate` makes a 24-character password (`--length` 12 to 128) of letters,
digits and `-_.!@#%+=`, with at least one of each. `--stdin` reads the value
from a pipe, or prompts without echo at a terminal. Neither ever takes the
value as an argument, and `put` never prints it: read it back with `get`.
`--username` stores a credential exactly as the form would, so policy has to
allow credentials. `put` refuses a name with a request pending, and a name
that already exists unless given `--replace`. `--replace` only works on items
`put` made: anything stored or changed through a page stays out of its reach,
whatever the flags, as long as the agent can only run `keydrop put` and `get`
(one that can edit keydrop's state folder or run `security` itself can get
around it). Every `put` is written to `home-audit.log`.

### Credentials and other typed items

By default every item is a single secret. To accept logins, turn the type on
in `policy.json` in the state dir:

    {"types_enabled": ["secret", "credential"],
     "credential_fields_enabled": ["url", "notes"]}

`keydrop request staging-admin --type credential --fields url` then shows
username, password and website inputs, and `keydrop get staging-admin --field
password` reads one field back. `get` on a typed item without `--field`
refuses, so a careless `get` can't print a username next to its password.
`credential_fields_enabled` limits which optional fields (`totp`, `url`,
`notes`) a request may ask for; leave it out to allow all three. A refused
request exits 2 and opens nothing.

`--type` also takes a built-in template (`api-key`, `username-password`,
`aws`, `google-oauth`, `stripe` and others), and `--fields '<JSON list>'` or
`--schema <file>` proposes any fields an agent needs; the owner can edit the
proposed fields on the page before storing. The type, field names and an
optional rotate-by date are kept in `items.json` in the state dir (mode
0600), never the values. The vault and home pages search items, flag overdue
rotations and show recent activity.

The keychain marks a typed item in its label, so the type survives losing the
state dir. One keychain item holds about 1.9 KB once encoded, because
`security -i` reads at most 4095 characters per command line and the value
goes on it as hex. A bigger item is refused before anything is written, and
an existing value stays as it was.

Every value input, on the request page and on the vault and home pages,
also takes a text file in its place: paste or pick, not both. The file is
stored byte for byte, and the page shows the limit next to the picker. A
field in a `--fields` or `--schema` list can set `"input": "file"` to show
the picker first, for a key that usually arrives as a file:

    keydrop request push-key --fields '[
      {"name": "private_key", "label": "Private key", "kind": "secret",
       "required": true, "input": "file"},
      {"name": "key_id", "label": "Key ID", "kind": "text", "required": true},
      {"name": "team_id", "label": "Team ID", "kind": "text", "required": true}]'

The file's name is never kept, and only UTF-8 text is accepted.

### Handing a value to a command without printing it

`get` prints the value, so whatever called it has the value in its output. An
agent that only needs to pass a password on, say into a login form, can use
`run` instead:

    keydrop run <name> [--field F]... -- <cmd> [args...]

keydrop starts `<cmd>` without a shell, writes the value to its stdin and
closes it. A secret goes as its raw bytes. A credential needs at least one
`--field` and goes as one JSON object holding only those fields, such as
`{"username": "...", "password": "..."}`. The value is never in the command's
arguments or environment, and keydrop never prints it. The command's own
output passes through, and `run` exits with the command's status. keydrop's
own errors start with `keydrop: `; a missing item or field fails before the
command starts, and a command that can't be found exits 127.

This keeps the value out of keydrop's output, not out of the command's: the
command can do whatever it likes with what it reads, so only run commands
you trust with it.

`contrib/fill-login.mjs` is an example command. It signs a browser profile in
to a site:

    keydrop run example-site --field username --field password --field url -- \
      node contrib/fill-login.mjs --profile ~/.local/state/browser-profiles/example-site \
        --url https://example.com/login

It opens `--url` in a Chromium window using the persistent profile in
`--profile`, finds the username and password inputs (or uses
`--user-selector` and `--pass-selector`), fills them, submits, and prints
status lines only, never the values: `filled`, then `signed in`, `timed out
waiting for the sign-in to finish` or `browser closed`, or `no login form
found` and similar if it couldn't fill. The window is headed so a person can
finish a second factor; it closes once the page has left the login flow, or
after `--timeout` seconds (300 by default). The signed-in session stays in
the profile directory for whatever opens it next.

The credential needs its website stored in its `url` field (request it with
`--fields url`) and passed on with `--field url`; without it the filler
refuses. `--url` has to be https and on the same site (scheme, host
and port) as the stored website, and the page has to still be on that site
after loading and again right before each field is filled, so a login page
that redirects to a separate sign-in domain needs `--url` set to that page.
The password only goes into an `input type=password`, whatever
`--pass-selector` matches, and both fields have to be in the site's own page,
not a frame inside it; selectors can't contain `>>` or `internal:`, which is
how Playwright reaches into frames. `--allow-http-localhost` also accepts plain http to
this machine, for testing against a local page. It needs Node and Playwright,
which isn't bundled:

    npm install playwright && npx playwright install chromium

### The home page under launchd

`keydrop home` is the vault page without a TTL, meant to stay up. Set it up
once:

    keydrop home --new-link        # prints the link once; bookmark it
    sed -e "s#__LABEL__#local.keydrop.home#" \
        -e "s#__PYTHON__#$(command -v python3)#" \
        -e "s#__KEYDROP__#$HOME/.local/bin/keydrop#" \
        -e "s#__LOG__#$HOME/.local/state/keydrop/home.launchd.log#" \
        ~/src/keydrop/launchd/keydrop-home.plist.template \
        > ~/Library/LaunchAgents/local.keydrop.home.plist
    launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.keydrop.home.plist

The label must match `launchd_label` in the config. Use an absolute path for
python3, because launchd doesn't read your shell's PATH.

### Stopping and unlocking

`keydrop home --stop` (or the Stop button on the page) takes the route down
and leaves a flag that keeps the page down. It only reports success once
`serve status` shows no route on the home port still pointing at the page.
The flag lives in the state dir, and the launchd job reads only the config
file, so run `--stop`, `--new-link` and `--unlock` without `KEYDROP_*`
variables set: `--new-link` and `--unlock` refuse while any is set (add
`--force` if you mean it), and `--stop` warns. A broken `owner_login` or
`account` setting doesn't block `--stop`; a broken `state_dir` or `home_port`
does, since it would aim the stop at the wrong page. Five bad requests in 24 hours lock
it the same way, and a restart doesn't clear the lock. Both exit 0, so launchd
leaves the job stopped. To bring it back:

    keydrop home --unlock
    launchctl kickstart gui/$(id -u)/local.keydrop.home

To remove it, run `keydrop home --stop` first, then `launchctl bootout
gui/$(id -u)/local.keydrop.home`. Don't remove the home port's serve route by
hand while the page is up.

`keydrop home --new-link` replaces the link without a restart. The old one
stops working.

## Threat model

The invariants every implementation keeps are in `SPEC.md` section 4. The
reasoning behind each check in this implementation is in the docstring at the
top of `keydrop`.

What it defends against:

- **The value reaching a chat, a log or argv.** It goes from the browser to
  keydrop, then to `security -i` on stdin as hex. Logs hold only name, time
  and outcome. Every write is read back before the page says "Stored".
- **Other people on the tailnet.** Every request needs the owner's
  `Tailscale-User-Login`, which `tailscale serve` sets and peers can't forge.
  Lookalike spellings of that header are refused.
- **Guessing the link.** The token is 256 bits, compared in constant time.
  On a one-shot request or vault link, 5 bad requests (a wrong token, or no
  owner login) end the link early. On the home page only a wrong token sent
  with the owner's login and same-origin or direct-navigation Fetch Metadata
  counts; 5 of those in 24 hours lock it until `keydrop home --unlock`.
  Anything else gets a bare 404 and isn't counted.
- **Browsers on the Mac.** An exact Host allowlist stops DNS rebinding. Form
  tokens and Fetch Metadata stop cross-site posts, and a cross-site request
  can't run up strikes on the home page.
- **A loopback port left open to the tailnet.** Under userspace networking,
  tailscaled forwards tailnet traffic to `127.0.0.1:<same port>` when serve
  doesn't claim it. keydrop uses the same port on both sides, listens only
  after the route exists, and checks on every request that the route is
  still its own, exiting if not.
- **Leftover routes.** Teardown on every exit path and a reap for killed
  processes. keydrop keeps a ledger of every serve route it creates
  (`routes.json` in the state dir) and only ever sweeps ledger entries no
  live record owns, and only while the route still points where keydrop
  pointed it. A route keydrop didn't create is never removed, whatever it
  looks like.
- **Funnel.** If Funnel gets turned on for a page's port, the page treats its
  route as gone: it answers a bare 404 and exits.
- **Reading values through the page.** The vault and home pages are
  write-only.

What it doesn't defend against:

- **Anything running as you on the Mac.** It can run `keydrop get` or
  `security`. keydrop protects the way into the keychain, not the keychain.
- **Local processes connecting to 127.0.0.1**, which can send any header.
  They still need the token.
- **A compromised device signed in as the owner**, or anyone holding the
  link. Treat the link like a short-lived password.
- **A compromised tailscaled or tailnet admin.**
- **Untested setups.** The port analysis was worked out against tailscaled
  with userspace networking. A kernel-TUN tailscaled, such as the macOS app,
  hasn't been analysed.

Notes from the vault page are stored in plain text in the state dir, so
don't put secrets in them.

## Tests

    tests/keydrop-test
    tests/keydrop-home-test
    tests/keydrop-management-test
    tests/fill-login-test

No suite touches a real keychain or a real tailnet. `security` is a fake
(`tests/fakes.py`) that keeps items in a JSON file, and `tailscale` is a stub
that keeps the serve config in another JSON file. Pages run on 127.0.0.1, and
the suites send the headers serve would set. They do bind loopback ports and
spawn background processes, and they need `plutil` and `git`.

`tests/fill-login-test` covers `contrib/fill-login.mjs`'s refusals against a
local page. Its browser cases need Playwright where the filler can find it
(for example via `NODE_PATH`) and are skipped otherwise.

The fakes copy today's output formats, so after a macOS or Tailscale upgrade,
do one request by hand.

## Agent skill

`skills/keydrop-setup/SKILL.md` is written for any coding agent, in any
harness. It walks the agent through taking stock of the machine, choosing a
vault and transport (the reference implementation where it fits, adapters
built to `SPEC.md` where it doesn't), proving conformance, and then asking
for secrets through a link instead of in chat.

## Contributing

We'd love feedback and new use cases, from a vault we haven't covered to a
harness that wants credentials. Open an issue describing what you're trying
to do. `CONTRIBUTING.md` has the steps for contributing an adapter or item
type and says how contributions are reviewed.

## License

MIT. See `LICENSE`.
