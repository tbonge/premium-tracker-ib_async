#!/usr/bin/env python
"""Load live portfolio data from a local Interactive Brokers Gateway."""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import date, datetime
from typing import Any

try:
    from ib_async import IB, ExecutionFilter, FlexReport, Stock
except ImportError as exc:
    raise SystemExit(
        f"Missing Python dependency '{exc.name}'. Install dependencies with: pip install -r requirements.txt"
    ) from exc


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        parsed = float(value)
        if math.isnan(parsed) or math.isinf(parsed):
            return default
        return parsed
    except (TypeError, ValueError):
        return default


def attr(obj: Any, *names: str, default: Any = "") -> Any:
    for name in names:
        if hasattr(obj, name):
            value = getattr(obj, name)
            if value is not None and value != "":
                return value
        if isinstance(obj, dict) and name in obj:
            value = obj[name]
            if value is not None and value != "":
                return value
    return default


def first_topic(report: FlexReport, *topics: str) -> list[Any]:
    available = report.topics()
    for topic in topics:
        if topic in available:
            return report.extract(topic)
    return []


def empty_dashboard(base_currency: str = "USD") -> dict[str, Any]:
    return {
        "positions": [],
        "closedPositions": [],
        "nav": {"cash": 0, "baseCurrency": base_currency},
        "accountInfo": {
            "baseCurrency": base_currency,
            "account": "",
            "name": "",
            "period": "Live IB Gateway snapshot",
        },
        "exchangeRates": {base_currency: 1},
        "plSummary": {
            "stocks": {"realized": 0, "unrealized": 0, "total": 0},
            "options": {"realized": 0, "unrealized": 0, "total": 0},
            "forex": {"realized": 0, "unrealized": 0, "total": 0},
            "total": {"realized": 0, "unrealized": 0, "total": 0},
        },
        "rateOfReturn": 0,
        "totalNAV": 0,
        "arocAnalysis": {"averageAroc": 0, "trades": []},
        "optionsStrategyMetrics": {"winRate": 0, "assignmentRate": 0, "totalClosed": 0, "wins": 0},
        "wheelCycleAnalysis": {"completedCycles": [], "pendingCycles": []},
        "monthlySummary": [],
        "tickerPL": [],
        "navChange": {
            "startingValue": 0,
            "markToMarket": 0,
            "depositsAndWithdrawals": 0,
            "interest": 0,
            "changeInInterestAccruals": 0,
            "otherFees": 0,
            "commissions": 0,
            "salesTax": 0,
            "otherFXTranslations": 0,
            "endingValue": 0,
        },
        "shortPutIncomeSummary": {
            "totalRealizedPL": 0,
            "numberOfContracts": 0,
            "averagePLPerContract": 0,
            "hasData": False,
        },
    }


def contract_symbol(contract: Any) -> tuple[str, str, bool, str | None, float | None, str | None]:
    security_type = getattr(contract, "secType", "")
    base_symbol = getattr(contract, "symbol", "") or getattr(contract, "localSymbol", "")

    if security_type == "OPT":
        right = getattr(contract, "right", "") or None
        strike = safe_float(getattr(contract, "strike", None)) or None
        raw_expiry = getattr(contract, "lastTradeDateOrContractMonth", "") or ""
        expiry = None
        if len(raw_expiry) >= 8:
            expiry = f"{raw_expiry[:4]}-{raw_expiry[4:6]}-{raw_expiry[6:8]}"
        elif len(raw_expiry) == 6:
            expiry = f"{raw_expiry[:4]}-{raw_expiry[4:6]}-01"

        if right and strike and expiry:
            symbol = f"{base_symbol} {expiry} {strike:g} {right}"
        else:
            symbol = getattr(contract, "localSymbol", "") or base_symbol

        return symbol, base_symbol, True, right, strike, expiry

    return base_symbol, base_symbol, False, None, None, None


