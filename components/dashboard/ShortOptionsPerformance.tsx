

import React from 'react';
import MetricCard from '../MetricCard';
import { InfoIcon, GiftIcon, TrendingUpIcon, CheckCircleIcon, RepeatIcon, MoneyIcon } from '../../constants';
import { ArocAnalysis, OptionsStrategyMetrics, ShortCallIncomeSummary, ShortPutIncomeSummary } from '../../types';
import Tooltip from '../Tooltip';
import { useLocalization } from '../../context/LocalizationContext';

interface PerformanceData {
    premium: number;
    currentValue: number;
    capture: number;
}

interface ShortOptionsPerformanceProps {
    shortPutPerformance: PerformanceData;
    shortCallPerformance: PerformanceData;
    returnOnRiskCapital: number;
    syepIncome?: number;
    arocAnalysis: ArocAnalysis;
    optionsStrategyMetrics: OptionsStrategyMetrics;
    shortPutIncomeSummary: ShortPutIncomeSummary;
    shortCallIncomeSummary: ShortCallIncomeSummary;
    overallOptionsRealizedPL: number;
    formatInSelectedCurrency: (value: number) => string;
}

const closureKeys = ['assigned', 'rolled', 'expired', 'boughtToClose'] as const;

const ShortOptionsPerformance: React.FC<ShortOptionsPerformanceProps> = ({
    shortPutPerformance,
    shortCallPerformance,
    returnOnRiskCapital,
    syepIncome,
    arocAnalysis,
    optionsStrategyMetrics,
    shortPutIncomeSummary,
    shortCallIncomeSummary,
    overallOptionsRealizedPL,
    formatInSelectedCurrency
}) => {
    const { t, locale } = useLocalization();
    
    const hasSyep = syepIncome !== undefined && syepIncome > 0;
    const hasAroc = arocAnalysis && arocAnalysis.trades.length > 0;
    const identifiedShortOptionPL = shortPutIncomeSummary.totalRealizedPL + shortCallIncomeSummary.totalRealizedPL;
    const otherOptionsPL = overallOptionsRealizedPL - identifiedShortOptionPL;
    const renderClosureBreakdown = (
        breakdown: ShortPutIncomeSummary['closureBreakdown'],
        totalContracts: number
    ) => {
        const values = breakdown || { assigned: 0, expired: 0, rolled: 0, boughtToClose: 0 };
        const total = totalContracts || closureKeys.reduce((sum, key) => sum + (values[key] || 0), 0);
        if (!total) return null;

        return (
            <div className="mt-5 overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-brand-card text-brand-text-secondary">
                            <th className="p-2 text-left font-semibold">{t('dashboard.shortOptionsStrategy.closureBreakdown.method')}</th>
                            <th className="p-2 text-right font-semibold">{t('dashboard.shortOptionsStrategy.closureBreakdown.contracts')}</th>
                            <th className="p-2 text-right font-semibold">{t('dashboard.shortOptionsStrategy.closureBreakdown.share')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {closureKeys.map(key => {
                            const contracts = values[key] || 0;
                            return (
                                <tr key={key} className="border-b border-brand-card/70 last:border-b-0">
                                    <td className="p-2">{t(`dashboard.shortOptionsStrategy.closureBreakdown.${key}`)}</td>
                                    <td className="p-2 text-right font-mono">{contracts.toLocaleString(locale)}</td>
                                    <td className="p-2 text-right font-mono">{(contracts / total).toLocaleString(locale, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        );
    };

    return (
    <div className="bg-brand-surface rounded-lg shadow-lg p-6 mb-8">
        <h2 className="text-2xl font-bold mb-6">{t('dashboard.shortOptionsStrategy.title')}</h2>

        {/* Section 1: Open Positions */}
        <div className="mb-8">
            <h3 className="text-xl font-semibold mb-4 text-brand-accent">{t('dashboard.shortOptionsStrategy.openPositions.title')}</h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-6">
                
                {/* Left Side: Puts */}
                <div className="bg-brand-card/20 p-4 rounded-lg">
                    <h4 className="text-lg font-bold mb-4 text-center">{t('dashboard.shortOptionsStrategy.openPositions.putsTitle')}</h4>
                    <div className="space-y-3">
                        <MetricCard title={t('dashboard.shortOptionsStrategy.openPositions.totalPremium.title')} value={formatInSelectedCurrency(shortPutPerformance.premium)} icon={<MoneyIcon />} tooltip={t('dashboard.shortOptionsStrategy.openPositions.totalPremium.tooltipPuts')} />
                        <MetricCard title={t('dashboard.shortOptionsStrategy.openPositions.currentValue.title')} value={formatInSelectedCurrency(shortPutPerformance.currentValue)} icon={<InfoIcon />} tooltip={t('dashboard.shortOptionsStrategy.openPositions.currentValue.tooltipPuts')} />
                        <MetricCard title={t('dashboard.shortOptionsStrategy.openPositions.premiumCapture.title')} value={`${shortPutPerformance.capture.toLocaleString(locale, {minimumFractionDigits: 2, maximumFractionDigits: 2})}%`} icon={<CheckCircleIcon />} isPositive={shortPutPerformance.capture > 0} tooltip={t('dashboard.shortOptionsStrategy.openPositions.premiumCapture.tooltip')} />
                        <MetricCard title={t('dashboard.shortOptionsStrategy.openPositions.returnOnMaxRisk.title')} value={`${returnOnRiskCapital.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`} icon={<TrendingUpIcon />} tooltip={t('dashboard.shortOptionsStrategy.openPositions.returnOnMaxRisk.tooltip')} />
                    </div>
                </div>
                
                {/* Right Side: Calls */}
                <div className="bg-brand-card/20 p-4 rounded-lg">
                    <h4 className="text-lg font-bold mb-4 text-center">{t('dashboard.shortOptionsStrategy.openPositions.callsTitle')}</h4>
                     <div className="space-y-3">
                        <MetricCard title={t('dashboard.shortOptionsStrategy.openPositions.totalPremium.title')} value={formatInSelectedCurrency(shortCallPerformance.premium)} icon={<MoneyIcon />} tooltip={t('dashboard.shortOptionsStrategy.openPositions.totalPremium.tooltipCalls')} />
                        <MetricCard title={t('dashboard.shortOptionsStrategy.openPositions.currentValue.title')} value={formatInSelectedCurrency(shortCallPerformance.currentValue)} icon={<InfoIcon />} tooltip={t('dashboard.shortOptionsStrategy.openPositions.currentValue.tooltipCalls')} />
                        <MetricCard title={t('dashboard.shortOptionsStrategy.openPositions.premiumCapture.title')} value={`${shortCallPerformance.capture.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`} icon={<CheckCircleIcon />} isPositive={shortCallPerformance.capture > 0} tooltip={t('dashboard.shortOptionsStrategy.openPositions.premiumCapture.tooltip')} />
                    </div>
                </div>
            </div>
        </div>

        <div className="border-t border-brand-card my-8"></div>

        {/* Section 2: Realized Income */}
        <div className="mb-8">
            <h3 className="text-xl font-semibold mb-4 text-brand-accent">{t('dashboard.shortOptionsStrategy.realizedIncome.title')}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
                <MetricCard
                    title={t('dashboard.shortOptionsStrategy.realizedIncome.overallOptions.title')}
                    value={formatInSelectedCurrency(overallOptionsRealizedPL)}
                    icon={<MoneyIcon />}
                    isPositive={overallOptionsRealizedPL >= 0}
                    description={t('dashboard.shortOptionsStrategy.realizedIncome.overallOptions.description')}
                    tooltip={t('dashboard.shortOptionsStrategy.realizedIncome.overallOptions.tooltip')}
                />
                <MetricCard
                    title={t('dashboard.shortOptionsStrategy.realizedIncome.identifiedShortOptions.title')}
                    value={formatInSelectedCurrency(identifiedShortOptionPL)}
                    icon={<CheckCircleIcon />}
                    isPositive={identifiedShortOptionPL >= 0}
                    description={t('dashboard.shortOptionsStrategy.realizedIncome.identifiedShortOptions.description')}
                    tooltip={t('dashboard.shortOptionsStrategy.realizedIncome.identifiedShortOptions.tooltip')}
                />
                <MetricCard
                    title={t('dashboard.shortOptionsStrategy.realizedIncome.otherOptions.title')}
                    value={formatInSelectedCurrency(otherOptionsPL)}
                    icon={<InfoIcon />}
                    isPositive={otherOptionsPL >= 0}
                    description={t('dashboard.shortOptionsStrategy.realizedIncome.otherOptions.description')}
                    tooltip={t('dashboard.shortOptionsStrategy.realizedIncome.otherOptions.tooltip')}
                />
            </div>
            <div className={`grid grid-cols-1 sm:grid-cols-2 ${hasSyep ? 'lg:grid-cols-2' : 'lg:grid-cols-1'} gap-6`}>
                 <MetricCard
                    title={t('dashboard.shortOptionsStrategy.realizedIncome.winRate.title')}
                    value={`${(optionsStrategyMetrics.winRate * 100).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
                    icon={<CheckCircleIcon />}
                    isPositive={optionsStrategyMetrics.winRate >= 0.5}
                    description={t('dashboard.shortOptionsStrategy.realizedIncome.winRate.description', { wins: optionsStrategyMetrics.wins, total: optionsStrategyMetrics.totalClosed })}
                    tooltip={t('dashboard.shortOptionsStrategy.realizedIncome.winRate.tooltip')}
                />
                {hasSyep && (
                    <MetricCard
                        title={t('dashboard.shortOptionsStrategy.realizedIncome.syepIncome.title')}
                        value={formatInSelectedCurrency(syepIncome)}
                        icon={<GiftIcon />}
                        description={t('dashboard.shortOptionsStrategy.realizedIncome.syepIncome.description')}
                        tooltip={t('dashboard.shortOptionsStrategy.realizedIncome.syepIncome.tooltip')}
                    />
                )}
            </div>
        </div>
        
        {shortPutIncomeSummary.hasData && (
        <>
            <div className="border-t border-brand-card my-8"></div>

            {/* Section 3: Closed Puts Deep Dive */}
            <div>
                <h3 className="text-xl font-semibold mb-4 text-brand-accent">{t('dashboard.shortOptionsStrategy.closedPuts.title')}</h3>
                <div className={`grid grid-cols-1 sm:grid-cols-2 ${hasAroc ? 'xl:grid-cols-5' : 'xl:grid-cols-4'} gap-6`}>
                     <MetricCard
                        title={t('dashboard.shortOptionsStrategy.closedPuts.totalPL.title')}
                        value={formatInSelectedCurrency(shortPutIncomeSummary.totalRealizedPL)}
                        icon={<MoneyIcon />}
                        isPositive={shortPutIncomeSummary.totalRealizedPL >= 0}
                        description={t('dashboard.shortOptionsStrategy.closedPuts.totalPL.description')}
                        tooltip={t('dashboard.shortOptionsStrategy.closedPuts.totalPL.tooltip')}
                    />
                    <MetricCard
                        title={t('dashboard.shortOptionsStrategy.closedPuts.contractsClosed.title')}
                        value={shortPutIncomeSummary.numberOfContracts.toLocaleString(locale)}
                        icon={<CheckCircleIcon />}
                        description={t('dashboard.shortOptionsStrategy.closedPuts.contractsClosed.description')}
                        tooltip={t('dashboard.shortOptionsStrategy.closedPuts.contractsClosed.tooltip')}
                    />
                    <MetricCard
                        title={t('dashboard.shortOptionsStrategy.closedPuts.avgPL.title')}
                        value={formatInSelectedCurrency(shortPutIncomeSummary.averagePLPerContract)}
                        icon={<InfoIcon />}
                        isPositive={shortPutIncomeSummary.averagePLPerContract >= 0}
                        description={t('dashboard.shortOptionsStrategy.closedPuts.avgPL.description')}
                        tooltip={t('dashboard.shortOptionsStrategy.closedPuts.avgPL.tooltip')}
                    />
                    <MetricCard
                        title={t('dashboard.shortOptionsStrategy.closedPuts.assignmentRate.title')}
                        value={`${(optionsStrategyMetrics.assignmentRate * 100).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
                        icon={<RepeatIcon />}
                        description={t('dashboard.shortOptionsStrategy.closedPuts.assignmentRate.description')}
                        tooltip={t('dashboard.shortOptionsStrategy.closedPuts.assignmentRate.tooltip')}
                    />
                    {hasAroc && (
                        <MetricCard
                            title={t('dashboard.shortOptionsStrategy.closedPuts.avgAroc.title')}
                            value={`${arocAnalysis.averageAroc.toLocaleString(locale, { style: 'percent', minimumFractionDigits: 2 })}`}
                            icon={<TrendingUpIcon />}
                            isPositive={arocAnalysis.averageAroc >= 0}
                            description={t('dashboard.shortOptionsStrategy.closedPuts.avgAroc.description')}
                            tooltip={t('dashboard.shortOptionsStrategy.closedPuts.avgAroc.tooltip')}
                        />
                    )}
                </div>
                {renderClosureBreakdown(shortPutIncomeSummary.closureBreakdown, shortPutIncomeSummary.numberOfContracts)}
            </div>
        </>
        )}
        {shortCallIncomeSummary.hasData && (
        <>
            <div className="border-t border-brand-card my-8"></div>
            <div>
                <h3 className="text-xl font-semibold mb-4 text-brand-accent">{t('dashboard.shortOptionsStrategy.closedCalls.title')}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-6">
                    <MetricCard title={t('dashboard.shortOptionsStrategy.closedCalls.totalPL.title')} value={formatInSelectedCurrency(shortCallIncomeSummary.totalRealizedPL)} icon={<MoneyIcon />} isPositive={shortCallIncomeSummary.totalRealizedPL >= 0} description={t('dashboard.shortOptionsStrategy.closedCalls.totalPL.description')} tooltip={t('dashboard.shortOptionsStrategy.closedCalls.totalPL.tooltip')} />
                    <MetricCard title={t('dashboard.shortOptionsStrategy.closedCalls.contractsClosed.title')} value={shortCallIncomeSummary.numberOfContracts.toLocaleString(locale)} icon={<CheckCircleIcon />} description={t('dashboard.shortOptionsStrategy.closedCalls.contractsClosed.description')} tooltip={t('dashboard.shortOptionsStrategy.closedCalls.contractsClosed.tooltip')} />
                    <MetricCard title={t('dashboard.shortOptionsStrategy.closedCalls.avgPL.title')} value={formatInSelectedCurrency(shortCallIncomeSummary.averagePLPerContract)} icon={<InfoIcon />} isPositive={shortCallIncomeSummary.averagePLPerContract >= 0} description={t('dashboard.shortOptionsStrategy.closedCalls.avgPL.description')} tooltip={t('dashboard.shortOptionsStrategy.closedCalls.avgPL.tooltip')} />
                    <MetricCard title={t('dashboard.shortOptionsStrategy.closedCalls.winRate.title')} value={`${(shortCallIncomeSummary.winRate * 100).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`} icon={<TrendingUpIcon />} isPositive={shortCallIncomeSummary.winRate >= 0.5} description={t('dashboard.shortOptionsStrategy.closedCalls.winRate.description')} tooltip={t('dashboard.shortOptionsStrategy.closedCalls.winRate.tooltip')} />
                    <MetricCard title={t('dashboard.shortOptionsStrategy.closedCalls.assignmentRate.title')} value={`${(shortCallIncomeSummary.assignmentRate * 100).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`} icon={<RepeatIcon />} description={t('dashboard.shortOptionsStrategy.closedCalls.assignmentRate.description')} tooltip={t('dashboard.shortOptionsStrategy.closedCalls.assignmentRate.tooltip')} />
                </div>
                {renderClosureBreakdown(shortCallIncomeSummary.closureBreakdown, shortCallIncomeSummary.numberOfContracts)}
            </div>
        </>
        )}
    </div>
);
}
export default ShortOptionsPerformance;
