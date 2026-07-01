import React from 'react';
import { ImportDiagnostics } from '../../types';
import { AlertTriangleIcon, CheckCircleIcon, InfoIcon } from '../../constants';
import { useLocalization } from '../../context/LocalizationContext';

interface Props {
    diagnostics?: ImportDiagnostics;
}

const ImportQuality: React.FC<Props> = ({ diagnostics }) => {
    const { t } = useLocalization();
    if (!diagnostics) return null;

    const issueCount = diagnostics.skippedRows
        + diagnostics.missingMultipliers
        + diagnostics.estimatedFxRows
        + diagnostics.unparsedOptionSymbols
        + diagnostics.unmatchedAssignments
        + diagnostics.unlinkedRolls;
    const healthy = issueCount === 0;
    const items = [
        ['parsedTrades', diagnostics.parsedTrades],
        ['parsedPositions', diagnostics.parsedPositions],
        ['parsedOptionContracts', diagnostics.parsedOptionContracts],
        ['estimatedFxRows', diagnostics.estimatedFxRows],
        ['missingMultipliers', diagnostics.missingMultipliers],
        ['unparsedOptionSymbols', diagnostics.unparsedOptionSymbols],
        ['unmatchedAssignments', diagnostics.unmatchedAssignments],
        ['unlinkedRolls', diagnostics.unlinkedRolls],
    ] as const;

    return (
        <div className="bg-brand-surface rounded-lg shadow-lg p-6">
            <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                    <h3 className="text-xl font-semibold">{t('dashboard.importQuality.title')}</h3>
                    <p className="text-sm text-brand-text-secondary">{t('dashboard.importQuality.description', { source: diagnostics.source })}</p>
                </div>
                <div className={`flex items-center gap-2 font-semibold ${healthy ? 'text-brand-success' : 'text-yellow-400'}`}>
                    {healthy ? <CheckCircleIcon className="w-5 h-5" /> : <AlertTriangleIcon className="w-5 h-5" />}
                    {healthy ? t('dashboard.importQuality.clean') : t('dashboard.importQuality.review')}
                </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {items.map(([key, value]) => (
                    <div key={key} className="bg-brand-card/40 rounded-md p-3">
                        <div className="text-xs uppercase text-brand-text-secondary">{t(`dashboard.importQuality.metrics.${key}`)}</div>
                        <div className="font-mono text-lg">{value}</div>
                    </div>
                ))}
            </div>
            {diagnostics.warnings.length > 0 && (
                <div className="mt-4 rounded-md bg-brand-card/40 p-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-yellow-400 mb-2">
                        <InfoIcon className="w-4 h-4" />
                        {t('dashboard.importQuality.warnings')}
                    </div>
                    <ul className="space-y-1 text-sm text-brand-text-secondary">
                        {diagnostics.warnings.slice(0, 6).map((warning, index) => <li key={index}>{warning}</li>)}
                        {diagnostics.warnings.length > 6 && <li>{t('dashboard.importQuality.moreWarnings', { count: diagnostics.warnings.length - 6 })}</li>}
                    </ul>
                </div>
            )}
        </div>
    );
};

export default ImportQuality;
