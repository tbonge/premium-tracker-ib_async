#!/usr/bin/env python
"""Load live portfolio data from a local Interactive Brokers Gateway."""

from __future__ import annotations

import argparse
import copy
import json
import math
import sys
import time
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

try:
    from ib_async import IB, ExecutionFilter, Index, Stock
except ImportError as exc:
    IB = None
    ExecutionFilter = None
    Stock = None
    Index = None
    IB_ASYNC_IMPORT_ERROR = exc
else:
    IB_ASYNC_IMPORT_ERROR = None


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


def positive_price(value: Any) -> float:
    price = safe_float(value)
    return price if price > 0 else 0


def flex_error_message(exc: Exception) -> str:
    message = str(exc)
    if "1020" in message:
        return (
            f"{message}\n\n"
            "IBKR rejected the Flex Web Service request before generating a report. "
            "Check that IB_FLEX_QUERY_ID is the numeric Query ID from the saved Activity Flex Query info popover, "
            "not the query name or a ReferenceCode; that IB_FLEX_TOKEN is the current Flex Web Service token; "
            "that the token was created by the same Client Portal user or master account that can see the query; "
            "and that any token IP restriction allows this machine. Restart npm start after changing either value."
        )
    return message


class SimpleFlexReport:
    def __init__(self, xml_text: str):
        self.root = ET.fromstring(xml_text)
        self.rows_by_topic: dict[str, list[Any]] = {}
        self._collect(self.root)

    def _collect(self, element: ET.Element) -> None:
        if element.attrib:
            row = SimpleNamespace(**element.attrib)
            self.rows_by_topic.setdefault(element.tag, []).append(row)
        for child in element:
            self._collect(child)

    def topics(self) -> list[str]:
        return list(self.rows_by_topic)

    def extract(self, topic: str) -> list[Any]:
        return self.rows_by_topic.get(topic, [])


def flex_request(path: str, params: dict[str, str]) -> str:
    base_url = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService"
    url = f"{base_url}{path}?{urlencode(params)}"
    request = Request(
        url,
        headers={
            "User-Agent": "premium-tracker-ib_async/1.0",
            "Accept": "application/xml,text/xml,*/*",
        },
    )
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def flex_response_value(root: ET.Element, name: str) -> str:
    child = root.find(name)
    return child.text.strip() if child is not None and child.text else ""


def flex_failure_from_xml(xml_text: str) -> str:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return xml_text.strip()[:500]
    code = flex_response_value(root, "ErrorCode")
    message = flex_response_value(root, "ErrorMessage")
    if code or message:
        return f"{code}: {message}".strip(": ")
    return ET.tostring(root, encoding="unicode")[:500]


def load_flex_report(token: str, query_id: str, retries: int = 8, wait_seconds: float = 5.0) -> SimpleFlexReport:
    send_xml = flex_request("/SendRequest", {"t": token, "q": query_id, "v": "3"})
    send_root = ET.fromstring(send_xml)
    status = flex_response_value(send_root, "Status")
    if status != "Success":
        raise RuntimeError(flex_failure_from_xml(send_xml))

    reference_code = flex_response_value(send_root, "ReferenceCode")
    if not reference_code:
        raise RuntimeError("Flex Web Service did not return a ReferenceCode.")

    last_error = ""
    for attempt in range(retries + 1):
        if attempt:
            time.sleep(wait_seconds)
        statement_xml = flex_request("/GetStatement", {"t": token, "q": reference_code, "v": "3"})
        try:
            root = ET.fromstring(statement_xml)
        except ET.ParseError as exc:
            raise RuntimeError(f"Flex Web Service returned invalid XML: {exc}") from exc

        status = flex_response_value(root, "Status")
        if status == "Fail":
            last_error = flex_failure_from_xml(statement_xml)
            if last_error.startswith("1019:") or "in progress" in last_error.lower():
                continue
            raise RuntimeError(last_error)
        report = SimpleFlexReport(statement_xml)
        if "FlexStatement" not in report.topics():
            last_error = "Flex report generation returned no statements yet."
            continue
        return report

    raise RuntimeError(last_error or "Flex statement was not ready before retries were exhausted.")


def attr(obj: Any, *names: str, default: Any = "") -> Any:
    normalized_names = {normalize_topic(name) for name in names}
    for name in names:
        if hasattr(obj, name):
            value = getattr(obj, name)
            if value is not None and value != "":
                return value
        if isinstance(obj, dict) and name in obj:
            value = obj[name]
            if value is not None and value != "":
                return value
    for key, value in vars(obj).items() if hasattr(obj, "__dict__") else []:
        if normalize_topic(key) in normalized_names and value is not None and value != "":
            return value
    if isinstance(obj, dict):
        for key, value in obj.items():
            if normalize_topic(key) in normalized_names and value is not None and value != "":
                return value
    return default


def first_topic(report: Any, *topics: str) -> list[Any]:
    available = report.topics()
    for topic in topics:
        if topic in available:
            return report.extract(topic)
    normalized_available = {normalize_topic(topic): topic for topic in available}
    for topic in topics:
        actual_topic = normalized_available.get(normalize_topic(topic))
        if actual_topic:
            return report.extract(actual_topic)
    return []


def normalize_topic(value: str) -> str:
    return "".join(char for char in str(value).lower() if char.isalnum())


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
        "weeklySummary": [],
        "dailyOptionsSummary": [],
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
        "shortCallIncomeSummary": {
            "totalRealizedPL": 0,
            "numberOfContracts": 0,
            "averagePLPerContract": 0,
            "assignmentRate": 0,
            "winRate": 0,
            "hasData": False,
        },
        "historyStatus": {
            "source": "gateway",
            "complete": False,
            "warnings": [
                "Historical Flex data was not loaded. Gateway-only mode is limited to current account state and available session executions."
            ],
        },
        "marginLiquidity": {
            "netLiquidation": 0,
            "totalCash": 0,
            "availableFunds": 0,
            "excessLiquidity": 0,
            "buyingPower": 0,
            "maintenanceMargin": 0,
            "initialMargin": 0,
            "cushion": 0,
        },
        "equityHistory": [],
        "premiumEfficiency": [],
        "closedTradeMetrics": [],
        # Internal merge input populated from Gateway commission reports.
        "sessionRealizedEvents": [],
        "sessionOptionSales": [],
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
    price = positive_price(getattr(item, "marketPrice", None))
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
        if tag in {
            "NetLiquidation", "TotalCashValue", "CashBalance", "AvailableFunds",
            "ExcessLiquidity", "BuyingPower", "MaintMarginReq", "InitMarginReq", "Cushion",
        }:
            key = f"{tag}:{currency or base_currency}"
            values[key] = safe_float(value)

    return account, base_currency, values


def request_underlying_prices(ib: IB, symbols: set[tuple[str, str]]) -> dict[str, float]:
    prices: dict[str, float] = {}
    contracts = []

    for symbol, currency in sorted(symbols):
        if not symbol:
            continue
        # SPX is an index, not stock. Qualifying it as STK silently yields no
        # quote on many Gateway sessions.
        if symbol.upper() in {"SPX", "SPXW", "XSP"}:
            contracts.append(Index("SPX" if symbol.upper() == "SPXW" else symbol.upper(), "CBOE", currency or "USD"))
        else:
            contracts.append(Stock(symbol, "SMART", currency or "USD"))

    if not contracts:
        return prices

    try:
        qualified = ib.qualifyContracts(*contracts)
        def collect(requested: list[Any], market_data_type: int) -> None:
            if not requested:
                return
            ib.reqMarketDataType(market_data_type)
            tickers = [ib.reqMktData(contract, "", False, False) for contract in requested]
            ib.sleep(2)
            for ticker in tickers:
                contract = getattr(ticker, "contract", None)
                symbol = getattr(contract, "symbol", "")
                price = (
                    positive_price(ticker.marketPrice())
                    or positive_price(getattr(ticker, "last", None))
                    or positive_price(getattr(ticker, "close", None))
                    or positive_price(getattr(ticker, "midpoint", lambda: 0)())
                )
                if symbol and price:
                    prices[symbol] = price

        collect(qualified, 1)
        missing_contracts = [
            contract for contract in qualified
            if getattr(contract, "symbol", "") not in prices
        ]
        if missing_contracts:
            collect(missing_contracts, 3)
        ib.reqMarketDataType(1)
    except Exception as exc:
        print(f"Unable to load underlying market prices: {exc}", file=sys.stderr)

    return prices


def request_position_quotes(ib: IB, portfolio_items: list[Any]) -> dict[str, dict[str, float]]:
    """Fetch current marks, option deltas, and option underlying prices.

    Portfolio updates can contain stale/zero marketPrice values even while the
    Gateway is connected. Snapshot tickers provide a second, explicit quote
    path. If live data is unavailable, IB's delayed stream is tried as a
    fallback (subject to the account's market-data permissions).
    """
    contracts = []
    for item in portfolio_items:
        source = getattr(item, "contract", None)
        if source is None:
            continue
        # Contracts delivered by portfolio() have an empty exchange. IB accepts
        # them for account updates but not for reqMktData, so request a SMART
        # routing copy while retaining the conId and all option identifiers.
        contract = copy.copy(source)
        if not getattr(contract, "exchange", ""):
            contract.exchange = "SMART"
        contracts.append(contract)
    quotes: dict[str, dict[str, float]] = {}

    def load(market_data_type: int, only_missing: bool = False) -> None:
        try:
            ib.reqMarketDataType(market_data_type)
            requested = [
                contract for contract in contracts
                if not only_missing
                or contract_key(contract) not in quotes
                or (
                    str(getattr(contract, "secType", "")).upper() == "OPT"
                    and not quotes[contract_key(contract)].get("underlyingPrice")
                )
            ]
            for offset in range(0, len(requested), 50):
                batch = requested[offset:offset + 50]
                tickers = [ib.reqMktData(contract, "", False, False) for contract in batch]
                ib.sleep(2)
                for ticker in tickers:
                    contract = getattr(ticker, "contract", None)
                    if contract is None:
                        continue
                    key = contract_key(contract)
                    greek_sets = [
                        getattr(ticker, name, None)
                        for name in ("modelGreeks", "lastGreeks", "bidGreeks", "askGreeks")
                    ]
                    price = (
                        positive_price(ticker.marketPrice())
                        or positive_price(getattr(ticker, "last", None))
                        or positive_price(getattr(ticker, "close", None))
                        or positive_price(getattr(ticker, "midpoint", lambda: 0)())
                    )
                    delta = next(
                        (safe_float(getattr(greeks, "delta", None)) for greeks in greek_sets
                         if greeks and safe_float(getattr(greeks, "delta", None))),
                        0,
                    )
                    under_price = next(
                        (positive_price(getattr(greeks, "undPrice", None)) for greeks in greek_sets
                         if greeks and positive_price(getattr(greeks, "undPrice", None))),
                        0,
                    )
                    if price or delta or under_price:
                        quote = quotes.setdefault(key, {})
                        if price:
                            quote["price"] = price
                        if delta:
                            quote["delta"] = delta
                        if under_price:
                            quote["underlyingPrice"] = under_price
        except Exception as exc:
            print(f"Unable to load position market data type {market_data_type}: {exc}", file=sys.stderr)

    load(1)
    load(3, only_missing=True)
    ib.reqMarketDataType(1)
    return quotes


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


