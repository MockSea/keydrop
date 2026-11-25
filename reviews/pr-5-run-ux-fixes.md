# Fixes for the UX review of PR 5 (KEY-7)

- Review file: `reviews/pr-5-run-ux.md`, committed at `acdad492ab9192d4f011d0bae91621dc0701d46b`
  on branch `card/key-4` ("review: UX review of PR 5 (keydrop run and fill-login) at cc194a8").
  It reviewed `cc194a81a5b931b830f5a36cb1bbc7ae4a74db35` and lists 9 findings.
- PR 5 head the fixes are based on: `cc194a81a5b931b830f5a36cb1bbc7ae4a74db35`
  (`origin/feat/run-fill` and `refs/pull/5/head`, read with `git fetch` and `git ls-remote` on
  2026-11-25). It is the same commit the review covered, so every finding was checked against it
  and all 9 still applied.
- Branch: `card/key-7`, one commit on top of that head.

## Findings

| Finding | Severity | Outcome | Change |
|---|---|---|---|
| M1 fill-login usage and stdin hint leave out `--field url` | medium | fixed | `USAGE` and the "stdin is not a JSON object" hint in `contrib/fill-login.mjs` now say `--field username --field password --field url` |
| M2 no local way to store the `url` field | medium | fixed | `put --url SITE` (only with `--username`) stores the credential's `url` field, checked as the form checks it; README, SPEC 6 table and 6.1, `keydrop --help` and the skill describe it |
| M3 the agent skill doesn't mention `run` | medium | fixed | `skills/keydrop-setup/SKILL.md` step 5 puts `run` first, with the fill-login line as the login example, and keeps `get` for consumers that need an environment variable |
| L1 a missing field doesn't say which fields exist | low | fixed | `get --field` and `run --field` on a credential without that field print `Field is absent: <name> has <field ids>.` The `--field` argument is still not echoed |
| L2 "couldn't start the command: not found" gives no hint | low | fixed | message is now `couldn't start the command: not found (the first word after --, run without a shell)`; argv still not echoed |
| L3 README doesn't say where to install Playwright | low | fixed | README names the search order and the three options; `.gitignore` covers `node_modules/`, `package.json`, `package-lock.json` |
| L4 fill-login's exit codes aren't in the README | low | fixed | README lists 0, 1, 2, 3 and how to tell them from keydrop's own codes |
| N1 `run --help` reports a usage error | nit | fixed | `-h`/`--help` before `--` (and not as a `--field` id) prints the `keydrop --help` text, exit 0, for `run` and for `put` (not when it is the value of `--username` or `--note`) |
| N2 `--url must be https` doesn't mention the localhost flag | nit | fixed | for plain http to localhost/127.0.0.1/[::1] without the flag: `--url must be https (or pass --allow-http-localhost for a local test page)` |

Not changed, on purpose: an invalid `--url` on `put` exits 1 (`A URL doesn't look right.`), the
same path and status as any other form-validation failure `put` inherits from `submitted_item`.

## Reproduction steps rerun on card/key-7

Environment as in the review: the suite's fake `security` (`tests/fakes.py`) and a scratch
`KEYDROP_STATE_DIR`, `KEYDROP_CONFIG` and `KEYDROP_TAILSCALE`; policy allows credentials. Dummy
values only: `demo-secret` = `DUMMY-SECRET-zz91` (put --stdin), `demo-cred` = username
`dummy@example.com`, password `DUMMY-PASS-k3` (put --stdin --username, no url). The login page was
a local server on 127.0.0.1:18765 (form at `/login`, posts to `/done`; its log records field
names only). Playwright 1.x was reached through `NODE_PATH` from another local project, as in the
review. `out|` is stdout, `err|` is stderr.

