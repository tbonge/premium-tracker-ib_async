import React, { useMemo, useState } from 'react';
import { PendingWheelCycle, Position } from '../../types';
import { useLocalization } from '../../context/LocalizationContext';
import SortableHeader, { compareSortValues, SortDirection } from './SortableHeader';
import { AlertTriangleIcon, CheckCircleIcon, DEFAULT_OPTION_MULTIPLIER, InfoIcon } from '../../constants';

interface AssignedPutPositionsProps {
    cycles: PendingWheelCycle[];
    positions: Position[];
    exchangeRates: Record<string, number>;
    formatInSelectedCurrency: (value: number) => string;
    formatCurrency: (value: number, currency: string) => string;
}

type CoverageStatus = 'fully-covered' | 'partially-covered' | 'needs-call' | 'odd-lot-only';
type SortKey = 'symbol' | 'startDate' | 'assignmentShares' | 'assignmentPrice' | 'basisAfterPutPremium' | 'wheelBreakevenAfterCalls' | 'currentPrice' | 'daysHeld' | 'openCallStrike' | 'coverageStatus' | 'minimumCallStrike' | 'targetCallStrike' | 'totalCallPremium' | 'currentTotalPL';

const AssignedPutPositions: React.FC<AssignedPutPositionsProps> = ({ cycles, positions, exchangeRates, formatInSelectedCurrency, formatCurrency }) => {
    const { t } = useLocalization();
    const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'startDate', direction: 'desc' });
    const rows = useMemo(() => cycles.map(cycle => {
        const openCalls = positions.filter(position => position.isOption && position.optionType === 'C' && position.quantity < 0 && position.baseSymbol === cycle.symbol);
        const coveredShares = openCalls.reduce((sum, position) => sum + Math.abs(position.quantity) * (position.multiplier || DEFAULT_OPTION_MULTIPLIER), 0);
        const openCallContracts = openCalls.reduce((sum, position) => sum + Math.abs(position.quantity), 0);
        const openCallStrike = openCallContracts
            ? openCalls.reduce((sum, position) => sum + (position.strikePrice || 0) * Math.abs(position.quantity), 0) / openCallContracts
            : 0;
        const hasMultipleCallStrikes = new Set(openCalls.map(position => position.strikePrice || 0)).size > 1;
        const stockPosition = positions.find(position => !position.isOption && position.symbol === cycle.symbol);
        const rate = exchangeRates[cycle.currency] || 1;
        const currentPrice = stockPosition?.closePrice || (cycle.assignmentShares ? cycle.currentStockValue / rate / cycle.assignmentShares : 0);
        const basisAfterPutPremium = cycle.assignmentShares
            ? cycle.netAssignmentCost / rate / cycle.assignmentShares
            : 0;
        const wheelBreakevenAfterCalls = cycle.assignmentShares
            ? (cycle.netAssignmentCost - cycle.totalCallPremium) / rate / cycle.assignmentShares
            : 0;
        const start = new Date(`${cycle.startDate}T00:00:00`).getTime();
        const daysHeld = Number.isFinite(start) ? Math.max(0, Math.floor((Date.now() - start) / 86400000)) : 0;
        const availableShares = Math.max(0, cycle.assignmentShares - coveredShares);
        const coverageRatio = cycle.assignmentShares > 0 ? coveredShares / cycle.assignmentShares : 0;
        const roundLotUncoveredShares = Math.floor(availableShares / 100) * 100;
        const coverageStatus: CoverageStatus = availableShares <= 0
            ? 'fully-covered'
            : roundLotUncoveredShares >= 100 ? 'needs-call'
                : coveredShares > 0 ? 'partially-covered' : 'odd-lot-only';
        const minimumCallStrike = Math.max(cycle.assignmentPrice, wheelBreakevenAfterCalls);
        const targetCallStrike = Math.max(minimumCallStrike, currentPrice * 1.05);
        return {
            ...cycle,
            currentPrice,
            basisAfterPutPremium,
            wheelBreakevenAfterCalls,
            daysHeld,
            availableShares,
            roundLotUncoveredShares,
            coverageRatio,
            minimumCallStrike,
            targetCallStrike,
            openCallStrike,
            hasMultipleCallStrikes,
            coverageStatus,
        };
    }).sort((a, b) => {
        const result = compareSortValues(a[sort.key], b[sort.key]);
        return sort.direction === 'asc' ? result : -result;
    }), [cycles, positions, exchangeRates, sort]);
    const requestSort = (key: SortKey) => setSort(current => ({ key, direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc' }));

    if (!rows.length) return null;

    const header = (key: SortKey, label: string, right = true) => (
        <SortableHeader column={key} activeColumn={sort.key} direction={sort.direction} onSort={requestSort} align={right ? 'right' : 'left'}>{label}</SortableHeader>
    );

    return (
        <section className="bg-brand-surface rounded-lg shadow-lg p-6 mb-8">
            <h2 className="text-2xl font-bold mb-1">{t('dashboard.assignedPuts.title')}</h2>
            <p className="text-sm text-brand-text-secondary mb-4">{t('dashboard.assignedPuts.description')}</p>
            <div>
                <table className="w-full table-fixed text-left text-xs lg:text-sm">
                    <thead><tr className="border-b border-brand-card">
                        {header('symbol', t('dashboard.assignedPuts.symbol'), false)}
                        {header('coverageStatus', t('dashboard.assignedPuts.status'), false)}
                        {header('startDate', t('dashboard.assignedPuts.assigned'), false)}
                        {header('assignmentShares', t('dashboard.assignedPuts.shareCoverage'))}
                        {header('openCallStrike', t('dashboard.assignedPuts.openCalls'))}
                        {header('assignmentPrice', t('dashboard.assignedPuts.assignmentPrice'))}
                        {header('basisAfterPutPremium', t('dashboard.assignedPuts.basisAfterPut'))}
                        {header('wheelBreakevenAfterCalls', t('dashboard.assignedPuts.wheelBreakeven'))}
                        {header('currentPrice', t('dashboard.assignedPuts.currentPrice'))}
                        {header('minimumCallStrike', t('dashboard.assignedPuts.minStrike'))}
                        {header('targetCallStrike', t('dashboard.assignedPuts.targetStrike'))}
                        {header('daysHeld', t('dashboard.assignedPuts.daysHeld'))}
                        {header('totalCallPremium', t('dashboard.assignedPuts.callPremium'))}
                        {header('currentTotalPL', t('dashboard.assignedPuts.totalPL'))}
                    </tr></thead>
                    <tbody>{rows.map((row, index) => (
                        <tr key={`${row.symbol}-${row.startDate}-${index}`} className="border-b border-brand-card last:border-b-0 hover:bg-brand-card/50">
                            <td className="p-2 font-mono truncate">{row.symbol}</td>
                            <td className={`p-2 font-semibold ${row.coverageStatus === 'fully-covered' ? 'text-brand-success' : row.coverageStatus === 'needs-call' ? 'text-brand-danger' : 'text-yellow-400'}`}>
                                <span className="inline-flex items-center gap-2">
                                    {row.coverageStatus === 'fully-covered'
                                        ? <CheckCircleIcon className="w-4 h-4" />
                                        : row.coverageStatus === 'needs-call' ? <AlertTriangleIcon className="w-4 h-4" /> : <InfoIcon className="w-4 h-4" />}
                                    {t(`dashboard.assignedPuts.coverageStatuses.${row.coverageStatus}`)}
                                </span>
                            </td>
                            <td className="p-2 font-mono truncate">{row.startDate}</td>
                            <td className="p-2 text-right">
                                <div className="font-mono">{row.assignmentShares}</div>
                                <div className={`text-[11px] ${row.availableShares >= 100 ? 'text-brand-danger' : 'text-brand-text-secondary'}`}>
                                    {row.availableShares} {t('dashboard.assignedPuts.uncoveredShort')} / {row.coverageRatio.toLocaleString(undefined, { style: 'percent', maximumFractionDigits: 0 })}
                                </div>
                            </td>
                            <td className="p-2">
                                {row.openCallStrike ? (
                                    <div className="font-mono text-right">
                                        {row.hasMultipleCallStrikes ? `${t('dashboard.assignedPuts.average')} ` : ''}
                                        {formatCurrency(row.openCallStrike, row.currency)}
                                    </div>
                                ) : <div className="text-right text-brand-text-secondary">-</div>}
                            </td>
                            <td className="p-2 font-mono text-right">{formatCurrency(row.assignmentPrice, row.currency)}</td>
                            <td className="p-2 font-mono text-right">{formatCurrency(row.basisAfterPutPremium, row.currency)}</td>
                            <td className="p-2 font-mono text-right">{formatCurrency(row.wheelBreakevenAfterCalls, row.currency)}</td>
                            <td className={`p-2 font-mono text-right ${row.currentPrice < row.wheelBreakevenAfterCalls ? 'text-brand-danger' : 'text-brand-success'}`}>{formatCurrency(row.currentPrice, row.currency)}</td>
                            <td className="p-2 font-mono text-right">{formatCurrency(row.minimumCallStrike, row.currency)}</td>
                            <td className="p-2 font-mono text-right">{formatCurrency(row.targetCallStrike, row.currency)}</td>
                            <td className="p-2 font-mono text-right">{row.daysHeld}</td><td className="p-2 font-mono text-right text-brand-success">{formatInSelectedCurrency(row.totalCallPremium)}</td>
                            <td className={`p-2 font-mono text-right ${row.currentTotalPL >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatInSelectedCurrency(row.currentTotalPL)}</td>
                        </tr>
                    ))}</tbody>
                </table>
            </div>
        </section>
    );
};

export default AssignedPutPositions;
