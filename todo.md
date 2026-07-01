# Premium Tracker TODO - Accuracy, Data Handling, and Decision Dashboard

Updated: 2026-07-01

This TODO is a current backlog based on a read-only review of the project. Older items that appear to have already been implemented or mostly addressed were removed. Items below are arranged by priority and grouped around the app's main purpose: accurately track investments and provide an options/wheel decision dashboard.

## 1. Critical Calculation Correctness

Status: Completed in the Section 1 implementation pass. Remaining refinements should be tracked as new follow-up issues if more broker-specific fixtures reveal edge cases.

### 1.1 Fix spread premium sign handling and max-loss math

- **Files:** `services/analytics.ts`, `services/csvParser.ts`, `components/dashboard/CashSettledOptions.tsx`, `components/dashboard/ShortPutRisk.tsx`
- **Problem:** `buildEnhancedShortOptions()` combines short and long option legs by adding `protectivePremiumInBase` to the short premium. Long protective legs often do not have `collectedPremium` populated because `premiumMap` only records opening short sales in `csvParser.ts`. Depending on source path, long-leg premium can be missing, signed incorrectly, or treated as income.
- **Why it matters:** Credit spreads and put spreads can show overstated net credit, understated max loss, bad breakevens, and sometimes "undefined" risk where the strategy actually has defined risk.
- **Suggested fix:** Normalize every option leg to a consistent signed cash-flow model before strategy calculations:
  - short open credit: positive income
  - long open debit: negative income
  - short close debit: negative income
  - long close credit: positive income
  - spread net credit/debit: sum of all linked legs
  - max loss for credit spread: `spreadWidth * contracts * multiplier * FX - netCredit`
  - max profit for credit spread: `netCredit`
  - debit spread risk/profit should be handled separately, not forced into short-option credit-spread semantics.

### 1.2 Create an explicit option strategy grouping layer

- **Files:** `services/analytics.ts`, `services/csvParser.ts`, `scripts/load_ib_gateway.py`
- **Problem:** Spread detection currently matches open short positions to open long positions greedily by symbol, expiry, strike, currency, and multiplier. It does not create a durable strategy object. This makes rolls, partial fills, ratio spreads, broken-wing spreads, and partially closed spreads fragile.
- **Why it matters:** Tables display one enhanced short leg instead of a true strategy. P/L, max loss, current value, and premium capture become unreliable when more than one leg exists for the same underlying/expiry.
- **Suggested fix:** Add a normalized `OptionStrategy` model with grouped legs, e.g. `single-short-put`, `put-credit-spread`, `call-credit-spread`, `covered-call`, `long-option`, `unknown-complex`. Use strategy-level fields for `netPremium`, `currentValue`, `realizedPL`, `unrealizedPL`, `maxLoss`, `maxProfit`, `breakevens`, `collateral`, and `assignmentExposure`.

### 1.3 Separate assignment exposure, collateral, and max loss

- **Files:** `services/analytics.ts`, `components/Dashboard.tsx`, `components/dashboard/OpenPositions.tsx`, `components/dashboard/ExpirationCalendar.tsx`
- **Problem:** The UI mixes `assignmentCost`, `shareAssignmentCost`, and `maxLoss`. For naked physical short puts, assignment exposure is not the same as max loss. For put spreads, max loss is defined but assignment cash may still be relevant if the short leg expires ITM and the long leg is not exercised or is exercised separately.
- **Why it matters:** Decision metrics like "Return on Max Risk", leverage, expiration cash needs, and allocation can be misleading.
- **Suggested fix:** Use separate fields everywhere:
  - `assignmentExposure`: strike * contracts * multiplier * FX for physically settled short puts
  - `cashCollateral`: cash-secured amount or margin/collateral estimate
  - `maxLoss`: true worst-case strategy loss when defined
  - `settlementRisk`: possible settlement/assignment cash movement before offsets
  - `undefinedRisk`: boolean for naked short calls or unsupported complex positions.