def asset_category(contract: Any) -> str:
    security_type = getattr(contract, "secType", "")
    if security_type == "OPT":
        return "Options"
    if security_type == "STK":
        return "Stocks"
    if security_type == "CASH":
        return "Forex"
    return security_type or "Other"


def market_price_from_item(item: Any) -> float:
    price = safe_float(getattr(item, "marketPrice", None))
    if price:
        return price
    value = safe_float(getattr(item, "marketValue", None))
    quantity = abs(safe_float(getattr(item, "position", None)))
    return value / quantity if value and quantity else 0


def option_premium_from_portfolio_item(item: Any, multiplier: float) -> float:
    quantity = safe_float(getattr(item, "position", None))
    average_cost = safe_float(getattr(item, "averageCost", None))

    if quantity >= 0 or not average_cost:
        return 0

    market_price = abs(safe_float(getattr(item, "marketPrice", None)))
    per_contract_cost = abs(average_cost)

    if multiplier > 1 and market_price and per_contract_cost <= market_price * 5:
        per_contract_cost *= multiplier

    return per_contract_cost * abs(quantity)


def contract_key(contract: Any) -> str:
    con_id = getattr(contract, "conId", None)
    if con_id:
        return f"conId:{con_id}"
    symbol, _, _, _, _, _ = contract_symbol(contract)
    return f"symbol:{symbol}"


def read_account_values(ib: IB) -> tuple[str, str, dict[str, float]]:
    account_values = ib.accountValues()
    account = ""
    base_currency = "USD"
    values: dict[str, float] = {}

    for row in account_values:
        tag = getattr(row, "tag", "")
        currency = getattr(row, "currency", "")
        value = getattr(row, "value", "")

        if not account:
            account = getattr(row, "account", "") or ""
        if tag == "BaseCurrency" and value:
            base_currency = value
        if tag in {"NetLiquidation", "TotalCashValue", "CashBalance", "AvailableFunds"}:
            key = f"{tag}:{currency or base_currency}"
            values[key] = safe_float(value)

    return account, base_currency, values


def request_underlying_prices(ib: IB, symbols: set[tuple[str, str]]) -> dict[str, float]:
    prices: dict[str, float] = {}
    contracts = []

    for symbol, currency in sorted(symbols):
        if not symbol:
            continue
        contracts.append(Stock(symbol, "SMART", currency or "USD"))

    if not contracts:
        return prices

    try:
        qualified = ib.qualifyContracts(*contracts)
        tickers = ib.reqTickers(*qualified)
        for ticker in tickers:
            contract = getattr(ticker, "contract", None)
            symbol = getattr(contract, "symbol", "")
            price = (
                safe_float(ticker.marketPrice())
                or safe_float(getattr(ticker, "last", None))
                or safe_float(getattr(ticker, "close", None))
            )
            if symbol and price:
                prices[symbol] = price
    except Exception as exc:
        print(f"Unable to load underlying market prices: {exc}", file=sys.stderr)

    return prices


