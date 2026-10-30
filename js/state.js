// ==========================================================================
// HNW Retirement & Trust Optimization Web Application — State Management
// Clean initial state (no pre-loaded sample scenario) + Multi-Statement
// Aggregation into Core Assumptions
// ==========================================================================

(function (global) {
  'use strict';

  const STORAGE_KEY = 'hnw_retirement_planner_state_v2';
  const BASE_CALENDAR_YEAR = 2026;

  const DEFAULT_STATE = {
    baseYear: BASE_CALENDAR_YEAR,

    // 1. Core Assumptions (Starts clean; populated via multi-statement import or manual entry)
    currentAge: 55,
    retirementAge: 65,
    lifeExpectancy: 92,
    taxableBalance: 0,
    taxableCostBasisRatio: 60, // % of taxable balance that is cost basis
    preTaxBalance: 0,
    rothBalance: 0,
    deferredCompBalance: 0, // Nonqualified Deferred Compensation (NQDC) plan balance ($)
    deferredCompSchedule: [], // Extracted per-tranche installment elections from NQDC statements
    expectedReturn: 7.0, // % annual nominal return
    returnVolatility: 12.0, // % annual standard deviation for Monte Carlo
    inflationRate: 2.5, // % base inflation (prompt default 2.5%)
    taxableDividendYield: 1.8, // % annual dividend yield in Taxable
    taxableTurnoverRate: 10.0, // % annual capital gains realization turnover in Taxable
    preRetirementIncome: 0, // Annual earned income prior to retirement age
    annualLivingExpenses: 0, // Today's dollars, compounded with inflation
    socialSecurityAnnual: 0, // Today's dollars, compounded with inflation
    socialSecurityStartAge: 67,

    // Social Security Profiles (Primary User & Optional Spouse via Form SSA-7005 PDF)
    ssPrimaryEnabled: false,
    ssPrimaryName: '',
    ssPrimaryDob: '',
    ssPrimaryBirthYear: 1970,
    ssPrimaryFra: 67,
    ssPrimaryClaimAge: 67, // User adjustable 62 to 70
    ssPrimaryPia: 0, // Age 67 monthly amount (Primary Insurance Amount)
    ssPrimaryMonthlyBenefit: 0,
    ssPrimaryAnnualBenefit: 0,
    ssPrimaryBenefitsByAge: null, // { 62: 2639, 63: 2811, ..., 70: 4648 }
    ssPrimaryDisability: 0,
    ssPrimarySurvivorFra: 0,
    ssPrimaryTaxesPaid: null, // { ssWorker: 173886, ssEmployer: 186339, medWorker: 74361, medEmployer: 74361 }
    ssPrimaryEarningsRecord: null, // [ { year: '2023', ssEarnings: 110196, medEarnings: 110196 }, ... ]

    ssSpouseEnabled: false,
    ssSpouseName: '',
    ssSpouseDob: '',
    ssSpouseBirthYear: 1970,
    ssSpouseFra: 67,
    ssSpouseClaimAge: 67, // 62 to 70
    ssSpousePia: 0,
    ssSpouseMonthlyBenefit: 0,
    ssSpouseAnnualBenefit: 0,
    ssSpouseBenefitsByAge: null,
    ssSpouseClaimType: 'higher', // 'own' | 'spousal' | 'higher'
    ssSpouseDisability: 0,
    ssSpouseSurvivorFra: 0,
    ssSpouseTaxesPaid: null,
    ssSpouseEarningsRecord: null,

    // 2. Trust Optimization (CRUT / Flip CRUT / CRAT / ILIT & SSRN-5924942 Actuarial Inputs)
    trustEnabled: false,
    trustType: 'CRUT', // 'CRUT' | 'FLIP_CRUT' | 'CRAT'
    trustFlipStartYear: 2031, // Calendar year when Flip CRUT payments begin (baseYear = immediate)
    trustAssetValue: 0, // Concentrated stock FMV contributed at Year 1
    trustCostBasis: 0, // Original cost basis of contributed stock
    trustPayoutRate: 6.0, // Stated annual payout rate r (5% - 10%+)
    trustDurationType: 'term', // 'term' | 'single_life' | 'two_life' (per SSRN-5924942)
    trustTermYears: 20, // Fixed term n (1 - 20 years, Reg. § 1.664-3(a)(5)(ii)(A))
    trustMeasuringAge1: 55, // Measuring life x (nearest birthday, Table 2010CM)
    trustMeasuringAge2: 55, // Second measuring life y (for Two-Life Table U(2))
    section7520Rate: 5.0, // IRS § 7520 interest rate i (rounded to nearest 0.2%)
    trustPaymentFrequency: 4, // Payments per year p: 1=Annual, 2=Semi-Annual, 4=Quarterly, 12=Monthly
    trustPaymentLagMonths: 3, // Delay in months d between valuation date and first payment
    trustTier1Return: 2.0, // Internal Tier 1 Ordinary Income rate (%)
    trustTier2Return: 5.0, // Internal Tier 2 Capital Gains growth rate (%)
    trustTier3Return: 0.0, // Internal Tier 3 Tax-Exempt yield (%)
    ilitEnabled: false,
    ilitAnnualPremium: 0, // Annual life insurance premium paid from trust payouts
    ilitDeathBenefit: 0, // Tax-free death benefit paid to heirs at life expectancy

    // 3. Tax & Meltdown Planning
    filingStatus: 'MFJ', // 'Single' ($200k NIIT) | 'MFJ' ($250k NIIT)
    rothConversionAnnual: 0, // Annual Roth conversion amount
    rothConversionStartAge: 60,
    rothConversionEndAge: 74,
    earlyPreTaxDrawAnnual: 0, // Early Pre-Tax distribution schedule (ages 59.5 to 75)
    earlyPreTaxStartAge: 60,
    earlyPreTaxEndAge: 74,
    charitableAgiLimit: 30, // 20% or 30% AGI limit dropdown
    waCapGainsEnabled: true,
    // WA State Capital Gains Standard Deduction: $278,000 for 2025 (and indexed for 2026+)
    waCapGainsBaseThreshold: 278000,
    waCapGainsIndexFrom2025: true,
    niitEnabled: true,

    // 4. Liabilities (Existing Mortgage & ARM Scenario Engine)
    mortgageEnabled: false,
    mortgageBalance: 0,
    mortgageRate: 4.5, // % annual interest rate
    mortgageOriginationMonth: 10, // 1-12 (October)
    mortgageOriginationYear: 2021,
    mortgageOriginalTermYears: 30, // 30-year amortization
    mortgageMaturityMonth: 11, // 1-12 (November)
    mortgageMaturityYear: 2051,
    mortgageRemainingTermYears: 25, // Remaining years on original amortization (or auto-calculated)
    mortgageRemainingTermMonths: 10, // Additional remaining months (0-11)
    mortgageMonthlyPayment: 0, // $ monthly Principal & Interest payment (0 = auto-calculate)
    mortgageAdjustmentWindowYears: 2, // 0 = Fixed rate; >0 = years until ARM rate reset
    mortgageResetMonth: 12, // 1-12 (December)
    mortgageResetYear: 2031, // Reset calendar year
    mortgagePostAdjustmentRate: 6.5, // % rate after ARM reset
    mortgageTargetPayoffYear: 2034, // Payoff calendar year
    mortgagePayoffYear: 2034, // Kept in sync with mortgageTargetPayoffYear
    mortgagePayoffMonth: 1, // 1-12 (Month of lump-sum payoff)
    mortgagePayoffStrategy: 'lump_sum', // 'lump_sum' | 'accelerated_annual' | 'standard'
    mortgageScenarioMode: 'post_reset', // 'arm_reset' | 'post_reset' | 'keep_loan'
    mortgageLumpSumSource: 'pre_tax', // 'pre_tax' | 'taxable' | 'roth' | custom account id
    mortgageAccountId: 'pre_tax', // Specific imported account id or bucket
    mortgageGrossUpTax: false, // Gross up pre-tax draw to cover income tax and early withdrawal penalty

    // 5. Simulation & Multi-Statement Aggregation
    monteCarloRuns: 500,
    importedStatements: [], // Array of { id, fileName, format, importedAt, totals, positionsCount }
    importedAccounts: [], // Combined positions across all imported statements

    // 6. Gottlieb CRUT Suitability Analyzer (Klaus Gottlieb 2026 Framework)
    gottliebAssetValue: 1000000,
    gottliebCostBasis: 100000,
    gottliebAge: 60,
    gottliebGender: 'female',
    gottliebPayoutRate: 5.0,
    gottlieb7520Rate: 5.0,
    gottliebOutsideIncome: 500000,
    gottliebExpectedReturn: 8.0,
    gottliebVolatility: 15.0,
    gottliebCapGainsRate: 23.8,
    gottliebOrdinaryRate: 37.0
  };

  class StateManager {
    constructor() {
      this.state = this._loadFromStorage();
      this.listeners = [];
    }

    _loadFromStorage() {
      try {
        const raw = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          return Object.assign({}, DEFAULT_STATE, parsed);
        }
      } catch (e) {
        console.warn('Could not load saved state from localStorage:', e);
      }
      return Object.assign({}, DEFAULT_STATE);
    }

    _saveToStorage() {
      try {
        if (global.localStorage) {
          global.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
        }
      } catch (e) {
        console.warn('Could not persist state to localStorage:', e);
      }
    }

    get() {
      return this.state;
    }

    update(patch) {
      this.state = Object.assign({}, this.state, patch);
      this._sanitize();
      this._saveToStorage();
      this._notify();
    }

    /**
     * Appends one or more parsed brokerage statements to the plan, summing all imported
     * statements together and automatically updating Core Assumptions balances.
     */
    addImportedStatements(parsedStatementsList) {
      const existingStatements = Array.isArray(this.state.importedStatements)
        ? this.state.importedStatements.slice()
        : [];
      const existingAccounts = Array.isArray(this.state.importedAccounts)
        ? this.state.importedAccounts.slice()
        : [];

      parsedStatementsList.forEach((parsed) => {
        if (!parsed) return;
        const stmtId = `stmt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const fileName = parsed.fileName || parsed.format || 'Statement';

        if (parsed.isSocialSecurity && parsed.socialSecurity) {
          existingStatements.push({
            id: stmtId,
            fileName,
            format: parsed.format || 'Social Security Statement (SSA-7005)',
            importedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            positionsCount: Object.keys(parsed.socialSecurity.benefitsByAge || {}).length,
            isSocialSecurity: true,
            socialSecurity: parsed.socialSecurity,
            deferrals: [],
            totals: { Taxable: 0, 'Pre-Tax': 0, Roth: 0, 'Deferred Comp': 0, taxableCostBasis: 0 }
          });

          const target = !this.state.ssPrimaryEnabled ? 'primary' : (!this.state.ssSpouseEnabled ? 'spouse' : 'primary');
          this.applySocialSecurityStatement(parsed.socialSecurity, target);
          return;
        }

        if (!Array.isArray(parsed.positions)) return;

        existingStatements.push({
          id: stmtId,
          fileName,
          format: parsed.format || 'Statement',
          importedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          positionsCount: parsed.positions.length,
          deferrals: Array.isArray(parsed.deferrals) ? parsed.deferrals : [],
          totals: Object.assign(
            { Taxable: 0, 'Pre-Tax': 0, Roth: 0, 'Deferred Comp': 0, taxableCostBasis: 0 },
            parsed.totals
          )
        });

        parsed.positions.forEach((pos) => {
          existingAccounts.push(Object.assign({}, pos, { statementId: stmtId, sourceFile: fileName }));
        });
      });

      this._recalculateAggregatedStatements(existingStatements, existingAccounts);
    }

    /**
     * Integrates parsed Social Security statement details into either Primary or Spouse profile.
     */
    applySocialSecurityStatement(ssData, target = 'primary') {
      if (!ssData) return;
      const patch = {};
      const prefix = target === 'spouse' ? 'ssSpouse' : 'ssPrimary';

      patch[`${prefix}Enabled`] = true;
      patch[`${prefix}Name`] = ssData.name || '';
      patch[`${prefix}Dob`] = ssData.dob || '';
      patch[`${prefix}BirthYear`] = Number(ssData.birthYear) || 1970;
      patch[`${prefix}Fra`] = Number(ssData.fra) || 67;
      patch[`${prefix}Pia`] = Number(ssData.pia) || (ssData.benefitsByAge ? ssData.benefitsByAge[67] : 0) || 0;
      patch[`${prefix}BenefitsByAge`] = Object.assign({}, ssData.benefitsByAge);
      patch[`${prefix}Disability`] = Number(ssData.disabilityMonthly) || 0;
      patch[`${prefix}SurvivorFra`] = Number(ssData.survivors?.spouseFra) || 0;
      patch[`${prefix}TaxesPaid`] = ssData.taxesPaid || null;
      patch[`${prefix}EarningsRecord`] = Array.isArray(ssData.earningsRecord) ? ssData.earningsRecord : [];

      const currentClaim = target === 'spouse' ? this.state.ssSpouseClaimAge : this.state.ssPrimaryClaimAge;
      patch[`${prefix}ClaimAge`] = currentClaim || 67;

      this.update(patch);
    }

    /**
     * Removes a single imported statement by ID and recalculates combined plan balances.
     */
    removeImportedStatement(statementId) {
      const removed = (this.state.importedStatements || []).find((s) => s.id === statementId);
      const remainingStatements = (this.state.importedStatements || []).filter((s) => s.id !== statementId);
      const remainingAccounts = (this.state.importedAccounts || []).filter(
        (a) => a.statementId !== statementId
      );

      if (removed && removed.isSocialSecurity) {
        const remainingSS = remainingStatements.filter((s) => s.isSocialSecurity);
        if (remainingSS.length === 0) {
          this.update({
            ssPrimaryEnabled: false,
            ssSpouseEnabled: false
          });
        }
      }

      this._recalculateAggregatedStatements(remainingStatements, remainingAccounts);
    }

    /**
     * Clears all imported statements and resets imported balances to 0.
     */
    clearImportedStatements() {
      this.update({
        ssPrimaryEnabled: false,
        ssSpouseEnabled: false
      });
      this._recalculateAggregatedStatements([], []);
    }

    _recalculateAggregatedStatements(statements, accounts) {
      let sumTaxable = 0;
      let sumPreTax = 0;
      let sumRoth = 0;
      let sumDeferredComp = 0;
      let sumTaxableBasis = 0;

      accounts.forEach((pos) => {
        const val = Number(pos.value) || 0;
        const basis = Number(pos.costBasis) || val * 0.6;
        if (pos.bucket === 'Pre-Tax') {
          sumPreTax += val;
        } else if (pos.bucket === 'Roth') {
          sumRoth += val;
        } else if (pos.bucket === 'Deferred Comp') {
          sumDeferredComp += val;
        } else {
          sumTaxable += val;
          sumTaxableBasis += basis;
        }
      });

      const combinedDeferrals = [];
      statements.forEach((stmt) => {
        if (Array.isArray(stmt.deferrals)) {
          stmt.deferrals.forEach((d) => {
            combinedDeferrals.push(Object.assign({}, d, { statementId: stmt.id, sourceFile: stmt.fileName }));
          });
        }
      });

      const basisRatio =
        sumTaxable > 0
          ? Math.round(Math.min(100, Math.max(1, (sumTaxableBasis / sumTaxable) * 100)))
          : this.state.taxableCostBasisRatio || 60;

      this.update({
        importedStatements: statements,
        importedAccounts: accounts,
        taxableBalance: Math.round(sumTaxable),
        taxableCostBasisRatio: basisRatio,
        preTaxBalance: Math.round(sumPreTax),
        rothBalance: Math.round(sumRoth),
        deferredCompBalance: Math.round(sumDeferredComp),
        deferredCompSchedule: combinedDeferrals
      });
    }

    reset() {
      this.state = Object.assign({}, DEFAULT_STATE, {
        importedStatements: [],
        importedAccounts: []
      });
      this._saveToStorage();
      this._notify();
    }

    subscribe(fn) {
      this.listeners.push(fn);
      return () => {
        this.listeners = this.listeners.filter((l) => l !== fn);
      };
    }

    _notify() {
      for (const fn of this.listeners) {
        try {
          fn(this.state);
        } catch (err) {
          console.error('State listener error:', err);
        }
      }
    }

    _sanitize() {
      const s = this.state;
      s.currentAge = Math.max(20, Math.min(95, Number(s.currentAge) || 55));
      s.retirementAge = Math.max(s.currentAge, Math.min(100, Number(s.retirementAge) || 65));
      s.lifeExpectancy = Math.max(s.retirementAge + 1, Math.min(110, Number(s.lifeExpectancy) || 92));
      const raw7520 = Number(s.section7520Rate);
      if (!isNaN(raw7520)) {
        s.section7520Rate = Math.max(0.2, Math.min(20.0, Math.round(raw7520 * 5) / 5));
      }
      s.trustTermYears = Math.max(1, Math.min(20, Math.round(Number(s.trustTermYears) || 20)));
      s.trustMeasuringAge1 = Math.max(1, Math.min(109, Math.round(Number(s.trustMeasuringAge1) || s.currentAge)));
      s.trustMeasuringAge2 = Math.max(1, Math.min(109, Math.round(Number(s.trustMeasuringAge2) || 55)));
      const baseYr = Number(s.baseYear) || 2026;
      s.trustFlipStartYear = Math.max(baseYr, Math.min(2100, Math.round(Number(s.trustFlipStartYear) || baseYr + 5)));

      // Synchronize mortgage payoff year keys
      if (s.mortgageTargetPayoffYear !== undefined) {
        s.mortgagePayoffYear = Number(s.mortgageTargetPayoffYear);
      } else if (s.mortgagePayoffYear !== undefined) {
        s.mortgageTargetPayoffYear = Number(s.mortgagePayoffYear);
      }

      // Synchronize loan maturity date if origination and term are defined
      if (s.mortgageOriginationYear && s.mortgageOriginalTermYears && !s.mortgageMaturityYear) {
        s.mortgageMaturityYear = Number(s.mortgageOriginationYear) + Number(s.mortgageOriginalTermYears);
        s.mortgageMaturityMonth = Number(s.mortgageOriginationMonth) || 12;
      }

      // Synchronize Social Security benefits when SSA statement profiles are active
      if (s.ssPrimaryEnabled && s.ssPrimaryBenefitsByAge) {
        const claimAge = Math.max(62, Math.min(70, Math.round(Number(s.ssPrimaryClaimAge) || 67)));
        s.ssPrimaryClaimAge = claimAge;
        const pMonthly = Number(s.ssPrimaryBenefitsByAge[claimAge]) || 0;
        s.ssPrimaryMonthlyBenefit = pMonthly;
        s.ssPrimaryAnnualBenefit = pMonthly * 12;

        let totalSSAnnual = s.ssPrimaryAnnualBenefit;

        if (s.ssSpouseEnabled) {
          const spClaimAge = Math.max(62, Math.min(70, Math.round(Number(s.ssSpouseClaimAge) || 67)));
          s.ssSpouseClaimAge = spClaimAge;
          let spMonthly = 0;
          if (s.ssSpouseBenefitsByAge && s.ssSpouseBenefitsByAge[spClaimAge]) {
            spMonthly = Number(s.ssSpouseBenefitsByAge[spClaimAge]) || 0;
          }
          if (s.ssSpouseClaimType === 'spousal' || s.ssSpouseClaimType === 'higher') {
            const spousalBenefitAtFra = (Number(s.ssPrimaryPia) || 0) * 0.50;
            const spouseFra = Number(s.ssSpouseFra) || 67;
            const monthsEarly = Math.max(0, (spouseFra - spClaimAge) * 12);
            let spousalFactor = 1.0;
            if (monthsEarly > 0) {
              const first36 = Math.min(36, monthsEarly);
              const remainingMonths = Math.max(0, monthsEarly - 36);
              spousalFactor = Math.max(0.70, 1.0 - (first36 * (25 / 36 / 100) + remainingMonths * (5 / 12 / 100)));
            }
            const effectiveSpousalMonthly = spousalBenefitAtFra * spousalFactor;
            if (s.ssSpouseClaimType === 'higher') {
              spMonthly = Math.max(spMonthly, effectiveSpousalMonthly);
            } else if (s.ssSpouseClaimType === 'spousal') {
              spMonthly = effectiveSpousalMonthly;
            }
          }
          s.ssSpouseMonthlyBenefit = Math.round(spMonthly * 100) / 100;
          s.ssSpouseAnnualBenefit = Math.round(spMonthly * 12 * 100) / 100;
          totalSSAnnual += s.ssSpouseAnnualBenefit;
        }

        s.socialSecurityAnnual = totalSSAnnual;
        s.socialSecurityStartAge = s.ssPrimaryClaimAge;
      }
    }
  }

  global.AppState = new StateManager();
  global.DEFAULT_APP_STATE = DEFAULT_STATE;
})(window);