### 1.4 Correct cash-settled index option risk display

- **Files:** `components/dashboard/CashSettledOptions.tsx`, `services/analytics.ts`
- **Problem:** Cash-settled positions are shown separately, but defined risk still depends on `protectedContracts` and `maxLoss`. If the matching long leg is missed or premium is missing, SPX/XSP spreads can display "Undefined" even though the spread has defined loss.
- **Why it matters:** This is one of the visible user-facing errors: cash-settled credit spreads should not look like naked undefined-risk positions when both legs exist.
- **Suggested fix:** Once strategy grouping exists, render cash-settled strategies by strategy type. For cash-settled naked short puts/calls, show no share assignment, but still show cash settlement exposure. For cash-settled spreads, show defined max loss, max profit, breakeven, and settlement notes.

### 1.5 Fix covered-call coverage status logic

- **File:** `components/dashboard/AssignedPutPositions.tsx`
- **Problem:** `coverageStatus` is set to `1` when `availableShares < 100`, and the UI treats truthy as "covered". This makes partially covered lots with fewer than 100 uncovered shares look fully covered, and can mark small fractional/unusual lots incorrectly.
- **Why it matters:** The dashboard's "stock that needs covered calls" workflow can show a false safe state.
- **Suggested fix:** Replace the boolean with explicit states: `fully-covered`, `partially-covered`, `needs-call`, `not-optionable-or-odd-lot`. Base covered-call action on uncovered round lots and also display leftover odd-lot shares separately.

### 1.6 Clarify adjusted basis vs breakeven on assigned shares

- **File:** `components/dashboard/AssignedPutPositions.tsx`
- **Problem:** `costBasisPerShare` subtracts both put premium and call premium, then the table labels it as breakeven. That may be useful for "net wheel breakeven", but it is not the stock tax/accounting cost basis and it changes when calls are sold.
- **Why it matters:** Users may confuse accounting basis, wheel-adjusted breakeven, and minimum acceptable call strike.
- **Suggested fix:** Show separate columns:
  - `grossAssignmentBasis`
  - `basisAfterPutPremium`
  - `wheelBreakevenAfterCalls`
  - `minimumCallStrikeToAvoidStockLoss`

## 2. Short Option and Wheel Analytics

Status: Completed in the Section 2 implementation pass with weighted AROC, spread-aware put capital estimates in CSV analytics, closed trade metric summaries, and wheel other-income attribution.

### 2.1 Rebuild AROC and win-rate metrics from strategy lifecycle events

- **Files:** `services/csvParser.ts`, `scripts/load_ib_gateway.py`, `components/dashboard/ClosedPositions.tsx`
- **Problem:** AROC and win-rate calculations still pair opening and closing trades by symbol queues. Spread closes are counted by contracts/legs rather than by strategy. Capital at risk for put spreads is still approximated as naked strike exposure in the CSV path.
- **Why it matters:** Average AROC, win rate, and assignment rate can be inflated or distorted, especially for spreads and rolls.
- **Suggested fix:** Compute AROC from normalized strategy groups:
  - naked put: collateral or assignment exposure basis
  - put spread: defined max loss or margin basis
  - covered call: stock basis or assigned-share basis
  - include losing trades and closing debits
  - use weighted averages by capital-days, not simple trade averages.

### 2.2 Link rolls as one continuing position, not disconnected trades

- **Files:** `services/csvParser.ts`, `scripts/load_ib_gateway.py`, `components/dashboard/WheelCycles.tsx`, `components/dashboard/ActionRequiredPanel.tsx`
- **Problem:** Put and call roll events are partially logged, but the app does not reliably link "buy to close old leg + sell to open new leg" as one continuing strategy with cumulative credit/debit and realized/unrealized split.
- **Why it matters:** Roll decisions need net credit, total premium collected, days in trade, new breakeven, and whether the roll improved or worsened the position.
- **Suggested fix:** Add roll identifiers using underlying, expiry sequence, option type, quantity, close/open timestamps, and trade IDs when available. Show roll chains in the wheel timeline and action panel.

