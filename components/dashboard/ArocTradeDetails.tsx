import React, { useMemo, useState } from 'react';
import { ArocAnalysis } from '../../types';
import { useLocalization } from '../../context/LocalizationContext';
import SortableHeader, { compareSortValues, SortDirection } from './SortableHeader';

interface ArocTradeDetailsProps {
    analysis: ArocAnalysis;
    formatInSelectedCurrency: (value: number) => string;
}

type SortKey = 'symbol' | 'daysOpen' | 'premiumCollected' | 'capitalAtRisk' | 'aroc';

const ArocTradeDetails: React.FC<ArocTradeDetailsProps> = ({ analysis, formatInSelectedCurrency }) => {
    const { t, locale } = useLocalization();
    const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'aroc', direction: 'desc' });
    const rows = useMemo(() => [...analysis.trades].sort((a, b) => {
        const result = compareSortValues(a[sort.key], b[sort.key]);
        return sort.direction === 'asc' ? result : -result;
    }), [analysis.trades, sort]);
    const requestSort = (key: SortKey) => setSort(current => ({
        key,
        direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }));

    if (!rows.length) return null;

    return (
        <section className="bg-brand-surface rounded-lg shadow-lg p-6 mb-8">
            <h2 className="text-2xl font-bold mb-1">{t('dashboard.arocDetails.title')}</h2>
            <p className="text-sm text-brand-text-secondary mb-4">{t('dashboard.arocDetails.description')}</p>
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead><tr className="border-b border-brand-card">
                        <SortableHeader column="symbol" activeColumn={sort.key} direction={sort.direction} onSort={requestSort}>{t('dynamicHeaders.symbol')}</SortableHeader>
                        <SortableHeader column="daysOpen" activeColumn={sort.key} direction={sort.direction} onSort={requestSort} align="right">{t('dynamicHeaders.daysOpen')}</SortableHeader>
                        <SortableHeader column="premiumCollected" activeColumn={sort.key} direction={sort.direction} onSort={requestSort} align="right">{t('dynamicHeaders.premium')}</SortableHeader>
                        <SortableHeader column="capitalAtRisk" activeColumn={sort.key} direction={sort.direction} onSort={requestSort} align="right">{t('dashboard.arocDetails.capitalAtRisk')}</SortableHeader>
                        <SortableHeader column="aroc" activeColumn={sort.key} direction={sort.direction} onSort={requestSort} align="right">{t('dynamicHeaders.aroc')}</SortableHeader>
                    </tr></thead>
                    <tbody>{rows.map((trade, index) => (
                        <tr key={`${trade.symbol}-${index}`} className="border-b border-brand-card last:border-b-0 hover:bg-brand-card/50">
                            <td className="p-2 font-mono">{trade.symbol}</td>
                            <td className="p-2 font-mono text-right">{trade.daysOpen}</td>
                            <td className="p-2 font-mono text-right">{formatInSelectedCurrency(trade.premiumCollected)}</td>
                            <td className="p-2 font-mono text-right">{formatInSelectedCurrency(trade.capitalAtRisk)}</td>
                            <td className={`p-2 font-mono text-right ${trade.aroc >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{trade.aroc.toLocaleString(locale, { style: 'percent', minimumFractionDigits: 2 })}</td>
                        </tr>
                    ))}</tbody>
                </table>
            </div>
        </section>
    );
};

export default ArocTradeDetails;
