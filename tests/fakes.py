"""Stand-ins for the two system tools keydrop drives, so the suites never
touch a real keychain or a real tailnet.

fake_security(base) writes a `security` that keeps generic-password items in a
JSON file under base and speaks just enough of the real CLI for keydrop:

    security -i                       commands on stdin, one per line
    add-generic-password [-U] -a A -s S [-l L] (-w V | -X HEX) [keychain]
    find-generic-password -a A -s S [-g] [keychain...]
    delete-generic-password -a A -s S [keychain...]
    dump-keychain [keychain...]       attributes only, the way the real one prints them
    login-keychain, default-keychain  print the path, indented and quoted, as the real one does

There can be several keychains, as on a real Mac (set_keychains). With no
keychain named, add writes to the default keychain, and find, delete and dump
search every keychain on the search list, first match wins, as the real tool
does. By default there is one, the login keychain, which is also the default.

Exit codes follow the real tool where keydrop reads them: a missing item is
44 (errSecItemNotFound, -25300), a duplicate without -U is 45 (-25299). Under
-i the status is the low 8 bits of the last failing command's OSStatus, as
with the real one, and a line longer than 4096 characters is split into two
commands, as the real one does (measured on macOS 26).

The label is printed by attribute number (0x00000007), the way the real
dump-keychain prints it, and `-U` rewrites the label it's given.
"""
import os

