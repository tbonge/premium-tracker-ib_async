# Wheel Strategy Rebuild Plan

## Purpose

Rebuild Wheel Cycle Analysis as a true wheel-strategy profit/loss tracker, separate from Covered Call Planning.

The current implementation mixes realized P/L, open premium cash flows, stock mark-to-market, and covered-call planning assumptions. This creates misleading outputs such as impossible cost basis values, current P/L that does not reconcile to premium and stock movement, and duplicated or misplaced roll activity.

The rebuild should make every number answer one clear question:

- What has been realized?
- What is still open?
- What is the current mark-to-market picture?
- What would happen if assigned/called away at known contract strikes?
- What action, if any, is needed next?

## Guiding Principles

- A wheel cycle is a ledger, not a single formula.
- Premium credits and debits should be recorded exactly as cash flows.
- Open contracts should be visible, but clearly separated from realized results.
- Cost basis should only change from realized option P/L tied to acquiring or holding the shares.
- Current mark-to-market P/L and projected expiration/call-away P/L should be separate numbers.
- Covered Call Planning should use the wheel basis, but should not drive or redefine Wheel Cycle Analysis.
- Each ticker should be grouped once in summary tables, with lots/contracts shown in details.
- Rolls are not new profit by themselves; they are a close leg plus an open leg or replacement leg.

## Definitions

### Realized Put P/L

Net cash from short put contracts that are closed, expired, or assigned.

Include:

- Put sale credit.
- Put buy-to-close debit.
- Expired short put credit.
- Assigned short put credit.
- Commissions and fees where available.

Exclude:

- Premium from puts that are still open.
- Mark-to-market value of open puts.

### Open Put Credit

Net cash received from currently open short puts.

This is shown because cash was received, but it is not realized wheel profit yet. It should not reduce assigned stock basis until the put is closed, expired, or assigned into the cycle.

### Assigned Stock Cost

Gross cost of assigned shares.

Formula:

```text
assigned_stock_cost = assignment_strike * assigned_shares + assignment_commissions
```

If commissions are unavailable, use strike * shares and mark confidence accordingly.

### Effective Basis Per Share

The break-even basis for assigned shares using realized put P/L only.

Formula:

```text
effective_basis_per_share =
  (assigned_stock_cost - realized_put_pnl_before_or_at_assignment) / assigned_shares
```

Important:

- Credits lower basis.
- Debits raise basis.
- Open put premium does not change basis.
- Open call premium does not change basis unless the call is closed/expired/assigned and counted as realized call P/L.

### Realized Call P/L

Net cash from covered calls that are closed, expired, or assigned/called away.

Include:

- Call sale credit.
- Call buy-to-close debit.
- Expired short call credit.
- Assigned/called-away short call credit.
- Commissions and fees where available.

Exclude:

- Premium from calls that are still open if the metric is explicitly realized P/L.
- Mark-to-market value of open calls.

### Open Call Credit

Net cash received from currently open covered calls.

This should be visible, but separated from realized call P/L.

### Stock P/L At Current

Current mark-to-market stock P/L for assigned shares.

Formula:

```text
stock_pnl_at_current =
  current_stock_value - assigned_stock_cost + realized_put_pnl
```

Alternative display:

```text
stock_pnl_at_current =
  (last_price - effective_basis_per_share) * assigned_shares
```

### If Called Away P/L

Projected P/L if currently covered shares are called away at open call strike(s), while uncovered shares are valued at current price.

Formula:

```text
called_away_stock_value =
  covered_shares * weighted_open_call_strike
  + uncovered_shares * current_stock_price

if_called_away_pnl =
  called_away_stock_value
  - assigned_stock_cost
  + realized_put_pnl
  + realized_call_pnl
  + open_call_credit
```

Notes:

- Open call credit is included here because this projection assumes the open call reaches its assignment outcome.
- Open put credit is not included unless the open put is part of a separate projected-put outcome.

### Realized Wheel P/L

Only closed pieces.

Formula:

```text
realized_wheel_pnl =
  realized_put_pnl
  + realized_call_pnl
  + realized_stock_sales_pnl
  + dividends_or_syep_if_attributed
```

For an assigned but unsold stock lot, stock P/L is not realized.

### Mark-To-Market Wheel P/L

A current snapshot using current market prices.

Formula:

```text
mtm_wheel_pnl =
  realized_put_pnl
  + realized_call_pnl
  + realized_stock_sales_pnl
  + current_stock_value
  - remaining_assigned_stock_cost
  + open_option_market_value
```

Notes:

- Open short option market value is usually negative.
- This is the most honest "right now if liquidated" view.
- It should be labeled clearly as mark-to-market, not realized.

## Target User Questions

Wheel Cycle Analysis should answer:

- How much have I made or lost on this wheel cycle so far?
- What is my true basis on assigned shares?
- Which puts/calls are realized versus still open?
- What happens if my open covered calls are assigned?
- What happens if current open puts are assigned?
- Which cycles are fully closed?
- Which cycles are still active?
- Which tickers are profitable, underwater, or at assignment/call-away risk?

Covered Call Planning should answer:

- Which assigned shares still need covered calls?
- What strike should I sell to avoid a loss?
- What strike meets my target profit?
- What expiration gives an acceptable annualized return?
- Which existing calls already cover assigned shares?

## Proposed Data Model

### WheelLedger

One ledger per ticker per wheel sequence.

Fields:

- `id`
- `symbol`
- `status`
- `startDate`
- `endDate`
- `currency`
- `confidence`
- `notes`
- `putTrades`
- `assignments`
- `stockLots`
- `callTrades`
- `stockSales`
- `dividends`
- `openPuts`
- `openCalls`
- `calculated`

### Status Values

- `put-phase`: only short puts are active, no assigned shares yet.
- `assigned-uncovered`: shares assigned, no covering call.
- `assigned-covered`: shares assigned and fully covered by calls.
- `assigned-partial`: shares assigned and partially covered.
- `called-away`: shares sold through call assignment.
- `closed`: all stock and option exposure closed.
- `mixed`: multiple lots in different statuses; details required.

### Trade Event Fields

Each option trade event should include:

- `date`
- `symbol`
- `underlying`
- `optionType`
- `expiry`
- `strike`
- `quantity`
- `multiplier`
- `action`
- `cashFlow`
- `commission`
- `netCashFlow`
- `closeMethod`
- `linkedTradeId`
- `source`
- `confidence`

### Close Method Values

- `open`
- `expired`
- `assigned`
- `called-away`
- `bought-to-close`
- `rolled`
- `sold-to-close`
- `unknown`

### Roll Representation

A roll must always appear as at least two events:

1. Close old contract.
2. Open replacement contract.

Example:

```text
2026-06-22  Put bought/closed - rolled  PLTR 2026-07-24 95 P   -51.70
2026-06-26  Put sold - rolled           PLTR 2026-07-24 95 P   111.20
```

Do not collapse these into one "net roll" row unless it is an additional summary line.

## Proposed Wheel Cycle Analysis UI

### Pending / Active Cycles Summary

Recommended columns:

- Symbol
- Status
- Start Date
- Shares
- Effective Basis/Sh
- Last Price
- Realized Put P/L
- Realized Call P/L
- Open Put Credit
- Open Call Credit
- Stock P/L At Current
- If Called Away P/L
- MTM Wheel P/L
- Action

Optional advanced columns:

- Days In Cycle
- Capital At Risk
- Return On Assigned Capital
- Annualized Realized Return
- Annualized If Called Away Return
- Data Confidence

### Completed Cycles Summary

Recommended columns:

- Symbol
- Start Date
- End Date
- Duration
- Realized Put P/L
- Realized Call P/L
- Stock Sale P/L
- Other Income
- Total Realized P/L
- Return On Capital
- Annualized Return

### Expanded Active Cycle Details

Sections:

1. Realized Put Trades
2. Open Puts
3. Assignments / Stock Lots
4. Realized Call Trades
5. Open Calls
6. Stock Sales / Call-Away
7. Dividends / SYEP
8. Reconciliation Summary

Each trade row should show:

- Date
- Contract
- Action
- Close Method
- Credit
- Debit
- Net
- Running Realized P/L
- Notes

## Proposed Covered Call Planning UI

Keep this separate from Wheel Cycle Analysis.

Recommended columns:

- Symbol
- Assigned Shares
- Uncovered Shares
- Effective Basis/Sh
- Last Price
- Existing Call Strike(s)
- Existing Call Expiry
- Minimum No-Loss Strike
- Target Profit Strike
- Suggested Expiry
- Open Call Credit
- If Called Away P/L
- Action

This component should consume `effectiveBasisPerShare` and assigned-share data from the wheel ledger, but should calculate planning metrics independently.

## Calculation Rules

### Puts

- Put sale credit is cash received immediately.
- If the put is open, show it as open credit only.
- If the put expires, move credit into realized put P/L.
- If the put is bought back, realized put P/L is sale credit minus buyback debit.
- If the put is assigned, realized put P/L is sale credit minus any prior roll debits tied to that obligation.
- Assigned shares get gross assigned stock cost.
- Effective basis is assigned stock cost reduced/increased by realized put P/L tied to the assigned obligation.

### Calls

- Call sale credit is cash received immediately.
- If the call is open, show it as open call credit.
- If the call expires, move credit into realized call P/L.
- If the call is bought back, realized call P/L is sale credit minus buyback debit.
- If the call is assigned, realized call P/L includes the call credit, and stock sale/call-away P/L is calculated separately from stock basis.

