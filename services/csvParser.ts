import { ParsedData, Position, ClosedPosition, ArocTrade, WheelCycle, WheelCycleAnalysis, WheelCycleTrade, PendingWheelCycle, MonthlySummary, WeeklySummary, TickerPL, NAVChange, ShortPutIncomeSummary, DailyOptionsSummary } from '../types';
import { DAYS_PER_YEAR, DEFAULT_OPTION_MULTIPLIER } from '../constants';

const safeParseFloat = (val: unknown): number => {
    if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
    if (!val || typeof val !== 'string') return 0;
    return parseFloat(val.replace(/,/g, '')) || 0;
};

const parseOptionSymbol = (symbol: string): { isOption: boolean; optionType?: 'P' | 'C'; strikePrice?: number, expiry?: string, baseSymbol: string } => {
    if (!symbol) {
        return { isOption: false, baseSymbol: '' };
    }
    const normalized = symbol.trim().replace(/\s+/g, ' ');
    const parts = normalized.split(' ');
    const fallbackBaseSymbol = parts[0] || normalized;

    const parseExpiry = (value?: string): string | undefined => {
        if (!value) return undefined;
        const dashed = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (dashed) {
            return `${dashed[1]}-${dashed[2].padStart(2, '0')}-${dashed[3].padStart(2, '0')}`;
        }
        const compact = value.match(/^(\d{2})(\d{2})(\d{2})$/) || value.match(/^(\d{4})(\d{2})(\d{2})$/);
        if (!compact) return undefined;
        const year = compact[1].length === 2 ? Number(compact[1]) + 2000 : Number(compact[1]);
        const month = Number(compact[2]);
        const day = Number(compact[3]);
        if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    };

    const parseStrike = (value?: string): number | undefined => {
        if (!value) return undefined;
        if (/^\d{8}$/.test(value)) {
            return Number(value) / 1000;
        }
        const parsed = safeParseFloat(value);
        return parsed > 0 ? parsed : undefined;
    };

    const makeResult = (baseParts: string[], expiryToken?: string, typeToken?: string, strikeToken?: string) => {
        const optionType = typeToken?.toUpperCase();
        const expiry = parseExpiry(expiryToken);
        const strikePrice = parseStrike(strikeToken);
        const baseSymbol = baseParts.join(' ').trim() || fallbackBaseSymbol;
        if ((optionType === 'P' || optionType === 'C') && expiry && strikePrice) {
            return { isOption: true, optionType, strikePrice, expiry, baseSymbol } as const;
        }
        return { isOption: false, baseSymbol };
    };

    const compactWhole = normalized.match(/^(.+?)[\s-]*(\d{6})([CP])(\d{8}|\d+(?:\.\d+)?)$/i);
    if (compactWhole) {
        return makeResult([compactWhole[1].trim()], compactWhole[2], compactWhole[3], compactWhole[4]);
    }

    const compactTail = parts[parts.length - 1]?.match(/^(\d{6})([CP])(\d{8}|\d+(?:\.\d+)?)$/i);
    if (compactTail && parts.length >= 2) {
        return makeResult(parts.slice(0, -1), compactTail[1], compactTail[2], compactTail[3]);
    }

    if (parts.length >= 4) {
        const last = parts[parts.length - 1]?.toUpperCase();
        if (last === 'P' || last === 'C') {
            return makeResult(parts.slice(0, -3), parts[parts.length - 3], last, parts[parts.length - 2]);
        }

        const typeBeforeStrike = parts[parts.length - 2]?.toUpperCase();
        if (typeBeforeStrike === 'P' || typeBeforeStrike === 'C') {
            return makeResult(parts.slice(0, -3), parts[parts.length - 3], typeBeforeStrike, parts[parts.length - 1]);
        }
    }
    
    return { isOption: false, baseSymbol: fallbackBaseSymbol };
};

const parseStatementDate = (value: unknown): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    const raw = String(value).trim();
    if (!raw) return null;

    const ymd = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[,\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (ymd) {
        return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), Number(ymd[4] || 12), Number(ymd[5] || 0), Number(ymd[6] || 0));
    }

    const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (mdy) {
        return new Date(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2]), Number(mdy[4] || 12), Number(mdy[5] || 0), Number(mdy[6] || 0));
    }

    const parsed = new Date(raw.replace(',', ''));
    return isNaN(parsed.getTime()) ? null : parsed;
};

const rateFor = (exchangeRates: { [key: string]: number }, currency?: string): number => {
    if (!currency) return 1;
    const rate = exchangeRates[currency.trim().toUpperCase()];
    return rate && rate > 0 ? rate : 1;
};

const setExchangeRate = (
    exchangeRates: { [currency: string]: number },
    currency: string | undefined,
    rate: number,
    baseCurrency: string,
    warnings: string[]
) => {
    const code = currency?.trim().toUpperCase();
    if (!code || code === baseCurrency) return;
    if (!Number.isFinite(rate) || rate <= 0) {
        warnings.push(`Ignored invalid FX rate for ${code}.`);
        return;
    }
    if (rate > 1000) {
        warnings.push(`Suspicious FX rate for ${code}: ${rate}. Check IB rate direction.`);
    }
    exchangeRates[code] = rate;
};

const parseForexRateRow = (row: Record<string, string>, baseCurrency: string): { currency: string; rate: number } | null => {
    const symbol = (row['Symbol'] || row['Currency'] || '').trim().toUpperCase();
    const price = safeParseFloat(row['Current Price'] || row['Close Price'] || row['Rate']);
    if (!symbol || price <= 0) return null;

    const pairParts = symbol.includes('.') || symbol.includes('/')
        ? symbol.split(/[./]/)
        : symbol.length === 6 ? [symbol.slice(0, 3), symbol.slice(3)] : null;

    if (pairParts?.length === 2) {
        const [base, quote] = pairParts;
        if (quote === baseCurrency) return { currency: base, rate: price };
        if (base === baseCurrency) return { currency: quote, rate: 1 / price };
        return null;
    }

    if (/^[A-Z]{3}$/.test(symbol)) {
        return { currency: symbol, rate: price };
    }

    return null;
};

const inferCashReportRate = (row: Record<string, string>, baseCurrency: string): { currency: string; rate: number } | null => {
    const currency = row['Currency']?.trim().toUpperCase();
    if (!currency || currency === baseCurrency) return null;
    const nativeTotal = safeParseFloat(row['Total'] || row['Ending Cash'] || row['Cash']);
    if (!nativeTotal) return null;

    const baseKey = Object.keys(row).find(key => {
        const lower = key.toLowerCase();
        return lower.includes(baseCurrency.toLowerCase()) && (lower.includes('total') || lower.includes('base'));
    });
    if (!baseKey) return null;

    const baseTotal = safeParseFloat(row[baseKey]);
    if (!baseTotal) return null;
    return { currency, rate: Math.abs(baseTotal / nativeTotal) };
};

const collectCurrencies = (sections: { [key: string]: Record<string, string>[] }, baseCurrency: string): Set<string> => {
    const currencies = new Set<string>([baseCurrency]);
    Object.values(sections).flat().forEach(row => {
        const currency = row['Currency']?.trim().toUpperCase();
        if (currency) currencies.add(currency);
    });
    return currencies;
};

const parseCsvLine = (line: string): string[] => {
    const columns: string[] = [];
    // This regex handles comma-separated values, including values enclosed in double quotes that may contain commas.
    const regex = /("([^"]*)"|[^,]*)(,|$)/g;
    line.replace(regex, (fullMatch, value, quotedValue) => {
        // If quotedValue is not undefined, it means the value was in quotes.
        // Otherwise, use the non-quoted value.
        columns.push(quotedValue !== undefined ? quotedValue : value);
        return ''; // The return value for replace is not used here.
    });
    // If the last column is empty, the regex might not pick it up, so we check for a trailing comma.
    if (line.endsWith(',')) {
        columns.push('');
    }
    return columns;
};