def execution_day(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    if not value:
        return None

    text = str(value).strip()
    for fmt in ("%Y%m%d %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y%m%d-%H:%M:%S", "%Y-%m-%d", "%Y%m%d"):
        try:
            return datetime.strptime(text[: len(fmt)], fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass

    if len(text) >= 10 and text[4] == "-":
        return text[:10]
    if len(text) >= 8 and text[:8].isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:8]}"
    return None


def empty_daily_options_summary(end_day: date | None = None) -> dict[str, dict[str, float | str]]:
    end_day = end_day or date.today()
    start_day = end_day - timedelta(days=29)
    return {
        (start_day + timedelta(days=offset)).strftime("%Y-%m-%d"): {
            "date": (start_day + timedelta(days=offset)).strftime("%Y-%m-%d"),
            "premiumCollected": 0,
            "closedPL": 0,
        }
        for offset in range(30)
    }


def read_option_premiums(
    ib: IB, account: str = ""
) -> tuple[
    dict[str, float],
    list[dict[str, float | str]],
    list[dict[str, float | str]],
    list[dict[str, float | str]],
    list[dict[str, float | str]],
]:
    premiums: dict[str, float] = {}
    monthly: dict[str, dict[str, float | str]] = {}
    daily = empty_daily_options_summary()
    realized_events: list[dict[str, float | str]] = []
    option_sales: list[dict[str, float | str]] = []

    fills = ib.fills()
    if not fills:
        try:
            exec_filter = ExecutionFilter(acctCode=account) if account else ExecutionFilter()
            fills = ib.reqExecutions(exec_filter)
        except Exception as exc:
            print(f"Unable to load execution premium data: {exc}", file=sys.stderr)
            return premiums, [], [], [], []

    for fill in fills:
        contract = getattr(fill, "contract", None)
        execution = getattr(fill, "execution", None)
        if not contract or not execution:
            continue
        if account and getattr(execution, "acctNumber", "") not in {"", account}:
            continue

        side = (getattr(execution, "side", "") or "").upper()
        shares = abs(safe_float(getattr(execution, "shares", None)))
        price = safe_float(getattr(execution, "price", None))
        multiplier = safe_float(getattr(contract, "multiplier", None), 100) or 100
        commission_report = getattr(fill, "commissionReport", None)
        commission = abs(safe_float(getattr(commission_report, "commission", None))) if commission_report else 0
        realized_pnl = safe_float(getattr(commission_report, "realizedPNL", None)) if commission_report else 0
        if abs(realized_pnl) > 1e100:
            realized_pnl = 0
        day = execution_day(getattr(execution, "time", None))

        if realized_pnl and day:
            security_type = str(getattr(contract, "secType", "")).upper()
            category = "Options" if security_type == "OPT" else "Forex" if security_type in {"CASH", "CFD"} else "Stocks"
            symbol, base_symbol, is_option, option_type, strike_price, expiry = contract_symbol(contract)
            realized_events.append(
                {
                    "date": day,
                    "assetCategory": category,
                    "symbol": symbol,
                    "baseSymbol": base_symbol or symbol,
                    "optionType": option_type if is_option else None,
                    "quantity": shares,
                    "realizedPL": realized_pnl,
                }
            )

        if str(getattr(contract, "secType", "")).upper() != "OPT":
            continue

        if not shares or not price:
            continue

        gross_premium = price * shares * multiplier
        if side in {"SLD", "SELL"}:
            signed_premium = gross_premium - commission
            symbol, base_symbol, _, option_type, _, _ = contract_symbol(contract)
            option_sales.append(
                {
                    "date": day or "",
                    "symbol": symbol,
                    "baseSymbol": base_symbol,
                    "optionType": option_type or "",
                    "quantity": shares,
                    "premium": signed_premium,
                }
            )
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
            if day in daily:
                daily[day]["premiumCollected"] = safe_float(daily[day]["premiumCollected"]) + signed_premium
        elif side in {"BOT", "BUY"}:
            signed_premium = -gross_premium - commission
        else:
            continue

        if realized_pnl and day in daily:
            daily[day]["closedPL"] = safe_float(daily[day]["closedPL"]) + realized_pnl

        key = contract_key(contract)
        premiums[key] = premiums.get(key, 0) + signed_premium

    return premiums, [monthly[key] for key in sorted(monthly)], [daily[key] for key in sorted(daily)], realized_events, option_sales


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
    def account_metric(tag: str) -> float:
        return account_values.get(f"{tag}:{base_currency}", 0) or account_values.get(f"{tag}:", 0)

    data["marginLiquidity"] = {
        "netLiquidation": net_liq,
        "totalCash": cash,
        "availableFunds": account_metric("AvailableFunds"),
        "excessLiquidity": account_metric("ExcessLiquidity"),
        "buyingPower": account_metric("BuyingPower"),
        "maintenanceMargin": account_metric("MaintMarginReq"),
        "initialMargin": account_metric("InitMarginReq"),
        "cushion": account_metric("Cushion"),
    }

    portfolio_items = ib.portfolio()
    position_quotes = request_position_quotes(ib, portfolio_items)
    option_premiums, monthly_premium_summary, daily_options_summary, realized_events, option_sales = read_option_premiums(ib, account)
    data["sessionRealizedEvents"] = realized_events
    data["sessionOptionSales"] = option_sales
    monthly_by_key = {row["month"]: row for row in monthly_premium_summary}
    for event in realized_events:
        month = str(event["date"])[:7]
        bucket = monthly_by_key.setdefault(month, ensure_month({}, month))
        summary_key = {
            "Options": "optionsPL",
            "Forex": "forexPL",
        }.get(str(event["assetCategory"]), "stocksPL")
        bucket[summary_key] += safe_float(event["realizedPL"])
    data["monthlySummary"] = [monthly_by_key[key] for key in sorted(monthly_by_key)]
    data["dailyOptionsSummary"] = daily_options_summary
    for event in realized_events:
        bucket_key = {
            "Options": "options",
            "Forex": "forex",
        }.get(str(event["assetCategory"]), "stocks")
        amount = safe_float(event["realizedPL"])
        data["plSummary"][bucket_key]["realized"] += amount
        data["closedPositions"].append(
            {
                "assetCategory": event["assetCategory"],
                "symbol": event["symbol"],
                "realizedPL": amount,
                "closeDate": event["date"],
            }
        )
    gateway_weekly: dict[str, dict[str, Any]] = {}
    for row in daily_options_summary:
        week = week_key(row["date"])
        if week:
            bucket = ensure_week(gateway_weekly, week)
            bucket["optionsPremium"] += safe_float(row["premiumCollected"])
            bucket["optionsPL"] += safe_float(row["closedPL"])
    data["weeklySummary"] = [gateway_weekly[key] for key in sorted(gateway_weekly)]
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
        quote = position_quotes.get(contract_key(contract), {})
        if quote.get("price"):
            close_price = safe_float(quote["price"])

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
            "underlyingPrice": quote.get("underlyingPrice"),
            "delta": quote.get("delta"),
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
    total_realized = sum(data["plSummary"][key]["realized"] for key in ("stocks", "options", "forex"))
    for key in ("stocks", "options", "forex"):
        data["plSummary"][key]["total"] = data["plSummary"][key]["realized"] + data["plSummary"][key]["unrealized"]
    data["plSummary"]["total"]["realized"] = total_realized
    data["plSummary"]["total"]["unrealized"] = total_unrealized
    data["plSummary"]["total"]["total"] = total_realized + total_unrealized
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


def parse_day(value: Any) -> str | None:
    return execution_day(value)


def flex_asset_category(value: Any) -> str:
    text = str(value or "").lower()
    if text in {"opt", "option", "options"} or "option" in text:
        return "Options"
    if text in {"stk", "stock", "stocks"} or "stock" in text or "equity" in text:
        return "Stocks"
    if text in {"cash", "fx", "forex"} or "forex" in text or "cash" in text or "fx" in text:
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


def flex_option_key(row: Any) -> tuple[str, str, str, str] | None:
    _, base_symbol, option_type, strike_price, expiry = flex_option_symbol(row)
    if not base_symbol or option_type not in {"P", "C"} or not strike_price or not expiry:
        return None
    return (base_symbol, expiry, f"{strike_price:g}", option_type)


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


def week_key(value: Any) -> str | None:
    day = parse_day(value)
    if not day:
        return None
    parsed = datetime.strptime(day, "%Y-%m-%d").date()
    monday = parsed - timedelta(days=parsed.weekday())
    return monday.strftime("%Y-%m-%d")


def ensure_week(weekly: dict[str, dict[str, Any]], week: str) -> dict[str, Any]:
    bucket = ensure_month({}, week[:7])
    bucket.pop("month", None)
    bucket["week"] = week
    return weekly.setdefault(week, bucket)


def apply_monthly_cash_row(row: Any, monthly: dict[str, dict[str, Any]], category_hint: str = "") -> None:
    month = parse_month(attr(row, "dateTime", "date", "reportDate", "valueDate", default=""))
    if not month:
        return

    bucket = ensure_month(monthly, month)
    description = " ".join(
        str(attr(row, field, default=""))
        for field in ("description", "type", "subType", "currencySummary")
    ).lower()
    rate = safe_float(attr(row, "fxRateToBase", default=0)) or 1
    amount = safe_float(attr(row, "amount", "total", "netCash", "interest", "interestPaidToCustomer", "taxes", default=0)) * rate
    hint = category_hint.lower()

    if "securities borrowed" in hint or "securities lent" in hint or "syep" in hint:
        bucket["syepIncome"] += amount
    elif "interest" in hint or "interest" in description:
        bucket["interest"] += amount
        if amount < 0:
            bucket["interestPaid"] += abs(amount)
    elif "fee" in hint or "fee" in description:
        bucket["fees"] -= amount
    elif "tax" in hint or "tax" in description:
        bucket["salesTax"] -= amount


