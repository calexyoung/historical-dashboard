"""The session's guard against the network (tests/v2/conftest.py) does what it says."""
import socket

import pytest


def test_the_guard_refuses_a_connection_and_a_look_up_that_leave_this_machine():
    with pytest.raises(AssertionError, match="tests are offline"):
        socket.getaddrinfo("api.bls.gov", 443)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock, \
            pytest.raises(AssertionError, match="tests are offline"):
        sock.connect(("192.0.2.1", 443))  # TEST-NET-1: never routed, and never reached here
    with pytest.raises(AssertionError, match="tests are offline"):
        socket.gethostbyname("api.bls.gov")
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock, \
            pytest.raises(AssertionError, match="tests are offline"):
        sock.sendto(b"x", ("192.0.2.1", 53))
    assert socket.getaddrinfo("localhost", 0)