### Open Options

For each open option show:

- Cash credit/debit received so far.
- Current market value.
- Unrealized option P/L.
- Expiration projection.

Do not hide open option cash flows, but do not label them as realized.

### Assignment

When a short put is assigned:

```text
assigned_stock_cost = strike * shares
effective_basis = assigned_stock_cost - realized_put_pnl_for_that_obligation
```

If multiple assigned lots exist for one ticker:

```text
weighted_effective_basis =
  total_remaining_effective_cost / total_remaining_shares
```

### Call Away

When shares are called away:

```text
stock_sale_pnl =
  call_strike * called_shares
  - effective_cost_of_called_shares
```

Total completed cycle P/L:

```text
total_realized_pnl =
  realized_put_pnl
  + realized_call_pnl
  + stock_sale_pnl
  + other_income
```

Avoid double counting:

- Do not include put premium both in effective basis and again as separate total P/L unless the formula is explicitly using gross stock cost.
- Prefer showing both views:
  - cost-basis view
  - component P/L view

## Important Reconciliation Rules

- Sum of option trade cash flows by ticker should reconcile to IBKR statement option cash flows, excluding strategies intentionally filtered out such as LEAPS.
- Short-put realized P/L should reconcile to closed short put activity.
- Short-call realized P/L should reconcile to closed short call activity.
- Wheel P/L should not include unrelated long options, LEAPS, spreads, or protective option legs unless explicitly assigned to the wheel ledger.
- Open option credits plus realized option P/L should reconcile to total wheel-related option cash flow.
- Assignment book trades should not create phantom premium.
- Expiration rows with zero proceeds should close the contract without adding new cash.

## Known Current Problems To Fix

- MSFT basis is impossible at roughly 640 when assignment was around 400 and rolls were mostly credits.
- Roll debits and credits have sometimes been hidden, skipped, or double counted.
- Open puts have leaked into realized basis in some cases.
- Open calls have been mixed into current P/L without clear labeling.
- `Put premium applied` was an ambiguous fallback label and should not exist.
- Tickers with multiple assignments can duplicate the same covered calls.
- Wheel Cycle Analysis and Covered Call Planning currently share calculations that serve different goals.
- Annualized return is unstable and misleading when based on projected or mixed realized/unrealized P/L.
- Premium columns do not clearly distinguish realized premium from open premium.
- Trade logs do not always show enough lifecycle context to explain the summary row.

## Implementation Checklist

### Phase 1: Confirm Requirements

- [ ] Confirm whether Wheel Cycle Analysis should include LEAPS at all.
- [ ] Confirm whether open option market value should be shown in MTM P/L.
- [ ] Confirm whether open option cash credits should appear in summary columns, detail sections, or both.
- [ ] Confirm whether cycles are grouped by ticker or by assignment lot.
- [ ] Confirm how to handle multiple overlapping wheel cycles for the same ticker.
- [ ] Confirm whether dividends and SYEP should be attributed to wheel cycles.
- [ ] Confirm preferred annualized return formulas.

### Phase 2: Build Normalized Ledger

- [ ] Parse all option trades into normalized events.
- [ ] Parse all assignment/expiration events into normalized close events.
- [ ] Parse stock assignments and sales into normalized stock events.
- [ ] Link opening short option lots to closing events FIFO.
- [ ] Detect rolls as close + same-underlying replacement open.
- [ ] Preserve both roll legs in the ledger.
- [ ] Tag open contracts as open exposure.
- [ ] Exclude LEAPS from wheel ledger unless explicitly enabled.
- [ ] Exclude unrelated long option strategies unless explicitly linked.
- [ ] Add confidence flags for estimated or unmatched links.

### Phase 3: Calculate Ledger Metrics

- [ ] Calculate realized put P/L.
- [ ] Calculate open put credit.
- [ ] Calculate open put market value.
- [ ] Calculate assigned stock cost.
- [ ] Calculate effective basis per share.
- [ ] Calculate realized call P/L.
- [ ] Calculate open call credit.
- [ ] Calculate open call market value.
- [ ] Calculate stock P/L at current price.
- [ ] Calculate if-called-away P/L.
- [ ] Calculate mark-to-market wheel P/L.
- [ ] Calculate completed cycle realized P/L.
- [ ] Calculate return on capital.
- [ ] Calculate annualized return only for clearly defined realized or projected metrics.

### Phase 4: Rebuild Wheel Cycle Analysis UI