def flex_field_map(rows: list[Any]) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    for row in rows:
        name = attr(row, "fieldName", "field", "name", "label", "key", default="")
        value = attr(row, "fieldValue", "value", "amount", default="")
        if name:
            fields[str(name).strip().lower()] = value
        if hasattr(row, "__dict__"):
            for key, attr_value in vars(row).items():
                if attr_value is not None and attr_value != "":
                    fields[str(key).strip().lower()] = attr_value
                    fields[normalize_topic(key)] = attr_value
        elif isinstance(row, dict):
            for key, attr_value in row.items():
                if attr_value is not None and attr_value != "":
                    fields[str(key).strip().lower()] = attr_value
                    fields[normalize_topic(key)] = attr_value
    return fields


def apply_flex_account_info(data: dict[str, Any], report: Any) -> None:
    account_rows = first_topic(report, "AccountInformation", "Account Information", "AccountInfo")
    fields = flex_field_map(account_rows)
    first_row = account_rows[0] if account_rows else {}
    account = (
        fields.get("account")
        or fields.get("account id")
        or attr(first_row, "accountId", "account", default="")
    )
    name = fields.get("name") or fields.get("account title") or attr(first_row, "name", "accountTitle", default="")
    base_currency = (
        fields.get("base currency")
        or fields.get("basecurrency")
        or attr(first_row, "baseCurrency", "currency", default="")
    )
    if account:
        data["accountInfo"]["account"] = str(account)
    if name:
        data["accountInfo"]["name"] = str(name)
    if base_currency:
        data["accountInfo"]["baseCurrency"] = str(base_currency)
        data["nav"]["baseCurrency"] = str(base_currency)
        data["exchangeRates"] = {str(base_currency): 1}


def apply_flex_exchange_rates(data: dict[str, Any], report: Any) -> None:
    rows = first_topic(report, "ConversionRate", "Currency Rates")
    latest_rates: dict[str, tuple[str, float]] = {}
    base_currency = data["accountInfo"]["baseCurrency"]
    for row in rows:
        from_currency = str(attr(row, "fromCurrency", default="")).strip()
        to_currency = str(attr(row, "toCurrency", default="")).strip()
        rate = safe_float(attr(row, "rate", default=0))
        report_date = str(attr(row, "reportDate", default=""))
        if not from_currency or to_currency != base_currency or not rate:
            continue
        if from_currency not in latest_rates or report_date >= latest_rates[from_currency][0]:
            latest_rates[from_currency] = (report_date, rate)

    for currency, (_, rate) in latest_rates.items():
        data["exchangeRates"][currency] = rate


def apply_flex_nav(data: dict[str, Any], report: Any) -> None:
    nav_rows = first_topic(
        report,
        "NetAssetValue",
        "Net Asset Value (NAV) in Base",
        "Net Asset Value",
        "EquitySummaryByReportDateInBase",
    )
    if nav_rows and attr(nav_rows[0], "reportDate", default=""):
        nav_rows = sorted(nav_rows, key=lambda row: str(attr(row, "reportDate", default="")))
    for row in nav_rows:
        asset_class = str(attr(row, "assetClass", "assetCategory", "currency", default="")).strip().lower()
        cash = safe_float(attr(row, "cash", "endingCash", default=0))
        current_total = safe_float(attr(row, "currentTotal", "total", "value", "amount", default=0))
        if cash:
            data["nav"]["cash"] = cash
        if asset_class == "cash" and current_total:
            data["nav"]["cash"] = current_total
        elif asset_class == "total" or current_total:
            data["totalNAV"] = current_total
            data["navChange"]["endingValue"] = current_total
        rate_of_return = safe_float(attr(row, "timeWeightedRateOfReturn", "twr", default=0))
        if rate_of_return:
            data["rateOfReturn"] = rate_of_return


def apply_flex_nav_change(data: dict[str, Any], report: Any) -> None:
    nav_change_rows = first_topic(report, "ChangeInNAV", "Change in NAV")
    fields = flex_field_map(nav_change_rows)
    mapping = {
        "startingValue": ("starting value", "startingvalue"),
        "markToMarket": ("mark-to-market", "mark to market", "marktomarket", "mtm"),
        "depositsAndWithdrawals": ("deposits & withdrawals", "deposits and withdrawals", "depositswithdrawals"),
        "interest": ("interest",),
        "changeInInterestAccruals": ("change in interest accruals", "changeininterestaccruals"),
        "otherFees": ("other fees", "otherfees"),
        "commissions": ("commissions",),
        "salesTax": ("sales tax", "salestax"),
        "otherFXTranslations": ("other fx translations", "otherfxtranslations", "fxtranslation"),
        "endingValue": ("ending value", "endingvalue"),
    }
    for target, names in mapping.items():
        for name in names:
            if name in fields:
                data["navChange"][target] = safe_float(fields[name])
                break
    if data["navChange"]["endingValue"] and not data["totalNAV"]:
        data["totalNAV"] = data["navChange"]["endingValue"]
    twr = safe_float(fields.get("twr"))
    if twr:
        data["rateOfReturn"] = twr


def apply_flex_equity_history(data: dict[str, Any], report: Any) -> None:
    rows = first_topic(report, "EquitySummaryByReportDateInBase")
    points: list[dict[str, Any]] = []
    for row in sorted(rows, key=lambda item: str(attr(item, "reportDate", default=""))):
        report_day = parse_day(attr(row, "reportDate", default=""))
        total = safe_float(attr(row, "total", default=0))
        if not report_day or not total:
            continue
        points.append(
            {
                "date": report_day,
                "total": total,
                "cash": safe_float(attr(row, "cash", default=0)),
                "stocks": safe_float(attr(row, "stock", default=0)),
                "options": safe_float(attr(row, "options", default=0)),
                "drawdown": 0.0,
            }
        )

    peak = 0.0
    for point in points:
        peak = max(peak, point["total"])
        point["drawdown"] = (point["total"] - peak) / peak if peak else 0
    data["equityHistory"] = points


def apply_flex_premium_efficiency(data: dict[str, Any], report: Any, option_activity: dict[str, Any]) -> None:
    orders = first_topic(report, "Order", "Orders") or first_topic(report, "Trade", "Trades")
    by_symbol: dict[str, dict[str, Any]] = {}
    for row in orders:
        if flex_asset_category(attr(row, "assetCategory", "assetClass", default="")) != "Options":
            continue
        if str(attr(row, "transactionType", default="")).upper() == "BOOKTRADE":
            continue
        _, base_symbol, option_type, strike, _ = flex_option_symbol(row)
        if not base_symbol:
            continue
        summary = by_symbol.setdefault(
            base_symbol,
            {"symbol": base_symbol, "premiumCollected": 0.0, "realizedPL": 0.0, "commissions": 0.0, "putCapital": 0.0, "trades": 0},
        )
        currency = str(attr(row, "currency", default=data["accountInfo"]["baseCurrency"]))
        rate = safe_float(attr(row, "fxRateToBase", default=0)) or data["exchangeRates"].get(currency, 1) or 1
        quantity = safe_float(attr(row, "quantity", "qty", default=0))
        side = str(attr(row, "buySell", "side", default="")).upper()
        proceeds = safe_float(attr(row, "proceeds", default=0)) * rate
        commission = safe_float(attr(row, "ibCommission", "commission", default=0)) * rate
        realized = safe_float(attr(row, "fifoPnlRealized", "realizedPnl", "realizedPL", default=0)) * rate
        summary["commissions"] += abs(commission)
        summary["realizedPL"] += realized
        if quantity < 0 and side in {"SELL", "SLD"} and proceeds > 0:
            summary["premiumCollected"] += proceeds + commission
            summary["trades"] += 1
            if option_type == "P" and strike:
                multiplier = safe_float(attr(row, "multiplier", default=100), 100) or 100
                summary["putCapital"] += strike * abs(quantity) * multiplier * rate

    days_by_symbol: dict[str, list[float]] = {}
    for trade in option_activity.get("arocTrades", []):
        base_symbol = str(trade.get("symbol", "")).split()[0]
        if base_symbol:
            days_by_symbol.setdefault(base_symbol, []).append(safe_float(trade.get("daysOpen", 0)))

    output = []
    for symbol, summary in by_symbol.items():
        days = days_by_symbol.get(symbol, [])
        capital = summary["putCapital"]
        summary["premiumYield"] = summary["premiumCollected"] / capital if capital else 0
        summary["realizedReturn"] = summary["realizedPL"] / capital if capital else 0
        summary["averageDaysOpen"] = sum(days) / len(days) if days else 0
        output.append(summary)
    data["premiumEfficiency"] = sorted(output, key=lambda item: item["premiumCollected"], reverse=True)


def apply_flex_weekly_summary(data: dict[str, Any], report: Any) -> None:
    weekly: dict[str, dict[str, Any]] = {}
    orders = first_topic(report, "Order", "Orders") or first_topic(report, "Trade", "Trades")
    for row in orders:
        week = week_key(attr(row, "dateTime", "tradeDate", "reportDate", "date", default=""))
        if not week:
            continue
        bucket = ensure_week(weekly, week)
        category = flex_asset_category(attr(row, "assetCategory", "assetClass", default=""))
        currency = str(attr(row, "currency", default=data["accountInfo"]["baseCurrency"]))
        rate = safe_float(attr(row, "fxRateToBase", default=0)) or data["exchangeRates"].get(currency, 1) or 1
        quantity = safe_float(attr(row, "quantity", "qty", default=0))
        side = str(attr(row, "buySell", "side", default="")).upper()
        transaction_type = str(attr(row, "transactionType", default="")).upper()
        proceeds = safe_float(attr(row, "proceeds", default=0)) * rate
        commission = safe_float(attr(row, "ibCommission", "commission", default=0)) * rate
        realized = safe_float(attr(row, "fifoPnlRealized", "realizedPnl", "realizedPL", default=0)) * rate
        bucket["commissions"] += abs(commission)
        if category == "Options":
            bucket["optionsPL"] += realized
            if transaction_type != "BOOKTRADE" and quantity < 0 and side in {"SELL", "SLD"} and proceeds > 0:
                bucket["optionsPremium"] += proceeds + commission
        elif category == "Stocks":
            bucket["stocksPL"] += realized
        elif category == "Forex":
            bucket["forexPL"] += realized

    for row in first_topic(report, "CashTransaction", "Cash Transactions"):
        if str(attr(row, "levelOfDetail", default="")).upper() == "SUMMARY":
            continue
        week = week_key(attr(row, "dateTime", "date", "reportDate", "valueDate", default=""))
        if not week:
            continue
        bucket = ensure_week(weekly, week)
        description = " ".join(str(attr(row, field, default="")) for field in ("description", "type", "subType")).lower()
        rate = safe_float(attr(row, "fxRateToBase", default=0)) or 1
        amount = safe_float(attr(row, "amount", "total", default=0)) * rate
        if "securities lent" in description or "syep" in description:
            bucket["syepIncome"] += amount
        elif "interest" in description:
            bucket["interest"] += amount
            if amount < 0:
                bucket["interestPaid"] += abs(amount)
        elif "fee" in description:
            bucket["fees"] -= amount
        elif "tax" in description:
            bucket["salesTax"] -= amount

    data["weeklySummary"] = [weekly[key] for key in sorted(weekly)]


