// ==========================================================================
// HNW Retirement & Trust Optimization Web Application — Master Simulator
// Year-by-Year Deterministic Loop + RMD Baseline + Trust Tax Savings Engine
// ==========================================================================

(function (global) {
  'use strict';

  /**
   * Core single-trajectory simulation loop.
   * Can be run deterministically (customReturns = null) or stochastically by Monte Carlo.
   */
  function runTrajectory(state, options = {}) {
    const customReturns = options.customReturns || null;
    const disableMeltdown = Boolean(options.disableMeltdown);

    const baseYear = Number(state.baseYear) || 2026;
    const startAge = Math.max(25, Math.min(90, Number(state.currentAge) || 56));
    const retirementAge = Math.max(startAge, Math.min(95, Number(state.retirementAge) || 60));
    const endAge = Math.max(retirementAge + 1, Math.min(110, Number(state.lifeExpectancy) || 92));
    const totalYears = endAge - startAge + 1;

    const baseReturnDecimal = (Number(state.expectedReturn) || 7.2) / 100;
    const inflationDecimal = (Number(state.inflationRate) || 2.5) / 100;
    const divYieldDecimal = Math.max(0, (Number(state.taxableDividendYield) || 1.8) / 100);
    const turnoverDecimal = Math.max(0, Math.min(1, (Number(state.taxableTurnoverRate) || 15.0) / 100));

    let taxableBalance = Math.max(0, Number(state.taxableBalance) || 0);
    const basisRatioInit = Math.max(0, Math.min(1, (Number(state.taxableCostBasisRatio) || 60) / 100));
    let taxableCostBasis = taxableBalance * basisRatioInit;
    let preTaxBalance = Math.max(0, Number(state.preTaxBalance) || 0);
    let rothBalance = Math.max(0, Number(state.rothBalance) || 0);

    // Initialize Deferred Compensation tranches from state (or single balance if no tranches)
    let deferredCompBalance = Math.max(0, Number(state.deferredCompBalance) || 0);
    let defCompTranches = [];
    if (Array.isArray(state.deferredCompSchedule) && state.deferredCompSchedule.length > 0) {
      defCompTranches = state.deferredCompSchedule.map((t) => ({
        planName: t.planName || 'Deferred Comp',
        source: t.source || 'Deferral',
        distributionStartYear: Number(t.distributionStartYear) || baseYear,
        installmentYears: Math.max(1, Number(t.installmentYears) || 1),
        balance: Math.max(0, Number(t.balance) || 0),
        yearsRemaining: Math.max(1, Number(t.installmentYears) || 1)
      }));
    } else if (deferredCompBalance > 0) {
      defCompTranches.push({
        planName: 'Deferred Comp Plan',
        source: 'General Deferral',
        distributionStartYear: baseYear,
        installmentYears: 5,
        balance: deferredCompBalance,
        yearsRemaining: 5
      });
    }

    const trustAccount = global.TrustEngine.createTrustAccount(state, totalYears);
    const mortgageTracker = global.MortgageEngine.createMortgageTracker(state);

    const years = [];
    let cumulativeWaTax = 0;
    let cumulativeNiitTax = 0;
    let cumulativeFederalTax = 0;
    let cumulativeCharitableDeductionUsed = 0;
    let cumulativeCharitableTaxSavings = 0;
    let peakNetWorth = 0;
    let peakNetWorthAge = startAge;
    let depleted = false;

    for (let y = 0; y < totalYears; y++) {
      const age = startAge + y;
      const calendarYear = baseYear + y;
      const inflationFactor = Math.pow(1 + inflationDecimal, y);
      const isRetired = age >= retirementAge;
      const isFinalYear = age === endAge;

      const annualTotalReturn =
        customReturns && customReturns[y] !== undefined ? customReturns[y] : baseReturnDecimal;

      // 1. Baseline Inflows (Earned Income, Social Security & Deferred Comp Distributions)
      const earnedIncome = !isRetired ? (Number(state.preRetirementIncome) || 0) * inflationFactor : 0;

      // Multi-Beneficiary Social Security Cash-Flow Modeling (Primary & Spouse)
      let primarySocialSecurityGross = 0;
      let spouseSocialSecurityGross = 0;

      if (state.ssPrimaryEnabled) {
        const primaryClaimAge = Number(state.ssPrimaryClaimAge) || 67;
        const primaryCurrentAge = state.ssPrimaryBirthYear
          ? calendarYear - Number(state.ssPrimaryBirthYear)
          : age;
        if (primaryCurrentAge >= primaryClaimAge) {
          primarySocialSecurityGross = (Number(state.ssPrimaryAnnualBenefit) || 0) * inflationFactor;
        }

        if (state.ssSpouseEnabled) {
          const spouseClaimAge = Number(state.ssSpouseClaimAge) || 67;
          const spouseBirthYear = Number(state.ssSpouseBirthYear) || Number(state.ssPrimaryBirthYear) || (baseYear - age);
          const spouseCurrentAge = calendarYear - spouseBirthYear;
          if (spouseCurrentAge >= spouseClaimAge) {
            spouseSocialSecurityGross = (Number(state.ssSpouseAnnualBenefit) || 0) * inflationFactor;
          }
        }
      }

      const socialSecurityGross = state.ssPrimaryEnabled
        ? primarySocialSecurityGross + spouseSocialSecurityGross
        : age >= (Number(state.socialSecurityStartAge) || 67)
        ? (Number(state.socialSecurityAnnual) || 0) * inflationFactor
        : 0;

      const taxableSocialSecurity = socialSecurityGross * 0.85;

      // Calculate Nonqualified Deferred Compensation (NQDC) distribution for this calendar year
      let deferredCompDistribution = 0;
      defCompTranches.forEach((tranche) => {
        if (calendarYear >= tranche.distributionStartYear && tranche.balance > 0 && tranche.yearsRemaining > 0) {
          const installment = tranche.balance / tranche.yearsRemaining;
          deferredCompDistribution += installment;
          tranche.balance = Math.max(0, tranche.balance - installment);
          tranche.yearsRemaining = Math.max(0, tranche.yearsRemaining - 1);
        }
      });

      // 2. Living Expenses (indexed for inflation)
      const livingExpenses = (Number(state.annualLivingExpenses) || 0) * inflationFactor;

      // 3. Strategic Pre-Tax Meltdown (Ages 59.5/60 to 74) & SECURE 2.0 RMDs (Age 75+)
      const rmdAmount = global.TaxEngine.calculateRMD(age, preTaxBalance, 75);
      preTaxBalance = Math.max(0, preTaxBalance - rmdAmount);

      let earlyPreTaxDraw = 0;
      if (
        !disableMeltdown &&
        age >= (Number(state.earlyPreTaxStartAge) || 60) &&
        age <= (Number(state.earlyPreTaxEndAge) || 74) &&
        age < 75
      ) {
        earlyPreTaxDraw = Math.min(preTaxBalance, Math.max(0, Number(state.earlyPreTaxDrawAnnual) || 0));
        preTaxBalance -= earlyPreTaxDraw;
      }

      let rothConversion = 0;
      if (
        !disableMeltdown &&
        age >= (Number(state.rothConversionStartAge) || 60) &&
        age <= (Number(state.rothConversionEndAge) || 74)
      ) {
        rothConversion = Math.min(preTaxBalance, Math.max(0, Number(state.rothConversionAnnual) || 0));
        preTaxBalance -= rothConversion;
        rothBalance += rothConversion;
      }

      // 4. Step CRUT / CRAT 4-Tier Engine
      const trustStep = global.TrustEngine.stepTrustYear(trustAccount, y);

      // 5. Wealth Replacement Trust (ILIT) Premium & Death Benefit at Life Expectancy
      const ilitActive = Boolean(state.trustEnabled && state.ilitEnabled);
      const ilitPremium = ilitActive ? Math.max(0, Number(state.ilitAnnualPremium) || 0) : 0;
      const ilitDeathBenefit =
        ilitActive && isFinalYear ? Math.max(0, Number(state.ilitDeathBenefit) || 0) : 0;

      // 6. Step Mortgage Amortization & Accelerated Principal Payoff
      const mortgageStep = global.MortgageEngine.stepMortgageYear(mortgageTracker, y);

      // Handle Mortgage Lump-Sum Payoff deduction from designated account
      let mortgageLumpSumDraw = 0;
      let mortgageLumpSumLTCG = 0;
      let mortgageLumpSumPreTaxDraw = 0;
      let mortgageLumpSumPenalty = 0;

      if (mortgageStep.lumpSumPayoffAmount > 0) {
        const payoffAmount = mortgageStep.lumpSumPayoffAmount;
        let chosenSource = state.mortgageLumpSumSource || 'pre_tax';

        // Check if user selected an imported account
        if (
          state.mortgageAccountId &&
          state.mortgageAccountId !== 'pre_tax' &&
          state.mortgageAccountId !== 'taxable' &&
          state.mortgageAccountId !== 'roth'
        ) {
          const acct = (state.importedAccounts || []).find(
            (a) =>
              a.accountName === state.mortgageAccountId ||
              a.statementId === state.mortgageAccountId ||
              a.accountNumber === state.mortgageAccountId
          );
          if (acct) {
            if (acct.bucket === 'Pre-Tax') chosenSource = 'pre_tax';
            else if (acct.bucket === 'Roth') chosenSource = 'roth';
            else chosenSource = 'taxable';
          }
        }

        const isUnder59_5 = age < 59.5;

        if (chosenSource === 'pre_tax') {
          // Pre-tax withdrawal is ordinary income
          if (state.mortgageGrossUpTax) {
            // Gross up withdrawal so net proceeds after taxes cover the payoff
            const estMarginalRate = 0.32;
            const penaltyRate = isUnder59_5 ? 0.10 : 0;
            const grossNeeded = payoffAmount / Math.max(0.40, 1 - (estMarginalRate + penaltyRate));
            const actualGrossDraw = Math.min(preTaxBalance, grossNeeded);
            preTaxBalance = Math.max(0, preTaxBalance - actualGrossDraw);
            mortgageLumpSumPreTaxDraw = actualGrossDraw;
            if (isUnder59_5) {
              mortgageLumpSumPenalty = actualGrossDraw * 0.10;
            }
            mortgageLumpSumDraw = actualGrossDraw;
          } else {
            // Withdraw exact mortgage payoff amount
            const actualGrossDraw = Math.min(preTaxBalance, payoffAmount);
            preTaxBalance = Math.max(0, preTaxBalance - actualGrossDraw);
            mortgageLumpSumPreTaxDraw = actualGrossDraw;
            if (isUnder59_5) {
              mortgageLumpSumPenalty = actualGrossDraw * 0.10;
            }
            mortgageLumpSumDraw = actualGrossDraw;
          }
        } else if (chosenSource === 'roth') {
          const actualDraw = Math.min(rothBalance, payoffAmount);
          rothBalance = Math.max(0, rothBalance - actualDraw);
          mortgageLumpSumDraw = actualDraw;
        } else {
          // Taxable brokerage source
          const gainRatio =
            taxableBalance > 0 ? Math.max(0, (taxableBalance - taxableCostBasis) / taxableBalance) : 0;
          const actualDraw = Math.min(taxableBalance, payoffAmount);
          const realizedGain = actualDraw * gainRatio;
          const basisUsed = actualDraw - realizedGain;
          taxableBalance = Math.max(0, taxableBalance - actualDraw);
          taxableCostBasis = Math.max(0, taxableCostBasis - basisUsed);
          mortgageLumpSumDraw = actualDraw;
          mortgageLumpSumLTCG = realizedGain;
        }
      }

      // 7. Portfolio Growth & Taxable Brokerage Dividends / Turnover Realization
      const priceAppreciationRate = annualTotalReturn - divYieldDecimal;
      const brokerageDividendsTotal = Math.max(0, taxableBalance * divYieldDecimal);
      const brokerageOrdinaryDividends = brokerageDividendsTotal * 0.35;
      const brokerageQualifiedDividends = brokerageDividendsTotal * 0.65;

      const taxablePriceChange = taxableBalance * priceAppreciationRate;
      taxableBalance = Math.max(0, taxableBalance + taxablePriceChange);
      if (taxableCostBasis > taxableBalance) {
        taxableCostBasis = taxableBalance;
      }

      // Realize turnover capital gains in Taxable bucket
      const unrealizedGainBeforeTurnover = Math.max(0, taxableBalance - taxableCostBasis);
      const turnoverRealizedLTCG = unrealizedGainBeforeTurnover * turnoverDecimal;
      // Turnover realizes gain and steps up cost basis when reinvested
      taxableCostBasis += turnoverRealizedLTCG;

      // Grow Pre-Tax, Roth, and remaining Deferred Comp accounts
      preTaxBalance = Math.max(0, preTaxBalance * (1 + annualTotalReturn));
      rothBalance = Math.max(0, rothBalance * (1 + annualTotalReturn));
      defCompTranches.forEach((tranche) => {
        if (tranche.balance > 0) {
          tranche.balance *= 1 + annualTotalReturn;
        }
      });
      deferredCompBalance = defCompTranches.reduce((sum, t) => sum + t.balance, 0);

      // 8. Charitable Deduction Carryforward Pool (Year 0 + 6 Carryforward Years = 7 Tax Years)
      const availableCharitableDeduction =
        trustAccount && y <= 6 ? Math.max(0, trustAccount.deductionCarryforwardRemaining) : 0;

      // 9. First-Pass Tax & Cash-Flow Evaluation (before any shortfall liquidation)
      const cashInflowsBeforeDraw =
        earnedIncome +
        socialSecurityGross +
        deferredCompDistribution +
        rmdAmount +
        earlyPreTaxDraw +
        mortgageLumpSumDraw +
        trustStep.grossDistribution +
        brokerageDividendsTotal;

      const nonTaxOutflows =
        livingExpenses + mortgageStep.totalPayment + ilitPremium + mortgageLumpSumPenalty;

      let taxEval = global.TaxEngine.evaluateAnnualTaxes({
        yearIndex: y,
        filingStatus: state.filingStatus,
        inflationRateDecimal: inflationDecimal,
        earnedIncome,
        taxableSocialSecurity,
        deferredCompDistribution,
        earlyPreTaxDraw: earlyPreTaxDraw + mortgageLumpSumPreTaxDraw,
        rmdAmount,
        rothConversion,
        brokerageOrdinaryDividends,
        brokerageQualifiedDividends,
        brokerageRealizedLTCG: turnoverRealizedLTCG + mortgageLumpSumLTCG,
        trustTier1Ordinary: trustStep.tier1Distributed,
        trustTier2CapGains: trustStep.tier2Distributed,
        deductibleMortgageInterest: mortgageStep.deductibleInterest,
        charitableDeductionAvailable: availableCharitableDeduction,
        charitableAgiLimitPct: Number(state.charitableAgiLimit) || 30,
        waCapGainsEnabled: Boolean(state.waCapGainsEnabled),
        waCapGainsBaseThreshold: Number(state.waCapGainsBaseThreshold) || 278000,
        waCapGainsIndexFrom2025: Boolean(state.waCapGainsIndexFrom2025),
        niitEnabled: Boolean(state.niitEnabled)
      });

      // 10. Reconcile Cash Flow Surplus or Shortfall (Taxable -> Pre-Tax -> Roth)
      let netCashFlowBeforePortfolio = cashInflowsBeforeDraw - (nonTaxOutflows + taxEval.totalAllTaxes);
      let taxableWithdrawal = 0;
      let withdrawalRealizedLTCG = 0;
      let additionalPreTaxWithdrawal = 0;
      let rothWithdrawal = 0;

      if (netCashFlowBeforePortfolio >= 0) {
        // Reinvest cash surplus into Taxable Brokerage (basis increases by reinvested cash)
        taxableBalance += netCashFlowBeforePortfolio;
        taxableCostBasis += netCashFlowBeforePortfolio;
      } else {
        let shortfall = -netCashFlowBeforePortfolio;

        // Draw 1: Taxable Brokerage (realizes proportional capital gain)
        if (taxableBalance > 0 && shortfall > 0) {
          const gainRatio =
            taxableBalance > 0 ? Math.max(0, (taxableBalance - taxableCostBasis) / taxableBalance) : 0;
          // Gross up slightly for LTCG tax on liquidation
          const estimatedTaxDragRate = gainRatio * 0.188;
          const neededFromTaxable = Math.min(taxableBalance, shortfall / Math.max(0.75, 1 - estimatedTaxDragRate));
          taxableWithdrawal = neededFromTaxable;
          withdrawalRealizedLTCG = taxableWithdrawal * gainRatio;
          const basisReduction = taxableWithdrawal - withdrawalRealizedLTCG;

          taxableBalance = Math.max(0, taxableBalance - taxableWithdrawal);
          taxableCostBasis = Math.max(0, taxableCostBasis - basisReduction);

          // Re-evaluate taxes with withdrawal LTCG included
          taxEval = global.TaxEngine.evaluateAnnualTaxes({
            yearIndex: y,
            filingStatus: state.filingStatus,
            inflationRateDecimal: inflationDecimal,
            earnedIncome,
            taxableSocialSecurity,
            deferredCompDistribution,
            earlyPreTaxDraw: earlyPreTaxDraw + mortgageLumpSumPreTaxDraw,
            rmdAmount,
            rothConversion,
            brokerageOrdinaryDividends,
            brokerageQualifiedDividends,
            brokerageRealizedLTCG: turnoverRealizedLTCG + mortgageLumpSumLTCG + withdrawalRealizedLTCG,
            trustTier1Ordinary: trustStep.tier1Distributed,
            trustTier2CapGains: trustStep.tier2Distributed,
            deductibleMortgageInterest: mortgageStep.deductibleInterest,
            charitableDeductionAvailable: availableCharitableDeduction,
            charitableAgiLimitPct: Number(state.charitableAgiLimit) || 30,
            waCapGainsEnabled: Boolean(state.waCapGainsEnabled),
            waCapGainsBaseThreshold: Number(state.waCapGainsBaseThreshold) || 278000,
            waCapGainsIndexFrom2025: Boolean(state.waCapGainsIndexFrom2025),
            niitEnabled: Boolean(state.niitEnabled)
          });

          const updatedShortfall =
            nonTaxOutflows + taxEval.totalAllTaxes - cashInflowsBeforeDraw - taxableWithdrawal;
          shortfall = Math.max(0, updatedShortfall);
          if (updatedShortfall < 0) {
            // Slight over-withdrawal returned to cash
            taxableBalance += -updatedShortfall;
            taxableCostBasis += -updatedShortfall;
          }
        }

        // Draw 2: Pre-Tax Retirement Account (if Taxable exhausted)
        if (preTaxBalance > 0 && shortfall > 0) {
          const grossUpFactor = 1 / Math.max(0.63, 1 - (taxEval.fedOrdinaryMarginalRate || 0.24));
          additionalPreTaxWithdrawal = Math.min(preTaxBalance, shortfall * grossUpFactor);
          preTaxBalance = Math.max(0, preTaxBalance - additionalPreTaxWithdrawal);

          taxEval = global.TaxEngine.evaluateAnnualTaxes({
            yearIndex: y,
            filingStatus: state.filingStatus,
            inflationRateDecimal: inflationDecimal,
            earnedIncome,
            taxableSocialSecurity,
            deferredCompDistribution,
            earlyPreTaxDraw:
              earlyPreTaxDraw + mortgageLumpSumPreTaxDraw + additionalPreTaxDraw_safe(additionalPreTaxWithdrawal),
            rmdAmount,
            rothConversion,
            brokerageOrdinaryDividends,
            brokerageQualifiedDividends,
            brokerageRealizedLTCG: turnoverRealizedLTCG + mortgageLumpSumLTCG + withdrawalRealizedLTCG,
            trustTier1Ordinary: trustStep.tier1Distributed,
            trustTier2CapGains: trustStep.tier2Distributed,
            deductibleMortgageInterest: mortgageStep.deductibleInterest,
            charitableDeductionAvailable: availableCharitableDeduction,
            charitableAgiLimitPct: Number(state.charitableAgiLimit) || 30,
            waCapGainsEnabled: Boolean(state.waCapGainsEnabled),
            waCapGainsBaseThreshold: Number(state.waCapGainsBaseThreshold) || 278000,
            waCapGainsIndexFrom2025: Boolean(state.waCapGainsIndexFrom2025),
            niitEnabled: Boolean(state.niitEnabled)
          });

          const afterPreTaxShortfall =
            nonTaxOutflows +
            taxEval.totalAllTaxes -
            cashInflowsBeforeDraw -
            taxableWithdrawal -
            additionalPreTaxWithdrawal;
          shortfall = Math.max(0, afterPreTaxShortfall);
        }

        // Draw 3: Roth Account (tax-free)
        if (rothBalance > 0 && shortfall > 0) {
          rothWithdrawal = Math.min(rothBalance, shortfall);
          rothBalance = Math.max(0, rothBalance - rothWithdrawal);
          shortfall = Math.max(0, shortfall - rothWithdrawal);
        }

        if (shortfall > 100 && taxableBalance <= 1 && preTaxBalance <= 1 && rothBalance <= 1) {
          depleted = true;
        }
      }

      // 11. Measure Direct Tax Reduction from Upfront Charitable Deduction (in years 0..6)
      let charitableTaxSavedThisYear = 0;
      if (taxEval.charitableDeductionUsed > 0 && trustAccount) {
        const taxWithoutCharitable = global.TaxEngine.evaluateAnnualTaxes({
          yearIndex: y,
          filingStatus: state.filingStatus,
          inflationRateDecimal: inflationDecimal,
          earnedIncome,
          taxableSocialSecurity,
          deferredCompDistribution,
          earlyPreTaxDraw:
            earlyPreTaxDraw + mortgageLumpSumPreTaxDraw + additionalPreTaxWithdrawal,
          rmdAmount,
          rothConversion,
          brokerageOrdinaryDividends,
          brokerageQualifiedDividends,
          brokerageRealizedLTCG: turnoverRealizedLTCG + mortgageLumpSumLTCG + withdrawalRealizedLTCG,
          trustTier1Ordinary: trustStep.tier1Distributed,
          trustTier2CapGains: trustStep.tier2Distributed,
          deductibleMortgageInterest: mortgageStep.deductibleInterest,
          charitableDeductionAvailable: 0,
          charitableAgiLimitPct: Number(state.charitableAgiLimit) || 30,
          waCapGainsEnabled: Boolean(state.waCapGainsEnabled),
          waCapGainsBaseThreshold: Number(state.waCapGainsBaseThreshold) || 278000,
          waCapGainsIndexFrom2025: Boolean(state.waCapGainsIndexFrom2025),
          niitEnabled: Boolean(state.niitEnabled)
        });
        charitableTaxSavedThisYear = Math.max(
          0,
          taxWithoutCharitable.totalAllTaxes - taxEval.totalAllTaxes
        );
        cumulativeCharitableTaxSavings += charitableTaxSavedThisYear;
        cumulativeCharitableDeductionUsed += taxEval.charitableDeductionUsed;
        trustAccount.deductionCarryforwardRemaining = Math.max(
          0,
          trustAccount.deductionCarryforwardRemaining - taxEval.charitableDeductionUsed
        );
      }

      // Expire unused carryforward after Year 6 (1 initial year + 6 carryforward years)
      if (trustAccount && y === 6) {
        trustAccount.deductionCarryforwardRemaining = 0;
      }

      cumulativeWaTax += taxEval.waCapGains.waTax;
      cumulativeNiitTax += taxEval.niit.niitTax;
      cumulativeFederalTax += taxEval.totalFederalTax;

      const personalLiquidNetWorth =
        taxableBalance + preTaxBalance + rothBalance + deferredCompBalance - mortgageStep.endingBalance;
      const totalWealthPoolWithTrustAndIlit =
        personalLiquidNetWorth + trustStep.endingNav + ilitDeathBenefit;

      if (totalWealthPoolWithTrustAndIlit > peakNetWorth) {
        peakNetWorth = totalWealthPoolWithTrustAndIlit;
        peakNetWorthAge = age;
      }

      years.push({
        yearIndex: y,
        calendarYear,
        age,
        isRetired,
        // Balances
        taxableBalance,
        taxableCostBasis,
        preTaxBalance,
        rothBalance,
        deferredCompBalance,
        trustNav: trustStep.endingNav,
        ilitDeathBenefit,
        mortgageBalance: mortgageStep.endingBalance,
        personalLiquidNetWorth,
        totalWealthPool: totalWealthPoolWithTrustAndIlit,
        // Inflows
        earnedIncome,
        socialSecurityGross,
        primarySocialSecurityGross,
        spouseSocialSecurityGross,
        deferredCompDistribution,
        rmdAmount,
        earlyPreTaxDraw: earlyPreTaxDraw + mortgageLumpSumPreTaxDraw,
        additionalPreTaxWithdrawal,
        rothConversion,
        rothWithdrawal,
        taxableWithdrawal,
        mortgageLumpSumDraw,
        mortgageLumpSumPreTaxDraw,
        mortgageLumpSumLTCG,
        mortgageLumpSumPenalty,
        brokerageDividendsTotal,
        brokerageRealizedLTCG: turnoverRealizedLTCG + mortgageLumpSumLTCG + withdrawalRealizedLTCG,
        // Trust 4-Tier Details
        trustGrossPayout: trustStep.grossDistribution,
        trustTier1Ordinary: trustStep.tier1Distributed,
        trustTier2CapGains: trustStep.tier2Distributed,
        trustTier3TaxExempt: trustStep.tier3Distributed,
        trustTier4Corpus: trustStep.tier4Distributed,
        trustTiersRemaining: trustStep.tiersAfter,
        charitableDeductionUsed: taxEval.charitableDeductionUsed,
        charitableCarryforwardRemaining: trustAccount ? trustAccount.deductionCarryforwardRemaining : 0,
        charitableTaxSavedThisYear,
        // Outflows & Taxes
        livingExpenses,
        ilitPremium,
        mortgageTotalPayment: mortgageStep.totalPayment,
        mortgageInterestPaid: mortgageStep.interestPaid,
        mortgageScheduledPrincipal: mortgageStep.scheduledPrincipal,
        mortgageAcceleratedPrincipal: mortgageStep.acceleratedExtraPrincipal,
        mortgageLumpSumPayoff: mortgageStep.lumpSumPayoffAmount,
        mortgageDeductibleInterest: mortgageStep.deductibleInterest,
        fedOrdinaryTax: taxEval.fedOrdinaryTax,
        fedLTCGTax: taxEval.fedLTCGTax,
        niitTax: taxEval.niit.niitTax,
        niitExposed: taxEval.niit.exposedAmount,
        magi: taxEval.niit.magi,
        waCapGainsThreshold: taxEval.waCapGains.indexedThreshold,
        waTaxableLTCG: taxEval.waCapGains.totalWaTaxableLTCG,
        waCapGainsTax: taxEval.waCapGains.waTax,
        totalTaxes: taxEval.totalAllTaxes,
        totalInflows:
          earnedIncome +
          socialSecurityGross +
          deferredCompDistribution +
          rmdAmount +
          earlyPreTaxDraw +
          mortgageLumpSumDraw +
          additionalPreTaxWithdrawal +
          trustStep.grossDistribution +
          brokerageDividendsTotal +
          taxableWithdrawal +
          rothWithdrawal,
        totalOutflows:
          livingExpenses +
          mortgageStep.totalPayment +
          ilitPremium +
          taxEval.totalAllTaxes +
          mortgageLumpSumPenalty
      });
    }

    return {
      years,
      trustValuation: trustAccount ? trustAccount.valuation : global.TrustEngine.calculateActuarialValuation(state),
      mortgageScenarios: global.MortgageEngine.evaluateMortgageScenarios(state),
      summary: {
        peakNetWorth,
        peakNetWorthAge,
        terminalWealth: years.length > 0 ? years[years.length - 1].totalWealthPool : 0,
        cumulativeWaTax,
        cumulativeNiitTax,
        cumulativeFederalTax,
        cumulativeCharitableDeductionUsed,
        cumulativeCharitableTaxSavings,
        depleted
      }
    };
  }

  function additionalPreTaxDraw_safe(val) {
    return isFinite(val) && val > 0 ? val : 0;
  }

  /**
   * Runs the full deterministic projection plus:
   *  1. The No-Meltdown RMD comparison baseline (for Chart 2), and
   *  2. The Year-1 Avoided Capital Gains Tax + 6-Year Carryforward Charitable Deduction Tax Savings
   *     (for the "Tax Savings from Trusts" summary card).
   */
  function runFullSimulation(state) {
    const activeRun = runTrajectory(state, { disableMeltdown: false });
    const noMeltdownRun = runTrajectory(state, { disableMeltdown: true });

    // Compute Year-1 Avoided Capital Gains Tax on the contributed concentrated stock position
    let year1AvoidedCapGainsTax = 0;
    if (state.trustEnabled && Number(state.trustAssetValue) > 0) {
      const contributedStockGain = Math.max(
        0,
        (Number(state.trustAssetValue) || 0) - (Number(state.trustCostBasis) || 0)
      );
      if (contributedStockGain > 0 && activeRun.years.length > 0) {
        const y0 = activeRun.years[0];
        const inflationDecimal = (Number(state.inflationRate) || 2.5) / 100;

        const baseYear0Taxes = global.TaxEngine.evaluateAnnualTaxes({
          yearIndex: 0,
          filingStatus: state.filingStatus,
          inflationRateDecimal: inflationDecimal,
          earnedIncome: y0.earnedIncome,
          taxableSocialSecurity: y0.socialSecurityGross * 0.85,
          deferredCompDistribution: y0.deferredCompDistribution,
          earlyPreTaxDraw: y0.earlyPreTaxDraw,
          rmdAmount: y0.rmdAmount,
          rothConversion: y0.rothConversion,
          brokerageOrdinaryDividends: y0.brokerageDividendsTotal * 0.35,
          brokerageQualifiedDividends: y0.brokerageDividendsTotal * 0.65,
          brokerageRealizedLTCG: y0.brokerageRealizedLTCG,
          trustTier1Ordinary: 0,
          trustTier2CapGains: 0,
          deductibleMortgageInterest: y0.mortgageDeductibleInterest,
          charitableDeductionAvailable: 0,
          charitableAgiLimitPct: Number(state.charitableAgiLimit) || 30,
          waCapGainsEnabled: Boolean(state.waCapGainsEnabled),
          waCapGainsBaseThreshold: Number(state.waCapGainsBaseThreshold) || 278000,
          waCapGainsIndexFrom2025: Boolean(state.waCapGainsIndexFrom2025),
          niitEnabled: Boolean(state.niitEnabled)
        });

        const outrightSaleYear0Taxes = global.TaxEngine.evaluateAnnualTaxes({
          yearIndex: 0,
          filingStatus: state.filingStatus,
          inflationRateDecimal: inflationDecimal,
          earnedIncome: y0.earnedIncome,
          taxableSocialSecurity: y0.socialSecurityGross * 0.85,
          deferredCompDistribution: y0.deferredCompDistribution,
          earlyPreTaxDraw: y0.earlyPreTaxDraw,
          rmdAmount: y0.rmdAmount,
          rothConversion: y0.rothConversion,
          brokerageOrdinaryDividends: y0.brokerageDividendsTotal * 0.35,
          brokerageQualifiedDividends: y0.brokerageDividendsTotal * 0.65,
          brokerageRealizedLTCG: y0.brokerageRealizedLTCG + contributedStockGain,
          trustTier1Ordinary: 0,
          trustTier2CapGains: 0,
          deductibleMortgageInterest: y0.mortgageDeductibleInterest,
          charitableDeductionAvailable: 0,
          charitableAgiLimitPct: Number(state.charitableAgiLimit) || 30,
          waCapGainsEnabled: Boolean(state.waCapGainsEnabled),
          waCapGainsBaseThreshold: Number(state.waCapGainsBaseThreshold) || 278000,
          waCapGainsIndexFrom2025: Boolean(state.waCapGainsIndexFrom2025),
          niitEnabled: Boolean(state.niitEnabled)
        });

        year1AvoidedCapGainsTax = Math.max(
          0,
          outrightSaleYear0Taxes.totalAllTaxes - baseYear0Taxes.totalAllTaxes
        );
      }
    }

    const totalTaxSavingsFromTrusts = state.trustEnabled
      ? year1AvoidedCapGainsTax + activeRun.summary.cumulativeCharitableTaxSavings
      : 0;

    // Attach RMD comparison series to each year
    const rmdComparison = activeRun.years.map((yr, idx) => {
      const baselineYr = noMeltdownRun.years[idx] || yr;
      return {
        age: yr.age,
        calendarYear: yr.calendarYear,
        rmdWithStrategy: yr.rmdAmount,
        rmdWithoutStrategy: baselineYr.rmdAmount,
        preTaxWithStrategy: yr.preTaxBalance,
        preTaxWithoutStrategy: baselineYr.preTaxBalance
      };
    });

    const totalRmdWithStrategy = rmdComparison.reduce((s, r) => s + r.rmdWithStrategy, 0);
    const totalRmdWithoutStrategy = rmdComparison.reduce((s, r) => s + r.rmdWithoutStrategy, 0);

    const trustSchedule = global.TrustEngine.projectStandaloneTrustSchedule(state);

    return {
      years: activeRun.years,
      rmdComparison,
      trustValuation: activeRun.trustValuation,
      trustSchedule,
      summary: Object.assign({}, activeRun.summary, {
        year1AvoidedCapGainsTax,
        totalTaxSavingsFromTrusts,
        totalRmdWithStrategy,
        totalRmdWithoutStrategy,
        rmdReductionDollar: Math.max(0, totalRmdWithoutStrategy - totalRmdWithStrategy)
      })
    };
  }

  global.SimulatorEngine = {
    runTrajectory,
    runFullSimulation
  };
})(window);