### 2.3 Improve wheel cycle grouping across puts, assignments, stock, calls, dividends, and sales

- **Files:** `services/csvParser.ts`, `scripts/load_ib_gateway.py`, `components/dashboard/WheelCycles.tsx`, `components/dashboard/WheelStrategySummary.tsx`
- **Problem:** Completed wheel P/L is closer now, but cycles still do not fully include dividends, stock lending income, tax lots, partial stock sales, multi-lot assignments, or reopened wheels on the same ticker.
- **Why it matters:** The wheel dashboard should answer "Did this wheel cycle make money?" across every cash flow, not just option premiums and sale proceeds.
- **Suggested fix:** Create a `WheelCycleLedger` per assigned lot or lot group with events:
  - put sale, put roll/close, assignment, stock dividends, SYEP income, call sale, call roll/close, call assignment, discretionary stock sale, commissions/fees
  - realized P/L, open P/L, total P/L, annualized return, capital-days, and current action.

### 2.4 Add dividend and income attribution to wheel cycles

- **Files:** `services/csvParser.ts`, `scripts/load_ib_gateway.py`
- **Problem:** Dividends and SYEP/security lending income are available in statement-like data but are not attributed to assigned wheel lots.
- **Why it matters:** For assigned shares, dividends and lending income can materially change true wheel return.
- **Suggested fix:** Parse dividend/cash transaction rows by symbol and ex/pay date, then allocate to open assigned lots by share count and holding dates.

## 3. Data Import and Normalization

Status: Completed in the Section 3 implementation pass with normalized type contracts, CSV import diagnostics, parser warnings for estimated fields, and an Import Quality dashboard widget.

### 3.1 Centralize CSV, Flex, and Gateway normalization

- **Files:** `services/csvParser.ts`, `scripts/load_ib_gateway.py`, `App.tsx`, `types.ts`
- **Problem:** CSV parsing, Flex parsing, live Gateway snapshots, and the App-level merge each produce dashboard-shaped data with slightly different assumptions. Some fields are source-specific and then patched together later.
- **Why it matters:** Calculations drift between CSV, Flex-only, Gateway-only, and Gateway+Flex modes.
- **Suggested fix:** Introduce source-neutral normalized models:
  - `NormalizedTrade`
  - `NormalizedPosition`
  - `NormalizedCashFlow`
  - `NormalizedOptionLeg`
  - `NormalizedAssignment`
  - `NormalizedFxRate`
  Then run all analytics from those models. Keep source adapters small and testable.

### 3.2 Improve option symbol and contract identity handling

- **Files:** `services/csvParser.ts`, `scripts/load_ib_gateway.py`, `types.ts`
- **Problem:** `parseOptionSymbol()` handles more formats now, but contract identity is still mostly text-symbol based. IBKR provides contract IDs, underlying symbols, expiry, right, strike, multiplier, and currency in Flex/Gateway.
- **Why it matters:** Text symbols are brittle for weeklys, adjusted contracts, minis, corporate actions, futures options, non-US options, and symbols with spaces or special suffixes.
- **Suggested fix:** Prefer IBKR fields/conid when available. Use parsed symbols only as a fallback. Add validation warnings when an option-like row cannot be parsed or has missing expiry/strike/right/multiplier.

### 3.3 Make multiplier handling authoritative

- **Files:** `services/csvParser.ts`, `scripts/load_ib_gateway.py`, `constants.tsx`
- **Problem:** The app still defaults to `100` in several places. That is usually right for US equity options, but wrong for minis, adjusted contracts, futures options, and some non-US products.
- **Why it matters:** Every risk, premium-per-share, assignment, and spread calculation scales incorrectly when multiplier is wrong.
- **Suggested fix:** Store multiplier on the normalized contract. Require source-provided multiplier for option analytics where possible. If falling back to `100`, add a warning and mark affected calculations as estimated.

### 3.4 Make FX conversion auditable

