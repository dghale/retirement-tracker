// ==========================================================================
// HNW Retirement & Trust Optimization Web Application — Gottlieb CRUT Engine
// Based on Klaus Gottlieb (2026), "When Does a Charitable Remainder Unitrust Outperform?
// A Monte Carlo, Multi-Benchmark Suitability Framework" (Journal of Financial Planning)
// ==========================================================================

(function (global) {
  'use strict';

  /**
   * Mulberry32 deterministic PRNG so Monte Carlo results are reproducible for identical inputs.
   */
  function createSeededRandom(seed) {
    let a = seed >>> 0;
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Box-Muller transform for standard normal Z ~ N(0, 1).
   */
  function sampleNormal(randFn) {
    let u1 = 0;
    let u2 = 0;
    while (u1 === 0) u1 = randFn();
    while (u2 === 0) u2 = randFn();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  }

  /**
   * Computes Settlor Actuarial Life Expectancy (e_x) from Table 2010CM.
   * Uses IRS unisex Table 2010CM with small standard gender adjustment (+1.5 yrs female, -1.5 yrs male)
   * or exact table expectation: e_x = 0.5 + sum_{t=1..110-x} (l_{x+t} / l_x).
   */
  function calculateSettlorLifeExpectancy(age, gender = 'female') {
    const TE = global.TrustEngine;
    const cleanAge = Math.max(18, Math.min(105, Math.floor(Number(age) || 60)));
    let baseExpectancy = 25.0;

    if (TE && typeof TE.calculateTable2010CMLifeExpectancy === 'function') {
      baseExpectancy = TE.calculateTable2010CMLifeExpectancy(cleanAge);
    } else if (TE && Array.isArray(TE.TABLE_2010CM)) {
      const lx = TE.getLx ? TE.getLx(cleanAge) : TE.TABLE_2010CM[cleanAge];
      if (lx > 0) {
        let sumLx = 0;
        for (let t = cleanAge + 1; t <= 110; t++) {
          sumLx += TE.TABLE_2010CM[t] || 0;
        }
        baseExpectancy = 0.5 + sumLx / lx;
      }
    }

    // Gender differentiation (+1.2 yrs female, -1.2 yrs male)
    const genderOffset = String(gender).toLowerCase() === 'female' ? 1.2 : -1.2;
    const finalExpectancy = Math.max(1, Math.round((baseExpectancy + genderOffset) * 10) / 10);
    return {
      lifeExpectancyYears: finalExpectancy,
      expectedDeathAge: Math.round(cleanAge + finalExpectancy),
      windowStartYear: Math.max(1, Math.round(finalExpectancy - 5)),
      windowEndYear: Math.round(finalExpectancy + 5)
    };
  }

  /**
   * Evaluates IRS 10% Minimum Charitable Remainder Rule (IRC § 664(d)(2)(D))
   * and Upfront Deduction Tax Savings under 30% AGI Limitation.
   */
  function evaluateGottliebComplianceAndDeduction(params) {
    const TE = global.TrustEngine;
    const assetValue = Math.max(0, Number(params.assetValue) || 1000000);
    const age = Math.max(18, Math.min(105, Math.round(Number(params.age) || 60)));
    const payoutRate = Math.max(5.0, (Number(params.payoutRate) || 5.0)) / 100;
    const rate7520 = Math.max(0.2, (Number(params.rate7520) || 5.0)) / 100;
    const outsideIncome = Math.max(0, Number(params.outsideIncome) || 500000);
    const ordinaryRate = Math.max(0, (Number(params.ordinaryRate) || 37.0)) / 100;

    // Use SSRN-5924942 Table F factor (p=4 quarterly payments, lag=3 months)
    const fFactor = TE ? TE.calculateTableFFactor(rate7520, 4, 3) : 1.0;
    const adjustedPayoutU = payoutRate * fFactor;
    const remainderFactor = TE ? TE.calculateSingleLifeCRUTRemainderFactor(adjustedPayoutU, age) : 0.15;

    const passes10PercentRule = remainderFactor >= 0.10;
    const grossDeduction = assetValue * remainderFactor;

    // Upfront Charitable Deduction limited to 30% of Year 1 Outside Income (IRC § 170(b)(1)(C))
    const agiLimit30Pct = outsideIncome * 0.30;
    const deductionUsedYear1 = Math.min(grossDeduction, agiLimit30Pct);
    const deductionCarryforward = Math.max(0, grossDeduction - deductionUsedYear1);
    const upfrontTaxSavings = deductionUsedYear1 * ordinaryRate;

    return {
      remainderFactor,
      passes10PercentRule,
      grossDeduction,
      deductionUsedYear1,
      deductionCarryforward,
      upfrontTaxSavings,
      agiLimit30Pct
    };
  }

  /**
   * Runs single-path 40-year simulation for Track A (CRUT), Track B (Hold-and-Draw),
   * and Track C (Immediate Sale & Reinvest) given an annual market return array.
   */
  function runPairedTrajectory(params, annualReturns, upfrontTaxSavings) {
    const horizonYears = Math.min(40, annualReturns.length);
    const assetValue = Math.max(0, Number(params.assetValue) || 1000000);
    const costBasis = Math.max(0, Math.min(assetValue, Number(params.costBasis) || 100000));
    const payoutRate = Math.max(0.05, (Number(params.payoutRate) || 5.0) / 100);
    const capGainsRate = Math.max(0, (Number(params.capGainsRate) || 23.8) / 100);
    const ordinaryRate = Math.max(0, (Number(params.ordinaryRate) || 37.0) / 100);

    // Track A Initial State (CRUT)
    let crutNav = assetValue; // 100% untaxed rollover inside trust
    let crutTier1Ord = 0;
    let crutTier2CapGains = assetValue - costBasis; // Embedded untaxed capital gain
    let crutTier4Corpus = costBasis;
    let trackAOutsideWealth = upfrontTaxSavings; // Compounding upfront deduction savings

    // Track B Initial State (Taxable Hold-and-Draw)
    let holdBalance = assetValue;
    let holdBasis = costBasis;

    // Track C Initial State (Immediate Liquidation & Reinvest)
    const initialGainC = Math.max(0, assetValue - costBasis);
    const initialTaxC = initialGainC * capGainsRate;
    let reinvestBalance = assetValue - initialTaxC;
    let reinvestBasis = reinvestBalance; // Stepped up to net proceeds

    // Dividend yield & turnover tax drag on outside taxable accounts (default 2% div, 5% turnover)
    const divYield = 0.018;
    const turnoverRate = 0.05;

    const trajectory = {
      years: [],
      crutWinsVsHoldCount: 0,
      crutWinsVsReinvestCount: 0
    };

    for (let t = 0; t < horizonYears; t++) {
      const R = annualReturns[t];

      // --- TRACK A (CRUT) ---
      // 1. Gross Payout at beginning of period or stepped
      const grossPayoutA = crutNav * payoutRate;

      // 2. 4-Tier WIFO Accounting
      let ordDistributed = 0;
      let capGainsDistributed = 0;
      let corpusDistributed = 0;
      let remainingPayout = grossPayoutA;

      if (remainingPayout > 0 && crutTier1Ord > 0) {
        ordDistributed = Math.min(crutTier1Ord, remainingPayout);
        crutTier1Ord -= ordDistributed;
        remainingPayout -= ordDistributed;
      }
      if (remainingPayout > 0 && crutTier2CapGains > 0) {
        capGainsDistributed = Math.min(crutTier2CapGains, remainingPayout);
        crutTier2CapGains -= capGainsDistributed;
        remainingPayout -= capGainsDistributed;
      }
      if (remainingPayout > 0) {
        corpusDistributed = Math.min(crutTier4Corpus, remainingPayout);
        crutTier4Corpus = Math.max(0, crutTier4Corpus - corpusDistributed);
        remainingPayout -= corpusDistributed;
      }

      const taxOnPayoutA = ordDistributed * ordinaryRate + capGainsDistributed * capGainsRate;
      const netCashToSettlorA = Math.max(0, grossPayoutA - taxOnPayoutA);

      // Deduct payout from CRUT NAV and grow remaining trust balance
      crutNav = Math.max(0, (crutNav - grossPayoutA) * (1 + R));
      // Trust internal growth: 20% ordinary (interest/div), 80% capital gains
      if (R > 0) {
        crutTier1Ord += crutNav * R * 0.20;
        crutTier2CapGains += crutNav * R * 0.80;
      }

      // Grow Track A outside accumulated wealth (reinvested net cash flows + compounded upfront tax savings)
      const afterTaxOutsideReturnA = R - (divYield * 0.65 * capGainsRate + divYield * 0.35 * ordinaryRate);
      trackAOutsideWealth = trackAOutsideWealth * (1 + afterTaxOutsideReturnA) + netCashToSettlorA;

      // --- TRACK B (Hold-and-Draw) ---
      // Liquidate exact net cash flow required to match Track A's settlor payout
      const gainRatioB = holdBalance > 0 ? Math.max(0, (holdBalance - holdBasis) / holdBalance) : 0;
      const taxDragFactorB = 1 - (gainRatioB * capGainsRate);
      const grossNeededB = netCashToSettlorA / Math.max(0.20, taxDragFactorB);
      const grossSoldB = Math.min(holdBalance, grossNeededB);
      const realizedGainB = grossSoldB * gainRatioB;
      const basisReductionB = grossSoldB - realizedGainB;

      holdBalance = Math.max(0, holdBalance - grossSoldB);
      holdBasis = Math.max(0, holdBasis - basisReductionB);
      // Grow remaining taxable balance
      const afterTaxOutsideReturnB = R - (divYield * 0.65 * capGainsRate + divYield * 0.35 * ordinaryRate + turnoverRate * gainRatioB * capGainsRate);
      holdBalance = Math.max(0, holdBalance * (1 + afterTaxOutsideReturnB));

      // Terminal liquid wealth of Track B if liquidated at year t:
      const terminalGainRatioB = holdBalance > 0 ? Math.max(0, (holdBalance - holdBasis) / holdBalance) : 0;
      const netTerminalWealthB = Math.max(0, holdBalance - (holdBalance * terminalGainRatioB * capGainsRate));

      // --- TRACK C (Immediate Sale & Reinvest) ---
      // Liquidate exact net cash flow required to match Track A
      const gainRatioC = reinvestBalance > 0 ? Math.max(0, (reinvestBalance - reinvestBasis) / reinvestBalance) : 0;
      const taxDragFactorC = 1 - (gainRatioC * capGainsRate);
      const grossNeededC = netCashToSettlorA / Math.max(0.20, taxDragFactorC);
      const grossSoldC = Math.min(reinvestBalance, grossNeededC);
      const realizedGainC = grossSoldC * gainRatioC;
      const basisReductionC = grossSoldC - realizedGainC;

      reinvestBalance = Math.max(0, reinvestBalance - grossSoldC);
      reinvestBasis = Math.max(0, reinvestBasis - basisReductionC);
      // Grow remaining balance
      const afterTaxOutsideReturnC = R - (divYield * 0.65 * capGainsRate + divYield * 0.35 * ordinaryRate + turnoverRate * gainRatioC * capGainsRate);
      reinvestBalance = Math.max(0, reinvestBalance * (1 + afterTaxOutsideReturnC));

      const terminalGainRatioC = reinvestBalance > 0 ? Math.max(0, (reinvestBalance - reinvestBasis) / reinvestBalance) : 0;
      const netTerminalWealthC = Math.max(0, reinvestBalance - (reinvestBalance * terminalGainRatioC * capGainsRate));

      // Track A Terminal Settlor Wealth (Accumulated outside wealth)
      const terminalWealthA = trackAOutsideWealth;

      trajectory.years.push({
        year: t + 1,
        netCashToSettlor: netCashToSettlorA,
        wealthTrackA: terminalWealthA,
        wealthTrackB: netTerminalWealthB,
        wealthTrackC: netTerminalWealthC,
        crutBeatsHold: terminalWealthA > netTerminalWealthB,
        crutBeatsReinvest: terminalWealthA > netTerminalWealthC
      });
    }

    return trajectory;
  }

  /**
   * Main 1,000-run Monte Carlo Paired-Path Simulation.
   * Runs simultaneously across Track A, Track B, and Track C on identical market sequences.
   */
  function runGottliebSuitabilityMonteCarlo(state) {
    const runs = 1000;
    const horizonYears = 40;
    const expectedReturn = (Number(state.gottliebExpectedReturn) || 8.0) / 100;
    const volatility = Math.max(0.01, (Number(state.gottliebVolatility) || 15.0) / 100);

    const compliance = evaluateGottliebComplianceAndDeduction({
      assetValue: state.gottliebAssetValue,
      age: state.gottliebAge,
      payoutRate: state.gottliebPayoutRate,
      rate7520: state.gottlieb7520Rate,
      outsideIncome: state.gottliebOutsideIncome,
      ordinaryRate: state.gottliebOrdinaryRate
    });

    const mortality = calculateSettlorLifeExpectancy(state.gottliebAge, state.gottliebGender);

    if (!compliance.passes10PercentRule) {
      return {
        compliance,
        mortality,
        runs,
        horizonYears,
        probOutperformHoldByYear: new Array(horizonYears).fill(0),
        probOutperformReinvestByYear: new Array(horizonYears).fill(0),
        medianWealthAByYear: new Array(horizonYears).fill(0),
        medianWealthBByYear: new Array(horizonYears).fill(0),
        medianWealthCByYear: new Array(horizonYears).fill(0),
        lifetimeWinRateVsHold: 0,
        lifetimeWinRateVsReinvest: 0,
        failedRemainderTest: true
      };
    }

    const rand = createSeededRandom(20260815);
    const winHoldCountsByYear = new Array(horizonYears).fill(0);
    const winReinvestCountsByYear = new Array(horizonYears).fill(0);
    const wealthAByYear = Array.from({ length: horizonYears }, () => []);
    const wealthBByYear = Array.from({ length: horizonYears }, () => []);
    const wealthCByYear = Array.from({ length: horizonYears }, () => []);

    for (let r = 0; r < runs; r++) {
      const returns = new Float64Array(horizonYears);
      for (let y = 0; y < horizonYears; y++) {
        const z = sampleNormal(rand);
        returns[y] = Math.max(-0.50, Math.min(0.65, expectedReturn + z * volatility));
      }

      const traj = runPairedTrajectory(
        {
          assetValue: state.gottliebAssetValue,
          costBasis: state.gottliebCostBasis,
          payoutRate: state.gottliebPayoutRate,
          capGainsRate: state.gottliebCapGainsRate,
          ordinaryRate: state.gottliebOrdinaryRate
        },
        returns,
        compliance.upfrontTaxSavings
      );

      for (let y = 0; y < horizonYears; y++) {
        const pt = traj.years[y];
        if (pt.crutBeatsHold) winHoldCountsByYear[y]++;
        if (pt.crutBeatsReinvest) winReinvestCountsByYear[y]++;
        wealthAByYear[y].push(pt.wealthTrackA);
        wealthBByYear[y].push(pt.wealthTrackB);
        wealthCByYear[y].push(pt.wealthTrackC);
      }
    }

    const probOutperformHoldByYear = winHoldCountsByYear.map((c) => (c / runs) * 100);
    const probOutperformReinvestByYear = winReinvestCountsByYear.map((c) => (c / runs) * 100);

    const getMedian = (arr) => {
      const s = arr.slice().sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    };

    const medianWealthAByYear = wealthAByYear.map(getMedian);
    const medianWealthBByYear = wealthBByYear.map(getMedian);
    const medianWealthCByYear = wealthCByYear.map(getMedian);

    // Lifetime Win Rates measured at settlor's median life expectancy year
    const lifeExpectancyIdx = Math.min(horizonYears - 1, Math.max(0, Math.round(mortality.lifeExpectancyYears) - 1));
    const lifetimeWinRateVsHold = probOutperformHoldByYear[lifeExpectancyIdx];
    const lifetimeWinRateVsReinvest = probOutperformReinvestByYear[lifeExpectancyIdx];

    return {
      compliance,
      mortality,
      runs,
      horizonYears,
      probOutperformHoldByYear,
      probOutperformReinvestByYear,
      medianWealthAByYear,
      medianWealthBByYear,
      medianWealthCByYear,
      lifetimeWinRateVsHold,
      lifetimeWinRateVsReinvest,
      failedRemainderTest: false
    };
  }

  global.GottliebEngine = {
    calculateSettlorLifeExpectancy,
    evaluateGottliebComplianceAndDeduction,
    runPairedTrajectory,
    runGottliebSuitabilityMonteCarlo
  };
})(window);