def apply_flex_closed_trade_metrics(data: dict[str, Any], report: Any) -> None:
    by_symbol: dict[str, dict[str, Any]] = {}
    for row in first_topic(report, "Lot", "Lots"):
        if flex_asset_category(attr(row, "assetCategory", "assetClass", default="")) != "Options":
            continue
        symbol, _, _, strike, _ = flex_option_symbol(row)
        if not symbol or not strike:
            continue
        quantity = abs(safe_float(attr(row, "quantity", "qty", default=0)))
        if not quantity:
            continue
        currency = str(attr(row, "currency", default=data["accountInfo"]["baseCurrency"]))
        rate = safe_float(attr(row, "fxRateToBase", default=0)) or data["exchangeRates"].get(currency, 1) or 1
        premium = abs(safe_float(attr(row, "cost", "costBasis", default=0))) * rate
        realized = safe_float(attr(row, "fifoPnlRealized", "realizedPnl", default=0)) * rate
        multiplier = safe_float(attr(row, "multiplier", default=100), 100) or 100
        risk = strike * quantity * multiplier * rate
        opened = parse_day(attr(row, "openDateTime", "holdingPeriodDateTime", default=""))
        closed = parse_day(attr(row, "dateTime", "tradeDate", "reportDate", default=""))
        days_open = 1
        if opened and closed:
            days_open = max(1, (datetime.strptime(closed, "%Y-%m-%d").date() - datetime.strptime(opened, "%Y-%m-%d").date()).days)
        aroc = (realized / risk) * (365 / days_open) if risk else 0
        summary = by_symbol.setdefault(symbol, {"symbol": symbol, "premiumCollected": 0.0, "capitalAtRisk": 0.0, "weightedDays": 0.0, "weightedAroc": 0.0, "tradeCount": 0.0})
        summary["premiumCollected"] += premium
        summary["capitalAtRisk"] += risk
        summary["weightedDays"] += days_open * quantity
        summary["weightedAroc"] += aroc * quantity
        summary["tradeCount"] += quantity

    data["closedTradeMetrics"] = [
        {
            "symbol": summary["symbol"],
            "premiumCollected": summary["premiumCollected"],
            "capitalAtRisk": summary["capitalAtRisk"],
            "daysOpen": summary["weightedDays"] / summary["tradeCount"],
            "aroc": summary["weightedAroc"] / summary["tradeCount"],
            "tradeCount": summary["tradeCount"],
        }
        for summary in by_symbol.values()
        if summary["tradeCount"]
    ]


def close_option_lots(
    lots_by_key: dict[tuple[str, str, str, str], list[dict[str, float]]],
    key: tuple[str, str, str, str],
    quantity: float,
) -> tuple[float, float | None, float]:
    remaining = abs(quantity)
    premium = 0.0
    weighted_open_time = 0.0
    matched_quantity = 0.0
    lots = lots_by_key.get(key, [])
    while remaining > 0 and lots:
        lot = lots[0]
        closed = min(remaining, lot["quantity"])
        premium += closed * lot["premiumPerContract"]
        if lot.get("openedAt"):
            weighted_open_time += closed * lot["openedAt"]
            matched_quantity += closed
        lot["quantity"] -= closed
        remaining -= closed
        if lot["quantity"] <= 1e-9:
            lots.pop(0)
    return premium, (weighted_open_time / matched_quantity if matched_quantity else None), matched_quantity


def flex_event_sort_key(row: Any, end_of_day: bool = False) -> datetime:
    raw = attr(row, "dateTime", "tradeDate", "date", "reportDate", default="")
    parsed_day = parse_day(raw)
    if not parsed_day:
        return datetime.max
    hour = "235959" if end_of_day else "000000"
    text = str(raw)
    if ";" in text:
        hour = text.split(";", 1)[1][:6].ljust(6, "0")
    return datetime.strptime(f"{parsed_day.replace('-', '')}{hour}", "%Y%m%d%H%M%S")


def analyze_flex_option_activity(report: Any, base_currency: str) -> dict[str, Any]:
    events: list[tuple[datetime, str, Any]] = []
    for trade in first_topic(report, "Trade", "Trades", "TradeConfirm", "Trade Confirms"):
        if flex_asset_category(attr(trade, "assetCategory", "assetClass", default="")) == "Options":
            events.append((flex_event_sort_key(trade), "trade", trade))
    for row in first_topic(report, "OptionEAE", "Option Exercises, Assignments and Expirations"):
        if flex_asset_category(attr(row, "assetCategory", "assetClass", default="")) == "Options":
            events.append((flex_event_sort_key(row, end_of_day=True), "option_eae", row))
    events.sort(key=lambda event: event[0])

    lots_by_key: dict[tuple[str, str, str, str], list[dict[str, float]]] = {}
    open_premium_by_key: dict[tuple[str, str, str, str], float] = {}
    assignment_events: list[dict[str, Any]] = []
    closed_put_contracts = 0.0
    assigned_put_contracts = 0.0
    expired_put_contracts = 0.0
    winning_put_contracts = 0.0
    realized_short_put_income = 0.0
    closed_call_contracts = 0.0
    assigned_call_contracts = 0.0
    winning_call_contracts = 0.0
    realized_short_call_income = 0.0
    aroc_trades: list[dict[str, Any]] = []
    realized_events: list[dict[str, Any]] = []

    for event_time, event_type, row in events:
        key = flex_option_key(row)
        if not key:
            continue
        _, _, _, option_type = key
        quantity = abs(safe_float(attr(row, "quantity", "qty", default=0)))
        if not quantity:
            continue
        currency = str(attr(row, "currency", default=base_currency))
        rate = safe_float(attr(row, "fxRateToBase", default=0)) or 1
        if currency == base_currency:
            rate = 1

        if event_type == "trade":
            signed_quantity = safe_float(attr(row, "quantity", "qty", default=0))
            buy_sell = str(attr(row, "buySell", "side", default="")).upper()
            notes = str(attr(row, "notes", "code", "tradeCode", default="")).upper()
            transaction_type = str(attr(row, "transactionType", default="")).upper()
            proceeds = safe_float(attr(row, "proceeds", default=0)) * rate
            commission = safe_float(attr(row, "ibCommission", "commission", default=0)) * rate

            if signed_quantity < 0 and buy_sell in {"SELL", "SLD"}:
                lots_by_key.setdefault(key, []).append(
                    {
                        "quantity": quantity,
                        "premiumPerContract": (proceeds + commission) / quantity,
                        "openedAt": event_time.timestamp() if event_time.year < 9999 else 0,
                    }
                )
            elif signed_quantity > 0 and buy_sell in {"BUY", "BOT"} and "BOOKTRADE" not in transaction_type and "A" not in notes and "EP" not in notes:
                premium, opened_at, matched_quantity = close_option_lots(lots_by_key, key, quantity)
                reported_realized = safe_float(
                    attr(row, "realizedPL", "realizedPnl", "fifoPnlRealized", default=0)
                ) * rate
                if matched_quantity:
                    close_ratio = matched_quantity / quantity
                    net_income = premium + ((proceeds + commission) * close_ratio)
                    counted_quantity = matched_quantity
                else:
                    net_income = reported_realized
                    counted_quantity = quantity if reported_realized else 0
                if counted_quantity:
                    symbol, _, _, _, _ = flex_option_symbol(row)
                    realized_events.append(
                        {
                            "date": parse_day(attr(row, "dateTime", "tradeDate", "reportDate", "date", default="")) or "",
                            "symbol": symbol,
                            "amount": net_income,
                        }
                    )
                if option_type == "P" and counted_quantity:
                    closed_put_contracts += counted_quantity
                    if net_income >= 0:
                        winning_put_contracts += counted_quantity
                    realized_short_put_income += net_income
                    _, base_symbol, _, strike_price, expiry = flex_option_symbol(row)
                    multiplier = safe_float(attr(row, "multiplier", default=100), 100) or 100
                    capital = (strike_price or safe_float(attr(row, "strike", default=0))) * counted_quantity * multiplier * rate
                    if net_income > 0 and capital > 0 and opened_at and event_time.year < 9999:
                        days_open = max(1, round((event_time.timestamp() - opened_at) / 86400))
                        aroc_trades.append({"symbol": f"{base_symbol} {expiry} {strike_price:g} P" if strike_price else base_symbol, "premiumCollected": net_income, "capitalAtRisk": capital, "daysOpen": days_open, "aroc": (net_income / capital) * (365 / days_open)})
                elif option_type == "C" and counted_quantity:
                    closed_call_contracts += counted_quantity
                    if net_income >= 0:
                        winning_call_contracts += counted_quantity
                    realized_short_call_income += net_income
            continue

        transaction_type = str(attr(row, "transactionType", default="")).lower()
        if transaction_type not in {"assignment", "expiration"}:
            continue

        premium, opened_at, matched_quantity = close_option_lots(lots_by_key, key, quantity)
        if transaction_type == "expiration" and matched_quantity:
            symbol, _, _, _, _ = flex_option_symbol(row)
            realized_events.append(
                {
                    "date": parse_day(attr(row, "date", "reportDate", default="")) or "",
                    "symbol": symbol,
                    "amount": premium,
                }
            )
        if option_type == "P":
            closed_put_contracts += quantity
            if transaction_type == "assignment":
                assigned_put_contracts += quantity
                _, base_symbol, _, strike_price, expiry = flex_option_symbol(row)
                multiplier = safe_float(attr(row, "multiplier", default=100), 100) or 100
                assignment_events.append(
                    {
                        "symbol": base_symbol,
                        "currency": currency,
                        "date": parse_day(attr(row, "date", "reportDate", default="")) or "",
                        "quantity": quantity,
                        "strike": strike_price or safe_float(attr(row, "strike", default=0)),
                        "expiry": expiry,
                        "multiplier": multiplier,
                        "premium": premium,
                        "rate": rate,
                    }
                )
            else:
                expired_put_contracts += quantity
                winning_put_contracts += quantity
                _, base_symbol, _, strike_price, expiry = flex_option_symbol(row)
                multiplier = safe_float(attr(row, "multiplier", default=100), 100) or 100
                capital = (strike_price or safe_float(attr(row, "strike", default=0))) * quantity * multiplier * rate
                if premium > 0 and capital > 0 and opened_at and event_time.year < 9999:
                    days_open = max(1, round((event_time.timestamp() - opened_at) / 86400))
                    aroc_trades.append({"symbol": f"{base_symbol} {expiry} {strike_price:g} P" if strike_price else base_symbol, "premiumCollected": premium, "capitalAtRisk": capital, "daysOpen": days_open, "aroc": (premium / capital) * (365 / days_open)})
            realized_short_put_income += premium
        elif option_type == "C" and matched_quantity:
            closed_call_contracts += matched_quantity
            if transaction_type == "assignment":
                assigned_call_contracts += matched_quantity
            else:
                winning_call_contracts += matched_quantity
            realized_short_call_income += premium

    for key, lots in lots_by_key.items():
        premium = sum(lot["quantity"] * lot["premiumPerContract"] for lot in lots)
        if premium:
            open_premium_by_key[key] = premium

    return {
        "openPremiumByKey": open_premium_by_key,
        "assignmentEvents": assignment_events,
        "closedPutContracts": closed_put_contracts,
        "assignedPutContracts": assigned_put_contracts,
        "expiredPutContracts": expired_put_contracts,
        "winningPutContracts": winning_put_contracts,
        "realizedShortPutIncome": realized_short_put_income,
        "closedCallContracts": closed_call_contracts,
        "assignedCallContracts": assigned_call_contracts,
        "winningCallContracts": winning_call_contracts,
        "realizedShortCallIncome": realized_short_call_income,
        "arocTrades": aroc_trades,
        "realizedEvents": realized_events,
    }


