
import React, { useMemo, useState } from 'react';
import { ParsedData, Position } from '../types';

import Header from './dashboard/Header';
import MetricCards from './dashboard/MetricCards';
import PLSummary from './dashboard/PLSummary';
import MonthlyPerformanceChart from './dashboard/MonthlyIncomeChart';
import FeesChart from './dashboard/FeesChart';
import ShortPutRisk, { AssignmentAtRiskPositions, PutSpreadExpirationOutcomes } from './dashboard/ShortPutRisk';
import ShortOptionsPerformance from './dashboard/ShortOptionsPerformance';
import AllocationCharts from './dashboard/AllocationCharts';
import OpenPositions from './dashboard/OpenPositions';
import ClosedPositions from './dashboard/ClosedPositions';
import WheelStrategySummary from './dashboard/WheelStrategySummary';
import WheelCycles from './dashboard/WheelCycles';
import AssignedPutPositions from './dashboard/AssignedPutPositions';
import Footer from './Footer';
import PublicDashboard from './dashboard/PublicDashboard';
import { useLocalization } from '../context/LocalizationContext';
import { DEFAULT_DASHBOARD_THRESHOLDS, DEFAULT_OPTION_MULTIPLIER, LEAPS_DTE_THRESHOLD, WarningIcon } from '../constants';
import MarginLiquidityRisk from './dashboard/MarginLiquidityRisk';
import ExpirationCalendar from './dashboard/ExpirationCalendar';
import NAVDrawdownHistory from './dashboard/NAVDrawdownHistory';
import WheelPositionTimeline from './dashboard/WheelPositionTimeline';
import PremiumEfficiency from './dashboard/PremiumEfficiency';
import { calendarDte } from '../utils/dates';
import BuyToCloseCandidates from './dashboard/BuyToCloseCandidates';
import CollapsibleWidget, { SortableWidgetGroup } from './dashboard/CollapsibleWidget';
import LeapsDeepDive from './dashboard/LeapsDeepDive';
import CashSettledOptions from './dashboard/CashSettledOptions';
import ActionRequiredPanel from './dashboard/ActionRequiredPanel';
import ImportQuality from './dashboard/ImportQuality';
import ScenarioReporting from './dashboard/ScenarioReporting';
import { buildEnhancedShortOptions } from '../services/analytics';

const widgetOrder = [
    'pl-summary', 'scenario-reporting', 'margin-risk', 'assignment-risk', 'at-risk-positions',
    'expiration-calendar', 'action-required', 'buy-to-close', 'covered-call-planning',
    'wheel-summary', 'wheel-cycles', 'wheel-timeline', 'put-spread-outcomes',
    'cash-settled', 'options-performance', 'premium-efficiency', 'performance',
    'nav-history', 'fees', 'allocations', 'open-positions', 'closed-positions',
    'leaps', 'import-quality',
];

const isWheelCall = (position: Position) => (calendarDte(position.expiry) ?? -Infinity) < LEAPS_DTE_THRESHOLD;

interface DashboardProps {
  data: ParsedData;
  onReset: () => void;
  onRefreshData: () => void;
  isRefreshing: boolean;
}

