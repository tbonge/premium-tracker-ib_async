
import React, { useCallback } from 'react';
import { Position } from '../../types';
import Tooltip from '../Tooltip';
import { useLocalization } from '../../context/LocalizationContext';
import SortableHeader from './SortableHeader';
import { useSortableRows } from './useSortableRows';

interface Totals {
    [key: string]: number;
}

interface EnhancedShortPut extends Position {
    assignmentCost: number;
    dte?: number;
    moneyness?: number;
    breakevenPrice?: number;
    stockPrice?: number;
}

interface EnhancedShortCall extends Position {
    dte?: number;
    moneyness?: number;
    breakevenPrice?: number;
    stockPrice?: number;
}

interface OpenPositionsProps {
    stockPositions: Position[];
    shortPuts: EnhancedShortPut[];
    shortCalls: EnhancedShortCall[];
    stockTotals: Totals;
    putTotals: Totals;
    callTotals: Totals;
    formatInSelectedCurrency: (value: number) => string;
    formatCurrency: (value: number, currency: string) => string;
}

const OpenPositions: React.FC<OpenPositionsProps> = ({
    stockPositions,
    shortPuts,
    shortCalls,
    stockTotals,
    putTotals,
    callTotals,
    formatInSelectedCurrency,
    formatCurrency
}) => {
    const { t } = useLocalization();
    type StockKey = 'symbol' | 'quantity' | 'closePrice' | 'costBasis' | 'value' | 'unrealizedPL';
    type OptionKey = 'symbol' | 'quantity' | 'strikePrice' | 'breakevenPrice' | 'moneyness' | 'dte' | 'collectedPremium' | 'unrealizedPL' | 'assignmentCost';
    const stockValue = useCallback((row: Position, key: StockKey) => row[key], []);
    const putValue = useCallback((row: EnhancedShortPut, key: OptionKey) => row[key as keyof EnhancedShortPut], []);
    const callValue = useCallback((row: EnhancedShortCall, key: OptionKey) => row[key as keyof EnhancedShortCall], []);
    const stocks = useSortableRows(stockPositions, 'symbol' as StockKey, stockValue);
    const puts = useSortableRows(shortPuts, 'symbol' as OptionKey, putValue);
    const calls = useSortableRows(shortCalls, 'symbol' as OptionKey, callValue);
    const stockHeader = (key: StockKey, label: React.ReactNode, right = true) => <SortableHeader column={key} activeColumn={stocks.sort.key} direction={stocks.sort.direction} onSort={stocks.requestSort} align={right ? 'right' : 'left'}>{label}</SortableHeader>;
    const putHeader = (key: OptionKey, label: React.ReactNode, right = true) => <SortableHeader column={key} activeColumn={puts.sort.key} direction={puts.sort.direction} onSort={puts.requestSort} align={right ? 'right' : 'left'}>{label}</SortableHeader>;
    const callHeader = (key: OptionKey, label: React.ReactNode, right = true) => <SortableHeader column={key} activeColumn={calls.sort.key} direction={calls.sort.direction} onSort={calls.requestSort} align={right ? 'right' : 'left'}>{label}</SortableHeader>;
    
    return (
    <div className="bg-brand-surface rounded-lg shadow-lg p-6">
        <h3 className="text-xl font-semibold mb-4">{t('dashboard.openPositions.title')}</h3>
        
        {/* Stocks */}
        <div>
            <h4 className="text-lg font-semibold mb-2 text-brand-text-secondary">{t('dashboard.openPositions.stocks.title')}</h4>
            <div className="overflow-x-auto pt-12 px-6">
                <table className="w-full text-left">
                    <thead>
                        <tr className="border-b border-brand-card">
                            {stockHeader('symbol', t('dashboard.openPositions.stocks.symbol'), false)}
                            {stockHeader('quantity', t('dashboard.openPositions.stocks.qty'))}
                            {stockHeader('closePrice',
                                <Tooltip content={t('dashboard.openPositions.stocks.currentPriceTooltip')}>
                                    <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t('dashboard.openPositions.stocks.currentPrice')}</span>
                                </Tooltip>)}
                            {stockHeader('costBasis',
                                <Tooltip content={t('dashboard.openPositions.stocks.costBasisTooltip')}>
                                    <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t('dashboard.openPositions.stocks.costBasis')}</span>
                                </Tooltip>)}
                            {stockHeader('value',
                                <Tooltip content={t('dashboard.openPositions.stocks.marketValueTooltip')}>
                                    <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t('dashboard.openPositions.stocks.marketValue')}</span>
                                </Tooltip>)}
                            {stockHeader('unrealizedPL',
                                <Tooltip align="right" content={t('dashboard.openPositions.stocks.unrealizedPLTooltip')}>
                                    <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t('dashboard.openPositions.stocks.unrealizedPL')}</span>
                                </Tooltip>)}
                        </tr>
                    </thead>
                    <tbody>
                        {stocks.sortedRows.map((p, i) => (
                            <tr key={i} className="border-b border-brand-card hover:bg-brand-card/50">
                                <td className="p-2 font-mono">{p.symbol}</td>
                                <td className="p-2 font-mono text-right">{p.quantity}</td>
                                <td className="p-2 font-mono text-right">{formatCurrency(p.closePrice, p.currency)}</td>
                                <td className="p-2 font-mono text-right">{formatInSelectedCurrency(p.costBasis)}</td>
                                <td className="p-2 font-mono text-right">{formatInSelectedCurrency(p.value)}</td>
                                <td className={`p-2 font-mono text-right ${p.unrealizedPL >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>
                                    {formatInSelectedCurrency(p.unrealizedPL)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr className="bg-brand-card/20 font-semibold">
                            <td colSpan={3} className="p-2">{t('dashboard.openPositions.total')}</td>
                            <td className="p-2 font-mono text-right">{formatInSelectedCurrency(stockTotals.costBasis)}</td>
                            <td className="p-2 font-mono text-right">{formatInSelectedCurrency(stockTotals.value)}</td>
                            <td className={`p-2 font-mono text-right ${stockTotals.unrealizedPL >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>
                                {formatInSelectedCurrency(stockTotals.unrealizedPL)}
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>

        {/* Puts */}
        <div className="mt-6">
            <h4 className="text-lg font-semibold mb-2 text-brand-text-secondary">{t('dashboard.openPositions.puts.title')}</h4>
            <div className="overflow-x-auto pt-12 px-6">
                <table className="w-full text-left">
                    <thead>
                        <tr className="border-b border-brand-card">
                            {putHeader('symbol', t('dashboard.openPositions.puts.symbol'), false)}
                            {putHeader('quantity', t('dashboard.openPositions.puts.qty'))}
                            {putHeader('strikePrice', t('dashboard.openPositions.puts.strike'))}
                            {putHeader('breakevenPrice',
                                <Tooltip content={t('dashboard.openPositions.puts.breakevenTooltip')}>
                                    <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t('dashboard.openPositions.puts.breakeven')}</span>
                                </Tooltip>)}
                            {putHeader('moneyness',
                                <Tooltip content={t('dashboard.openPositions.puts.moneynessTooltip')}>
                                    <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t('dashboard.openPositions.puts.moneyness')}</span>
                                </Tooltip>)}
                            {putHeader('dte',
                                <Tooltip content={t('dashboard.openPositions.puts.dteTooltip')}>
                                    <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t('dashboard.openPositions.puts.dte')}</span>
                                </Tooltip>)}
                            {putHeader('collectedPremium',
                                <Tooltip content={t('dashboard.openPositions.puts.premiumTooltip')}>
                                    <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t('dashboard.openPositions.puts.premium')}</span>
                                </Tooltip>)}
                            {putHeader('unrealizedPL', t('dashboard.openPositions.puts.unrealizedPL'))}
                            {putHeader('assignmentCost',
                                <Tooltip align="right" content={t('dashboard.openPositions.puts.assignmentCostTooltip')}>
                                    <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t('dashboard.openPositions.puts.assignmentCost')}</span>
                                </Tooltip>)}
                        </tr>
                    </thead>
                    <tbody>
                        {puts.sortedRows.map((p, i) => {
                            const moneynessTooltip = p.stockPrice !== undefined
                                ? t('dashboard.openPositions.puts.moneynessPriceAvailable', { baseSymbol: p.baseSymbol, price: formatCurrency(p.stockPrice, p.currency) })
                                : t('dashboard.openPositions.puts.moneynessPriceUnavailable', { baseSymbol: p.baseSymbol });

                            return (
                                <tr key={i} className="border-b border-brand-card hover:bg-brand-card/50">
                                    <td className="p-2 font-mono">{p.symbol}</td>
                                    <td className="p-2 font-mono text-right">{p.quantity}</td>
                                    <td className="p-2 font-mono text-right">{formatCurrency(p.strikePrice!, p.currency)}</td>
                                    <td className="p-2 font-mono text-right">
                                        {p.breakevenPrice !== undefined ? formatCurrency(p.breakevenPrice, p.currency) : '-'}
                                    </td>
                                    <td className={`p-2 font-mono text-right ${p.moneyness === undefined ? '' : p.moneyness > 0 ? 'text-brand-success' : 'text-brand-danger'}`}>
                                        {p.moneyness !== undefined ? (
                                            <Tooltip content={moneynessTooltip}>
                                                <span className="border-b border-dotted border-brand-text-secondary cursor-help">
                                                    {p.moneyness.toLocaleString('en-US', { style: 'percent', minimumFractionDigits: 2 })}
                                                </span>
                                            </Tooltip>
                                        ) : (
                                            <Tooltip content={moneynessTooltip}>
                                                <span className="cursor-help text-brand-text-secondary">-</span>
                                            </Tooltip>
                                        )}
                                    </td>
                                    <td className="p-2 font-mono text-right">{p.dte}</td>
                                    <td className="p-2 font-mono text-right">{formatInSelectedCurrency(p.collectedPremium || 0)}</td>
                                    <td className={`p-2 font-mono text-right ${p.unrealizedPL >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>
                                        {formatInSelectedCurrency(p.unrealizedPL)}
                                    </td>
                                    <td className="p-2 font-mono text-right">{formatInSelectedCurrency(p.assignmentCost)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot>
                        <tr className="bg-brand-card/20 font-semibold">
                            <td colSpan={6} className="p-2">{t('dashboard.openPositions.total')}</td>
                            <td className="p-2 font-mono text-right">{formatInSelectedCurrency(putTotals.collectedPremium)}</td>
                            <td className={`p-2 font-mono text-right ${putTotals.unrealizedPL >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>
                                {formatInSelectedCurrency(putTotals.unrealizedPL)}
                            </td>
                            <td className="p-2 font-mono text-right">{formatInSelectedCurrency(putTotals.assignmentCost)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>

        {/* Calls */}
        <div className="mt-6">
            <h4 className="text-lg font-semibold mb-2 text-brand-text-secondary">{t('dashboard.openPositions.calls.title')}</h4>
            <div className="overflow-x-auto pt-12 px-6">
                <table className="w-full text-left">
                    <thead>
                        <tr className="border-b border-brand-card">
                            {callHeader('symbol', t('dashboard.openPositions.calls.symbol'), false)}
                            {callHeader('quantity', t('dashboard.openPositions.calls.qty'))}
                            {callHeader('strikePrice', t('dashboard.openPositions.calls.strike'))}
                            {callHeader('breakevenPrice',
                                <Tooltip content={t('dashboard.openPositions.calls.breakevenTooltip')}>
                                    <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t('dashboard.openPositions.calls.breakeven')}</span>
                                </Tooltip>)}
                            {callHeader('moneyness',
                                <Tooltip content={t('dashboard.openPositions.calls.moneynessTooltip')}>
                                    <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t('dashboard.openPositions.calls.moneyness')}</span>
                                </Tooltip>)}
                            {callHeader('dte',
                                <Tooltip content={t('dashboard.openPositions.calls.dteTooltip')}>
                                    <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t('dashboard.openPositions.calls.dte')}</span>
                                </Tooltip>)}
                            {callHeader('collectedPremium',
                                <Tooltip content={t('dashboard.openPositions.calls.premiumTooltip')}>
                                    <span className="border-b border-dotted border-brand-text-secondary cursor-help">{t('dashboard.openPositions.calls.premium')}</span>
                                </Tooltip>)}
                            {callHeader('unrealizedPL', t('dashboard.openPositions.calls.unrealizedPL'))}
                        </tr>
                    </thead>
                    <tbody>
                        {calls.sortedRows.map((p, i) => {
                             const moneynessTooltip = p.stockPrice !== undefined
                                ? t('dashboard.openPositions.calls.moneynessPriceAvailable', { baseSymbol: p.baseSymbol, price: formatCurrency(p.stockPrice, p.currency) })
                                : t('dashboard.openPositions.calls.moneynessPriceUnavailable', { baseSymbol: p.baseSymbol });

                            return (
                                <tr key={i} className="border-b border-brand-card hover:bg-brand-card/50">
                                    <td className="p-2 font-mono">{p.symbol}</td>
                                    <td className="p-2 font-mono text-right">{p.quantity}</td>
                                    <td className="p-2 font-mono text-right">{formatCurrency(p.strikePrice!, p.currency)}</td>
                                    <td className="p-2 font-mono text-right">
                                        {p.breakevenPrice !== undefined ? formatCurrency(p.breakevenPrice, p.currency) : '-'}
                                    </td>
                                    <td className={`p-2 font-mono text-right ${p.moneyness === undefined ? '' : p.moneyness > 0 ? 'text-brand-danger' : 'text-brand-success'}`}>
                                        {p.moneyness !== undefined ? (
                                            <Tooltip content={moneynessTooltip}>
                                                <span className="border-b border-dotted border-brand-text-secondary cursor-help">
                                                    {p.moneyness.toLocaleString('en-US', { style: 'percent', minimumFractionDigits: 2 })}
                                                </span>
                                            </Tooltip>
                                        ) : (
                                            <Tooltip content={moneynessTooltip}>
                                                <span className="cursor-help text-brand-text-secondary">-</span>
                                            </Tooltip>
                                        )}
                                    </td>
                                    <td className="p-2 font-mono text-right">{p.dte}</td>
                                    <td className="p-2 font-mono text-right">{formatInSelectedCurrency(p.collectedPremium || 0)}</td>
                                    <td className={`p-2 font-mono text-right ${p.unrealizedPL >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>
                                        {formatInSelectedCurrency(p.unrealizedPL)}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot>
                        <tr className="bg-brand-card/20 font-semibold">
                            <td colSpan={6} className="p-2">{t('dashboard.openPositions.total')}</td>
                            <td className="p-2 font-mono text-right">{formatInSelectedCurrency(callTotals.collectedPremium)}</td>
                            <td className={`p-2 font-mono text-right ${callTotals.unrealizedPL >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}>
                                {formatInSelectedCurrency(callTotals.unrealizedPL)}
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    </div>
)};

export default OpenPositions;
