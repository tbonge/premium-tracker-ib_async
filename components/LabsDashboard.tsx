import React, { useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ParsedData, Position } from '../types';

interface LabsDashboardProps {
  data: ParsedData;
  onReset: () => void;
  onRefreshData: () => void;
  isRefreshing: boolean;
  onSwitchToClassic: () => void;
}

const ACCENT = '#00c896';
const MUTED = '#8b949e';
const BORDER = '#202522';

const baseSymbol = (symbol: string) => symbol.trim().split(/\s+/)[0] || symbol;

const Panel: React.FC<React.PropsWithChildren<{ className?: string }>> = ({ className = '', children }) => (
  <section className={`rounded-lg border border-[#202522] bg-[#0b0e0c] ${className}`}>{children}</section>
);

const SectionTitle: React.FC<{ title: string; count?: number }> = ({ title, count }) => (
  <div className="flex items-center gap-2 px-4 pb-3 pt-4">
    <h2 className="text-sm font-semibold tracking-tight text-[#eef2ef]">{title}</h2>
    {count !== undefined && <span className="text-xs text-[#68706b]">({count})</span>}
  </div>
);

const EmptyRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="border-t border-[#1b201d] px-4 py-6 text-sm text-[#68706b]">{children}</div>
);

const LabsDashboard: React.FC<LabsDashboardProps> = ({
  data,
  onReset,
  onRefreshData,
  isRefreshing,
  onSwitchToClassic,
}) => {
  const currency = data.nav.baseCurrency || data.accountInfo.baseCurrency || 'USD';
  const money = useMemo(
    () => new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    [currency],
  );
  const compactMoney = useMemo(
    () => new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }),
    [currency],
  );
  const number = useMemo(() => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }), []);
  const formatMoney = (value: number) => money.format(Number.isFinite(value) ? value : 0);
  const formatPercent = (value: number) => `${(Number.isFinite(value) ? value : 0).toFixed(2)}%`;

  const analytics = useMemo(() => {
    const months = [...data.monthlySummary].sort((a, b) => a.month.localeCompare(b.month));
    let cumulativePL = 0;
    let cumulativeIncome = 0;
    let peak = 0;
    let maxDrawdown = 0;
    const startingCapital = Math.max(Math.abs(data.totalNAV - data.plSummary.total.total), 1);

    const performance = months.map((month) => {
      const net = month.optionsPL
        + (month.stocksPL || 0)
        + (month.forexPL || 0)
        + month.syepIncome
        + month.interest
        - month.interestPaid
        - month.commissions
        - month.fees
        - month.salesTax;
      const income = month.optionsPremium + month.syepIncome + month.interest;
      cumulativePL += net;
      cumulativeIncome += income;
      peak = Math.max(peak, cumulativePL);
      maxDrawdown = Math.min(maxDrawdown, cumulativePL - peak);
      const [year, monthNumber] = month.month.split('-').map(Number);
      const label = Number.isFinite(year) && Number.isFinite(monthNumber)
        ? new Date(year, monthNumber - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
        : month.month;
      return {
        month: label,
        portfolio: cumulativePL,
        income: cumulativeIncome,
        returnPct: (cumulativePL / startingCapital) * 100,
      };
    });

    const premiumIncome = months.reduce((sum, row) => sum + row.optionsPremium, 0);
    const interestIncome = months.reduce((sum, row) => sum + row.interest + row.syepIncome, 0);
    const stockPL = months.reduce((sum, row) => sum + (row.stocksPL || 0), 0);
    const monthCount = Math.max(months.length, 1);
    const annualizedYield = data.totalNAV > 0 ? (premiumIncome / data.totalNAV) * (12 / monthCount) * 100 : 0;
    const avgWeeklyReturn = data.totalNAV > 0 ? (premiumIncome / data.totalNAV) / (monthCount * 4.345) * 100 : 0;
    const totalReturn = startingCapital > 0 ? (data.plSummary.total.total / startingCapital) * 100 : 0;
    const drawdownPct = startingCapital > 0 ? (maxDrawdown / startingCapital) * 100 : 0;

    return {
      performance,
      premiumIncome,
      interestIncome,
      stockPL,
      realizedIncome: premiumIncome + interestIncome + stockPL,
      annualizedYield,
      avgWeeklyReturn,
      totalReturn,
      maxDrawdown,
      drawdownPct,
    };
  }, [data]);

  const holdings = useMemo(
    () => data.positions.filter((position) => !position.isOption).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
    [data.positions],
  );
  const openTrades = useMemo(
    () => data.positions.filter((position) => position.isOption).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
    [data.positions],
  );

  const symbolRows = useMemo(() => {
    const rows = new Map<string, { symbol: string; totalPL: number; closedTrades: number; openQty: number; openValue: number; openPL: number }>();
    data.tickerPL.forEach((item) => {
      rows.set(item.ticker, { symbol: item.ticker, totalPL: item.totalPL, closedTrades: 0, openQty: 0, openValue: 0, openPL: 0 });
    });
    data.closedPositions.forEach((position) => {
      const symbol = baseSymbol(position.symbol);
      const row = rows.get(symbol) || { symbol, totalPL: 0, closedTrades: 0, openQty: 0, openValue: 0, openPL: 0 };
      row.closedTrades += 1;
      if (!data.tickerPL.some((item) => item.ticker === symbol)) row.totalPL += position.realizedPL;
      rows.set(symbol, row);
    });
    data.positions.forEach((position) => {
      const symbol = position.baseSymbol || baseSymbol(position.symbol);
      const row = rows.get(symbol) || { symbol, totalPL: 0, closedTrades: 0, openQty: 0, openValue: 0, openPL: 0 };
      row.openQty += position.quantity;
      row.openValue += position.value;
      row.openPL += position.unrealizedPL;
      rows.set(symbol, row);
    });
    return [...rows.values()].sort((a, b) => b.totalPL - a.totalPL);
  }, [data.closedPositions, data.positions, data.tickerPL]);

  const capital = useMemo(() => {
    const deployed = data.positions.reduce((sum, position) => sum + Math.abs(position.value), 0);
    const collateral = data.positions
      .filter((position) => position.isOption && position.optionType === 'P' && position.quantity < 0)
      .reduce((sum, position) => {
        const rate = data.exchangeRates[position.currency] || 1;
        return sum + (position.strikePrice || 0) * Math.abs(position.quantity) * (position.multiplier || 100) * rate;
      }, 0);
    return { deployed, collateral };
  }, [data.exchangeRates, data.positions]);

  const contributionRows = symbolRows.filter((row) => row.totalPL !== 0).slice(0, 9);
  const maxContribution = Math.max(...contributionRows.map((row) => Math.abs(row.totalPL)), 1);

  const exposureRows = useMemo(() => {
    const values = new Map<string, number>();
    data.positions.forEach((position) => {
      const symbol = position.baseSymbol || baseSymbol(position.symbol);
      values.set(symbol, (values.get(symbol) || 0) + Math.abs(position.value));
    });
    return [...values.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [data.positions]);
  const maxExposure = Math.max(...exposureRows.map((row) => row.value), 1);

  const assetRows = useMemo(() => {
    const buckets = [
      { label: 'Stocks', value: data.positions.filter((p) => !p.isOption).reduce((sum, p) => sum + Math.abs(p.value), 0) },
      { label: 'Short puts', value: data.positions.filter((p) => p.isOption && p.optionType === 'P' && p.quantity < 0).reduce((sum, p) => sum + Math.abs(p.value), 0) },
      { label: 'Short calls', value: data.positions.filter((p) => p.isOption && p.optionType === 'C' && p.quantity < 0).reduce((sum, p) => sum + Math.abs(p.value), 0) },
      { label: 'Other options', value: data.positions.filter((p) => p.isOption && !(p.quantity < 0 && (p.optionType === 'P' || p.optionType === 'C'))).reduce((sum, p) => sum + Math.abs(p.value), 0) },
    ];
    return buckets.filter((row) => row.value > 0);
  }, [data.positions]);
  const maxAsset = Math.max(...assetRows.map((row) => row.value), 1);

  const latestReturn = analytics.performance.at(-1)?.returnPct ?? analytics.totalReturn;
  const dateStamp = data.accountInfo.period || 'Current account snapshot';

  const Pnl: React.FC<{ value: number; muted?: boolean }> = ({ value, muted = false }) => (
    <span className={muted ? 'text-[#bdc4bf]' : value >= 0 ? 'text-[#00c896]' : 'text-[#ff5c5c]'}>{formatMoney(value)}</span>
  );

  const BarList: React.FC<{ rows: { label: string; value: number }[]; max: number; signed?: boolean }> = ({ rows, max, signed = false }) => (
    <div className="space-y-3 px-4 pb-4">
      {rows.length === 0 && <p className="text-xs text-[#68706b]">No history available.</p>}
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[64px_1fr_auto] items-center gap-2 text-[11px]">
          <span className="truncate font-semibold text-[#d9dfdb]" title={row.label}>{row.label}</span>
          <div className="h-2 overflow-hidden rounded-full bg-[#181c1a]">
            <div
              className={`h-full rounded-full ${signed && row.value < 0 ? 'bg-[#ff5c5c]' : 'bg-[#00c896]'}`}
              style={{ width: `${Math.max(4, Math.abs(row.value) / max * 100)}%` }}
            />
          </div>
          <span className="min-w-[72px] text-right font-mono text-[#8b949e]">{formatMoney(row.value)}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#070908] text-[#d9dfdb] selection:bg-[#00c896]/30">
      <div className="mx-auto max-w-[1560px] px-4 py-5 sm:px-6 lg:px-8">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-[#171b18] pb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#00c896] text-sm font-black text-[#06100c]">PT</div>
            <div>
              <h1 className="text-xl font-bold tracking-[-0.03em] text-white">Premium Tracker <span className="text-[#00c896]">Labs</span></h1>
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#59615c]">Trading dashboard</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="mr-2 hidden text-xs text-[#68706b] md:inline">{dateStamp}</span>
            <button onClick={onSwitchToClassic} className="rounded-md border border-[#272d29] px-3 py-2 text-xs font-semibold text-[#aeb6b0] transition hover:border-[#3a443e] hover:text-white">Classic dashboard</button>
            <button onClick={onRefreshData} disabled={isRefreshing} className="rounded-md border border-[#184d3c] bg-[#0c241c] px-3 py-2 text-xs font-semibold text-[#00c896] transition hover:bg-[#103126] disabled:cursor-wait disabled:opacity-60">{isRefreshing ? 'Refreshing…' : 'Refresh data'}</button>
            <button onClick={onReset} className="rounded-md bg-[#00c896] px-3 py-2 text-xs font-bold text-[#04110c] transition hover:bg-[#22ddb0]">New analysis</button>
          </div>
        </header>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <main className="min-w-0 space-y-4">
            <Panel>
              <div className="flex flex-wrap items-start justify-between gap-3 px-4 pb-2 pt-4">
                <div>
                  <h2 className="text-sm font-semibold text-[#eef2ef]">Performance &amp; income</h2>
                  <p className="mt-1 text-xs text-[#68706b]">Cumulative realized portfolio P/L compared with cumulative income</p>
                </div>
                <div className="text-right">
                  <div className={`font-mono text-lg font-bold ${data.plSummary.total.total >= 0 ? 'text-[#00c896]' : 'text-[#ff5c5c]'}`}>{formatMoney(data.plSummary.total.total)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-[#68706b]">Net P/L</div>
                </div>
              </div>
              <div className="h-[330px] px-2 pb-2">
                {analytics.performance.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={analytics.performance} margin={{ top: 18, right: 18, left: 4, bottom: 0 }}>
                      <CartesianGrid stroke={BORDER} strokeDasharray="3 4" vertical={false} />
                      <XAxis dataKey="month" stroke={MUTED} tick={{ fontSize: 10 }} tickLine={false} axisLine={{ stroke: BORDER }} />
                      <YAxis stroke={MUTED} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(value) => compactMoney.format(value)} width={58} />
                      <Tooltip contentStyle={{ background: '#0d110f', border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 12 }} labelStyle={{ color: '#d9dfdb' }} formatter={(value: number) => formatMoney(value)} />
                      <Legend wrapperStyle={{ fontSize: 11, color: MUTED }} />
                      <Line type="monotone" dataKey="portfolio" name="Portfolio P/L" stroke={ACCENT} strokeWidth={2.2} dot={false} activeDot={{ r: 4, fill: ACCENT }} />
                      <Line type="monotone" dataKey="income" name="Premium + interest" stroke="#9aa29d" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-[#68706b]">Flex history will populate the performance chart.</div>
                )}
              </div>
              <div className="grid grid-cols-2 border-t border-[#1b201d] sm:grid-cols-4">
                {[
                  ['Portfolio return', formatPercent(latestReturn), latestReturn >= 0],
                  ['Max drawdown', formatPercent(analytics.drawdownPct), false],
                  ['Annualized yield', formatPercent(analytics.annualizedYield), analytics.annualizedYield >= 0],
                  ['Avg weekly ROC', formatPercent(analytics.avgWeeklyReturn), analytics.avgWeeklyReturn >= 0],
                ].map(([label, value, positive]) => (
                  <div key={String(label)} className="border-[#1b201d] px-4 py-3 text-center odd:border-r sm:border-r sm:last:border-r-0">
                    <div className="text-[10px] uppercase tracking-wider text-[#68706b]">{label}</div>
                    <div className={`mt-1 font-mono text-sm font-bold ${positive ? 'text-[#00c896]' : 'text-[#d9dfdb]'}`}>{value}</div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel>
              <SectionTitle title="Open holdings" count={holdings.length} />
              {holdings.length === 0 ? <EmptyRow>No open stock holdings.</EmptyRow> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <thead className="border-y border-[#1b201d] text-[10px] uppercase tracking-wider text-[#68706b]"><tr>
                      <th className="px-4 py-2 font-medium">Symbol</th><th className="px-3 py-2 text-right font-medium">Shares</th><th className="px-3 py-2 text-right font-medium">Avg basis</th><th className="px-3 py-2 text-right font-medium">Price</th><th className="px-3 py-2 text-right font-medium">Value</th><th className="px-3 py-2 text-right font-medium">P/L</th><th className="px-4 py-2 text-right font-medium">P/L %</th>
                    </tr></thead>
                    <tbody>{holdings.map((position) => {
                      const basis = position.quantity ? Math.abs(position.costBasis / position.quantity) : 0;
                      const cost = Math.abs(position.costBasis);
                      const pnlPct = cost ? position.unrealizedPL / cost * 100 : 0;
                      return <tr key={position.symbol} className="border-b border-[#171b18] last:border-0 hover:bg-[#101411]">
                        <td className="px-4 py-2.5 font-semibold text-[#edf2ef]">{position.symbol}</td><td className="px-3 py-2.5 text-right font-mono">{number.format(position.quantity)}</td><td className="px-3 py-2.5 text-right font-mono">{formatMoney(basis)}</td><td className="px-3 py-2.5 text-right font-mono">{formatMoney(position.closePrice)}</td><td className="px-3 py-2.5 text-right font-mono">{formatMoney(position.value)}</td><td className="px-3 py-2.5 text-right font-mono"><Pnl value={position.unrealizedPL} /></td><td className={`px-4 py-2.5 text-right font-mono ${pnlPct >= 0 ? 'text-[#00c896]' : 'text-[#ff5c5c]'}`}>{formatPercent(pnlPct)}</td>
                      </tr>;
                    })}</tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel>
              <SectionTitle title="Open option trades" count={openTrades.length} />
              {openTrades.length === 0 ? <EmptyRow>No open option trades.</EmptyRow> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-left text-xs">
                    <thead className="border-y border-[#1b201d] text-[10px] uppercase tracking-wider text-[#68706b]"><tr>
                      <th className="px-4 py-2 font-medium">Contract</th><th className="px-3 py-2 text-right font-medium">Qty</th><th className="px-3 py-2 text-right font-medium">Strike</th><th className="px-3 py-2 text-right font-medium">Expiry</th><th className="px-3 py-2 text-right font-medium">Premium</th><th className="px-3 py-2 text-right font-medium">Value</th><th className="px-4 py-2 text-right font-medium">P/L</th>
                    </tr></thead>
                    <tbody>{openTrades.map((position) => <tr key={position.symbol} className="border-b border-[#171b18] last:border-0 hover:bg-[#101411]">
                      <td className="px-4 py-2.5 font-semibold text-[#edf2ef]"><span className="mr-2 text-[#00c896]">{position.baseSymbol}</span><span className="text-[#8b949e]">{position.optionType === 'P' ? 'PUT' : position.optionType === 'C' ? 'CALL' : 'OPTION'}</span></td><td className="px-3 py-2.5 text-right font-mono">{number.format(position.quantity)}</td><td className="px-3 py-2.5 text-right font-mono">{position.strikePrice ? formatMoney(position.strikePrice) : '—'}</td><td className="px-3 py-2.5 text-right font-mono text-[#aeb6b0]">{position.expiry || '—'}</td><td className="px-3 py-2.5 text-right font-mono">{formatMoney(position.collectedPremium || 0)}</td><td className="px-3 py-2.5 text-right font-mono">{formatMoney(position.value)}</td><td className="px-4 py-2.5 text-right font-mono"><Pnl value={position.unrealizedPL} /></td>
                    </tr>)}</tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel>
              <SectionTitle title="Symbol performance" count={symbolRows.length} />
              {symbolRows.length === 0 ? <EmptyRow>Flex history will populate symbol performance.</EmptyRow> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <thead className="border-y border-[#1b201d] text-[10px] uppercase tracking-wider text-[#68706b]"><tr>
                      <th className="px-4 py-2 font-medium">Symbol</th><th className="px-3 py-2 text-right font-medium">Total P/L</th><th className="px-3 py-2 text-right font-medium">Closed trades</th><th className="px-3 py-2 text-right font-medium">Open qty</th><th className="px-3 py-2 text-right font-medium">Open value</th><th className="px-4 py-2 text-right font-medium">Open P/L</th>
                    </tr></thead>
                    <tbody>{symbolRows.map((row) => <tr key={row.symbol} className="border-b border-[#171b18] last:border-0 hover:bg-[#101411]">
                      <td className="px-4 py-2.5 font-semibold text-[#edf2ef]">{row.symbol}</td><td className="px-3 py-2.5 text-right font-mono"><Pnl value={row.totalPL} /></td><td className="px-3 py-2.5 text-right font-mono">{row.closedTrades}</td><td className="px-3 py-2.5 text-right font-mono">{number.format(row.openQty)}</td><td className="px-3 py-2.5 text-right font-mono">{formatMoney(row.openValue)}</td><td className="px-4 py-2.5 text-right font-mono"><Pnl value={row.openPL} muted={row.openPL === 0} /></td>
                    </tr>)}</tbody>
                  </table>
                </div>
              )}
            </Panel>
          </main>

          <aside className="space-y-3 xl:sticky xl:top-4">
            <Panel className="p-4">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-[#68706b]"><span>Net P/L</span><span>All accounts</span></div>
              <div className={`mt-3 font-mono text-2xl font-bold ${data.plSummary.total.total >= 0 ? 'text-[#00c896]' : 'text-[#ff5c5c]'}`}>{formatMoney(data.plSummary.total.total)}</div>
              <div className="mt-3 space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-[#7d857f]">Portfolio return</span><span className="font-mono">{formatPercent(latestReturn)}</span></div>
                <div className="flex justify-between"><span className="text-[#7d857f]">Max drawdown</span><span className="font-mono">{formatPercent(analytics.drawdownPct)}</span></div>
                <div className="flex justify-between"><span className="text-[#7d857f]">Unrealized P/L</span><span className="font-mono"><Pnl value={data.plSummary.total.unrealized} /></span></div>
              </div>
            </Panel>

            <Panel className="p-4">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-[#68706b]"><span>Realized income</span><span>Flex history</span></div>
              <div className={`mt-3 font-mono text-xl font-bold ${analytics.realizedIncome >= 0 ? 'text-[#00c896]' : 'text-[#ff5c5c]'}`}>{formatMoney(analytics.realizedIncome)}</div>
              <div className="mt-3 space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-[#7d857f]">Premiums</span><span className="font-mono">{formatMoney(analytics.premiumIncome)}</span></div>
                <div className="flex justify-between"><span className="text-[#7d857f]">Interest + SYEP</span><span className="font-mono">{formatMoney(analytics.interestIncome)}</span></div>
                <div className="flex justify-between"><span className="text-[#7d857f]">Stock P/L</span><span className="font-mono">{formatMoney(analytics.stockPL)}</span></div>
              </div>
            </Panel>

            <Panel className="p-4">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-[#68706b]"><span>Annualized yield</span><span>Flex history</span></div>
              <div className="mt-3 font-mono text-xl font-bold text-[#00c896]">{formatPercent(analytics.annualizedYield)}</div>
              <div className="mt-3 space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-[#7d857f]">Avg weekly ROC</span><span className="font-mono">{formatPercent(analytics.avgWeeklyReturn)}</span></div>
                <div className="flex justify-between"><span className="text-[#7d857f]">Return on NAV</span><span className="font-mono">{data.totalNAV ? formatPercent(analytics.premiumIncome / data.totalNAV * 100) : '0.00%'}</span></div>
              </div>
            </Panel>

            <Panel className="p-4">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-[#68706b]"><span>Capital</span><span>Gateway snapshot</span></div>
              <div className="mt-3 font-mono text-xl font-bold text-[#eef2ef]">{formatMoney(data.totalNAV)}</div>
              <div className="mt-3 space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-[#7d857f]">Positions deployed</span><span className="font-mono">{formatMoney(capital.deployed)}</span></div>
                <div className="flex justify-between"><span className="text-[#7d857f]">Put collateral</span><span className="font-mono">{formatMoney(capital.collateral)}</span></div>
                <div className="flex justify-between"><span className="text-[#7d857f]">Cash</span><span className="font-mono">{formatMoney(data.nav.cash)}</span></div>
              </div>
            </Panel>

            <Panel><SectionTitle title="Top contributors" /><BarList rows={contributionRows.map((row) => ({ label: row.symbol, value: row.totalPL }))} max={maxContribution} signed /></Panel>
            <Panel><SectionTitle title="Largest exposures" /><BarList rows={exposureRows} max={maxExposure} /></Panel>
            <Panel><SectionTitle title="Asset mix" /><BarList rows={assetRows} max={maxAsset} /></Panel>
          </aside>
        </div>

        <footer className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-[#171b18] py-5 text-[10px] text-[#4f5752]">
          <span>Premium Tracker Labs · live Gateway snapshot + Flex history</span>
          <span>{data.accountInfo.account ? `Account ${data.accountInfo.account}` : 'Interactive Brokers portfolio'}</span>
        </footer>
      </div>
    </div>
  );
};

export default LabsDashboard;
