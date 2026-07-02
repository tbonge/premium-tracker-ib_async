
import React, { useState, useMemo } from 'react';
import { WheelCycle, WheelCycleAnalysis, PendingWheelCycle, Position } from '../../types';
import { ChevronDownIcon, ChevronUpIcon, DEFAULT_OPTION_MULTIPLIER, LEAPS_DTE_THRESHOLD } from '../../constants';
import Tooltip from '../Tooltip';
import { useLocalization } from '../../context/LocalizationContext';
import { calendarDte } from '../../utils/dates';

interface WheelCyclesProps {
    wheelCycleAnalysis: WheelCycleAnalysis;
    formatInSelectedCurrency: (value: number) => string;
    formatCurrency: (value: number, currency: string) => string;
    baseCurrency: string;
    positions?: Position[];
    exchangeRates?: Record<string, number>;
}

type SortKeys = 'symbol' | 'startDate' | 'endDate' | 'durationDays' | 'initialPutPremium' | 'totalCallPremium' | 'otherIncome' | 'stockPL' | 'totalPL' | 'returnOnCost' | 'annualizedReturn';
type PendingSortKeys = 'symbol' | 'status' | 'startDate' | 'assignmentShares' | 'lastClosePrice' | 'costBasisPerShare' | 'realizedPutPL' | 'realizedCallPL' | 'openPutCredit' | 'openCallCredit' | 'stockPLAtCurrent' | 'ifCalledAwayPL' | 'mtmWheelPL';

const isWheelCall = (position: Position) => (calendarDte(position.expiry) ?? -Infinity) < LEAPS_DTE_THRESHOLD;
const isWheelPut = (position: Position) => (calendarDte(position.expiry) ?? -Infinity) < LEAPS_DTE_THRESHOLD;

const uniqueTradeLog = (tradeLog: PendingWheelCycle['tradeLog'] = []) => [...new Map(
    tradeLog.map(log => [`${log.date}|${log.description}|${log.amount}`, log])
).values()];

