"""The tradable symbol universe, as ``symbol -> display name`` mappings.

Data only. The strings use Yahoo Finance conventions; ``^SOFIX`` is fetched
from the BSE Sofia site instead, so the quote service special-cases it.
``market_map`` fails fast at import time if a pair is malformed — a config
error must surface at startup, not per request.
"""
from __future__ import annotations


def market_map(raw: str) -> dict[str, str]:
    """Parse ``SYMBOL|Name;SYMBOL|Name;...`` into an ordered dict."""
    return dict(pair.split("|", 1) for pair in raw.split(";"))


MARKET_GROUPS: dict[str, dict[str, str]] = {
    "INDICES": market_map("^GSPC|S&P 500;^IXIC|NASDAQ Composite;^DJI|Dow Jones Industrial Average;^RUT|Russell 2000;^VIX|CBOE Volatility Index;^FTSE|FTSE 100;^GDAXI|DAX;^FCHI|CAC 40;^STOXX50E|EURO STOXX 50;^AEX|AEX;^IBEX|IBEX 35;^SSMI|Swiss Market Index;^N225|Nikkei 225;^HSI|Hang Seng;000001.SS|Shanghai Composite;^NSEI|NIFTY 50;^BSESN|BSE SENSEX;^AXJO|S&P/ASX 200;^GSPTSE|S&P/TSX Composite;^BVSP|Bovespa;^KS11|KOSPI;^MXX|S&P/BMV IPC;^JKSE|Jakarta Composite;^NZ50|S&P/NZX 50;^STI|STI Index;^TA125.TA|TA-125;^SOFIX|SOFIX"),
    "FX": market_map("EURUSD=X|EUR/USD;GBPUSD=X|GBP/USD;USDJPY=X|USD/JPY;USDCHF=X|USD/CHF;USDCAD=X|USD/CAD;AUDUSD=X|AUD/USD;NZDUSD=X|NZD/USD;EURGBP=X|EUR/GBP;EURJPY=X|EUR/JPY;EURCHF=X|EUR/CHF;EURAUD=X|EUR/AUD;EURCAD=X|EUR/CAD;GBPJPY=X|GBP/JPY;GBPCHF=X|GBP/CHF;GBPCAD=X|GBP/CAD;GBPAUD=X|GBP/AUD;AUDJPY=X|AUD/JPY;AUDCAD=X|AUD/CAD;CADJPY=X|CAD/JPY;CHFJPY=X|CHF/JPY;USDCNH=X|USD/CNH;USDSGD=X|USD/SGD;USDHKD=X|USD/HKD;USDINR=X|USD/INR;USDMXN=X|USD/MXN;USDZAR=X|USD/ZAR;USDTRY=X|USD/TRY;USDBRL=X|USD/BRL;USDKRW=X|USD/KRW;USDPLN=X|USD/PLN;USDNOK=X|USD/NOK;USDSEK=X|USD/SEK"),
    "RATES": market_map("^IRX|US 13-Week Treasury Yield;^FVX|US 5-Year Treasury Yield;^TNX|US 10-Year Treasury Yield;^TYX|US 30-Year Treasury Yield;ZN=F|US 10-Year Note Future;ZB=F|US 30-Year Bond Future;ZF=F|US 5-Year Note Future;ZT=F|US 2-Year Note Future;ZQ=F|30-Day Fed Funds Future"),
    "COMMODITIES": market_map("GC=F|Gold;SI=F|Silver;PL=F|Platinum;PA=F|Palladium;HG=F|Copper;CL=F|WTI Crude;BZ=F|Brent Crude;NG=F|Natural Gas;RB=F|RBOB Gasoline;HO=F|Heating Oil;ZC=F|Corn;ZW=F|Wheat;ZS=F|Soybeans;KC=F|Coffee;CC=F|Cocoa;SB=F|Sugar;CT=F|Cotton;OJ=F|Orange Juice"),
    "CRYPTO": market_map("BTC-USD|Bitcoin;ETH-USD|Ether;SOL-USD|Solana;XRP-USD|XRP;BNB-USD|BNB;DOGE-USD|Dogecoin;ADA-USD|Cardano;AVAX-USD|Avalanche;TRX-USD|TRON;LINK-USD|Chainlink;DOT-USD|Polkadot;TON-USD|Toncoin;SHIB-USD|Shiba Inu;BCH-USD|Bitcoin Cash;LTC-USD|Litecoin;XLM-USD|Stellar;HBAR-USD|Hedera;NEAR-USD|NEAR Protocol;XMR-USD|Monero;XTZ-USD|Tezos;AAVE-USD|Aave;ICP-USD|Internet Computer;ETC-USD|Ethereum Classic;FIL-USD|Filecoin;ATOM-USD|Cosmos"),
    "ETFS": market_map("SPY|SPDR S&P 500 ETF;QQQ|Invesco QQQ ETF;IWM|iShares Russell 2000 ETF;DIA|SPDR Dow Jones ETF;VTI|Vanguard Total Market ETF;VOO|Vanguard S&P 500 ETF;IVV|iShares Core S&P 500 ETF;VEA|Vanguard FTSE Developed Markets ETF;VWO|Vanguard FTSE Emerging Markets ETF;EFA|iShares MSCI EAFE ETF;EEM|iShares Emerging Markets ETF;VGK|Vanguard FTSE Europe ETF;EWJ|iShares MSCI Japan ETF;EWG|iShares MSCI Germany ETF;EWU|iShares MSCI UK ETF;FXI|iShares China Large-Cap ETF;GLD|SPDR Gold Shares;IAU|iShares Gold Trust;SLV|iShares Silver Trust;USO|United States Oil Fund;UNG|United States Natural Gas Fund;TLT|iShares 20+ Year Treasury ETF;IEF|iShares 7-10 Year Treasury ETF;SHY|iShares 1-3 Year Treasury ETF;LQD|iShares Investment Grade Bond ETF;HYG|iShares High Yield Bond ETF;BND|Vanguard Total Bond Market ETF;ARKK|ARK Innovation ETF;XLF|Financial Select Sector ETF;XLK|Technology Select Sector ETF;XLE|Energy Select Sector ETF;XLV|Health Care Select Sector ETF;SMH|VanEck Semiconductor ETF;IBIT|iShares Bitcoin Trust;BITO|ProShares Bitcoin ETF"),
    "STOCKS": market_map("AAPL|Apple;MSFT|Microsoft;NVDA|NVIDIA;AMZN|Amazon;GOOGL|Alphabet;META|Meta Platforms;TSLA|Tesla;BRK-B|Berkshire Hathaway;LLY|Eli Lilly;AVGO|Broadcom;JPM|JPMorgan Chase;V|Visa;MA|Mastercard;WMT|Walmart;XOM|Exxon Mobil;JNJ|Johnson & Johnson;ORCL|Oracle;COST|Costco;HD|Home Depot;PG|Procter & Gamble;ABBV|AbbVie;BAC|Bank of America;NFLX|Netflix;KO|Coca-Cola;CRM|Salesforce;CVX|Chevron;MRK|Merck;AMD|AMD;PEP|PepsiCo;ADBE|Adobe;TMO|Thermo Fisher;CSCO|Cisco;LIN|Linde;MCD|McDonald's;ACN|Accenture;ABT|Abbott Laboratories;WFC|Wells Fargo;DIS|Walt Disney;QCOM|Qualcomm;IBM|IBM;INTU|Intuit;TXN|Texas Instruments;AMGN|Amgen;GE|GE Aerospace;CAT|Caterpillar;NOW|ServiceNow;PM|Philip Morris;ISRG|Intuitive Surgical;GS|Goldman Sachs;AXP|American Express;RTX|RTX;UBER|Uber;UNH|UnitedHealth;LOW|Lowe's;PFE|Pfizer;T|AT&T;VZ|Verizon;BA|Boeing;DE|Deere;SPGI|S&P Global;BLK|BlackRock;C|Citigroup;MS|Morgan Stanley;PLTR|Palantir;PANW|Palo Alto Networks;ANET|Arista Networks;MU|Micron;AMAT|Applied Materials;LRCX|Lam Research;KLAC|KLA;INTC|Intel;ARM|Arm Holdings;SNOW|Snowflake;SHOP|Shopify;DASH|DoorDash;COIN|Coinbase;MSTR|Strategy;PYPL|PayPal;XYZ|Block;SOFI|SoFi;TGT|Target;NKE|Nike;SBUX|Starbucks;UPS|UPS;FDX|FedEx;CVS|CVS Health;COP|ConocoPhillips;SLB|SLB;NEE|NextEra Energy;DUK|Duke Energy;SO|Southern Company;PLD|Prologis;BKNG|Booking Holdings;MAR|Marriott;ABNB|Airbnb;F|Ford;GM|General Motors;RIVN|Rivian;NEM|Newmont;FCX|Freeport-McMoRan;BHP|BHP Group;RIO|Rio Tinto;SHEL|Shell;TTE|TotalEnergies;BP|BP;UL|Unilever;NVO|Novo Nordisk;AZN|AstraZeneca;GSK|GSK;NVS|Novartis;SNY|Sanofi;SAP|SAP;ASML|ASML;SONY|Sony;TM|Toyota;HMC|Honda;TSM|Taiwan Semiconductor;BABA|Alibaba;PDD|PDD Holdings;JD|JD.com;BIDU|Baidu;MELI|MercadoLibre;INFY|Infosys;IBN|ICICI Bank;GRAB|Grab;SE|Sea Limited;ERIC|Ericsson;NOK|Nokia;VALE|Vale;E|Eni;BBVA|BBVA;BBD|Banco Bradesco"),
}

# The dashboard ticker and default market view: a hand-picked cross-section.
CORE_MARKETS: dict[str, str] = {
    symbol: MARKET_GROUPS["INDICES"][symbol]
    for symbol in ["^GSPC", "^IXIC", "^DJI", "^FTSE", "^SOFIX"]
}
CORE_MARKETS.update({
    symbol: MARKET_GROUPS[group][symbol]
    for group, symbol in [
        ("FX", "EURUSD=X"), ("COMMODITIES", "GC=F"), ("COMMODITIES", "BZ=F"),
        ("CRYPTO", "BTC-USD"), ("CRYPTO", "ETH-USD"), ("CRYPTO", "SOL-USD"),
        ("STOCKS", "AAPL"), ("STOCKS", "MSFT"), ("STOCKS", "NVDA"),
        ("STOCKS", "AMZN"), ("STOCKS", "GOOGL"), ("STOCKS", "TSLA"),
    ]
})

# Reverse lookup: which group a symbol belongs to (used to tag quote rows).
SYMBOL_GROUP: dict[str, str] = {
    symbol: group
    for group, items in MARKET_GROUPS.items()
    for symbol in items
}
