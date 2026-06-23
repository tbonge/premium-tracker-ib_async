import React, { useMemo } from 'react';
import { Position } from '../../types';
import { useLocalization } from '../../context/LocalizationContext';
import { calendarDte } from '../../utils/dates';

interface LeapsDeepDiveProps {
    positions: Position[];
    formatInSelectedCurrency: (value: number) => string;
    formatCurrency: (value: number, currency: string) => string;
}

const LeapsDeepDive: React.FC<LeapsDeepDiveProps> = ({ positions, formatInSelectedCurrency, formatCurrency }) => {
    const { t, locale } = useLocalization();
    const rows = useMemo(() => positions.map(position => ({
        ...position,
        dte: calendarDte(position.expiry) ?? 0,
        contracts: Math.abs(position.quantity),
        side: position.quantity < 0 ? t('dashboard.leaps.short') : t('dashboard.leaps.long'),
    })).sort((a, b) => a.dte - b.dte), [positions, t]);

    if (!rows.length) return null;

    const contracts = rows.reduce((sum, row) => sum + row.contracts, 0);
    const marketValue = rows.reduce((sum, row) => sum + row.value, 0);
    const unrealizedPL = rows.reduce((sum, row) => sum + row.unrealizedPL, 0);
    const averageDte = contracts ? rows.reduce((sum, row) => sum + row.dte * row.contracts, 0) / contracts : 0;

    return (
        <section className="bg-brand-surface rounded-lg shadow-lg p-6 mb-8">
            <h2 className="text-2xl font-bold mb-1">{t('dashboard.leaps.title')}</h2>
            <p className="text-sm text-brand-text-secondary mb-5">{t('dashboard.leaps.description')}</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6 border-y border-brand-card py-4">
                <div><p className="text-xs uppercase text-brand-text-secondary">{t('dashboard.leaps.contracts')}</p><p className="font-mono text-lg">{contracts.toLocaleString(locale)}</p></div>
                <div><p className="text-xs uppercase text-brand-text-secondary">{t('dashboard.leaps.avgDte')}</p><p className="font-mono text-lg">{averageDte.toFixed(0)}</p></div>
                <div><p className="text-xs uppercase text-brand-text-secondary">{t('dashboard.leaps.value')}</p><p className="font-mono text-lg">{formatInSelectedCurrency(marketValue)}</p></div>
                <div><p className="text-xs uppercase text-brand-text-secondary">{t('dashboard.leaps.unrealized')}</p><p className={`font-mono text-lg ${unrealizedPL >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatInSelectedCurrency(unrealizedPL)}</p></div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm text-left">
                    <thead><tr className="border-b border-brand-card text-brand-text-secondary">
                        <th className="p-2">{t('dashboard.leaps.underlying')}</th>
                        <th className="p-2">{t('dashboard.leaps.type')}</th>
                        <th className="p-2 text-right">{t('dashboard.leaps.qty')}</th>
                        <th className="p-2 text-right">{t('dashboard.leaps.strike')}</th>
                        <th className="p-2 text-right">{t('dashboard.leaps.expiry')}</th>
                        <th className="p-2 text-right">DTE</th>
                        <th className="p-2 text-right">{t('dashboard.leaps.value')}</th>
                        <th className="p-2 text-right">{t('dashboard.leaps.unrealized')}</th>
                    </tr></thead>
                    <tbody>{rows.map(row => (
                        <tr key={row.symbol} className="border-b border-brand-card last:border-0 hover:bg-brand-card/40">
                            <td className="p-2 font-mono">{row.baseSymbol}</td>
                            <td className="p-2">{row.side} {row.optionType === 'P' ? t('dashboard.leaps.put') : t('dashboard.leaps.call')}</td>
                            <td className="p-2 text-right font-mono">{row.contracts}</td>
                            <td className="p-2 text-right font-mono">{formatCurrency(row.strikePrice || 0, row.currency)}</td>
                            <td className="p-2 text-right font-mono">{row.expiry}</td>
                            <td className="p-2 text-right font-mono">{row.dte}</td>
                            <td className="p-2 text-right font-mono">{formatInSelectedCurrency(row.value)}</td>
                            <td className={`p-2 text-right font-mono ${row.unrealizedPL >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatInSelectedCurrency(row.unrealizedPL)}</td>
                        </tr>
                    ))}</tbody>
                </table>
            </div>
        </section>
    );
};

export default LeapsDeepDive;
