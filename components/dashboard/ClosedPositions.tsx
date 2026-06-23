
import React, { useCallback, useMemo, useState } from 'react';
import { ClosedPosition } from '../../types';
import { ChevronLeftIcon, ChevronRightIcon } from '../../constants';
import Tooltip from '../Tooltip';
import { useLocalization } from '../../context/LocalizationContext';
import SortableHeader from './SortableHeader';
import { useSortableRows } from './useSortableRows';

interface ClosedPositionsProps {
    closedPositions: ClosedPosition[];
    formatInSelectedCurrency: (value: number) => string;
}

const ITEMS_PER_PAGE = 10;

const ClosedPositions: React.FC<ClosedPositionsProps> = ({ closedPositions, formatInSelectedCurrency }) => {
    const { t, locale } = useLocalization();
    const [currentPage, setCurrentPage] = useState(1);
    
    type GroupedPosition = ClosedPosition & { underlying: string; closedRecords: number };
    type SortKey = 'assetCategory' | 'underlying' | 'closedRecords' | 'realizedPL' | 'daysOpen' | 'premiumCollected' | 'capitalAtRisk' | 'aroc';
    const groupedPositions = useMemo(() => {
        const groups = new Map<string, GroupedPosition & { weightedDays: number; weightedAroc: number; metricCount: number }>();
        closedPositions.forEach(position => {
            const underlying = position.assetCategory === 'Options' ? position.symbol.split(/\s+/)[0] : position.symbol;
            const key = `${position.assetCategory}|${underlying}`;
            const group = groups.get(key) || {
                ...position,
                symbol: underlying,
                underlying,
                closedRecords: 0,
                realizedPL: 0,
                premiumCollected: 0,
                capitalAtRisk: 0,
                daysOpen: undefined,
                aroc: undefined,
                weightedDays: 0,
                weightedAroc: 0,
                metricCount: 0,
            };
            group.closedRecords += 1;
            group.realizedPL += position.realizedPL;
            group.premiumCollected = (group.premiumCollected || 0) + (position.premiumCollected || 0);
            group.capitalAtRisk = (group.capitalAtRisk || 0) + (position.capitalAtRisk || 0);
            const count = position.arocTradeCount || (position.aroc !== undefined || position.daysOpen !== undefined ? 1 : 0);
            if (count) {
                group.weightedDays += (position.daysOpen || 0) * count;
                group.weightedAroc += (position.aroc || 0) * count;
                group.metricCount += count;
            }
            if (!group.closeDate || (position.closeDate && position.closeDate > group.closeDate)) group.closeDate = position.closeDate;
            groups.set(key, group);
        });
        return [...groups.values()].map(group => ({
            ...group,
            daysOpen: group.metricCount ? group.weightedDays / group.metricCount : undefined,
            aroc: group.metricCount ? group.weightedAroc / group.metricCount : undefined,
            premiumCollected: group.premiumCollected || undefined,
            capitalAtRisk: group.capitalAtRisk || undefined,
        }));
    }, [closedPositions]);
    const sortValue = useCallback((row: GroupedPosition, key: SortKey) => row[key], []);
    const { sortedRows, sort, requestSort } = useSortableRows(groupedPositions, 'realizedPL' as SortKey, sortValue, 'desc');
    const totalPages = Math.ceil(sortedRows.length / ITEMS_PER_PAGE);
    const paginatedClosedPositions = sortedRows.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE
    );

    const handlePrevPage = () => {
        setCurrentPage(p => Math.max(p - 1, 1));
    };

    const handleNextPage = () => {
        setCurrentPage(p => Math.min(p + 1, totalPages));
    };

    const translatedClosedPositions = paginatedClosedPositions.map(p => ({
        ...p,
        assetCategory: t(`assetCategories.${p.assetCategory.toLowerCase()}`, { 'Stocks': p.assetCategory, 'Options': p.assetCategory, 'Forex': p.assetCategory })
    }));

    return (
        <div className="bg-brand-surface rounded-lg shadow-lg p-6 mt-8">
            <h3 className="text-xl font-semibold mb-4">{t('dashboard.closedPositions.title')}</h3>
            <div className="overflow-x-auto pt-12 px-6">
                <table className="w-full text-left">
                    <thead>
                        <tr className="border-b border-brand-card">
                            <SortableHeader column="assetCategory" activeColumn={sort.key} direction={sort.direction} onSort={requestSort}>{t('dashboard.closedPositions.assetCategory')}</SortableHeader>
                            <SortableHeader column="underlying" activeColumn={sort.key} direction={sort.direction} onSort={requestSort}>{t('dashboard.closedPositions.underlying')}</SortableHeader>
                            <SortableHeader column="closedRecords" activeColumn={sort.key} direction={sort.direction} onSort={requestSort} align="right">{t('dashboard.closedPositions.closedRecords')}</SortableHeader>
                            <SortableHeader column="realizedPL" activeColumn={sort.key} direction={sort.direction} onSort={requestSort} align="right">{t('dashboard.closedPositions.totalPL')}</SortableHeader>
                            <SortableHeader column="premiumCollected" activeColumn={sort.key} direction={sort.direction} onSort={requestSort} align="right">{t('dashboard.closedPositions.totalPremium')}</SortableHeader>
                            <SortableHeader column="daysOpen" activeColumn={sort.key} direction={sort.direction} onSort={requestSort} align="right">{t('dashboard.closedPositions.avgDaysOpen')}</SortableHeader>
                            <SortableHeader column="capitalAtRisk" activeColumn={sort.key} direction={sort.direction} onSort={requestSort} align="right">
                                <Tooltip align="right" content={t('dashboard.closedPositions.totalRiskTooltip')}>
                                    <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t('dashboard.closedPositions.totalRisk')}</span>
                                </Tooltip>
                            </SortableHeader>
                            <SortableHeader column="aroc" activeColumn={sort.key} direction={sort.direction} onSort={requestSort} align="right">
                                <Tooltip align="right" content={t('dashboard.closedPositions.arocTooltip')}>
                                    <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t('dashboard.closedPositions.avgAroc')}</span>
                                </Tooltip>
                            </SortableHeader>
                        </tr>
                    </thead>
                    <tbody>
                        {translatedClosedPositions.map((p, i) => (
                            <tr key={`${p.symbol}-${i}`} className="border-b border-brand-card last:border-b-0 hover:bg-brand-card/50">
                                <td className="p-2">{p.assetCategory}</td>
                                <td className="p-2 font-mono">{p.underlying}</td>
                                <td className="p-2 font-mono text-right">{p.closedRecords}</td>
                                <td className={`p-2 font-mono text-right ${p.realizedPL >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>
                                    {formatInSelectedCurrency(p.realizedPL)}
                                </td>
                                <td className="p-2 font-mono text-right">{p.premiumCollected !== undefined ? formatInSelectedCurrency(p.premiumCollected) : '-'}</td>
                                <td className="p-2 font-mono text-right">{p.daysOpen !== undefined ? p.daysOpen.toFixed(1) : '-'}</td>
                                <td className="p-2 font-mono text-right">{p.capitalAtRisk !== undefined ? formatInSelectedCurrency(p.capitalAtRisk) : '-'}</td>
                                <td className={`p-2 font-mono text-right ${p.aroc && p.aroc >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>
                                    {p.aroc !== undefined ? p.aroc.toLocaleString(locale, { style: 'percent', minimumFractionDigits: 2 }) : '-'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {totalPages > 1 && (
                <div className="flex justify-between items-center mt-4">
                    <button
                        onClick={handlePrevPage}
                        disabled={currentPage === 1}
                        className="flex items-center px-3 py-1 bg-brand-accent text-white font-semibold rounded-lg shadow-md hover:bg-brand-accent-hover disabled:bg-brand-card disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronLeftIcon className="w-5 h-5" />
                        <span className="ml-1">{t('pagination.prev')}</span>
                    </button>
                    <span className="text-brand-text-secondary text-sm">
                        {t('pagination.page', { currentPage: currentPage, totalPages: totalPages })}
                    </span>
                    <button
                        onClick={handleNextPage}
                        disabled={currentPage === totalPages}
                        className="flex items-center px-3 py-1 bg-brand-accent text-white font-semibold rounded-lg shadow-md hover:bg-brand-accent-hover disabled:bg-brand-card disabled:cursor-not-allowed transition-colors"
                    >
                         <span className="mr-1">{t('pagination.next')}</span>
                         <ChevronRightIcon className="w-5 h-5" />
                    </button>
                </div>
            )}
        </div>
    );
};

export default ClosedPositions;
