---
name: keydrop-setup
description: Set up a "keydrop" on whatever machine the user has, so that secrets (API keys, tokens and, where policy allows, username and password credentials) move from the human into a local vault through a one-shot link instead of being pasted into chat. Use when the user wants to hand an agent a secret safely, when a task needs a credential you don't have, or when asked to install, port or adapt keydrop. Works in any agent harness. Covers taking stock of the machine, choosing or building vault and transport adapters, proving conformance against SPEC.md, the steps only the human can do, and day-to-day use.
---

# keydrop: get secrets without asking for them in chat

The rule this skill exists for: **never ask the user to paste a secret into
the conversation, and never echo one into it.** Assume everything in a chat
transcript, a terminal scrollback or a tool log is kept, synced and read
later. When you need a secret, send a link instead.

A keydrop prints a one-shot link. The page behind it is a small form. The
user opens it on a device they trust, fills it in, and the value goes straight
into a vault on this machine. The page shuts down. You read the value back by
name with a local command and pass it on without printing it.

The repo this skill ships in has:

- `SPEC.md`, which is the authority. It fixes the flow, the item types, the
  page and its exact wording, the invariants, the adapter interfaces and the
  conformance checks. When this skill and the spec disagree, the spec wins.
- `keydrop`, the reference implementation: one Python file for macOS, the
  login keychain and `tailscale serve`, with two test suites in `tests/`.
- `reference/page.html`, every screen the page can show.

Your job has four parts: take stock of the machine, choose adapters, get a
conforming implementation in place, and prove it conforms. Then use it.

## 1. Take stock of the machine

Find out what is there before proposing anything. Look; don't install,
unlock, sign in or read any secret while doing it.

Check for:

- **OS and shell.** `uname -a` or `ver`, and which shell you're in.
- **Vault candidates.** Which of these exist and are already in use:
  - macOS: `/usr/bin/security` (login keychain).
  - Linux: `secret-tool` and a running Secret Service (GNOME Keyring,
    KWallet), `pass` with an initialised store, `keepassxc-cli`.
  - Windows: Credential Manager (through `CredWriteW` from PowerShell or a
    language binding).
  - Any OS: `op` (1Password), `bw` (Bitwarden), `keepassxc-cli`, a vault
    server or cloud secret manager the user already uses.
  - What the user's other tools already read from. A vault nothing else uses
    is a vault the user will forget about.
- **Transport candidates.**
  - `tailscale` with `tailscale serve` available and HTTPS certificates on.
  - An identity-aware proxy the user already runs in front of this machine.
- **Runtimes.** Which languages are installed, so an implementation doesn't
  need new ones.

Show the user a short inventory: what you found for vaults, transports and
runtimes, and anything you were unsure about. Ask before probing anything
that would prompt them (an unlock dialog, a sign-in).

## 2. Choose adapters

Use `SPEC.md` sections 8 and 9.

**Vault.** Prefer, in order:

1. the store the user already keeps secrets in, if it can receive values by
   one of the routes in spec 8.2 (stdin, a file descriptor, or an in-process
   API);
2. the OS store (login keychain, Secret Service, Credential Manager);
3. `pass` or KeePassXC, if the user already uses them.

Rule a store out if the only way to write it is a value on a command line
or a temporary file. Check each CLI's actual behaviour on the installed
version. Don't rely on memory for which flags read stdin: read `--help`, and
test with a throwaway value against a scratch store, never the user's real
vault. A scratch store is a temporary `PASSWORD_STORE_DIR` for `pass`, a
throwaway keychain (`security create-keychain` on a temp path, deleted
after) or a new KeePassXC database. Where the store can't be scratched (a
signed-in 1Password or Bitwarden account), ask the user before touching it,
and say exactly what you'll create and delete. This is the same rule as
step 4.1.

**Transport.** Prefer:

1. a tailnet with an identity header (`tailscale serve`, Funnel off);
2. another authenticated proxy that injects a verified identity.

