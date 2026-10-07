"""Declarative registry of public news feeds.

Data only — no logic. Each entry drives one parallel fetch:

    id        cache key
    url       public RSS/Atom endpoint
    source    display name for the terminal UI
    category  UI filter bucket (WORLD, MARKETS, BULGARIA, ...)
    region    UI filter bucket; BULGARIA/BALKANS activate the local feed set
    language  ISO code for non-English feeds (empty means English)
"""

NEWS_FEEDS: list[dict[str, str]] = [
    {
        "id": "google-global",
        "url": "https://news.google.com/rss/search?q=world+OR+markets+OR+economy+OR+politics+OR+technology+OR+Europe&hl=en&gl=US&ceid=US%3Aen",
        "source": "GOOGLE NEWS INDEX",
        "category": "WORLD",
        "region": "GLOBAL",
        "language": "en",
    },
    {
        "id": "bloomberg",
        "url": "https://www.bloomberg.com/feeds/news.rss",
        "source": "BLOOMBERG",
        "category": "WORLD",
        "region": "GLOBAL",
    },
    {
        "id": "bloomberg-markets",
        "url": "https://feeds.bloomberg.com/markets/news.rss",
        "source": "BLOOMBERG",
        "category": "MARKETS",
        "region": "GLOBAL",
    },
    {
        "id": "bloomberg-business",
        "url": "https://feeds.bloomberg.com/business/news.rss",
        "source": "BLOOMBERG",
        "category": "BUSINESS",
        "region": "GLOBAL",
    },
    {
        "id": "bloomberg-tech",
        "url": "https://feeds.bloomberg.com/technology/news.rss",
        "source": "BLOOMBERG",
        "category": "TECH",
        "region": "GLOBAL",
    },
    {
        "id": "bloomberg-economics",
        "url": "https://feeds.bloomberg.com/economics/news.rss",
        "source": "BLOOMBERG",
        "category": "ECONOMICS",
        "region": "GLOBAL",
    },
    {
        "id": "bbc-world",
        "url": "https://feeds.bbci.co.uk/news/world/rss.xml",
        "source": "BBC",
        "category": "WORLD",
        "region": "GLOBAL",
    },
    {
        "id": "bbc-business",
        "url": "https://feeds.bbci.co.uk/news/business/rss.xml",
        "source": "BBC",
        "category": "BUSINESS",
        "region": "GLOBAL",
    },
    {
        "id": "bbc-politics",
        "url": "https://feeds.bbci.co.uk/news/politics/rss.xml",
        "source": "BBC",
        "category": "POLITICS",
        "region": "GLOBAL",
    },
    {
        "id": "bbc-tech",
        "url": "https://feeds.bbci.co.uk/news/technology/rss.xml",
        "source": "BBC",
        "category": "TECH",
        "region": "GLOBAL",
    },
    {
        "id": "bbc-europe",
        "url": "https://feeds.bbci.co.uk/news/world/europe/rss.xml",
        "source": "BBC",
        "category": "EUROPE",
        "region": "EUROPE",
    },
    {
        "id": "guardian-world",
        "url": "https://www.theguardian.com/world/rss",
        "source": "THE GUARDIAN",
        "category": "WORLD",
        "region": "GLOBAL",
    },
    {
        "id": "guardian-business",
        "url": "https://www.theguardian.com/business/rss",
        "source": "THE GUARDIAN",
        "category": "BUSINESS",
        "region": "GLOBAL",
    },
    {
        "id": "guardian-tech",
        "url": "https://www.theguardian.com/technology/rss",
        "source": "THE GUARDIAN",
        "category": "TECH",
        "region": "GLOBAL",
    },
    {
        "id": "guardian-politics",
        "url": "https://www.theguardian.com/politics/rss",
        "source": "THE GUARDIAN",
        "category": "POLITICS",
        "region": "GLOBAL",
    },
    {
        "id": "cnbc-markets",
        "url": "https://www.cnbc.com/id/100003114/device/rss/rss.html",
        "source": "CNBC",
        "category": "MARKETS",
        "region": "GLOBAL",
    },
    {
        "id": "marketwatch",
        "url": "https://feeds.marketwatch.com/marketwatch/topstories/",
        "source": "MARKETWATCH",
        "category": "MARKETS",
        "region": "GLOBAL",
    },
    {
        "id": "investing",
        "url": "https://www.investing.com/rss/news_25.rss",
        "source": "INVESTING.COM",
        "category": "MARKETS",
        "region": "GLOBAL",
    },
    {
        "id": "euronews",
        "url": "https://www.euronews.com/rss?level=theme&name=news",
        "source": "EURONEWS",
        "category": "EUROPE",
        "region": "EUROPE",
    },
    {
        "id": "france24",
        "url": "https://www.france24.com/en/rss",
        "source": "FRANCE 24",
        "category": "WORLD",
        "region": "GLOBAL",
    },
    {
        "id": "dnevnik",
        "url": "https://www.dnevnik.bg/rss/",
        "source": "DNEVNIK",
        "category": "BULGARIA",
        "region": "BULGARIA",
        "language": "bg",
    },
    {
        "id": "capital",
        "url": "https://www.capital.bg/rss/",
        "source": "CAPITAL",
        "category": "BUSINESS",
        "region": "BULGARIA",
        "language": "bg",
    },
    {
        "id": "novinite",
        "url": "https://novinite.com/services/news_rdf.php",
        "source": "NOVINITE",
        "category": "BULGARIA",
        "region": "BULGARIA",
        "language": "en",
    },
    {
        "id": "offnews",
        "url": "https://offnews.bg/rss/all",
        "source": "OFFNEWS",
        "category": "BULGARIA",
        "region": "BULGARIA",
        "language": "bg",
    },
    {
        "id": "sofia-globe",
        "url": "https://sofiaglobe.com/feed/",
        "source": "SOFIA GLOBE",
        "category": "BULGARIA",
        "region": "BULGARIA",
        "language": "en",
    },
    {
        "id": "balkan-insight",
        "url": "https://balkaninsight.com/feed/",
        "source": "BALKAN INSIGHT",
        "category": "BALKANS",
        "region": "BALKANS",
        "language": "en",
    },
]
