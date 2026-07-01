
import React, { useState, useCallback, useEffect } from 'react';
import { ClosedPosition, DailyOptionsSummary, MonthlySummary, ParsedData, WeeklySummary } from './types';
import { parseIbkrCsv } from './services/csvParser';
import FileUpload from './components/FileUpload';
import Dashboard from './components/Dashboard';
import LabsDashboard from './components/LabsDashboard';
import { LoaderIcon, AlertTriangleIcon } from './constants';
import { useLocalization } from './context/LocalizationContext';

const parseDateKey = (dateKey: string): Date => {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date(dateKey);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
};

const formatDateKey = (date: Date): string => {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
};

const getLatestDateKey = (items: DailyOptionsSummary[]): string | null => {
  if (!items.length) {
    return null;
  }

  return items.reduce((latest, item) => item.date > latest ? item.date : latest, items[0].date);
};

const getLatestActiveDateKey = (items: DailyOptionsSummary[]): string | null => {
  const activeItems = items.filter(item => item.premiumCollected !== 0 || item.closedPL !== 0);
  return getLatestDateKey(activeItems);
};

const getWeekKey = (dateKey: string): string => {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return formatDateKey(date);
};

type SessionRealizedEvent = {
  date?: string;
  assetCategory?: string;
  symbol?: string;
  baseSymbol?: string;
  optionType?: 'P' | 'C' | string;
  quantity?: number;
  realizedPL?: number;
};

type SessionOptionSale = {
  date?: string;
  symbol?: string;
  baseSymbol?: string;
  optionType?: 'P' | 'C' | string;
  premium?: number;
  premiumCollected?: number;
};

type GatewayParsedData = ParsedData & {
  sessionRealizedEvents?: SessionRealizedEvent[];
  sessionOptionSales?: SessionOptionSale[];
};

const safeNumber = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;

const emptyMonthlySummary = (month: string): MonthlySummary => ({
  month,
  optionsPL: 0,
  optionsPremium: 0,
  stocksPL: 0,
  forexPL: 0,
  syepIncome: 0,
  interest: 0,
  commissions: 0,
  fees: 0,
  interestPaid: 0,
  salesTax: 0,
});

const latestStatementHistoryDate = (data: ParsedData): string => {
  const candidates = [
    getLatestActiveDateKey(data.dailyOptionsSummary),
    ...data.closedPositions.map(position => position.closeDate?.slice(0, 10)).filter(Boolean) as string[],
    ...data.monthlySummary.map(row => row.month ? `${row.month}-31` : '').filter(Boolean),
  ];
  return candidates.reduce((latest, candidate) => candidate && candidate > latest ? candidate : latest, '');
};

const mergeMonthlySummary = (
  statementData: ParsedData,
  liveData: GatewayParsedData,
  mergedDaily: DailyOptionsSummary[],
  latestStatementDay: string
): MonthlySummary[] => {
  const byMonth = new Map(statementData.monthlySummary.map(row => [row.month, { ...row }]));

  mergedDaily
    .filter(row => !latestStatementDay || row.date > latestStatementDay)
    .forEach(row => {
      const month = row.date.slice(0, 7);
      const bucket = byMonth.get(month) || emptyMonthlySummary(month);
      bucket.optionsPremium += row.premiumCollected;
      bucket.optionsPL += row.closedPL;
      byMonth.set(month, bucket);
    });

  (liveData.sessionRealizedEvents || [])
    .filter(event => event.date && (!latestStatementDay || event.date > latestStatementDay) && event.assetCategory !== 'Options')
    .forEach(event => {
      const month = event.date!.slice(0, 7);
      const bucket = byMonth.get(month) || emptyMonthlySummary(month);
      const key = event.assetCategory === 'Forex' ? 'forexPL' : 'stocksPL';
      bucket[key] += safeNumber(event.realizedPL);
      byMonth.set(month, bucket);
    });

  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
};

