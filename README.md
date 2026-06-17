# 📊 IBKR Portfolio Analyzer

<p align="center">
  <strong>Turn your Interactive Brokers activity statement into a powerful decision-making tool.</strong>
  <br />
  Visualize your gains, manage portfolio risk, and trade with confidence.
</p>

---

## ✨ Overview

The **IBKR Portfolio Analyzer** is a sophisticated, privacy-focused web application designed for traders who want to gain deeper insights from their Interactive Brokers activity statements. While beneficial for all investors, it has a special focus on visualizing and calculating key performance and risk metrics for short option strategies, particularly **The Wheel**.

This tool processes your entire activity statement CSV file directly in your browser, ensuring your financial data remains completely private and never leaves your computer.

## 🚀 Key Features

-   **Privacy First**: All data processing is done client-side. Your statement is **never** uploaded to any server.
-   **Comprehensive Dashboard**: Get a 360-degree view of your portfolio's performance with key metrics like Net Asset Value (NAV), Time-Weighted Return (TWR), and detailed P/L summaries.
-   **Advanced Options Analysis**:
    -   **Wheel Strategy Tracking**: Automatically identifies and analyzes completed and pending Wheel cycles, calculating total P/L, premiums, duration, and annualized returns.
    -   **Short Put Risk Management**: Visualizes your potential collateral requirements for short puts, separating them by risk (In-the-Money vs. Out-of-the-Money) and calculating potential cash shortfalls.
    -   **Performance Metrics**: Track your options win rate, assignment rate, premium capture, and Annualized Return on Capital (AROC).
-   **Stunning Visualizations**:
    -   **NAV Flow Sankey Chart**: Understand exactly what contributed to the change in your portfolio's value over the period.
    -   **Interactive Charts**: Analyze monthly income/P&L, cost breakdowns, and P&L contribution by ticker with beautiful bar and pie charts.
-   **Multi-Language & Multi-Currency**: View your dashboard in multiple languages and convert all financial data to your preferred currency with a single click.
-   **Public Shareable View**: Generate a clean, anonymized, and shareable snapshot of your portfolio's key metrics to share your performance with others.

## ⚙️ How to Use

1.  **Log in to Interactive Brokers** and navigate to the **"Performance & Reports"** > **"Statements"** tab.
2.  Find the **"Activity"** statement type and click the **"Run"** button (the arrow icon).
3.  In the pop-up window:
    -   Choose your desired **Period** (e.g., "Monthly", "Year to Date"). "Year to Date" is recommended for comprehensive analysis.
    -   Set the **Format** to **CSV**.
    -   Click the **"Download"** button.
4.  **Open the IBKR Portfolio Analyzer** web app.
5.  **Drag and drop** the downloaded CSV file onto the upload area, or click to select it from your computer.
6.  The app parses the full statement history, then attempts to refresh the current account snapshot from your local read-only IB Gateway. If Gateway is running, current NAV, cash, open positions, prices, and unrealized P/L are updated to the latest available values. If Gateway is not available, the dashboard falls back to the statement data only.

**Important**: Do not open and re-save the CSV file in spreadsheet software like Excel, as it may alter the date/number formatting and cause parsing errors.

## 🖼️ Screenshot

<p align="center">
  <img src="/img/premiumtracker-example.png" alt="IBKR Portfolio Analyzer Screenshot" width="800">
</p>

## 🛠️ Tech Stack

