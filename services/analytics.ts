import { CASH_SETTLED_INDEX_SYMBOLS } from '../constants';
import { Position } from '../types';
import { calendarDte } from '../utils/dates';

export interface EnhancedShortOption extends Position {
    dte?: number;
    moneyness?: number;
    breakevenPrice?: number;
    stockPrice?: number;
    protectiveStrike?: number;
    maxLoss?: number;
    shareAssignmentCost?: number;
    protectedContracts?: number;
    isCashSettled?: boolean;
    expirationOutcome?: 'unknown' | 'expires' | 'shares' | 'defined-loss';
}

type ProtectionLeg = {
    position: Position;
    remaining: number;
    premiumPerContract: number;
    valuePerContract: number;
    unrealizedPerContract: number;
};

export const isCashSettledIndex = (baseSymbol?: string): boolean =>
    CASH_SETTLED_INDEX_SYMBOLS.includes((baseSymbol || '').toUpperCase());

export const buildStockPriceMap = (positions: Position[]): Map<string, number> => {
    const stockPriceMap = new Map<string, number>();
    positions.filter(position => !position.isOption).forEach(position => {
        if (position.closePrice > 0) stockPriceMap.set(position.symbol, position.closePrice);
    });
    positions.forEach(position => {
        if (position.isOption && position.baseSymbol && position.underlyingPrice && position.underlyingPrice > 0 && !stockPriceMap.has(position.baseSymbol)) {
            stockPriceMap.set(position.baseSymbol, position.underlyingPrice);
        }
    });
    return stockPriceMap;
};

const buildProtectionLegs = (positions: Position[], optionType: 'P' | 'C'): ProtectionLeg[] =>
    positions
        .filter(position => position.isOption && position.optionType === optionType && position.quantity > 0 && position.strikePrice)
        .map(position => ({
            position,
            remaining: position.quantity,
            premiumPerContract: (position.collectedPremium || 0) / position.quantity,
            valuePerContract: position.value / position.quantity,
            unrealizedPerContract: position.unrealizedPL / position.quantity,
        }));

const premiumInPositionCurrency = (premiumInBase: number, position: Position, baseCurrency: string, exchangeRates: Record<string, number>) => {
    if (position.currency === baseCurrency) return premiumInBase;
    const rate = exchangeRates[position.currency];
    return rate ? premiumInBase / rate : 0;
};

