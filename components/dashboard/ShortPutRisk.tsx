
import React, { useCallback } from 'react';
import MetricCard from '../MetricCard';
import { WarningIcon, MoneyIcon, CheckCircleIcon, InfoIcon } from '../../constants';
import { useLocalization } from '../../context/LocalizationContext';
import { Position } from '../../types';
import Tooltip from '../Tooltip';
import SortableHeader from './SortableHeader';
import { useSortableRows } from './useSortableRows';

interface ShortfallDetails {
    headers: string[];
    rows: { [key: string]: string | number }[];
}

interface AssignmentRiskPosition extends Position {
    assignmentCost: number;
    dte?: number;
    moneyness?: number;
    breakevenPrice?: number;
    stockPrice?: number;
}

interface ShortPutRiskProps {
    cashBalance: number;
    likelyAssignmentValue: number;
    unlikelyAssignmentValue: number;

    likelyCashNeeded: number;
    unlikelyCashNeeded: number;
    likelyAssignments: AssignmentRiskPosition[];
    likelyShortfallDetails: ShortfallDetails;
    unlikelyShortfallDetails: ShortfallDetails;
    formatInSelectedCurrency: (value: number) => string;
    formatCurrency: (value: number, currency: string) => string;
}

const ShortPutRisk: React.FC<ShortPutRiskProps> = ({
    cashBalance,
    likelyAssignmentValue,
    unlikelyAssignmentValue,
    likelyCashNeeded,
    unlikelyCashNeeded,
    likelyAssignments = [],
    likelyShortfallDetails,
    unlikelyShortfallDetails,
    formatInSelectedCurrency,
    formatCurrency
}) => {
    const { t } = useLocalization();
    type SortKey = 'expiry' | 'symbol' | 'quantity' | 'strikePrice' | 'breakevenPrice' | 'stockPrice' | 'dte' | 'collectedPremium' | 'unrealizedPL' | 'assignmentCost';
    const sortValue = useCallback((row: AssignmentRiskPosition, key: SortKey) => row[key], []);
    const { sortedRows: sortedLikelyAssignments, sort, requestSort } = useSortableRows(likelyAssignments, 'expiry' as SortKey, sortValue);
    const header = (key: SortKey, label: React.ReactNode, right = true) => <SortableHeader column={key} activeColumn={sort.key} direction={sort.direction} onSort={requestSort} align={right ? 'right' : 'left'}>{label}</SortableHeader>;

    return (
    <div className="bg-brand-surface rounded-lg shadow-lg p-6 mb-8">
        <h2 className="text-2xl font-bold mb-4">{t('dashboard.putRisk.title')}</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            
            <div className="flex flex-col justify-center h-full">
              <MetricCard
                  title={t('dashboard.putRisk.cashBalance.title')}
                  value={formatInSelectedCurrency(cashBalance)}
                  icon={<MoneyIcon />}
                  description={t('dashboard.putRisk.cashBalance.description')}
              />
            </div>

            <div className="bg-brand-card/30 p-4 rounded-lg space-y-4 border-2 border-brand-danger/30">
                <h3 className="text-lg font-semibold text-brand-danger flex items-center">
                    <WarningIcon className="mr-2" />
                    {t('dashboard.putRisk.likelyRisk.title')}
                </h3>
                <MetricCard
                    title={t('dashboard.putRisk.likelyRisk.assignmentValue.title')}
                    value={formatInSelectedCurrency(likelyAssignmentValue)}
                    icon={<InfoIcon />}
                    description={t('dashboard.putRisk.likelyRisk.assignmentValue.description')}
                    details={likelyShortfallDetails}
                    tooltip={t('dashboard.putRisk.likelyRisk.assignmentValue.tooltip')}
                />
                <MetricCard
                    title={t('dashboard.putRisk.likelyRisk.cashShortfall.title')}
                    value={formatInSelectedCurrency(likelyCashNeeded)}
                    icon={likelyCashNeeded > 0 ? <WarningIcon /> : <CheckCircleIcon />}
                    isPositive={likelyCashNeeded <= 0}
                    description={t('dashboard.putRisk.likelyRisk.cashShortfall.description')}
                    tooltip={t('dashboard.putRisk.likelyRisk.cashShortfall.tooltip')}
                />
            </div>

            <div className="bg-brand-card/30 p-4 rounded-lg space-y-4 border-2 border-brand-accent/30">
                <h3 className="text-lg font-semibold text-brand-accent flex items-center">
                    <CheckCircleIcon className="mr-2" />
                    {t('dashboard.putRisk.unlikelyRisk.title')}
                </h3>
                <MetricCard
                    title={t('dashboard.putRisk.unlikelyRisk.assignmentValue.title')}
                    value={formatInSelectedCurrency(unlikelyAssignmentValue)}
                    icon={<InfoIcon />}
                    description={t('dashboard.putRisk.unlikelyRisk.assignmentValue.description')}
                    details={unlikelyShortfallDetails}
                    tooltip={t('dashboard.putRisk.unlikelyRisk.assignmentValue.tooltip')}
                />
                <MetricCard
                    title={t('dashboard.putRisk.unlikelyRisk.additionalShortfall.title')}
                    value={formatInSelectedCurrency(unlikelyCashNeeded)}
                    icon={unlikelyCashNeeded > 0 ? <WarningIcon /> : <CheckCircleIcon />}
                    isPositive={unlikelyCashNeeded <= 0}
                    description={t('dashboard.putRisk.unlikelyRisk.additionalShortfall.description')}
                    tooltip={t('dashboard.putRisk.unlikelyRisk.additionalShortfall.tooltip')}
                />
            </div>
        </div>
        {sortedLikelyAssignments.length > 0 && (
            <div className="mt-8 border-t border-brand-card pt-6">
                <h3 className="text-lg font-semibold mb-2 text-brand-danger flex items-center">
                    <WarningIcon className="mr-2" />
                    {t('dashboard.putRisk.atRiskPositions.title')}
                </h3>
                <div className="overflow-x-auto pt-6 px-6">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="border-b border-brand-card">
                                {header('expiry', t('dashboard.putRisk.atRiskPositions.assignmentDate'), false)}
                                {header('symbol', t('dashboard.openPositions.puts.symbol'), false)}
                                {header('quantity', t('dashboard.openPositions.puts.qty'))}
                                {header('strikePrice', t('dashboard.openPositions.puts.strike'))}
                                {header('breakevenPrice',
                                    <Tooltip content={t('dashboard.openPositions.puts.breakevenTooltip')}>
                                        <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t('dashboard.openPositions.puts.breakeven')}</span>
                                    </Tooltip>)}
                                {header('stockPrice',
                                    <Tooltip content={t('dashboard.putRisk.atRiskPositions.currentPriceTooltip')}>
                                        <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t('dashboard.putRisk.atRiskPositions.currentPrice')}</span>
                                    </Tooltip>)}
                                {header('dte',
                                    <Tooltip content={t('dashboard.openPositions.puts.dteTooltip')}>
                                        <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t('dashboard.openPositions.puts.dte')}</span>
                                    </Tooltip>)}
                                {header('collectedPremium',
                                    <Tooltip content={t('dashboard.openPositions.puts.premiumTooltip')}>
                                        <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t('dashboard.openPositions.puts.premium')}</span>
                                    </Tooltip>)}
                                {header('unrealizedPL', t('dashboard.openPositions.puts.unrealizedPL'))}
                                {header('assignmentCost',
                                    <Tooltip align="right" content={t('dashboard.openPositions.puts.assignmentCostTooltip')}>
                                        <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t('dashboard.openPositions.puts.assignmentCost')}</span>
                                    </Tooltip>)}
                            </tr>
                        </thead>
                        <tbody>
                            {sortedLikelyAssignments.map((p, i) => (
                                    <tr key={`${p.symbol}-${p.expiry || 'unknown'}-${i}`} className="border-b border-brand-card hover:bg-brand-card/50">
                                        <td className="p-2 font-mono">{p.expiry || t('dashboard.putRisk.atRiskPositions.unknownDate')}</td>
                                        <td className="p-2 font-mono">{p.symbol}</td>
                                        <td className="p-2 font-mono text-right">{p.quantity}</td>
                                        <td className="p-2 font-mono text-right">{p.strikePrice !== undefined ? formatCurrency(p.strikePrice, p.currency) : '-'}</td>
                                        <td className="p-2 font-mono text-right">
                                            {p.breakevenPrice !== undefined ? formatCurrency(p.breakevenPrice, p.currency) : '-'}
                                        </td>
                                        <td className={`p-2 font-mono text-right ${p.stockPrice !== undefined && p.breakevenPrice !== undefined && p.stockPrice < p.breakevenPrice ? 'text-brand-danger' : ''}`}>
                                            {p.stockPrice !== undefined ? formatCurrency(p.stockPrice, p.currency) : '-'}
                                        </td>
                                        <td className="p-2 font-mono text-right">{p.dte ?? '-'}</td>
                                        <td className="p-2 font-mono text-right">{formatInSelectedCurrency(p.collectedPremium || 0)}</td>
                                        <td className={`p-2 font-mono text-right ${p.unrealizedPL >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>
                                            {formatInSelectedCurrency(p.unrealizedPL)}
                                        </td>
                                        <td className="p-2 font-mono text-right">{formatInSelectedCurrency(p.assignmentCost)}</td>
                                    </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="bg-brand-card/20 font-semibold">
                                <td colSpan={7} className="p-2">{t('dashboard.openPositions.total')}</td>
                                <td className="p-2 font-mono text-right">
                                    {formatInSelectedCurrency(sortedLikelyAssignments.reduce((sum, p) => sum + (p.collectedPremium || 0), 0))}
                                </td>
                                <td className={`p-2 font-mono text-right ${sortedLikelyAssignments.reduce((sum, p) => sum + p.unrealizedPL, 0) >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>
                                    {formatInSelectedCurrency(sortedLikelyAssignments.reduce((sum, p) => sum + p.unrealizedPL, 0))}
                                </td>
                                <td className="p-2 font-mono text-right">{formatInSelectedCurrency(likelyAssignmentValue)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        )}
    </div>
)};

export default ShortPutRisk;