const Dashboard: React.FC<DashboardProps> = ({ data, onReset, onRefreshData, isRefreshing }) => {
    const { locale, t } = useLocalization();
    const [view, setView] = useState<'private' | 'public'>('private');
    const [selectedCurrency, setSelectedCurrency] = useState<string>(data.exchangeRates.USD ? 'USD' : data.nav.baseCurrency);
    const [allocationFilters, setAllocationFilters] = useState({ stocks: true, puts: true, calls: true });
    const [thresholds, setThresholds] = useState(DEFAULT_DASHBOARD_THRESHOLDS);
    const [allocationMode, setAllocationMode] = useState<'marketValue' | 'assignmentExposure' | 'riskCapital'>('riskCapital');

    const formatCurrency = useMemo(() => (value: number, currency: string) => {
        return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    }, [locale]);

    const formatInSelectedCurrency = useMemo(() => (valueInBase: number) => {
        if (selectedCurrency === data.nav.baseCurrency) {
            return formatCurrency(valueInBase, selectedCurrency);
        }
        const rate = data.exchangeRates[selectedCurrency];
        if (!rate) {
            return formatCurrency(valueInBase, data.nav.baseCurrency); // Fallback
        }
        const convertedValue = valueInBase / rate;
        return formatCurrency(convertedValue, selectedCurrency);
    }, [locale, selectedCurrency, data.nav.baseCurrency, data.exchangeRates, formatCurrency]);


    const handleAllocationFilterChange = (filter: keyof typeof allocationFilters) => {
        setAllocationFilters(prev => ({ ...prev, [filter]: !prev[filter] }));
    };

    const dashboardData = useMemo(() => {
        const stockPositions = data.positions.filter(p => !p.isOption);
        const today = new Date();
        const { shortPuts, shortCalls } = buildEnhancedShortOptions(data.positions, data.exchangeRates, data.nav.baseCurrency, today);
        const cashSettledOptions = [...shortPuts, ...shortCalls]
            .filter(position => position.isCashSettled)
            .sort((a, b) => (a.expiry || '').localeCompare(b.expiry || '') || a.symbol.localeCompare(b.symbol));
        const physicalPutSpreads = shortPuts.filter(position => !position.isCashSettled && position.maxLoss !== undefined);
        const leapsPositions = data.positions.filter(position => position.isOption && (calendarDte(position.expiry, today) ?? -Infinity) >= LEAPS_DTE_THRESHOLD);
        
        const likelyAssignments: (typeof shortPuts[0])[] = [];
        const unlikelyAssignments: (typeof shortPuts[0])[] = [];

        shortPuts.forEach(p => {
            if (p.isCashSettled) return;
            if (p.expirationOutcome === 'defined-loss') return;
            let isLikely = false;
            // Assignment risk is driven by price/strike proximity, delta and
            // time remaining. P/L is deliberately not used: a far-OTM option
            // can have a temporary loss without meaningful assignment risk.
            if (p.moneyness !== undefined) {
                const absDelta = Math.abs(p.delta || 0);
                const dte = p.dte ?? Infinity;
                const distance = Math.abs(p.moneyness);
                const isItm = p.moneyness < 0;
                isLikely = (dte <= 0 && isItm)
                    || absDelta >= thresholds.rollDelta
                    || (isItm && dte <= thresholds.itmReviewDte && (absDelta === 0 || absDelta >= 0.50))
                    || (distance <= 0.02 && dte <= thresholds.nearStrikeDte && absDelta >= 0.35)
                    || (distance <= 0.05 && dte <= thresholds.urgentDte && absDelta >= 0.25);
            }
            
            if (isLikely) {
                likelyAssignments.push(p);
            } else {
                unlikelyAssignments.push(p);
            }
        });

        const likelyAssignmentValue = likelyAssignments.reduce((sum, p) => sum + p.shareAssignmentCost, 0);
        const unlikelyAssignmentValue = unlikelyAssignments.reduce((sum, p) => sum + p.shareAssignmentCost, 0);

        const cashBalance = data.nav.cash;
        const likelyCashNeeded = Math.max(0, likelyAssignmentValue - cashBalance);
        const cashAfterLikely = Math.max(0, cashBalance - likelyAssignmentValue);
        const unlikelyCashNeeded = Math.max(0, unlikelyAssignmentValue - cashAfterLikely);
        
        const createExpiryDetails = (assignments: (typeof shortPuts[0])[]) => {
             const assignmentByExpiry = assignments.reduce((acc, p) => {
                const expiry = p.expiry || 'Unknown';
                acc[expiry] = (acc[expiry] || 0) + p.shareAssignmentCost;
                return acc;
            }, {} as Record<string, number>);

            return {
                headers: ['expiryDate', 'assignmentCost'],
                rows: Object.entries(assignmentByExpiry)
                    .sort((a, b) => {
                        const expiryA = a[0];
                        const expiryB = b[0];
                        
                        const timeA = new Date(expiryA).getTime();
                        const timeB = new Date(expiryB).getTime();

                        const aIsInvalid = isNaN(timeA);
                        const bIsInvalid = isNaN(timeB);

                        if (aIsInvalid && bIsInvalid) {
                            return expiryA.localeCompare(expiryB); // sort alphabetically if both invalid
                        }
                        if (aIsInvalid) {
                            return 1; // invalid dates at the end
                        }
                        if (bIsInvalid) {
                            return -1; // invalid dates at the end
                        }

                        return timeA - timeB;
                    })
                    .map(([expiry, cost]: [string, number]) => ({
                        expiryDate: expiry,
                        assignmentCost: formatInSelectedCurrency(cost),
                    })),
            };
        };

        const likelyShortfallDetails = createExpiryDetails(likelyAssignments);
        const unlikelyShortfallDetails = createExpiryDetails(unlikelyAssignments);

        const shortPutRiskMap = new Map(shortPuts.map(p => [p.symbol, p.cashCollateral ?? p.assignmentExposure ?? p.assignmentCost]));

        const allocation = data.positions.reduce<Record<string, number>>((acc, p) => {
            const key = p.baseSymbol;
            if (!key) return acc;

            const isStock = p.assetCategory === 'Stocks';
            const isPut = p.isOption && p.optionType === 'P';
            const isCall = p.isOption && p.optionType === 'C';

            // Apply filters from state
            if ((isStock && !allocationFilters.stocks) ||
                (isPut && !allocationFilters.puts) ||
                (isCall && !allocationFilters.calls)) {
                return acc;
            }
             // Exclude positions that don't match any filter type
            if (!isStock && !isPut && !isCall) return acc;

            const shortPut = shortPuts.find(put => put.symbol === p.symbol);
            const valueToUse = allocationMode === 'marketValue'
                ? Math.abs(p.value)
                : allocationMode === 'assignmentExposure' && shortPut
                    ? shortPut.assignmentExposure ?? shortPut.assignmentCost
                    : shortPutRiskMap.has(p.symbol)
                        ? shortPutRiskMap.get(p.symbol)!
                        : Math.abs(p.value);
            
            acc[key] = (acc[key] || 0) + valueToUse;
            return acc;
        }, {});

        const portfolioAllocation = Object.entries(allocation).map(([name, value]) => ({name, value})).sort((a,b) => b.value - a.value);

        const stockValue = stockPositions.reduce((sum, p) => sum + Math.abs(p.value), 0);
        const optionValue = data.positions.filter(p => p.isOption).reduce((sum, p) => sum + Math.abs(p.value), 0);
        
        const assetClassAllocation = [
            { name: 'Stocks', value: stockValue },
            { name: 'Options', value: optionValue },
        ];
        
        if (cashBalance > 0) {
            assetClassAllocation.push({ name: 'Cash', value: cashBalance });
        }
        
        const calculatePerformance = (positions: Position[]) => {
            const premium = positions.reduce((sum, p) => sum + (p.collectedPremium || 0), 0);
            const currentValue = positions.reduce((sum, p) => sum + Math.abs(p.value), 0);
            const capture = premium > 0 ? ((premium - currentValue) / premium) * 100 : 0;
            return { premium, currentValue, capture };
        };

        const shortPutPerformance = calculatePerformance(shortPuts);
        const shortCallPerformance = calculatePerformance(shortCalls);

        const categoryOrder: { [key: string]: number } = {
            'Stocks': 1,
            'Forex': 2,
            'Options': 3,
        };

        const arocBySymbol = new Map<string, { aroc: number; daysOpen: number; premiumCollected: number; capitalAtRisk: number; arocTradeCount: number }>();
        if (data.closedTradeMetrics.length > 0) {
            data.closedTradeMetrics.forEach(metric => arocBySymbol.set(metric.symbol, {
                aroc: metric.aroc,
                daysOpen: metric.daysOpen,
                premiumCollected: metric.premiumCollected,
                capitalAtRisk: metric.capitalAtRisk,
                arocTradeCount: metric.tradeCount,
            }));
        } else if (data.arocAnalysis && data.arocAnalysis.trades.length > 0) {
            const arocTradesBySymbol = data.arocAnalysis.trades.reduce((acc, trade) => {
                const symbol = trade.symbol;
                if (!acc[symbol]) {
                    acc[symbol] = [];
                }
                acc[symbol].push(trade);
                return acc;
            }, {} as Record<string, typeof data.arocAnalysis.trades>);

            for (const symbol in arocTradesBySymbol) {
                const trades = arocTradesBySymbol[symbol];
                arocBySymbol.set(symbol, {
                    aroc: trades.reduce((sum, trade) => sum + trade.aroc, 0) / trades.length,
                    daysOpen: trades.reduce((sum, trade) => sum + trade.daysOpen, 0) / trades.length,
                    premiumCollected: trades.reduce((sum, trade) => sum + trade.premiumCollected, 0),
                    capitalAtRisk: trades.reduce((sum, trade) => sum + trade.capitalAtRisk, 0),
                    arocTradeCount: trades.length,
                });
            }
        }
        
        const closedPositions = data.closedPositions
            .filter(p => p.realizedPL !== 0)
            .map(p => ({
                ...p,
                ...arocBySymbol.get(p.symbol),
            }))
            .sort((a, b) => {
                const orderA = categoryOrder[a.assetCategory] || 99;
                const orderB = categoryOrder[b.assetCategory] || 99;
                
                if (orderA !== orderB) {
                    return orderA - orderB;
                }
                
                // Sort by close date if available (newest first)
                if (a.closeDate && b.closeDate) {
                    return new Date(b.closeDate).getTime() - new Date(a.closeDate).getTime();
                }
                if (a.closeDate) { // a has date, b doesn't. a comes first.
                    return -1;
                }
                if (b.closeDate) { // b has date, a doesn't. b comes first.
                    return 1;
                }

                // Fallback for items without a date, sort by realized P/L
                return Math.abs(b.realizedPL) - Math.abs(a.realizedPL);
            });
            
        const stockTotals = {
            costBasis: stockPositions.reduce((sum, p) => sum + p.costBasis, 0),
            value: stockPositions.reduce((sum, p) => sum + p.value, 0),
            unrealizedPL: stockPositions.reduce((sum, p) => sum + p.unrealizedPL, 0),
        };

        const putTotals = {
            collectedPremium: shortPuts.reduce((sum, p) => sum + (p.collectedPremium || 0), 0),
            unrealizedPL: shortPuts.reduce((sum, p) => sum + p.unrealizedPL, 0),
            assignmentCost: shortPuts.reduce((sum, p) => sum + p.assignmentCost, 0),
            cashCollateral: shortPuts.reduce((sum, p) => sum + (p.cashCollateral ?? p.assignmentCost), 0),
            definedMaxLoss: shortPuts.reduce((sum, p) => sum + (p.maxLoss ?? 0), 0),
        };

        const callTotals = {
            collectedPremium: shortCalls.reduce((sum, p) => sum + (p.collectedPremium || 0), 0),
            unrealizedPL: shortCalls.reduce((sum, p) => sum + p.unrealizedPL, 0),
        };
        
        const maxAssignmentValue = shortPuts
            .filter(p => !p.isCashSettled)
            .reduce((sum, p) => sum + p.assignmentCost, 0);
        const shortPutRiskCapital = shortPuts
            .filter(p => !p.isCashSettled)
            .reduce((sum, p) => sum + (p.cashCollateral ?? p.assignmentCost), 0);
        const returnOnRiskCapital = shortPutRiskCapital > 0 ? (shortPutPerformance.premium / shortPutRiskCapital * 100) : 0;
        const shortPutLeverage = data.totalNAV > 0 ? shortPutRiskCapital / data.totalNAV : 0;
        const shortPutLeverageCash = data.nav.cash > 0 ? shortPutRiskCapital / data.nav.cash : (shortPutRiskCapital > 0 ? Infinity : 0);


        return { 
            shortPuts,
            shortCalls,
            cashSettledOptions,
            physicalPutSpreads,
            leapsPositions,
            stockPositions, 
            cashBalance, 
            portfolioAllocation, 
            assetClassAllocation,
            shortPutPerformance,
            shortCallPerformance, 
            closedPositions, 
            stockTotals,
            putTotals,
            callTotals,
            returnOnRiskCapital,
            shortPutLeverage,
            shortPutLeverageCash,
            likelyAssignmentValue,
            unlikelyAssignmentValue,
            likelyCashNeeded,
            unlikelyCashNeeded,
            likelyAssignments,
            likelyShortfallDetails,
            unlikelyShortfallDetails,
        };
    }, [data, selectedCurrency, allocationFilters, locale, thresholds, allocationMode]);

    if (view === 'public') {
        return <PublicDashboard data={data} dashboardData={dashboardData} onExit={() => setView('private')} />;
    }

    const latestWeek = data.weeklySummary[data.weeklySummary.length - 1];
    const totalFees = data.weeklySummary.reduce((sum, row) => sum + row.commissions + row.fees + row.salesTax, 0);
    const calendarPositions = [...dashboardData.shortPuts, ...dashboardData.shortCalls]
        .filter(position => !position.isCashSettled);
    const nearestExpiry = calendarPositions.map(position => position.expiry).filter(Boolean).sort()[0];
    const pendingCycles = data.wheelCycleAnalysis.pendingCycles;
    const completedCycles = data.wheelCycleAnalysis.completedCycles;
    const assignedCoverageSummary = (() => {
        const assignedSharesBySymbol = new Map<string, number>();
        pendingCycles.forEach(cycle => {
            assignedSharesBySymbol.set(cycle.symbol, (assignedSharesBySymbol.get(cycle.symbol) || 0) + cycle.assignmentShares);
        });
        let covered = 0;
        assignedSharesBySymbol.forEach((assignedShares, symbol) => {
            const coveredShares = data.positions
                .filter(position => position.isOption && position.optionType === 'C' && position.quantity < 0 && position.baseSymbol === symbol && isWheelCall(position))
                .reduce((sum, position) => sum + Math.abs(position.quantity) * (position.multiplier || DEFAULT_OPTION_MULTIPLIER), 0);
            if (coveredShares >= assignedShares) covered += 1;
        });
        return { total: assignedSharesBySymbol.size, covered };
    })();
    const settingsControls = (
        <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 xl:grid-cols-5">
            <label className="space-y-1">
                <span className="text-brand-text-secondary">{t('dashboard.settings.capture')}</span>
                <input className="w-full accent-brand-accent" type="range" min="0.5" max="0.95" step="0.05" value={thresholds.capture} onChange={event => setThresholds(prev => ({ ...prev, capture: Number(event.target.value) }))} />
                <span className="font-mono">{Math.round(thresholds.capture * 100)}%</span>
            </label>
            <label className="space-y-1">
                <span className="text-brand-text-secondary">{t('dashboard.settings.rollDelta')}</span>
                <input className="w-full accent-brand-accent" type="range" min="0.3" max="0.9" step="0.05" value={thresholds.rollDelta} onChange={event => setThresholds(prev => ({ ...prev, rollDelta: Number(event.target.value) }))} />
                <span className="font-mono">{thresholds.rollDelta.toFixed(2)}</span>
            </label>
            <label className="space-y-1">
                <span className="text-brand-text-secondary">{t('dashboard.settings.urgentDte')}</span>
                <input className="w-full bg-brand-card rounded p-2" type="number" min="0" max="30" value={thresholds.urgentDte} onChange={event => setThresholds(prev => ({ ...prev, urgentDte: Number(event.target.value) }))} />
            </label>
            <label className="space-y-1">
                <span className="text-brand-text-secondary">{t('dashboard.settings.rollDte')}</span>
                <input className="w-full bg-brand-card rounded p-2" type="number" min="1" max="60" value={thresholds.rollDte} onChange={event => setThresholds(prev => ({ ...prev, rollDte: Number(event.target.value) }))} />
            </label>
            <label className="space-y-1">
                <span className="text-brand-text-secondary">{t('dashboard.settings.spreadLoss')}</span>
                <input className="w-full accent-brand-accent" type="range" min="0.3" max="0.95" step="0.05" value={thresholds.spreadLoss} onChange={event => setThresholds(prev => ({ ...prev, spreadLoss: Number(event.target.value) }))} />
                <span className="font-mono">{Math.round(thresholds.spreadLoss * 100)}%</span>
            </label>
        </div>
    );
    
    return (
        <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
            <Header 
                accountInfo={data.accountInfo} 
                exchangeRates={data.exchangeRates} 
                selectedCurrency={selectedCurrency}
                onCurrencyChange={setSelectedCurrency}
                onReset={onReset}
                onRefreshData={onRefreshData}
                isRefreshing={isRefreshing}
                onPublicViewClick={() => setView('public')}
                settingsContent={settingsControls}
            />
            <MetricCards 
                data={data} 
                formatInSelectedCurrency={formatInSelectedCurrency} 
                shortPutLeverage={dashboardData.shortPutLeverage}
                shortPutLeverageCash={dashboardData.shortPutLeverageCash}
            />
            {data.historyStatus && !data.historyStatus.complete && (
                <div className="mb-8 rounded-md border border-brand-danger/40 bg-brand-danger/10 p-4" role="status">
                    <div className="flex items-start gap-3">
                        <WarningIcon className="mt-0.5 shrink-0 text-brand-danger" />
                        <div>
                            <h2 className="font-semibold text-brand-danger">{t('dashboard.historyStatus.title')}</h2>
                            <p className="mt-1 text-sm text-brand-text-secondary">{t('dashboard.historyStatus.description')}</p>
                            {data.historyStatus.warnings.map((warning, index) => <p key={index} className="mt-2 text-sm text-brand-text-primary">{warning}</p>)}
                        </div>
                    </div>
                </div>
            )}
            <SortableWidgetGroup ids={widgetOrder}>
            {dashboardData.shortPuts.length > 0 && <CollapsibleWidget id="action-required" title={t('dashboard.actionRequired.title')} summary={`${dashboardData.shortPuts.length} puts scanned | ${Math.round(thresholds.capture * 100)}% capture`}>
                <ActionRequiredPanel
                    puts={dashboardData.shortPuts}
                    calls={dashboardData.shortCalls}
                    assignedCycles={pendingCycles}
                    positions={data.positions}
                    thresholds={thresholds}
                    formatInSelectedCurrency={formatInSelectedCurrency}
                    formatCurrency={formatCurrency}
                />
            </CollapsibleWidget>}

            {data.importDiagnostics && <CollapsibleWidget id="import-quality" title={t('dashboard.importQuality.title')} summary={`${data.importDiagnostics.source} | ${data.importDiagnostics.warnings.length} warnings`}>
                <ImportQuality diagnostics={data.importDiagnostics} />
            </CollapsibleWidget>}
            <CollapsibleWidget id="margin-risk" title={t('dashboard.marginRisk.title')} summary={`Available ${formatInSelectedCurrency(data.marginLiquidity.availableFunds)} | Likely assignments ${formatInSelectedCurrency(dashboardData.likelyAssignmentValue)}`}>
                <MarginLiquidityRisk data={data.marginLiquidity} likelyAssignmentValue={dashboardData.likelyAssignmentValue} formatCurrency={formatInSelectedCurrency} />
            </CollapsibleWidget>
            <CollapsibleWidget id="scenario-reporting" title={t('dashboard.scenarioReporting.title')} summary={`Stress NAV ${formatInSelectedCurrency(data.totalNAV)} | Exports`}>
                <ScenarioReporting
                    totalNAV={data.totalNAV}
                    cash={dashboardData.cashBalance}
                    stockValue={dashboardData.stockTotals.value}
                    optionValue={dashboardData.assetClassAllocation.find(item => item.name === 'Options')?.value || 0}
                    likelyAssignmentValue={dashboardData.likelyAssignmentValue}
                    unlikelyAssignmentValue={dashboardData.unlikelyAssignmentValue}
                    wheelCycleAnalysis={data.wheelCycleAnalysis}
                    closedPositions={dashboardData.closedPositions}
                    formatInSelectedCurrency={formatInSelectedCurrency}
                />
            </CollapsibleWidget>
            <CollapsibleWidget id="pl-summary" title={t('dashboard.plSummary.title')} summary={`Realized ${formatInSelectedCurrency(data.plSummary.total.realized)} | Unrealized ${formatInSelectedCurrency(data.plSummary.total.unrealized)} | Total ${formatInSelectedCurrency(data.plSummary.total.total)}`}>
                <PLSummary plSummary={data.plSummary} valueFormatter={formatInSelectedCurrency} />
            </CollapsibleWidget>
            {data.equityHistory.length > 0 && <CollapsibleWidget id="nav-history" title={t('dashboard.navHistory.title')} summary={`${data.equityHistory[0].date} - ${data.equityHistory[data.equityHistory.length - 1].date} | NAV ${formatInSelectedCurrency(data.totalNAV)}`}>
                <NAVDrawdownHistory data={data.equityHistory} formatCurrency={formatInSelectedCurrency} />
            </CollapsibleWidget>}
            {latestWeek && <CollapsibleWidget id="performance" title={t('dashboard.monthlyPerformance.title.income')} summary={`${latestWeek.week} | Premium ${formatInSelectedCurrency(latestWeek.optionsPremium)} | P/L ${formatInSelectedCurrency(latestWeek.optionsPL)}`}>
                <MonthlyPerformanceChart
                    data={data.weeklySummary}
                    valueFormatter={(value) => formatInSelectedCurrency(value).replace(/(\.00|,[0-9]{2})$/, '')}
                    tooltipValueFormatter={formatInSelectedCurrency}
                />
            </CollapsibleWidget>}
            {latestWeek && <CollapsibleWidget id="fees" title={t('dashboard.fees.title')} summary={`Total commissions, fees and tax ${formatInSelectedCurrency(totalFees)}`}>
                <FeesChart data={data.weeklySummary} formatInSelectedCurrency={formatInSelectedCurrency} />
            </CollapsibleWidget>}
            {dashboardData.shortPuts.length > 0 && <CollapsibleWidget id="buy-to-close" title={t('dashboard.buyToClose.title')} summary={`${dashboardData.shortPuts.length} open puts | Premium ${formatInSelectedCurrency(dashboardData.putTotals.collectedPremium)}`}>
                <BuyToCloseCandidates puts={dashboardData.shortPuts} captureThreshold={thresholds.capture} urgentDte={thresholds.urgentDte} formatInSelectedCurrency={formatInSelectedCurrency} formatCurrency={formatCurrency} />
            </CollapsibleWidget>}
            <CollapsibleWidget id="assignment-risk" title={t('dashboard.putRisk.title')} summary={`${dashboardData.likelyAssignments.length} likely | Cash needed ${formatInSelectedCurrency(dashboardData.likelyCashNeeded)}`}>
                <ShortPutRisk
                cashBalance={dashboardData.cashBalance}
                likelyAssignmentValue={dashboardData.likelyAssignmentValue}
                unlikelyAssignmentValue={dashboardData.unlikelyAssignmentValue}
                likelyCashNeeded={dashboardData.likelyCashNeeded}
                unlikelyCashNeeded={dashboardData.unlikelyCashNeeded}
                likelyAssignments={dashboardData.likelyAssignments}
                likelyShortfallDetails={dashboardData.likelyShortfallDetails}
                unlikelyShortfallDetails={dashboardData.unlikelyShortfallDetails}
                formatInSelectedCurrency={formatInSelectedCurrency}
                formatCurrency={formatCurrency}
                />
            </CollapsibleWidget>
            {dashboardData.likelyAssignments.length > 0 && <CollapsibleWidget id="at-risk-positions" title={t('dashboard.putRisk.atRiskPositions.title')} summary={`${dashboardData.likelyAssignments.length} positions | Assignment ${formatInSelectedCurrency(dashboardData.likelyAssignmentValue)}`}>
                <AssignmentAtRiskPositions
                likelyAssignments={dashboardData.likelyAssignments}
                likelyAssignmentValue={dashboardData.likelyAssignmentValue}
                formatInSelectedCurrency={formatInSelectedCurrency}
                formatCurrency={formatCurrency}
                />
            </CollapsibleWidget>}
            {dashboardData.physicalPutSpreads.length > 0 && <CollapsibleWidget id="put-spread-outcomes" title={t('dashboard.putRisk.spreads.title')} summary={`${dashboardData.physicalPutSpreads.length} spreads | Max loss ${formatInSelectedCurrency(dashboardData.physicalPutSpreads.reduce((sum, position) => sum + (position.maxLoss || 0), 0))}`}>
                <PutSpreadExpirationOutcomes
                spreadOutcomes={dashboardData.physicalPutSpreads}
                formatInSelectedCurrency={formatInSelectedCurrency}
                formatCurrency={formatCurrency}
                />
            </CollapsibleWidget>}
            {dashboardData.cashSettledOptions.length > 0 && <CollapsibleWidget id="cash-settled" title={t('dashboard.cashSettled.title')} summary={`${dashboardData.cashSettledOptions.length} positions | Net premium ${formatInSelectedCurrency(dashboardData.cashSettledOptions.reduce((sum, position) => sum + (position.collectedPremium || 0), 0))}`}>
                <CashSettledOptions positions={dashboardData.cashSettledOptions} formatInSelectedCurrency={formatInSelectedCurrency} formatCurrency={formatCurrency} />
            </CollapsibleWidget>}
            {calendarPositions.length > 0 && <CollapsibleWidget id="expiration-calendar" title={t('dashboard.expirationCalendar.title')} summary={`${calendarPositions.length} physical-settlement short options | Next expiry ${nearestExpiry || '-'}`}>
                <ExpirationCalendar positions={calendarPositions} formatCurrency={formatInSelectedCurrency} />
            </CollapsibleWidget>}
            <CollapsibleWidget id="options-performance" title={t('dashboard.shortOptionsStrategy.title')} summary={`Closed puts ${formatInSelectedCurrency(data.shortPutIncomeSummary.totalRealizedPL)} | Closed calls ${formatInSelectedCurrency(data.shortCallIncomeSummary.totalRealizedPL)}`}>
                <ShortOptionsPerformance
                shortPutPerformance={dashboardData.shortPutPerformance}
                shortCallPerformance={dashboardData.shortCallPerformance}
                returnOnRiskCapital={dashboardData.returnOnRiskCapital}
                syepIncome={data.syepIncome}
                arocAnalysis={data.arocAnalysis}
                optionsStrategyMetrics={data.optionsStrategyMetrics}
                shortPutIncomeSummary={data.shortPutIncomeSummary}
                shortCallIncomeSummary={data.shortCallIncomeSummary}
                overallOptionsRealizedPL={data.plSummary.options.realized}
                formatInSelectedCurrency={formatInSelectedCurrency}
                />
            </CollapsibleWidget>
            {dashboardData.leapsPositions.length > 0 && <CollapsibleWidget id="leaps" title={t('dashboard.leaps.title')} summary={`${dashboardData.leapsPositions.length} positions | Value ${formatInSelectedCurrency(dashboardData.leapsPositions.reduce((sum, position) => sum + position.value, 0))} | P/L ${formatInSelectedCurrency(dashboardData.leapsPositions.reduce((sum, position) => sum + position.unrealizedPL, 0))}`}>
                <LeapsDeepDive positions={dashboardData.leapsPositions} formatInSelectedCurrency={formatInSelectedCurrency} formatCurrency={formatCurrency} />
            </CollapsibleWidget>}
            {data.premiumEfficiency.length > 0 && <CollapsibleWidget id="premium-efficiency" title={t('dashboard.premiumEfficiency.title')} summary={`${data.premiumEfficiency.length} underlyings | Premium ${formatInSelectedCurrency(data.premiumEfficiency.reduce((sum, row) => sum + row.premiumCollected, 0))}`}>
                <PremiumEfficiency data={data.premiumEfficiency} formatCurrency={formatInSelectedCurrency} />
            </CollapsibleWidget>}
            {pendingCycles.length > 0 && <CollapsibleWidget id="covered-call-planning" title={t('dashboard.assignedPuts.title')} summary={`${assignedCoverageSummary.total} assigned tickers | ${assignedCoverageSummary.covered} covered | ${assignedCoverageSummary.total - assignedCoverageSummary.covered} need action`}>
                <AssignedPutPositions
                cycles={data.wheelCycleAnalysis.pendingCycles}
                positions={data.positions}
                exchangeRates={data.exchangeRates}
                formatInSelectedCurrency={formatInSelectedCurrency}
                formatCurrency={formatCurrency}
                />
            </CollapsibleWidget>}
            <CollapsibleWidget id="allocations" title={t('dashboard.allocations.byTickerTitle')} summary={`${dashboardData.portfolioAllocation.length} underlyings | Largest ${dashboardData.portfolioAllocation[0]?.name || '-'}`}>
                <AllocationCharts
                portfolioAllocation={dashboardData.portfolioAllocation}
                assetClassAllocation={dashboardData.assetClassAllocation}
                formatInSelectedCurrency={formatInSelectedCurrency}
                allocationFilters={allocationFilters}
                onAllocationFilterChange={handleAllocationFilterChange}
                allocationMode={allocationMode}
                onAllocationModeChange={setAllocationMode}
            />
            </CollapsibleWidget>
            <CollapsibleWidget id="open-positions" title={t('dashboard.openPositions.title')} summary={`${dashboardData.stockPositions.length} stocks | ${dashboardData.shortPuts.length} puts | ${dashboardData.shortCalls.length} calls`}>
                <OpenPositions
                stockPositions={dashboardData.stockPositions}
                shortPuts={dashboardData.shortPuts}
                shortCalls={dashboardData.shortCalls}
                stockTotals={dashboardData.stockTotals}
                putTotals={dashboardData.putTotals}
                callTotals={dashboardData.callTotals}
                formatInSelectedCurrency={formatInSelectedCurrency}
                formatCurrency={formatCurrency}
                />
            </CollapsibleWidget>
            {dashboardData.closedPositions.length > 0 && <CollapsibleWidget id="closed-positions" title={t('dashboard.closedPositions.title')} summary={`${dashboardData.closedPositions.length} records | Realized ${formatInSelectedCurrency(dashboardData.closedPositions.reduce((sum, row) => sum + row.realizedPL, 0))}`}>
                <ClosedPositions
                closedPositions={dashboardData.closedPositions}
                formatInSelectedCurrency={formatInSelectedCurrency}
                />
            </CollapsibleWidget>}
            {(pendingCycles.length > 0 || completedCycles.length > 0) && <CollapsibleWidget id="wheel-summary" title={t('dashboard.wheelSummary.title')} summary={`${assignedCoverageSummary.total} active | ${completedCycles.length} completed`}>
                <WheelStrategySummary
                wheelCycleAnalysis={data.wheelCycleAnalysis}
                formatInSelectedCurrency={formatInSelectedCurrency}
                />
            </CollapsibleWidget>}
            {(pendingCycles.length > 0 || completedCycles.length > 0) && <CollapsibleWidget id="wheel-timeline" title={t('dashboard.wheelTimeline.title')} summary={`${assignedCoverageSummary.total + completedCycles.length} wheel cycles tracked`}>
                <WheelPositionTimeline analysis={data.wheelCycleAnalysis} formatCurrency={formatInSelectedCurrency} />
            </CollapsibleWidget>}
            {(pendingCycles.length > 0 || completedCycles.length > 0) && <CollapsibleWidget id="wheel-cycles" title={t('dashboard.wheel.title')} summary={`${assignedCoverageSummary.total} pending | ${completedCycles.length} completed`}>
                <WheelCycles
                wheelCycleAnalysis={data.wheelCycleAnalysis}
                formatInSelectedCurrency={formatInSelectedCurrency}
                formatCurrency={formatCurrency}
                baseCurrency={data.nav.baseCurrency}
                positions={data.positions}
                exchangeRates={data.exchangeRates}
                />
            </CollapsibleWidget>}
            </SortableWidgetGroup>
            <Footer />
        </div>
    );
};

export default Dashboard;