def execution_month(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.strftime("%Y-%m")
    if isinstance(value, date):
        return value.strftime("%Y-%m")
    if not value:
        return None

    text = str(value)
    for fmt in ("%Y%m%d %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y%m%d-%H:%M:%S"):
        try:
            return datetime.strptime(text[: len(fmt)], fmt).strftime("%Y-%m")
        except ValueError:
            pass

    if len(text) >= 7 and text[4] == "-":
        return text[:7]
    if len(text) >= 6 and text[:6].isdigit():
        return f"{text[:4]}-{text[4:6]}"
    return None


def read_option_premiums(ib: IB, account: str = "") -> tuple[dict[str, float], list[dict[str, float | str]]]:
    premiums: dict[str, float] = {}
    monthly: dict[str, dict[str, float | str]] = {}

    fills = ib.fills()
    if not fills:
        try:
            exec_filter = ExecutionFilter(acctCode=account) if account else ExecutionFilter()
            fills = ib.reqExecutions(exec_filter)
        except Exception as exc:
            print(f"Unable to load execution premium data: {exc}", file=sys.stderr)
            return premiums, []

    for fill in fills:
        contract = getattr(fill, "contract", None)
        execution = getattr(fill, "execution", None)
        if not contract or not execution or getattr(contract, "secType", "") != "OPT":
            continue
        if account and getattr(execution, "acctNumber", "") not in {"", account}:
            continue

        side = (getattr(execution, "side", "") or "").upper()
        shares = abs(safe_float(getattr(execution, "shares", None)))
        price = safe_float(getattr(execution, "price", None))
        multiplier = safe_float(getattr(contract, "multiplier", None), 100) or 100
        commission_report = getattr(fill, "commissionReport", None)
        commission = abs(safe_float(getattr(commission_report, "commission", None))) if commission_report else 0

        if not shares or not price:
            continue

        gross_premium = price * shares * multiplier
        if side in {"SLD", "SELL"}:
            signed_premium = gross_premium - commission
            month = execution_month(getattr(execution, "time", None))
            if month:
                summary = monthly.setdefault(
                    month,
                    {
                        "month": month,
                        "optionsPL": 0,
                        "optionsPremium": 0,
                        "stocksPL": 0,
                        "forexPL": 0,
                        "syepIncome": 0,
                        "interest": 0,
                        "interestPaid": 0,
                        "commissions": 0,
                        "fees": 0,
                        "salesTax": 0,
                    },
                )
                summary["optionsPremium"] = safe_float(summary["optionsPremium"]) + signed_premium
        elif side in {"BOT", "BUY"}:
            signed_premium = -gross_premium - commission
        else:
            continue

        key = contract_key(contract)
        premiums[key] = premiums.get(key, 0) + signed_premium

    return premiums, [monthly[key] for key in sorted(monthly)]


def build_dashboard(ib: IB) -> dict[str, Any]:
    account, base_currency, account_values = read_account_values(ib)
    data = empty_dashboard(base_currency)
    data["accountInfo"]["account"] = account
    data["accountInfo"]["period"] = f"Live IB Gateway snapshot ({datetime.now().strftime('%Y-%m-%d %H:%M')})"

    net_liq = account_values.get(f"NetLiquidation:{base_currency}", 0)
    cash = account_values.get(f"TotalCashValue:{base_currency}", 0) or account_values.get(
        f"CashBalance:{base_currency}", 0
    )

    data["totalNAV"] = net_liq
    data["nav"]["cash"] = cash
    data["navChange"]["endingValue"] = net_liq

    portfolio_items = ib.portfolio()
    option_premiums, monthly_premium_summary = read_option_premiums(ib, account)
    data["monthlySummary"] = monthly_premium_summary
    underlying_symbols: set[tuple[str, str]] = set()

    for item in portfolio_items:
        contract = getattr(item, "contract", None)
        if not contract:
            continue

        symbol, base_symbol, is_option, option_type, strike_price, expiry = contract_symbol(contract)
        currency = getattr(contract, "currency", "") or base_currency
        quantity = safe_float(getattr(item, "position", None))
        market_value = safe_float(getattr(item, "marketValue", None))
        unrealized = safe_float(getattr(item, "unrealizedPNL", None))
        cost_basis = market_value - unrealized if market_value or unrealized else 0
        close_price = market_price_from_item(item)
        multiplier = safe_float(getattr(contract, "multiplier", None), 1) or 1

        if is_option and base_symbol:
            underlying_symbols.add((base_symbol, currency))

        position = {
            "assetCategory": asset_category(contract),
            "symbol": symbol,
            "baseSymbol": base_symbol,
            "quantity": quantity,
            "multiplier": multiplier,
            "costBasis": cost_basis,
            "closePrice": close_price,
            "underlyingPrice": None,
            "value": market_value,
            "unrealizedPL": unrealized,
            "currency": currency,
            "isOption": is_option,
            "optionType": option_type,
            "strikePrice": strike_price,
            "expiry": expiry,
            "collectedPremium": (
                option_premium_from_portfolio_item(item, multiplier)
                or option_premiums.get(contract_key(contract), 0)
            ) if is_option else 0,
        }
        data["positions"].append(position)

        bucket = data["plSummary"]["options" if is_option else "stocks"]
        bucket["unrealized"] += unrealized
        bucket["total"] += unrealized

    underlying_prices = request_underlying_prices(ib, underlying_symbols)
    for position in data["positions"]:
        if position["isOption"]:
            continue
        if position["closePrice"]:
            underlying_prices[position["baseSymbol"]] = position["closePrice"]

    for position in data["positions"]:
        if position["isOption"] and position["baseSymbol"] in underlying_prices:
            position["underlyingPrice"] = underlying_prices[position["baseSymbol"]]

    total_unrealized = sum(position["unrealizedPL"] for position in data["positions"])
    data["plSummary"]["total"]["unrealized"] = total_unrealized
    data["plSummary"]["total"]["total"] = total_unrealized
    data["navChange"]["markToMarket"] = total_unrealized

    return data


def parse_month(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.strftime("%Y-%m")
    if isinstance(value, date):
        return value.strftime("%Y-%m")
    if not value:
        return None

    text = str(value).strip()
    for fmt in ("%Y-%m-%d", "%Y%m%d", "%m/%d/%Y", "%Y-%m-%d;%H:%M:%S", "%Y%m%d;%H:%M:%S"):
        try:
            return datetime.strptime(text[: len(fmt)], fmt).strftime("%Y-%m")
        except ValueError:
            pass

    if len(text) >= 7 and text[4] == "-":
        return text[:7]
    if len(text) >= 6 and text[:6].isdigit():
        return f"{text[:4]}-{text[4:6]}"
    return None


def flex_asset_category(value: Any) -> str:
    text = str(value or "").lower()
    if "option" in text:
        return "Options"
    if "stock" in text or "equity" in text:
        return "Stocks"
    if "forex" in text or "cash" in text or "fx" in text:
        return "Forex"
    return str(value or "Other")


def flex_option_symbol(row: Any) -> tuple[str, str, str | None, float | None, str | None]:
    raw_symbol = str(attr(row, "symbol", "ibSymbol", "underlyingSymbol", default="")).strip()
    base_symbol = str(attr(row, "underlyingSymbol", "symbol", "ibSymbol", default=raw_symbol)).strip()
    put_call = str(attr(row, "putCall", "right", "optionType", default="")).upper()[:1] or None
    strike = safe_float(attr(row, "strike", "strikePrice", default=None)) or None
    expiry_raw = attr(row, "expiry", "expirationDate", "lastTradeDateOrContractMonth", default="")
    expiry = None

    if expiry_raw:
        text = str(expiry_raw).strip()
        if len(text) == 8 and text.isdigit():
            expiry = f"{text[:4]}-{text[4:6]}-{text[6:8]}"
        elif len(text) >= 10 and text[4] == "-":
            expiry = text[:10]

    if base_symbol and put_call in {"P", "C"} and strike and expiry:
        return f"{base_symbol} {expiry} {strike:g} {put_call}", base_symbol, put_call, strike, expiry

    parsed_symbol, parsed_base, is_option, parsed_type, parsed_strike, parsed_expiry = parse_option_symbol(raw_symbol)
    if is_option:
        return parsed_symbol, parsed_base, parsed_type, parsed_strike, parsed_expiry

    return raw_symbol, base_symbol or raw_symbol, put_call, strike, expiry


def parse_option_symbol(symbol: str) -> tuple[str, str, bool, str | None, float | None, str | None]:
    parts = symbol.strip().split()
    base_symbol = parts[0] if parts else ""
    if len(parts) < 4:
        return symbol, base_symbol, False, None, None, None

    option_type = parts[-1]
    strike = safe_float(parts[-2])
    expiry = parts[-3]
    if option_type in {"P", "C"} and strike:
        return symbol, base_symbol, True, option_type, strike, expiry
    return symbol, base_symbol, False, None, None, None


def ensure_month(monthly: dict[str, dict[str, Any]], month: str) -> dict[str, Any]:
    return monthly.setdefault(
        month,
        {
            "month": month,
            "optionsPL": 0,
            "optionsPremium": 0,
            "stocksPL": 0,
            "forexPL": 0,
            "syepIncome": 0,
            "interest": 0,
            "interestPaid": 0,
            "commissions": 0,
            "fees": 0,
            "salesTax": 0,
        },
    )


def build_flex_dashboard(token: str, query_id: str) -> dict[str, Any]:
    report = FlexReport(token=token, queryId=query_id)
    data = empty_dashboard()
    monthly: dict[str, dict[str, Any]] = {}
    ticker_pl: dict[str, float] = {}

    statement_rows = first_topic(report, "FlexStatement")
    if statement_rows:
        statement = statement_rows[0]
        data["accountInfo"]["account"] = str(attr(statement, "accountId", "accountId", default=""))
        data["accountInfo"]["period"] = str(
            attr(statement, "fromDate", default="Flex report")
        ) + " - " + str(attr(statement, "toDate", default=""))
        base_currency = str(attr(statement, "currency", "baseCurrency", default="USD"))
        data["accountInfo"]["baseCurrency"] = base_currency
        data["nav"]["baseCurrency"] = base_currency
        data["exchangeRates"] = {base_currency: 1}

    trades = first_topic(report, "Trade", "TradeConfirm")
    for trade in trades:
        category = flex_asset_category(attr(trade, "assetCategory", "assetClass", "type", default=""))
        is_option = category == "Options"
        symbol = str(attr(trade, "symbol", "ibSymbol", "description", default="")).strip()
        base_symbol = symbol
        option_type = None
        strike_price = None
        expiry = None
        if is_option:
            symbol, base_symbol, option_type, strike_price, expiry = flex_option_symbol(trade)

        month = parse_month(attr(trade, "dateTime", "tradeDate", "reportDate", "date", default=""))
        quantity = safe_float(attr(trade, "quantity", "qty", default=0))
        proceeds = safe_float(attr(trade, "proceeds", default=0))
        commission = safe_float(attr(trade, "ibCommission", "commission", default=0))
        realized_pl = safe_float(attr(trade, "realizedPL", "realizedPnl", "fifoPnlRealized", default=0))
        buy_sell = str(attr(trade, "buySell", "side", default="")).upper()

        if month:
            bucket = ensure_month(monthly, month)
            bucket["commissions"] += abs(commission)
            if is_option:
                bucket["optionsPL"] += realized_pl
                if buy_sell in {"SELL", "SLD"} and proceeds > 0:
                    bucket["optionsPremium"] += proceeds + commission
            elif category == "Stocks":
                bucket["stocksPL"] += realized_pl
            elif category == "Forex":
                bucket["forexPL"] += realized_pl

        if realized_pl and symbol:
            data["closedPositions"].append(
                {
                    "assetCategory": category,
                    "symbol": symbol,
                    "realizedPL": realized_pl,
                    "closeDate": str(attr(trade, "dateTime", "tradeDate", "reportDate", "date", default="")),
                }
            )
            ticker_pl[base_symbol or symbol] = ticker_pl.get(base_symbol or symbol, 0) + realized_pl

        if is_option and option_type == "P" and quantity > 0 and realized_pl:
            summary = data["shortPutIncomeSummary"]
            summary["totalRealizedPL"] += realized_pl
            summary["numberOfContracts"] += abs(quantity)
            summary["hasData"] = True

    for cash in first_topic(report, "CashTransaction", "CashReport"):
        month = parse_month(attr(cash, "dateTime", "date", "reportDate", default=""))
        if not month:
            continue

        bucket = ensure_month(monthly, month)
        description = str(attr(cash, "description", "type", "subType", default="")).lower()
        amount = safe_float(attr(cash, "amount", "total", default=0))

        if "interest" in description:
            bucket["interest"] += amount
            if amount < 0:
                bucket["interestPaid"] += abs(amount)
        elif "fee" in description:
            bucket["fees"] += abs(amount)
        elif "tax" in description:
            bucket["salesTax"] += abs(amount)
        elif "dividend" in description:
            bucket["interest"] += amount

    if data["shortPutIncomeSummary"]["numberOfContracts"]:
        summary = data["shortPutIncomeSummary"]
        summary["averagePLPerContract"] = summary["totalRealizedPL"] / summary["numberOfContracts"]

    data["monthlySummary"] = [monthly[key] for key in sorted(monthly)]
    data["tickerPL"] = [
        {"ticker": ticker, "totalPL": total}
        for ticker, total in sorted(ticker_pl.items(), key=lambda item: abs(item[1]), reverse=True)
    ]

    option_realized = sum(row["optionsPL"] for row in data["monthlySummary"])
    stock_realized = sum(row["stocksPL"] for row in data["monthlySummary"])
    forex_realized = sum(row["forexPL"] for row in data["monthlySummary"])
    data["plSummary"]["options"]["realized"] = option_realized
    data["plSummary"]["stocks"]["realized"] = stock_realized
    data["plSummary"]["forex"]["realized"] = forex_realized
    data["plSummary"]["total"]["realized"] = option_realized + stock_realized + forex_realized

    return data


def merge_flex_history(live: dict[str, Any], flex: dict[str, Any]) -> dict[str, Any]:
    live["monthlySummary"] = flex["monthlySummary"]
    live["closedPositions"] = flex["closedPositions"]
    live["tickerPL"] = flex["tickerPL"]
    live["shortPutIncomeSummary"] = flex["shortPutIncomeSummary"]

    for key in ("stocks", "options", "forex", "total"):
        live["plSummary"][key]["realized"] = flex["plSummary"][key]["realized"]
        live["plSummary"][key]["total"] = live["plSummary"][key]["realized"] + live["plSummary"][key]["unrealized"]

    if flex["accountInfo"]["period"]:
        live["accountInfo"]["period"] = flex["accountInfo"]["period"]
    if flex["accountInfo"]["account"] and not live["accountInfo"]["account"]:
        live["accountInfo"]["account"] = flex["accountInfo"]["account"]

    return live


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4001)
    parser.add_argument("--client-id", type=int, default=77)
    parser.add_argument("--timeout", type=float, default=10)
    parser.add_argument("--readonly", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--flex-token", default="")
    parser.add_argument("--flex-query-id", default="")
    parser.add_argument("--prices-only", action="store_true")
    parser.add_argument("--symbols-json", default="[]")
    args = parser.parse_args()

    ib = IB()
    try:
        ib.connect(
            args.host,
            args.port,
            clientId=args.client_id,
            timeout=args.timeout,
            readonly=args.readonly,
        )
        ib.reqMarketDataType(1)
        ib.sleep(1)
        if args.prices_only:
            symbols = {
                (str(item.get("symbol", "")), str(item.get("currency", "USD")))
                for item in json.loads(args.symbols_json)
                if item.get("symbol")
            }
            print(json.dumps({"prices": request_underlying_prices(ib, symbols)}))
            return 0

        dashboard = build_dashboard(ib)
        if args.flex_token and args.flex_query_id:
            flex_dashboard = build_flex_dashboard(args.flex_token, args.flex_query_id)
            dashboard = merge_flex_history(dashboard, flex_dashboard)
        print(json.dumps(dashboard))
    except Exception as exc:
        print(f"Failed to load IB Gateway data from {args.host}:{args.port}: {exc}", file=sys.stderr)
        return 1
    finally:
        if ib.isConnected():
            ib.disconnect()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
