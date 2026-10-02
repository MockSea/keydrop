# Contributing to keydrop

We'd love to hear from you. If you're using keydrop, or a keydrop of your own
built from `SPEC.md`, tell us how: which vault, which transport, which
harness, and what got in the way. A use case we haven't thought of is as
useful as a pull request, and often more.

## Sharing a use case or feedback

Open an issue. Say what you were trying to do, what machine and tools you
had, and where keydrop or the spec fell short. You don't need a fix in mind.

If the spec is unclear or wrong, an issue quoting the section is the
quickest way to get it changed.

Please don't put real secrets, tokens, links or tailnet names in an issue.
If you think you've found a security problem, see "Security reports" below
before writing anything public.

## Contributing an adapter, item type or change

1. **Open an issue first** describing the use case: the vault, transport or
   item type, the machine it's for, and how it meets the invariants in
   `SPEC.md` section 4. For a new transport, say which class in section 9.3
   it belongs to, or make the case for a new one. Agreeing on the shape
   before the code saves everyone a rewrite.
2. **Build it** against the spec. Section 11 lists what each kind of
   extension has to satisfy and the pitfalls the existing code has already
   hit.
3. **Run the conformance checks** in section 10 against fakes or stubs of
   your vault or transport, then do the manual round trip in 10.3 on a real
   machine with a throwaway name.
4. **Open a pull request** that links the issue and includes:
   - the code, with its fakes or stubs;
   - a conformance report in the shape of section 10.4;
   - the side effects of the vault or transport tool you found (history,
     sync, caches, prompts);
   - for changes to the reference implementation, all three test suites passing:
     `tests/keydrop-test`, `tests/keydrop-home-test` and
     `tests/keydrop-management-test`.

Small fixes (typos, broken links, clearer wording) can skip the issue.

## How contributions are reviewed

Every pull request is checked for:

- **The invariants.** Each one in `SPEC.md` section 4 still holds, for every
  item type, vault and transport the change touches.
- **Conformance.** The checks in section 10 pass, and the report says which
  ones don't apply and why.
- **Security review.** Anything that touches a vault adapter, a transport
  adapter, the page, request handling or teardown gets a security review
  before it's merged. Expect questions about what happens when things fail:
  a vault that lies about a write, a route that disappears, a header that
  arrives twice.
- **The UX contract.** Pages use the shell, copy and states in section 7.
  New copy goes into the spec first so every implementation can share it.
- **The code.** Readable, small, with tests for the new behaviour. The
  reference implementation stays one file with no dependencies beyond the
  Python standard library.

What gets declined:

- Anything that weakens an invariant, however useful the feature it enables.
  That includes a mode that skips the identity check, a public or
  unauthenticated URL, a value passed on a command line, and a page that
  shows a stored value.
- Transports from `SPEC.md` section 9.4.
- Vault adapters that can only receive values on argv.
- Telemetry, analytics or any call to a service the owner didn't choose.
- Large rewrites of the reference implementation without an issue agreeing
  on them first.

A declined pull request can still change the spec. If an invariant is
getting in the way of a real use case, open an issue about the invariant
itself.

Turnaround: TODO, to be set by the maintainer.

## Security reports

Please don't open a public issue for a vulnerability. Report it privately
with GitHub's private vulnerability reporting: on the repository, open the
Security tab and choose "Report a vulnerability". Include what you found, how
to reproduce it, and which invariant it breaks.

## License

By contributing, you agree that your contribution is licensed under the MIT
license in `LICENSE`.