- [ ] Replace current pending cycle columns with active-cycle summary columns.
- [ ] Add clear realized/open/projected grouping.
- [ ] Add expanded detail sections for realized puts, open puts, assignments, realized calls, open calls, stock sales, and reconciliation.
- [ ] Add row-level data confidence warnings.
- [ ] Remove ambiguous labels such as `Put premium applied`.
- [ ] Make totals reconcile with visible row components.
- [ ] Ensure no horizontal scrolling at common desktop widths.
- [ ] Ensure mobile layout remains readable.

### Phase 5: Separate Covered Call Planning

- [ ] Refactor Covered Call Planning to consume assigned stock lots and effective basis only.
- [ ] Do not reuse Wheel Cycle Analysis projected P/L formulas.
- [ ] Calculate minimum no-loss strike from effective basis and realized call P/L.
- [ ] Calculate target strike from configured target return.
- [ ] Show existing covered calls without duplicating them across multiple assignments.
- [ ] Show uncovered shares only once per ticker.
- [ ] Keep planning actions separate from wheel performance metrics.

### Phase 6: Validation Fixtures

- [ ] Add fixture: simple put expires worthless.
- [ ] Add fixture: put sold, bought back for profit.
- [ ] Add fixture: put rolled for credit.
- [ ] Add fixture: put rolled for debit.
- [ ] Add fixture: put assigned after several rolls.
- [ ] Add fixture: assigned stock covered by one call.
- [ ] Add fixture: covered call expires.
- [ ] Add fixture: covered call bought back.
- [ ] Add fixture: covered call rolled.
- [ ] Add fixture: covered call assigned / stock called away.
- [ ] Add fixture: multiple assignments same ticker.
- [ ] Add fixture: open put after assignment should not reduce basis.
- [ ] Add fixture: open call should be separate from realized call P/L.
- [ ] Add fixture: LEAPS excluded from wheel.
- [ ] Add fixture: MSFT statement reconciliation.

### Phase 7: Reconciliation Checks

- [ ] Compare MSFT put premium to IBKR statement.
- [ ] Compare MSFT call premium to IBKR statement.
- [ ] Reconcile total wheel-related option cash flow by ticker.
- [ ] Reconcile realized short put/call summaries.
- [ ] Reconcile open option credits against open positions.
- [ ] Reconcile assigned stock cost against assignment records.
- [ ] Validate that effective basis moves down on credits and up on debits.
- [ ] Validate no duplicated covered calls across multiple assignment lots.

## Proposed Review Questions

Before implementation, answer these:

1. Should open option premium be included in the top-level premium columns, or shown only in separate open premium columns?
2. Should `Current Total P/L` mean liquidation mark-to-market, if-called-away projection, or realized-to-date plus stock mark?
3. Should Wheel Cycle Analysis show one row per ticker or one row per wheel lot/cycle?
4. Should an open put sold after assignment be part of the same ticker wheel cycle or a new put-phase cycle?
5. Should assigned shares from multiple puts be averaged together or tracked as separate lots in the details?
6. Should covered call premium reduce basis for planning, or remain separate realized call P/L?
7. How should annualized return be shown for open cycles without encouraging false precision?

## Recommended Answers

Recommended starting decisions:

- Top-level premium columns should split realized and open premium rather than combine them into one column.
- `Current Total P/L` should be renamed or split into:
  - `MTM P/L`
  - `If Called Away P/L`
  - `Realized P/L`
- Show one summary row per ticker, with lot-level detail in the expanded row.
- Open puts after assignment should appear as open put exposure for the ticker, but not reduce assigned-share basis.
- Assigned shares should be averaged in summary and tracked by lot in details.
- Covered call premium should remain separate from basis, but planning can show breakeven after realized call P/L as an optional view.
- Annualized return for open cycles should be hidden by default or labeled as projected.

## Suggested New Summary Columns

Best first version:

| Column | Meaning |
| --- | --- |
| Symbol | Underlying ticker |
| Status | Put phase, assigned, covered, partial, closed |
| Start | First wheel trade date |
| Shares | Assigned shares still held |
| Basis/Sh | Effective basis using realized put P/L |
| Last | Current stock price |
| Realized Put P/L | Closed/expired/assigned put result |
| Realized Call P/L | Closed/expired/assigned call result |
| Open Put Credit | Cash from open puts |
| Open Call Credit | Cash from open calls |
| Stock P/L | Current stock value vs effective basis |
| If Called Away | Projection at current open call strikes |
| MTM P/L | Liquidation-style mark-to-market |
| Action | Needs call, monitor put, close/roll risk, etc. |

## Non-Goals For Rebuild

- Do not optimize covered call strikes inside Wheel Cycle Analysis.
- Do not include unrelated option strategies in wheel P/L.
- Do not hide debits from rolls.
- Do not collapse detailed roll legs into a single unexplained net number.
- Do not use open put credits to lower assigned stock basis.
- Do not treat annualized return as meaningful unless the P/L basis is explicit.

