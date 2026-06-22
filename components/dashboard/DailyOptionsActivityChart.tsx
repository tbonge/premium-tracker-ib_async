import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { DailyOptionsSummary } from '../../types';
import { useLocalization } from '../../context/LocalizationContext';

interface DailyOptionsActivityChartProps {
    data: DailyOptionsSummary[];
    valueFormatter: (value: number) => string;
}

const DailyOptionsActivityChart: React.FC<DailyOptionsActivityChartProps> = ({ data, valueFormatter }) => {
    const { t, locale } = useLocalization();
    const [activeSeries, setActiveSeries] = useState({
        premiumCollected: true,
        closedPL: true,
    });

    const handleLegendClick = (o: any) => {
        const key = o.dataKey === 'closedProfit' || o.dataKey === 'closedLoss' ? 'closedPL' : o.dataKey;
        setActiveSeries(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }));
    };

    if (!data || data.length === 0) {
        return null;
    }

    const hasActivity = data.some(item => item.premiumCollected !== 0 || item.closedPL !== 0);
    if (!hasActivity) {
        return null;
    }

    const chartData = data.map(item => {
        const date = new Date(`${item.date}T00:00:00`);
        return {
            ...item,
            closedProfit: Math.max(0, item.closedPL),
            closedLoss: Math.max(0, -item.closedPL),
            day: date.toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
        };
    });

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-brand-card p-4 rounded-md shadow-lg border border-brand-surface">
                    <p className="font-bold text-brand-text-primary">{label}</p>
                    <ul className="mt-2 text-sm">
                        {payload.map((entry: any) => (
                            <li key={entry.name} style={{ color: entry.color }}>
                                {`${entry.name}: ${valueFormatter(entry.dataKey === 'closedLoss' ? -entry.value : entry.value)}`}
                            </li>
                        ))}
                    </ul>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="bg-brand-surface rounded-lg shadow-lg p-6 mb-8">
            <h2 className="text-2xl font-bold mb-4">{t('dashboard.dailyOptionsActivity.title')}</h2>
            <ResponsiveContainer width="100%" height={400}>
                <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" />
                    <XAxis dataKey="day" stroke="#a0aec0" interval={2} />
                    <YAxis stroke="#a0aec0" tickFormatter={(value) => valueFormatter(value).replace(/(\.00|,[0-9]{2})$/, '')} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(113, 128, 150, 0.1)' }} />
                    <Legend wrapperStyle={{ color: '#edf2f7' }} onClick={handleLegendClick} />
                    <Bar dataKey="premiumCollected" hide={!activeSeries.premiumCollected} name={t('dashboard.dailyOptionsActivity.legend.premiumCollected')} fill="#38b2ac" />
                    <Bar dataKey="closedProfit" hide={!activeSeries.closedPL} name={t('dashboard.dailyOptionsActivity.legend.closedPL')} fill="#48bb78" />
                    <Bar dataKey="closedLoss" hide={!activeSeries.closedPL} name={t('dashboard.dailyOptionsActivity.legend.closedLoss')} fill="#f56565" />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
};

export default DailyOptionsActivityChart;