- **Files:** `services/csvParser.ts`, `scripts/load_ib_gateway.py`, `components/dashboard/*`
- **Problem:** FX rates are inferred from multiple places and missing currencies fall back to 1 with a warning. Some Gateway/Flex merge calculations use live or statement rates interchangeably.
- **Why it matters:** Multi-currency P/L, collateral, and NAV can be materially wrong without an auditable rate date and direction.
- **Suggested fix:** Add `fxRate`, `fxRateDate`, `fxRateSource`, and `isEstimatedFx` to normalized money values. Keep both native currency and base currency for all cash flows.

### 3.5 Use timezone-aware dates consistently

- **Files:** `services/csvParser.ts`, `scripts/load_ib_gateway.py`, `utils/dates.ts`
- **Problem:** CSV dates are parsed into local browser/server time. Gateway and Flex dates may use account time, report date, or local runtime time.
- **Why it matters:** Monthly/weekly buckets, days-open, DTE, roll timing, and "today's" intraday merge can shift around midnight or when running outside the account timezone.
- **Suggested fix:** Store raw timestamp, account timezone, trade date, report date, and normalized ISO date separately. Use trade date for trade lifecycle and report date for statement reconciliation.

### 3.6 Add import diagnostics and reconciliation summaries

- **Files:** `components/FileUpload.tsx`, `App.tsx`, `services/csvParser.ts`, `scripts/load_ib_gateway.py`
- **Problem:** Import warnings exist, but users cannot easily see which rows/contracts were skipped, estimated, merged, or double-count-protected.
- **Why it matters:** This is a financial dashboard; users need confidence in what was imported and what is estimated.
- **Suggested fix:** Add an "Import Quality" widget with counts for parsed rows, skipped rows, missing multipliers, estimated FX, unlinked rolls, unmatched assignments, and live/Flex overlap exclusions.

## 4. Decision Dashboard Features

Status: Completed in the Section 4 implementation pass by expanding Action Required into a multi-category workflow for puts, calls, spreads, and assigned stock needing covered calls.

### 4.1 Upgrade Action Required into the primary workflow panel

- **Files:** `components/dashboard/ActionRequiredPanel.tsx`, `components/Dashboard.tsx`
- **Problem:** The panel exists, but it is still short-put oriented and depends on current open-position fields rather than normalized strategies.
- **Why it matters:** The main app goal is a decision dashboard: what to close, roll, cover, or watch today.
- **Suggested fix:** Make this the top operational widget with grouped actions:
  - puts near assignment
  - puts with high profit capture
  - spreads near max loss or near short strike
  - covered calls needing roll/close
  - assigned stock needing calls
  - uncovered or over-covered stock
  - cash/margin warnings if likely assignments occur.

### 4.2 Add rule-based roll recommendations

- **Files:** `components/dashboard/ActionRequiredPanel.tsx`, new analytics module
- **Problem:** The app flags some roll conditions but does not recommend candidate actions.
- **Why it matters:** The dashboard should help decide between hold, close, roll out, roll down/up, or accept assignment.
- **Suggested fix:** Add configurable rules:
  - close when capture >= threshold and remaining premium is small
  - roll when DTE <= 21 and delta/moneyness risk is high
  - close or defend spreads when loss progress exceeds threshold
  - avoid new calls below wheel breakeven unless explicitly marked as loss-recovery mode
  - flag earnings/ex-dividend/manual event dates when available.

### 4.3 Improve covered-call planning

- **Files:** `components/dashboard/AssignedPutPositions.tsx`, `components/dashboard/OpenPositions.tsx`
- **Problem:** Current planning shows coverage and simple target strikes, but it does not evaluate option-chain candidates or expected premium yield.
- **Why it matters:** "Stock that needs covered calls" is a core requested workflow.
- **Suggested fix:** For each long stock/assigned lot, show:
  - uncovered round lots
  - open call coverage ratio
  - minimum non-loss strike based on chosen basis mode
  - suggested expiration window
  - target delta/OTM strike placeholders
  - manual premium input until live option chain support is added.

