# IBKR Portfolio Analyzer

Local portfolio and options dashboard for Interactive Brokers accounts. It combines a read-only IB Gateway snapshot with Activity Flex Query history, while retaining CSV statements as an offline fallback.

## Features

- Live NAV, cash, positions, prices, unrealized P/L, margin, liquidity, and buying power from IB Gateway.
- Historical trades, realized P/L, premiums, interest, commissions, fees, assignments, and expirations from Flex Web Service.
- Weekly income, P/L, and cost charts plus daily put/call premium and closed P/L.
- Short-put assignment risk, expiration calendar, and assignment cash/margin stress estimates.
- Put-only buy-to-close candidates at 75% estimated premium capture; covered calls are intentionally excluded.
- Wheel cycle tracking, event timeline, covered-call planning, and Wheel breakeven per share.
- NAV and drawdown history, premium efficiency by ticker, allocation, AROC, and sortable position tables.
- CSV statement parsing for offline use.
- Multiple display currencies and languages.

## Data Sources

The dashboard uses the best available source for each type of data:

| Source | Purpose |
| --- | --- |
| IB Gateway | Current account state, positions, underlying prices, margin, liquidity, and buying power |
| Flex Query | Historical orders, P/L, premiums, costs, NAV history, option lifecycle events, and Wheel analysis |
| CSV statement | Offline historical fallback; current Gateway data is overlaid when available |

IB Gateway is connected in read-only mode. Gateway execution history is limited, so a configured Flex Query is required for a complete live dashboard. Without Flex credentials, the app falls back to the current Gateway snapshot and displays a historical-data warning.

## Requirements

- Node.js and npm
- Python 3.10+
- IB Gateway or TWS with API access enabled for live account data
- An Activity Flex Query token and query ID for complete historical analytics

Install dependencies:

```powershell
npm install
pip install -r requirements.txt
```

## Running Locally

```powershell
git clone https://github.com/tbonge/premium-tracker-ib_async.git
cd premium-tracker-ib_async
npm install
pip install -r requirements.txt
Copy-Item .env.example .env.local
```

Edit `.env.local` with your own settings, then start the app:

```powershell
npm start
```

Open the local URL printed by Vite, normally `http://localhost:5173`.

Alternatively, set variables only for the current PowerShell session:

```powershell
$env:IB_FLEX_TOKEN = "your-token"
$env:IB_FLEX_QUERY_ID = "your-query-id"
npm start
```

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `IB_GATEWAY_HOST` | `127.0.0.1` | Gateway/TWS host |
| `IB_GATEWAY_PORT` | `4001` | Gateway socket port |
| `IB_CLIENT_ID` | `77` | API client ID |
| `IB_PYTHON` | `python` | Python executable |
| `IB_FLEX_TOKEN` | none | Flex Web Service token |
| `IB_FLEX_QUERY_ID` | none | Activity Flex Query ID |

The loader script is [scripts/load_ib_gateway.py](scripts/load_ib_gateway.py). The Vite development server exposes local endpoints that run this script; the built `dist` directory alone cannot connect to Gateway or Flex.

## IB Gateway Setup

1. Start IB Gateway or TWS.
2. Enable socket API access.
3. Allow connections from localhost.
4. Configure the socket port, normally `4001` for live IB Gateway.
5. Keep read-only API mode enabled.

The app requests market data for option underlyings. Available prices depend on account market-data permissions; delayed or previous-close values may be used when live data is unavailable.

## Flex Query Setup

### Create a token

1. Sign in to IBKR Client Portal.
2. Open **Settings** and find **Flex Web Service**.
3. Enable the service and generate a token.
4. Treat the token like a password.

### Create the query

Go to **Performance & Reports > Flex Queries** and create an **Activity Flex Query**. Use XML output and a history period long enough to contain the trades you want analyzed. Last 365 Calendar Days is a useful default.

Recommended sections:

- Account Information
- Trades with **Orders**, **Executions**, and **Lots**
- Open Positions
- Prior Period Positions
- Security or Financial Instrument Information
- Option Exercises, Assignments and Expirations
- FIFO Realized and Unrealized Performance Summary in Base
- Mark-to-Market Performance Summary in Base
- Month and Year to Date Performance Summary in Base
- Equity Summary by Report Date in Base
- Net Asset Value and Change in NAV
- Cash Report, Cash Transactions, and Statement of Funds
- Interest Accruals and Interest Details
- Commission Details, Transaction Fees, and Sales Tax Details
- Securities Borrowed/Lent Fee Details when using SYEP

For Trades/Orders, **Select All** is recommended. At minimum include:

- Account ID, currency, and FX rate to base
- Asset category, symbol, underlying symbol, conid, description, and subcategory
- Date/time, report date, trade date, and transaction type
- Quantity, buy/sell, open/close indicator, proceeds, net cash, and trade price
- IB commission, cost, FIFO realized P/L, and MTM P/L
- Put/call, strike, expiry, and multiplier
- Notes/codes, transaction ID, trade ID, execution ID, and level of detail

For Option Exercises, Assignments and Expirations, select all fields. Wheel analysis requires the date, transaction type, option identifiers, quantity, strike, multiplier, currency, and FX rate.

General configuration:

- Format: XML
- Date format: `yyyyMMdd`
- Time format: `HHmmss`
- Date/time separator: semicolon
- Include currency rates: Yes
- Include offsetting trade/cancel pairs: No
- Breakout by day: No

Save the query and copy its numeric **Query ID** from the query details. The Query ID is not a generated report Reference Code.

## Loading Data

- **Load from IB Gateway** loads the current Gateway snapshot and automatically merges Flex history when both Flex variables are configured.
- In the combined Gateway + Flex view, Flex is the historical P/L baseline and Gateway commission reports add realized P/L from executions newer than the latest populated Flex activity day. This makes positions closed today visible before IBKR adds them to the next Flex statement.
- **Load Flex History** loads Flex without requiring Gateway.
- Uploading a CSV parses its full statement history, then overlays a current Gateway snapshot when Gateway is available.
- **Refresh Data** reloads Gateway/Flex data for a live dashboard and current Gateway state for a CSV-backed dashboard.

Flex report data is generally updated by IBKR after processing. Gateway remains the source of the latest positions and account values between statement/Flex updates.

## Security and Privacy

- Gateway connections are read-only.
- Flex credentials are passed only to the local Python process.
- `.env`, `.env.*`, and `*.local` files are excluded from Git; `.env.example` contains placeholders only.
- Never commit a real token, query ID, account export, or generated Flex response.
- CSV files are parsed in the browser and are not uploaded to an external service.

If a token is exposed, revoke or regenerate it in Client Portal.

## Troubleshooting

- Restart `npm start` after changing environment variables.
- `1020: Invalid request or unable to validate request` usually means the token/query pairing is invalid, expired, IP-restricted, or belongs to a different Client Portal user.
- An incomplete-history warning means Flex was not configured or required query sections/fields were absent.
- Empty Flex envelopes are retried; if generation still fails, wait and try again.
- Missing live prices usually indicate market-data permissions or a temporarily unavailable quote.
- Full historical P/L and Wheel cycles cannot be reconstructed from Gateway alone.

## Validation

```powershell
npm run build
python -m py_compile scripts\load_ib_gateway.py
```

## Disclaimer

This project is for informational and educational use only. It is not financial advice. Verify all calculations against Interactive Brokers records before making trading decisions.

## License

MIT
