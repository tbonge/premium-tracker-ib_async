import React, { useCallback, useMemo } from 'react';
import { WheelCycleAnalysis } from '../../types';
import { useLocalization } from '../../context/LocalizationContext';
import SortableHeader from './SortableHeader';
import { useSortableRows } from './useSortableRows';

interface Props { analysis: WheelCycleAnalysis; formatCurrency: (value: number) => string; }
type Row = { date: string; symbol: string; status: string; event: string; amount: number; };
type Key = keyof Row;

const WheelPositionTimeline: React.FC<Props> = ({ analysis, formatCurrency }) => {
    const { t } = useLocalization();
    const rows = useMemo(() => [
        ...analysis.pendingCycles.map(cycle => ({ cycle, status: t('dashboard.wheelTimeline.pending') })),
        ...analysis.completedCycles.map(cycle => ({ cycle, status: t('dashboard.wheelTimeline.completed') })),
    ].flatMap(({ cycle, status }) => cycle.tradeLog.map(event => ({ ...event, symbol: cycle.symbol, status, event: event.description }))), [analysis, t]);
    const valueFor = useCallback((row: Row, key: Key) => row[key], []);
    const { sortedRows, sort, requestSort } = useSortableRows(rows, 'date' as Key, valueFor, 'desc');
    if (!rows.length) return null;
    const header = (key: Key, label: string, right = false) => <SortableHeader column={key} activeColumn={sort.key} direction={sort.direction} onSort={requestSort} align={right ? 'right' : 'left'}>{label}</SortableHeader>;
    return (
        <section className="bg-brand-surface rounded-lg shadow-lg p-6 mb-8">
            <h2 className="text-2xl font-bold mb-4">{t('dashboard.wheelTimeline.title')}</h2>
            <div className="overflow-x-auto"><table className="w-full text-left">
                <thead><tr className="border-b border-brand-card">{header('date', t('dashboard.wheelTimeline.date'))}{header('symbol', t('dashboard.wheelTimeline.symbol'))}{header('status', t('dashboard.wheelTimeline.status'))}{header('event', t('dashboard.wheelTimeline.event'))}{header('amount', t('dashboard.wheelTimeline.amount'), true)}</tr></thead>
                <tbody>{sortedRows.map((row, index) => <tr key={`${row.date}-${row.symbol}-${index}`} className="border-b border-brand-card last:border-0"><td className="p-2 font-mono">{row.date}</td><td className="p-2 font-mono">{row.symbol}</td><td className="p-2">{row.status}</td><td className="p-2">{row.event}</td><td className={`p-2 text-right font-mono ${row.amount >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatCurrency(row.amount)}</td></tr>)}</tbody>
            </table></div>
        </section>
    );
};
export default WheelPositionTimeline;
