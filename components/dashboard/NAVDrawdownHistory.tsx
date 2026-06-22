import React, { useMemo } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EquityHistoryPoint } from '../../types';
import { useLocalization } from '../../context/LocalizationContext';

interface Props { data: EquityHistoryPoint[]; formatCurrency: (value: number) => string; }
const NAVDrawdownHistory: React.FC<Props> = ({ data, formatCurrency }) => {
    const { t, locale } = useLocalization();
    const chartData = useMemo(() => data.map(point => ({ ...point, label: new Date(`${point.date}T00:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric' }) })), [data, locale]);
    if (data.length < 2) return null;
    const maxDrawdown = Math.min(...data.map(point => point.drawdown));
    const change = data[0].total ? data[data.length - 1].total / data[0].total - 1 : 0;
    return <section className="bg-brand-surface rounded-lg shadow-lg p-6 mb-8">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4"><div><h2 className="text-2xl font-bold">{t('dashboard.navHistory.title')}</h2><p className="text-sm text-brand-text-secondary">{data[0].date} - {data[data.length - 1].date}</p></div><div className="flex gap-6 text-right"><div><p className="text-xs uppercase text-brand-text-secondary">{t('dashboard.navHistory.change')}</p><p className={change >= 0 ? 'text-brand-success' : 'text-brand-danger'}>{change.toLocaleString(locale, { style: 'percent', minimumFractionDigits: 2 })}</p></div><div><p className="text-xs uppercase text-brand-text-secondary">{t('dashboard.navHistory.maxDrawdown')}</p><p className="text-brand-danger">{maxDrawdown.toLocaleString(locale, { style: 'percent', minimumFractionDigits: 2 })}</p></div></div></div>
        <ResponsiveContainer width="100%" height={360}><ComposedChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#4a5568"/><XAxis dataKey="label" stroke="#a0aec0" minTickGap={32}/><YAxis yAxisId="nav" stroke="#a0aec0" tickFormatter={v => formatCurrency(v).replace(/(\.00|,[0-9]{2})$/, '')}/><YAxis yAxisId="dd" orientation="right" stroke="#fc8181" tickFormatter={v => `${(v * 100).toFixed(0)}%`}/><Tooltip formatter={(value: number, name: string) => name === 'Drawdown' ? `${(value * 100).toFixed(2)}%` : formatCurrency(value)}/><Area yAxisId="nav" dataKey="total" name="NAV" stroke="#38b2ac" fill="#38b2ac" fillOpacity={0.18}/><Line yAxisId="dd" dataKey="drawdown" name="Drawdown" stroke="#fc8181" dot={false}/></ComposedChart></ResponsiveContainer>
    </section>;
};
export default NAVDrawdownHistory;