def apply_flex_open_positions(data: dict[str, Any], report: Any, option_activity: dict[str, Any] | None = None) -> None:
    rows = first_topic(report, "OpenPosition", "Open Positions")
    if not rows:
        return

    option_activity = option_activity or {}
    open_premium_by_key = option_activity.get("openPremiumByKey", {})
    positions: list[dict[str, Any]] = []
    for row in rows:
        discriminator = str(attr(row, "dataDiscriminator", "levelOfDetail", default="")).lower()
        if discriminator and discriminator not in {"summary", "position"}:
            continue

        category = flex_asset_category(attr(row, "assetCategory", "assetClass", default=""))
        raw_symbol = str(attr(row, "symbol", "ibSymbol", "description", default="")).strip()
        if not raw_symbol:
            continue

        symbol, base_symbol, option_type, strike_price, expiry = flex_option_symbol(row)
        is_option = category == "Options" or option_type in {"P", "C"}
        currency = str(attr(row, "currency", default=data["accountInfo"]["baseCurrency"]))
        exchange_rate = data["exchangeRates"].get(currency, 1)
        quantity = safe_float(attr(row, "quantity", "position", default=0))
        value = safe_float(attr(row, "value", "marketValue", "positionValue", default=0)) * exchange_rate
        option_key = flex_option_key(row) if is_option else None
        collected_premium = open_premium_by_key.get(option_key, 0) if option_key else 0
        unrealized_pl = safe_float(attr(row, "unrealizedPL", "unrealizedPnl", "fifoPnlUnrealized", "unrealized", default=0)) * exchange_rate
        if is_option and quantity < 0 and collected_premium:
            unrealized_pl = collected_premium + value

        positions.append(
            {
                "assetCategory": "Options" if is_option else category,
                "symbol": symbol,
                "baseSymbol": base_symbol,
                "quantity": quantity,
                "multiplier": safe_float(attr(row, "multiplier", "mult", default=100 if is_option else 1)) or (100 if is_option else 1),
                "costBasis": safe_float(attr(row, "costBasis", "costBasisMoney", "cost", default=0)) * exchange_rate,
                "closePrice": safe_float(attr(row, "closePrice", "markPrice", "price", default=0)),
                "underlyingPrice": None,
                "delta": None,
                "value": value,
                "unrealizedPL": unrealized_pl,
                "currency": currency,
                "isOption": is_option,
                "optionType": option_type,
                "strikePrice": strike_price,
                "expiry": expiry,
                "collectedPremium": collected_premium,
            }
        )

    if positions:
        stock_prices = {
            position["symbol"]: position["closePrice"]
            for position in positions
            if not position["isOption"] and position["closePrice"] > 0
        }
        for position in positions:
            if position["isOption"] and position["baseSymbol"] in stock_prices:
                position["underlyingPrice"] = stock_prices[position["baseSymbol"]]
        data["positions"] = positions


def apply_flex_mtm_summary(data: dict[str, Any], report: Any, ticker_pl: dict[str, float]) -> None:
    rows = first_topic(
        report,
        "MTMPerformanceSummaryUnderlying",
        "Mark-to-Market Performance Summary in Base",
        "Mark to Market Performance Summary in Base",
    )
    if not rows:
        return

    mtm_by_bucket = {"stocks": 0.0, "options": 0.0, "forex": 0.0}
    bucket_by_category = {"Stocks": "stocks", "Options": "options", "Forex": "forex"}

    for row in rows:
        category = flex_asset_category(attr(row, "assetCategory", "assetClass", default=""))
        bucket_key = bucket_by_category.get(category)
        if not bucket_key:
            continue

        amount = safe_float(attr(row, "totalWithAccruals", "total", "mtmPnl", "transactionMtm", default=0))
        if not amount:
            continue

        mtm_by_bucket[bucket_key] += amount

        ticker = str(attr(row, "underlyingSymbol", "symbol", default="")).strip()
        if ticker:
            ticker_pl[ticker] = ticker_pl.get(ticker, 0) + amount

    for bucket_key, mtm_total in mtm_by_bucket.items():
        if not mtm_total:
            continue
        realized = data["plSummary"][bucket_key]["realized"]
        data["plSummary"][bucket_key]["unrealized"] = mtm_total - realized
        data["plSummary"][bucket_key]["total"] = mtm_total

    total_realized = sum(data["plSummary"][key]["realized"] for key in ("stocks", "options", "forex"))
    total_mtm = sum(mtm_by_bucket.values())
    if total_mtm:
        data["plSummary"]["total"]["realized"] = total_realized
        data["plSummary"]["total"]["unrealized"] = total_mtm - total_realized
        data["plSummary"]["total"]["total"] = total_mtm


def apply_flex_mtdytd_summary(data: dict[str, Any], report: Any, ticker_pl: dict[str, float]) -> None:
    rows = first_topic(
        report,
        "MTDYTDPerformanceSummaryUnderlying",
        "Month & Year to Date Performance Summary in Base",
        "Month and Year to Date Performance Summary in Base",
    )
    if not rows:
        return

    bucket_by_category = {"Stocks": "stocks", "Options": "options", "Forex": "forex"}
    totals = {
        "stocks": {"realized": 0.0, "total": 0.0},
        "options": {"realized": 0.0, "total": 0.0},
        "forex": {"realized": 0.0, "total": 0.0},
    }
    saw_detail = False

    for row in rows:
        category = flex_asset_category(attr(row, "assetCategory", "assetClass", default=""))
        bucket_key = bucket_by_category.get(category)
        if not bucket_key:
            continue

        realized = safe_float(attr(row, "realizedPnlYTD", "realizedPnlMTD", "realizedTotal", default=0))
        total = safe_float(attr(row, "mtmYTD", "mtmMTD", "total", default=0))
        if not realized and not total:
            continue

        saw_detail = True
        totals[bucket_key]["realized"] += realized
        totals[bucket_key]["total"] += total

        ticker = str(attr(row, "underlyingSymbol", "symbol", default="")).strip()
        if ticker and total:
            ticker_pl[ticker] = total

    if not saw_detail:
        return

    for bucket_key, values in totals.items():
        realized = values["realized"]
        total = values["total"]
        data["plSummary"][bucket_key]["realized"] = realized
        data["plSummary"][bucket_key]["unrealized"] = total - realized
        data["plSummary"][bucket_key]["total"] = total

    total_realized = sum(values["realized"] for values in totals.values())
    total_pl = sum(values["total"] for values in totals.values())
    data["plSummary"]["total"]["realized"] = total_realized
    data["plSummary"]["total"]["unrealized"] = total_pl - total_realized
    data["plSummary"]["total"]["total"] = total_pl


def apply_flex_fifo_performance_summary(data: dict[str, Any], report: Any, ticker_pl: dict[str, float]) -> None:
    rows = first_topic(
        report,
        "FIFOPerformanceSummaryUnderlying",
        "FIFOPerformanceSummaryInBase",
        "Realized & Unrealized Performance Summary",
        "Realized and Unrealized Performance Summary in Base",
    )
    detail_rows = [
        row for row in rows
        if attr(row, "assetCategory", "assetClass", default="")
        and str(attr(row, "assetCategory", "assetClass", default="")).lower() not in {"total", "total (all assets)"}
    ]
    if not detail_rows:
        return

    bucket_by_category = {"Stocks": "stocks", "Options": "options", "Forex": "forex"}
    totals = {
        "stocks": {"realized": 0.0, "unrealized": 0.0, "total": 0.0},
        "options": {"realized": 0.0, "unrealized": 0.0, "total": 0.0},
        "forex": {"realized": 0.0, "unrealized": 0.0, "total": 0.0},
    }

    for row in detail_rows:
        category = flex_asset_category(attr(row, "assetCategory", "assetClass", default=""))
        bucket_key = bucket_by_category.get(category)
        if not bucket_key:
            continue

        realized = safe_float(
            attr(
                row,
                "realizedTotal",
                "realizedPnl",
                "realizedPnL",
                "fifoPnlRealized",
                default=0,
            )
        )
        unrealized = safe_float(
            attr(
                row,
                "unrealizedTotal",
                "unrealizedPnl",
                "unrealizedPnL",
                "fifoPnlUnrealized",
                default=0,
            )
        )
        total = safe_float(attr(row, "total", "totalPnl", "totalPnL", default=realized + unrealized))

        totals[bucket_key]["realized"] += realized
        totals[bucket_key]["unrealized"] += unrealized
        totals[bucket_key]["total"] += total

        ticker = str(attr(row, "underlyingSymbol", "symbol", default="")).strip()
        if ticker and total:
            ticker_pl[ticker] = total

    if not any(values["total"] or values["realized"] or values["unrealized"] for values in totals.values()):
        return

    for bucket_key, values in totals.items():
        data["plSummary"][bucket_key] = values

    data["plSummary"]["total"] = {
        "realized": sum(values["realized"] for values in totals.values()),
        "unrealized": sum(values["unrealized"] for values in totals.values()),
        "total": sum(values["total"] for values in totals.values()),
    }