-   **Frontend**: [React](https://reactjs.org/), [TypeScript](https://www.typescriptlang.org/)
-   **Styling**: [Tailwind CSS](https://tailwindcss.com/)
-   **Charting**: [Recharts](https://recharts.org/)
-   **Client-side Processing**: Standard browser APIs (FileReader) for parsing the CSV.

## 🖥️ Getting Started (For Developers)

This project is a Vite-powered React application. Use the npm scripts below to run it locally.

### Prerequisites

-   A modern web browser.
-   [Node.js](https://nodejs.org/) and npm.
-   Python 3.10+ with `ib_async` if you want to load live data from a local IB Gateway.

### Running Locally

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/tbonge/premium-tracker-ib_async.git
    cd premium-tracker-ib_async
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    pip install -r requirements.txt
    ```

3.  **Start IB Gateway or TWS:**
    -   Enable API access in IB Gateway/TWS.
    -   Make sure the socket port is `4001` on this machine.
    -   If you use a different port, set `IB_GATEWAY_PORT` before starting Vite.

4.  **Start the app:**
    ```bash
    npm start
    ```

5.  **Open the application:**
    Navigate to the local address shown in your terminal, usually `http://localhost:5173`.

### Live IB Gateway Loading

The "Load from IB Gateway" button runs `scripts/load_ib_gateway.py` through the local Vite dev server. The script connects to `127.0.0.1:4001` with client id `77` in IB read-only mode by default, reads account values, portfolio positions, market prices, open-option average cost, and option execution premiums through `ib_async`, then returns dashboard JSON to the app.

Optional environment variables:

-   `IB_GATEWAY_HOST` - defaults to `127.0.0.1`
-   `IB_GATEWAY_PORT` - defaults to `4001`
-   `IB_CLIENT_ID` - defaults to `77`
-   `IB_PYTHON` - Python executable to use, defaults to `python`
-   `IB_FLEX_TOKEN` - optional IBKR Flex Web Service token for historical statement data
-   `IB_FLEX_QUERY_ID` - optional Flex Query ID for historical statement data

Live Gateway data is a current snapshot. When loading a CSV statement, the app uses the statement for full history and overlays the latest Gateway snapshot for current NAV, cash, open positions, prices, and unrealized P/L. When both `IB_FLEX_TOKEN` and `IB_FLEX_QUERY_ID` are supplied, the live loader also retrieves a Flex report and merges historical monthly premium income, closed positions, realized P/L, commissions, fees, interest, and ticker P/L into the dashboard. If either Flex value is missing, the live loader falls back to the Gateway-only snapshot.

Open short option premium is populated from the live portfolio item's `averageCost` when available, with same-contract option executions as a fallback. Monthly premium income is populated from synchronized/requested option sale fills. If IB Gateway does not return older executions, the open premium can still load from average cost, but historical monthly income remains limited to the fills returned by the API session.

### IBKR Flex Query Setup

IB Gateway provides live account state, but full statement-style history is available through IBKR Flex Web Service. Flex reports are useful for historical trades, commissions, realized P/L, cash activity, interest, fees, dividends, and option premium income.

To create a Flex Web Service token:

1.  Log in to the IBKR Client Portal.
2.  Open **Settings**.
3.  Find **Flex Web Service** or **Configure Flex Web Service**.
4.  Enable the service if it is not already enabled.
5.  Generate a token.
6.  Store the token somewhere secure. Treat it like a password because it can retrieve account report data.

To create a Flex Query:

1.  In Client Portal, go to **Performance & Reports** > **Flex Queries**.
2.  Create a new **Activity Flex Query**.
3.  Choose the account or accounts to include.
4.  Set the period to the history range you want the app to analyze.
5.  Include sections that map to the app's dashboard data:
    -   **Trades** / **Trade Confirms**
    -   **Open Positions**
    -   **Net Asset Value**
    -   **Change in NAV**
    -   **Cash Report**
    -   **Realized & Unrealized Performance Summary**
    -   **Mark-to-Market Performance Summary**
    -   **Interest**
    -   **Fees**
    -   **Dividends**
    -   **Financial Instrument Information**
    -   **Stock Yield Enhancement Program Securities Lent Interest Details**, if you use SYEP
6.  Save the query.
7.  Open the saved query details and copy its **Query ID**. This is the `queryId` used by `ib_async.FlexReport`.

With a token and query id, `ib_async` can retrieve the report like this:

```python
from ib_async import FlexReport

report = FlexReport(token="YOUR_FLEX_TOKEN", queryId="YOUR_QUERY_ID")
print(report.topics())
trades = report.extract("Trade")
```

The token and query id are optional for the "Load from IB Gateway" button. When both are configured, the loader uses them to merge Flex history with the live Gateway snapshot. When either value is missing, the loader uses only IB Gateway.

To enable Flex history in the "Load from IB Gateway" button, set both values before starting Vite:

```bash
IB_FLEX_TOKEN=your-token
IB_FLEX_QUERY_ID=your-query-id
npm start
```

On Windows PowerShell:

```powershell
$env:IB_FLEX_TOKEN = "your-token"
$env:IB_FLEX_QUERY_ID = "your-query-id"
npm start
```

If either value is omitted, the app loads only the live Gateway snapshot.

## 🚀 Deployment

Since this is a client-side only application, you can deploy the built files to any static site hosting service.

1.  Build the app:
    ```bash
    npm run build
    ```
2.  Upload the generated `dist` folder to your hosting provider.
2.  Popular free options include:
    -   [GitHub Pages](https://pages.github.com/)
    -   [Netlify](https://www.netlify.com/)
    -   [Vercel](https://vercel.com/)

## 🤝 Contributing

Contributions are welcome! If you have ideas for new features, bug fixes, or improvements, please feel free to:

1.  **Fork** the repository.
2.  Create a new **branch** for your feature (`git checkout -b feature/AmazingFeature`).
3.  **Commit** your changes (`git commit -m 'Add some AmazingFeature'`).
4.  **Push** to the branch (`git push origin feature/AmazingFeature`).
5.  Open a **Pull Request**.

## ⚖️ Disclaimer

This application is provided for informational and educational purposes only. It is not financial advice. The app is still under development and may contain bugs or inaccuracies. We are not responsible for any financial decisions made based on the analysis provided by this tool. Always conduct your own research and consult with a qualified financial professional.

## 📄 License

This project is licensed under the MIT License.
