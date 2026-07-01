import React, { useMemo } from 'react';
import { ClosedPosition, WheelCycleAnalysis } from '../../types';
import { DownloadIcon, WarningIcon } from '../../constants';
import { useLocalization } from '../../context/LocalizationContext';

interface Props {
    totalNAV: number;
    cash: number;
    stockValue: number;
    optionValue: number;
    likelyAssignmentValue: number;
    unlikelyAssignmentValue: number;
    wheelCycleAnalysis: WheelCycleAnalysis;
    closedPositions: ClosedPosition[];
    formatInSelectedCurrency: (value: number) => string;
}

const downloadCsv = (filename: string, rows: Record<string, unknown>[]) => {
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const csv = [
        headers.join(','),
        ...rows.map(row => headers.map(header => {
            const value = row[header] ?? '';
            return `"${String(value).replace(/"/g, '""')}"`;
        }).join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
};

const ScenarioReporting: React.FC<Props> = ({
    totalNAV,
    cash,
    stockValue,
    optionValue,
    likelyAssignmentValue,
    unlikelyAssignmentValue,
    wheelCycleAnalysis,
    closedPositions,
    formatInSelectedCurrency,
}) => {
    const { t } = useLocalization();
    const scenarios = useMemo(() => {
        const likelyCashAfter = cash - likelyAssignmentValue;
        const allAssignmentCashAfter = cash - likelyAssignmentValue - unlikelyAssignmentValue;
        const down10 = totalNAV - (stockValue * 0.10) - (optionValue * 0.25);
        const down20 = totalNAV - (stockValue * 0.20) - (optionValue * 0.50);
        return [
            { key: 'likelyAssignments', value: likelyCashAfter, risk: likelyCashAfter < 0 },
            { key: 'allAssignments', value: allAssignmentCashAfter, risk: allAssignmentCashAfter < 0 },
            { key: 'down10', value: down10, risk: down10 < totalNAV * 0.85 },
            { key: 'down20', value: down20, risk: down20 < totalNAV * 0.70 },
        ];
    }, [cash, likelyAssignmentValue, optionValue, stockValue, totalNAV, unlikelyAssignmentValue]);

    const exportWheel = () => downloadCsv('wheel-cycles.csv', [
        ...wheelCycleAnalysis.pendingCycles.map(cycle => ({
            status: 'pending',
            symbol: cycle.symbol,
            startDate: cycle.startDate,
            totalPL: cycle.currentTotalPL,
            callPremium: cycle.totalCallPremium,
            otherIncome: cycle.otherIncome || 0,
        })),
        ...wheelCycleAnalysis.completedCycles.map(cycle => ({
            status: 'completed',
            symbol: cycle.symbol,
            startDate: cycle.startDate,
            endDate: cycle.endDate,
            totalPL: cycle.totalPL,
            callPremium: cycle.totalCallPremium,
            otherIncome: cycle.otherIncome || 0,
        })),
    ]);

    const exportClosed = () => downloadCsv('closed-positions.csv', closedPositions.map(position => ({
        assetCategory: position.assetCategory,
        symbol: position.symbol,
        realizedPL: position.realizedPL,
        closeDate: position.closeDate || '',
        aroc: position.aroc || '',
    })));

    return (
        <section className="bg-brand-surface rounded-lg shadow-lg p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                    <h3 className="text-xl font-semibold">{t('dashboard.scenarioReporting.title')}</h3>
                    <p className="text-sm text-brand-text-secondary">{t('dashboard.scenarioReporting.description')}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button onClick={exportWheel} className="inline-flex items-center gap-2 rounded-md bg-brand-card px-3 py-2 text-sm hover:bg-brand-surface">
                        <DownloadIcon className="w-4 h-4" />
                        {t('dashboard.scenarioReporting.exportWheel')}
                    </button>
                    <button onClick={exportClosed} className="inline-flex items-center gap-2 rounded-md bg-brand-card px-3 py-2 text-sm hover:bg-brand-surface">
                        <DownloadIcon className="w-4 h-4" />
                        {t('dashboard.scenarioReporting.exportClosed')}
                    </button>
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                {scenarios.map(scenario => (
                    <div key={scenario.key} className="bg-brand-card/40 rounded-md p-3">
                        <div className="flex items-center gap-2 text-xs uppercase text-brand-text-secondary">
                            {scenario.risk && <WarningIcon className="w-4 h-4 text-brand-danger" />}
                            {t(`dashboard.scenarioReporting.scenarios.${scenario.key}`)}
                        </div>
                        <div className={`mt-1 font-mono text-lg ${scenario.risk ? 'text-brand-danger' : 'text-brand-text-primary'}`}>
                            {formatInSelectedCurrency(scenario.value)}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
};

export default ScenarioReporting;
