"""No test of v2 reaches the network (PLAN 9).

Every capture a test runs is a dry run, a replay of recorded exchanges, a scripted transport, or
is refused before a transport exists. This guard is the proof of it rather than the reason for
it: from before the first test module is imported, a connection or a datagram to anything but
this machine, and a look-up of any name but this machine's, fails the test that asked. It matters most as Alex signs rows of the rights
register: a signed row is what lets `atlas capture` ask a source, and no test may become the
one that does.

A child process a test starts is not under this guard and carries its own
(test_capture_cli.py)."""
from __future__ import annotations

import ipaddress
import socket

_LOCAL_NAMES = {"localhost", "localhost.localdomain", "ip6-localhost", ""}


def _is_local(host: object) -> bool:
    if host is None:
        return True
    if isinstance(host, bytes):
        host = host.decode("ascii", "replace")
    if not isinstance(host, str):
        return False
    if host.lower() in _LOCAL_NAMES:
        return True
    try:
        return ipaddress.ip_address(host.split("%")[0]).is_loopback
    except ValueError:
        return False


def _refuse(what: str):
    raise AssertionError(f"a test tried to reach the network ({what}); tests are offline (tests/v2/conftest.py)")


_REAL = {name: getattr(socket.socket, name) for name in ("connect", "connect_ex", "sendto")}
_REAL_LOOKUPS = {name: getattr(socket, name) for name in ("getaddrinfo", "gethostbyname", "gethostbyname_ex",
                                                          "gethostbyaddr")}


def _allowed(sock: socket.socket, address: object) -> bool:
    if sock.family not in (socket.AF_INET, socket.AF_INET6):
        return True  # a Unix socket: this machine
    return isinstance(address, tuple) and bool(address) and _is_local(address[0])


def _guard_method(name: str):
    real = _REAL[name]

    def guarded(self, *args):
        # The address is the last argument of connect, connect_ex and sendto alike.
        return real(self, *args) if _allowed(self, args[-1]) else _refuse(f"{name} to {args[-1]!r}")
    return guarded


def _guard_lookup(name: str):
    real = _REAL_LOOKUPS[name]

    def guarded(host, *args, **kwargs):
        return real(host, *args, **kwargs) if _is_local(host) else _refuse(f"look up {host!r}")
    return guarded


def install() -> None:
    """Put the guard in place. Done when this file is imported, which is before pytest imports
    any test module beside it, so a test module that asked the network as it was imported would
    be refused too."""
    for name in _REAL:
        setattr(socket.socket, name, _guard_method(name))
    for name in _REAL_LOOKUPS:
        setattr(socket, name, _guard_lookup(name))


install()