FAKE_SECURITY_SRC = r'''#!/usr/bin/env python3
import fcntl, json, os, shlex, sys, time
DB = %r
LOGIN = "/fake/login.keychain-db"
LINE_MAX = 4096
NOT_FOUND = "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain."


def locked(fn):
    fd = os.open(DB + ".lock", os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        try:
            with open(DB) as f:
                items = json.load(f)
        except (OSError, ValueError):
            items = []
        out = fn(items)
        tmp = DB + ".tmp"
        with open(tmp, "w") as f:
            json.dump(items, f)
        os.replace(tmp, DB)
        return out
    finally:
        os.close(fd)


def keychains():
    """{"login", "default", "search"}: set_keychains writes them beside DB."""
    try:
        with open(DB + ".keychains") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"login": LOGIN, "default": LOGIN, "search": [LOGIN]}


def opts(args):
    """Options, then any keychain paths after them (the real tool's trailing operands)."""
    o, i = {"keychains": []}, 0
    while i < len(args):
        a = args[i]
        if o["keychains"] and a.startswith("-"):
            raise SystemExit(f"security: option {a!r} after a keychain")
        if a in ("-U", "-g"):
            o[a] = True
            i += 1
        elif a in ("-a", "-s", "-l", "-w", "-X"):
            if i + 1 >= len(args):
                raise SystemExit(f"security: option {a} requires an argument")
            o[a] = args[i + 1]
            i += 2
        elif not a.startswith("-"):
            o["keychains"].append(a)
            i += 1
        else:
            raise SystemExit(f"security: unexpected argument {a!r}")
    return o


def kc(it):
    return it.get("kc", LOGIN)


def searched(o):
    return o["keychains"] or keychains()["search"]


def find(items, o, where=None):
    for k in where or searched(o):
        it = next((it for it in items if kc(it) == k and it["acct"] == o.get("-a") and it["svce"] == o.get("-s")), None)
        if it:
            return it
    return None


def stamp():
    return time.strftime("%%Y%%m%%d%%H%%M%%S", time.gmtime())


def add(args):
    o = opts(args)
    if "-X" in o:
        data = o["-X"].lower()
        bytes.fromhex(data)
    elif "-w" in o:
        data = o["-w"].encode("utf-8").hex()
    else:
        data = ""

    if len(o["keychains"]) > 1:
        raise SystemExit("security: add-generic-password takes one keychain")
    target = o["keychains"][0] if o["keychains"] else keychains()["default"]

    def go(items):
        it = find(items, o, [target])
        if it and not o.get("-U"):
            print("security: SecKeychainItemCreateFromContent (<default>): "
                  "The specified item already exists in the keychain.", file=sys.stderr)
            return 45
        if it:
            # -U rewrites the attributes it was given as well as the data.
            it.update(data=data, mdat=stamp(), **({"labl": o["-l"]} if "-l" in o else {}))
            return 0
        now = stamp()
        items.append({"acct": o.get("-a", ""), "svce": o.get("-s", ""), "labl": o.get("-l", o.get("-s", "")),
                      "data": data, "cdat": now, "mdat": now, "kc": target})
        return 0
    return locked(go)


def printable(raw):
    try:
        text = raw.decode("ascii")
    except UnicodeDecodeError:
        return None
    return text if all(32 <= ord(c) < 127 for c in text) else None


def find_cmd(args):
    o = opts(args)
    it = locked(lambda items: find(items, o))
    if it is None:
        print(NOT_FOUND, file=sys.stderr)
        return 44
    print(f'keychain: "{kc(it)}"')
    print('class: "genp"')
    print("attributes:")
    print(f'    "acct"<blob>="{it["acct"]}"')
    print(f'    "svce"<blob>="{it["svce"]}"')
    if o.get("-g"):
        raw = bytes.fromhex(it["data"])
        text = printable(raw)
        if text is not None:
            print(f'password: "{text}"', file=sys.stderr)
        else:
            print(f'password: 0x{it["data"].upper()}  "{raw.decode("utf-8", "replace")}"', file=sys.stderr)
    return 0


def delete(args):
    o = opts(args)

    def go(items):
        it = find(items, o)
        if it is None:
            print(NOT_FOUND, file=sys.stderr)
            return 44
        items.remove(it)
        return 0
    return locked(go)


def hexstamp(s):
    return "0x" + (s + "Z").encode().hex().upper() + "00"


def dump(args):
    if any(a.startswith("-") for a in args):
        raise SystemExit("fake security: dump-keychain takes no options here")
    where = args or keychains()["search"]
    for it in locked(lambda items: [it for it in items if kc(it) in where]):
        print(f'keychain: "{kc(it)}"')
        print("version: 512")
        print('class: "genp"')
        print("attributes:")
        print(f'    0x00000007 <blob>="{it["labl"]}"')
        print(f'    "acct"<blob>="{it["acct"]}"')
        print(f'    "cdat"<timedate>={hexstamp(it["cdat"])}  "{it["cdat"]}Z\\000"')
        print(f'    "mdat"<timedate>={hexstamp(it["mdat"])}  "{it["mdat"]}Z\\000"')
        print(f'    "svce"<blob>="{it["svce"]}"')
    return 0


def which(key):
    def cmd(args):
        if args:
            raise SystemExit(f"fake security: {key}-keychain takes no arguments here")
        print(f'    "{keychains()[key]}"')
        return 0
    return cmd


COMMANDS = {"add-generic-password": add, "find-generic-password": find_cmd,
            "delete-generic-password": delete, "dump-keychain": dump,
            "login-keychain": which("login"), "default-keychain": which("default")}


def run(argv):
    if not argv or argv[0] not in COMMANDS:
        print(f"fake security: unsupported {argv[:1]}", file=sys.stderr)
        return 1
    return COMMANDS[argv[0]](argv[1:])


def interactive():
    """Like the real one, reads at most LINE_MAX characters per line and runs
    whatever is left over as the next command."""
    rc = 0
    for line in sys.stdin:
        line = line.rstrip("\n")
        for start in range(0, max(len(line), 1), LINE_MAX):
            try:
                words = shlex.split(line[start:start + LINE_MAX])
            except ValueError:
                words = ["unparseable"]
            if not words:
                continue
            code = run(words)
            if code:
                rc = code & 0xFF
    return rc


if __name__ == "__main__":
    args = sys.argv[1:]
    sys.exit(interactive() if args == ["-i"] else run(args))
'''


def set_keychains(base, login="/fake/login.keychain-db", default=None, search=None):
    """Point the fake's login and default keychains and its search list
    somewhere else, as a Mac whose default keychain isn't login would be."""
    import json
    with open(os.path.join(base, "fake-keychain.json.keychains"), "w") as f:
        json.dump({"login": login, "default": default or login, "search": search or [login]}, f)


def fake_security(base):
    """Writes the fake under base and returns its path. Point keydrop at it
    with KEYDROP_SECURITY before the module loads."""
    path = os.path.join(base, "security")
    with open(path, "w") as f:
        f.write(FAKE_SECURITY_SRC % os.path.join(base, "fake-keychain.json"))
    os.chmod(path, 0o700)
    return path
