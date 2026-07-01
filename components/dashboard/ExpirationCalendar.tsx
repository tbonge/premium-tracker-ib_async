import React, { useCallback, useMemo } from 'react';
import { Position } from '../../types';
import { useLocalization } from '../../context/LocalizationContext';
import SortableHeader from './SortableHeader';
import { useSortableRows } from './useSortableRows';
import { calendarDte } from '../../utils/dates';

interface CalendarPosition extends Position {
    assignmentCost?: number;
    isCashSettled?: boolean;
}

interface Props { positions: CalendarPosition[]; formatCurrency: (value: number) => string; }
type Row = { expiry: string; dte: number; tickers: number; puts: number; calls: number; assignmentExposure: number; premium: number; };
type Key = keyof Row;

const ExpirationCalendar: React.FC<Props> = ({ positions, formatCurrency }) => {
    const { t } = useLocalization();
    const rows = useMemo(() => {
        const grouped = new Map<string, Row & { symbols: Set<string> }>();
        const now = new Date();
        positions.filter(p => p.isOption && p.quantity < 0 && p.expiry && !p.isCashSettled).forEach(position => {
            const expiry = position.expiry!;
            const row = grouped.get(expiry) || { expiry, dte: calendarDte(expiry, now) ?? 0, tickers: 0, puts: 0, calls: 0, assignmentExposure: 0, premium: 0, symbols: new Set<string>() };
            row.symbols.add(position.baseSymbol);
            const contracts = Math.abs(position.quantity);
            if (position.optionType === 'P') {
                row.puts += contracts;
                row.assignmentExposure += position.assignmentCost || 0;
            } else if (position.optionType === 'C') row.calls += contracts;
            row.premium += position.collectedPremium || 0;
            grouped.set(expiry, row);
        });
        return [...grouped.values()].map(row => ({ ...row, tickers: row.symbols.size }));
    }, [positions]);
    const valueFor = useCallback((row: Row, key: Key) => row[key], []);
    const { sortedRows, sort, requestSort } = useSortableRows(rows, 'expiry' as Key, valueFor);
    if (!rows.length) return null;
    const header = (key: Key, label: string) => <SortableHeader column={key} activeColumn={sort.key} direction={sort.direction} onSort={requestSort} align={key === 'expiry' ? 'left' : 'right'}>{label}</SortableHeader>;
    return (
        <section className="bg-brand-surface rounded-lg shadow-lg p-6 mb-8">
            <h2 className="text-2xl font-bold mb-4">{t('dashboard.expirationCalendar.title')}</h2>
            <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b border-brand-card">
                {header('expiry', t('dashboard.expirationCalendar.expiry'))}{header('dte', 'DTE')}{header('tickers', t('dashboard.expirationCalendar.tickers'))}{header('puts', t('dashboard.expirationCalendar.puts'))}{header('calls', t('dashboard.expirationCalendar.calls'))}{header('assignmentExposure', t('dashboard.expirationCalendar.assignmentExposure'))}{header('premium', t('dashboard.expirationCalendar.premium'))}
            </tr></thead><tbody>{sortedRows.map(row => <tr key={row.expiry} className="border-b border-brand-card last:border-0 hover:bg-brand-card/50">
                <td className="p-2 font-mono">{row.expiry}</td><td className="p-2 text-right font-mono">{row.dte}</td><td className="p-2 text-right font-mono">{row.tickers}</td><td className="p-2 text-right font-mono">{row.puts}</td><td className="p-2 text-right font-mono">{row.calls}</td><td className="p-2 text-right font-mono">{formatCurrency(row.assignmentExposure)}</td><td className="p-2 text-right font-mono text-brand-success">{formatCurrency(row.premium)}</td>
            </tr>)}</tbody></table></div>
        </section>
    );
};
export default ExpirationCalendar;
