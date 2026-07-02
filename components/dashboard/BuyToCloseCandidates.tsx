import React, { useCallback, useMemo } from 'react';
import { Position } from '../../types';
import { useLocalization } from '../../context/LocalizationContext';
import SortableHeader from './SortableHeader';
import { useSortableRows } from './useSortableRows';
import { DEFAULT_DASHBOARD_THRESHOLDS } from '../../constants';

interface ShortPutPosition extends Position {
    dte?: number;
    breakevenPrice?: number;
    stockPrice?: number;
    moneyness?: number;
}

interface Props {
    puts: ShortPutPosition[];
    formatInSelectedCurrency: (value: number) => string;
    formatCurrency: (value: number, currency: string) => string;
    captureThreshold?: number;
    urgentDte?: number;
}

type Candidate = ShortPutPosition & {
    premium: number;
    closeCost: number;
    capturedProfit: number;
    capture: number;
};
type SortKey = 'symbol' | 'dte' | 'strikePrice' | 'stockPrice' | 'breakevenPrice' | 'premium' | 'closeCost' | 'capturedProfit' | 'capture';

const BuyToCloseCandidates: React.FC<Props> = ({ puts, formatInSelectedCurrency, formatCurrency, captureThreshold = DEFAULT_DASHBOARD_THRESHOLDS.capture, urgentDte = DEFAULT_DASHBOARD_THRESHOLDS.urgentDte }) => {
    const { t, locale } = useLocalization();
    const candidates = useMemo(() => puts.map(position => {
        const premium = position.collectedPremium || 0;
        const closeCost = Math.abs(position.value);
        const capturedProfit = premium - closeCost;
        const capture = premium > 0 ? capturedProfit / premium : 0;
        const dte = position.dte ?? Infinity;
        const isOtm = (position.moneyness ?? 1) >= 0;
        const letExpireOtm = isOtm
            && dte <= urgentDte
            && capture >= captureThreshold
            && closeCost <= Math.max(5, premium * 0.05);
        return { ...position, premium, closeCost, capturedProfit, capture, letExpireOtm };
    }).filter(position => position.premium > 0 && position.capture >= captureThreshold && !position.letExpireOtm), [puts, captureThreshold, urgentDte]);
    const valueFor = useCallback((row: Candidate, key: SortKey) => row[key], []);
    const { sortedRows, sort, requestSort } = useSortableRows(candidates, 'capture' as SortKey, valueFor, 'desc');

    if (!candidates.length) return null;
    const header = (key: SortKey, label: string, right = true) => <SortableHeader column={key} activeColumn={sort.key} direction={sort.direction} onSort={requestSort} align={right ? 'right' : 'left'}>{label}</SortableHeader>;

    return (
        <section className="bg-brand-surface rounded-lg shadow-lg p-6 mb-8">
            <h2 className="text-2xl font-bold mb-1">{t('dashboard.buyToClose.title')}</h2>
            <p className="text-sm text-brand-text-secondary mb-4">{t('dashboard.buyToClose.description', { threshold: `${captureThreshold * 100}%` })}</p>
            <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left">
                <thead><tr className="border-b border-brand-card">
                    {header('symbol', t('dashboard.buyToClose.contract'), false)}
                    {header('dte', 'DTE')}
                    {header('strikePrice', t('dashboard.buyToClose.strike'))}
                    {header('stockPrice', t('dashboard.buyToClose.underlying'))}
                    {header('breakevenPrice', t('dashboard.buyToClose.breakeven'))}
                    {header('premium', t('dashboard.buyToClose.premium'))}
                    {header('closeCost', t('dashboard.buyToClose.closeCost'))}
                    {header('capturedProfit', t('dashboard.buyToClose.capturedProfit'))}
                    {header('capture', t('dashboard.buyToClose.capture'))}
                </tr></thead>
                <tbody>{sortedRows.map(position => (
                    <tr key={position.symbol} className="border-b border-brand-card last:border-0 hover:bg-brand-card/50">
                        <td className="p-2 font-mono">{position.symbol}</td>
                        <td className="p-2 text-right font-mono">{position.dte ?? '-'}</td>
                        <td className="p-2 text-right font-mono">{position.strikePrice !== undefined ? formatCurrency(position.strikePrice, position.currency) : '-'}</td>
                        <td className="p-2 text-right font-mono">{position.stockPrice !== undefined ? formatCurrency(position.stockPrice, position.currency) : '-'}</td>
                        <td className="p-2 text-right font-mono">{position.breakevenPrice !== undefined ? formatCurrency(position.breakevenPrice, position.currency) : '-'}</td>
                        <td className="p-2 text-right font-mono">{formatInSelectedCurrency(position.premium)}</td>
                        <td className="p-2 text-right font-mono">{formatInSelectedCurrency(position.closeCost)}</td>
                        <td className="p-2 text-right font-mono text-brand-success">{formatInSelectedCurrency(position.capturedProfit)}</td>
                        <td className="p-2 text-right font-mono font-semibold text-brand-success">{position.capture.toLocaleString(locale, { style: 'percent', minimumFractionDigits: 1 })}</td>
                    </tr>
                ))}</tbody>
            </table></div>
        </section>
    );
};

export default BuyToCloseCandidates;