Never use anything in spec 9.4: no public unauthenticated URL, no Funnel, no
ngrok or cloudflared quick tunnel without authentication, no listener on
`0.0.0.0` or a LAN address, no plain HTTP across a network, and no
"localhost only" page or SSH port forward. A loopback listener can be
reached by tailnet peers under userspace networking and by any local
process, and nothing proves who sent a request (spec Q1). If nothing on the
machine qualifies, say so and stop. Don't improvise a weaker one.

**Policy.** Ask the user which item types to turn on. `secret` is the
default. `credential` (username, password, optional TOTP seed, website and
notes) is off unless they turn it on, and they can allow credentials while
leaving out fields such as TOTP seeds.

Write the choice down for the user in a few lines: vault, transport, types,
and why. Get a yes before building anything.

## 3. Get an implementation in place

**If the machine is macOS with Tailscale,** install the reference
implementation:

1. Clone the repo, for example to `~/src/keydrop`.
2. Install with the README's steps, into `~/.local/bin/keydrop`: fetch, show
   the user the `git log -p` review (or the whole file on a first install),
   and install only the commit they read, never the working tree. Check that
   `~/.local/bin` is on PATH.
3. Write `~/.config/keydrop/config.json` with at least
   `{"owner_login": "<the login the user confirmed>"}`. `config.example.json`
   lists every key.
4. Run `keydrop config` and check the output with the user.

The reference has no credential type yet (spec section 12). If the user
turned credentials on, tell them, and either add the type to the reference
following the spec or leave credentials for later.

**Otherwise, build one.** Implement `SPEC.md`:

- the command interface in section 6, with the same names and flags, so that
  this skill and any other harness can drive it;
- the page from section 7 exactly, using the shell, copy and states from the
  spec and `reference/page.html`;
- a vault adapter (8.1) and a transport adapter (9.1) for what you chose.

Port the reference's request handling, checks and teardown instead of
writing them from memory: the order of checks, the lookalike-header refusal,
the constant-time token comparison, the route check on every request, and the
teardown ledger each exist because of a real failure. The docstring at the
top of `keydrop` explains them. Keep the implementation small, and keep its
dependencies to what the machine already has.

## 4. Prove conformance

Before the user relies on it:

1. **Fakes first.** Build a fake vault and a stub transport (spec 10.1) and
   run every check in spec 10.2 that applies. For the reference, that is
   `tests/keydrop-test`, `tests/keydrop-home-test` and
   `tests/keydrop-management-test`. Never point a test, or
   any experiment of yours, at the real vault or the real transport.
2. **One real round trip** with a throwaway name (spec 10.3): `keydrop
   request keydrop-smoke-test --note "test, paste anything"`, have the user
   submit any string, check that `keydrop get keydrop-smoke-test` returns it
   by comparing in a script without printing it, then delete it. For
   credentials, do one round trip per enabled optional field.
3. **Write the report** in the shape of spec 10.4 and show it to the user:
   adapters and versions, every check with pass, fail or not applicable, and
   the round trip. A failed check means it isn't ready. Fix it or tell the
   user what's left; don't ship around it.

After any upgrade of the OS, the vault tool or the transport, do the round
trip again. The fakes copy today's output formats, so the tests keep passing
when the real tools change.

## Steps only the human can do

Say so plainly and wait. Don't try to work around any of these.

- **Confirm the owner's login.** Ask which login is allowed to submit values
  (for a tailnet, something like `you@example.com` or `someone@github`).
  Don't guess it from git config, an email address or `tailscale status`.
  Those are fine places to show the user where to look, but the user decides.
  A wrong login either locks them out or lets someone else in. Show them what
  you are about to set and get a yes.
- **Turn on the transport.** For Tailscale: enable Serve and HTTPS
  certificates in the admin console, and open the approval URL the first
  `tailscale serve` may print. For a proxy: configure its authentication.
- **Unlock prompts.** Keychain dialogs, vault master passwords, `op signin`,
  `bw unlock`, GPG passphrases: the human answers all of them. Never script
  around them and never ask for the master password in chat.