def apply_flex_option_metrics(data: dict[str, Any], option_activity: dict[str, Any]) -> None:
    total_closed = option_activity.get("closedPutContracts", 0) or 0
    assigned = option_activity.get("assignedPutContracts", 0) or 0
    wins = option_activity.get("winningPutContracts", 0) or 0
    realized_income = option_activity.get("realizedShortPutIncome", 0) or 0

    if total_closed:
        data["optionsStrategyMetrics"]["totalClosed"] = total_closed
        data["optionsStrategyMetrics"]["assignmentRate"] = assigned / total_closed
        data["optionsStrategyMetrics"]["winRate"] = wins / total_closed
        data["optionsStrategyMetrics"]["wins"] = wins

    if total_closed or realized_income:
        summary = data["shortPutIncomeSummary"]
        summary["totalRealizedPL"] = realized_income
        summary["numberOfContracts"] = total_closed
        summary["averagePLPerContract"] = realized_income / total_closed if total_closed else 0
        summary["hasData"] = True

    call_closed = option_activity.get("closedCallContracts", 0) or 0
    call_assigned = option_activity.get("assignedCallContracts", 0) or 0
    call_wins = option_activity.get("winningCallContracts", 0) or 0
    call_income = option_activity.get("realizedShortCallIncome", 0) or 0
    if call_closed or call_income:
        summary = data["shortCallIncomeSummary"]
        summary["totalRealizedPL"] = call_income
        summary["numberOfContracts"] = call_closed
        summary["averagePLPerContract"] = call_income / call_closed if call_closed else 0
        summary["assignmentRate"] = call_assigned / call_closed if call_closed else 0
        summary["winRate"] = call_wins / call_closed if call_closed else 0
        summary["hasData"] = True

    aroc_trades = option_activity.get("arocTrades", [])
    if aroc_trades:
        data["arocAnalysis"] = {
            "averageAroc": sum(trade["aroc"] for trade in aroc_trades) / len(aroc_trades),
            "trades": aroc_trades,
        }


def apply_flex_wheel_cycles(data: dict[str, Any], report: Any, option_activity: dict[str, Any]) -> None:
    assignment_events = option_activity.get("assignmentEvents", [])
    if not assignment_events:
        return

    stock_positions = {
        position["symbol"]: position
        for position in data["positions"]
        if not position["isOption"] and position["quantity"] > 0
    }
    call_premiums: dict[str, list[dict[str, Any]]] = {}
    stock_sales: dict[str, list[dict[str, Any]]] = {}
    for trade in first_topic(report, "Trade", "Trades", "TradeConfirm", "Trade Confirms"):
        category = flex_asset_category(attr(trade, "assetCategory", "assetClass", default=""))
        if category == "Stocks":
            quantity = safe_float(attr(trade, "quantity", "qty", default=0))
            buy_sell = str(attr(trade, "buySell", "side", default="")).upper()
            if quantity < 0 and buy_sell in {"SELL", "SLD"}:
                symbol = str(attr(trade, "symbol", "underlyingSymbol", default="")).strip()
                currency = str(attr(trade, "currency", default=data["accountInfo"]["baseCurrency"]))
                rate = safe_float(attr(trade, "fxRateToBase", default=0)) or data["exchangeRates"].get(currency, 1) or 1
                stock_sales.setdefault(symbol, []).append(
                    {
                        "date": parse_day(attr(trade, "dateTime", "tradeDate", "reportDate", "date", default="")) or "",
                        "shares": abs(quantity),
                        "remainingShares": abs(quantity),
                        "proceeds": (safe_float(attr(trade, "proceeds", default=0)) + safe_float(attr(trade, "ibCommission", "commission", default=0))) * rate,
                    }
                )
            continue
        if category != "Options":
            continue
        _, base_symbol, option_type, _, _ = flex_option_symbol(trade)
        quantity = safe_float(attr(trade, "quantity", "qty", default=0))
        buy_sell = str(attr(trade, "buySell", "side", default="")).upper()
        transaction_type = str(attr(trade, "transactionType", default="")).upper()
        if option_type != "C" or quantity >= 0 or buy_sell not in {"SELL", "SLD"}:
            continue
        currency = str(attr(trade, "currency", default=data["accountInfo"]["baseCurrency"]))
        rate = safe_float(attr(trade, "fxRateToBase", default=0)) or data["exchangeRates"].get(currency, 1) or 1
        proceeds = safe_float(attr(trade, "proceeds", default=0)) * rate
        commission = safe_float(attr(trade, "ibCommission", "commission", default=0)) * rate
        call_premiums.setdefault(base_symbol, []).append(
            {
                "date": parse_day(attr(trade, "dateTime", "tradeDate", "reportDate", "date", default="")) or "",
                "symbol": str(attr(trade, "symbol", "description", default="")),
                "amount": proceeds + commission,
            }
        )

    pending_cycles = []
    completed_cycles = []
    for event in assignment_events:
        symbol = event["symbol"]
        assignment_shares = event["quantity"] * event["multiplier"]
        assignment_cost = event["strike"] * assignment_shares * event["rate"]
        initial_put_premium = event["premium"]
        net_assignment_cost = assignment_cost - initial_put_premium
        assignment_date = event["date"]
        total_call_premium = 0.0
        trade_log = [
            {
                "date": assignment_date,
                "description": f"Assigned {assignment_shares:g} shares @ {event['strike']:g}",
                "amount": -assignment_cost,
            },
            {
                "date": assignment_date,
                "description": "Put premium applied",
                "amount": initial_put_premium,
            },
        ]

        for call in call_premiums.get(symbol, []):
            if call["date"] and assignment_date and call["date"] < assignment_date:
                continue
            total_call_premium += call["amount"]
            trade_log.append(
                {
                    "date": call["date"],
                    "description": f"Call premium ({call['symbol']})",
                    "amount": call["amount"],
                }
            )

        relevant_sales = [sale for sale in stock_sales.get(symbol, []) if sale["remainingShares"] > 0 and (not assignment_date or sale["date"] >= assignment_date)]
        sold_shares = sum(sale["remainingShares"] for sale in relevant_sales)
        if sold_shares >= assignment_shares and relevant_sales:
            remaining = assignment_shares
            sale_proceeds = 0.0
            end_date = assignment_date
            for sale in relevant_sales:
                used = min(remaining, sale["remainingShares"])
                sale_proceeds += sale["proceeds"] * (used / sale["shares"])
                sale["remainingShares"] -= used
                remaining -= used
                end_date = max(end_date, sale["date"])
                trade_log.append({"date": sale["date"], "description": f"Sold {used:g} shares", "amount": sale["proceeds"] * (used / sale["shares"])})
                if remaining <= 1e-9:
                    break
            completed_calls = [call for call in call_premiums.get(symbol, []) if (not assignment_date or call["date"] >= assignment_date) and (not end_date or call["date"] <= end_date)]
            total_call_premium = sum(call["amount"] for call in completed_calls)
            trade_log = trade_log[:2] + [
                {"date": call["date"], "description": f"Call premium ({call['symbol']})", "amount": call["amount"]}
                for call in completed_calls
            ] + [entry for entry in trade_log if entry["description"].startswith("Sold ")]
            start_dt = datetime.strptime(assignment_date, "%Y-%m-%d").date() if assignment_date else date.today()
            end_dt = datetime.strptime(end_date, "%Y-%m-%d").date() if end_date else start_dt
            stock_pl = sale_proceeds - net_assignment_cost
            total_pl = stock_pl + total_call_premium
            completed_cycles.append(
                {
                    "symbol": symbol,
                    "currency": event["currency"],
                    "initialPutPremium": initial_put_premium,
                    "totalCallPremium": total_call_premium,
                    "stockPL": stock_pl,
                    "totalPL": total_pl,
                    "durationDays": max(1, (end_dt - start_dt).days),
                    "returnOnCost": total_pl / net_assignment_cost if net_assignment_cost else 0,
                    "startDate": assignment_date,
                    "endDate": end_date,
                    "assignmentPrice": event["strike"],
                    "assignmentShares": assignment_shares,
                    "assignmentCost": assignment_cost,
                    "netAssignmentCost": net_assignment_cost,
                    "salePrice": sale_proceeds / assignment_shares / event["rate"] if assignment_shares and event["rate"] else 0,
                    "saleProceeds": sale_proceeds,
                    "tradeLog": trade_log,
                }
            )
            continue

        stock_position = stock_positions.get(symbol)
        if not stock_position:
            continue

        current_price = stock_position["closePrice"] or (
            stock_position["value"] / stock_position["quantity"] if stock_position["quantity"] else 0
        )
        current_stock_value = current_price * assignment_shares * data["exchangeRates"].get(stock_position["currency"], 1)
        unrealized_stock_pl = current_stock_value - net_assignment_cost
        current_total_pl = unrealized_stock_pl + total_call_premium
        start_dt = datetime.strptime(assignment_date, "%Y-%m-%d").date() if assignment_date else date.today()
        duration_days = max(1, (date.today() - start_dt).days)

        pending_cycles.append(
            {
                "symbol": symbol,
                "currency": event["currency"],
                "initialPutPremium": initial_put_premium,
                "startDate": assignment_date,
                "assignmentShares": assignment_shares,
                "assignmentPrice": event["strike"],
                "assignmentCost": assignment_cost,
                "netAssignmentCost": net_assignment_cost,
                "totalCallPremium": total_call_premium,
                "currentStockValue": current_stock_value,
                "unrealizedStockPL": unrealized_stock_pl,
                "currentTotalPL": current_total_pl,
                "annualizedReturn": (current_total_pl / assignment_cost) * (365 / duration_days) if assignment_cost else 0,
                "tradeLog": trade_log,
            }
        )

    if pending_cycles:
        data["wheelCycleAnalysis"]["pendingCycles"] = pending_cycles
    if completed_cycles:
        data["wheelCycleAnalysis"]["completedCycles"] = completed_cycles


def build_flex_dashboard(token: str, query_id: str) -> dict[str, Any]:
    report = load_flex_report(token, query_id)
    return build_flex_dashboard_from_report(report)


def build_flex_dashboard_from_xml(path: str) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as file:
        report = SimpleFlexReport(file.read())
    return build_flex_dashboard_from_report(report)


