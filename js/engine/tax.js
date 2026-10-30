// ==========================================================================
// HNW Retirement & Trust Optimization Web Application — Tax Engine
// Federal Ordinary, Federal LTCG, 3.8% NIIT, 7.0% WA State Capital Gains,
// and SECURE 2.0 Age-75 RMD Uniform Lifetime Table
// ==========================================================================

(function (global) {
  'use strict';

  // Base 2025/2026 Federal Ordinary Income Brackets (indexed annually in loop)
  const BASE_ORDINARY_BRACKETS = {
    Single: [
      { upTo: 11925, rate: 0.10 },
      { upTo: 48475, rate: 0.12 },
      { upTo: 103350, rate: 0.22 },
      { upTo: 197300, rate: 0.24 },
      { upTo: 250525, rate: 0.32 },
      { upTo: 626350, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 }
    ],
    MFJ: [
      { upTo: 23850, rate: 0.10 },
      { upTo: 96950, rate: 0.12 },
      { upTo: 206700, rate: 0.22 },
      { upTo: 394600, rate: 0.24 },
      { upTo: 501050, rate: 0.32 },
      { upTo: 751600, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 }
    ]
  };

  // Base 2025/2026 Federal Long-Term Capital Gains Brackets
  const BASE_LTCG_BRACKETS = {
    Single: [
      { upTo: 48350, rate: 0.00 },
      { upTo: 533400, rate: 0.15 },
      { upTo: Infinity, rate: 0.20 }
    ],
    MFJ: [
      { upTo: 96700, rate: 0.00 },
      { upTo: 600050, rate: 0.15 },
      { upTo: Infinity, rate: 0.20 }
    ]
  };

  const BASE_STANDARD_DEDUCTION = {
    Single: 15000,
    MFJ: 30000
  };

  // Statutory NIIT Thresholds (IRC § 1411 — unindexed by statute)
  const NIIT_THRESHOLDS = {
    Single: 200000,
    MFJ: 250000
  };

  // IRS Uniform Lifetime Table (Updated Treas. Reg. § 1.401(a)(9)-9)
  const UNIFORM_LIFETIME_TABLE = {
    72: 27.4,
    73: 26.5,
    74: 25.5,
    75: 24.6,
    76: 23.7,
    77: 22.9,
    78: 22.0,
    79: 21.1,
    80: 20.2,
    81: 19.4,
    82: 18.5,
    83: 17.7,
    84: 16.8,
    85: 16.0,
    86: 15.2,
    87: 14.4,
    88: 13.7,
    89: 12.9,
    90: 12.2,
    91: 11.5,
    92: 10.8,
    93: 10.1,
    94: 9.5,
    95: 8.9,
    96: 8.4,
    97: 7.8,
    98: 7.3,
    99: 6.8,
    100: 6.4,
    101: 6.0,
    102: 5.6,
    103: 5.2,
    104: 4.9,
    105: 4.6,
    106: 4.3,
    107: 4.1,
    108: 3.9,
    109: 3.7,
    110: 3.5
  };

  /**
   * Computes Required Minimum Distribution (RMD) for a given age and prior year-end Pre-Tax balance.
   * SECURE 2.0 sets RMD age to 75 for individuals born 1960 or later (as modeled in prompt).
   */
  function calculateRMD(age, preTaxBalance, rmdStartAge = 75) {
    if (age < rmdStartAge || preTaxBalance <= 0) return 0;
    const divisor = UNIFORM_LIFETIME_TABLE[Math.min(110, Math.max(72, Math.floor(age)))] || 3.5;
    return preTaxBalance / divisor;
  }

  /**
   * Computes progressive Federal Ordinary Income Tax given taxable ordinary income,
   * filing status, and cumulative inflation index factor.
   */
  function calculateFederalOrdinaryTax(taxableOrdinaryIncome, filingStatus = 'MFJ', inflationFactor = 1.0) {
    const income = Math.max(0, taxableOrdinaryIncome);
    if (income <= 0) return { tax: 0, marginalRate: 0.10, effectiveRate: 0 };

    const brackets = BASE_ORDINARY_BRACKETS[filingStatus] || BASE_ORDINARY_BRACKETS.MFJ;
    let tax = 0;
    let prevLimit = 0;
    let marginalRate = 0.10;

    for (let i = 0; i < brackets.length; i++) {
      const b = brackets[i];
      const limit = b.upTo === Infinity ? Infinity : b.upTo * inflationFactor;
      if (income > prevLimit) {
        const taxableInBracket = Math.min(income, limit) - prevLimit;
        tax += taxableInBracket * b.rate;
        marginalRate = b.rate;
      } else {
        break;
      }
      prevLimit = limit;
    }

    return {
      tax,
      marginalRate,
      effectiveRate: income > 0 ? tax / income : 0
    };
  }

  /**
   * Computes progressive Federal Long-Term Capital Gains Tax stacked on top of
   * taxable ordinary income.
   */
  function calculateFederalLTCGTax(
    longTermCapGainsAndQualDivs,
    taxableOrdinaryIncome,
    filingStatus = 'MFJ',
    inflationFactor = 1.0
  ) {
    const gains = Math.max(0, longTermCapGainsAndQualDivs);
    const ordBase = Math.max(0, taxableOrdinaryIncome);
    if (gains <= 0) return { tax: 0, marginalRate: 0 };

    const brackets = BASE_LTCG_BRACKETS[filingStatus] || BASE_LTCG_BRACKETS.MFJ;
    let tax = 0;
    let prevLimit = 0;
    let marginalRate = 0;
    const totalTaxableIncome = ordBase + gains;

    for (let i = 0; i < brackets.length; i++) {
      const b = brackets[i];
      const limit = b.upTo === Infinity ? Infinity : b.upTo * inflationFactor;
      const bandStart = Math.max(prevLimit, ordBase);
      const bandEnd = Math.min(limit, totalTaxableIncome);

      if (bandEnd > bandStart) {
        tax += (bandEnd - bandStart) * b.rate;
        marginalRate = b.rate;
      }
      prevLimit = limit;
    }

    return { tax, marginalRate };
  }

  /**
   * Computes Federal 3.8% Net Investment Income Tax (NIIT) per IRC § 1411.
   * NIIT applies to the lesser of:
   *   (a) Total Net Investment Income (Brokerage dividends + Brokerage realized LTCG + CRUT Tier 1 + CRUT Tier 2), or
   *   (b) MAGI minus the statutory Filing Status threshold ($200k Single / $250k MFJ).
   */
  function calculateNIIT({
    enabled = true,
    filingStatus = 'MFJ',
    ordinaryIncomeExclTrust = 0,
    brokerageDividends = 0,
    brokerageRealizedLTCG = 0,
    trustTier1Distribution = 0,
    trustTier2Distribution = 0
  }) {
    const threshold = NIIT_THRESHOLDS[filingStatus] || NIIT_THRESHOLDS.MFJ;
    const netInvestmentIncome = Math.max(
      0,
      brokerageDividends + brokerageRealizedLTCG + trustTier1Distribution + trustTier2Distribution
    );
    const magi = Math.max(0, ordinaryIncomeExclTrust + netInvestmentIncome);
    const magiExcess = Math.max(0, magi - threshold);
    const exposedAmount = enabled ? Math.min(netInvestmentIncome, magiExcess) : 0;
    const niitTax = exposedAmount * 0.038;

    return {
      threshold,
      netInvestmentIncome,
      magi,
      magiExcess,
      exposedAmount,
      niitTax
    };
  }

  /**
   * Computes Washington State Tiered Capital Gains Excise Tax (RCW 82.87) with Dynamic CPI Indexing.
   * - The annual inflation-adjusted WA standard deduction is $278,000 for 2025 (and indexed for 2026+).
   * - If the user sets baseThreshold = $278,000 (2025 standard deduction) with indexFrom2025 = true,
   *   then Year 0 (2026) is indexed by 1 year of inflation ($278,000 * (1 + i)^1), Year 1 by (1 + i)^2, etc.
   *   Otherwise it compounds by (1 + i)^yearIndex from Year 0.
   * - Exemptions: Real estate gains, retirement accounts (IRA/401k/Roth), and the initial sale of
   *   concentrated stock inside a CRUT/CRAT are 100% exempt.
   * - Taxable WA LTCG = Realized Taxable Brokerage LTCG + CRUT/CRAT Tier 2 capital gain distributions.
   * - Tiered / Progressive Rates:
   *   * 7.0% on taxable long-term capital gains up to $1,000,000 (portion above the indexed standard deduction)
   *   * 9.9% on taxable long-term capital gains exceeding $1,000,000
   */
  function calculateWACapitalGainsTax({
    enabled = true,
    baseThreshold = 278000,
    indexFrom2025 = true,
    inflationRateDecimal = 0.025,
    yearIndex = 0,
    brokerageRealizedLTCG = 0,
    trustTier2Distribution = 0
  }) {
    // If baseThreshold is the 2025 $278,000 standard deduction and simulation starts in 2026 (yearIndex = 0),
    // index 1 year from 2025 to 2026, then compound each subsequent year.
    const compoundingYears = indexFrom2025 && Number(baseThreshold) === 278000 ? yearIndex + 1 : yearIndex;
    const indexedThreshold = Math.round(baseThreshold * Math.pow(1 + inflationRateDecimal, compoundingYears));

    const totalWaTaxableLTCG = Math.max(0, brokerageRealizedLTCG + trustTier2Distribution);
    const netTaxableGain = enabled ? Math.max(0, totalWaTaxableLTCG - indexedThreshold) : 0;

    // Tier 1: 7.0% on taxable long-term capital gains up to $1,000,000
    const tier1Taxable = Math.min(netTaxableGain, 1000000);
    const tier1Tax = tier1Taxable * 0.07;

    // Tier 2: 9.9% on taxable long-term capital gains exceeding $1,000,000
    const tier2Taxable = Math.max(0, netTaxableGain - 1000000);
    const tier2Tax = tier2Taxable * 0.099;

    const waTax = tier1Tax + tier2Tax;

    return {
      indexedThreshold,
      totalWaTaxableLTCG,
      netTaxableGain,
      tier1Taxable,
      tier2Taxable,
      tier1Tax,
      tier2Tax,
      waTax
    };
  }

  /**
   * Comprehensive single-year tax evaluation combining Ordinary Income, Deductions (Standard vs. Itemized
   * Charitable + Mortgage Interest), Federal LTCG, Federal NIIT (3.8%), and WA State Capital Gains Tax (7.0%).
   */
  function evaluateAnnualTaxes({
    yearIndex = 0,
    filingStatus = 'MFJ',
    inflationRateDecimal = 0.025,
    earnedIncome = 0,
    taxableSocialSecurity = 0,
    deferredCompDistribution = 0,
    earlyPreTaxDraw = 0,
    rmdAmount = 0,
    rothConversion = 0,
    brokerageOrdinaryDividends = 0,
    brokerageQualifiedDividends = 0,
    brokerageRealizedLTCG = 0,
    trustTier1Ordinary = 0,
    trustTier2CapGains = 0,
    deductibleMortgageInterest = 0,
    charitableDeductionAvailable = 0,
    charitableAgiLimitPct = 30,
    waCapGainsEnabled = true,
    waCapGainsBaseThreshold = 278000,
    waCapGainsIndexFrom2025 = true,
    niitEnabled = true
  }) {
    const inflationFactor = Math.pow(1 + inflationRateDecimal, yearIndex);
    const standardDeduction = (BASE_STANDARD_DEDUCTION[filingStatus] || BASE_STANDARD_DEDUCTION.MFJ) * inflationFactor;

    const grossOrdinaryIncome =
      earnedIncome +
      taxableSocialSecurity +
      deferredCompDistribution +
      earlyPreTaxDraw +
      rmdAmount +
      rothConversion +
      brokerageOrdinaryDividends +
      trustTier1Ordinary;

    const totalLTCGAndQualDiv = brokerageQualifiedDividends + brokerageRealizedLTCG + trustTier2CapGains;
    const agi = grossOrdinaryIncome + totalLTCGAndQualDiv;

    // Charitable deduction capped by 20% or 30% of AGI, applied against ordinary income first
    const maxCharitableThisYear = Math.max(0, agi * (charitableAgiLimitPct / 100));
    const charitableDeductionUsed = Math.min(
      charitableDeductionAvailable,
      maxCharitableThisYear,
      grossOrdinaryIncome
    );

    // Compare itemized deductions (Charitable + Qualified Mortgage Interest + $10k SALT cap) vs Standard Deduction
    const saltAllowance = 10000;
    const itemizedTotal = charitableDeductionUsed + deductibleMortgageInterest + (deductibleMortgageInterest > 0 || charitableDeductionUsed > 0 ? saltAllowance : 0);
    const totalDeductionApplied = Math.max(standardDeduction, itemizedTotal);

    const taxableOrdinaryIncome = Math.max(0, grossOrdinaryIncome - totalDeductionApplied);

    // 1. Federal Ordinary Income Tax
    const fedOrdinary = calculateFederalOrdinaryTax(taxableOrdinaryIncome, filingStatus, inflationFactor);

    // 2. Federal Long-Term Capital Gains Tax
    const fedLTCG = calculateFederalLTCGTax(
      totalLTCGAndQualDiv,
      taxableOrdinaryIncome,
      filingStatus,
      inflationFactor
    );

    // 3. Federal 3.8% NIIT Surtax
    const ordinaryIncomeExclTrust =
      earnedIncome + taxableSocialSecurity + deferredCompDistribution + earlyPreTaxDraw + rmdAmount + rothConversion;
    const niitResult = calculateNIIT({
      enabled: niitEnabled,
      filingStatus,
      ordinaryIncomeExclTrust,
      brokerageDividends: brokerageOrdinaryDividends + brokerageQualifiedDividends,
      brokerageRealizedLTCG,
      trustTier1Distribution: trustTier1Ordinary,
      trustTier2Distribution: trustTier2CapGains
    });

    // 4. Washington State 7.0% Capital Gains Excise Tax
    const waResult = calculateWACapitalGainsTax({
      enabled: waCapGainsEnabled,
      baseThreshold: waCapGainsBaseThreshold,
      indexFrom2025: waCapGainsIndexFrom2025,
      inflationRateDecimal,
      yearIndex,
      brokerageRealizedLTCG,
      trustTier2Distribution: trustTier2CapGains
    });

    const totalFederalTax = fedOrdinary.tax + fedLTCG.tax + niitResult.niitTax;
    const totalAllTaxes = totalFederalTax + waResult.waTax;

    return {
      agi,
      grossOrdinaryIncome,
      taxableOrdinaryIncome,
      standardDeduction,
      charitableDeductionUsed,
      deductibleMortgageInterest,
      totalDeductionApplied,
      fedOrdinaryTax: fedOrdinary.tax,
      fedOrdinaryMarginalRate: fedOrdinary.marginalRate,
      fedLTCGTax: fedLTCG.tax,
      fedLTCGMarginalRate: fedLTCG.marginalRate,
      niit: niitResult,
      waCapGains: waResult,
      totalFederalTax,
      totalAllTaxes
    };
  }

  global.TaxEngine = {
    calculateRMD,
    calculateFederalOrdinaryTax,
    calculateFederalLTCGTax,
    calculateNIIT,
    calculateWACapitalGainsTax,
    evaluateAnnualTaxes,
    NIIT_THRESHOLDS
  };
})(window);