const mergeClosedPositions = (statementData: ParsedData, liveData: GatewayParsedData, latestStatementDay: string): ClosedPosition[] => {
  const rows = [...statementData.closedPositions];
  const seen = new Set(rows.map(row => `${row.closeDate || ''}|${row.assetCategory}|${row.symbol}|${row.realizedPL}`));

  (liveData.sessionRealizedEvents || [])
    .filter(event => event.date && (!latestStatementDay || event.date > latestStatementDay))
    .forEach(event => {
      const row: ClosedPosition = {
        assetCategory: event.assetCategory || 'Other',
        symbol: event.symbol || '',
        realizedPL: safeNumber(event.realizedPL),
        closeDate: event.date,
      };
      const key = `${row.closeDate || ''}|${row.assetCategory}|${row.symbol}|${row.realizedPL}`;
      if (!seen.has(key)) {
        rows.push(row);
        seen.add(key);
      }
    });

  return rows;
};

const mergeTickerPL = (statementData: ParsedData, liveData: GatewayParsedData, latestStatementDay: string) => {
  const totals = new Map(statementData.tickerPL.map(row => [row.ticker, row.totalPL]));
  (liveData.sessionRealizedEvents || [])
    .filter(event => event.date && (!latestStatementDay || event.date > latestStatementDay))
    .forEach(event => {
      const ticker = event.baseSymbol || event.symbol || '';
      if (ticker) totals.set(ticker, (totals.get(ticker) || 0) + safeNumber(event.realizedPL));
    });
  return [...totals.entries()]
    .map(([ticker, totalPL]) => ({ ticker, totalPL }))
    .sort((a, b) => Math.abs(b.totalPL) - Math.abs(a.totalPL));
};

const mergeWeeklyOptionsSummary = (
  statementWeekly: WeeklySummary[] = [],
  statementDaily: DailyOptionsSummary[] = [],
  mergedDaily: DailyOptionsSummary[] = []
): WeeklySummary[] => {
  const latestStatementDay = getLatestActiveDateKey(statementDaily);
  const byWeek = new Map(statementWeekly.map(row => [row.week, { ...row }]));
  if (!latestStatementDay) return [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week));
  mergedDaily.filter(row => row.date > latestStatementDay).forEach(row => {
    const week = getWeekKey(row.date);
    const bucket = byWeek.get(week) || { week, optionsPL: 0, optionsPremium: 0, stocksPL: 0, forexPL: 0, syepIncome: 0, interest: 0, interestPaid: 0, commissions: 0, fees: 0, salesTax: 0 };
    bucket.optionsPremium += row.premiumCollected;
    bucket.optionsPL += row.closedPL;
    byWeek.set(week, bucket);
  });
  return [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week));
};

const mergeDailyOptionsSummary = (
  statementSummary: DailyOptionsSummary[] = [],
  liveSummary: DailyOptionsSummary[] = []
): DailyOptionsSummary[] => {
  if (statementSummary.length === 0) {
    return liveSummary;
  }

  if (liveSummary.length === 0) {
    return statementSummary;
  }

  const statementLatestDate = getLatestDateKey(statementSummary);
  const liveLatestActiveDate = getLatestActiveDateKey(liveSummary);
  if (!statementLatestDate || !liveLatestActiveDate || liveLatestActiveDate <= statementLatestDate) {
    return statementSummary;
  }

  const mergedByDate = new Map<string, DailyOptionsSummary>();
  statementSummary.forEach(item => {
    mergedByDate.set(item.date, { ...item });
  });

  liveSummary
    .filter(item => item.date > statementLatestDate)
    .forEach(item => {
      mergedByDate.set(item.date, { ...item });
    });

  const endDate = parseDateKey(liveLatestActiveDate);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 29);

  const mergedWindow: DailyOptionsSummary[] = [];
  for (let i = 0; i < 30; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    const key = formatDateKey(date);
    mergedWindow.push(mergedByDate.get(key) || { date: key, premiumCollected: 0, closedPL: 0 });
  }

  return mergedWindow;
};