def build_flex_dashboard_from_report(report: Any) -> dict[str, Any]:
    data = empty_dashboard()
    monthly: dict[str, dict[str, Any]] = {}
    ticker_pl: dict[str, float] = {}
    available_topics = {normalize_topic(topic) for topic in report.topics()}
    history_warnings: list[str] = []
    has_trades = any(topic in available_topics for topic in ("trade", "trades", "tradeconfirm", "tradeconfirms"))
    has_option_events = any(topic in available_topics for topic in ("optioneae", "optionexercisesassignmentsandexpirations"))
    if not has_trades:
        history_warnings.append(
            "The Flex Query does not include Trades. Monthly P/L, daily option activity, closed positions, and wheel analysis require the Trades section."
        )
    if not has_option_events:
        history_warnings.append(
            "No Option Exercises, Assignments and Expirations records were returned. If assignments are expected, include that section in the Flex Query."
        )
    flex_trades = first_topic(report, "Trade", "Trades", "TradeConfirm", "Trade Confirms")
    trade_fields = {
        normalize_topic(field)
        for trade in flex_trades
        for field in (vars(trade).keys() if hasattr(trade, "__dict__") else trade.keys() if isinstance(trade, dict) else [])
    }
    required_trade_fields = {
        "date/time": {"datetime", "tradedate", "reportdate", "date"},
        "asset category": {"assetcategory", "assetclass", "type"},
        "symbol": {"symbol", "ibsymbol", "description"},
        "quantity": {"quantity", "qty"},
        "buy/sell": {"buysell", "side"},
        "proceeds": {"proceeds"},
    }
    missing_trade_fields = [
        label for label, aliases in required_trade_fields.items()
        if flex_trades and not aliases.intersection(trade_fields)
    ]
    if missing_trade_fields:
        history_warnings.append(
            "The Flex Trades section is missing required fields: " + ", ".join(missing_trade_fields) + ". Edit the Flex Query and select these fields."
        )
    data["historyStatus"] = {
        "source": "flex",
        "complete": has_trades and not missing_trade_fields,
        "warnings": history_warnings,
    }

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

    apply_flex_account_info(data, report)
    apply_flex_exchange_rates(data, report)
    option_activity = analyze_flex_option_activity(report, data["accountInfo"]["baseCurrency"])
    apply_flex_nav(data, report)
    apply_flex_nav_change(data, report)
    data["marginLiquidity"]["netLiquidation"] = data["totalNAV"]
    data["marginLiquidity"]["totalCash"] = data["nav"]["cash"]
    apply_flex_equity_history(data, report)
    apply_flex_open_positions(data, report, option_activity)
    apply_flex_option_metrics(data, option_activity)
    apply_flex_wheel_cycles(data, report, option_activity)
    apply_flex_premium_efficiency(data, report, option_activity)
    apply_flex_weekly_summary(data, report)
    apply_flex_closed_trade_metrics(data, report)

    order_rows = first_topic(report, "Order", "Orders")
    trades = order_rows or first_topic(report, "Trade", "Trades", "TradeConfirm", "Trade Confirms")
    use_reported_option_realized = bool(order_rows) and any(
        safe_float(attr(row, "fifoPnlRealized", "realizedPnl", "realizedPL", default=0))
        for row in order_rows
    )
    trade_days = [
        parse_day(attr(trade, "dateTime", "tradeDate", "reportDate", "date", default=""))
        for trade in trades
    ]
    parsed_trade_days = [
        datetime.strptime(day, "%Y-%m-%d").date()
        for day in trade_days
        if day
    ]
    daily = empty_daily_options_summary(max(parsed_trade_days) if parsed_trade_days else date.today())

    reported_closed_options: dict[str, dict[str, Any]] = {}
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
        day = parse_day(attr(trade, "dateTime", "tradeDate", "reportDate", "date", default=""))
        quantity = safe_float(attr(trade, "quantity", "qty", default=0))
        currency = str(attr(trade, "currency", default=data["accountInfo"]["baseCurrency"]))
        rate = safe_float(attr(trade, "fxRateToBase", default=0)) or data["exchangeRates"].get(currency, 1) or 1
        proceeds = safe_float(attr(trade, "proceeds", default=0)) * rate
        commission = safe_float(attr(trade, "ibCommission", "commission", default=0)) * rate
        realized_pl = safe_float(attr(trade, "realizedPL", "realizedPnl", "fifoPnlRealized", default=0)) * rate
        buy_sell = str(attr(trade, "buySell", "side", default="")).upper()
        transaction_type = str(attr(trade, "transactionType", default="")).upper()
        code = str(attr(trade, "code", "tradeCode", "notesCodes", "openCloseIndicator", default="")).upper()
        is_assignment = "ASSIGN" in code or code == "A"

        if month:
            bucket = ensure_month(monthly, month)
            bucket["commissions"] += abs(commission)
            if is_option:
                if use_reported_option_realized:
                    bucket["optionsPL"] += realized_pl
                if transaction_type != "BOOKTRADE" and buy_sell in {"SELL", "SLD"} and proceeds > 0:
                    bucket["optionsPremium"] += proceeds + commission
            elif category == "Stocks":
                bucket["stocksPL"] += realized_pl
            elif category == "Forex":
                bucket["forexPL"] += realized_pl

        if is_option and day in daily:
            if transaction_type != "BOOKTRADE" and buy_sell in {"SELL", "SLD"} and proceeds > 0:
                daily[day]["premiumCollected"] = safe_float(daily[day]["premiumCollected"]) + proceeds + commission
            if use_reported_option_realized and realized_pl:
                daily[day]["closedPL"] = safe_float(daily[day]["closedPL"]) + realized_pl

        if use_reported_option_realized and is_option and realized_pl and symbol:
            summary = reported_closed_options.setdefault(symbol, {"realizedPL": 0.0, "closeDate": day or ""})
            summary["realizedPL"] += realized_pl
            if day and day > summary["closeDate"]:
                summary["closeDate"] = day

        if realized_pl and symbol and not is_option:
            data["closedPositions"].append(
                {
                    "assetCategory": category,
                    "symbol": symbol,
                    "realizedPL": realized_pl,
                    "closeDate": str(attr(trade, "dateTime", "tradeDate", "reportDate", "date", default="")),
                }
            )
            ticker_pl[base_symbol or symbol] = ticker_pl.get(base_symbol or symbol, 0) + realized_pl

    closed_options: dict[str, dict[str, Any]] = reported_closed_options
    for event in ([] if use_reported_option_realized else option_activity.get("realizedEvents", [])):
        event_day = event.get("date", "")
        event_month = event_day[:7] if event_day else ""
        amount = safe_float(event.get("amount", 0))
        symbol = str(event.get("symbol", ""))
        if event_month:
            ensure_month(monthly, event_month)["optionsPL"] += amount
        if event_day in daily:
            daily[event_day]["closedPL"] = safe_float(daily[event_day]["closedPL"]) + amount
        if symbol:
            summary = closed_options.setdefault(symbol, {"realizedPL": 0.0, "closeDate": event_day})
            summary["realizedPL"] += amount
            if event_day > summary["closeDate"]:
                summary["closeDate"] = event_day

    for symbol, summary in closed_options.items():
        data["closedPositions"].append(
            {
                "assetCategory": "Options",
                "symbol": symbol,
                "realizedPL": summary["realizedPL"],
                "closeDate": summary["closeDate"],
            }
        )
        _, base_symbol, _, _, _ = flex_option_symbol({"symbol": symbol})
        ticker = base_symbol or symbol.split()[0]
        ticker_pl[ticker] = ticker_pl.get(ticker, 0) + summary["realizedPL"]

    cash_like_sections = (
        ("CashTransaction", "Cash Transactions", "cash transaction"),
        ("CashReport", "Cash Report", "cash report"),
        ("InterestAccrual", "Interest Accruals", "interest"),
        ("InterestDetail", "Interest Details (Tiers)", "interest"),
        ("TransactionFee", "Transaction Fees", "fee"),
        ("SalesTaxDetail", "Sales Tax Details", "tax"),
        ("SecuritiesBorrowedLentFeeDetail", "Securities Borrowed/Lent Fee Details", "securities lent"),
    )
    for topic, display_topic, category_hint in cash_like_sections:
        for row in first_topic(report, topic, display_topic):
            if topic == "CashTransaction" and str(attr(row, "levelOfDetail", default="")).upper() == "SUMMARY":
                continue
            apply_monthly_cash_row(row, monthly, category_hint)

    if data["shortPutIncomeSummary"]["numberOfContracts"]:
        summary = data["shortPutIncomeSummary"]
        summary["averagePLPerContract"] = summary["totalRealizedPL"] / summary["numberOfContracts"]

    data["monthlySummary"] = [monthly[key] for key in sorted(monthly)]
    data["dailyOptionsSummary"] = [daily[key] for key in sorted(daily)]

    option_realized = sum(row["optionsPL"] for row in data["monthlySummary"])
    stock_realized = sum(row["stocksPL"] for row in data["monthlySummary"])
    forex_realized = sum(row["forexPL"] for row in data["monthlySummary"])
    data["plSummary"]["options"]["realized"] = option_realized
    data["plSummary"]["stocks"]["realized"] = stock_realized
    data["plSummary"]["forex"]["realized"] = forex_realized
    data["plSummary"]["total"]["realized"] = option_realized + stock_realized + forex_realized
    for key in ("stocks", "options", "forex", "total"):
        data["plSummary"][key]["total"] = data["plSummary"][key]["realized"] + data["plSummary"][key]["unrealized"]

    apply_flex_mtm_summary(data, report, ticker_pl)
    apply_flex_mtdytd_summary(data, report, ticker_pl)
    apply_flex_fifo_performance_summary(data, report, ticker_pl)

    data["tickerPL"] = [
        {"ticker": ticker, "totalPL": total}
        for ticker, total in sorted(ticker_pl.items(), key=lambda item: abs(item[1]), reverse=True)
    ]

    return data


