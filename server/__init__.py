"""Terminal backend package.

A loopback-only adapter that serves the terminal UI and aggregates public
data feeds (news RSS, market quotes, AIS/ADS-B positions, marketplace
listings) behind a small JSON API.

Module layout (dependencies only point downward):

    web/       HTTP boundary: routing, validation, JSON encoding
    services/  domain logic: one module per data domain
    core/      reusable infrastructure: HTTP client, caches, parsing, text

The package never fetches caller-supplied URLs; every upstream endpoint is a
fixed constant inside ``services``, which keeps the proxy SSRF-safe by
construction.
"""
