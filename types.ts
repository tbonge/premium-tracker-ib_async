


export interface Position {
  assetCategory: 'Stocks' | 'Options' | string;
  symbol: string;
  baseSymbol: string;
  quantity: number;
  multiplier: number;
  costBasis: number;
  closePrice: number;
  underlyingPrice?: number;
  delta?: number | null;
  value: number;
  unrealizedPL: number;
  currency: string;
  isOption: boolean;
  optionType?: 'P' | 'C';
  strikePrice?: number;
  expiry?: string;
  collectedPremium?: number;
}

export interface ClosedPosition {
    assetCategory: string;
    symbol: string;
    realizedPL: number;
    aroc?: number;
    closeDate?: string;
    daysOpen?: number;
    premiumCollected?: number;
    capitalAtRisk?: number;
    arocTradeCount?: number;
}

export interface NavData {
    cash: number;
    baseCurrency: string;
}

export interface AccountInfo {
    baseCurrency: string;
    account: string;
    name: string;
    period: string;
}

export interface PLSummary {
    realized: number;
    unrealized: number;
    total: number;
}

export interface ArocTrade {
  symbol: string;
  premiumCollected: number;
  capitalAtRisk: number;
  daysOpen: number;
  aroc: number;
}

export interface ArocAnalysis {
  averageAroc: number;
  trades: ArocTrade[];
}

export interface OptionsStrategyMetrics {
  winRate: number;
  assignmentRate: number;
  totalClosed: number;
  wins: number;
}

export interface WheelCycleTrade {
    date: string;
    description: string;
    amount: number;
}

export interface WheelCycle {
  symbol: string;
  currency: string;
  initialPutPremium: number;
  totalCallPremium: number;
  otherIncome?: number;
  stockPL: number;
  totalPL: number;
  durationDays: number;
  returnOnCost: number;
  annualizedReturn: number;
  startDate: string;
  endDate: string;
  assignmentPrice: number;
  assignmentShares: number;
  /** The gross cost basis of the stock assignment (Strike * Shares), before applying the put premium. */
  assignmentCost: number;
  /** The net cost basis of the stock assignment (Gross Cost - Put Premium). */
  netAssignmentCost: number;
  salePrice: number;
  saleProceeds: number;
  tradeLog: WheelCycleTrade[];
}

export interface PendingWheelCycle {
  symbol: string;
  currency: string;
  initialPutPremium: number;
  startDate: string;
  assignmentShares: number;
  assignmentPrice: number;
  assignmentCost: number;
  netAssignmentCost: number;
  totalCallPremium: number;
  otherIncome?: number;
  annualizedReturn?: number;
  currentStockValue: number;
  unrealizedStockPL: number;
  currentTotalPL: number;
  tradeLog: WheelCycleTrade[];
}

export interface WheelCycleAnalysis {
  completedCycles: WheelCycle[];
  pendingCycles: PendingWheelCycle[];
}

export interface MonthlySummary {
    month: string; // "YYYY-MM" format
    optionsPL: number;
    optionsPremium: number;
    stocksPL?: number;
    forexPL?: number;
    syepIncome: number;
    interest: number;
    interestPaid: number;
    commissions: number;
    fees: number;
    salesTax: number;
}

export interface WeeklySummary extends Omit<MonthlySummary, 'month'> {
    week: string;
}

export interface DailyOptionsSummary {
    date: string; // "YYYY-MM-DD" format
    premiumCollected: number;
    closedPL: number;
}

export interface TickerPL {
    ticker: string;
    totalPL: number;
}

export interface NAVChange {
    startingValue: number;
    markToMarket: number;
    depositsAndWithdrawals: number;
    interest: number;
    changeInInterestAccruals: number;
    otherFees: number;
    commissions: number;
    salesTax: number;
    otherFXTranslations: number;
    endingValue: number;
}

export interface ShortPutIncomeSummary {
    totalRealizedPL: number;
    numberOfContracts: number;
    averagePLPerContract: number;
    hasData: boolean;
}

