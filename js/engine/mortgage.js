// ==========================================================================
// HNW Retirement & Trust Optimization Web Application — Mortgage Engine
// Amortization, ARM Rate Reset, Lump-Sum Payoff Scenarios & IRS § 163(h) Deduction
// ==========================================================================

(function (global) {
  'use strict';

  const QUALIFIED_DEBT_CAP = 750000;

  /**
   * Computes the standard monthly mortgage payment (Principal & Interest)
   * required to amortize `principal` over `months` at annual interest rate `annualRateDecimal`.
   */
  function computeMonthlyPayment(principal, annualRateDecimal, months) {
    if (principal <= 0 || months <= 0) return 0;
    if (annualRateDecimal <= 0) return principal / months;
    const monthlyRate = annualRateDecimal / 12;
    return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
  }

  /**
   * Computes level annual payment (kept for backward compatibility).
   */
  function computeLevelPayment(balance, annualRateDecimal, years) {
    const months = Math.max(1, Math.round(years * 12));
    return computeMonthlyPayment(balance, annualRateDecimal, months) * 12;
  }

  /**
   * Creates a stateful mortgage tracker for the multi-year simulation loop.
   */
  function createMortgageTracker(state) {
    if (!state.mortgageEnabled || Number(state.mortgageBalance) <= 0) {
      return null;
    }

    const baseYear = Number(state.baseYear) || 2026;
    const balance = Math.max(0, Number(state.mortgageBalance) || 0);
    const initialRate = Math.max(0, (Number(state.mortgageRate) || 4.5) / 100);
    const postAdjRate = Math.max(0, (Number(state.mortgagePostAdjustmentRate) || 6.5) / 100);

    // 1. Establish Loan Origination, Original Term & Maturity Date
    const origYear = Number(state.mortgageOriginationYear) || 0;
    const origMonth = Number(state.mortgageOriginationMonth) || 10;
    const origTermYears = Number(state.mortgageOriginalTermYears) || 30;

    let maturityYear = Number(state.mortgageMaturityYear) || 0;
    let maturityMonth = Number(state.mortgageMaturityMonth) || 0;

    if (!maturityYear || maturityYear <= baseYear) {
      if (origYear > 0 && origTermYears > 0) {
        maturityYear = origYear + origTermYears;
        maturityMonth = origMonth;
      } else {
        const termYears = Math.max(0, Number(state.mortgageRemainingTermYears) || 20);
        const termExtraMonths = Math.max(0, Math.min(11, Number(state.mortgageRemainingTermMonths) || 0));
        maturityYear = baseYear + termYears;
        maturityMonth = termExtraMonths > 0 ? termExtraMonths : 12;
      }
    }
    if (!maturityMonth || maturityMonth < 1 || maturityMonth > 12) {
      maturityMonth = 11;
    }

    // Remaining months to maturity from start of simulation (Jan 1 of baseYear)
    // From Jan of baseYear through maturityMonth of maturityYear:
    const remainingMonthsFromBase = Math.max(
      1,
      (maturityYear - baseYear) * 12 + maturityMonth
    );

    // Initial monthly payment: direct user entry OR auto-calculated from remaining term to maturity
    const manualPayment = Math.max(0, Number(state.mortgageMonthlyPayment) || 0);
    const preResetMonthlyPayment =
      manualPayment > 0
        ? manualPayment
        : computeMonthlyPayment(balance, initialRate, remainingMonthsFromBase);

    // ARM Reset Date configuration
    let resetYear = Number(state.mortgageResetYear);
    let resetMonth = Number(state.mortgageResetMonth) || 12;
    const adjWindowYears = Number(state.mortgageAdjustmentWindowYears);

    if (isNaN(resetYear) || resetYear <= 0) {
      if (adjWindowYears > 0) {
        resetYear = baseYear + adjWindowYears;
        resetMonth = 1;
      } else {
        // Fixed rate mortgage — no reset
        resetYear = 9999;
        resetMonth = 1;
      }
    }

    // Payoff Strategy & Timing:
    // scenarioMode: 'arm_reset' | 'post_reset' | 'keep_loan'
    const scenarioMode =
      state.mortgageScenarioMode ||
      (state.mortgagePayoffStrategy === 'standard' ? 'keep_loan' : 'arm_reset');

    let payoffYear = 9999;
    let payoffMonth = 12;
    let payoffStrategy = state.mortgagePayoffStrategy || 'lump_sum';

    const targetPayoffYear = Number(state.mortgageTargetPayoffYear || state.mortgagePayoffYear);
    const targetPayoffMonth = Number(state.mortgagePayoffMonth) || 1;

    if (scenarioMode === 'arm_reset') {
      payoffStrategy = 'lump_sum';
      // Payoff immediately before rate reset (month before reset)
      if (resetMonth > 1) {
        payoffYear = resetYear;
        payoffMonth = resetMonth - 1;
      } else {
        payoffYear = resetYear - 1;
        payoffMonth = 12;
      }
    } else if (scenarioMode === 'post_reset') {
      payoffStrategy = 'lump_sum';
      payoffYear = targetPayoffYear || (resetYear + 2);
      payoffMonth = targetPayoffMonth;
    } else if (scenarioMode === 'keep_loan') {
      payoffStrategy = 'standard';
      payoffYear = 9999;
      payoffMonth = 12;
    }

    const lumpSumSource = state.mortgageLumpSumSource || 'pre_tax';
    const accountId = state.mortgageAccountId || lumpSumSource;
    const grossUpTax = Boolean(state.mortgageGrossUpTax);

    return {
      enabled: true,
      baseYear,
      initialBalance: balance,
      currentBalance: balance,
      initialRate,
      postAdjRate,
      activeRate: initialRate,
      origYear,
      origMonth,
      origTermYears,
      maturityYear,
      maturityMonth,
      totalLoanMonths: remainingMonthsFromBase,
      elapsedMonths: 0,
      preResetMonthlyPayment,
      activeMonthlyPayment: preResetMonthlyPayment,
      postResetMonthlyPayment: null,
      resetYear,
      resetMonth,
      hasReset: false,
      payoffYear,
      payoffMonth,
      payoffStrategy,
      scenarioMode,
      lumpSumSource,
      accountId,
      grossUpTax,
      isPaidOff: false
    };
  }

  /**
   * Steps the mortgage forward by 1 calendar year (yearIndex = 0 corresponds to baseYear).
   * Runs an exact month-by-month loop (12 months) handling rate resets, re-amortizations,
   * standard scheduled payments, and lump-sum payoffs.
   */
  function stepMortgageYear(tracker, yearIndex) {
    if (!tracker || !tracker.enabled || tracker.currentBalance <= 0.01) {
      return {
        beginningBalance: 0,
        activeRate: 0,
        activeMonthlyPayment: 0,
        preResetMonthlyPayment: tracker ? tracker.preResetMonthlyPayment : 0,
        postResetMonthlyPayment: tracker ? tracker.postResetMonthlyPayment : 0,
        interestPaid: 0,
        scheduledPrincipal: 0,
        acceleratedExtraPrincipal: 0,
        lumpSumPayoffAmount: 0,
        totalPrincipalPaid: 0,
        totalPayment: 0,
        deductibleInterest: 0,
        endingBalance: 0
      };
    }

    const beginningBalance = tracker.currentBalance;
    const calendarYear = tracker.baseYear + yearIndex;

    let yearInterest = 0;
    let yearScheduledPrincipal = 0;
    let yearLumpSumPayoff = 0;
    let yearTotalPayment = 0;

    for (let m = 1; m <= 12; m++) {
      if (tracker.currentBalance <= 0.01) {
        tracker.currentBalance = 0;
        tracker.isPaidOff = true;
        break;
      }

      // 1. Check for ARM rate reset
      if (
        !tracker.hasReset &&
        (calendarYear > tracker.resetYear ||
          (calendarYear === tracker.resetYear && m >= tracker.resetMonth))
      ) {
        tracker.hasReset = true;
        tracker.activeRate = tracker.postAdjRate;
        // Remaining months until actual loan maturity
        const remainingMonthsToMaturity = tracker.maturityYear
          ? Math.max(1, (tracker.maturityYear - calendarYear) * 12 + (tracker.maturityMonth - m) + 1)
          : Math.max(1, tracker.totalLoanMonths - tracker.elapsedMonths);
        tracker.postResetMonthlyPayment = computeMonthlyPayment(
          tracker.currentBalance,
          tracker.postAdjRate,
          remainingMonthsToMaturity
        );
        tracker.activeMonthlyPayment = tracker.postResetMonthlyPayment;
      }

      // 2. Check for Lump-Sum Payoff
      const isPayoffTime =
        tracker.payoffStrategy === 'lump_sum' &&
        !tracker.isPaidOff &&
        (calendarYear > tracker.payoffYear ||
          (calendarYear === tracker.payoffYear && m >= tracker.payoffMonth));

      if (isPayoffTime) {
        // Accrue interest for the month up to payoff date
        const accruedInterest = tracker.currentBalance * (tracker.activeRate / 12);
        const payoffPrincipal = tracker.currentBalance;

        yearInterest += accruedInterest;
        yearLumpSumPayoff = payoffPrincipal;
        yearTotalPayment += accruedInterest + payoffPrincipal;

        tracker.currentBalance = 0;
        tracker.isPaidOff = true;
        tracker.elapsedMonths++;
        break;
      }

      // 3. Regular Monthly Payment Amortization
      const monthlyInterest = tracker.currentBalance * (tracker.activeRate / 12);
      const monthlyPayment = tracker.activeMonthlyPayment;
      const monthlyPrincipal = Math.min(tracker.currentBalance, Math.max(0, monthlyPayment - monthlyInterest));

      yearInterest += monthlyInterest;
      yearScheduledPrincipal += monthlyPrincipal;
      yearTotalPayment += monthlyInterest + monthlyPrincipal;

      tracker.currentBalance = Math.max(0, tracker.currentBalance - monthlyPrincipal);
      tracker.elapsedMonths++;

      if (tracker.currentBalance <= 0.01) {
        tracker.currentBalance = 0;
        tracker.isPaidOff = true;
        break;
      }
    }

    const endingBalance = tracker.currentBalance;

    // IRC § 163(h)(3)(F): Deductible mortgage interest is capped at $750,000 of qualified principal debt
    const averageBalance = (beginningBalance + endingBalance) / 2;
    const qualifiedRatio =
      averageBalance > 0 ? Math.min(1.0, QUALIFIED_DEBT_CAP / averageBalance) : 1.0;
    const deductibleInterest = yearInterest * qualifiedRatio;

    return {
      beginningBalance,
      activeRate: tracker.activeRate,
      activeMonthlyPayment: tracker.activeMonthlyPayment,
      preResetMonthlyPayment: tracker.preResetMonthlyPayment,
      postResetMonthlyPayment: tracker.hasReset ? tracker.postResetMonthlyPayment : null,
      interestPaid: yearInterest,
      scheduledPrincipal: yearScheduledPrincipal,
      acceleratedExtraPrincipal: 0,
      lumpSumPayoffAmount: yearLumpSumPayoff,
      totalPrincipalPaid: yearScheduledPrincipal + yearLumpSumPayoff,
      totalPayment: yearTotalPayment,
      deductibleInterest,
      endingBalance
    };
  }

  /**
   * Evaluates and compares all three mortgage scenarios side-by-side:
   * Scenario A: Pay off at ARM reset (before rate changes)
   * Scenario B: Pay off post-reset at specified date (interim at higher rate)
   * Scenario C: Baseline (keep loan, amortize through full term)
   */
  function evaluateMortgageScenarios(state) {
    if (!state.mortgageEnabled || Number(state.mortgageBalance) <= 0) {
      return null;
    }

    function runScenarioSimulation(scenarioMode) {
      const scenarioState = Object.assign({}, state, {
        mortgageEnabled: true,
        mortgageScenarioMode: scenarioMode,
        mortgagePayoffStrategy: scenarioMode === 'keep_loan' ? 'standard' : 'lump_sum'
      });

      const tracker = createMortgageTracker(scenarioState);
      if (!tracker) return null;

      let lifetimeInterest = 0;
      let lifetimePayments = 0;
      let lifetimeDeductibleInterest = 0;
      let payoffAmount = 0;
      let payoffYear = 0;
      let payoffMonth = 0;
      let monthsWithDebt = 0;
      let capturedPostResetMonthlyPayment = null;

      for (let y = 0; y < 40; y++) {
        if (tracker.isPaidOff && tracker.currentBalance <= 0.01) break;
        const step = stepMortgageYear(tracker, y);
        lifetimeInterest += step.interestPaid;
        lifetimePayments += step.totalPayment;
        lifetimeDeductibleInterest += step.deductibleInterest;

        if (step.postResetMonthlyPayment > 0 && !capturedPostResetMonthlyPayment) {
          capturedPostResetMonthlyPayment = step.postResetMonthlyPayment;
        }

        if (step.lumpSumPayoffAmount > 0) {
          payoffAmount = step.lumpSumPayoffAmount;
          payoffYear = tracker.baseYear + y;
          payoffMonth = tracker.payoffMonth;
        }

        if (step.beginningBalance > 0) {
          monthsWithDebt += 12;
        }
      }

      return {
        scenarioMode,
        lifetimeInterest,
        lifetimePayments,
        lifetimeDeductibleInterest,
        payoffAmount,
        payoffYear,
        payoffMonth,
        preResetMonthlyPayment: tracker.preResetMonthlyPayment,
        postResetMonthlyPayment: capturedPostResetMonthlyPayment || tracker.postResetMonthlyPayment,
        resetYear: tracker.resetYear,
        resetMonth: tracker.resetMonth,
        maturityYear: tracker.maturityYear,
        maturityMonth: tracker.maturityMonth,
        totalLoanMonths: tracker.totalLoanMonths
      };
    }

    const baseline = runScenarioSimulation('keep_loan');
    const atReset = runScenarioSimulation('arm_reset');
    const postReset = runScenarioSimulation('post_reset');

    if (!baseline || !atReset) return null;

    const monthlyPaymentPreReset = baseline.preResetMonthlyPayment;
    const monthlyPaymentPostReset =
      (postReset && postReset.postResetMonthlyPayment) ||
      baseline.postResetMonthlyPayment ||
      monthlyPaymentPreReset;
    const monthlyPaymentShock = Math.max(0, monthlyPaymentPostReset - monthlyPaymentPreReset);

    return {
      baseline,
      atReset,
      postReset,
      monthlyPaymentPreReset,
      monthlyPaymentPostReset,
      monthlyPaymentShock,
      interestSavedAtReset: Math.max(0, baseline.lifetimeInterest - atReset.lifetimeInterest),
      interestSavedPostReset: postReset
        ? Math.max(0, baseline.lifetimeInterest - postReset.lifetimeInterest)
        : 0
    };
  }

  global.MortgageEngine = {
    QUALIFIED_DEBT_CAP,
    computeMonthlyPayment,
    computeLevelPayment,
    createMortgageTracker,
    stepMortgageYear,
    evaluateMortgageScenarios
  };
})(typeof window !== 'undefined' ? window : global);
