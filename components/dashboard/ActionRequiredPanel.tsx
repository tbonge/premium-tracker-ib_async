import React, { useMemo } from 'react';
import { AlertTriangleIcon, CheckCircleIcon, RepeatIcon, MoneyIcon } from '../../constants';
import { Position } from '../../types';
import { useLocalization } from '../../context/LocalizationContext';

interface ShortPutPosition extends Position {
    dte?: number;
    moneyness?: number;
    breakevenPrice?: number;
    stockPrice?: number;
    maxLoss?: number;
    shareAssignmentCost?: number;
    protectedContracts?: number;
}

interface Thresholds {
    capture: number;
    rollDelta: number;
    urgentDte: number;
    rollDte: number;
    spreadLoss: number;
}

interface Props {
    puts: ShortPutPosition[];
    thresholds: Thresholds;
    formatInSelectedCurrency: (value: number) => string;
    formatCurrency: (value: number, currency: string) => string;
}

type ActionRow = {
    priority: number;
    action: string;
    reason: string;
    position: ShortPutPosition;
    metric: string;
};

const ActionRequiredPanel: React.FC<Props> = ({ puts, thresholds, formatInSelectedCurrency, formatCurrency }) => {
    const { t } = useLocalization();
    const rows = useMemo<ActionRow[]>(() => {
        const output: ActionRow[] = [];
        puts.forEach(position => {
            const premium = position.collectedPremium || 0;
            const closeCost = Math.abs(position.value);
            const capture = premium > 0 ? (premium - closeCost) / premium : 0;
            const absDelta = Math.abs(position.delta || 0);
            const dte = position.dte ?? Infinity;
            const isItm = (position.moneyness ?? 1) < 0;
            const protectedContracts = position.protectedContracts || 0;
            const isSpread = position.maxLoss !== undefined && protectedContracts >= Math.abs(position.quantity);
            const lossProgress = isSpread && position.maxLoss && position.maxLoss > 0
                ? Math.max(0, Math.min(1, -position.unrealizedPL / position.maxLoss))
                : 0;

            if (dte <= thresholds.urgentDte && isItm) {
                output.push({
                    priority: 1,
                    action: t('dashboard.actionRequired.actions.rollOrClose'),
                    reason: t('dashboard.actionRequired.reasons.assignment'),
                    position,
                    metric: `${dte} DTE`
                });
            }
            if (capture >= thresholds.capture && premium > 0) {
                output.push({
                    priority: 2,
                    action: t('dashboard.actionRequired.actions.closeForProfit'),
                    reason: t('dashboard.actionRequired.reasons.capture'),
                    position,
                    metric: `${Math.round(capture * 100)}%`
                });
            }
            if (dte <= thresholds.rollDte && capture >= Math.min(thresholds.capture, 0.5)) {
                output.push({
                    priority: 3,
                    action: t('dashboard.actionRequired.actions.roll'),
                    reason: t('dashboard.actionRequired.reasons.dte'),
                    position,
                    metric: `${dte} DTE`
                });
            }
            if (absDelta >= thresholds.rollDelta) {
                output.push({
                    priority: 4,
                    action: t('dashboard.actionRequired.actions.roll'),
                    reason: t('dashboard.actionRequired.reasons.delta'),
                    position,
                    metric: absDelta.toFixed(2)
                });
            }
            if (lossProgress >= thresholds.spreadLoss) {
                output.push({
                    priority: 5,
                    action: t('dashboard.actionRequired.actions.manageSpread'),
                    reason: t('dashboard.actionRequired.reasons.spreadLoss'),
                    position,
                    metric: `${Math.round(lossProgress * 100)}%`
                });
            }
        });
        const unique = new Map<string, ActionRow>();
        output.sort((a, b) => a.priority - b.priority).forEach(row => {
            const key = `${row.position.symbol}-${row.action}-${row.reason}`;
            if (!unique.has(key)) unique.set(key, row);
        });
        return [...unique.values()].slice(0, 12);
    }, [puts, thresholds, t]);

    const counts = {
        urgent: rows.filter(row => row.priority === 1).length,
        profit: rows.filter(row => row.priority === 2).length,
        roll: rows.filter(row => row.priority === 3 || row.priority === 4).length,
        spreads: rows.filter(row => row.priority === 5).length,
    };

    if (!rows.length) {
        return (
            <section className="bg-brand-surface rounded-lg shadow-lg p-6 mb-8">
                <h2 className="text-2xl font-bold mb-4">{t('dashboard.actionRequired.title')}</h2>
                <div className="flex items-center gap-3 text-brand-success">
                    <CheckCircleIcon className="w-5 h-5" />
                    <span>{t('dashboard.actionRequired.empty')}</span>
                </div>
            </section>
        );
    }

    return (
        <section className="bg-brand-surface rounded-lg shadow-lg p-6 mb-8">
            <h2 className="text-2xl font-bold mb-4">{t('dashboard.actionRequired.title')}</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                <div className="bg-brand-card/40 rounded-md p-3"><AlertTriangleIcon className="w-5 h-5 text-brand-danger mb-1" /><div className="font-mono text-lg">{counts.urgent}</div><div className="text-xs text-brand-text-secondary">{t('dashboard.actionRequired.summary.urgent')}</div></div>
                <div className="bg-brand-card/40 rounded-md p-3"><MoneyIcon className="w-5 h-5 text-brand-success mb-1" /><div className="font-mono text-lg">{counts.profit}</div><div className="text-xs text-brand-text-secondary">{t('dashboard.actionRequired.summary.profit')}</div></div>
                <div className="bg-brand-card/40 rounded-md p-3"><RepeatIcon className="w-5 h-5 text-brand-accent mb-1" /><div className="font-mono text-lg">{counts.roll}</div><div className="text-xs text-brand-text-secondary">{t('dashboard.actionRequired.summary.roll')}</div></div>
                <div className="bg-brand-card/40 rounded-md p-3"><AlertTriangleIcon className="w-5 h-5 text-brand-danger mb-1" /><div className="font-mono text-lg">{counts.spreads}</div><div className="text-xs text-brand-text-secondary">{t('dashboard.actionRequired.summary.spreads')}</div></div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] text-left text-sm">
                    <thead><tr className="border-b border-brand-card">
                        <th className="p-2">{t('dashboard.actionRequired.headers.action')}</th>
                        <th className="p-2">{t('dashboard.actionRequired.headers.contract')}</th>
                        <th className="p-2">{t('dashboard.actionRequired.headers.reason')}</th>
                        <th className="p-2 text-right">{t('dashboard.actionRequired.headers.metric')}</th>
                        <th className="p-2 text-right">DTE</th>
                        <th className="p-2 text-right">Delta</th>
                        <th className="p-2 text-right">{t('dashboard.actionRequired.headers.underlying')}</th>
                        <th className="p-2 text-right">{t('dashboard.actionRequired.headers.cash')}</th>
                    </tr></thead>
                    <tbody>{rows.map((row, index) => (
                        <tr key={`${row.position.symbol}-${row.action}-${index}`} className="border-b border-brand-card last:border-0 hover:bg-brand-card/50">
                            <td className="p-2 font-semibold">{row.action}</td>
                            <td className="p-2 font-mono">{row.position.symbol}</td>
                            <td className="p-2 text-brand-text-secondary">{row.reason}</td>
                            <td className="p-2 text-right font-mono">{row.metric}</td>
                            <td className="p-2 text-right font-mono">{row.position.dte ?? '-'}</td>
                            <td className="p-2 text-right font-mono">{typeof row.position.delta === 'number' ? row.position.delta.toFixed(2) : '-'}</td>
                            <td className="p-2 text-right font-mono">{row.position.stockPrice !== undefined ? formatCurrency(row.position.stockPrice, row.position.currency) : '-'}</td>
                            <td className="p-2 text-right font-mono">{formatInSelectedCurrency(row.position.shareAssignmentCost || 0)}</td>
                        </tr>
                    ))}</tbody>
                </table>
            </div>
        </section>
    );
};

export default ActionRequiredPanel;
