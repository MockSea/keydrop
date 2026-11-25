# KEY-8: fixes for the KEY-6 docs and behaviour mismatches

Report used: `reviews/key-6-docs-vs-behaviour.md` on branch `card/key-6`
(commit `d5b8af9dff900ad35c6eac873f11f17417fcf74a`), which checked main at
`a699351`.

Fixes based on: main at `a699351f7ddae1a6dbb74993d99eb44a10c89238`
("Merge pull request #6 from MockSea/fix/astra-review"). `origin/main` was
the same commit after `git fetch` on 25 November 2026, so every mismatch
below was rechecked against the commit the report checked.

## How the steps were rerun

Each step ran twice, once with main's `keydrop` and once with this branch's,
against the fake `security` from `tests/fakes.py` and the `tailscale` stub
from `tests/keydrop-test`, with `HOME`, `KEYDROP_CONFIG`,
`KEYDROP_STATE_DIR`, `KEYDROP_ACCOUNT`, `KEYDROP_SERVICE_PREFIX` and
`KEYDROP_HOME_PORT` in a scratch directory and `policy.json` enabling
`secret` and `credential`. Prompts ran in a pseudo-terminal through
`script`. Pages were read over 127.0.0.1 with the `Tailscale-User-Login`
header. Every value was a dummy (`DUMMY-key8-<tag>`).

## Mismatches

| # | Mismatch | Outcome | Change |
|---|---|---|---|
| 1 | Ctrl-D at the `put --stdin` prompt prints a traceback | fixed (code) | `read_stdin_value` treats Ctrl-D and Ctrl-C at the prompt as nothing entered |
| 2 | README says every `put` is audited | fixed (docs) | README names the audited outcomes, as SPEC 6.1 does |
| 3 | `config` doesn't print policy or adapters | fixed (docs), open choice | SPEC 12 bullet |
| 4 | Exit codes for bad input don't follow SPEC 6 | fixed (docs), open choice | SPEC 12 exit-code bullet names the cases |
| 5 | Docs list two or three test suites; main has four | fixed (docs) | README, CONTRIBUTING, SKILL.md, SPEC 10 |
| 6 | `--schema`, `--template`, `home --force` missing from the README synopsis | fixed (docs) | README synopsis and template sentence |
| 7 | No per-command help | not fixed | see below |
| 8 | A bare template name proposes the template | fixed (docs) | README sentence |
| 9 | `put --stdin` drops one trailing newline | fixed (docs) | README sentence |

### 1. Ctrl-D at the prompt (fixed, code)

The prompt now returns an empty value on `EOFError` or `KeyboardInterrupt`,
so it takes the same path as an empty pipe: `Nothing was entered.`, exit 1.
The report suggested a `RefusedError` (exit 2); that would have given Ctrl-D
a different exit code from an empty pipe, so it reuses the existing refusal.

Steps: at a terminal, `keydrop put demo-1 --stdin`, press Ctrl-D (then
Ctrl-C).

| | Ctrl-D | Ctrl-C |
|---|---|---|
| main | traceback ending `EOFError`, exit 1 | traceback ending `KeyboardInterrupt`, exit 2 |
| this branch | `value: ` then `keydrop: Nothing was entered.`, exit 1 | same, exit 1 |

A typed value at the prompt still stores (`stored demo-tty`, exit 0, `get`
returns it).

### 2. Audit wording (fixed, docs)

Steps: pipe a dummy into `keydrop put demo-2 --stdin` twice, read
`home-audit.log`. Both commits: first run `stored demo-2`, exit 0; second
`demo-2 already exists (--replace to overwrite it)`, exit 2; the log has one
line, `stored`. The README now says "Every `put` that stores, replaces or
fails, or is refused because `put` didn't make the item, is written to
`home-audit.log`", which matches SPEC 6.1 and the code.

### 3. `config` and policy (fixed in docs, open choice)

Steps: `policy.json` enabling credentials, `keydrop config`. Both commits:
the nine config keys, nothing about types, fields, vault or transport, exit
0. SPEC 12 now lists it as a known difference. Open choice for the owner:
add `types_enabled`, `credential_fields_enabled`, vault and transport lines
to `config_lines` and drop the bullet.

### 4. Exit codes (fixed in docs, open choice)

Steps and observed exit codes, identical on both commits:

| Command | Output | Exit |
|---|---|---|
| `request demo-4 --ttl 0` | `--ttl must be between 1s and 60m` | 1 |
| `vault --ttl 61m` | same | 1 |
| `request demo-4 --ttl 15x` | `bad --ttl '15x' (use e.g. 90s, 15m, 1h)` | 1 |
| `get Bad_Name` | `bad name` | 1 |
| `put Bad_Name --stdin` | `name must be [a-z0-9._-], 1-64 chars` | 2 |
| `request demo-4 --note <201 chars>` | `--note is limited to 200 characters` | 1 |
| `request` | `request needs a name` | 1 |
| empty pipe to `put demo-4 --stdin` | `Nothing was entered.` | 1 |
| `config --json` | usage | 2 |
| `vault extra` | `unexpected argument 'extra'` | 1 |

SPEC 12's exit-code bullet now names each case that section 6 puts at 2 and
the reference exits 1 on, and the usage-error split. Open choice for the
owner: raise `RefusedError` from `parse_ttl`, `clean_note`, `get`'s name
check and the missing-name checks so section 6 holds, and drop those cases
from the bullet. Scripts may already depend on exit 1, which is why the
docs were changed instead.

### 5. Test suites (fixed, docs)

`tests/` on main holds four suites. README "Tests", CONTRIBUTING, SKILL.md
step 1 and SPEC 10 now list `tests/keydrop-review-test` too, and SKILL.md's
intro says "its test suites" instead of "two test suites".

### 6. README synopsis (fixed, docs)

The `request` line gains `[--schema <file>] [--template <service>]`, the
`home` line gains `[--force]`, and the template sentence names `--template`
next to `--type`.

### 7. Per-command help (not fixed)

`keydrop request --help` still gives `unexpected argument '--help'`, exit 1.
No doc promises per-command help, so docs and behaviour agree. Adding it
means a new flag accepted anywhere in argv, including positions that take a
value (`--note --help`), which is a behaviour change for the owner to
decide, not a docs fix.

### 8. Bare template name (fixed, docs)

Steps: credentials on, `keydrop request aws --ttl 1m`, read the page. Both
commits: link printed, exit 0; the page's labels are `Access key id`,
`Secret access key`, `Session token (optional)`; `cancel aws` exit 0. The
README now says so, and that a one-field template name such as `github`
stays a plain secret.

### 9. Trailing newline (fixed, docs)

Steps: `printf 'DUMMY-key8-nl\n' | keydrop put demo-9 --stdin`, then
`keydrop get demo-9 | xxd`. Both commits: `stored demo-9`, exit 0; the
stored bytes end in `6e 6c` with no `0a`. The README now says one trailing
newline is dropped from a pipe.

## Tests

All four suites on main ran on this branch with the changes in place, on
25 November 2026 (load average about 12):

| Suite | Result | Exit | Time |
|---|---|---|---|
| `tests/keydrop-review-test` | `Ran 40 tests`, `OK` | 0 | 23s |
| `tests/keydrop-test` | `all passed` | 0 | 239s |
| `tests/keydrop-management-test` | `Ran 41 tests`, `OK` | 0 | 87s |
| `tests/keydrop-home-test` | `all passed (0 failed)` | 0 | 213s |

No suite covers the terminal prompt, so fix 1 rests on the pseudo-terminal
rerun above.
