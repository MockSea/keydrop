# keydrop

keydrop gets a secret, such as an API key, from you into the macOS login
keychain without anyone pasting it into a chat, a terminal history or a
config file. A local tool or an agent asks for a key by name. keydrop
prints a one-shot link on your tailnet, and the page behind it is a single
password field. You open the link on a device signed in to your tailnet,
paste the value and submit, and the page shuts itself down. The tool then
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
state dir. One keychain item holds about 1.9 KB once encoded; a bigger item is
refused before anything is written, and an existing value stays as it was.

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

No suite touches a real keychain or a real tailnet. `security` is a fake
(`tests/fakes.py`) that keeps items in a JSON file, and `tailscale` is a stub
that keeps the serve config in another JSON file. Pages run on 127.0.0.1, and
the suites send the headers serve would set. They do bind loopback ports and
spawn background processes, and they need `plutil` and `git`.

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