const App: React.FC = () => {
  const [dashboardMode, setDashboardMode] = useState<'classic' | 'labs'>(() =>
    window.location.pathname.replace(/\/+$/, '') === '/labs' ? 'labs' : 'classic'
  );
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [statementData, setStatementData] = useState<ParsedData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLocalization();

  useEffect(() => {
    document.title = t('app.title');
  }, [t]);

  useEffect(() => {
    const handlePopState = () => {
      setDashboardMode(window.location.pathname.replace(/\/+$/, '') === '/labs' ? 'labs' : 'classic');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const switchDashboard = useCallback((mode: 'classic' | 'labs') => {
    window.history.pushState({}, '', mode === 'labs' ? '/labs' : '/');
    setDashboardMode(mode);
  }, []);

  const handleFileChange = useCallback((file: File) => {
    setIsLoading(true);
    setError(null);
    setParsedData(null);
    setStatementData(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setFileContent(text);
    };
    reader.onerror = () => {
      setError(t('app.errors.fileRead'));
      setIsLoading(false);
    };
    reader.readAsText(file);
  }, [t]);

  const handleLiveLoad = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setFileContent(null);
    setParsedData(null);
    setStatementData(null);

    try {
      const response = await fetch('/api/ib/live', { method: 'POST' });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || t('app.errors.ibGateway'));
      }

      if (!payload.positions || !payload.nav) {
        throw new Error(t('app.errors.ibGatewayInvalid'));
      }

      setParsedData(payload as ParsedData);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('app.errors.ibGateway'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  const handleFlexLoad = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setFileContent(null);
    setParsedData(null);
    setStatementData(null);

    try {
      const response = await fetch('/api/ib/flex', { method: 'POST' });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || t('app.errors.flexQuery'));
      }

      if (!payload.accountInfo || !payload.nav || !Array.isArray(payload.monthlySummary)) {
        throw new Error(t('app.errors.flexQueryInvalid'));
      }

      setParsedData(payload as ParsedData);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('app.errors.flexQuery'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  const handleReset = () => {
    setFileContent(null);
    setParsedData(null);
    setStatementData(null);
    setError(null);
    setIsLoading(false);
    setIsRefreshing(false);
  };

  const mergeStatementWithGatewaySnapshot = useCallback((statementData: ParsedData, liveData: GatewayParsedData): ParsedData => {
    const liveUpdatedAt = liveData.accountInfo.period || new Date().toLocaleString();
    const mergedPeriod = statementData.accountInfo.period
      ? `${statementData.accountInfo.period} • ${liveUpdatedAt}`
      : liveUpdatedAt;
    const latestStatementDay = latestStatementHistoryDate(statementData);
    const newRealizedEvents = (liveData.sessionRealizedEvents || [])
      .filter(event => event.date && (!latestStatementDay || event.date > latestStatementDay));
    const intradayRealized = {
      stocks: newRealizedEvents.filter(event => event.assetCategory === 'Stocks').reduce((sum, event) => sum + safeNumber(event.realizedPL), 0),
      options: newRealizedEvents.filter(event => event.assetCategory === 'Options').reduce((sum, event) => sum + safeNumber(event.realizedPL), 0),
      forex: newRealizedEvents.filter(event => event.assetCategory === 'Forex').reduce((sum, event) => sum + safeNumber(event.realizedPL), 0),
      total: newRealizedEvents.reduce((sum, event) => sum + safeNumber(event.realizedPL), 0),
    };

    const mergedPlSummary = {
      stocks: {
        realized: statementData.plSummary.stocks.realized + intradayRealized.stocks,
        unrealized: liveData.plSummary.stocks.unrealized,
        total: statementData.plSummary.stocks.realized + intradayRealized.stocks + liveData.plSummary.stocks.unrealized,
      },
      options: {
        realized: statementData.plSummary.options.realized + intradayRealized.options,
        unrealized: liveData.plSummary.options.unrealized,
        total: statementData.plSummary.options.realized + intradayRealized.options + liveData.plSummary.options.unrealized,
      },
      forex: {
        realized: statementData.plSummary.forex.realized + intradayRealized.forex,
        unrealized: liveData.plSummary.forex.unrealized,
        total: statementData.plSummary.forex.realized + intradayRealized.forex + liveData.plSummary.forex.unrealized,
      },
      total: {
        realized: statementData.plSummary.total.realized + intradayRealized.total,
        unrealized: liveData.plSummary.total.unrealized,
        total: statementData.plSummary.total.realized + intradayRealized.total + liveData.plSummary.total.unrealized,
      },
    };

    const navChange = { ...statementData.navChange };
    if (liveData.totalNAV > 0) {
      const previousEndingValue = statementData.navChange.endingValue || statementData.totalNAV;
      if (previousEndingValue > 0) {
        navChange.markToMarket += liveData.totalNAV - previousEndingValue;
      }
      navChange.endingValue = liveData.totalNAV;
    }

    const hasLiveAccountState = liveData.totalNAV > 0 || liveData.positions.length > 0 || liveData.nav.cash !== 0;
    const mergedDailyOptions = mergeDailyOptionsSummary(statementData.dailyOptionsSummary, liveData.dailyOptionsSummary);
    const mergedMonthly = mergeMonthlySummary(statementData, liveData, mergedDailyOptions, latestStatementDay);
    const mergedClosedPositions = mergeClosedPositions(statementData, liveData, latestStatementDay);
    const mergedTickerPL = mergeTickerPL(statementData, liveData, latestStatementDay);
    const mergedWheelCycleAnalysis = {
      completedCycles: statementData.wheelCycleAnalysis.completedCycles,
      pendingCycles: statementData.wheelCycleAnalysis.pendingCycles.map(cycle => {
        const stockPosition = liveData.positions.find(position => !position.isOption && position.symbol === cycle.symbol);
        if (!stockPosition || stockPosition.quantity === 0) return cycle;

        const exchangeRate = liveData.exchangeRates[stockPosition.currency] || statementData.exchangeRates[stockPosition.currency] || 1;
        const currentPrice = stockPosition.closePrice || (stockPosition.value / stockPosition.quantity);
        const currentStockValue = currentPrice * cycle.assignmentShares * exchangeRate;
        const openCallSymbols = new Set(liveData.positions
          .filter(position => position.isOption && position.optionType === 'C' && position.quantity < 0 && position.baseSymbol === cycle.symbol)
          .map(position => position.symbol));
        const newCallPremium = (liveData.sessionOptionSales || [])
          .filter(event => event.date && (!latestStatementDay || event.date > latestStatementDay)
            && event.optionType === 'C'
            && event.baseSymbol === cycle.symbol
            && (!event.symbol || openCallSymbols.has(event.symbol)))
          .reduce((sum, event) => sum + safeNumber(event.premium ?? event.premiumCollected), 0);
        const totalCallPremium = cycle.totalCallPremium + newCallPremium;
        const unrealizedStockPL = currentStockValue - cycle.netAssignmentCost;
        const currentTotalPL = unrealizedStockPL + totalCallPremium + (cycle.otherIncome || 0);
        const start = parseDateKey(cycle.startDate).getTime();
        const durationDays = Number.isFinite(start) ? Math.max(1, Math.round((Date.now() - start) / 86400000)) : 1;
        return {
          ...cycle,
          totalCallPremium,
          currentStockValue,
          unrealizedStockPL,
          currentTotalPL,
          annualizedReturn: cycle.assignmentCost > 0 ? (currentTotalPL / cycle.assignmentCost) * (365 / durationDays) : 0,
        };
      }),
    };

    return {
      ...statementData,
      positions: liveData.positions.length > 0 ? liveData.positions : statementData.positions,
      nav: hasLiveAccountState ? liveData.nav : statementData.nav,
      accountInfo: {
        ...statementData.accountInfo,
        account: liveData.accountInfo.account || statementData.accountInfo.account,
        baseCurrency: liveData.accountInfo.baseCurrency || statementData.accountInfo.baseCurrency,
        period: mergedPeriod,
      },
      exchangeRates: {
        ...statementData.exchangeRates,
        ...liveData.exchangeRates,
      },
      plSummary: mergedPlSummary,
      totalNAV: liveData.totalNAV || statementData.totalNAV,
      navChange,
      syepIncome: statementData.syepIncome,
      monthlySummary: mergedMonthly,
      dailyOptionsSummary: mergedDailyOptions,
      weeklySummary: mergeWeeklyOptionsSummary(statementData.weeklySummary, statementData.dailyOptionsSummary, mergedDailyOptions),
      closedPositions: mergedClosedPositions,
      tickerPL: mergedTickerPL,
      wheelCycleAnalysis: mergedWheelCycleAnalysis,
      marginLiquidity: liveData.marginLiquidity || statementData.marginLiquidity,
      importDiagnostics: statementData.importDiagnostics || liveData.importDiagnostics,
      historyStatus: {
        source: 'gateway+flex',
        complete: statementData.historyStatus?.complete ?? false,
        warnings: [...(statementData.historyStatus?.warnings || []), ...(liveData.historyStatus?.warnings || [])],
      },
    };
  }, []);

  const loadCurrentGatewaySnapshot = useCallback(async (): Promise<GatewayParsedData | null> => {
    const response = await fetch('/api/ib/current', { method: 'POST' });

    if (!response.ok) {
      return null;
    }

    const liveData = await response.json();
    if (!liveData.positions || !liveData.nav) {
      return null;
    }

    return liveData as GatewayParsedData;
  }, []);

  const enrichStatementWithGatewaySnapshot = useCallback(async (data: ParsedData): Promise<ParsedData> => {
    try {
      const liveData = await loadCurrentGatewaySnapshot();
      if (!liveData) {
        return data;
      }

      return mergeStatementWithGatewaySnapshot(data, liveData);
    } catch {
      return data;
    }
  }, [loadCurrentGatewaySnapshot, mergeStatementWithGatewaySnapshot]);

  const handleRefreshData = useCallback(async () => {
    if (!parsedData || isRefreshing) {
      return;
    }

    setIsRefreshing(true);
    setError(null);

    try {
      if (statementData) {
        const liveData = await loadCurrentGatewaySnapshot();
        if (liveData) {
          setParsedData(mergeStatementWithGatewaySnapshot(statementData, liveData));
        }
      } else {
        const response = await fetch('/api/ib/live', { method: 'POST' });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || t('app.errors.ibGateway'));
        }

        if (!payload.positions || !payload.nav) {
          throw new Error(t('app.errors.ibGatewayInvalid'));
        }

        setParsedData(payload as ParsedData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('app.errors.ibGateway'));
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, loadCurrentGatewaySnapshot, mergeStatementWithGatewaySnapshot, parsedData, statementData, t]);
  
  useEffect(() => {
    if (fileContent) {
      let isCancelled = false;

      const parseAndEnrich = async () => {
        try {
          const data = parseIbkrCsv(fileContent);
          if (data.positions.length === 0 && data.nav.cash === 0) {
              throw new Error(t('app.errors.criticalData'));
          }
          const enrichedData = await enrichStatementWithGatewaySnapshot(data);
          if (!isCancelled) {
            setStatementData(data);
            setParsedData(enrichedData);
          }
        } catch (err) {
          if (!isCancelled) {
            setError(err instanceof Error ? err.message : t('app.errors.unknownParse'));
          }
        } finally {
          if (!isCancelled) {
            setIsLoading(false);
          }
        }
      };

      parseAndEnrich();
      return () => {
        isCancelled = true;
      };
    }
  }, [fileContent, t, enrichStatementWithGatewaySnapshot]);

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex flex-col items-center justify-center h-screen">
          <LoaderIcon className="w-16 h-16 animate-spin text-brand-accent" />
          <p className="mt-4 text-lg">{t('app.loading')}</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-screen p-4">
          <AlertTriangleIcon className="w-16 h-16 text-brand-danger" />
          <p className="mt-4 text-lg text-center text-brand-danger">{t('app.errors.title')}</p>
          <p className="mt-2 text-center text-brand-text-secondary">{error}</p>
          <button
            onClick={handleReset}
            className="mt-6 px-6 py-2 bg-brand-accent text-white font-semibold rounded-lg shadow-md hover:bg-brand-accent-hover focus:outline-none focus:ring-2 focus:ring-brand-accent focus:ring-opacity-75"
          >
            {t('app.tryAgain')}
          </button>
        </div>
      );
    }
    
    if (parsedData) {
      if (dashboardMode === 'labs') {
        return (
          <LabsDashboard
            data={parsedData}
            onReset={handleReset}
            onRefreshData={handleRefreshData}
            isRefreshing={isRefreshing}
            onSwitchToClassic={() => switchDashboard('classic')}
          />
        );
      }
      return <Dashboard data={parsedData} onReset={handleReset} onRefreshData={handleRefreshData} isRefreshing={isRefreshing} />;
    }

    return <FileUpload onFileSelect={handleFileChange} onLiveLoad={handleLiveLoad} onFlexLoad={handleFlexLoad} />;
  };

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text-primary">
      {renderContent()}
    </div>
  );
};

export default App;
