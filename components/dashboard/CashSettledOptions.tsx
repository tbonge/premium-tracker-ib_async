import React from 'react';
import { Position } from '../../types';
import { useLocalization } from '../../context/LocalizationContext';

interface CashSettledPosition extends Position {
    dte?: number;
    stockPrice?: number;
    assignmentCost?: number;
    maxLoss?: number;
    protectedContracts?: number;
    protectiveStrike?: number;
}

interface CashSettledOptionsProps {
    positions: CashSettledPosition[];
    formatInSelectedCurrency: (value: number) => string;
    formatCurrency: (value: number, currency: string) => string;
}

const CashSettledOptions: React.FC<CashSettledOptionsProps> = ({
    positions,
    formatInSelectedCurrency,
    formatCurrency,
}) => {
    const { t } = useLocalization();

    return (
        <div className="bg-brand-surface rounded-lg shadow-lg p-6 mb-8">
            <h2 className="text-2xl font-bold mb-1">{t('dashboard.cashSettled.title')}</h2>
            <p className="text-sm text-brand-text-secondary mb-4">{t('dashboard.cashSettled.description')}</p>
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead>
                        <tr className="border-b border-brand-card">
                            <th className="p-2">{t('dashboard.cashSettled.contract')}</th>
                            <th className="p-2">{t('dashboard.cashSettled.expiry')}</th>
                            <th className="p-2 text-right">{t('dashboard.cashSettled.type')}</th>
                            <th className="p-2 text-right">{t('dashboard.cashSettled.quantity')}</th>
                            <th className="p-2 text-right">{t('dashboard.cashSettled.strike')}</th>
                            <th className="p-2 text-right">{t('dashboard.cashSettled.currentPrice')}</th>
                            <th className="p-2 text-right">Delta</th>
                            <th className="p-2 text-right">DTE</th>
                            <th className="p-2 text-right">{t('dashboard.cashSettled.netPremium')}</th>
                            <th className="p-2 text-right">{t('dashboard.cashSettled.unrealizedPL')}</th>
                            <th className="p-2 text-right">{t('dashboard.cashSettled.maxLoss')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {positions.map((position, index) => {
                            const maxLoss = position.maxLoss;
                            const contracts = Math.abs(position.quantity);
                            const fullyProtected = (position.protectedContracts || 0) >= contracts;
                            const hasDefinedLoss = fullyProtected && maxLoss !== undefined;
                            const spreadSymbol = position.protectiveStrike !== undefined && position.strikePrice !== undefined
                                ? `${position.baseSymbol} ${position.expiry || ''} ${position.strikePrice}/${position.protectiveStrike} ${position.optionType || ''}`
                                : position.symbol;
                            return (
                                <tr key={`${position.symbol}-${index}`} className="border-b border-brand-card last:border-0 hover:bg-brand-card/50">
                                    <td className="p-2 font-mono">{spreadSymbol}</td>
                                    <td className="p-2 font-mono">{position.expiry || '-'}</td>
                                    <td className="p-2 text-right">{position.optionType === 'P' ? t('dashboard.cashSettled.put') : t('dashboard.cashSettled.call')}</td>
                                    <td className="p-2 text-right font-mono">{position.quantity}</td>
                                    <td className="p-2 text-right font-mono">{position.strikePrice !== undefined ? formatCurrency(position.strikePrice, position.currency) : '-'}</td>
                                    <td className="p-2 text-right font-mono">{position.stockPrice !== undefined ? formatCurrency(position.stockPrice, position.currency) : '-'}</td>
                                    <td className="p-2 text-right font-mono">{typeof position.delta === 'number' && Number.isFinite(position.delta) ? position.delta.toFixed(3) : '-'}</td>
                                    <td className="p-2 text-right font-mono">{position.dte ?? '-'}</td>
                                    <td className="p-2 text-right font-mono text-brand-success">{formatInSelectedCurrency(position.collectedPremium || 0)}</td>
                                    <td className={`p-2 text-right font-mono ${position.unrealizedPL >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>{formatInSelectedCurrency(position.unrealizedPL)}</td>
                                    <td className="p-2 text-right font-mono">{maxLoss !== undefined && hasDefinedLoss ? formatInSelectedCurrency(maxLoss) : t('dashboard.cashSettled.undefined')}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default CashSettledOptions;