export interface HistoryStatus {
  source: 'gateway' | 'flex' | 'csv' | 'gateway+flex';
  complete: boolean;
  warnings: string[];
}

export interface ShortCallIncomeSummary extends ShortPutIncomeSummary {
  assignmentRate: number;
  winRate: number;
}

export interface MarginLiquidity {
  netLiquidation: number;
  totalCash: number;
  availableFunds: number;
  excessLiquidity: number;
  buyingPower: number;
  maintenanceMargin: number;
  initialMargin: number;
  cushion: number;
}

export interface EquityHistoryPoint {
  date: string;
  total: number;
  cash: number;
  stocks: number;
  options: number;
  drawdown: number;
}

export interface PremiumEfficiencyRow {
  symbol: string;
  premiumCollected: number;
  realizedPL: number;
  commissions: number;
  putCapital: number;
  premiumYield: number;
  realizedReturn: number;
  averageDaysOpen: number;
  trades: number;
}

export interface ClosedTradeMetric {
  symbol: string;
  premiumCollected: number;
  capitalAtRisk: number;
  daysOpen: number;
  aroc: number;
  tradeCount: number;
}

export type CalculationConfidence = 'exact' | 'reconciled' | 'estimated' | 'incomplete' | 'unsupported';

export interface NormalizedMoney {
  amount: number;
  currency: string;
  amountInBase: number;
  baseCurrency: string;
  fxRate: number;
  fxRateDate?: string;
  fxRateSource: 'statement' | 'cash-report' | 'gateway' | 'fallback';
  isEstimatedFx: boolean;
}

export interface NormalizedContract {
  symbol: string;
  conid?: string;
  baseSymbol: string;
  assetCategory: string;
  currency: string;
  multiplier: number;
  optionType?: 'P' | 'C';
  strikePrice?: number;
  expiry?: string;
  confidence: CalculationConfidence;
}

export interface NormalizedTrade {
  id: string;
  rawSymbol: string;
  contract: NormalizedContract;
  tradeDate: string;
  reportDate?: string;
  quantity: number;
  cashFlow: NormalizedMoney;
  commission?: NormalizedMoney;
  code?: string;
  source: 'csv' | 'flex' | 'gateway';
}

export interface ImportDiagnostics {
  source: 'csv' | 'flex' | 'gateway' | 'gateway+flex';
  totalRows: number;
  parsedTrades: number;
  parsedPositions: number;
  parsedOptionContracts: number;
  skippedRows: number;
  missingMultipliers: number;
  estimatedFxRows: number;
  unparsedOptionSymbols: number;
  unmatchedAssignments: number;
  unlinkedRolls: number;
  warnings: string[];
}

export interface ParsedData {
  positions: Position[];
  closedPositions: ClosedPosition[];
  nav: NavData;
  accountInfo: AccountInfo;
  exchangeRates: { [currency: string]: number };
  plSummary: {
      stocks: PLSummary;
      options: PLSummary;
      forex: PLSummary;
      total: PLSummary;
  };
  rateOfReturn: number;
  totalNAV: number;
  arocAnalysis: ArocAnalysis;
  optionsStrategyMetrics: OptionsStrategyMetrics;
  wheelCycleAnalysis: WheelCycleAnalysis;
  monthlySummary: MonthlySummary[];
  weeklySummary: WeeklySummary[];
  dailyOptionsSummary: DailyOptionsSummary[];
  tickerPL: TickerPL[];
  syepIncome?: number;
  navChange: NAVChange;
  shortPutIncomeSummary: ShortPutIncomeSummary;
  shortCallIncomeSummary: ShortCallIncomeSummary;
  historyStatus?: HistoryStatus;
  marginLiquidity: MarginLiquidity;
  equityHistory: EquityHistoryPoint[];
  premiumEfficiency: PremiumEfficiencyRow[];
  closedTradeMetrics: ClosedTradeMetric[];
  importDiagnostics?: ImportDiagnostics;
}
