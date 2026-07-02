import React from 'react';
import { MarginLiquidity } from '../../types';
import { useLocalization } from '../../context/LocalizationContext';

interface Props {
    data: MarginLiquidity;
    likelyAssignmentValue: number;
    formatCurrency: (value: number) => string;
}

const MarginLiquidityRisk: React.FC<Props> = ({ data, likelyAssignmentValue, formatCurrency }) => {
    const { t, locale } = useLocalization();
    const postAssignmentFunds = data.availableFunds - likelyAssignmentValue;
    const postAssignmentCash = data.totalCash - likelyAssignmentValue;
    const hasCapacityMetrics = [data.availableFunds, data.excessLiquidity, data.buyingPower, data.maintenanceMargin, data.initialMargin].some(value => value !== 0);
    const marginUsage = hasCapacityMetrics && data.netLiquidation > 0 ? data.maintenanceMargin / data.netLiquidation : 0;
    const unavailable = <span className="text-brand-text-secondary">N/A</span>;
    const metrics = [
        [t('dashboard.marginRisk.availableFunds'), hasCapacityMetrics ? formatCurrency(data.availableFunds) : unavailable, data.availableFunds >= 0],
        [t('dashboard.marginRisk.excessLiquidity'), hasCapacityMetrics ? formatCurrency(data.excessLiquidity) : unavailable, data.excessLiquidity >= 0],
        [t('dashboard.marginRisk.buyingPower'), hasCapacityMetrics ? formatCurrency(data.buyingPower) : unavailable, data.buyingPower >= 0],
        [t('dashboard.marginRisk.maintenanceMargin'), hasCapacityMetrics ? formatCurrency(data.maintenanceMargin) : unavailable, true],
        [t('dashboard.marginRisk.postAssignment'), hasCapacityMetrics ? formatCurrency(postAssignmentFunds) : unavailable, postAssignmentFunds >= 0],
        [t('dashboard.marginRisk.marginUsage'), hasCapacityMetrics ? marginUsage.toLocaleString(locale, { style: 'percent', minimumFractionDigits: 1 }) : unavailable, marginUsage < 0.7],
        [postAssignmentCash >= 0 ? t('dashboard.marginRisk.cashAfterAssignment') : t('dashboard.marginRisk.marginLoanAfterAssignment'), formatCurrency(Math.abs(postAssignmentCash)), postAssignmentCash >= 0],
        [t('dashboard.marginRisk.initialMargin'), hasCapacityMetrics ? formatCurrency(data.initialMargin) : unavailable, true],
    ] as const;

    if (!Object.values(data).some(Boolean)) return null;

    return (
        <section className="bg-brand-surface rounded-lg shadow-lg p-6 mb-8">
            <h2 className="text-2xl font-bold mb-1">{t('dashboard.marginRisk.title')}</h2>
            <p className="text-sm text-brand-text-secondary mb-5">{t('dashboard.marginRisk.description')}</p>
            {!hasCapacityMetrics && (
                <p className="mb-5 rounded-md border border-brand-card bg-brand-card/40 p-3 text-sm text-brand-text-secondary">
                    Flex-only margin capacity fields are not included in this query. Load with IB Gateway for live margin capacity, or add account summary margin fields to the Flex Query.
                </p>
            )}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-px overflow-hidden rounded-md bg-brand-card">
                {metrics.map(([label, value, healthy]) => (
                    <div key={label} className="bg-brand-surface p-4 min-w-0">
                        <p className="text-xs uppercase text-brand-text-secondary">{label}</p>
                        <p className={`mt-1 text-xl font-semibold break-words ${healthy ? 'text-brand-text-primary' : 'text-brand-danger'}`}>{value}</p>
                    </div>
                ))}
            </div>
        </section>
    );
};

export default MarginLiquidityRisk;
