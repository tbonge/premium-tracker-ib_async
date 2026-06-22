
import React, { useCallback } from 'react';
import { ParsedData } from '../../types';
import { StocksIcon, OptionsIcon, ForexIcon, InfoIcon } from '../../constants';
import Tooltip from '../Tooltip';
import { useLocalization } from '../../context/LocalizationContext';
import SortableHeader from './SortableHeader';
import { useSortableRows } from './useSortableRows';

interface PLSummaryProps {
    plSummary: ParsedData['plSummary'];
    valueFormatter: (value: number) => string;
}

const PLSummary: React.FC<PLSummaryProps> = ({ plSummary, valueFormatter }) => {
    const { t } = useLocalization();

    const plRows = [
        { title: t('dashboard.plSummary.stocks'), data: plSummary.stocks, icon: <StocksIcon /> },
        { title: t('dashboard.plSummary.options'), data: plSummary.options, icon: <OptionsIcon /> },
        { title: t('dashboard.plSummary.forex'), data: plSummary.forex, icon: <ForexIcon /> },
    ];
    type Row = typeof plRows[number];
    type SortKey = 'title' | 'realized' | 'unrealized' | 'total';
    const sortValue = useCallback((row: Row, key: SortKey) => key === 'title' ? row.title : row.data[key], []);
    const { sortedRows, sort, requestSort } = useSortableRows(plRows, 'title' as SortKey, sortValue);

    return (
        <div className="bg-brand-surface rounded-lg shadow-lg p-6 mb-8">
            <h2 className="text-2xl font-bold mb-4">{t('dashboard.plSummary.title')}</h2>
            <div className="overflow-x-auto pt-12 px-6">
                <table className="w-full text-left">
                    <thead>
                        <tr className="border-b border-brand-card">
                            <SortableHeader column="title" activeColumn={sort.key} direction={sort.direction} onSort={requestSort} className="p-3">{t('dashboard.plSummary.assetClass')}</SortableHeader>
                            <SortableHeader column="realized" activeColumn={sort.key} direction={sort.direction} onSort={requestSort} align="right" className="p-3">
                                <Tooltip content={t('dashboard.plSummary.realizedTooltip')}>
                                    <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t('dashboard.plSummary.realizedPL')}</span>
                                </Tooltip>
                            </SortableHeader>
                            <SortableHeader column="unrealized" activeColumn={sort.key} direction={sort.direction} onSort={requestSort} align="right" className="p-3">
                                <Tooltip content={t('dashboard.plSummary.unrealizedTooltip')}>
                                     <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t('dashboard.plSummary.unrealizedPL')}</span>
                                </Tooltip>
                            </SortableHeader>
                            <SortableHeader column="total" activeColumn={sort.key} direction={sort.direction} onSort={requestSort} align="right" className="p-3">{t('dashboard.plSummary.totalPL')}</SortableHeader>
                        </tr>
                    </thead>
                    <tbody>
                        {sortedRows.map(item => (
                            <tr key={item.title} className="border-b border-brand-card last:border-b-0">
                                <td className="p-3 whitespace-nowrap">
                                    <div className="flex items-center">
                                        <span className="text-brand-accent mr-3">{item.icon}</span>
                                        {item.title}
                                    </div>
                                </td>
                                <td className={`p-3 font-mono text-right ${item.data.realized >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{valueFormatter(item.data.realized)}</td>
                                <td className={`p-3 font-mono text-right ${item.data.unrealized >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{valueFormatter(item.data.unrealized)}</td>
                                <td className={`p-3 font-mono text-right font-semibold ${item.data.total >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{valueFormatter(item.data.total)}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr className="bg-brand-card/20">
                           <td className="p-3 font-bold whitespace-nowrap">
                                <div className="flex items-center">
                                    <span className="text-brand-accent mr-3"><InfoIcon /></span>
                                    {t('dashboard.plSummary.total')}
                                </div>
                            </td>
                            <td className={`p-3 font-mono font-bold text-right ${plSummary.total.realized >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{valueFormatter(plSummary.total.realized)}</td>
                            <td className={`p-3 font-mono font-bold text-right ${plSummary.total.unrealized >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{valueFormatter(plSummary.total.unrealized)}</td>
                            <td className={`p-3 font-mono font-extrabold text-right ${plSummary.total.total >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{valueFormatter(plSummary.total.total)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
};

export default PLSummary;