### 4.4 Add strategy-level drilldowns

- **Files:** `components/dashboard/OpenPositions.tsx`, `components/dashboard/WheelCycles.tsx`, `components/dashboard/ClosedPositions.tsx`
- **Problem:** Users see tables of positions and cycles, but not a single complete lifecycle view for one ticker/strategy.
- **Why it matters:** Decisions need context: original thesis, all premiums, basis, current risk, rolls, and next action.
- **Suggested fix:** Add a ticker/strategy detail drawer with open legs, closed legs, cash flows, wheel cycles, current recommendation, and import confidence.

## 5. Dashboard Metric Cleanup

Status: Completed in the Section 5 implementation pass with risk-capital wording, improved premium-capture tooltip semantics, and allocation exposure modes.

### 5.1 Rename or replace "Return on Max Risk"

- **File:** `components/Dashboard.tsx`
- **Problem:** Current `returnOnMaxRisk` uses short-put premium divided by assignment exposure for all physical short puts. That is not max risk for naked puts and not collateral for spreads.
- **Why it matters:** It can materially understate or overstate actual return on capital.
- **Suggested fix:** Replace with separate metrics:
  - `premium / cash collateral`
  - `premium / defined max loss`
  - `premium / margin requirement`
  - `premium / assignment exposure`

### 5.2 Fix premium capture semantics

- **Files:** `components/Dashboard.tsx`, `components/dashboard/BuyToCloseCandidates.tsx`, `components/dashboard/ActionRequiredPanel.tsx`
- **Problem:** Capture is calculated as `(premium - abs(currentValue)) / premium`. This can be wrong for spreads, missing long-leg value, missing close commissions, and rolled positions.
- **Why it matters:** It drives "take profit early" suggestions.
- **Suggested fix:** Calculate capture at the strategy level:
  - original net credit/debit
  - current net close cost
  - realized roll credits/debits
  - estimated commissions
  - show negative capture for losing trades but cap display only if explicitly labeled.

### 5.3 Separate income from realized P/L in monthly/weekly charts

- **Files:** `services/csvParser.ts`, `components/dashboard/MonthlyIncomeChart.tsx`, `components/dashboard/PremiumEfficiency.tsx`
- **Problem:** Monthly summary includes both `optionsPremium` from opening sales and `optionsPL` from realized results. These are different concepts and can look like duplicate income.
- **Why it matters:** Users may overestimate actual profit if premium collected and realized P/L are visually combined without explanation.
- **Suggested fix:** Report separate series:
  - premium sold/opened
  - premium bought/closed
  - net realized options P/L
  - stock realized P/L
  - interest/dividends/SYEP
  - commissions/fees/taxes

### 5.4 Make allocation risk-aware

- **Files:** `components/Dashboard.tsx`, `components/dashboard/AllocationCharts.tsx`
- **Problem:** Short puts use assignment exposure while other options use absolute market value. Spreads and cash-settled options need defined-risk or margin-aware exposure.
- **Why it matters:** Allocation charts can overstate or understate concentration by strategy.
- **Suggested fix:** Let users switch allocation mode: market value, assignment exposure, defined max loss, margin requirement, or notional.

## 6. Validation and Testing

Status: Completed in the Section 6 implementation pass with dependency-free option calculation fixtures and an `npm test` validator.

### 6.1 Add fixtures for option strategy calculations

- **Files:** new test fixtures under `tests/` or `services/__tests__/`
- **Problem:** There are no visible regression tests for the calculations most likely to cause financial errors.
- **Why it matters:** Spread, wheel, and import fixes are easy to break later.
- **Suggested fix:** Add test cases for:
  - naked short put
  - put credit spread
  - call credit spread
  - cash-settled SPX spread
  - partial spread close
  - rolled put
  - assignment into stock
  - covered call sale, close, expiration, and assignment
  - multi-currency option trade
  - mini/adjusted multiplier contract.