### M1

    $ node contrib/fill-login.mjs --help
      out| usage: keydrop run <name> --field username --field password --field url -- \
      out|   node fill-login.mjs --profile <dir> --url <login url>
      out|     [--user-selector <css>] [--pass-selector <css>] [--timeout <seconds>] [--headless]
      out|     [--allow-http-localhost]   (testing only: also accept http://localhost and 127.0.0.1)
      exit 0
    $ node contrib/fill-login.mjs --url http://127.0.0.1:18765/login --allow-http-localhost
      err| fill-login: --url and --profile are required
      err| usage: keydrop run <name> --field username --field password --field url -- \
      err|   node fill-login.mjs --profile <dir> --url <login url>
      err|     [--user-selector <css>] [--pass-selector <css>] [--timeout <seconds>] [--headless]
      err|     [--allow-http-localhost]   (testing only: also accept http://localhost and 127.0.0.1)
      exit 2
    $ node contrib/fill-login.mjs --profile <scratch>/profiles/x --url http://127.0.0.1:18765/login --allow-http-localhost --headless
      err| fill-login: stdin is not a JSON object (run keydrop with --field username --field password --field url)
      exit 2

### M2

The review's reproduction (the skill's sign-up example, then the README's run line), with
`--url` added and the local page in place of example.com:

    $ keydrop put example-site --generate --username agent@example.com --url http://127.0.0.1:18765
      out| stored example-site (username agent@example.com)
      exit 0
    $ keydrop run example-site --field username --field password --field url -- node contrib/fill-login.mjs --profile <scratch>/profiles/example-site --url http://127.0.0.1:18765/login --allow-http-localhost --headless
      out| filled
      out| signed in
      exit 0
      server log:
        POST /done fields=password,username
    $ keydrop put demo-cred2 --generate --url https://example.com
      err| keydrop: --url goes with --username
      exit 2
    $ keydrop put demo-cred2 --generate --username agent@example.com --url ftp://example.com
      err| keydrop: A URL doesn't look right.
      exit 1

### M3

    $ grep -n keydrop run skills/keydrop-setup/SKILL.md
      out| 214:       keydrop run openai-api-key -- some-command-that-reads-stdin
      out| 215:       keydrop run staging-admin --field username --field password --field url -- \
      exit 0

### L1

    $ keydrop run demo-cred --field url -- cat
      err| keydrop: Field is absent: demo-cred has username, password.
      exit 1
    $ keydrop run demo-cred --field username --field totp -- cat
      err| keydrop: Field is absent: demo-cred has username, password.
      exit 1
    $ keydrop get demo-cred --field url
      err| keydrop: Field is absent: demo-cred has username, password.
      exit 1

### L2

    $ keydrop run demo-secret -- no-such-binary-xyz
      err| keydrop: couldn't start the command: not found (the first word after --, run without a shell)
      exit 127

### L3

`node_modules/`, `package.json` and `package-lock.json` created in the checkout, then removed:

    $ git status --short --untracked-files=all node_modules package.json package-lock.json
      exit 0
    $ git check-ignore node_modules/x package.json package-lock.json
      out| node_modules/x
      out| package.json
      out| package-lock.json
      exit 0

### L4

    $ grep -n Its exit status README.md
      out| 246:Its exit status, which `run` passes back as its own: 0 signed in, 1 didn't
      exit 0

### N1

    $ keydrop run --help
      out| (the full `keydrop --help` text, 39 lines, starting `    keydrop request <name> ...`)
      exit 0
    $ keydrop put --help
      out| (the full `keydrop --help` text, 39 lines, starting `    keydrop request <name> ...`)
      exit 0

### N2

    $ node contrib/fill-login.mjs --profile <scratch>/profiles/n2 --url http://127.0.0.1:18765/login
      err| fill-login: --url must be https (or pass --allow-http-localhost for a local test page)
      exit 2

### Values in output and files

After all of the above, `DUMMY-SECRET-zz91`, `DUMMY-PASS-k3` and the password `put --generate`
made for `example-site` (one line each, in that order) were searched for in the state directory, the Chromium profiles, the server log
and this transcript:

      files holding a dummy value: 0
      files holding a dummy value: 0
      files holding a dummy value: 0

## Tests

New cases: `Put.test_url_stores_the_website_field`, `Put.test_help_prints_usage`,
`Run.test_help_before_the_separator_prints_usage`, the two-field case in
`Run.test_missing_item_or_field_fails_before_the_child_starts`, and three checks in
`tests/fill-login-test` (help, usage on error and stdin hint name `--field url`). Three asserted
strings changed with the messages (L1, L2, N2).

Results on card/key-7 (working tree of this commit), 2026-11-25:

- `tests/fill-login-test`: all passed, 11 checks; the browser cases were skipped because
  Playwright isn't installed next to the checkout. The browser path was exercised by the M2
  rerun above instead.
- `tests/keydrop-management-test`: `Ran 52 tests`, `OK`.
- `tests/keydrop-test`: `all passed`, exit 0.
- `tests/keydrop-home-test`: first run `FAILED 2 (2 failed)`, exit 1, with 476 checks passing:

      FAIL past 60 requests a minute: bare 429
      FAIL flooded wrong-token requests aren't counted

  These are the flood and rate-limit checks, which run against the home page's request
  timing; nothing in this change touches that code. The machine's load average was about 8
  at the time. Rerun right after, on this branch and on a clean checkout of `cc194a8`: both
  `all passed (0 failed)`, exit 0. Read as a timing flake under load, not a regression.