function analyzeShortOptionIncome(trades: any[], exchangeRates: { [key: string]: number }, optionTypeToMatch: 'P' | 'C'): ShortPutIncomeSummary {
    if (!trades) {
        return { totalRealizedPL: 0, numberOfContracts: 0, averagePLPerContract: 0, hasData: false };
    }

    const closedShortPuts = trades.filter(r => {
        const { isOption, optionType } = parseOptionSymbol(r.Symbol);
        if (!isOption || optionType !== optionTypeToMatch || r['DataDiscriminator'] !== 'Order') {
            return false;
        }

        const code = r.Code || '';
        const quantity = safeParseFloat(r['Quantity']);

        // Expired short puts (quantity is positive)
        const isExpired = code.includes('Ep');
        
        // Bought-to-close short puts (quantity is positive)
        const isBoughtToClose = code.includes('C') && quantity > 0;

        return isExpired || isBoughtToClose;
    });

    if (closedShortPuts.length === 0) {
        return { totalRealizedPL: 0, numberOfContracts: 0, averagePLPerContract: 0, hasData: false };
    }

    let totalRealizedPL = 0;
    let numberOfContracts = 0;

    for (const trade of closedShortPuts) {
        const currency = trade['Currency'];
        const rate = rateFor(exchangeRates, currency);
        
        // For expired puts, realized P/L is the premium.
        // For bought-to-close, it is the net profit.
        const realizedPL = safeParseFloat(trade['Realized P/L']) * rate;
        totalRealizedPL += realizedPL;

        // Quantity will be positive for closing trades
        const quantity = safeParseFloat(trade['Quantity']);
        numberOfContracts += quantity;
    }

    const averagePLPerContract = numberOfContracts > 0 ? totalRealizedPL / numberOfContracts : 0;
    
    return {
        totalRealizedPL,
        numberOfContracts,
        averagePLPerContract,
        hasData: true
    };
}

function analyzeMonthlySummary(
    trades: any[],
    forexPlDetails: any[],
    syepInterest: any[], 
    brokerInterest: any[],
    otherFees: any[],
    cashReport: any[],
    exchangeRates: { [key: string]: number }
): MonthlySummary[] {
    const summaryByMonth: { [month: string]: { optionsPL: number; optionsPremium: number; stocksPL: number; forexPL: number; syepIncome: number; interest: number; commissions: number; fees: number; interestPaid: number; salesTax: number; } } = {};

    const getMonthKey = (date: Date): string => {
        return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
    };
    
    const ensureMonthKey = (key: string) => {
        if (!summaryByMonth[key]) {
            summaryByMonth[key] = { optionsPL: 0, optionsPremium: 0, stocksPL: 0, forexPL: 0, syepIncome: 0, interest: 0, commissions: 0, fees: 0, interestPaid: 0, salesTax: 0 };
        }
    };

    // 1. Realized P/L from trades
    const realizedPlTrades = (trades || []).filter(r => r['DataDiscriminator'] === 'Order');

    for (const trade of realizedPlTrades) {
        const date = parseStatementDate(trade['Date/Time']);
        if (!date) continue;

        const monthKey = getMonthKey(date);
        ensureMonthKey(monthKey);
        
        const currency = trade['Currency'];
        const rate = rateFor(exchangeRates, currency);
        const category = trade['Asset Category'];

        if (category === 'Equity and Index Options' || category === 'Stocks') {
            const realizedPL = safeParseFloat(trade['Realized P/L']) * rate;
            if (realizedPL !== 0) {
                if (category === 'Equity and Index Options') {
                    summaryByMonth[monthKey].optionsPL += realizedPL;
                } else {
                    summaryByMonth[monthKey].stocksPL += realizedPL;
                }
            }
        } else if (category === 'Forex') {
            // MTM P/L is used for Forex spot conversions as Realized P/L is often missing/zero.
            const mtmPlKey = Object.keys(trade).find(k => k.startsWith('MTM'));
            if (mtmPlKey) {
                const mtmPL = safeParseFloat(trade[mtmPlKey]);
                summaryByMonth[monthKey].forexPL += mtmPL;
            }
        }
    }


    // 1b. Realized P/L from Forex P/L Details section (currency fluctuations)
    if (forexPlDetails) {
        const forexRows = forexPlDetails.filter(r => r['Realized P/L'] && safeParseFloat(r['Realized P/L']) !== 0);
        for (const row of forexRows) {
            const date = parseStatementDate(row['Date']);
            if (!date) continue;

            const monthKey = getMonthKey(date);
            ensureMonthKey(monthKey);

            // In this section, P/L is already in the base currency.
            const realizedPL = safeParseFloat(row['Realized P/L']);
            summaryByMonth[monthKey].forexPL += realizedPL;
        }
    }
    
    // 2. Options Premium from Opening Trades (Income)
    const optionOpeningTrades = (trades || []).filter(r => 
        r['Asset Category'] === 'Equity and Index Options' &&
        r.Code?.includes('O') && // Opening trade
        safeParseFloat(r.Quantity) < 0 // Selling
    );

    for (const trade of optionOpeningTrades) {
        const date = parseStatementDate(trade['Date/Time']);
        if (!date) continue;
        
        const monthKey = getMonthKey(date);
        ensureMonthKey(monthKey);
        
        const currency = trade['Currency'];
        const rate = rateFor(exchangeRates, currency);
        const proceeds = safeParseFloat(trade['Proceeds']) * rate;
        const commFee = safeParseFloat(trade['Comm/Fee']) * rate; // comm/fee is usually negative

        summaryByMonth[monthKey].optionsPremium += (proceeds + commFee);
    }

    // 3. SYEP Income
    if (syepInterest) {
        const syepRows = syepInterest.filter(r => r['Value Date'] && r['Interest Paid to Customer']);
        for (const row of syepRows) {
            const date = parseStatementDate(row['Value Date']);
            if (!date) continue;
            
            const monthKey = getMonthKey(date);
            ensureMonthKey(monthKey);
            
            const currency = row['Currency'];
            const rate = rateFor(exchangeRates, currency);
            const interest = safeParseFloat(row['Interest Paid to Customer']) * rate;

            summaryByMonth[monthKey].syepIncome += interest;
        }
    }

    // 4. Broker Interest
    if (brokerInterest) {
        const interestRows = brokerInterest.filter(r => r['Date'] && r['Amount']);
        for (const row of interestRows) {
            const date = parseStatementDate(row['Date']);
            if (!date) continue;

            const monthKey = getMonthKey(date);
            ensureMonthKey(monthKey);

            const currency = row['Currency'];
            const rate = rateFor(exchangeRates, currency);
            const amount = safeParseFloat(row['Amount']) * rate;

            // Interest can be debit (negative) or credit (positive).
            // This is for net interest (income/pl charts)
            summaryByMonth[monthKey].interest += amount;
            
            // Also track paid interest separately for the costs chart.
            if (amount < 0) {
                summaryByMonth[monthKey].interestPaid += Math.abs(amount);
            }
        }
    }
    
    // 5. Commissions from all trades
    const allOrderTrades = (trades || []).filter(r => r['DataDiscriminator'] === 'Order');
    for (const trade of allOrderTrades) {
        const date = parseStatementDate(trade['Date/Time']);
        if (!date) continue;

        const monthKey = getMonthKey(date);
        ensureMonthKey(monthKey);

        const currency = trade['Currency'];
        const rate = rateFor(exchangeRates, currency);
        
        const commissionKey = Object.keys(trade).find(k => k.toLowerCase().startsWith('comm'));
        if(commissionKey) {
            const commission = safeParseFloat(trade[commissionKey]); // This is negative
            summaryByMonth[monthKey].commissions += Math.abs(commission * rate);
        }
    }
    
    // 6. Other Fees
    if (otherFees) {
        const feeRows = otherFees.filter(r => r['Date'] && r['Amount']);
        for (const row of feeRows) {
            const date = parseStatementDate(row['Date']);
            if (!date) continue;

            const monthKey = getMonthKey(date);
            ensureMonthKey(monthKey);
            
            const currency = row['Currency'];
            const rate = rateFor(exchangeRates, currency);
            const amount = safeParseFloat(row['Amount']); // Charges are negative; refunds are positive.
            summaryByMonth[monthKey].fees -= amount * rate;
        }
    }

    // 7. Sales Tax
    let totalSalesTax = 0;
    if (cashReport) {
        // Find sales tax rows which summarize the total tax without a date.
        const taxRows = cashReport.filter(r => r['Currency Summary'] === 'Sales Tax');
        for (const row of taxRows) {
            const currency = row['Currency'];
            const rate = rateFor(exchangeRates, currency);
            const amount = safeParseFloat(row['Total']); // This is negative
            totalSalesTax += Math.abs(amount * rate);
        }
    }

    if (totalSalesTax > 0) {
        const totalCommissions = Object.values(summaryByMonth).reduce((sum, month) => sum + month.commissions, 0);

        if (totalCommissions > 0) {
            // Distribute tax proportionally to monthly commissions, as a reasonable proxy.
            for (const monthKey in summaryByMonth) {
                const monthCommissions = summaryByMonth[monthKey].commissions;
                const commissionRatio = monthCommissions / totalCommissions;
                summaryByMonth[monthKey].salesTax = totalSalesTax * commissionRatio;
            }
        } else if (Object.keys(summaryByMonth).length > 0) {
            // Fallback: if no commissions, distribute evenly across active months.
            const monthlyTax = totalSalesTax / Object.keys(summaryByMonth).length;
            for (const monthKey in summaryByMonth) {
                summaryByMonth[monthKey].salesTax = monthlyTax;
            }
        }
    }

    // Convert to array and sort
    return Object.entries(summaryByMonth)
        .map(([month, data]) => ({
            month,
            ...data
        }))
        .sort((a, b) => a.month.localeCompare(b.month));
}