const callLogsFor = (tradeLog: PendingWheelCycle['tradeLog'] = []) => tradeLog.filter(log => /call (premium|sold|bought\/closed|roll\/close|expired\/closed)/i.test(log.description));
const openCallSaleLogsFor = (tradeLog: PendingWheelCycle['tradeLog'] = []) => tradeLog.filter(log => /^Call sold \(/i.test(log.description));
const amountSum = (logs: PendingWheelCycle['tradeLog'] = []) => logs.reduce((sum, log) => sum + log.amount, 0);

const groupPendingCyclesBySymbol = (cycles: PendingWheelCycle[], positions: Position[] = [], exchangeRates: Record<string, number> = {}): PendingWheelCycle[] => {
    const groups = new Map<string, PendingWheelCycle & { maxCallPremium: number; strikeWeight: number; strikeShares: number; maxCoveredShares: number }>();

    cycles.forEach(cycle => {
        const existing = groups.get(cycle.symbol);
        if (!existing) {
            groups.set(cycle.symbol, {
                ...cycle,
                tradeLog: [...cycle.tradeLog],
                openPutLog: [...(cycle.openPutLog || [])],
                maxCallPremium: cycle.totalCallPremium,
                strikeWeight: (cycle.coveredCallStrike || 0) * (cycle.coveredCallShares || 0),
                strikeShares: cycle.coveredCallShares || 0,
                maxCoveredShares: cycle.coveredCallShares || 0,
            });
            return;
        }

        existing.startDate = existing.startDate < cycle.startDate ? existing.startDate : cycle.startDate;
        existing.assignmentShares += cycle.assignmentShares;
        existing.assignmentCost += cycle.assignmentCost;
        existing.netAssignmentCost += cycle.netAssignmentCost;
        existing.initialPutPremium += cycle.initialPutPremium;
        existing.realizedPutPL = (existing.realizedPutPL || 0) + (cycle.realizedPutPL ?? cycle.initialPutPremium);
        existing.openPutCredit = (existing.openPutCredit || 0) + (cycle.openPutCredit || 0);
        existing.realizedCallPL = (existing.realizedCallPL || 0) + (cycle.realizedCallPL || 0);
        existing.openCallCredit = (existing.openCallCredit || 0) + (cycle.openCallCredit || 0);
        existing.otherIncome = (existing.otherIncome || 0) + (cycle.otherIncome || 0);
        existing.currentStockValue += cycle.currentStockValue;
        existing.tradeLog.push(...cycle.tradeLog);
        existing.openPutLog = [...(existing.openPutLog || []), ...(cycle.openPutLog || [])];
        existing.maxCallPremium = Math.max(existing.maxCallPremium, cycle.totalCallPremium);
        existing.strikeWeight += (cycle.coveredCallStrike || 0) * (cycle.coveredCallShares || 0);
        existing.strikeShares += cycle.coveredCallShares || 0;
        existing.maxCoveredShares = Math.max(existing.maxCoveredShares, cycle.coveredCallShares || 0);
    });

    return [...groups.values()].map(group => {
        const tradeLog = uniqueTradeLog(group.tradeLog);
        const importedOpenPutLog = uniqueTradeLog(group.openPutLog || []);
        const importedOpenPutCredit = importedOpenPutLog.reduce((sum, log) => sum + log.amount, 0);
        const openPutPositions = positions.filter(position =>
            position.isOption &&
            position.optionType === 'P' &&
            position.quantity < 0 &&
            position.baseSymbol === group.symbol &&
            isWheelPut(position)
        );
        const positionOpenPutLog = openPutPositions.map(position => ({
            date: position.expiry || '',
            description: `Open put position (${position.symbol})`,
            amount: position.collectedPremium || 0,
        }));
        const openPutLog = importedOpenPutLog.length > 0 ? importedOpenPutLog : uniqueTradeLog(positionOpenPutLog);
        const openPutCredit = importedOpenPutLog.length > 0 ? importedOpenPutCredit : amountSum(positionOpenPutLog);
        const openCalls = positions.filter(position =>
            position.isOption &&
            position.optionType === 'C' &&
            position.quantity < 0 &&
            position.baseSymbol === group.symbol &&
            position.strikePrice &&
            isWheelCall(position)
        );
        const openCallContracts = openCalls.reduce((sum, position) => sum + Math.abs(position.quantity), 0);
        const positionCoveredShares = openCalls.reduce((sum, position) => sum + Math.abs(position.quantity) * (position.multiplier || DEFAULT_OPTION_MULTIPLIER), 0);
        const positionCoveredStrike = openCallContracts > 0
            ? openCalls.reduce((sum, position) => sum + (position.strikePrice || 0) * Math.abs(position.quantity), 0) / openCallContracts
            : undefined;
        const callLogs = callLogsFor(tradeLog);
        const loggedCallPremium = callLogs.reduce((sum, log) => sum + log.amount, 0);
        const displayCallPremium = callLogs.length > 0 ? loggedCallPremium : group.maxCallPremium;
        const positionOpenCallCredit = openCalls.reduce((sum, position) => sum + (position.collectedPremium || 0), 0);
        const openCallCredit = group.openCallCredit || positionOpenCallCredit || amountSum(openCallSaleLogsFor(tradeLog));
        const realizedCallPL = group.realizedCallPL ?? (displayCallPremium - openCallCredit);
        const realizedPutPL = group.realizedPutPL ?? group.initialPutPremium;
        const coveredCallShares = Math.min(group.assignmentShares, positionCoveredShares || group.maxCoveredShares);
        const coveredCallStrike = positionCoveredStrike || (group.strikeShares > 0 ? group.strikeWeight / group.strikeShares : undefined);
        const stockPosition = positions.find(position => !position.isOption && position.symbol === group.symbol);
        const rate = exchangeRates[group.currency] || (stockPosition ? exchangeRates[stockPosition.currency] : undefined) || 1;
        const lastClosePrice = stockPosition?.closePrice || (group.assignmentShares > 0 ? group.currentStockValue / rate / group.assignmentShares : 0);
        const uncoveredShares = Math.max(0, group.assignmentShares - coveredCallShares);
        const cappedStockValue = coveredCallStrike && coveredCallShares > 0
            ? ((coveredCallShares * coveredCallStrike) + (uncoveredShares * lastClosePrice)) * rate
            : group.currentStockValue;
        const stockPLAtCurrent = group.currentStockValue - group.netAssignmentCost;
        const ifCalledAwayPL = cappedStockValue - group.netAssignmentCost + realizedCallPL + openCallCredit + (group.otherIncome || 0);
        const openOptionMarketValue = positions
            .filter(position => position.isOption && position.baseSymbol === group.symbol && (isWheelCall(position) || isWheelPut(position)))
            .reduce((sum, position) => sum + position.value, 0);
        const mtmWheelPL = stockPLAtCurrent + realizedCallPL + openOptionMarketValue + (group.otherIncome || 0);
        const start = new Date(`${group.startDate}T00:00:00`).getTime();
        const durationDays = Number.isFinite(start) ? Math.max(1, Math.round((Date.now() - start) / 86400000)) : 1;
        const status = coveredCallShares >= group.assignmentShares && group.assignmentShares > 0
            ? 'assigned-covered'
            : coveredCallShares > 0 ? 'assigned-partial' : 'assigned-uncovered';

        return {
            ...group,
            status,
            tradeLog,
            openPutLog,
            assignmentPrice: group.assignmentShares ? group.assignmentCost / group.assignmentShares : 0,
            initialPutPremium: realizedPutPL + openPutCredit,
            realizedPutPL,
            openPutCredit,
            totalCallPremium: displayCallPremium,
            realizedCallPL,
            openCallCredit,
            coveredCallShares,
            coveredCallStrike,
            cappedStockValue,
            effectiveBasisPerShare: group.assignmentShares ? group.netAssignmentCost / group.assignmentShares : 0,
            unrealizedStockPL: ifCalledAwayPL,
            stockPLAtCurrent,
            ifCalledAwayPL,
            mtmWheelPL,
            currentTotalPL: ifCalledAwayPL,
            annualizedReturn: group.assignmentCost > 0 ? (ifCalledAwayPL / group.assignmentCost) * (365 / durationDays) : 0,
        };
    });
};

const WheelCycles: React.FC<WheelCyclesProps> = ({ wheelCycleAnalysis, formatInSelectedCurrency, formatCurrency, positions = [], exchangeRates = {} }) => {
    const { t, locale } = useLocalization();
    
    const [completedSortConfig, setCompletedSortConfig] = useState<{ key: SortKeys; direction: 'asc' | 'desc' }>({ key: 'endDate', direction: 'desc' });
    const [pendingSortConfig, setPendingSortConfig] = useState<{ key: PendingSortKeys; direction: 'asc' | 'desc' }>({ key: 'startDate', direction: 'desc' });

    const [expandedCompletedRow, setExpandedCompletedRow] = useState<number | null>(null);
    const [expandedPendingRow, setExpandedPendingRow] = useState<number | null>(null);
    const [logSort, setLogSort] = useState<{ key: 'date' | 'description' | 'amount'; direction: 'asc' | 'desc' }>({ key: 'date', direction: 'asc' });
    const pendingDerived = (cycle: PendingWheelCycle) => {
        const shares = cycle.assignmentShares || 0;
        const lastClosePrice = shares > 0 ? cycle.currentStockValue / shares : 0;
        const costBasisPerShare = shares > 0 ? cycle.netAssignmentCost / shares : 0;
        const start = new Date(`${cycle.startDate}T00:00:00`).getTime();
        const durationDays = Number.isFinite(start) ? Math.max(1, Math.round((Date.now() - start) / 86400000)) : 1;
        const annualizedReturn = cycle.annualizedReturn && cycle.annualizedReturn !== 0
            ? cycle.annualizedReturn
            : cycle.assignmentCost > 0 ? (cycle.currentTotalPL / cycle.assignmentCost) * (365 / durationDays) : 0;
        return { lastClosePrice, costBasisPerShare, durationDays, annualizedReturn };
    };
    const sortedTradeLog = (tradeLog: WheelCycle['tradeLog']) => [...tradeLog].sort((a, b) => {
        const left = a[logSort.key];
        const right = b[logSort.key];
        const result = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true });
        return logSort.direction === 'asc' ? result : -result;
    });
    const requestLogSort = (key: 'date' | 'description' | 'amount') => setLogSort(current => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }));
    const logHeader = (key: 'date' | 'description' | 'amount', label: string, right = false) => (
        <th className={`p-1 cursor-pointer select-none text-brand-text-secondary ${right ? 'text-right' : 'text-left'}`} onClick={() => requestLogSort(key)}>
            <span className="inline-flex items-center gap-1">{label}{logSort.key === key && (logSort.direction === 'asc' ? <ChevronUpIcon className="w-3 h-3" /> : <ChevronDownIcon className="w-3 h-3" />)}</span>
        </th>
    );
    const nearestOpenCall = (symbol: string) => {
        const calls = positions
            .filter(position =>
                position.isOption &&
                position.optionType === 'C' &&
                position.quantity < 0 &&
                position.baseSymbol === symbol &&
                position.strikePrice &&
                isWheelCall(position)
            )
            .map(position => ({ dte: calendarDte(position.expiry), strike: position.strikePrice }))
            .filter((call): call is { dte: number; strike: number } => call.dte !== undefined && call.strike !== undefined)
            .sort((a, b) => a.dte - b.dte);
        return calls[0];
    };
    const pendingStatusLabel = (cycle: PendingWheelCycle) => {
        const call = nearestOpenCall(cycle.symbol);
        const dteAtStrike = call ? `${call.dte} DTE @ ${formatCurrency(call.strike, cycle.currency)}` : undefined;
        if (cycle.status === 'assigned-covered' && dteAtStrike) return dteAtStrike;
        if (cycle.status === 'assigned-partial' && dteAtStrike) return `${t('dashboard.wheel.statuses.assigned-partial')} / ${dteAtStrike}`;
        return t(`dashboard.wheel.statuses.${cycle.status || 'assigned-uncovered'}`);
    };

    const handleCompletedRowClick = (index: number) => {
        setExpandedCompletedRow(expandedCompletedRow === index ? null : index);
    };

    const handlePendingRowClick = (index: number) => {
        setExpandedPendingRow(expandedPendingRow === index ? null : index);
    };
    
    const sortedCompletedCycles = useMemo(() => {
        if (!wheelCycleAnalysis.completedCycles) return [];
        return [...wheelCycleAnalysis.completedCycles].sort((a, b) => {
            let aValue = a[completedSortConfig.key];
            let bValue = b[completedSortConfig.key];
            
            if(completedSortConfig.key === 'endDate' || completedSortConfig.key === 'startDate') {
                aValue = new Date(a[completedSortConfig.key]).getTime();
                bValue = new Date(b[completedSortConfig.key]).getTime();
            }

            if (aValue < bValue) return completedSortConfig.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return completedSortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [wheelCycleAnalysis.completedCycles, completedSortConfig]);

    const sortedPendingCycles = useMemo(() => {
        if (!wheelCycleAnalysis.pendingCycles) return [];
        return groupPendingCyclesBySymbol(wheelCycleAnalysis.pendingCycles, positions, exchangeRates).sort((a, b) => {
            const aDerived = pendingDerived(a);
            const bDerived = pendingDerived(b);
            let aValue = pendingSortConfig.key in aDerived
                ? aDerived[pendingSortConfig.key as keyof typeof aDerived]
                : a[pendingSortConfig.key as keyof PendingWheelCycle];
            let bValue = pendingSortConfig.key in bDerived
                ? bDerived[pendingSortConfig.key as keyof typeof bDerived]
                : b[pendingSortConfig.key as keyof PendingWheelCycle];

            if (pendingSortConfig.key === 'startDate') {
                aValue = new Date(a.startDate).getTime();
                bValue = new Date(b.startDate).getTime();
            }

            if (aValue < bValue) return pendingSortConfig.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return pendingSortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [exchangeRates, positions, wheelCycleAnalysis.pendingCycles, pendingSortConfig]);


    const requestSort = (key: SortKeys) => {
        let direction: 'asc' | 'desc' = 'desc';
        if (completedSortConfig.key === key && completedSortConfig.direction === 'desc') {
            direction = 'asc';
        }
        setCompletedSortConfig({ key, direction });
    };

    const requestPendingSort = (key: PendingSortKeys) => {
        let direction: 'asc' | 'desc' = 'desc';
        if (pendingSortConfig.key === key && pendingSortConfig.direction === 'desc') {
            direction = 'asc';
        }
        setPendingSortConfig({ key, direction });
    };

    const pendingTotals = useMemo(() => {
        if (!sortedPendingCycles) return { realizedPutPL: 0, realizedCallPL: 0, openPutCredit: 0, openCallCredit: 0, stockPLAtCurrent: 0, ifCalledAwayPL: 0, mtmWheelPL: 0 };
        return sortedPendingCycles.reduce((acc, cycle) => {
            acc.realizedPutPL += cycle.realizedPutPL || 0;
            acc.realizedCallPL += cycle.realizedCallPL || 0;
            acc.openPutCredit += cycle.openPutCredit || 0;
            acc.openCallCredit += cycle.openCallCredit || 0;
            acc.stockPLAtCurrent += cycle.stockPLAtCurrent || 0;
            acc.ifCalledAwayPL += cycle.ifCalledAwayPL || 0;
            acc.mtmWheelPL += cycle.mtmWheelPL || 0;
            return acc;
        }, { realizedPutPL: 0, realizedCallPL: 0, openPutCredit: 0, openCallCredit: 0, stockPLAtCurrent: 0, ifCalledAwayPL: 0, mtmWheelPL: 0 });
    }, [sortedPendingCycles]);

    const completedTotals = useMemo(() => {
        if (!wheelCycleAnalysis.completedCycles) return { putPremium: 0, callPremium: 0, otherIncome: 0, stockPL: 0, totalPL: 0 };
        return wheelCycleAnalysis.completedCycles.reduce((acc, cycle) => {
            acc.putPremium += cycle.initialPutPremium;
            acc.callPremium += cycle.totalCallPremium;
            acc.otherIncome += cycle.otherIncome || 0;
            acc.stockPL += cycle.stockPL;
            acc.totalPL += cycle.totalPL;
            return acc;
        }, { putPremium: 0, callPremium: 0, otherIncome: 0, stockPL: 0, totalPL: 0 });
    }, [wheelCycleAnalysis.completedCycles]);

    const SortableHeader: React.FC<{ sortKey: SortKeys; headerKey: string; tooltipKey?: string; tooltipAlign?: 'center' | 'left' | 'right'; align?: 'left' | 'right' }> = ({ sortKey, headerKey, tooltipKey, tooltipAlign, align = 'right' }) => (
        <th className="p-2 text-sm font-semibold text-brand-text-secondary uppercase cursor-pointer" onClick={() => requestSort(sortKey)}>
            <div className={`flex items-center ${align === 'right' ? 'justify-end' : ''}`}>
                {tooltipKey ? <Tooltip content={t(tooltipKey)} align={tooltipAlign}>
                    <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t(headerKey)}</span>
                </Tooltip> : <span>{t(headerKey)}</span>}
                {completedSortConfig.key === sortKey && (completedSortConfig.direction === 'asc' ? <ChevronUpIcon className="w-4 h-4 ml-1" /> : <ChevronDownIcon className="w-4 h-4 ml-1" />)}
            </div>
        </th>
    );

     const SortablePendingHeader: React.FC<{ sortKey: PendingSortKeys; headerKey: string; tooltipKey?: string; align?: 'left' | 'right'; tooltipAlign?: 'center' | 'left' | 'right' }> = ({ sortKey, headerKey, tooltipKey, align = 'right', tooltipAlign }) => (
        <th className={`p-2 text-sm font-semibold text-brand-text-secondary uppercase cursor-pointer text-${align}`} onClick={() => requestPendingSort(sortKey)}>
            <div className={`flex items-center ${align === 'right' ? 'justify-end' : ''}`}>
                {tooltipKey ? <Tooltip content={t(tooltipKey)} align={tooltipAlign}>
                    <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t(headerKey)}</span>
                </Tooltip> : <span>{t(headerKey)}</span>}
                {pendingSortConfig.key === sortKey && (pendingSortConfig.direction === 'asc' ? <ChevronUpIcon className="w-4 h-4 ml-1" /> : <ChevronDownIcon className="w-4 h-4 ml-1" />)}
            </div>
        </th>
    );
    
    if ((!sortedCompletedCycles || sortedCompletedCycles.length === 0) && (!sortedPendingCycles || sortedPendingCycles.length === 0)) {
        return null;
    }

    return (
        <div className="bg-brand-surface rounded-lg shadow-lg p-6 mt-8">
            <h3 className="text-xl font-semibold mb-4">{t('dashboard.wheel.title')}</h3>
            
            {sortedPendingCycles.length > 0 && (
                <div className="mb-10">
                    <h4 className="text-lg font-semibold mb-2 text-brand-text-secondary">{t('dashboard.wheel.pending.title')}</h4>
                    <div className="pt-4">
                        <table className="w-full table-fixed text-left text-xs lg:text-sm">
                            <colgroup>
                                <col className="w-[8%]" />
                                <col className="w-[13%]" />
                                <col className="w-[6%]" />
                                <col className="w-[8%]" />
                                <col className="w-[8%]" />
                                <col className="w-[8%]" />
                                <col className="w-[8%]" />
                                <col className="w-[8%]" />
                                <col className="w-[8%]" />
                                <col className="w-[8%]" />
                                <col className="w-[9%]" />
                                <col className="w-[8%]" />
                            </colgroup>
                            <thead>
                                <tr className="border-b border-brand-card">
                                    <SortablePendingHeader sortKey="symbol" headerKey="dashboard.wheel.pending.headers.symbol" align="left" />
                                    <SortablePendingHeader sortKey="status" headerKey="dashboard.wheel.pending.headers.status" align="left" />
                                    <SortablePendingHeader sortKey="assignmentShares" headerKey="dashboard.wheel.pending.headers.shares" />
                                    <SortablePendingHeader sortKey="costBasisPerShare" headerKey="dashboard.wheel.pending.headers.costBasisPerShare" />
                                    <SortablePendingHeader sortKey="lastClosePrice" headerKey="dashboard.wheel.pending.headers.lastClose" />
                                    <SortablePendingHeader sortKey="realizedPutPL" headerKey="dashboard.wheel.pending.headers.realizedPutPL" />
                                    <SortablePendingHeader sortKey="realizedCallPL" headerKey="dashboard.wheel.pending.headers.realizedCallPL" />
                                    <SortablePendingHeader sortKey="openPutCredit" headerKey="dashboard.wheel.pending.headers.openPutCredit" />
                                    <SortablePendingHeader sortKey="openCallCredit" headerKey="dashboard.wheel.pending.headers.openCallCredit" />
                                    <SortablePendingHeader sortKey="stockPLAtCurrent" headerKey="dashboard.wheel.pending.headers.stockPLAtCurrent" />
                                    <SortablePendingHeader sortKey="ifCalledAwayPL" headerKey="dashboard.wheel.pending.headers.ifCalledAwayPL" />
                                    <SortablePendingHeader sortKey="mtmWheelPL" headerKey="dashboard.wheel.pending.headers.mtmWheelPL" />
                                </tr>
                            </thead>
                            <tbody>
                                {sortedPendingCycles.map((cycle, i) => {
                                    const derived = pendingDerived(cycle);
                                    return <React.Fragment key={`pending-${cycle.symbol}-${i}`}>
                                        <tr className="border-b border-brand-card last:border-b-0 hover:bg-brand-card/50 cursor-pointer" onClick={() => handlePendingRowClick(i)}>
                                            <td className="p-2 font-mono truncate">
                                                <div className="flex items-center">
                                                    {expandedPendingRow === i ? <ChevronUpIcon className="w-4 h-4 mr-2"/> : <ChevronDownIcon className="w-4 h-4 mr-2"/>}
                                                    {cycle.symbol}
                                                </div>
                                            </td>
                                            <td className="p-2 whitespace-nowrap">{pendingStatusLabel(cycle)}</td>
                                            <td className="p-2 font-mono text-right">{cycle.assignmentShares.toLocaleString(locale)}</td>
                                            <td className="p-2 font-mono text-right">{formatCurrency(derived.costBasisPerShare, cycle.currency)}</td>
                                            <td className="p-2 font-mono text-right">{formatCurrency(derived.lastClosePrice, cycle.currency)}</td>
                                            <td className={`p-2 font-mono text-right ${(cycle.realizedPutPL || 0) >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatInSelectedCurrency(cycle.realizedPutPL || 0)}</td>
                                            <td className={`p-2 font-mono text-right ${(cycle.realizedCallPL || 0) >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatInSelectedCurrency(cycle.realizedCallPL || 0)}</td>
                                            <td className={`p-2 font-mono text-right ${(cycle.openPutCredit || 0) >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatInSelectedCurrency(cycle.openPutCredit || 0)}</td>
                                            <td className={`p-2 font-mono text-right ${(cycle.openCallCredit || 0) >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatInSelectedCurrency(cycle.openCallCredit || 0)}</td>
                                            <td className={`p-2 font-mono text-right ${(cycle.stockPLAtCurrent || 0) >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatInSelectedCurrency(cycle.stockPLAtCurrent || 0)}</td>
                                            <td className={`p-2 font-mono font-semibold text-right ${(cycle.ifCalledAwayPL || 0) >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatInSelectedCurrency(cycle.ifCalledAwayPL || 0)}</td>
                                            <td className={`p-2 font-mono font-semibold text-right ${(cycle.mtmWheelPL || 0) >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatInSelectedCurrency(cycle.mtmWheelPL || 0)}</td>
                                        </tr>
                                         {expandedPendingRow === i && (
                                            <tr className="bg-brand-card/30">
                                                <td colSpan={12} className="p-4">
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-brand-card p-4 rounded-md">
                                                        <div>
                                                            <h4 className="font-semibold text-brand-text-primary mb-2">{t('dashboard.wheel.details.costBasisTitle')}</h4>
                                                            <div className="text-sm space-y-1">
                                                                <p><strong>{t('dashboard.wheel.details.assignment')}:</strong> {t('dashboard.wheel.details.assignmentText', { shares: cycle.assignmentShares, price: formatCurrency(cycle.assignmentPrice, cycle.currency) })}</p>
                                                                <p><strong>{t('dashboard.wheel.details.grossCostBasis')}:</strong> {formatInSelectedCurrency(cycle.assignmentCost)}</p>
                                                                <p className={(cycle.realizedPutPL || 0) >= 0 ? 'text-brand-success' : 'text-brand-danger'}><strong>{t('dashboard.wheel.details.realizedPutPL')}:</strong> {formatInSelectedCurrency(cycle.realizedPutPL || 0)}</p>
                                                                <p className="font-semibold border-t border-brand-surface pt-1 mt-1"><strong>{t('dashboard.wheel.details.netCostBasis')}:</strong> {formatInSelectedCurrency(cycle.netAssignmentCost)}</p>
                                                                <p><strong>{t('dashboard.wheel.details.lastClose')}:</strong> {formatCurrency(derived.lastClosePrice, cycle.currency)}</p>
                                                                <p><strong>{t('dashboard.wheel.details.costBasisPerShare')}:</strong> {formatCurrency(derived.costBasisPerShare, cycle.currency)}</p>
                                                                {cycle.coveredCallStrike && <p><strong>{t('dashboard.wheel.details.coveredCallStrike')}:</strong> {formatCurrency(cycle.coveredCallStrike, cycle.currency)} ({cycle.coveredCallShares || 0} {t('dashboard.wheel.details.coveredShares')})</p>}
                                                                <p className={(cycle.realizedCallPL || 0) >= 0 ? 'text-brand-success' : 'text-brand-danger'}><strong>{t('dashboard.wheel.details.realizedCallPL')}:</strong> {formatInSelectedCurrency(cycle.realizedCallPL || 0)}</p>
                                                                <p><strong>{t('dashboard.wheel.details.openPutCredit')}:</strong> {formatInSelectedCurrency(cycle.openPutCredit || 0)}</p>
                                                                <p><strong>{t('dashboard.wheel.details.openCallCredit')}:</strong> {formatInSelectedCurrency(cycle.openCallCredit || 0)}</p>
                                                                <p><strong>{t('dashboard.wheel.details.stockPLAtCurrent')}:</strong> {formatInSelectedCurrency(cycle.stockPLAtCurrent || 0)}</p>
                                                                <p><strong>{t('dashboard.wheel.details.ifCalledAwayPL')}:</strong> {formatInSelectedCurrency(cycle.ifCalledAwayPL || 0)}</p>
                                                                <p><strong>{t('dashboard.wheel.details.mtmWheelPL')}:</strong> {formatInSelectedCurrency(cycle.mtmWheelPL || 0)}</p>
                                                                {(cycle.otherIncome || 0) !== 0 && <p className="text-brand-success"><strong>{t('dashboard.wheel.details.otherIncome')}:</strong> {formatInSelectedCurrency(cycle.otherIncome || 0)}</p>}
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <h4 className="font-semibold text-brand-text-primary mb-2">{t('dashboard.wheel.details.tradeLogTitle')}</h4>
                                                            <table className="w-full text-xs mt-2">
                                                                <thead>
                                                                    <tr className="border-b border-brand-bg">
                                                                        {logHeader('date', t('dashboard.wheel.details.log.date'))}
                                                                        {logHeader('description', t('dashboard.wheel.details.log.description'))}
                                                                        {logHeader('amount', t('dashboard.wheel.details.log.amount'), true)}
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {sortedTradeLog(cycle.tradeLog).map((log, j) => (
                                                                        <tr key={j} className="border-b border-brand-surface/50 last:border-0">
                                                                            <td className="p-1 font-mono">{log.date}</td>
                                                                            <td className="p-1">{log.description}</td>
                                                                            <td className={`p-1 font-mono text-right ${log.amount >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>
                                                                                {formatInSelectedCurrency(log.amount)}
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                            {(cycle.openPutLog || []).length > 0 && (
                                                                <div className="mt-4">
                                                                    <h4 className="font-semibold text-brand-text-primary mb-2">{t('dashboard.wheel.details.openPutsTitle')}</h4>
                                                                    <table className="w-full text-xs mt-2">
                                                                        <thead>
                                                                            <tr className="border-b border-brand-bg">
                                                                                {logHeader('date', t('dashboard.wheel.details.log.date'))}
                                                                                {logHeader('description', t('dashboard.wheel.details.log.description'))}
                                                                                {logHeader('amount', t('dashboard.wheel.details.log.amount'), true)}
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {sortedTradeLog(cycle.openPutLog || []).map((log, j) => (
                                                                                <tr key={j} className="border-b border-brand-surface/50 last:border-0">
                                                                                    <td className="p-1 font-mono">{log.date}</td>
                                                                                    <td className="p-1">{log.description}</td>
                                                                                    <td className={`p-1 font-mono text-right ${log.amount >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>
                                                                                        {formatInSelectedCurrency(log.amount)}
                                                                                    </td>
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                     </React.Fragment>;
                                })}
                            </tbody>
                            <tfoot>
                                <tr className="bg-brand-card/20 font-semibold">
                                    <td colSpan={5} className="p-2">{t('dashboard.openPositions.total')}</td>
                                    <td className={`p-2 font-mono text-right ${pendingTotals.realizedPutPL >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatInSelectedCurrency(pendingTotals.realizedPutPL)}</td>
                                    <td className={`p-2 font-mono text-right ${pendingTotals.realizedCallPL >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatInSelectedCurrency(pendingTotals.realizedCallPL)}</td>
                                    <td className={`p-2 font-mono text-right ${pendingTotals.openPutCredit >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatInSelectedCurrency(pendingTotals.openPutCredit)}</td>
                                    <td className={`p-2 font-mono text-right ${pendingTotals.openCallCredit >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatInSelectedCurrency(pendingTotals.openCallCredit)}</td>
                                    <td className={`p-2 font-mono text-right ${pendingTotals.stockPLAtCurrent >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatInSelectedCurrency(pendingTotals.stockPLAtCurrent)}</td>
                                    <td className={`p-2 font-mono text-right font-semibold ${pendingTotals.ifCalledAwayPL >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatInSelectedCurrency(pendingTotals.ifCalledAwayPL)}</td>
                                    <td className={`p-2 font-mono text-right font-semibold ${pendingTotals.mtmWheelPL >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatInSelectedCurrency(pendingTotals.mtmWheelPL)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}
            
            {sortedCompletedCycles.length > 0 && (
                <div>
                    <h4 className="text-lg font-semibold mb-2 text-brand-text-secondary">{t('dashboard.wheel.completed.title')}</h4>
                    <div className="pt-4">
                        <table className="w-full table-fixed text-left text-xs lg:text-sm">
                            <thead>
                                <tr className="border-b border-brand-card">
                                    <SortableHeader sortKey="symbol" headerKey="dashboard.wheel.completed.headers.symbol" align="left" />
                                    <SortableHeader sortKey="startDate" headerKey="dashboard.wheel.completed.headers.startDate" align="left" />
                                    <SortableHeader sortKey="endDate" headerKey='dashboard.wheel.completed.headers.endDate' tooltipKey='dashboard.wheel.completed.tooltips.endDate' />
                                    <SortableHeader sortKey="durationDays" headerKey='dashboard.wheel.completed.headers.duration' tooltipKey='dashboard.wheel.completed.tooltips.duration' />
                                    <SortableHeader sortKey="initialPutPremium" headerKey="dashboard.wheel.completed.headers.putPremium" />
                                    <SortableHeader sortKey="totalCallPremium" headerKey="dashboard.wheel.completed.headers.callPremium" />
                                    <SortableHeader sortKey="stockPL" headerKey="dashboard.wheel.completed.headers.stockPL" />
                                    <SortableHeader sortKey="totalPL" headerKey='dashboard.wheel.completed.headers.totalPL' tooltipKey='dashboard.wheel.completed.tooltips.totalPL' />
                                    <SortableHeader sortKey="returnOnCost" headerKey='dashboard.wheel.completed.headers.returnOnCost' tooltipKey='dashboard.wheel.completed.tooltips.returnOnCost' tooltipAlign="right" />
                                    <SortableHeader sortKey="annualizedReturn" headerKey='dashboard.wheel.completed.headers.annualizedReturn' tooltipKey='dashboard.wheel.completed.tooltips.annualizedReturn' tooltipAlign="right" />
                                </tr>
                            </thead>
                            <tbody>
                                {sortedCompletedCycles.map((cycle, i) => (
                                    <React.Fragment key={`completed-${cycle.symbol}-${i}`}>
                                        <tr className="border-b border-brand-card last:border-b-0 hover:bg-brand-card/50 cursor-pointer" onClick={() => handleCompletedRowClick(i)}>
                                            <td className="p-2 font-mono truncate">
                                                <div className="flex items-center">
                                                    {expandedCompletedRow === i ? <ChevronUpIcon className="w-4 h-4 mr-2"/> : <ChevronDownIcon className="w-4 h-4 mr-2"/>}
                                                    {cycle.symbol}
                                                </div>
                                            </td>
                                            <td className="p-2 font-mono truncate">{cycle.startDate}</td>
                                            <td className="p-2 font-mono text-right">{cycle.endDate}</td>
                                            <td className="p-2 font-mono text-right">{cycle.durationDays}</td>
                                            <td className={`p-2 font-mono text-right ${cycle.initialPutPremium >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatInSelectedCurrency(cycle.initialPutPremium)}</td>
                                            <td className={`p-2 font-mono text-right ${cycle.totalCallPremium >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatInSelectedCurrency(cycle.totalCallPremium)}</td>
                                            <td className={`p-2 font-mono text-right ${cycle.stockPL >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>
                                                {formatInSelectedCurrency(cycle.stockPL)}
                                            </td>
                                            <td className={`p-2 font-mono font-semibold text-right ${cycle.totalPL >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>
                                                {formatInSelectedCurrency(cycle.totalPL)}
                                            </td>
                                            <td className={`p-2 font-mono font-semibold text-right ${cycle.returnOnCost >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>
                                                {cycle.returnOnCost.toLocaleString(locale, { style: 'percent', minimumFractionDigits: 2 })}
                                            </td>
                                            <td className={`p-2 font-mono font-semibold text-right ${cycle.annualizedReturn >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>
                                                {cycle.annualizedReturn.toLocaleString(locale, { style: 'percent', minimumFractionDigits: 2 })}
                                            </td>
                                        </tr>
                                        {expandedCompletedRow === i && (
                                            <tr className="bg-brand-card/30">
                                                <td colSpan={10} className="p-4">
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-brand-card p-4 rounded-md">
                                                        <div>
                                                            <h4 className="font-semibold text-brand-text-primary mb-2">{t('dashboard.wheel.details.costBasisPLTitle')}</h4>
                                                            <div className="text-sm space-y-1">
                                                                <p><strong>{t('dashboard.wheel.details.assignment')}:</strong> {t('dashboard.wheel.details.assignmentText', { shares: cycle.assignmentShares, price: formatCurrency(cycle.assignmentPrice, cycle.currency) })}</p>
                                                                <p><strong>{t('dashboard.wheel.details.grossCostBasis')}:</strong> {formatInSelectedCurrency(cycle.assignmentCost)}</p>
                                                                <p className={cycle.initialPutPremium >= 0 ? 'text-brand-success' : 'text-brand-danger'}><strong>{t('dashboard.wheel.details.netPutPremium')}:</strong> {formatInSelectedCurrency(cycle.initialPutPremium)}</p>
                                                                <p className="font-semibold border-t border-brand-surface pt-1 mt-1"><strong>{t('dashboard.wheel.details.netCostBasis')}:</strong> {formatInSelectedCurrency(cycle.netAssignmentCost)}</p>
                                                                <hr className="border-brand-surface my-2" />
                                                                <p><strong>{t('dashboard.wheel.details.sale')}:</strong> {t('dashboard.wheel.details.saleText', { shares: cycle.assignmentShares, price: formatCurrency(cycle.salePrice, cycle.currency) })}</p>
                                                                <p><strong>{t('dashboard.wheel.details.totalSaleProceeds')}:</strong> {formatInSelectedCurrency(cycle.saleProceeds)}</p>
                                                                <p className={`font-semibold ${cycle.stockPL >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}><strong>{t('dashboard.wheel.details.stockPLOnNet')}:</strong> {formatInSelectedCurrency(cycle.stockPL)}</p>
                                                                <p className={cycle.totalCallPremium >= 0 ? 'text-brand-success' : 'text-brand-danger'}><strong>{t('dashboard.wheel.details.netCallPremium')}:</strong> {formatInSelectedCurrency(cycle.totalCallPremium)}</p>
                                                                {(cycle.otherIncome || 0) !== 0 && <p className="text-brand-success"><strong>{t('dashboard.wheel.details.otherIncome')}:</strong> {formatInSelectedCurrency(cycle.otherIncome || 0)}</p>}
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <h4 className="font-semibold text-brand-text-primary mb-2">{t('dashboard.wheel.details.tradeLogTitle')}</h4>
                                                            <table className="w-full text-xs mt-2">
                                                                <thead>
                                                                    <tr className="border-b border-brand-bg">
                                                                        {logHeader('date', t('dashboard.wheel.details.log.date'))}
                                                                        {logHeader('description', t('dashboard.wheel.details.log.description'))}
                                                                        {logHeader('amount', t('dashboard.wheel.details.log.amount'), true)}
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {sortedTradeLog(cycle.tradeLog).map((log, j) => (
                                                                        <tr key={j} className="border-b border-brand-surface/50 last:border-0">
                                                                            <td className="p-1 font-mono">{log.date}</td>
                                                                            <td className="p-1">{log.description}</td>
                                                                            <td className={`p-1 font-mono text-right ${log.amount >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>
                                                                                {formatInSelectedCurrency(log.amount)}
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="bg-brand-card/20 font-semibold">
                                    <td colSpan={4} className="p-2">{t('dashboard.openPositions.total')}</td>
                                    <td className={`p-2 font-mono text-right ${completedTotals.putPremium >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatInSelectedCurrency(completedTotals.putPremium)}</td>
                                    <td className={`p-2 font-mono text-right ${completedTotals.callPremium >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatInSelectedCurrency(completedTotals.callPremium)}</td>
                                    <td className={`p-2 font-mono text-right ${completedTotals.stockPL >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>
                                        {formatInSelectedCurrency(completedTotals.stockPL)}
                                    </td>
                                    <td className={`p-2 font-mono font-semibold text-right ${completedTotals.totalPL >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>
                                        {formatInSelectedCurrency(completedTotals.totalPL)}
                                    </td>
                                    <td className="p-2"></td>
                                    <td className="p-2"></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WheelCycles;