### 6.2 Add reconciliation tests against IBKR-like sample data

- **Files:** `services/csvParser.ts`, `scripts/load_ib_gateway.py`
- **Problem:** Parser logic is complex and source-specific.
- **Why it matters:** Import changes need to prove that CSV, Flex, Gateway, and merged modes produce consistent analytics.
- **Suggested fix:** Keep anonymized fixtures with expected totals for NAV, realized P/L, premiums, commissions, open positions, wheel cycles, and option strategies.

### 6.3 Add visible confidence flags

- **Files:** `types.ts`, dashboard widgets
- **Problem:** Some calculations are exact, some are estimated, and some are incomplete due to missing data.
- **Why it matters:** Users should not act on a figure without knowing whether it is source-backed or inferred.
- **Suggested fix:** Add calculation confidence levels: `exact`, `reconciled`, `estimated`, `incomplete`, `unsupported`. Surface these in tooltips and import diagnostics.

## 7. Features to Add Later

Status: Completed in the Section 7 implementation pass as practical scaffolding: scenario stress checks and CSV exports were added, with room to extend tax, benchmark, and option-chain enrichment later.

### 7.1 Tax lot and realized gain support

- Track FIFO/LIFO/HIFO lots, wash-sale warnings, short-term vs long-term gains, and 1099-B reconciliation.

### 7.2 Benchmark and risk comparison

- Add benchmark overlays for SPY/VTI/IWM, alpha/beta, Sharpe/Sortino, drawdown vs benchmark, and wheel income vs buy-and-hold.

### 7.3 Reporting and export

- Export wheel cycles, open strategies, closed strategies, monthly summaries, and tax-ready reports to CSV/PDF.

### 7.4 Scenario analysis

- Model "all likely puts assigned", "underlying down 5/10/20%", "volatility expansion", and "spread max-loss event" scenarios using current positions.

### 7.5 Optional option-chain enrichment

- Add optional chain data for covered-call and roll candidates. Keep manual/CSV mode functional when chain data is unavailable.

## 8. Deprecation and Cleanup Candidates

### 8.1 Deprecate leg-only short-option dashboards after strategy grouping exists

- **Candidates:** Short-put-only and short-call-only summaries that duplicate strategy-level analytics.
- **Reason:** Once normalized strategies exist, leg-only views should become drilldowns, not primary decision widgets.

### 8.2 Consolidate duplicate dashboard logic

- **Files:** `components/Dashboard.tsx`, `components/LabsDashboard.tsx`, `services/analytics.ts`
- **Problem:** `Dashboard.tsx` uses `services/analytics.ts`, while `LabsDashboard.tsx` still has independent summary logic and display assumptions.
- **Suggested fix:** Keep one analytics source and make dashboards pure renderers. Deprecate Labs-only calculations unless they are intentionally experimental and clearly labeled.

### 8.3 Remove or hide metrics that cannot be made accurate from available data

- **Candidates:** strategy AROC without open/close dates, max-loss for unsupported complex options, covered-call recommendations without enough stock/option data.
- **Reason:** Estimated values are acceptable when labeled; unsupported values should not appear as precise financial metrics.

### 8.4 Keep existing visual cleanup, but avoid deleting useful historical widgets prematurely

- **Reason:** Some older charts may still help users understand performance, but they should not compete with the decision workflow. Move non-actionable analytics below the main action panels or into an archive/reporting view.

## 9. Recommended Implementation Order

1. Normalize trades, option legs, positions, cash flows, FX rates, and contract identity.
2. Build strategy grouping and strategy-level risk/P&L calculations.
3. Replace spread, capture, AROC, assignment, allocation, and cash-settled displays with strategy-level values.
4. Rebuild wheel ledger around grouped events and assigned lots.
5. Upgrade the Action Required panel into the main workflow dashboard.
6. Add regression fixtures for every calculation before broad UI changes.
7. Add import diagnostics and confidence labels.
8. Add option-chain and reporting features after core calculations are trustworthy.
