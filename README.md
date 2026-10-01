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

## Requirements

- macOS. The vault is the login keychain, driven through `/usr/bin/security`.
- Tailscale, with `tailscale serve` available to your user and HTTPS
  certificates enabled for the tailnet (admin console, DNS, HTTPS
  Certificates). Without certificates, every page refuses to start unless
  you pass `--http`, and the home page doesn't run at all.
- python3 (3.9 or later).

## Install

Clone the repo somewhere (these examples use `~/src/keydrop`), then install a
copy from `origin/main`:

    mkdir -p ~/.local/bin
    t=$(mktemp) && git -C ~/src/keydrop fetch -q origin && git -C ~/src/keydrop show origin/main:keydrop > "$t" && install -m 0755 "$t" ~/.local/bin/keydrop && rm -f "$t"

The line takes the file from `origin/main` by ref, not from the working tree,
so a checked-out branch or an uncommitted edit can't end up installed. Re-run
it to upgrade. `~/.local/bin` needs to be on your PATH.

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
    keydrop vault [--ttl 15m] [--http]
    keydrop get <name>
    keydrop list
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
and leaves a flag that keeps the page down. Five bad requests in 24 hours lock
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

The full design, and the reasoning behind each check, is in
`skills/keydrop-setup/SKILL.md` and the docstring at the top of `keydrop`.

What it defends against:

- **The value reaching a chat, a log or argv.** It goes from the browser to
  keydrop, then to `security -i` on stdin as hex. Logs hold only name, time
  and outcome. Every write is read back before the page says "Stored".
- **Other people on the tailnet.** Every request needs the owner's
  `Tailscale-User-Login`, which `tailscale serve` sets and peers can't forge.
  Lookalike spellings of that header are refused.
- **Guessing the link.** The token is 256 bits, compared in constant time.
  Wrong guesses lock the page.
- **Browsers on the Mac.** An exact Host allowlist stops DNS rebinding. Form
  tokens and Fetch Metadata stop cross-site posts, and a cross-site request
  can't run up strikes on the home page.
- **A loopback port left open to the tailnet.** Under userspace networking,
  tailscaled forwards tailnet traffic to `127.0.0.1:<same port>` when serve
  doesn't claim it. keydrop uses the same port on both sides, listens only
  after the route exists, and checks on every request that the route is
  still its own, exiting if not.
- **Leftover routes.** Teardown on every exit path, a reap for killed
  processes, and a narrow sweep for orphaned keydrop routes.
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

Neither suite touches a real keychain or a real tailnet. `security` is a fake
(`tests/fakes.py`) that keeps items in a JSON file, and `tailscale` is a stub
that keeps the serve config in another JSON file. Pages run on 127.0.0.1, and
the suites send the headers serve would set. They do bind loopback ports and
spawn background processes, and they need `plutil` and `git`.

The fakes copy today's output formats, so after a macOS or Tailscale upgrade,
do one request by hand.

## Agent skill

`skills/keydrop-setup/SKILL.md` teaches a coding agent to install and
configure keydrop and to ask for secrets through it instead of in chat.

## License

MIT. See `LICENSE`.
