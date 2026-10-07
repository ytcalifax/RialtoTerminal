#!/usr/bin/env python3
"""Root entry point for the terminal backend.

The implementation lives in the ``server`` package; this shim keeps the
familiar ``python3 server.py`` launch command working. ``python3 -m server``
is equivalent.
"""

from server.app import main

if __name__ == "__main__":
    main()
