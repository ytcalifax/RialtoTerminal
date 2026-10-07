"""Allow ``python3 -m server`` as an alternative entry point."""

from .app import main

if __name__ == "__main__":
    main()