function formatDateKey(date: Date): string {
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}

function parseDateKey(value: string): Date | null {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

function analyzeDailyOptionsSummary(
    trades: any[],
    exchangeRates: { [key: string]: number }
): DailyOptionsSummary[] {
    const optionTrades = (trades || [])
        .filter(r => r['DataDiscriminator'] === 'Order' && r['Asset Category'] === 'Equity and Index Options')
        .map(trade => ({
            ...trade,
            parsedDate: parseStatementDate(trade['Date/Time']),
        }))
        .filter(trade => trade.parsedDate !== null);

    if (optionTrades.length === 0) {
        return [];
    }

    const endDate = new Date(Math.max(...optionTrades.map(trade => trade.parsedDate!.getTime())));
    endDate.setHours(0, 0, 0, 0);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 29);

    const summaryByDate: Record<string, DailyOptionsSummary> = {};
    for (let i = 0; i < 30; i++) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + i);
        const key = formatDateKey(date);
        summaryByDate[key] = { date: key, premiumCollected: 0, closedPL: 0 };
    }

    for (const trade of optionTrades) {
        const tradeDate = new Date(trade.parsedDate!);
        tradeDate.setHours(0, 0, 0, 0);
        if (tradeDate < startDate || tradeDate > endDate) {
            continue;
        }

        const { isOption, optionType } = parseOptionSymbol(trade.Symbol);
        if (!isOption || (optionType !== 'P' && optionType !== 'C')) {
            continue;
        }

        const key = formatDateKey(tradeDate);
        const summary = summaryByDate[key];
        const code = trade.Code || '';
        const quantity = safeParseFloat(trade.Quantity);
        const rate = rateFor(exchangeRates, trade.Currency);

        if (quantity < 0 && code.includes('O')) {
            summary.premiumCollected += (safeParseFloat(trade.Proceeds) + safeParseFloat(trade['Comm/Fee'])) * rate;
        } else if (quantity > 0 && !code.includes('A') && (code.includes('C') || code.includes('Ep'))) {
            summary.closedPL += safeParseFloat(trade['Realized P/L']) * rate;
        }
    }

    return Object.values(summaryByDate);
}

function weeklyDateKey(value: string): string | null {
    if (!value) return null;
    const date = parseStatementDate(value);
    if (!date) return null;
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return formatDateKey(date);
}

function analyzeWeeklySummary(
    daily: DailyOptionsSummary[],
    trades: any[] = [],
    interestRows: any[] = [],
    feeRows: any[] = [],
    exchangeRates: { [key: string]: number }
): WeeklySummary[] {
    const weeks = new Map<string, WeeklySummary>();
    const ensure = (week: string): WeeklySummary => {
        if (!weeks.has(week)) weeks.set(week, { week, optionsPL: 0, optionsPremium: 0, stocksPL: 0, forexPL: 0, syepIncome: 0, interest: 0, interestPaid: 0, commissions: 0, fees: 0, salesTax: 0 });
        return weeks.get(week)!;
    };
    daily.forEach(row => {
        const week = weeklyDateKey(row.date);
        if (week) { const bucket = ensure(week); bucket.optionsPremium += row.premiumCollected; bucket.optionsPL += row.closedPL; }
    });
    trades.filter(row => row.DataDiscriminator === 'Order').forEach(row => {
        const week = weeklyDateKey(row['Date/Time']);
        if (!week) return;
        const bucket = ensure(week);
        const rate = rateFor(exchangeRates, row.Currency);
        bucket.commissions += Math.abs(safeParseFloat(row['Comm/Fee']) * rate);
        if (row['Asset Category'] === 'Stocks') bucket.stocksPL = (bucket.stocksPL || 0) + safeParseFloat(row['Realized P/L']) * rate;
    });
    interestRows.forEach(row => {
        const week = weeklyDateKey(row.Date || row['Value Date']);
        if (!week) return;
        const amount = safeParseFloat(row.Amount || row.Interest) * rateFor(exchangeRates, row.Currency);
        ensure(week).interest += amount;
        if (amount < 0) ensure(week).interestPaid += Math.abs(amount);
    });
    feeRows.forEach(row => {
        const week = weeklyDateKey(row.Date);
        if (week) ensure(week).fees -= safeParseFloat(row.Amount) * rateFor(exchangeRates, row.Currency);
    });
    return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
}


