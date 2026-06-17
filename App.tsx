
import React, { useState, useCallback, useEffect } from 'react';
import { ParsedData } from './types';
import { parseIbkrCsv } from './services/csvParser';
import FileUpload from './components/FileUpload';
import Dashboard from './components/Dashboard';
import { LoaderIcon, AlertTriangleIcon } from './constants';
import { useLocalization } from './context/LocalizationContext';

const App: React.FC = () => {
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

  const handleReset = () => {
    setFileContent(null);
    setParsedData(null);
    setStatementData(null);
    setError(null);
    setIsLoading(false);
    setIsRefreshing(false);
  };

  const mergeStatementWithGatewaySnapshot = useCallback((statementData: ParsedData, liveData: ParsedData): ParsedData => {
    const liveUpdatedAt = liveData.accountInfo.period || new Date().toLocaleString();
    const mergedPeriod = statementData.accountInfo.period
      ? `${statementData.accountInfo.period} • ${liveUpdatedAt}`
      : liveUpdatedAt;

    const mergedPlSummary = {
      stocks: {
        realized: statementData.plSummary.stocks.realized,
        unrealized: liveData.plSummary.stocks.unrealized,
        total: statementData.plSummary.stocks.realized + liveData.plSummary.stocks.unrealized,
      },
      options: {
        realized: statementData.plSummary.options.realized,
        unrealized: liveData.plSummary.options.unrealized,
        total: statementData.plSummary.options.realized + liveData.plSummary.options.unrealized,
      },
      forex: {
        realized: statementData.plSummary.forex.realized,
        unrealized: liveData.plSummary.forex.unrealized,
        total: statementData.plSummary.forex.realized + liveData.plSummary.forex.unrealized,
      },
      total: {
        realized: statementData.plSummary.total.realized,
        unrealized: liveData.plSummary.total.unrealized,
        total: statementData.plSummary.total.realized + liveData.plSummary.total.unrealized,
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
    };
  }, []);

  const loadCurrentGatewaySnapshot = useCallback(async (): Promise<ParsedData | null> => {
    const response = await fetch('/api/ib/current', { method: 'POST' });

    if (!response.ok) {
      return null;
    }

    const liveData = await response.json();
    if (!liveData.positions || !liveData.nav) {
      return null;
    }

    return liveData as ParsedData;
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
      return <Dashboard data={parsedData} onReset={handleReset} onRefreshData={handleRefreshData} isRefreshing={isRefreshing} />;
    }

    return <FileUpload onFileSelect={handleFileChange} onLiveLoad={handleLiveLoad} />;
  };

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text-primary">
      {renderContent()}
    </div>
  );
};

export default App;
