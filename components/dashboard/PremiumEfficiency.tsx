import React, { useCallback } from 'react';
import { PremiumEfficiencyRow } from '../../types';
import { useLocalization } from '../../context/LocalizationContext';
import SortableHeader from './SortableHeader';
import { useSortableRows } from './useSortableRows';

interface Props { data: PremiumEfficiencyRow[]; formatCurrency: (value: number) => string; }
type Key = keyof PremiumEfficiencyRow;

const PremiumEfficiency: React.FC<Props> = ({ data, formatCurrency }) => {
    const { t, locale } = useLocalization();
    const valueFor = useCallback((row: PremiumEfficiencyRow, key: Key) => row[key], []);
    const { sortedRows, sort, requestSort } = useSortableRows(data, 'premiumCollected' as Key, valueFor, 'desc');
    if (!data.length) return null;
    const header = (key: Key, label: string, right = true) => <SortableHeader column={key} activeColumn={sort.key} direction={sort.direction} onSort={requestSort} align={right ? 'right' : 'left'}>{label}</SortableHeader>;
    return (
        <section className="bg-brand-surface rounded-lg shadow-lg p-6 mb-8">
            <h2 className="text-2xl font-bold mb-1">{t('dashboard.premiumEfficiency.title')}</h2>
            <p className="text-sm text-brand-text-secondary mb-4">{t('dashboard.premiumEfficiency.description')}</p>
            <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left">
                <thead><tr className="border-b border-brand-card">{header('symbol', t('dashboard.premiumEfficiency.symbol'), false)}{header('premiumCollected', t('dashboard.premiumEfficiency.premium'))}{header('realizedPL', t('dashboard.premiumEfficiency.realized'))}{header('commissions', t('dashboard.premiumEfficiency.commissions'))}{header('putCapital', t('dashboard.premiumEfficiency.putCapital'))}{header('premiumYield', t('dashboard.premiumEfficiency.premiumYield'))}{header('realizedReturn', t('dashboard.premiumEfficiency.realizedReturn'))}{header('averageDaysOpen', t('dashboard.premiumEfficiency.avgDays'))}{header('trades', t('dashboard.premiumEfficiency.trades'))}</tr></thead>
                <tbody>{sortedRows.map(row => <tr key={row.symbol} className="border-b border-brand-card last:border-0 hover:bg-brand-card/50"><td className="p-2 font-mono">{row.symbol}</td><td className="p-2 text-right font-mono text-brand-success">{formatCurrency(row.premiumCollected)}</td><td className={`p-2 text-right font-mono ${row.realizedPL >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatCurrency(row.realizedPL)}</td><td className="p-2 text-right font-mono">{formatCurrency(row.commissions)}</td><td className="p-2 text-right font-mono">{row.putCapital ? formatCurrency(row.putCapital) : '-'}</td><td className="p-2 text-right font-mono">{row.putCapital ? row.premiumYield.toLocaleString(locale, { style: 'percent', minimumFractionDigits: 2 }) : '-'}</td><td className={`p-2 text-right font-mono ${row.realizedReturn >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{row.putCapital ? row.realizedReturn.toLocaleString(locale, { style: 'percent', minimumFractionDigits: 2 }) : '-'}</td><td className="p-2 text-right font-mono">{row.averageDaysOpen ? row.averageDaysOpen.toFixed(1) : '-'}</td><td className="p-2 text-right font-mono">{row.trades}</td></tr>)}</tbody>
            </table></div>
        </section>
    );
};
export default PremiumEfficiency;
