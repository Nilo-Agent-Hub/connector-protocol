#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""An independent, closed-source-compatible NCP example: echo incoming text."""
import signal
import sys
import time

from ncp import Bootstrap, Client, DurableRunner, Journal, ProtocolError, TransportError


def main():
    stopped = False

    def stop(*_):
        nonlocal stopped
        stopped = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    client = None
    try:
        bootstrap = Bootstrap.read()
        with Journal(bootstrap) as journal:
            client = Client(bootstrap)
            runner = DurableRunner(client, journal, lambda delivery, _key: "Echo: " + delivery["message"]["text"])
            while not stopped:
                try:
                    runner.run_once()
                except TransportError:
                    # Keep the durable poll/outbound IDs, and retry the same work.
                    time.sleep(1)
    except ProtocolError as error:
        # Only the SDK's allowlisted error code/status is logged. No bootstrap,
        # token, upstream exceptions or Hub response bodies are printed.
        print(f"connector stopped: {error}", file=sys.stderr)
        return 1
    except Exception:
        print("connector stopped: local_failure", file=sys.stderr)
        return 1
    finally:
        if client is not None and client.ready:
            try:
                client.disconnect()
            except ProtocolError:
                pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