function analyzeWheelCycles(trades: any[], exchangeRates: { [key: string]: number }, baseCurrency: string, instrumentMultipliers: Map<string, number>, openPositions: Position[], cashTransactions: any[] = [], diagnostics?: ParsedData['importDiagnostics']): WheelCycleAnalysis {
    const completedCycles: WheelCycle[] = [];
    const stockLots = new Map<string, { quantity: number; costBasis: number; grossCostBasis: number; acquisitionDate: Date; coveredShares: number; lotIndex: number }[]>();
    const inProgressCycles = new Map<string, Partial<WheelCycle> & { lotIndex: number }>();
    const openShortPuts = new Map<string, any[]>();
    const pendingPutRollLogs = new Map<string, WheelCycleTrade[]>();

    const wheelIncomeEvents = (cashTransactions || [])
        .map(row => {
            const date = parseStatementDate(row['Date/Time'] || row['Date'] || row['Value Date']);
            const description = String(row['Description'] || row['Type'] || row['Currency Summary'] || '').toUpperCase();
            const symbol = String(row['Symbol'] || '').trim();
            const amount = safeParseFloat(row['Amount'] || row['Total'] || row['Interest Paid to Customer']);
            const rate = rateFor(exchangeRates, row['Currency']);
            const isWheelIncome = amount !== 0 && (
                description.includes('DIVIDEND') ||
                description.includes('SECURITIES LENT') ||
                description.includes('SYEP') ||
                description.includes('STOCK YIELD')
            );
            return date && isWheelIncome ? { date, symbol, description, amount: amount * rate } : null;
        })
        .filter((event): event is { date: Date; symbol: string; description: string; amount: number } => event !== null);

    const incomeForCycle = (symbol: string, startDate: string, endDate?: string) => {
        const start = parseDateKey(startDate);
        const end = endDate ? parseDateKey(endDate) : null;
        if (!start) return { amount: 0, logs: [] as WheelCycleTrade[] };
        const events = wheelIncomeEvents.filter(event => {
            if (event.symbol && event.symbol !== symbol) return false;
            if (!event.symbol && !event.description.includes(symbol.toUpperCase())) return false;
            if (event.date < start) return false;
            return !end || event.date <= end;
        });
        return {
            amount: events.reduce((sum, event) => sum + event.amount, 0),
            logs: events.map(event => ({
                date: formatDateKey(event.date),
                description: event.description.includes('DIVIDEND') ? `Dividend (${symbol})` : `Wheel Income (${symbol})`,
                amount: event.amount,
            }))
        };
    };

    const allTrades = trades
        .filter(r => r['DataDiscriminator'] === 'Order' && ['Stocks', 'Equity and Index Options'].includes(r['Asset Category']))
        .map(trade => ({
            ...trade,
            parsedDate: parseStatementDate(trade['Date/Time']),
        }))
        .filter(trade => trade.parsedDate !== null)
        .sort((a, b) => a.parsedDate!.getTime() - b.parsedDate!.getTime());

    for (const trade of allTrades) {
        const { baseSymbol, isOption, optionType, strikePrice } = parseOptionSymbol(trade.Symbol);
        const quantity = safeParseFloat(trade.Quantity);
        const code = trade.Code || '';
        const currency = trade['Currency'];
        const rate = rateFor(exchangeRates, currency);
        const commFee = safeParseFloat(trade['Comm/Fee']) * rate;
        const proceeds = safeParseFloat(trade.Proceeds) * rate;

        // Track opening of short puts
        if (isOption && optionType === 'P' && quantity < 0 && code.includes('O')) {
            if (!openShortPuts.has(trade.Symbol)) {
                openShortPuts.set(trade.Symbol, []);
            }
            // Add one record for each contract sold
            for (let i = 0; i < Math.abs(quantity); i++) {
                openShortPuts.get(trade.Symbol)?.push(trade);
            }
        }
        else if (isOption && optionType === 'P' && quantity > 0 && code.includes('C')) {
            const logs = pendingPutRollLogs.get(baseSymbol) || [];
            logs.push({
                date: trade.parsedDate.toISOString().split('T')[0],
                description: `Put Roll/Close (${trade.Symbol})`,
                amount: safeParseFloat(trade['Realized P/L']) * rate
            });
            pendingPutRollLogs.set(baseSymbol, logs);
        }
        // Put Assignment -> Stock Acquisition
        else if (isOption && optionType === 'P' && quantity > 0 && code.includes('A')) {
            const openTradeQueue = openShortPuts.get(trade.Symbol);
            const numContractsAssigned = quantity;

            if (openTradeQueue && openTradeQueue.length >= numContractsAssigned) {
                // FIFO for open trades.
                const matchedOpenTrades = openTradeQueue.splice(0, numContractsAssigned);

                // Calculate the premium from the original opening trade(s).
                let initialPutPremium = 0;
                for (const openTrade of matchedOpenTrades) {
                    const openProceeds = safeParseFloat(openTrade.Proceeds);
                    const openCommFee = safeParseFloat(openTrade['Comm/Fee']);
                    const openCurrency = openTrade['Currency'];
                    const openRate = rateFor(exchangeRates, openCurrency);
                    const contractsInOpeningTrade = Math.max(1, Math.abs(safeParseFloat(openTrade.Quantity)));
                    // Each queue entry represents one contract, while proceeds and fees are totals for the trade.
                    initialPutPremium += ((openProceeds + openCommFee) / contractsInOpeningTrade) * openRate;
                }

                const multiplier = instrumentMultipliers.get(trade.Symbol.trim()) || DEFAULT_OPTION_MULTIPLIER;
                const sharesAcquired = numContractsAssigned * multiplier;

                const grossStockCostBasis = (strikePrice! * sharesAcquired) * rate;
                const effectiveCostBasis = grossStockCostBasis - initialPutPremium;

                if (!stockLots.has(baseSymbol)) {
                    stockLots.set(baseSymbol, []);
                }
                const lotIndex = stockLots.get(baseSymbol)!.length;
                const newLot = {
                    quantity: sharesAcquired,
                    costBasis: effectiveCostBasis,
                    grossCostBasis: grossStockCostBasis,
                    acquisitionDate: trade.parsedDate,
                    coveredShares: 0,
                    lotIndex
                };
                stockLots.get(baseSymbol)?.push(newLot);

                inProgressCycles.set(`${baseSymbol}-${lotIndex}`, {
                    symbol: baseSymbol,
                    currency: currency,
                    initialPutPremium: initialPutPremium,
                    totalCallPremium: 0,
                    otherIncome: 0,
                    stockPL: 0,
                    startDate: trade.parsedDate.toISOString().split('T')[0],
                    lotIndex: lotIndex,
                    assignmentPrice: strikePrice!,
                    assignmentShares: sharesAcquired,
                    assignmentCost: grossStockCostBasis, // Store gross cost for transparency
                    netAssignmentCost: effectiveCostBasis,
                    tradeLog: [
                    ...(pendingPutRollLogs.get(baseSymbol) || []),
                    {
                        date: trade.parsedDate.toISOString().split('T')[0],
                        description: `Assigned ${sharesAcquired} shares @ ${strikePrice!.toFixed(2)}`,
                        amount: -grossStockCostBasis
                    }, {
                        date: trade.parsedDate.toISOString().split('T')[0],
                        description: `Put Premium Applied (${trade.Symbol})`,
                        amount: initialPutPremium
                    }]
                });
                pendingPutRollLogs.delete(baseSymbol);

            } else {
                if (diagnostics) {
                    diagnostics.unmatchedAssignments += 1;
                    diagnostics.warnings.push(`Could not match opening put sale for assignment ${trade.Symbol}; put premium was estimated as 0.`);
                }
                const putPremiumRealized = 0; // Fallback to 0 if no open trade is found
                const multiplier = instrumentMultipliers.get(trade.Symbol.trim()) || DEFAULT_OPTION_MULTIPLIER;
                const sharesAcquired = quantity * multiplier;
                const grossStockCostBasis = (strikePrice! * sharesAcquired) * rate;
                const effectiveCostBasis = grossStockCostBasis - putPremiumRealized;
                if (!stockLots.has(baseSymbol)) stockLots.set(baseSymbol, []);
                const lotIndex = stockLots.get(baseSymbol)!.length;
                const newLot = { quantity: sharesAcquired, costBasis: effectiveCostBasis, grossCostBasis: grossStockCostBasis, acquisitionDate: trade.parsedDate, coveredShares: 0, lotIndex };
                stockLots.get(baseSymbol)?.push(newLot);
                inProgressCycles.set(`${baseSymbol}-${lotIndex}`, {
                    symbol: baseSymbol, currency: currency, initialPutPremium: putPremiumRealized, totalCallPremium: 0, stockPL: 0,
                    otherIncome: 0,
                    startDate: trade.parsedDate.toISOString().split('T')[0], lotIndex: lotIndex, assignmentPrice: strikePrice!, assignmentShares: sharesAcquired,
                    assignmentCost: grossStockCostBasis,
                    netAssignmentCost: effectiveCostBasis,
                    tradeLog: [...(pendingPutRollLogs.get(baseSymbol) || []), { date: trade.parsedDate.toISOString().split('T')[0], description: `Assigned ${sharesAcquired} shares @ ${strikePrice!.toFixed(2)}`, amount: -grossStockCostBasis }]
                });
                pendingPutRollLogs.delete(baseSymbol);
            }
        }

        // Covered Call Premium
        else if (isOption && optionType === 'C' && quantity < 0 && code.includes('O')) {
            const contractsSold = Math.abs(quantity);
            const multiplier = instrumentMultipliers.get(trade.Symbol.trim()) || DEFAULT_OPTION_MULTIPLIER;
            let sharesToCover = contractsSold * multiplier;
            const totalPremiumForTrade = proceeds + commFee;

            const lotsForSymbol = stockLots.get(baseSymbol);

            if (lotsForSymbol) {
                for (let i = 0; i < lotsForSymbol.length; i++) {
                    if (sharesToCover <= 0) break;

                    const lot = lotsForSymbol[i];
                    const availableShares = lot.quantity - lot.coveredShares;
                    
                    if (availableShares > 0) {
                        const sharesInThisLotToCover = Math.min(sharesToCover, availableShares);
                        
                        const cycleKey = `${baseSymbol}-${lot.lotIndex}`;
                        const cycle = inProgressCycles.get(cycleKey);

                        if (cycle && cycle.tradeLog) {
                            // Apportion the premium based on shares being covered vs total shares in trade
                            const premiumForThisLot = totalPremiumForTrade * (sharesInThisLotToCover / (contractsSold * multiplier));

                            cycle.totalCallPremium = (cycle.totalCallPremium || 0) + premiumForThisLot;
                            cycle.tradeLog.push({
                                date: trade.parsedDate.toISOString().split('T')[0],
                                description: `Call Premium (${trade.Symbol})`,
                                amount: premiumForThisLot
                            });

                            lot.coveredShares += sharesInThisLotToCover;
                            sharesToCover -= sharesInThisLotToCover;
                        }
                    }
                }
            }
        }
        
        // Closing a short call (expiration or buy-to-close) -> makes a lot available again
        else if (isOption && optionType === 'C' && quantity > 0 && (code.includes('C') || code.includes('Ep'))) {
            const contractsClosed = quantity;
            const multiplier = instrumentMultipliers.get(trade.Symbol.trim()) || DEFAULT_OPTION_MULTIPLIER;
            let sharesToUncover = contractsClosed * multiplier;
            const totalCloseCashFlow = proceeds + commFee;
            
            const lotsForSymbol = stockLots.get(baseSymbol);

            if (lotsForSymbol) {
                // FIFO for un-covering
                for (let i = 0; i < lotsForSymbol.length; i++) {
                    if (sharesToUncover <= 0) break;
                    
                    const lot = lotsForSymbol[i];
                    if (lot.coveredShares > 0) {
                        const sharesInThisLotToUncover = Math.min(sharesToUncover, lot.coveredShares);
                        const cycle = inProgressCycles.get(`${baseSymbol}-${lot.lotIndex}`);
                        if (cycle && cycle.tradeLog) {
                            const amountForThisLot = totalCloseCashFlow * (sharesInThisLotToUncover / (contractsClosed * multiplier));
                            cycle.totalCallPremium = (cycle.totalCallPremium || 0) + amountForThisLot;
                            cycle.tradeLog.push({
                                date: trade.parsedDate.toISOString().split('T')[0],
                                description: `${code.includes('Ep') ? 'Call Expired/Closed' : 'Call Roll/Close'} (${trade.Symbol})`,
                                amount: amountForThisLot
                            });
                        }
                        lot.coveredShares -= sharesInThisLotToUncover;
                        sharesToUncover -= sharesInThisLotToUncover;
                    }
                }
            }
        }

        // Stock Sale (Called Away or Sold)
        else if ((code.includes('C') || code.includes('A')) && trade['Asset Category'] === 'Stocks' && quantity < 0) {
            const lots = stockLots.get(baseSymbol);
            if (lots && lots.length > 0) {
                const soldLot = lots.shift()!; // FIFO, has effectiveCostBasis
                const cycleKey = `${baseSymbol}-${soldLot.lotIndex}`;
                const cycle = inProgressCycles.get(cycleKey);

                if (cycle) {
                    const saleProceedsValue = proceeds + commFee;
                    const stockPLValue = saleProceedsValue - soldLot.grossCostBasis;
                    cycle.stockPL = stockPLValue;
                    cycle.salePrice = safeParseFloat(trade['T. Price']);
                    cycle.saleProceeds = saleProceedsValue;

                    if (cycle.tradeLog) {
                        cycle.tradeLog.push({
                            date: trade.parsedDate.toISOString().split('T')[0],
                            description: `Sold ${Math.abs(quantity)} shares`,
                            amount: saleProceedsValue
                        });
                    }

                    const endDate = trade.parsedDate;
                    const startDateText = cycle.startDate!;
                    const endDateText = endDate.toISOString().split('T')[0];
                    const income = incomeForCycle(baseSymbol, startDateText, endDateText);
                    const otherIncome = (cycle.otherIncome || 0) + income.amount;
                    if (cycle.tradeLog && income.logs.length > 0) {
                        cycle.tradeLog.push(...income.logs);
                    }
                    const totalPL = stockPLValue + (cycle.initialPutPremium || 0) + (cycle.totalCallPremium || 0) + otherIncome;

                    const startDate = new Date(cycle.startDate!);
                    const durationDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                    const effectiveDurationDays = durationDays > 0 ? durationDays : 1;
                    const returnOnCost = cycle.assignmentCost! > 0 ? totalPL / cycle.assignmentCost! : 0;

                    completedCycles.push({
                        symbol: baseSymbol,
                        currency: cycle.currency!,
                        initialPutPremium: cycle.initialPutPremium || 0,
                        totalCallPremium: cycle.totalCallPremium || 0,
                        otherIncome,
                        stockPL: stockPLValue,
                        totalPL: totalPL,
                        durationDays: effectiveDurationDays,
                        returnOnCost,
                        annualizedReturn: returnOnCost * (DAYS_PER_YEAR / effectiveDurationDays),
                        startDate: cycle.startDate!,
                        endDate: endDateText,
                        assignmentPrice: cycle.assignmentPrice!,
                        assignmentShares: cycle.assignmentShares!,
                        assignmentCost: cycle.assignmentCost!, // Gross cost
                        netAssignmentCost: cycle.netAssignmentCost!, // Net cost
                        salePrice: cycle.salePrice!,
                        saleProceeds: cycle.saleProceeds!,
                        tradeLog: cycle.tradeLog || []
                    });

                    inProgressCycles.delete(cycleKey);
                }
            }
        }
    }

    const pendingCycles: PendingWheelCycle[] = [];
    const stockPositionsMap = new Map<string, Position>(
        openPositions.filter(p => p.assetCategory === 'Stocks').map(p => [p.symbol, p])
    );

    for (const cycleInProgress of inProgressCycles.values()) {
        const stockPosition = stockPositionsMap.get(cycleInProgress.symbol!);
        if (stockPosition && stockPosition.quantity !== 0) {
            const pricePerShare = stockPosition.value / stockPosition.quantity;
            const currentStockValue = pricePerShare * cycleInProgress.assignmentShares!;
            
            const unrealizedStockPL = currentStockValue - cycleInProgress.netAssignmentCost!;
            const income = incomeForCycle(cycleInProgress.symbol!, cycleInProgress.startDate!);
            const otherIncome = (cycleInProgress.otherIncome || 0) + income.amount;
            const currentTotalPL = unrealizedStockPL + (cycleInProgress.totalCallPremium || 0) + otherIncome;
            const startDate = new Date(`${cycleInProgress.startDate!}T00:00:00`);
            const durationDays = Number.isFinite(startDate.getTime())
                ? Math.max(1, Math.round((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24)))
                : 1;

            pendingCycles.push({
                symbol: cycleInProgress.symbol!,
                currency: cycleInProgress.currency!,
                initialPutPremium: cycleInProgress.initialPutPremium || 0,
                startDate: cycleInProgress.startDate!,
                assignmentShares: cycleInProgress.assignmentShares!,
                assignmentPrice: cycleInProgress.assignmentPrice!,
                assignmentCost: cycleInProgress.assignmentCost!,
                netAssignmentCost: cycleInProgress.netAssignmentCost!,
                totalCallPremium: cycleInProgress.totalCallPremium || 0,
                otherIncome,
                annualizedReturn: cycleInProgress.assignmentCost! > 0 ? (currentTotalPL / cycleInProgress.assignmentCost!) * (DAYS_PER_YEAR / durationDays) : 0,
                currentStockValue,
                unrealizedStockPL,
                currentTotalPL,
                tradeLog: [...(cycleInProgress.tradeLog || []), ...income.logs]
            });
        }
    }

    return { completedCycles, pendingCycles };
}


