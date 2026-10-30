// ==========================================================================
// HNW Retirement & Trust Optimization Web Application — Trust Engine
// Implements:
//  1. Exact Actuarial CRUT Derivation per Klaus Gottlieb, SSRN-5924942
//     (IRC § 7520, Treas. Reg. § 1.664-4, Equations 1-6, and IRS Table 2010CM)
//  2. CRAT Valuation (Treas. Reg. § 1.664-2(c) & Table K)
//  3. IRC § 664(b) 4-Tier Distribution Accounting (Strict WIFO Ordering)
//  4. 6-Year Charitable Deduction Carryforward & ILIT Wealth Replacement
// ==========================================================================

(function (global) {
  'use strict';

  /**
   * Official IRS Table 2010CM (26 CFR § 20.2031-7(d)(7)(ii))
   * Number of persons alive (l_x) at integer age x (ages 0 through 110).
   */
  const TABLE_2010CM = [
    100000.00, 99382.28, 99341.16, 99313.80, 99292.72, 99276.45, 99261.55, 99248.33, 99236.50, 99226.09,
    99217.03, 99208.80, 99199.98, 99188.21, 99170.64, 99145.34, 99111.91, 99070.69, 99021.50, 98964.16,
    98898.61, 98824.20, 98741.32, 98652.16, 98559.87, 98466.80, 98373.71, 98280.09, 98185.51, 98089.05,
    97989.90, 97887.47, 97781.58, 97672.13, 97559.20, 97442.53, 97321.14, 97193.66, 97058.84, 96915.25,
    96761.20, 96595.51, 96416.30, 96220.61, 96005.41, 95768.60, 95509.98, 95229.06, 94923.45, 94589.88,
    94225.50, 93828.33, 93398.01, 92934.52, 92438.08, 91907.95, 91342.02, 90737.24, 90090.97, 89401.06,
    88665.95, 87883.66, 87051.88, 86167.86, 85226.77, 84221.59, 83142.34, 81978.28, 80728.83, 79387.95,
    77957.53, 76429.84, 74797.63, 73049.33, 71177.55, 69174.83, 67044.59, 64773.93, 62366.05, 59795.50,
    57080.84, 54213.71, 51205.27, 48059.88, 44808.51, 41399.79, 37895.25, 34313.98, 30700.82, 27106.68,
    23586.75, 20198.02, 16996.17, 14032.08, 11348.23, 8975.661, 6931.559, 5218.261, 3823.642, 2722.994,
    1882.108, 1261.083, 818.2641, 513.7236, 311.8784, 183.0200, 103.8046, 56.91106, 30.17214, 15.47804,
    0.000000
  ];

  /**
   * Returns l_x from IRS Table 2010CM for age x.
   */
  function getLx(age) {
    const idx = Math.floor(age);
    if (idx <= 0) return TABLE_2010CM[0];
    if (idx >= 110) return 0;
    return TABLE_2010CM[idx];
  }

  /**
   * Cumulative probability of death (_t q_x = 1 - l_{x+t} / l_x) per Treas. Reg. § 20.2031-7(d)(2)
   * and SSRN-5924942 Section 4.4.
   */
  function getCumulativeDeathProb(ageX, t) {
    if (t <= 0) return 0;
    const lx = getLx(ageX);
    if (lx <= 0) return 1;
    const lxt = getLx(ageX + t);
    return 1 - lxt / lx;
  }

  /**
   * Equation (1) of SSRN-5924942 (Treas. Reg. § 1.664-4(e)(6)(ii), Figure 4):
   * Exact "Table F" Payout Adjustment Factor F(i, p, d)
   *
   *   F(i, p, d) = [ (1/p) * i * v^(d/12) * (1 + i)^(1/p) ] / [ (1 + i) * ((1 + i)^(1/p) - 1) ]
   *
   * @param {number} i - Section 7520 annual interest rate (decimal, e.g. 0.050)
   * @param {number} p - Number of payments per year (e.g., 1, 2, 4, 12)
   * @param {number} d - Payment lag in months between valuation date and first payment (0 to 12)
   */
  function calculateTableFFactor(i, p = 1, d = 0) {
    const rate = Math.max(0.0001, Number(i) || 0.05);
    const freq = Math.max(1, Number(p) || 1);
    const lagMonths = Math.max(0, Number(d) || 0);

    const v = 1 / (1 + rate);
    const onePlusIPow = Math.pow(1 + rate, 1 / freq);
    const numerator = (1 / freq) * rate * Math.pow(v, lagMonths / 12) * onePlusIPow;
    const denominator = (1 + rate) * (onePlusIPow - 1);

    return denominator > 0 ? numerator / denominator : 1.0;
  }

  /**
   * Equation (2) of SSRN-5924942:
   * Adjusted Payout Rate u = r * F(i, p, d)
   */
  function calculateAdjustedPayoutRate(r, i, p = 1, d = 0) {
    const fFactor = calculateTableFFactor(i, p, d);
    return {
      fFactor,
      u: r * fFactor
    };
  }

  /**
   * Equation (3) of SSRN-5924942 (Table D):
   * Term-of-Years CRUT Remainder Factor = (1 - u)^n
   */
  function calculateTermCRUTRemainderFactor(u, nYears) {
    const clampedU = Math.max(0, Math.min(0.9999, u));
    const n = Math.max(1, Math.min(20, Math.round(nYears)));
    return Math.pow(1 - clampedU, n);
  }

  /**
   * Equation (4) of SSRN-5924942 (Treas. Reg. § 1.664-4(e)(5)(i), Treasury Figure 1 / Table U(1)):
   * Single-Life CRUT Remainder Factor
   *
   *   i_tilde = u / (1 - u)
   *   v_tilde = 1 / (1 + i_tilde) = 1 - u
   *   RF = (1 + i_tilde / 2) * sum_{t=0}^{110-x} v_tilde^(t+1) * (_{t+1}q_x - _tq_x)
   */
  function calculateSingleLifeCRUTRemainderFactor(u, ageX) {
    const clampedU = Math.max(0.0001, Math.min(0.999, u));
    const x = Math.max(0, Math.min(109, Math.round(ageX)));

    const iTilde = clampedU / (1 - clampedU);
    const vTilde = 1 - clampedU;
    const timingAdj = 1 + iTilde / 2;

    let sum = 0;
    const maxT = 110 - x;
    for (let t = 0; t < maxT; t++) {
      const qNext = getCumulativeDeathProb(x, t + 1);
      const qCurr = getCumulativeDeathProb(x, t);
      const probDeathInYearTPlus1 = qNext - qCurr;
      const decay = Math.pow(vTilde, t + 1);
      sum += decay * probDeathInYearTPlus1;
    }

    return Math.max(0, Math.min(1, timingAdj * sum));
  }

  /**
   * Equations (5) & (6) of SSRN-5924942 (Table U(2)):
   * Two-Life (Joint and Last Survivor) CRUT Remainder Factor
   *
   *   _tp_{xy} = 1 - (_tq_x * _tq_y)
   *   RF = (1 + i_tilde / 2) * sum_{t=0}^{infty} v_tilde^(t+1) * (_tp_{xy} - _{t+1}p_{xy})
   */
  function calculateTwoLifeCRUTRemainderFactor(u, ageX, ageY) {
    const clampedU = Math.max(0.0001, Math.min(0.999, u));
    const x = Math.max(0, Math.min(109, Math.round(ageX)));
    const y = Math.max(0, Math.min(109, Math.round(ageY)));

    const iTilde = clampedU / (1 - clampedU);
    const vTilde = 1 - clampedU;
    const timingAdj = 1 + iTilde / 2;

    let sum = 0;
    const maxT = Math.max(110 - x, 110 - y);
    for (let t = 0; t < maxT; t++) {
      const qxCurr = getCumulativeDeathProb(x, t);
      const qyCurr = getCumulativeDeathProb(y, t);
      const pxyCurr = 1 - qxCurr * qyCurr;

      const qxNext = getCumulativeDeathProb(x, t + 1);
      const qyNext = getCumulativeDeathProb(y, t + 1);
      const pxyNext = 1 - qxNext * qyNext;

      const probSecondDeathInYearTPlus1 = pxyCurr - pxyNext;
      const decay = Math.pow(vTilde, t + 1);
      sum += decay * probSecondDeathInYearTPlus1;
    }

    return Math.max(0, Math.min(1, timingAdj * sum));
  }

  /**
   * CRAT Remainder Valuation per 26 CFR § 1.664-2(c) and § 20.2031-7(d)(2)(iv).
   * Unlike CRUTs (which multiply by a Remainder Factor using the cancel-out assumption),
   * a CRAT values the fixed annuity stream at the § 7520 discount rate and subtracts it
   * literally from the initial corpus (SSRN-5924942 Footnotes 10 & 14).
   */
  function calculateCRATValuation({
    assetValue,
    payoutRateDecimal,
    section7520RateDecimal,
    durationType,
    termYears,
    ageX,
    ageY,
    paymentFrequency = 1
  }) {
    const i = Math.max(0.002, section7520RateDecimal);
    const p = Math.max(1, paymentFrequency);
    // Table K adjustment factor for annuity payable at end of period (Treas. Reg. § 20.2031-7(d)(2)(iv)(B))
    const tableKFactor = p === 1 ? 1.0 : i / (p * (Math.pow(1 + i, 1 / p) - 1));

    let ordinaryRemainderFactor = 0;
    const v = 1 / (1 + i);

    if (durationType === 'single_life') {
      const x = Math.max(0, Math.min(109, Math.round(ageX)));
      let sum = 0;
      for (let t = 0; t < 110 - x; t++) {
        const probDeath = getCumulativeDeathProb(x, t + 1) - getCumulativeDeathProb(x, t);
        sum += Math.pow(v, t + 1) * probDeath;
      }
      ordinaryRemainderFactor = (1 + i / 2) * sum;
    } else if (durationType === 'two_life') {
      const x = Math.max(0, Math.min(109, Math.round(ageX)));
      const y = Math.max(0, Math.min(109, Math.round(ageY)));
      const maxT = Math.max(110 - x, 110 - y);
      let sum = 0;
      for (let t = 0; t < maxT; t++) {
        const pCurr = 1 - getCumulativeDeathProb(x, t) * getCumulativeDeathProb(y, t);
        const pNext = 1 - getCumulativeDeathProb(x, t + 1) * getCumulativeDeathProb(y, t + 1);
        sum += Math.pow(v, t + 1) * (pCurr - pNext);
      }
      ordinaryRemainderFactor = (1 + i / 2) * sum;
    } else {
      const n = Math.max(1, Math.min(20, Math.round(termYears)));
      ordinaryRemainderFactor = Math.pow(v, n);
    }

    const baseAnnuityFactor = (1 - ordinaryRemainderFactor) / i;
    const adjustedAnnuityFactor = baseAnnuityFactor * tableKFactor;
    const annualAnnuityDollar = assetValue * payoutRateDecimal;
    const pvAnnuity = Math.min(assetValue, annualAnnuityDollar * adjustedAnnuityFactor);
    const charitableDeduction = Math.max(0, assetValue - pvAnnuity);
    const remainderFactor = assetValue > 0 ? charitableDeduction / assetValue : 0;

    return {
      fFactor: tableKFactor,
      u: payoutRateDecimal,
      iTilde: i,
      vTilde: v,
      remainderFactor,
      charitableDeduction,
      pvNonCharitableIncomeStream: pvAnnuity,
      passes10PercentTest: remainderFactor >= 0.10
    };
  }

  /**
   * Computes the full actuarial valuation of the CRUT or CRAT at inception,
   * exposing all intermediate variables from SSRN-5924942 Table 1 & Equations (1)-(6).
   */
  function calculateActuarialValuation(state) {
    const assetValue = Math.max(0, Number(state.trustAssetValue) || 0);
    const r = Math.max(0.05, Math.min(0.50, (Number(state.trustPayoutRate) || 6.5) / 100));
    // Section 7520 rate rounded to nearest 0.2% per Treas. Reg. § 1.7520-1(b)
    const raw7520 = (Number(state.section7520Rate) || 5.0) / 100;
    const i = Math.round(raw7520 * 500) / 500;
    const p = Number(state.trustPaymentFrequency) || 4;
    const d = Number(state.trustPaymentLagMonths) || 3;
    const durationType = state.trustDurationType || 'term';
    const n = Math.max(1, Math.min(20, Math.round(Number(state.trustTermYears) || 20)));
    const ageX = Math.max(1, Math.min(109, Math.round(Number(state.trustMeasuringAge1) || state.currentAge || 56)));
    const ageY = Math.max(1, Math.min(109, Math.round(Number(state.trustMeasuringAge2) || 54)));

    if ((state.trustType || 'CRUT') === 'CRAT') {
      const crat = calculateCRATValuation({
        assetValue,
        payoutRateDecimal: r,
        section7520RateDecimal: i,
        durationType,
        termYears: n,
        ageX,
        ageY,
        paymentFrequency: p
      });
      return Object.assign({}, crat, {
        trustType: 'CRAT',
        durationType,
        statedPayoutRate: r,
        section7520Rate: i,
        paymentFrequency: p,
        paymentLagMonths: d,
        termYears: n,
        ageX,
        ageY,
        discountFactorV: 1 / (1 + i),
        maxAllowablePayoutRate: 0.50
      });
    }

    // CRUT Valuation per SSRN-5924942 Equations (1) - (6)
    const { fFactor, u } = calculateAdjustedPayoutRate(r, i, p, d);
    const iTilde = u / (1 - u);
    const vTilde = 1 - u;

    let remainderFactor = 0;
    if (durationType === 'single_life') {
      remainderFactor = calculateSingleLifeCRUTRemainderFactor(u, ageX);
    } else if (durationType === 'two_life') {
      remainderFactor = calculateTwoLifeCRUTRemainderFactor(u, ageX, ageY);
    } else {
      remainderFactor = calculateTermCRUTRemainderFactor(u, n);
    }

    const charitableDeduction = assetValue * remainderFactor;
    const pvNonCharitableIncomeStream = Math.max(0, assetValue - charitableDeduction);
    const passes10PercentTest = remainderFactor >= 0.10;

    // Binary search for maximum stated payout rate r satisfying the 10% remainder test (IRC § 664(d)(2)(D))
    let lowR = 0.05;
    let highR = 0.50;
    for (let iter = 0; iter < 30; iter++) {
      const midR = (lowR + highR) / 2;
      const midU = midR * fFactor;
      let rf = 0;
      if (durationType === 'single_life') {
        rf = calculateSingleLifeCRUTRemainderFactor(midU, ageX);
      } else if (durationType === 'two_life') {
        rf = calculateTwoLifeCRUTRemainderFactor(midU, ageX, ageY);
      } else {
        rf = calculateTermCRUTRemainderFactor(midU, n);
      }
      if (rf >= 0.10) {
        lowR = midR;
      } else {
        highR = midR;
      }
    }

    return {
      trustType: state.trustType === 'FLIP_CRUT' ? 'FLIP_CRUT' : 'CRUT',
      durationType,
      statedPayoutRate: r,
      section7520Rate: i,
      paymentFrequency: p,
      paymentLagMonths: d,
      termYears: n,
      ageX,
      ageY,
      discountFactorV: 1 / (1 + i),
      fFactor,
      u,
      iTilde,
      vTilde,
      remainderFactor,
      charitableDeduction,
      pvNonCharitableIncomeStream,
      passes10PercentTest,
      maxAllowablePayoutRate: lowR
    };
  }

  /**
   * Initializes the IRC § 664(b) 4-Tier CRUT/CRAT state at inception (Year 1):
   * - Concentrated stock position is transferred into the trust and sold with $0 immediate Federal LTCG,
   *   $0 NIIT, and $0 WA State Capital Gains Excise Tax.
   * - Initial Tier 1 (Ordinary Income) = $0
   * - Initial Tier 2 (Untaxed LTCG) = max(0, AssetValue - CostBasis)
   * - Initial Tier 3 (Tax-Exempt Income) = $0
   * - Initial Tier 4 (Corpus / Principal Basis) = min(AssetValue, CostBasis)
   */
  const IRS_7520_RATES_FALLBACK = [
    { month: 'November 2026', rate: 6.2, midterm120: 6.11, revRuling: 'Rev. Rul. 2026-21' },
    { month: 'October 2026', rate: 5.6, midterm120: 5.54, revRuling: 'Rev. Rul. 2026-19' },
    { month: 'September 2026', rate: 5.4, midterm120: 5.40, revRuling: 'Rev. Rul. 2026-17' },
    { month: 'August 2026', rate: 5.2, midterm120: 5.23, revRuling: 'Rev. Rul. 2026-13' },
    { month: 'July 2026', rate: 5.2, midterm120: 5.23, revRuling: 'Rev. Rul. 2026-12' },
    { month: 'June 2026', rate: 5.0, midterm120: 4.97, revRuling: 'Rev. Rul. 2026-11' },
    { month: 'May 2026', rate: 5.0, midterm120: 4.91, revRuling: 'Rev. Rul. 2026-9' },
    { month: 'April 2026', rate: 4.6, midterm120: 4.59, revRuling: 'Rev. Rul. 2026-7' },
    { month: 'March 2026', rate: 4.8, midterm120: 4.72, revRuling: 'Rev. Rul. 2026-6' },
    { month: 'February 2026', rate: 4.6, midterm120: 4.63, revRuling: 'Rev. Rul. 2026-3' },
    { month: 'January 2026', rate: 4.6, midterm120: 4.57, revRuling: 'Rev. Rul. 2026-2' }
  ];

  /**
   * Computes the actuarial expected duration (in years) of the trust under IRS Table 2010CM:
   * - 'term': Fixed term n (1..20 years)
   * - 'single_life': Single-life expectancy e_x = round(sum_{t=1}^{110-x} (1 - _tq_x) + 0.5)
   * - 'two_life': Two-life last-survivor expectancy e_{xy} = round(sum_{t=1}^{max} (1 - _tq_x * _tq_y) + 0.5)
   */
  function calculateExpectedTrustDurationYears(state) {
    const durationType = state.trustDurationType || 'term';
    const baseYear = Number(state.baseYear) || 2026;
    const flipStartYear = Math.max(baseYear, Math.round(Number(state.trustFlipStartYear) || baseYear + 5));
    const flipDelayYears = state.trustType === 'FLIP_CRUT' ? Math.max(0, flipStartYear - baseYear) : 0;

    if (durationType === 'term') {
      const termN = Math.max(1, Math.min(20, Math.round(Number(state.trustTermYears) || 20)));
      return state.trustType === 'FLIP_CRUT' ? Math.max(termN, Math.min(20, flipDelayYears + 1)) : termN;
    }

    const ageX = Math.max(1, Math.min(109, Math.round(Number(state.trustMeasuringAge1) || state.currentAge || 55)));
    if (durationType === 'single_life') {
      let sumSurvival = 0;
      for (let t = 1; t <= 110 - ageX; t++) {
        sumSurvival += 1 - getCumulativeDeathProb(ageX, t);
      }
      const lifeExp = Math.max(1, Math.round(sumSurvival + 0.5));
      return Math.max(lifeExp, flipDelayYears + 5);
    }

    // 'two_life' (Two-Life Last Survivor)
    const ageY = Math.max(1, Math.min(109, Math.round(Number(state.trustMeasuringAge2) || 55)));
    const maxT = Math.max(110 - ageX, 110 - ageY);
    let sumLastSurvivor = 0;
    for (let t = 1; t <= maxT; t++) {
      const qx = getCumulativeDeathProb(ageX, t);
      const qy = getCumulativeDeathProb(ageY, t);
      sumLastSurvivor += 1 - qx * qy;
    }
    const twoLifeExp = Math.max(1, Math.round(sumLastSurvivor + 0.5));
    return Math.max(twoLifeExp, flipDelayYears + 5);
  }

  function createTrustAccount(state, totalProjectionYears, options = {}) {
    const forcePreview = Boolean(options.forcePreview);
    const rawAssetVal = Number(state.trustAssetValue) || 0;
    const effectiveAssetVal =
      rawAssetVal > 0
        ? rawAssetVal
        : forcePreview
        ? Number(state.taxableBalance) > 0
          ? Number(state.taxableBalance)
          : 1000000
        : 0;

    if ((!state.trustEnabled && !forcePreview) || effectiveAssetVal <= 0) {
      return null;
    }

    const assetValue = Math.max(0, effectiveAssetVal);
    const rawBasis =
      rawAssetVal > 0
        ? Number(state.trustCostBasis) || 0
        : effectiveAssetVal * ((Number(state.taxableCostBasisRatio) || 60) / 100);
    const costBasis = Math.max(0, Math.min(assetValue, rawBasis));
    const embeddedGain = Math.max(0, assetValue - costBasis);
    const valuation = calculateActuarialValuation(
      Object.assign({}, state, { trustAssetValue: assetValue, trustCostBasis: costBasis })
    );

    const activeYears = calculateExpectedTrustDurationYears(state);
    const baseYear = Number(state.baseYear) || 2026;
    const flipStartYear = Math.max(baseYear, Math.round(Number(state.trustFlipStartYear) || baseYear + 5));
    const flipDelayYears =
      state.trustType === 'FLIP_CRUT'
        ? Math.max(0, Math.min(activeYears - 1, flipStartYear - baseYear))
        : 0;

    return {
      enabled: true,
      trustType: state.trustType || 'CRUT',
      durationType: state.trustDurationType || 'term',
      baseYear,
      flipStartYear,
      flipDelayYears,
      initialAssetValue: assetValue,
      initialCostBasis: costBasis,
      initialEmbeddedGain: embeddedGain,
      payoutRateDecimal: (Number(state.trustPayoutRate) || 6.5) / 100,
      tier1RateDecimal: (Number(state.trustTier1Return) || 2.0) / 100,
      tier2RateDecimal: (Number(state.trustTier2Return) || 5.0) / 100,
      tier3RateDecimal: (Number(state.trustTier3Return) || 0.5) / 100,
      activeYears,
      valuation,
      // 6-Year Carryforward Pool: Initial Year (yearIndex 0) + 6 Carryforward Years (yearIndex 1..6) = 7 tax years
      deductionCarryforwardRemaining: valuation.charitableDeduction,
      // Live 4-Tier Balances (IRC § 664(b))
      tiers: {
        tier1Ordinary: 0,
        tier2CapGains: embeddedGain,
        tier3TaxExempt: 0,
        tier4Corpus: costBasis
      }
    };
  }

  /**
   * Generates a standalone year-by-year 4-Tier WIFO distribution schedule over the full
   * actuarial duration of the trust (Term of Years, Single-Life, or Two-Life Last Survivor)
   * so the Annual Distribution Breakdown chart on the Trust Optimization tab always renders
   * accurately across all duration modes.
   */
  function projectStandaloneTrustSchedule(state) {
    const durationYears = calculateExpectedTrustDurationYears(state);
    const trustObj = createTrustAccount(state, durationYears, { forcePreview: true });
    if (!trustObj) return [];

    const baseYear = Number(state.baseYear) || 2026;
    const durationType = state.trustDurationType || 'term';
    const ageXStart = Math.max(1, Math.min(109, Math.round(Number(state.trustMeasuringAge1) || state.currentAge || 55)));
    const ageYStart = Math.max(1, Math.min(109, Math.round(Number(state.trustMeasuringAge2) || 55)));

    const rows = [];
    for (let y = 0; y < durationYears; y++) {
      const calYr = baseYear + y;
      const step = stepTrustYear(trustObj, y);
      let label = `${calYr} (Yr ${y + 1})`;
      if (durationType === 'single_life') {
        label = `${calYr} (Age ${ageXStart + y})`;
      } else if (durationType === 'two_life') {
        label = `${calYr} (${ageXStart + y}/${ageYStart + y})`;
      }
      rows.push({
        yearIndex: y,
        calendarYear: calYr,
        label,
        age: ageXStart + y,
        age2: ageYStart + y,
        trustNav: step.endingNav,
        trustGrossPayout: step.grossDistribution,
        trustTier1Ordinary: step.tier1Distributed,
        trustTier2CapGains: step.tier2Distributed,
        trustTier3TaxExempt: step.tier3Distributed,
        trustTier4Corpus: step.tier4Distributed
      });
    }
    return rows;
  }

  /**
   * Steps the CRUT/Flip CRUT/CRAT forward by one year in the simulation loop:
   * 1. Accrues internal returns into Tier 1 (ordinary), Tier 2 (capital gains), and Tier 3 (tax-exempt).
   * 2. Computes required annual payout (CRUT: r * currentNAV; Flip CRUT: $0 prior to flipDelayYears, then r * currentNAV; CRAT: fixed r * initialAssetValue).
   * 3. Executes strict Worst-In, First-Out (WIFO) distribution ordering:
   *    Tier 1 (Ordinary) -> Tier 2 (Capital Gains) -> Tier 3 (Tax-Exempt) -> Tier 4 (Corpus).
   * 4. Deducts distributed amounts from internal tier balances.
   */
  function stepTrustYear(trustObj, yearIndex) {
    if (!trustObj || !trustObj.enabled || yearIndex >= trustObj.activeYears) {
      return {
        isActive: false,
        beginningNav: 0,
        internalGrowth: 0,
        grossDistribution: 0,
        tier1Distributed: 0,
        tier2Distributed: 0,
        tier3Distributed: 0,
        tier4Distributed: 0,
        endingNav: 0,
        charitableRemainderTransferred: 0,
        tiersAfter: { tier1Ordinary: 0, tier2CapGains: 0, tier3TaxExempt: 0, tier4Corpus: 0 }
      };
    }

    const t = trustObj.tiers;
    const beginningNav = t.tier1Ordinary + t.tier2CapGains + t.tier3TaxExempt + t.tier4Corpus;
    if (beginningNav <= 0) {
      return {
        isActive: false,
        beginningNav: 0,
        internalGrowth: 0,
        grossDistribution: 0,
        tier1Distributed: 0,
        tier2Distributed: 0,
        tier3Distributed: 0,
        tier4Distributed: 0,
        endingNav: 0,
        charitableRemainderTransferred: 0,
        tiersAfter: Object.assign({}, t)
      };
    }

    // 1. Accrue internal trust returns into respective IRC § 664(b) tiers
    const tier1Growth = beginningNav * trustObj.tier1RateDecimal;
    const tier2Growth = beginningNav * trustObj.tier2RateDecimal;
    const tier3Growth = beginningNav * trustObj.tier3RateDecimal;
    const internalGrowth = tier1Growth + tier2Growth + tier3Growth;

    t.tier1Ordinary += tier1Growth;
    t.tier2CapGains += tier2Growth;
    t.tier3TaxExempt += tier3Growth;

    const prePayoutNav = t.tier1Ordinary + t.tier2CapGains + t.tier3TaxExempt + t.tier4Corpus;

    // 2. Compute required annual distribution (Flip CRUT defers distributions until yearIndex >= flipDelayYears)
    const isPreFlipDeferral =
      trustObj.trustType === 'FLIP_CRUT' && yearIndex < (Number(trustObj.flipDelayYears) || 0);

    let targetPayout = 0;
    if (isPreFlipDeferral) {
      targetPayout = 0;
    } else if (trustObj.trustType === 'CRAT') {
      targetPayout = Math.min(prePayoutNav, trustObj.initialAssetValue * trustObj.payoutRateDecimal);
    } else {
      targetPayout = prePayoutNav * trustObj.payoutRateDecimal;
    }

    let remainingNeed = targetPayout;

    // 3. Strict WIFO (Worst-In, First-Out) Tier Depletion
    // Tier 1: Ordinary Income first
    const tier1Distributed = Math.min(remainingNeed, t.tier1Ordinary);
    t.tier1Ordinary -= tier1Distributed;
    remainingNeed -= tier1Distributed;

    // Tier 2: Capital Gains second (subject to Federal LTCG + NIIT + 7% WA Cap Gains above threshold)
    const tier2Distributed = Math.min(remainingNeed, t.tier2CapGains);
    t.tier2CapGains -= tier2Distributed;
    remainingNeed -= tier2Distributed;

    // Tier 3: Tax-Exempt Income third
    const tier3Distributed = Math.min(remainingNeed, t.tier3TaxExempt);
    t.tier3TaxExempt -= tier3Distributed;
    remainingNeed -= tier3Distributed;

    // Tier 4: Tax-Free Return of Principal/Corpus last
    const tier4Distributed = Math.min(remainingNeed, t.tier4Corpus);
    t.tier4Corpus -= tier4Distributed;
    remainingNeed -= tier4Distributed;

    const grossDistribution = tier1Distributed + tier2Distributed + tier3Distributed + tier4Distributed;
    let endingNav = t.tier1Ordinary + t.tier2CapGains + t.tier3TaxExempt + t.tier4Corpus;
    let charitableRemainderTransferred = 0;

    // If this is the final year of a fixed-term trust, transfer the remaining NAV to charity
    if (yearIndex === trustObj.activeYears - 1 && trustObj.activeYears < 100) {
      charitableRemainderTransferred = endingNav;
    }

    return {
      isActive: true,
      beginningNav,
      internalGrowth,
      grossDistribution,
      tier1Distributed,
      tier2Distributed,
      tier3Distributed,
      tier4Distributed,
      endingNav,
      charitableRemainderTransferred,
      tiersAfter: {
        tier1Ordinary: t.tier1Ordinary,
        tier2CapGains: t.tier2CapGains,
        tier3TaxExempt: t.tier3TaxExempt,
        tier4Corpus: t.tier4Corpus
      }
    };
  }

  global.TrustEngine = {
    TABLE_2010CM,
    IRS_7520_RATES_FALLBACK,
    getLx,
    getCumulativeDeathProb,
    calculateTableFFactor,
    calculateAdjustedPayoutRate,
    calculateTermCRUTRemainderFactor,
    calculateSingleLifeCRUTRemainderFactor,
    calculateTwoLifeCRUTRemainderFactor,
    calculateExpectedTrustDurationYears,
    calculateActuarialValuation,
    createTrustAccount,
    stepTrustYear,
    projectStandaloneTrustSchedule
  };
})(window);
