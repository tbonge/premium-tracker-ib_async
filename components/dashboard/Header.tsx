
import React from 'react';
import { AccountInfo } from '../../types';
import { useLocalization } from '../../context/LocalizationContext';
import { RepeatIcon, ShareIcon } from '../../constants';

interface HeaderProps {
    accountInfo: AccountInfo;
    exchangeRates: { [currency: string]: number };
    selectedCurrency: string;
    onCurrencyChange: (currency: string) => void;
    onReset: () => void;
    onRefreshData: () => void;
    isRefreshing: boolean;
    onPublicViewClick: () => void;
}

const Header: React.FC<HeaderProps> = ({ accountInfo, exchangeRates, selectedCurrency, onCurrencyChange, onReset, onRefreshData, isRefreshing, onPublicViewClick }) => {
    const { t } = useLocalization();
    const displayCurrency = exchangeRates.USD ? 'USD' : selectedCurrency;

    return (
        <div className="flex flex-wrap justify-between items-center mb-6 gap-4">
            <div>
                <h1 className="text-3xl font-bold">{t('dashboard.header.title')}</h1>
                <p className="text-brand-text-secondary mt-1">{accountInfo.account} &bull; {accountInfo.period}</p>
            </div>
            <div className="flex items-center space-x-2">
                <button
                    onClick={() => onCurrencyChange(displayCurrency)}
                    className="px-3 py-1 text-sm font-semibold rounded-md bg-brand-accent text-white"
                    title={displayCurrency}
                >
                    {displayCurrency}
                </button>
                <button 
                    onClick={onPublicViewClick} 
                    className="p-2 bg-brand-card text-brand-text-secondary rounded-lg shadow-md hover:bg-brand-accent-hover hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-accent focus:ring-opacity-75"
                    title={t('publicDashboard.publicViewButtonTooltip')}
                >
                    <ShareIcon className="w-5 h-5" />
                </button>
                <button
                    onClick={onRefreshData}
                    disabled={isRefreshing}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-brand-card text-brand-text-secondary font-semibold rounded-lg shadow-md hover:bg-brand-accent-hover hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-accent focus:ring-opacity-75 disabled:opacity-60 disabled:cursor-not-allowed"
                    title={t('dashboard.header.refreshData')}
                >
                    <RepeatIcon className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
                    {isRefreshing ? t('dashboard.header.refreshingData') : t('dashboard.header.refreshData')}
                </button>
                <button onClick={onReset} className="px-4 py-2 bg-brand-accent text-white font-semibold rounded-lg shadow-md hover:bg-brand-accent-hover self-start">
                    {t('dashboard.header.analyzeNewFile')}
                </button>
            </div>
        </div>
    );
}

export default Header;