export function parseIbkrCsv(csvString: string): ParsedData {
    const lines = csvString.split('\n').filter(line => line.trim() !== '');
    
    const sections: { [key: string]: Record<string, string>[] } = {};
    let currentSection = '';
    let headers: string[] = [];

    // More robust parser that handles multiple header rows within a single section (e.g., Trades section)
    const allData: {section: string, headers: string[], data: string[][]}[] = [];
    let currentBlock: {section: string, headers: string[], data: string[][]} | null = null;

    for (const line of lines) {
        const columns = parseCsvLine(line);
        if (columns.length < 2) continue;
        const sectionName = columns[0].trim();
        const dataType = columns[1].trim();

        if (dataType === 'Header') {
            if (currentBlock) {
                allData.push(currentBlock);
            }
            currentBlock = {
                section: sectionName,
                headers: columns.map(h => h.trim()),
                data: []
            };
        } else if (dataType === 'Data' && currentBlock) {
            currentBlock.data.push(columns);
        }
    }
    if (currentBlock) {
        allData.push(currentBlock);
    }

    for (const block of allData) {
        if (!sections[block.section]) {
            sections[block.section] = [];
        }
        const blockHeaders = block.headers;
        for (const dataRow of block.data) {
            const row: Record<string, string> = {};
            dataRow.forEach((col, i) => {
                if (blockHeaders[i]) {
                    row[blockHeaders[i]] = col.trim();
                }
            });
            sections[block.section].push(row);
        }
    }

    const data: ParsedData = {
        positions: [],
        closedPositions: [],
        nav: { cash: 0, baseCurrency: 'USD' },
        accountInfo: { baseCurrency: 'USD', account: '', name: '', period: '' },
        exchangeRates: {},
        plSummary: {
            stocks: { realized: 0, unrealized: 0, total: 0 },
            options: { realized: 0, unrealized: 0, total: 0 },
            forex: { realized: 0, unrealized: 0, total: 0 },
            total: { realized: 0, unrealized: 0, total: 0 },
        },
        rateOfReturn: 0,
        totalNAV: 0,
        arocAnalysis: { averageAroc: 0, trades: [] },
        optionsStrategyMetrics: { winRate: 0, assignmentRate: 0, totalClosed: 0, wins: 0 },
        wheelCycleAnalysis: { completedCycles: [], pendingCycles: [] },
        monthlySummary: [],
        weeklySummary: [],
        dailyOptionsSummary: [],
        tickerPL: [],
        navChange: {
            startingValue: 0,
            markToMarket: 0,
            depositsAndWithdrawals: 0,
            interest: 0,
            changeInInterestAccruals: 0,
            otherFees: 0,
            commissions: 0,
            salesTax: 0,
            otherFXTranslations: 0,
            endingValue: 0,
        },
        shortPutIncomeSummary: { totalRealizedPL: 0, numberOfContracts: 0, averagePLPerContract: 0, hasData: false },
        shortCallIncomeSummary: { totalRealizedPL: 0, numberOfContracts: 0, averagePLPerContract: 0, assignmentRate: 0, winRate: 0, hasData: false },
        historyStatus: { source: 'csv', complete: true, warnings: [] },
        marginLiquidity: {
            netLiquidation: 0, totalCash: 0, availableFunds: 0, excessLiquidity: 0,
            buyingPower: 0, maintenanceMargin: 0, initialMargin: 0, cushion: 0,
        },
        equityHistory: [],
        premiumEfficiency: [],
        closedTradeMetrics: [],
        importDiagnostics: {
            source: 'csv',
            totalRows: lines.length,
            parsedTrades: 0,
            parsedPositions: 0,
            parsedOptionContracts: 0,
            skippedRows: 0,
            missingMultipliers: 0,
            estimatedFxRows: 0,
            unparsedOptionSymbols: 0,
            unmatchedAssignments: 0,
            unlinkedRolls: 0,
            warnings: [],
        },
    };

     // Process Statement for Period
    if (sections['Statement']) {
        const periodRow = sections['Statement'].find(r => r['Field Name'] === 'Period');
        if (periodRow && periodRow['Field Value']) {
            data.accountInfo.period = periodRow['Field Value'];
        }
    }

    // Process Account Information to get Base Currency
    if (sections['Account Information']) {
        const infoMap = new Map(sections['Account Information'].map(r => [r['Field Name'], r['Field Value']]));
        
        const baseCurrency = infoMap.get('Base Currency');
        if (baseCurrency) {
            const normalizedBaseCurrency = baseCurrency.trim().toUpperCase();
            data.accountInfo.baseCurrency = normalizedBaseCurrency;
            data.nav.baseCurrency = normalizedBaseCurrency;
            data.exchangeRates[normalizedBaseCurrency] = 1;
        }
        data.accountInfo.account = infoMap.get('Account') || '';
        data.accountInfo.name = infoMap.get('Name') || '';
    }

    // Process Exchange Rates from Mark-to-Market section
    const fxWarnings = data.historyStatus?.warnings || [];
    if (sections['Mark-to-Market Performance Summary']) {
        const forexRows = sections['Mark-to-Market Performance Summary'].filter(r => r['Asset Category'] === 'Forex');
        forexRows.forEach(row => {
            const parsedRate = parseForexRateRow(row, data.accountInfo.baseCurrency);
            if (parsedRate) {
                setExchangeRate(data.exchangeRates, parsedRate.currency, parsedRate.rate, data.accountInfo.baseCurrency, fxWarnings);
            }
        });
    }

    if (sections['Cash Report']) {
        for (const row of sections['Cash Report']) {
            const parsedRate = inferCashReportRate(row, data.accountInfo.baseCurrency);
            if (parsedRate && !data.exchangeRates[parsedRate.currency]) {
                setExchangeRate(data.exchangeRates, parsedRate.currency, parsedRate.rate, data.accountInfo.baseCurrency, fxWarnings);
            }
        }
    }

    collectCurrencies(sections, data.accountInfo.baseCurrency).forEach(currency => {
        if (!data.exchangeRates[currency]) {
            data.exchangeRates[currency] = 1;
            if (currency !== data.accountInfo.baseCurrency) {
                fxWarnings.push(`Missing FX rate for ${currency}; using 1 ${currency} = 1 ${data.accountInfo.baseCurrency}.`);
                if (data.importDiagnostics) data.importDiagnostics.estimatedFxRows += 1;
            }
        }
    });

    // Process Trades to get signed opening premium/debit for open options.
    // Credits are positive, debits are negative; spread analytics depend on
    // long protective legs carrying their opening debit.
    const premiumMap: { [symbol: string]: number } = {};
    if (sections['Trades']) {
        if (data.importDiagnostics) {
            data.importDiagnostics.parsedTrades = sections['Trades'].filter(r => r['DataDiscriminator'] === 'Order').length;
        }
        const tradeRows = sections['Trades'].filter(
            r =>
                r['DataDiscriminator'] === 'Order' &&
                r['Asset Category'] === 'Equity and Index Options' &&
                r['Code']?.includes('O')
        );

        tradeRows.forEach(row => {
            const symbol = row['Symbol'];
            if (symbol) {
                const currency = row['Currency'];
                const exchangeRate = rateFor(data.exchangeRates, currency);
                // Proceeds are positive for sales (credits). Comm/Fee is negative.
                const proceeds = safeParseFloat(row['Proceeds']);
                const commFee = safeParseFloat(row['Comm/Fee']);
                const netPremium = proceeds + commFee;
                premiumMap[symbol] = (premiumMap[symbol] || 0) + (netPremium * exchangeRate);
            }
        });
    }

    // Process Net Asset Value for Cash, TWR, and Total NAV
    if (sections['Net Asset Value']) {
        const cashRow = sections['Net Asset Value'].find(r => r['Asset Class'] && r['Asset Class'].trim() === 'Cash');
        if (cashRow) {
            data.nav.cash = safeParseFloat(cashRow['Current Total']);
        }
        const totalRow = sections['Net Asset Value'].find(r => r['Asset Class'] && r['Asset Class'].trim() === 'Total');
        if (totalRow) {
            data.totalNAV = safeParseFloat(totalRow['Current Total']);
        }
        
        // Correctly parse Time Weighted Rate of Return
        const rateOfReturnRow = sections['Net Asset Value'].find(r => r['Time Weighted Rate of Return']);
        if (rateOfReturnRow) {
            data.rateOfReturn = safeParseFloat(rateOfReturnRow['Time Weighted Rate of Return']);
        }
    }

    // Process Change in NAV for Waterfall chart
    if(sections['Change in NAV']) {
        const navMap = new Map(sections['Change in NAV'].map(r => [r['Field Name'], r['Field Value']]));
        data.navChange.startingValue = safeParseFloat(navMap.get('Starting Value') || '0');
        data.navChange.markToMarket = safeParseFloat(navMap.get('Mark-to-Market') || '0');
        data.navChange.depositsAndWithdrawals = safeParseFloat(navMap.get('Deposits & Withdrawals') || '0');
        data.navChange.interest = safeParseFloat(navMap.get('Interest') || '0');
        data.navChange.changeInInterestAccruals = safeParseFloat(navMap.get('Change in Interest Accruals') || '0');
        data.navChange.otherFees = safeParseFloat(navMap.get('Other Fees') || '0');
        data.navChange.commissions = safeParseFloat(navMap.get('Commissions') || '0');
        data.navChange.salesTax = safeParseFloat(navMap.get('Sales Tax') || '0');
        data.navChange.otherFXTranslations = safeParseFloat(navMap.get('Other FX Translations') || '0');
        data.navChange.endingValue = safeParseFloat(navMap.get('Ending Value') || '0');
    }

    // Create a map of symbol to the latest closing trade date.
    // This is used to enrich the "Realized & Unrealized" summary which lacks dates.
    const closeDateBySymbol = new Map<string, string>();
    if (sections['Trades']) {
        const closingTrades = sections['Trades']
            .filter(r => r['DataDiscriminator'] === 'Order' && r['Realized P/L'] && safeParseFloat(r['Realized P/L']) !== 0)
            .map(trade => ({
                ...trade,
                parsedDate: parseStatementDate(trade['Date/Time'])
            }))
            .filter(trade => trade.parsedDate !== null)
            .sort((a, b) => b.parsedDate!.getTime() - a.parsedDate!.getTime()); // Sort descending by date

        closingTrades.forEach(trade => {
            const symbol = trade['Symbol'];
            if (symbol && !closeDateBySymbol.has(symbol)) {
                closeDateBySymbol.set(symbol, formatDateKey(trade.parsedDate!));
            }
        });
    }

    // Process Realized & Unrealized Performance Summary
    if (sections['Realized & Unrealized Performance Summary']) {
        let lastAssetCategory = '';
        const summaryRows = sections['Realized & Unrealized Performance Summary'];
        
        for (const row of summaryRows) {
            let assetCategory = row['Asset Category'];
            if (assetCategory === 'Equity and Index Options') {
                assetCategory = 'Options';
            }
            const symbol = row['Symbol'];

            if (assetCategory && !assetCategory.startsWith('Total')) {
                lastAssetCategory = assetCategory;
            }

            if (symbol && assetCategory && !assetCategory.startsWith('Total')) {
                const realizedPL = safeParseFloat(row['Realized Total']);
                if (realizedPL !== 0) {
                    data.closedPositions.push({
                        assetCategory,
                        symbol,
                        realizedPL,
                        closeDate: closeDateBySymbol.get(symbol),
                    });
                }
            }

            if (assetCategory === 'Total') {
                const realized = safeParseFloat(row['Realized Total']);
                const unrealized = safeParseFloat(row['Unrealized Total']);
                const total = safeParseFloat(row['Total']);
                
                if (lastAssetCategory === 'Stocks') {
                    data.plSummary.stocks = { realized, unrealized, total };
                } else if (lastAssetCategory === 'Options') {
                    data.plSummary.options = { realized, unrealized, total };
                } else if (lastAssetCategory === 'Forex') {
                    data.plSummary.forex = { realized, unrealized, total };
                }
            } else if (assetCategory === 'Total (All Assets)') {
                const realized = safeParseFloat(row['Realized Total']);
                const unrealized = safeParseFloat(row['Unrealized Total']);
                const total = safeParseFloat(row['Total']);
                data.plSummary.total = { realized, unrealized, total };
            }
        }
    }
    
    // Process Open Positions
    if(sections['Open Positions']) {
        const posRows = sections['Open Positions'].filter(r => r['DataDiscriminator'] === 'Summary');
        posRows.forEach(row => {
            if (!row['Symbol']) return;

            let assetCategory = row['Asset Category'];
            if (assetCategory === 'Equity and Index Options') {
                assetCategory = 'Options';
            }
            
            const currency = row['Currency'];
            const exchangeRate = rateFor(data.exchangeRates, currency);
            const { isOption, optionType, strikePrice, expiry, baseSymbol } = parseOptionSymbol(row['Symbol']);
            const looksLikeOption = /(?:\d{6,8}|[CP]\s*\d|\d+(?:\.\d+)?\s*[CP]\b)/i.test(row['Symbol']);
            if (!isOption && looksLikeOption && data.importDiagnostics) {
                data.importDiagnostics.unparsedOptionSymbols += 1;
                data.importDiagnostics.warnings.push(`Could not parse option contract symbol "${row['Symbol']}".`);
            }
            const rawMultiplier = safeParseFloat(row['Mult']);
            const multiplier = isOption && rawMultiplier <= 0 ? DEFAULT_OPTION_MULTIPLIER : rawMultiplier;
            if (isOption && rawMultiplier <= 0 && data.importDiagnostics) {
                data.importDiagnostics.missingMultipliers += 1;
                data.importDiagnostics.warnings.push(`Missing multiplier for ${row['Symbol']}; using ${DEFAULT_OPTION_MULTIPLIER}.`);
            }
            
            const position: Position = {
                assetCategory: assetCategory,
                symbol: row['Symbol'],
                baseSymbol,
                quantity: safeParseFloat(row['Quantity']),
                multiplier,
                costBasis: safeParseFloat(row['Cost Basis']) * exchangeRate,
                closePrice: safeParseFloat(row['Close Price']),
                value: safeParseFloat(row['Value']) * exchangeRate,
                unrealizedPL: safeParseFloat(row['Unrealized P/L']) * exchangeRate,
                currency: row['Currency'],
                isOption,
                optionType,
                strikePrice,
                expiry,
            };

            if (position.isOption) {
                position.collectedPremium = premiumMap[position.symbol] || 0;
                if (data.importDiagnostics) data.importDiagnostics.parsedOptionContracts += 1;
            }
            data.positions.push(position);
            if (data.importDiagnostics) data.importDiagnostics.parsedPositions += 1;
        });
    }

    // Process Stock Yield Enhancement Program Income
    if (sections['Stock Yield Enhancement Program Securities Lent Interest Details']) {
        const syepRow = sections['Stock Yield Enhancement Program Securities Lent Interest Details'].find(r => r['Currency'] === `Total in ${data.accountInfo.baseCurrency}`);
        if (syepRow && syepRow['Interest Paid to Customer']) {
            data.syepIncome = safeParseFloat(syepRow['Interest Paid to Customer']);
        }
    }

    // --- AROC, Win Rate, Assignment Rate, Wheel Cycle Calculation ---
    const instrumentMultipliers = new Map<string, number>();
    if (sections['Financial Instrument Information']) {
        for (const row of sections['Financial Instrument Information']) {
            if (row['Symbol'] && row['Multiplier']) {
                instrumentMultipliers.set(row['Symbol'].trim(), safeParseFloat(row['Multiplier']));
            }
        }
    }

    if (sections['Trades']) {
        data.shortPutIncomeSummary = analyzeShortOptionIncome(sections['Trades'], data.exchangeRates, 'P');
        const calls = analyzeShortOptionIncome(sections['Trades'], data.exchangeRates, 'C');
        data.shortCallIncomeSummary = { ...calls, assignmentRate: 0, winRate: 0 };
        data.wheelCycleAnalysis = analyzeWheelCycles(
            sections['Trades'],
            data.exchangeRates,
            data.accountInfo.baseCurrency,
            instrumentMultipliers,
            data.positions,
            sections['Cash Transactions'] || sections['Cash Transaction'] || [],
            data.importDiagnostics
        );
        const openTrades = new Map<string, any[]>();
        const arocTrades: ArocTrade[] = [];
        
        let totalClosedShortOptions = 0;
        let winningShortOptions = 0;
        let totalClosedShortPuts = 0;
        let assignedShortPuts = 0;

        const allOptionTrades = sections['Trades']
            .filter(r => r['DataDiscriminator'] === 'Order' && r['Asset Category'] === 'Equity and Index Options')
            .map(trade => ({
                ...trade,
                parsedDate: parseStatementDate(trade['Date/Time']),
            }))
            .filter(trade => trade.parsedDate !== null)
            .sort((a, b) => a.parsedDate!.getTime() - b.parsedDate!.getTime());

        const longPutOpenLegs = allOptionTrades
            .map(trade => {
                const parsed = parseOptionSymbol(trade.Symbol);
                return { trade, parsed, quantity: safeParseFloat(trade.Quantity) };
            })
            .filter(item =>
                item.parsed.isOption &&
                item.parsed.optionType === 'P' &&
                item.quantity > 0 &&
                (item.trade.Code || '').includes('O') &&
                item.parsed.strikePrice
            );

        const estimatePutCapitalAtRisk = (symbol: string, closeDate: Date, contractsClosed: number, exchangeRate: number, fallbackStrike: number): number => {
            const shortLeg = parseOptionSymbol(symbol);
            const multiplier = instrumentMultipliers.get(symbol.trim()) || DEFAULT_OPTION_MULTIPLIER;
            const matchingLong = longPutOpenLegs
                .filter(item =>
                    item.trade.parsedDate <= closeDate &&
                    item.parsed.baseSymbol === shortLeg.baseSymbol &&
                    item.parsed.expiry === shortLeg.expiry &&
                    item.trade.Currency === allOptionTrades.find(trade => trade.Symbol === symbol)?.Currency &&
                    (item.parsed.strikePrice || 0) < fallbackStrike
                )
                .sort((a, b) => (b.parsed.strikePrice || 0) - (a.parsed.strikePrice || 0))[0];

            const strikeWidth = matchingLong?.parsed.strikePrice
                ? fallbackStrike - matchingLong.parsed.strikePrice
                : fallbackStrike;
            return strikeWidth * contractsClosed * multiplier * exchangeRate;
        };

        for (const trade of allOptionTrades) {
            const quantity = safeParseFloat(trade['Quantity']);
            const symbol = trade['Symbol'];
            const code = trade['Code'] || '';

            if (quantity < 0 && code.includes('O')) { // Opening a short position
                if (!openTrades.has(symbol)) {
                    openTrades.set(symbol, []);
                }
                // Push one entry for each contract in the trade
                for (let i = 0; i < Math.abs(quantity); i++) {
                    openTrades.get(symbol)?.push(trade);
                }
            } else if (quantity > 0 && (code.includes('C') || code.includes('Ep') || code.includes('A'))) { // Closing a short position
                const openTradeQueue = openTrades.get(symbol);
                if (openTradeQueue && openTradeQueue.length >= quantity) {
                    
                    const numContractsClosed = Math.round(quantity);
                    totalClosedShortOptions += numContractsClosed;
                    
                    const realizedPLForTrade = safeParseFloat(trade['Realized P/L']);
                    if (realizedPLForTrade > 0) {
                        winningShortOptions += numContractsClosed;
                    }

                    const { isOption, optionType, strikePrice } = parseOptionSymbol(symbol);
                    if (isOption && optionType === 'P') {
                        totalClosedShortPuts += numContractsClosed;
                        if (code.includes('A')) {
                            assignedShortPuts += numContractsClosed;
                        }
                    }

                    // AROC calculation
                    const matchedOpenTrades = openTradeQueue.splice(0, numContractsClosed);
                    const avgOpenTimestamp = matchedOpenTrades.reduce((sum, t) => sum + t.parsedDate.getTime(), 0) / matchedOpenTrades.length;
                    const avgOpenDate = new Date(avgOpenTimestamp);
                    
                    const closeDate = trade.parsedDate;
                    let daysOpen = (closeDate.getTime() - avgOpenDate.getTime()) / (1000 * 60 * 60 * 24);
                    if (daysOpen < 1) daysOpen = 1;

                    const premiumCollected = realizedPLForTrade;
                    const tradeCurrency = trade['Currency'];
                    const exchangeRate = rateFor(data.exchangeRates, tradeCurrency);
                    const premiumInBase = premiumCollected * exchangeRate;

                    if (isOption && optionType === 'P' && strikePrice) {
                        const capitalAtRiskInBase = estimatePutCapitalAtRisk(symbol, closeDate, numContractsClosed, exchangeRate, strikePrice);

                        if (capitalAtRiskInBase > 0 && Number.isFinite(premiumInBase)) {
                            const aroc = (premiumInBase / capitalAtRiskInBase) * (DAYS_PER_YEAR / daysOpen);
                            arocTrades.push({
                                symbol,
                                premiumCollected: premiumInBase,
                                capitalAtRisk: capitalAtRiskInBase,
                                daysOpen: Math.round(daysOpen),
                                aroc,
                            });
                        }
                    }
                }
            }
        }
        
        if (arocTrades.length > 0) {
            const totalWeightedAroc = arocTrades.reduce((sum, t) => sum + (t.aroc * t.capitalAtRisk * t.daysOpen), 0);
            const totalCapitalDays = arocTrades.reduce((sum, t) => sum + (t.capitalAtRisk * t.daysOpen), 0);
            data.arocAnalysis = {
                averageAroc: totalCapitalDays > 0 ? totalWeightedAroc / totalCapitalDays : 0,
                trades: arocTrades,
            };
            const bySymbol = new Map<string, { symbol: string; premiumCollected: number; capitalAtRisk: number; weightedDays: number; weightedAroc: number; tradeCount: number }>();
            arocTrades.forEach(trade => {
                const summary = bySymbol.get(trade.symbol) || { symbol: trade.symbol, premiumCollected: 0, capitalAtRisk: 0, weightedDays: 0, weightedAroc: 0, tradeCount: 0 };
                summary.premiumCollected += trade.premiumCollected;
                summary.capitalAtRisk += trade.capitalAtRisk;
                summary.weightedDays += trade.daysOpen * trade.capitalAtRisk;
                summary.weightedAroc += trade.aroc * trade.capitalAtRisk * trade.daysOpen;
                summary.tradeCount += 1;
                bySymbol.set(trade.symbol, summary);
            });
            data.closedTradeMetrics = Array.from(bySymbol.values()).map(summary => ({
                symbol: summary.symbol,
                premiumCollected: summary.premiumCollected,
                capitalAtRisk: summary.capitalAtRisk,
                daysOpen: summary.capitalAtRisk > 0 ? summary.weightedDays / summary.capitalAtRisk : 0,
                aroc: summary.weightedDays > 0 ? summary.weightedAroc / summary.weightedDays : 0,
                tradeCount: summary.tradeCount,
            }));
        }
        
        data.optionsStrategyMetrics = {
            winRate: totalClosedShortOptions > 0 ? winningShortOptions / totalClosedShortOptions : 0,
            assignmentRate: totalClosedShortPuts > 0 ? assignedShortPuts / totalClosedShortPuts : 0,
            totalClosed: totalClosedShortOptions,
            wins: winningShortOptions,
        };
    }
    
    data.monthlySummary = analyzeMonthlySummary(
        sections['Trades'],
        sections['Forex P/L Details'],
        sections['Stock Yield Enhancement Program Securities Lent Interest Details'],
        sections['Interest'],
        sections['Fees'],
        sections['Cash Report'],
        data.exchangeRates
    );
    data.dailyOptionsSummary = analyzeDailyOptionsSummary(sections['Trades'], data.exchangeRates);
    data.weeklySummary = analyzeWeeklySummary(data.dailyOptionsSummary, sections['Trades'], sections['Interest'], sections['Fees'], data.exchangeRates);

    // --- P/L Contribution by Ticker ---
    const plByTicker = new Map<string, number>();
    data.closedPositions.forEach(pos => {
        const baseSymbol = pos.assetCategory === 'Stocks' 
            ? pos.symbol 
            : parseOptionSymbol(pos.symbol).baseSymbol;

        if (baseSymbol) {
            const currentPL = plByTicker.get(baseSymbol) || 0;
            plByTicker.set(baseSymbol, currentPL + pos.realizedPL);
        }
    });

    data.tickerPL = Array.from(plByTicker.entries())
        .map(([ticker, totalPL]) => ({ ticker, totalPL }))
        .sort((a, b) => b.totalPL - a.totalPL);

    return data;
}