export const buildEnhancedShortOptions = (
    positions: Position[],
    exchangeRates: Record<string, number>,
    baseCurrency: string,
    now: Date = new Date()
): { shortPuts: EnhancedShortOption[]; shortCalls: EnhancedShortOption[] } => {
    const stockPriceMap = buildStockPriceMap(positions);
    const protectivePuts = buildProtectionLegs(positions, 'P');
    const protectiveCalls = buildProtectionLegs(positions, 'C');

    const shortPuts = positions
        .filter(position => position.isOption && position.optionType === 'P' && position.quantity < 0)
        .sort((a, b) => (a.strikePrice || 0) - (b.strikePrice || 0))
        .map(position => {
            const exchangeRate = exchangeRates[position.currency] || 1;
            const stockPrice = stockPriceMap.get(position.baseSymbol);
            const shortContracts = Math.abs(position.quantity);
            let unprotectedContracts = shortContracts;
            let intrinsicRiskInOriginalCurrency = 0;
            let protectivePremiumInBase = 0;
            let protectiveValueInBase = 0;
            let protectiveUnrealizedInBase = 0;
            let protectiveStrike: number | undefined;
            const matchingProtection = protectivePuts
                .filter(long => long.remaining > 0
                    && long.position.baseSymbol === position.baseSymbol
                    && long.position.expiry === position.expiry
                    && long.position.currency === position.currency
                    && long.position.multiplier === position.multiplier
                    && (long.position.strikePrice || 0) < (position.strikePrice || 0))
                .sort((a, b) => (b.position.strikePrice || 0) - (a.position.strikePrice || 0));

            for (const long of matchingProtection) {
                const coveredContracts = Math.min(unprotectedContracts, long.remaining);
                protectiveStrike ??= long.position.strikePrice;
                intrinsicRiskInOriginalCurrency += ((position.strikePrice || 0) - (long.position.strikePrice || 0)) * coveredContracts * position.multiplier;
                protectivePremiumInBase += long.premiumPerContract * coveredContracts;
                protectiveValueInBase += long.valuePerContract * coveredContracts;
                protectiveUnrealizedInBase += long.unrealizedPerContract * coveredContracts;
                long.remaining -= coveredContracts;
                unprotectedContracts -= coveredContracts;
                if (unprotectedContracts <= 0) break;
            }

            intrinsicRiskInOriginalCurrency += (position.strikePrice || 0) * unprotectedContracts * position.multiplier;
            const netPremiumInBase = (position.collectedPremium || 0) + protectivePremiumInBase;
            const strategyRiskInBase = Math.max(0, intrinsicRiskInOriginalCurrency * exchangeRate - netPremiumInBase);
            const premiumPerShare = position.multiplier > 0
                ? premiumInPositionCurrency(netPremiumInBase, position, baseCurrency, exchangeRates) / (shortContracts * position.multiplier)
                : 0;
            const shareAssignmentCost = (position.strikePrice || 0) * shortContracts * position.multiplier * exchangeRate;
            const moneyness = stockPrice !== undefined && position.strikePrice ? (stockPrice - position.strikePrice) / position.strikePrice : undefined;
            const expirationOutcome = stockPrice === undefined || position.strikePrice === undefined
                ? 'unknown'
                : protectiveStrike !== undefined
                    ? stockPrice >= position.strikePrice
                        ? 'expires'
                        : stockPrice >= protectiveStrike ? 'shares' : 'defined-loss'
                    : stockPrice >= position.strikePrice ? 'expires' : 'shares';

            return {
                ...position,
                collectedPremium: netPremiumInBase,
                value: position.value + protectiveValueInBase,
                unrealizedPL: position.unrealizedPL + protectiveUnrealizedInBase,
                assignmentCost: shareAssignmentCost,
                maxLoss: unprotectedContracts === 0 ? strategyRiskInBase : undefined,
                shareAssignmentCost,
                expirationOutcome,
                isCashSettled: isCashSettledIndex(position.baseSymbol),
                protectedContracts: shortContracts - unprotectedContracts,
                protectiveStrike,
                dte: calendarDte(position.expiry, now),
                moneyness,
                breakevenPrice: position.strikePrice ? position.strikePrice - premiumPerShare : undefined,
                stockPrice
            };
        });

    const shortCalls = positions
        .filter(position => position.isOption && position.optionType === 'C' && position.quantity < 0)
        .sort((a, b) => (b.strikePrice || 0) - (a.strikePrice || 0))
        .map(position => {
            const exchangeRate = exchangeRates[position.currency] || 1;
            const stockPrice = stockPriceMap.get(position.baseSymbol);
            const shortContracts = Math.abs(position.quantity);
            let unprotectedContracts = shortContracts;
            let spreadWidthRiskInOriginalCurrency = 0;
            let protectivePremiumInBase = 0;
            let protectiveValueInBase = 0;
            let protectiveUnrealizedInBase = 0;
            let protectiveStrike: number | undefined;
            const matchingProtection = protectiveCalls
                .filter(long => long.remaining > 0
                    && long.position.baseSymbol === position.baseSymbol
                    && long.position.expiry === position.expiry
                    && long.position.currency === position.currency
                    && long.position.multiplier === position.multiplier
                    && (long.position.strikePrice || 0) > (position.strikePrice || 0))
                .sort((a, b) => (a.position.strikePrice || 0) - (b.position.strikePrice || 0));

            for (const long of matchingProtection) {
                const coveredContracts = Math.min(unprotectedContracts, long.remaining);
                protectiveStrike ??= long.position.strikePrice;
                spreadWidthRiskInOriginalCurrency += ((long.position.strikePrice || 0) - (position.strikePrice || 0)) * coveredContracts * position.multiplier;
                protectivePremiumInBase += long.premiumPerContract * coveredContracts;
                protectiveValueInBase += long.valuePerContract * coveredContracts;
                protectiveUnrealizedInBase += long.unrealizedPerContract * coveredContracts;
                long.remaining -= coveredContracts;
                unprotectedContracts -= coveredContracts;
                if (unprotectedContracts <= 0) break;
            }

            const netPremiumInBase = (position.collectedPremium || 0) + protectivePremiumInBase;
            const premiumPerShare = position.multiplier > 0
                ? premiumInPositionCurrency(netPremiumInBase, position, baseCurrency, exchangeRates) / (shortContracts * position.multiplier)
                : 0;

            return {
                ...position,
                collectedPremium: netPremiumInBase,
                value: position.value + protectiveValueInBase,
                unrealizedPL: position.unrealizedPL + protectiveUnrealizedInBase,
                maxLoss: unprotectedContracts === 0
                    ? Math.max(0, spreadWidthRiskInOriginalCurrency * exchangeRate - netPremiumInBase)
                    : undefined,
                isCashSettled: isCashSettledIndex(position.baseSymbol),
                protectedContracts: shortContracts - unprotectedContracts,
                protectiveStrike,
                dte: calendarDte(position.expiry, now),
                moneyness: stockPrice !== undefined && position.strikePrice ? (stockPrice - position.strikePrice) / position.strikePrice : undefined,
                breakevenPrice: position.strikePrice ? position.strikePrice + premiumPerShare : undefined,
                stockPrice
            };
        });

    return { shortPuts, shortCalls };
};

export const calculatePutCollateral = (positions: Position[], exchangeRates: Record<string, number>, baseCurrency: string): number => {
    const { shortPuts } = buildEnhancedShortOptions(positions, exchangeRates, baseCurrency);
    return shortPuts
        .filter(position => !position.isCashSettled)
        .reduce((sum, position) => sum + (position.maxLoss ?? position.assignmentCost), 0);
};