- **Choosing policy.** Which item types are on, and whether a weaker
  transport is acceptable, are the user's calls.
- **Loading a service.** An always-on page (`keydrop home` under launchd, a
  systemd user unit, a Windows scheduled task) stays up as a way into the
  vault, so the user loads it themselves. Hand them the rendered file and the
  command.
- **Refusing to save in the browser.** If the browser or a password manager
  offers to save what they typed into a keydrop page, tell them to choose
  "Never" for that site. The page asks it not to, but browsers don't always
  listen.
- **Bookmarking the home link.** `keydrop home --new-link` prints the link
  once. Have the user run it in their own terminal, or relay it over a channel
  they trust. Don't store it anywhere yourself.

## Using it

When a task needs a secret you don't have:

1. Pick a name: lowercase letters, digits, `.`, `_`, `-`, up to 64
   characters. For example, `openai-api-key`.
2. Run `keydrop list` first. If the item is already there, use it.
3. Otherwise ask for it:

       keydrop request openai-api-key --note "for the summariser in ~/proj"

   or, for a login where policy allows credentials:

       keydrop request staging-admin --type credential --fields url --note "staging dashboard"

   Send the user the printed link with one line saying what it's for. Don't
   say anything that suggests they could paste the value to you instead.
4. Wait until the name drops out of `keydrop status`. `request` returns
   immediately, so poll gently or ask the user to tell you when it's done. The
   link expires after 15 minutes by default (`--ttl`, an hour at most).
5. Consume the value without printing it:

       OPENAI_API_KEY="$(keydrop get openai-api-key)" some-command
       PASS="$(keydrop get staging-admin --field password)" some-command

   Don't `echo` it, don't `cat` a file containing it, and don't put it in a
   file in the repo. If a command would print it, redirect that output. To
   check it exists, look for the name in `keydrop list` (`get` on a credential
   without `--field` fails even when the item is there).

If the user pastes a secret into the chat anyway, don't repeat it. Tell them
it is now in the transcript and suggest they rotate it, then offer a link for
the new one.

## Gotchas

- **`ps` shows argv to everyone, and environments to the same user.** A
  value passed as `--key=VALUE` is visible to every local process while that
  process runs. An exported value is visible to anything running as the user.
  The reference tests poll the process table during real writes to prove the
  value never shows up there.
- **Exit codes lie.** Some vault CLIs report success for a failed or no-op
  write. The reference's `security -i` returns only the low 8 bits of an
  OSStatus. That's why every store is read back and compared.
- **Tools echo their input.** Some CLIs repeat what they were given in an
  error. Never pass a tool's stderr to the page or a log unchecked.
- **The vault's ACL may trust its creator.** On macOS, an item created from
  Python prompts on every later read by `security`; one created by `security`
  doesn't. Other stores have their own version of this. Find out which binary
  should create items.
- **Output formats differ.** `security find-generic-password -g` prints
  `password: "text"` for printable ASCII and `password: 0xHEX "..."` for
  anything else. Other CLIs have their own quirks. Parse every format the
  tool can produce.
- **Listing without decrypting.** Prefer a list call that returns names and
  times without reading values (`security dump-keychain` without `-d`, for
  example), so listing never prompts.
- **What reaches the listener when the route is missing.** Under userspace
  networking, tailscaled forwards unclaimed tailnet ports to
  `127.0.0.1:<same port>`. That's why the reference binds, adds the route,
  then listens, on the same port number, checks the route on every request,
  and offers no `--local` mode. Ask the same question of any transport.
- **Transport CLIs can block.** `tailscale serve` can hang forever when Serve
  isn't enabled. Run transport commands with a timeout.
- **Requester notes aren't secret.** They're shown on the page and stored in
  plain text. Tell users not to put secrets in a note. (A credential's own
  `notes` field is a different thing and is stored as part of the item.)
- **A kill switch has to check the route.** Stopping the home page must check
  the transport's real state as well as its own records, and report success
  only once nothing points at the page. In the reference, run home's
  `--stop`, `--new-link` and `--unlock` with `KEYDROP_*` variables unset.