def merge_flex_history(live: dict[str, Any], flex: dict[str, Any]) -> dict[str, Any]:
    def merge_newer_rows(history: list[dict[str, Any]], current: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
        merged = {str(row.get(key, "")): row for row in history if row.get(key)}
        latest_history_key = max(merged, default="")
        for row in current:
            row_key = str(row.get(key, ""))
            if row_key and row_key > latest_history_key:
                merged[row_key] = row
        return [merged[row_key] for row_key in sorted(merged)]

    live["dailyOptionsSummary"] = merge_newer_rows(flex["dailyOptionsSummary"], live["dailyOptionsSummary"], "date")
    latest_flex_day = max(
        (row["date"] for row in flex["dailyOptionsSummary"] if row.get("premiumCollected") or row.get("closedPL")),
        default="",
    )
    latest_flex_day = max(
        latest_flex_day,
        max(
            (parse_day(row.get("closeDate")) or "" for row in flex.get("closedPositions", [])),
            default="",
        ),
    )
    new_realized_events = [
        event
        for event in live.get("sessionRealizedEvents", [])
        if str(event.get("date", "")) > latest_flex_day
    ]
    new_option_sales = [
        event
        for event in live.get("sessionOptionSales", [])
        if str(event.get("date", "")) > latest_flex_day
    ]
    monthly_by_key = {row["month"]: dict(row) for row in flex["monthlySummary"]}
    for row in live["dailyOptionsSummary"]:
        if row["date"] <= latest_flex_day:
            continue
        month = row["date"][:7]
        bucket = monthly_by_key.setdefault(month, ensure_month({}, month))
        bucket["optionsPremium"] += row.get("premiumCollected", 0)
        bucket["optionsPL"] += row.get("closedPL", 0)
    for event in new_realized_events:
        category = str(event.get("assetCategory", ""))
        if category == "Options":
            continue
        month = str(event.get("date", ""))[:7]
        if not month:
            continue
        bucket = monthly_by_key.setdefault(month, ensure_month({}, month))
        summary_key = "forexPL" if category == "Forex" else "stocksPL"
        bucket[summary_key] += safe_float(event.get("realizedPL"))
    live["monthlySummary"] = [monthly_by_key[key] for key in sorted(monthly_by_key)]
    live["closedPositions"] = list(flex["closedPositions"])
    live["closedPositions"].extend(
        {
            "assetCategory": event.get("assetCategory", "Other"),
            "symbol": event.get("symbol", ""),
            "realizedPL": safe_float(event.get("realizedPL")),
            "closeDate": event.get("date", ""),
        }
        for event in new_realized_events
    )
    ticker_pl = {row["ticker"]: safe_float(row["totalPL"]) for row in flex["tickerPL"]}
    for event in new_realized_events:
        ticker = str(event.get("baseSymbol") or event.get("symbol") or "")
        if ticker:
            ticker_pl[ticker] = ticker_pl.get(ticker, 0) + safe_float(event.get("realizedPL"))
    live["tickerPL"] = [
        {"ticker": ticker, "totalPL": total}
        for ticker, total in sorted(ticker_pl.items(), key=lambda item: abs(item[1]), reverse=True)
    ]
    live["shortPutIncomeSummary"] = dict(flex["shortPutIncomeSummary"])
    intraday_put_closes = [
        event
        for event in new_realized_events
        if event.get("assetCategory") == "Options" and str(event.get("optionType", "")).upper() == "P"
    ]
    if intraday_put_closes:
        put_summary = live["shortPutIncomeSummary"]
        put_summary["totalRealizedPL"] += sum(safe_float(event.get("realizedPL")) for event in intraday_put_closes)
        put_summary["numberOfContracts"] += sum(abs(safe_float(event.get("quantity"))) for event in intraday_put_closes)
        put_summary["averagePLPerContract"] = (
            put_summary["totalRealizedPL"] / put_summary["numberOfContracts"]
            if put_summary["numberOfContracts"] else 0
        )
        put_summary["hasData"] = True
    live["shortCallIncomeSummary"] = dict(flex.get("shortCallIncomeSummary", empty_dashboard()["shortCallIncomeSummary"]))
    intraday_call_closes = [
        event
        for event in new_realized_events
        if event.get("assetCategory") == "Options" and str(event.get("optionType", "")).upper() == "C"
    ]
    if intraday_call_closes:
        call_summary = live["shortCallIncomeSummary"]
        added_contracts = sum(abs(safe_float(event.get("quantity"))) for event in intraday_call_closes)
        added_wins = sum(
            abs(safe_float(event.get("quantity")))
            for event in intraday_call_closes
            if safe_float(event.get("realizedPL")) >= 0
        )
        prior_wins = call_summary["winRate"] * call_summary["numberOfContracts"]
        call_summary["totalRealizedPL"] += sum(safe_float(event.get("realizedPL")) for event in intraday_call_closes)
        call_summary["numberOfContracts"] += added_contracts
        call_summary["averagePLPerContract"] = call_summary["totalRealizedPL"] / call_summary["numberOfContracts"]
        call_summary["winRate"] = (prior_wins + added_wins) / call_summary["numberOfContracts"]
        call_summary["assignmentRate"] = (
            call_summary["assignmentRate"] * (call_summary["numberOfContracts"] - added_contracts) / call_summary["numberOfContracts"]
        )
        call_summary["hasData"] = True
    live["arocAnalysis"] = flex["arocAnalysis"]
    live["optionsStrategyMetrics"] = dict(flex["optionsStrategyMetrics"])
    if intraday_put_closes:
        strategy = live["optionsStrategyMetrics"]
        added_contracts = sum(abs(safe_float(event.get("quantity"))) for event in intraday_put_closes)
        added_wins = sum(
            abs(safe_float(event.get("quantity")))
            for event in intraday_put_closes
            if safe_float(event.get("realizedPL")) >= 0
        )
        prior_assignments = strategy.get("assignmentRate", 0) * strategy.get("totalClosed", 0)
        strategy["totalClosed"] += added_contracts
        strategy["wins"] += added_wins
        strategy["winRate"] = strategy["wins"] / strategy["totalClosed"] if strategy["totalClosed"] else 0
        strategy["assignmentRate"] = prior_assignments / strategy["totalClosed"] if strategy["totalClosed"] else 0
    live["wheelCycleAnalysis"] = flex["wheelCycleAnalysis"]
    live["equityHistory"] = flex.get("equityHistory", [])
    live["premiumEfficiency"] = flex.get("premiumEfficiency", [])
    weekly_by_key = {row["week"]: dict(row) for row in flex.get("weeklySummary", [])}
    for row in live["dailyOptionsSummary"]:
        if row["date"] <= latest_flex_day:
            continue
        week = week_key(row["date"])
        if week:
            bucket = weekly_by_key.setdefault(week, ensure_week({}, week))
            bucket["optionsPremium"] += row.get("premiumCollected", 0)
            bucket["optionsPL"] += row.get("closedPL", 0)
    for event in new_realized_events:
        category = str(event.get("assetCategory", ""))
        if category == "Options":
            continue
        week = week_key(event.get("date", ""))
        if week:
            bucket = weekly_by_key.setdefault(week, ensure_week({}, week))
            summary_key = "forexPL" if category == "Forex" else "stocksPL"
            bucket[summary_key] += safe_float(event.get("realizedPL"))
    live["weeklySummary"] = [weekly_by_key[key] for key in sorted(weekly_by_key)]
    live["closedTradeMetrics"] = flex.get("closedTradeMetrics", [])
    live["historyStatus"] = {
        "source": "gateway+flex",
        "complete": flex.get("historyStatus", {}).get("complete", False),
        "warnings": flex.get("historyStatus", {}).get("warnings", []),
    }

    live_stock_positions = {
        position["symbol"]: position
        for position in live["positions"]
        if not position["isOption"] and position["quantity"] > 0
    }
    for cycle in live["wheelCycleAnalysis"].get("pendingCycles", []):
        stock = live_stock_positions.get(cycle["symbol"])
        if not stock:
            continue
        exchange_rate = live["exchangeRates"].get(stock["currency"], 1)
        current_price = stock["closePrice"] or (stock["value"] / stock["quantity"] if stock["quantity"] else 0)
        cycle["currentStockValue"] = current_price * cycle["assignmentShares"] * exchange_rate
        cycle["unrealizedStockPL"] = cycle["currentStockValue"] - cycle["netAssignmentCost"]
        cycle["currentTotalPL"] = cycle["unrealizedStockPL"] + cycle["totalCallPremium"]
        start = parse_day(cycle.get("startDate"))
        duration_days = 1
        if start:
            duration_days = max(1, (date.today() - datetime.strptime(start, "%Y-%m-%d").date()).days)
        cycle["annualizedReturn"] = (cycle["currentTotalPL"] / cycle["assignmentCost"]) * (365 / duration_days) if cycle.get("assignmentCost") else 0

        open_call_symbols = {
            position["symbol"]
            for position in live["positions"]
            if position["isOption"]
            and position.get("optionType") == "C"
            and position["quantity"] < 0
            and position.get("baseSymbol") == cycle["symbol"]
        }
        new_call_premium = sum(
            safe_float(event.get("premium"))
            for event in new_option_sales
            if event.get("optionType") == "C"
            and event.get("baseSymbol") == cycle["symbol"]
            and event.get("symbol") in open_call_symbols
        )
        if new_call_premium:
            cycle["totalCallPremium"] += new_call_premium
            cycle["currentTotalPL"] += new_call_premium
            cycle["annualizedReturn"] = (cycle["currentTotalPL"] / cycle["assignmentCost"]) * (365 / duration_days) if cycle.get("assignmentCost") else 0

    if not live["positions"] and flex["positions"]:
        live["positions"] = flex["positions"]
    if not live["totalNAV"] and flex["totalNAV"]:
        live["totalNAV"] = flex["totalNAV"]
    if not live["nav"].get("cash") and flex["nav"].get("cash"):
        live["nav"]["cash"] = flex["nav"]["cash"]
    if not live["rateOfReturn"] and flex["rateOfReturn"]:
        live["rateOfReturn"] = flex["rateOfReturn"]
    for key, value in flex["navChange"].items():
        if value and not live["navChange"].get(key):
            live["navChange"][key] = value

    for key in ("stocks", "options", "forex", "total"):
        if key == "total":
            intraday_realized = sum(safe_float(event.get("realizedPL")) for event in new_realized_events)
        else:
            category = {"stocks": "Stocks", "options": "Options", "forex": "Forex"}[key]
            intraday_realized = sum(
                safe_float(event.get("realizedPL"))
                for event in new_realized_events
                if event.get("assetCategory") == category
            )
        live["plSummary"][key]["realized"] = flex["plSummary"][key]["realized"] + intraday_realized
        live["plSummary"][key]["total"] = live["plSummary"][key]["realized"] + live["plSummary"][key]["unrealized"]

    live.pop("sessionRealizedEvents", None)
    live.pop("sessionOptionSales", None)

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
    parser.add_argument("--flex-only", action="store_true")
    parser.add_argument("--flex-xml", default="")
    parser.add_argument("--prices-only", action="store_true")
    parser.add_argument("--symbols-json", default="[]")
    args = parser.parse_args()

    if args.flex_xml:
        try:
            print(json.dumps(build_flex_dashboard_from_xml(args.flex_xml)))
            return 0
        except Exception as exc:
            print(f"Failed to parse Flex XML: {exc}", file=sys.stderr)
            return 1

    if args.flex_only:
        if not args.flex_token or not args.flex_query_id:
            print("Flex-only loading requires both --flex-token and --flex-query-id.", file=sys.stderr)
            return 1
        try:
            print(json.dumps(build_flex_dashboard(args.flex_token, args.flex_query_id)))
            return 0
        except Exception as exc:
            print(f"Failed to load Flex history: {flex_error_message(exc)}", file=sys.stderr)
            return 1

    if IB is None:
        missing = getattr(IB_ASYNC_IMPORT_ERROR, "name", "ib_async")
        print(f"Missing Python dependency '{missing}'. Install dependencies with: pip install -r requirements.txt", file=sys.stderr)
        return 1

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
        if args.flex_token and args.flex_query_id and not args.prices_only:
            try:
                print(
                    f"IB Gateway unavailable at {args.host}:{args.port}; loading Flex history only: {exc}",
                    file=sys.stderr,
                )
                print(json.dumps(build_flex_dashboard(args.flex_token, args.flex_query_id)))
                return 0
            except Exception as flex_exc:
                print(f"Failed to load Flex history after IB Gateway error: {flex_error_message(flex_exc)}", file=sys.stderr)
        print(f"Failed to load IB Gateway data from {args.host}:{args.port}: {exc}", file=sys.stderr)
        return 1
    finally:
        if ib.isConnected():
            ib.disconnect()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
