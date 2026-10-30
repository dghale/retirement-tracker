// ==========================================================================
// HNW Retirement & Trust Optimization Web Application — UI Controller
// Binds DOM inputs, tabs, summary cards, statement uploader, actuarial panel,
// and interactive year-by-year ledger
// ==========================================================================

(function (global) {
  'use strict';

  const fmtCurrency = (val) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(isFinite(val) ? val : 0);

  const fmtCurrencyExact = (val) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(isFinite(val) ? val : 0);

  const fmtPct = (val, digits = 1) => `${(isFinite(val) ? val : 0).toFixed(digits)}%`;

  function formatCurrencyInputValue(val) {
    const num = Number(val);
    if (!isFinite(num)) return '0';
    const hasDecimals = Math.abs(num - Math.trunc(num)) > 1e-6;
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: hasDecimals ? 2 : 0
    }).format(num);
  }

  function formatLiveCurrencyElement(el) {
    if (!el || !el.hasAttribute('data-currency-input')) return;
    const raw = String(el.value || '');
    const cursor = typeof el.selectionStart === 'number' ? el.selectionStart : raw.length;

    // Count how many digits or decimal points appear before the current cursor
    let significantBeforeCursor = 0;
    for (let i = 0; i < cursor; i++) {
      if (/[0-9.]/.test(raw[i])) {
        significantBeforeCursor++;
      }
    }

    // Keep only digits and at most one decimal point
    const cleaned = raw.replace(/[^0-9.]/g, '');
    if (cleaned === '') {
      el.value = '';
      return;
    }

    const parts = cleaned.split('.');
    let intPart = parts[0].replace(/^0+(?=\d)/, '');
    if (intPart === '' && parts.length > 1) {
      intPart = '0';
    }
    const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const formatted =
      parts.length > 1 ? `${formattedInt}.${parts.slice(1).join('').slice(0, 2)}` : formattedInt;

    if (el.value !== formatted) {
      el.value = formatted;
      // Restore cursor right after the same count of significant characters
      let newCursor = 0;
      let seen = 0;
      while (newCursor < formatted.length && seen < significantBeforeCursor) {
        if (/[0-9.]/.test(formatted[newCursor])) {
          seen++;
        }
        newCursor++;
      }
      try {
        el.setSelectionRange(newCursor, newCursor);
      } catch (e) {
        // Ignore if element does not support setSelectionRange
      }
    }
  }

  let lastParsedStatement = null;
  let lastSimulationResult = null;
  let lastMonteCarloResult = null;
  let lastGottliebResult = null;

  // Bind state keys to input elements with [data-state-key]
  function syncInputsFromState(state) {
    const inputs = document.querySelectorAll('[data-state-key]');
    inputs.forEach((el) => {
      const key = el.getAttribute('data-state-key');
      if (!(key in state)) return;
      const val = state[key];

      if (el.type === 'checkbox') {
        el.checked = Boolean(val);
      } else if (document.activeElement !== el) {
        el.value = el.hasAttribute('data-currency-input') ? formatCurrencyInputValue(val) : val;
      }
    });

    // Update range display labels
    const payoutDisplay = document.getElementById('trustPayoutRateDisplay');
    if (payoutDisplay) {
      payoutDisplay.textContent = `${Number(state.trustPayoutRate).toFixed(2)}%`;
    }

    // Show/hide life measuring age inputs based on trustDurationType
    const termGroup = document.getElementById('trustTermYearsGroup');
    const age1Group = document.getElementById('trustMeasuringAge1Group');
    const age2Group = document.getElementById('trustMeasuringAge2Group');
    if (termGroup && age1Group && age2Group) {
      const mode = state.trustDurationType || 'term';
      termGroup.classList.toggle('hidden', mode !== 'term');
      age1Group.classList.toggle('hidden', mode === 'term');
      age2Group.classList.toggle('hidden', mode !== 'two_life');
    }

    // Show/hide Flip CRUT payment start year input & update summary badge
    const flipGroup = document.getElementById('flipCrutConfigGroup');
    const flipBadge = document.getElementById('flipCrutSummaryBadge');
    if (flipGroup) {
      const isFlip = state.trustType === 'FLIP_CRUT';
      flipGroup.classList.toggle('hidden', !isFlip);
      if (isFlip && flipBadge) {
        const baseYr = Number(state.baseYear) || 2026;
        const flipYr = Math.max(baseYr, Math.round(Number(state.trustFlipStartYear) || baseYr + 5));
        const delayYrs = Math.max(0, flipYr - baseYr);
        const startAge = (Number(state.currentAge) || 55) + delayYrs;
        flipBadge.textContent =
          delayYrs > 0
            ? `${delayYrs}-Yr Deferral (${baseYr}–${flipYr - 1}) · Payments Begin ${flipYr} (Age ${startAge})`
            : `Immediate Payments in ${baseYr} (Age ${startAge})`;
      }
    }

    // Show/hide ILIT inputs
    const ilitDetails = document.getElementById('ilitInputsContainer');
    if (ilitDetails) {
      ilitDetails.classList.toggle('opacity-50', !state.ilitEnabled);
    }

    // Mortgage ARM Scenario Mode & Payoff Controls
    const activeScenario = state.mortgageScenarioMode || 'arm_reset';
    const btnAtReset = document.getElementById('btnScenarioArmReset');
    const btnPostReset = document.getElementById('btnScenarioPostReset');
    const btnKeep = document.getElementById('btnScenarioKeepLoan');

    const setActiveScenarioBtn = (btn, isActive) => {
      if (!btn) return;
      if (isActive) {
        btn.className =
          'scenario-btn p-2.5 rounded-lg border border-emerald-500/50 bg-emerald-950/40 text-emerald-300 text-left transition flex flex-col justify-between shadow-sm shadow-emerald-900/30';
      } else {
        btn.className =
          'scenario-btn p-2.5 rounded-lg border border-slate-700 bg-slate-900 text-slate-300 text-left transition flex flex-col justify-between hover:bg-slate-800/80';
      }
    };
    setActiveScenarioBtn(btnAtReset, activeScenario === 'arm_reset');
    setActiveScenarioBtn(btnPostReset, activeScenario === 'post_reset');
    setActiveScenarioBtn(btnKeep, activeScenario === 'keep_loan');

    const postResetBlock = document.getElementById('mortgagePostResetTimingBlock');
    if (postResetBlock) {
      postResetBlock.classList.toggle('hidden', activeScenario !== 'post_reset');
    }

    // Determine effective funding bucket from mortgageAccountId or mortgageLumpSumSource
    let effectiveBucket = state.mortgageLumpSumSource || 'pre_tax';
    if (state.mortgageAccountId) {
      if (['pre_tax', 'taxable', 'roth'].includes(state.mortgageAccountId)) {
        effectiveBucket = state.mortgageAccountId;
      } else {
        const found = (state.importedAccounts || []).find(
          (a) => a.accountName === state.mortgageAccountId || a.statementId === state.mortgageAccountId
        );
        if (found) {
          effectiveBucket = found.bucket === 'Pre-Tax' ? 'pre_tax' : found.bucket === 'Roth' ? 'roth' : 'taxable';
        }
      }
    }

    const grossUpContainer = document.getElementById('mortgageGrossUpContainer');
    if (grossUpContainer) {
      grossUpContainer.classList.toggle('hidden', effectiveBucket !== 'pre_tax');
    }

    // Toggle Mortgage Pre-Tax Age Notice if pre_tax selected and target age < 59.5
    const preTaxWarning = document.getElementById('mortgagePreTaxAgeWarning');
    if (preTaxWarning) {
      const baseYr = Number(state.baseYear) || 2026;
      let targetYr = Number(state.mortgageResetYear) || 2028;
      if (activeScenario === 'post_reset') {
        targetYr = Number(state.mortgageTargetPayoffYear) || targetYr + 2;
      }
      const targetAge = (Number(state.currentAge) || 55) + Math.max(0, targetYr - baseYr);
      const isPreTax = effectiveBucket === 'pre_tax';
      const isLump = activeScenario !== 'keep_loan';
      preTaxWarning.classList.toggle('hidden', !(isPreTax && isLump && targetAge < 59.5));
    }

    populateMortgageAccounts(state);

    // Sync § 7520 3-Month Election dropdown with current section7520Rate
    const preset7520 = document.getElementById('selectSection7520Preset');
    if (preset7520 && document.activeElement !== preset7520) {
      const targetRate = Number(state.section7520Rate) || 5.0;
      let matchedVal = 'custom';
      for (const opt of Array.from(preset7520.options)) {
        if (opt.value !== 'custom' && Math.abs(parseFloat(opt.value) - targetRate) < 0.05) {
          matchedVal = opt.value;
          break;
        }
      }
      preset7520.value = matchedVal;
    }
  }

  function populateIrs7520Dropdown(allRates, sourceLabel = 'IRS.gov Rev. Rul.', autoSelectHighest = false) {
    const presetSelect = document.getElementById('selectSection7520Preset');
    const sourceBadge = document.getElementById('irs7520SourceBadge');
    if (!presetSelect || !Array.isArray(allRates) || allRates.length === 0) return;

    if (sourceBadge) {
      sourceBadge.textContent = sourceLabel;
    }

    const monthNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December'
    ];
    const now = new Date();
    const targetMonths = [];
    for (let offset = 0; offset < 3; offset++) {
      const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      targetMonths.push(`${monthNames[d.getMonth()]} ${d.getFullYear()}`.toLowerCase());
    }

    // Select the Current Month and Prior Two Months (IRC § 7520(a) 3-month window)
    let threeMonthWindow = targetMonths
      .map((tm) => allRates.find((r) => String(r.month || '').toLowerCase() === tm))
      .filter(Boolean);

    // Fallback if system date is ahead of the latest published IRS ruling: take the 3 most recent published months
    if (threeMonthWindow.length < 3) {
      const sortedDesc = allRates
        .slice()
        .sort((a, b) => new Date('1 ' + b.month).getTime() - new Date('1 ' + a.month).getTime());
      threeMonthWindow = sortedDesc.slice(0, 3);
    }

    const maxRate = Math.max(...threeMonthWindow.map((r) => Number(r.rate) || 0));
    if (autoSelectHighest && maxRate > 0) {
      global.AppState.update({ section7520Rate: maxRate });
    }
    const currentStateRate = Number(global.AppState.get().section7520Rate) || maxRate || 5.0;

    presetSelect.innerHTML = '';
    threeMonthWindow.forEach((item, idx) => {
      const opt = document.createElement('option');
      const rateNum = Number(item.rate) || 5.0;
      // Encode month index if two months share the exact same rate so each option is selectable
      opt.value = `${rateNum.toFixed(1)}#${idx}`;
      const isHighest = Math.abs(rateNum - maxRate) < 0.001;
      const periodTag = idx === 0 ? 'Current Month' : idx === 1 ? '1 Month Prior' : '2 Months Prior';
      opt.textContent = `${item.month} (${periodTag}) — ${rateNum.toFixed(1)}% (${item.revRuling})${
        isHighest ? ' [Highest — Recommended]' : ''
      }`;
      presetSelect.appendChild(opt);
    });

    const customOpt = document.createElement('option');
    customOpt.value = 'custom';
    customOpt.textContent = 'Custom Override Rate (Enter Below)...';
    presetSelect.appendChild(customOpt);

    // Match current state rate to option
    let matched = 'custom';
    for (const opt of Array.from(presetSelect.options)) {
      if (opt.value !== 'custom' && Math.abs(parseFloat(opt.value) - currentStateRate) < 0.05) {
        matched = opt.value;
        break;
      }
    }
    presetSelect.value = matched;
  }

  async function initIrs7520RateLookup() {
    const fallback = (global.TrustEngine && global.TrustEngine.IRS_7520_RATES_FALLBACK) || [];
    populateIrs7520Dropdown(fallback, 'IRS Rev. Rul. Table', true);

    const presetSelect = document.getElementById('selectSection7520Preset');
    if (presetSelect) {
      presetSelect.addEventListener('change', () => {
        const val = presetSelect.value;
        if (val === 'custom') {
          const overrideInput = document.getElementById('inputSection7520Rate');
          if (overrideInput) overrideInput.focus();
          return;
        }
        const numericRate = parseFloat(val);
        if (!isNaN(numericRate)) {
          global.AppState.update({ section7520Rate: numericRate });
        }
      });
    }

    // Attempt live lookup from /api/irs-7520-rates (which fetches directly from IRS.gov)
    if (typeof global.fetch === 'function') {
      try {
        const resp = await global.fetch('/api/irs-7520-rates');
        if (resp.ok) {
          const data = await resp.json();
          if (data && Array.isArray(data.rates) && data.rates.length >= 3) {
            populateIrs7520Dropdown(data.rates, data.source || 'IRS.gov (Live)', true);
          }
        }
      } catch (e) {
        // Offline or standalone file:// mode — fallback table is already populated
      }
    }
  }

  const FIELD_TOOLTIP_MAP = {
    currentAge: 'Enter your current age (nearest birthday, 25–90).',
    retirementAge: 'Enter the target age at which you plan to stop earning employment income and begin retirement.',
    lifeExpectancy: 'Enter the planning horizon age (up to 110) through which your retirement cash flows are projected.',
    filingStatus: 'Select your federal tax filing status (Married Filing Jointly or Single) to configure tax brackets and NIIT thresholds.',
    taxableBalance: 'Enter your total Taxable Brokerage balance ($). Automatically populated when you import statements.',
    taxableCostBasisRatio: 'Enter the percentage (0–100%) of your Taxable Brokerage balance that represents your original tax cost basis.',
    preTaxBalance: 'Enter your total Pre-Tax retirement balance (Traditional IRA, Rollover IRA, 401(k), $). Automatically populated on import.',
    rothBalance: 'Enter your total Tax-Free Roth balance (Roth IRA, Roth 401(k), $). Automatically populated on import.',
    deferredCompBalance: 'Enter your total Nonqualified Deferred Compensation (NQDC) balance ($). Automatically populated from employer plan statements.',
    expectedReturn: 'Enter the expected nominal annual portfolio return (%) across your investment accounts.',
    returnVolatility: 'Enter the annual return standard deviation (volatility σ, %) used in the Monte Carlo stress test.',
    inflationRate: 'Enter the expected annual CPI inflation rate (%) used to index living expenses, tax brackets, and the WA capital gains threshold.',
    annualLivingExpenses: 'Enter your target annual after-tax living expenses in today’s dollars ($/yr). Automatically indexed for inflation each year.',
    preRetirementIncome: 'Enter your annual pre-retirement employment or business income ($/yr) earned prior to your retirement age.',
    socialSecurityAnnual: 'Enter your estimated annual Social Security benefit in today’s dollars ($/yr).',
    socialSecurityStartAge: 'Enter the age (62–70) at which Social Security benefits begin.',
    taxableDividendYield: 'Enter the annual dividend yield (%) generated by your Taxable Brokerage portfolio.',
    taxableTurnoverRate: 'Enter the annual portfolio turnover rate (%) in your Taxable Brokerage account that triggers realized capital gains.',
    rothConversionAnnual: 'Enter the annual dollar amount ($) to convert from Pre-Tax IRA/401(k) to Roth IRA during your conversion window.',
    rothConversionStartAge: 'Enter the age at which annual Roth conversions begin.',
    rothConversionEndAge: 'Enter the age at which annual Roth conversions end (typically age 74, prior to Age 75 RMDs).',
    earlyPreTaxDrawAnnual: 'Enter the annual penalty-free distribution ($) drawn from Pre-Tax accounts between ages 59.5 and 74 to smooth tax brackets.',
    earlyPreTaxStartAge: 'Enter the starting age (59.5 / 60+) for early Pre-Tax distributions.',
    earlyPreTaxEndAge: 'Enter the ending age for early Pre-Tax distributions.',
    charitableAgiLimit: 'Select the applicable IRS Adjusted Gross Income (AGI) limit (30% for appreciated capital gain property, or 20% / 50%) for charitable deduction utilization.',
    waCapGainsEnabled: 'Check to apply the Washington State Capital Gains Excise Tax (7.0% up to $1M, 9.9% above $1M) on long-term capital gains above the annual standard deduction.',
    waCapGainsBaseThreshold: 'Enter the base WA State Capital Gains standard deduction ($278,000 for 2025, indexed for inflation in 2026+).',
    waCapGainsIndexFrom2025: 'Check to compound the WA State Capital Gains standard deduction annually with your CPI inflation rate starting from 2025.',
    niitEnabled: 'Check to apply the 3.8% Federal Net Investment Income Tax (NIIT) above $200,000 (Single) or $250,000 (MFJ) MAGI.',
    mortgageEnabled: 'Check to include an existing residential mortgage and accelerated payoff strategy in your cash-flow plan.',
    mortgageBalance: 'Enter your exact remaining mortgage principal balance ($), including exact dollars and cents.',
    mortgageRate: 'Enter your current annual mortgage interest rate (%).',
    mortgageRemainingTermYears: 'Enter the remaining years on your current mortgage amortization schedule.',
    mortgageRemainingTermMonths: 'Enter additional remaining months (0-11) on your mortgage amortization schedule.',
    mortgageOriginationMonth: 'Select the calendar month in which the mortgage was originated (e.g. October).',
    mortgageOriginationYear: 'Enter the calendar year in which the mortgage was originated (e.g. 2021).',
    mortgageOriginalTermYears: 'Enter the original loan amortization term in years (e.g. 30 years).',
    mortgageMaturityMonth: 'Select the calendar month in which the loan reaches full maturity (e.g. November).',
    mortgageMaturityYear: 'Enter the calendar year in which the loan reaches full maturity (e.g. 2051).',
    mortgageMonthlyPayment: 'Enter your exact current monthly Principal & Interest payment ($), or click Auto-Calculate.',
    mortgageResetMonth: 'Select the calendar month in which your Adjustable Rate Mortgage (ARM) interest rate adjusts.',
    mortgageResetYear: 'Enter the calendar year in which your Adjustable Rate Mortgage (ARM) interest rate adjusts.',
    mortgageAdjustmentWindowYears: 'Enter the number of years until an Adjustable Rate Mortgage (ARM) resets (enter 0 for a fixed-rate mortgage).',
    mortgagePostAdjustmentRate: 'Enter the projected annual interest rate (%) after the ARM adjustment window.',
    mortgageTargetPayoffYear: 'Enter the target calendar year by which the mortgage is paid off (via lump sum or accelerated payments).',
    mortgagePayoffMonth: 'Select the calendar month in which you plan to execute the lump-sum mortgage payoff.',
    mortgagePayoffStrategy: 'Choose how mortgage payoff is modeled: Lump-Sum payoff at target year, level accelerated payments, or standard amortization.',
    mortgageLumpSumSource: 'Select the funding account (Taxable, Pre-Tax IRA/401k, or Roth) used to pay off the mortgage lump sum.',
    mortgageAccountId: 'Select the specific funding account (from imported statements or general asset buckets) to pay off the mortgage principal.',
    mortgageGrossUpTax: 'Check to withdraw enough pre-tax funds to cover income taxes and penalties, leaving the net mortgage payoff balance intact.',
    gottliebAssetValue: 'Enter the Fair Market Value ($) of the appreciated asset analyzed in the Gottlieb CRUT Suitability framework.',
    gottliebCostBasis: 'Enter your cost basis ($) in the asset to measure unrealized capital gain exposure.',
    gottliebAge: 'Enter the settlor age to determine actuarial life expectancy and the 10% remainder rule test.',
    gottliebGender: 'Select gender to adjust actuarial life expectancy tables according to IRS mortality statistics.',
    gottliebPayoutRate: 'Enter the CRUT annual payout rate (%) [statutory minimum is 5.0%].',
    gottlieb7520Rate: 'Enter the IRS Section 7520 interest rate (%) used to calculate the actuarial charitable remainder.',
    gottliebOutsideIncome: 'Enter Year 1 outside ordinary income ($) to determine the utility of the 30% AGI charitable deduction limit.',
    gottliebExpectedReturn: 'Enter the expected annual compound return (%) for the market simulation.',
    gottliebVolatility: 'Enter the annual return standard deviation / volatility σ (%) for the 1,000-run Monte Carlo simulation.',
    gottliebCapGainsRate: 'Enter the combined federal and state/local capital gains tax rate (%) applied to realized investment gains.',
    gottliebOrdinaryRate: 'Enter the ordinary income tax rate (%) applied to Tier 1 CRUT payouts and outside income deduction savings.',
    monteCarloRuns: 'Select the number of randomized Monte Carlo market return trajectories (250, 500, or 1,000 runs) to simulate.'
  };

  function populateMortgageAccounts(state) {
    const select = document.getElementById('selectMortgageAccount');
    if (!select) return;

    const currentVal = state.mortgageAccountId || state.mortgageLumpSumSource || 'pre_tax';

    let html = `
      <option value="pre_tax">Pre-Tax Retirement Bucket (401(k) / Traditional IRA)</option>
      <option value="taxable">Taxable Brokerage Bucket</option>
      <option value="roth">Roth IRA Bucket (Tax-Free)</option>
    `;

    const accounts = Array.isArray(state.importedAccounts) ? state.importedAccounts : [];
    if (accounts.length > 0) {
      const groups = new Map();
      accounts.forEach((pos) => {
        const key = pos.accountName || pos.custodian || 'Imported Account';
        if (!groups.has(key)) {
          groups.set(key, { name: key, bucket: pos.bucket || 'Taxable', value: 0 });
        }
        groups.get(key).value += Number(pos.value) || 0;
      });

      html += `<optgroup label="Specific Accounts from Imported Statements">`;
      groups.forEach((grp, key) => {
        html += `<option value="${key}">${grp.name} (${grp.bucket}) — ${fmtCurrency(grp.value)}</option>`;
      });
      html += `</optgroup>`;
    }

    select.innerHTML = html;
    select.value = currentVal;
    if (select.value !== currentVal && select.options.length > 0) {
      select.value = select.options[0].value;
    }
  }

  function ensureAllFieldTooltips() {
    const inputs = document.querySelectorAll('[data-state-key]');
    inputs.forEach((el) => {
      const key = el.getAttribute('data-state-key');
      const tipText = FIELD_TOOLTIP_MAP[key];
      if (!tipText) return;
      const id = el.getAttribute('id');
      let label = id ? document.querySelector(`label[for="${id}"]`) : el.closest('label');
      if (!label) return;
      if (label.querySelector('.field-tooltip')) return;
      const badge = document.createElement('span');
      badge.className = 'field-tooltip';
      badge.setAttribute('tabindex', '0');
      badge.setAttribute('data-tooltip', tipText);
      badge.textContent = '?';
      label.appendChild(badge);
    });
  }

  function bindStateInputs() {
    const inputs = document.querySelectorAll('[data-state-key]');
    inputs.forEach((el) => {
      const isCurrencyInput = el.hasAttribute('data-currency-input');

      const handleInputChange = () => {
        const key = el.getAttribute('data-state-key');
        let newVal;
        if (el.type === 'checkbox') {
          newVal = el.checked;
        } else if (isCurrencyInput) {
          formatLiveCurrencyElement(el);
          const cleaned = String(el.value || '').replace(/,/g, '');
          newVal = parseFloat(cleaned);
          if (isNaN(newVal)) newVal = 0;
        } else if (el.type === 'number' || el.type === 'range') {
          newVal = parseFloat(el.value);
          if (isNaN(newVal)) newVal = 0;
        } else {
          newVal = el.value;
        }
        const patch = { [key]: newVal };
        // Auto-activate trustEnabled when user enters a positive Concentrated Asset FMV
        if (key === 'trustAssetValue' && newVal > 0 && !global.AppState.get().trustEnabled) {
          patch.trustEnabled = true;
        }
        // Auto-activate mortgageEnabled when user enters a positive Remaining Principal Balance
        if (key === 'mortgageBalance' && newVal > 0 && !global.AppState.get().mortgageEnabled) {
          patch.mortgageEnabled = true;
        }
        global.AppState.update(patch);
      };

      if (el.tagName === 'SELECT') {
        el.addEventListener('change', handleInputChange);
        el.addEventListener('input', handleInputChange);
      } else {
        el.addEventListener('change', handleInputChange);
        el.addEventListener('input', handleInputChange);
        if (isCurrencyInput) {
          el.addEventListener('blur', () => {
            const key = el.getAttribute('data-state-key');
            const currentState = global.AppState.get();
            if (key in currentState) {
              el.value = formatCurrencyInputValue(currentState[key]);
            }
          });
        }
      }

      // Also live-update range display while dragging
      if (el.type === 'range') {
        el.addEventListener('input', () => {
          const payoutDisplay = document.getElementById('trustPayoutRateDisplay');
          if (payoutDisplay && el.getAttribute('data-state-key') === 'trustPayoutRate') {
            payoutDisplay.textContent = `${parseFloat(el.value).toFixed(2)}%`;
          }
        });
      }
    });

    // Mortgage Scenario Buttons and Auto-Calculate
    const btnAutoCalcMortgage = document.getElementById('btnAutoCalcMortgagePayment');
    if (btnAutoCalcMortgage) {
      btnAutoCalcMortgage.addEventListener('click', () => {
        const s = global.AppState.get();
        const bal = Number(s.mortgageBalance) || 0;
        const rate = (Number(s.mortgageRate) || 4.5) / 100;
        const baseYr = Number(s.baseYear) || 2026;
        let totalM = 0;
        if (s.mortgageMaturityYear) {
          totalM = Math.max(
            1,
            (Number(s.mortgageMaturityYear) - baseYr) * 12 + (Number(s.mortgageMaturityMonth) || 11)
          );
        } else {
          const termY = Number(s.mortgageRemainingTermYears) || 20;
          const termM = Number(s.mortgageRemainingTermMonths) || 0;
          totalM = Math.max(1, termY * 12 + termM);
        }
        const pmt = global.MortgageEngine.computeMonthlyPayment(bal, rate, totalM);
        global.AppState.update({
          mortgageMonthlyPayment: Math.round(pmt * 100) / 100
        });
      });
    }

    const btnScenarioArmReset = document.getElementById('btnScenarioArmReset');
    if (btnScenarioArmReset) {
      btnScenarioArmReset.addEventListener('click', () => {
        global.AppState.update({
          mortgageScenarioMode: 'arm_reset',
          mortgagePayoffStrategy: 'lump_sum'
        });
      });
    }

    const btnScenarioPostReset = document.getElementById('btnScenarioPostReset');
    if (btnScenarioPostReset) {
      btnScenarioPostReset.addEventListener('click', () => {
        global.AppState.update({
          mortgageScenarioMode: 'post_reset',
          mortgagePayoffStrategy: 'lump_sum'
        });
      });
    }

    const btnScenarioKeepLoan = document.getElementById('btnScenarioKeepLoan');
    if (btnScenarioKeepLoan) {
      btnScenarioKeepLoan.addEventListener('click', () => {
        global.AppState.update({
          mortgageScenarioMode: 'keep_loan',
          mortgagePayoffStrategy: 'standard'
        });
      });
    }

    const selectMortgageAcct = document.getElementById('selectMortgageAccount');
    if (selectMortgageAcct) {
      selectMortgageAcct.addEventListener('change', () => {
        const val = selectMortgageAcct.value;
        const s = global.AppState.get();
        let bucket = val;
        if (!['pre_tax', 'taxable', 'roth'].includes(val)) {
          const acct = (s.importedAccounts || []).find((a) => a.accountName === val || a.statementId === val);
          if (acct) {
            bucket = acct.bucket === 'Pre-Tax' ? 'pre_tax' : acct.bucket === 'Roth' ? 'roth' : 'taxable';
          }
        }
        global.AppState.update({
          mortgageAccountId: val,
          mortgageLumpSumSource: bucket
        });
      });
    }

    // Quick preset buttons for WA State Capital Gains Tax Threshold
    const btnWa278 = document.getElementById('btnWaPreset278k');
    if (btnWa278) {
      btnWa278.addEventListener('click', () => {
        global.AppState.update({
          waCapGainsBaseThreshold: 278000,
          waCapGainsIndexFrom2025: true
        });
      });
    }

    const btnWa250 = document.getElementById('btnWaPreset250k');
    if (btnWa250) {
      btnWa250.addEventListener('click', () => {
        global.AppState.update({
          waCapGainsBaseThreshold: 250000,
          waCapGainsIndexFrom2025: false
        });
      });
    }

    // Reset button
    const btnReset = document.getElementById('btnResetDefaults');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        global.AppState.reset();
      });
    }

    // Export Scenario JSON button
    const btnExportJson = document.getElementById('btnExportScenarioJson');
    if (btnExportJson) {
      btnExportJson.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(global.AppState.get(), null, 2)], {
          type: 'application/json'
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `hnw-retirement-scenario-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }
  }

  function setupTabs() {
    const tabButtons = document.querySelectorAll('[data-tab-target]');
    const tabPanels = document.querySelectorAll('[data-tab-panel]');

    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-tab-target');

        tabButtons.forEach((b) => {
          const isActive = b.getAttribute('data-tab-target') === target;
          b.setAttribute('aria-selected', isActive ? 'true' : 'false');
          if (isActive) {
            b.className =
              'px-4 py-2.5 text-sm font-semibold rounded-lg transition-all bg-emerald-600 text-white shadow-md shadow-emerald-900/40 flex items-center gap-2 whitespace-nowrap';
          } else {
            b.className =
              'px-4 py-2.5 text-sm font-medium rounded-lg transition-all text-slate-300 hover:text-white hover:bg-slate-800/80 flex items-center gap-2 whitespace-nowrap';
          }
        });

        tabPanels.forEach((panel) => {
          const isMatch = panel.getAttribute('data-tab-panel') === target;
          panel.classList.toggle('hidden', !isMatch);
        });

        // Re-render charts on active tab so Chart.js sizes accurately
        if (lastSimulationResult && lastMonteCarloResult) {
          renderChartsForActiveTab(target, lastSimulationResult, lastMonteCarloResult);
        }
      });
    });
  }

  function getActiveTabName() {
    const activeBtn = document.querySelector('[data-tab-target][aria-selected="true"]');
    return activeBtn ? activeBtn.getAttribute('data-tab-target') : 'dashboard';
  }

  function renderChartsForActiveTab(tabName, simResult, mcResult) {
    if (tabName === 'dashboard') {
      global.ChartsManager.renderWealthTrajectoryChart('chartWealthTrajectory', simResult);
      global.ChartsManager.renderRmdComparisonChart('chartRmdComparison', simResult);
      global.ChartsManager.renderCashFlowChart('chartCashFlow', simResult);
    } else if (tabName === 'trust') {
      global.ChartsManager.renderTrustWifoChart('chartTrustWifo', simResult);
    } else if (tabName === 'analytics') {
      global.ChartsManager.renderMonteCarloChart('chartMonteCarloFan', mcResult);
    } else if (tabName === 'gottlieb' && lastGottliebResult) {
      global.ChartsManager.renderGottliebOutperformanceChart('chartGottliebOutperformance', lastGottliebResult);
      global.ChartsManager.renderGottliebTrajectoriesChart('chartGottliebTrajectories', lastGottliebResult);
    }
  }

  /**
   * Updates the 5 required top-level Summary Cards + contextual badges.
   */
  function updateSummaryCards(state, simResult, mcResult) {
    const setEl = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    // 1. Probability of Success
    const prob = mcResult.probabilityOfSuccess;
    setEl('summaryProbSuccess', fmtPct(prob, 1));
    setEl(
      'summaryProbSuccessSub',
      `${mcResult.successCount} of ${mcResult.runs} Monte Carlo runs (${fmtPct(state.returnVolatility, 1)} σ)`
    );
    const probCard = document.getElementById('summaryProbSuccess');
    if (probCard) {
      probCard.className =
        prob >= 85
          ? 'text-2xl lg:text-3xl font-bold text-emerald-400 tabular-nums tracking-tight'
          : prob >= 70
          ? 'text-2xl lg:text-3xl font-bold text-amber-400 tabular-nums tracking-tight'
          : 'text-2xl lg:text-3xl font-bold text-rose-400 tabular-nums tracking-tight';
    }

    // 2. Tax Savings from Trusts
    setEl('summaryTrustTaxSavings', fmtCurrency(simResult.summary.totalTaxSavingsFromTrusts));
    setEl(
      'summaryTrustTaxSavingsSub',
      state.trustEnabled
        ? `${fmtCurrency(simResult.summary.year1AvoidedCapGainsTax)} Yr-1 sale avoided + ${fmtCurrency(simResult.summary.cumulativeCharitableTaxSavings)} deduction`
        : 'Enable CRUT/CRAT to model tax savings'
    );

    // 3. Peak Net Worth
    setEl('summaryPeakNetWorth', fmtCurrency(simResult.summary.peakNetWorth));
    setEl(
      'summaryPeakNetWorthSub',
      `Achieved at Age ${simResult.summary.peakNetWorthAge} (Terminal: ${fmtCurrency(simResult.summary.terminalWealth)})`
    );

    // 4. Total WA State Capital Gains Tax Paid
    setEl('summaryTotalWaTax', fmtCurrency(simResult.summary.cumulativeWaTax));
    const y0WaThreshold =
      simResult.years.length > 0 ? simResult.years[0].waCapGainsThreshold : state.waCapGainsBaseThreshold;
    setEl(
      'summaryTotalWaTaxSub',
      state.waCapGainsEnabled
        ? `7.0% &le;$1M / 9.9% &gt;$1M (Yr 1 Exemption: ${fmtCurrency(y0WaThreshold)})`
        : 'WA State Capital Gains Tax Disabled'
    );

    // 5. Total NIIT Paid
    setEl('summaryTotalNiitPaid', fmtCurrency(simResult.summary.cumulativeNiitPaid ?? simResult.summary.cumulativeNiitTax));
    const niitThresh = state.filingStatus === 'Single' ? '$200,000 Single' : '$250,000 MFJ';
    setEl(
      'summaryTotalNiitPaidSub',
      state.niitEnabled ? `3.8% surtax above ${niitThresh} MAGI` : 'Federal NIIT Disabled'
    );
  }

  /**
   * Updates the SSRN-5924942 Actuarial Valuation & 4-Tier WIFO Diagnostics Panel on the Trust Tab.
   */
  function updateTrustDiagnostics(state, simResult) {
    const v = simResult.trustValuation;
    if (!v) return;

    const setEl = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setEl('diag7520Rate', fmtPct(v.section7520Rate * 100, 2));
    setEl('diagDiscountFactorV', v.discountFactorV.toFixed(6));
    setEl('diagTableFFactor', v.fFactor.toFixed(6));
    setEl('diagAdjustedPayoutU', fmtPct(v.u * 100, 4));
    setEl('diagSyntheticRateITilde', fmtPct(v.iTilde * 100, 4));
    setEl('diagSyntheticDecayVTilde', v.vTilde.toFixed(6));
    setEl('diagRemainderFactor', `${(v.remainderFactor * 100).toFixed(4)}% (${v.remainderFactor.toFixed(5)})`);
    setEl('diagCharitableDeduction', fmtCurrency(v.charitableDeduction));
    setEl('diagPvIncomeStream', fmtCurrency(v.pvNonCharitableIncomeStream));
    setEl('diagMaxAllowablePayout', fmtPct(v.maxAllowablePayoutRate * 100, 2));

    const badge10Pct = document.getElementById('diag10PercentBadge');
    if (badge10Pct) {
      if (v.passes10PercentTest) {
        badge10Pct.textContent = 'PASSES IRC § 664(d) 10% REMAINDER TEST';
        badge10Pct.className =
          'px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
      } else {
        badge10Pct.textContent = 'FAILS 10% REMAINDER TEST — REDUCE PAYOUT OR TERM';
        badge10Pct.className =
          'px-2.5 py-1 text-xs font-semibold rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40';
      }
    }

    // Initial 4-Tier Balances Preview
    const embeddedGain = Math.max(0, (Number(state.trustAssetValue) || 0) - (Number(state.trustCostBasis) || 0));
    const basisCorpus = Math.min(Number(state.trustAssetValue) || 0, Number(state.trustCostBasis) || 0);
    setEl('diagTier1Init', fmtCurrency(0));
    setEl('diagTier2Init', fmtCurrency(embeddedGain));
    setEl('diagTier3Init', fmtCurrency(0));
    setEl('diagTier4Init', fmtCurrency(basisCorpus));

    // 6-Year Charitable Carryforward Table
    const cfBody = document.getElementById('charitableCarryforwardTableBody');
    if (cfBody) {
      const sevenYears = simResult.years.slice(0, 7);
      cfBody.innerHTML = sevenYears
        .map(
          (yr, idx) => `
        <tr class="border-b border-slate-800/80 hover:bg-slate-800/40">
          <th scope="row" class="py-2 px-3 text-left text-xs font-medium text-slate-300">
            Year ${idx + 1} (${yr.calendarYear})${idx === 0 ? ' — Inception' : ` — Carryforward ${idx}`}
          </th>
          <td class="py-2 px-3 text-right text-xs text-slate-300 tabular-nums">${fmtCurrency(
            yr.earnedIncome + yr.trustTier1Ordinary + yr.trustTier2CapGains + yr.brokerageDividendsTotal + yr.brokerageRealizedLTCG + yr.earlyPreTaxDraw + yr.rothConversion
          )}</td>
          <td class="py-2 px-3 text-right text-xs text-emerald-400 font-semibold tabular-nums">${fmtCurrency(
            yr.charitableDeductionUsed
          )}</td>
          <td class="py-2 px-3 text-right text-xs text-amber-300 tabular-nums">${fmtCurrency(
            yr.charitableCarryforwardRemaining
          )}</td>
          <td class="py-2 px-3 text-right text-xs text-emerald-300 tabular-nums">${fmtCurrency(
            yr.charitableTaxSavedThisYear
          )}</td>
        </tr>
      `
        )
        .join('');
    }
  }

  /**
   * Updates Tax, RMD & Mortgage KPI callouts across tabs.
   */
  function updateSecondaryMetrics(state, simResult, mcResult) {
    const setEl = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    // RMD Mitigation metrics
    setEl('metricRmdWithoutStrategy', fmtCurrency(simResult.summary.totalRmdWithoutStrategy));
    setEl('metricRmdWithStrategy', fmtCurrency(simResult.summary.totalRmdWithStrategy));
    setEl('metricRmdSavedDollar', fmtCurrency(simResult.summary.rmdReductionDollar));

    // WA Cap Gains indexing preview
    if (simResult.years.length > 0) {
      const y0 = simResult.years[0];
      const y10 = simResult.years[Math.min(10, simResult.years.length - 1)];
      const y20 = simResult.years[Math.min(20, simResult.years.length - 1)];
      setEl('waThresholdYr0', `${y0.calendarYear}: ${fmtCurrency(y0.waCapGainsThreshold)}`);
      setEl('waThresholdYr10', `${y10.calendarYear}: ${fmtCurrency(y10.waCapGainsThreshold)}`);
      setEl('waThresholdYr20', `${y20.calendarYear}: ${fmtCurrency(y20.waCapGainsThreshold)}`);
    }

    // Mortgage Scenario Comparison & Diagnostics
    const ms =
      simResult.mortgageScenarios ||
      (global.MortgageEngine ? global.MortgageEngine.evaluateMortgageScenarios(state) : null);

    if (ms) {
      setEl('cardMortgagePrePayment', fmtCurrency(ms.monthlyPaymentPreReset));
      setEl('cardMortgagePostPayment', fmtCurrency(ms.monthlyPaymentPostReset));
      const shockEl = document.getElementById('cardMortgagePaymentShock');
      if (shockEl) {
        if (ms.monthlyPaymentShock > 0.01) {
          const pctShock = ((ms.monthlyPaymentShock / Math.max(1, ms.monthlyPaymentPreReset)) * 100).toFixed(1);
          shockEl.textContent = `+${fmtCurrency(ms.monthlyPaymentShock)}/mo (+${pctShock}%)`;
          shockEl.className = 'text-base font-bold text-rose-400 tabular-nums';
        } else {
          shockEl.textContent = '$0/mo (Fixed)';
          shockEl.className = 'text-base font-bold text-slate-400 tabular-nums';
        }
      }

      const activeMode = state.mortgageScenarioMode || 'arm_reset';
      const badgeEl = document.getElementById('mortgageActiveScenarioBadge');
      if (badgeEl) {
        if (activeMode === 'arm_reset') {
          badgeEl.textContent = 'Scenario 1: Pay at Reset';
          badgeEl.className =
            'px-2.5 py-1 text-[11px] font-semibold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
        } else if (activeMode === 'post_reset') {
          badgeEl.textContent = 'Scenario 2: Pay Post-Reset';
          badgeEl.className =
            'px-2.5 py-1 text-[11px] font-semibold rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30';
        } else {
          badgeEl.textContent = 'Scenario 3: Keep Loan (Full Term)';
          badgeEl.className =
            'px-2.5 py-1 text-[11px] font-semibold rounded-full bg-slate-700/50 text-slate-300 border border-slate-600';
        }
      }

      let saved = 0;
      let payoffBal = 0;
      let payoffSub = '';
      const monthsNames = [
        '',
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec'
      ];
      if (activeMode === 'arm_reset') {
        saved = ms.interestSavedAtReset;
        payoffBal = ms.atReset ? ms.atReset.payoffAmount : 0;
        payoffSub = ms.atReset ? `in ${monthsNames[ms.atReset.payoffMonth]} ${ms.atReset.payoffYear}` : '';
      } else if (activeMode === 'post_reset') {
        saved = ms.interestSavedPostReset;
        payoffBal = ms.postReset ? ms.postReset.payoffAmount : 0;
        payoffSub = ms.postReset ? `in ${monthsNames[ms.postReset.payoffMonth]} ${ms.postReset.payoffYear}` : '';
      } else {
        saved = 0;
        payoffBal = 0;
        payoffSub = 'Amortized through term';
      }

      setEl('cardMortgageInterestSaved', fmtCurrency(saved));
      setEl('cardMortgagePayoffBalance', fmtCurrency(payoffBal));
      setEl('cardMortgagePayoffDateSub', payoffSub || 'at payoff execution');

      const termBadge = document.getElementById('mortgageRemainingTermBadge');
      if (termBadge) {
        const matYear = Number(state.mortgageMaturityYear) || 2051;
        const matMonth = Number(state.mortgageMaturityMonth) || 11;
        const baseYr = Number(state.baseYear) || 2026;
        const remMonths = Math.max(0, (matYear - baseYr) * 12 + matMonth);
        const remY = Math.floor(remMonths / 12);
        const remM = remMonths % 12;
        termBadge.textContent = `Loan ends ${monthsNames[matMonth]} ${matYear} (~${remY}y ${remM}m rem)`;
      }

      const narrativeEl = document.getElementById('mortgageNarrativeText');
      if (narrativeEl) {
        if (activeMode === 'arm_reset') {
          narrativeEl.innerHTML = `Paying off the mortgage in <strong>${payoffSub}</strong> (just before the rate adjusts from ${(state.mortgageRate || 4.5).toFixed(2)}% to ${(state.mortgagePostAdjustmentRate || 6.5).toFixed(2)}%) saves <strong>${fmtCurrency(saved)}</strong> in lifetime interest payments and eliminates the <strong>+${fmtCurrency(ms.monthlyPaymentShock)}/month</strong> payment shock.`;
        } else if (activeMode === 'post_reset') {
          narrativeEl.innerHTML = `Paying off the mortgage post-reset in <strong>${payoffSub}</strong> saves <strong>${fmtCurrency(saved)}</strong> in lifetime interest vs. keeping the loan, while paying the adjusted payment of <strong>${fmtCurrency(ms.monthlyPaymentPostReset)}/mo</strong> during the interim post-reset period.`;
        } else {
          narrativeEl.innerHTML = `Continuing the loan through its full term incurs <strong>${fmtCurrency(ms.baseline.lifetimeInterest)}</strong> in lifetime interest, with payments adjusting from <strong>${fmtCurrency(ms.monthlyPaymentPreReset)}/mo</strong> to <strong>${fmtCurrency(ms.monthlyPaymentPostReset)}/mo</strong> at the ARM reset date.`;
        }
      }
    }

    if (simResult.years.length > 0) {
      const totalDeductibleInterest = simResult.years.reduce((s, y) => s + y.mortgageDeductibleInterest, 0);
      const y0Mortgage = simResult.years[0];
      setEl('mortgageFirstYearPayment', fmtCurrency(y0Mortgage.mortgageTotalPayment));
      setEl('mortgageLifetimeDeductible', fmtCurrency(totalDeductibleInterest));
    }

    // Analytics Monte Carlo summary cards
    setEl('mcP90Terminal', fmtCurrency(mcResult.p90TerminalWealth));
    setEl('mcP50Terminal', fmtCurrency(mcResult.medianTerminalWealth));
    setEl('mcP10Terminal', fmtCurrency(mcResult.p10TerminalWealth));

    // Gottlieb CRUT Analyzer diagnostics & KPI updates
    if (global.GottliebEngine) {
      lastGottliebResult = global.GottliebEngine.runGottliebSuitabilityMonteCarlo(state);
      const gr = lastGottliebResult;

      const compBadge = document.getElementById('gottliebRemainderBadge');
      const compAlert = document.getElementById('gottliebComplianceAlert');

      if (compBadge) {
        if (gr.compliance.passes10PercentRule) {
          compBadge.textContent = `PASSES 10% REMAINDER TEST (${(gr.compliance.remainderFactor * 100).toFixed(1)}%)`;
          compBadge.className =
            'px-3 py-1 text-xs font-semibold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
        } else {
          compBadge.textContent = `FAILS 10% REMAINDER TEST (${(gr.compliance.remainderFactor * 100).toFixed(1)}%)`;
          compBadge.className =
            'px-3 py-1 text-xs font-semibold rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40';
        }
      }

      if (compAlert) {
        compAlert.classList.toggle('hidden', gr.compliance.passes10PercentRule);
      }

      setEl('gottliebKpiTaxSavings', fmtCurrency(gr.compliance.upfrontTaxSavings));
      setEl(
        'gottliebKpiTaxSavingsSub',
        `30% AGI Cap ($${fmtCurrency(gr.compliance.agiLimit30Pct)} deduction utilized)`
      );

      setEl(
        'gottliebKpiMortality',
        `Age ${gr.mortality.expectedDeathAge} (Yr ${Math.round(gr.mortality.lifeExpectancyYears)})`
      );
      setEl(
        'gottliebKpiMortalitySub',
        `Mortality window: Yrs ${gr.mortality.windowStartYear}–${gr.mortality.windowEndYear}`
      );

      setEl('gottliebKpiWinRateHold', fmtPct(gr.lifetimeWinRateVsHold, 1));
      setEl('gottliebKpiWinRateReinvest', fmtPct(gr.lifetimeWinRateVsReinvest, 1));
    }

    // Render comprehensive Year-by-Year Ledger Table
    const ledgerBody = document.getElementById('ledgerTableBody');
    if (ledgerBody) {
      ledgerBody.innerHTML = simResult.years
        .map(
          (yr) => `
        <tr class="border-b border-slate-800/70 hover:bg-slate-800/50 transition-colors">
          <th scope="row" class="py-2.5 px-3 text-left text-xs font-semibold text-emerald-300 whitespace-nowrap tabular-nums">
            ${yr.calendarYear} (Age ${yr.age})
          </th>
          <td data-label="Taxable" class="py-2.5 px-3 text-right text-xs text-slate-200 tabular-nums">${fmtCurrency(
            yr.taxableBalance
          )}</td>
          <td data-label="Pre-Tax" class="py-2.5 px-3 text-right text-xs text-blue-300 tabular-nums">${fmtCurrency(
            yr.preTaxBalance
          )}</td>
          <td data-label="Roth" class="py-2.5 px-3 text-right text-xs text-purple-300 tabular-nums">${fmtCurrency(
            yr.rothBalance
          )}</td>
          <td data-label="Def Comp" class="py-2.5 px-3 text-right text-xs text-amber-300 tabular-nums" title="Deferred Comp Distribution: ${fmtCurrency(
            yr.deferredCompDistribution
          )}">${fmtCurrency(yr.deferredCompBalance)}</td>
          <td data-label="Trust NAV" class="py-2.5 px-3 text-right text-xs text-amber-300 tabular-nums">${fmtCurrency(
            yr.trustNav
          )}</td>
          <td data-label="Trust Payout (T1/T2)" class="py-2.5 px-3 text-right text-xs text-slate-300 tabular-nums" title="Tier 1 Ord: ${fmtCurrency(
            yr.trustTier1Ordinary
          )} | Tier 2 CapGain: ${fmtCurrency(yr.trustTier2CapGains)}">${fmtCurrency(yr.trustGrossPayout)}</td>
          <td data-label="Meltdown / RMD" class="py-2.5 px-3 text-right text-xs text-sky-300 tabular-nums" title="Early Draw: ${fmtCurrency(
            yr.earlyPreTaxDraw
          )} | Roth Conv: ${fmtCurrency(yr.rothConversion)} | RMD: ${fmtCurrency(yr.rmdAmount)}">${fmtCurrency(
            yr.earlyPreTaxDraw + yr.rothConversion + yr.rmdAmount
          )}</td>
          <td data-label="Fed Ord+LTCG Tax" class="py-2.5 px-3 text-right text-xs text-amber-400 tabular-nums">${fmtCurrency(
            yr.fedOrdinaryTax + yr.fedLTCGTax
          )}</td>
          <td data-label="NIIT (3.8%)" class="py-2.5 px-3 text-right text-xs text-orange-400 tabular-nums">${fmtCurrency(
            yr.niitTax
          )}</td>
          <td data-label="WA Threshold" class="py-2.5 px-3 text-right text-xs text-slate-400 tabular-nums">${fmtCurrency(
            yr.waCapGainsThreshold
          )}</td>
          <td data-label="WA CapGain Tax" class="py-2.5 px-3 text-right text-xs text-rose-400 font-medium tabular-nums">${fmtCurrency(
            yr.waCapGainsTax
          )}</td>
          <td data-label="Mortgage Pmt" class="py-2.5 px-3 text-right text-xs text-slate-300 tabular-nums">${fmtCurrency(
            yr.mortgageTotalPayment
          )}</td>
          <td data-label="Total Wealth Pool" class="py-2.5 px-3 text-right text-xs font-bold text-emerald-400 tabular-nums">${fmtCurrency(
            yr.totalWealthPool
          )}</td>
        </tr>
      `
        )
        .join('');
    }
  }

  /**
   * Renders the cumulative Imported Statements list and Combined Holdings table from state.
   */
  function renderMultiStatementView(state) {
    const previewContainer = document.getElementById('importPreviewContainer');
    const statementsBody = document.getElementById('importedStatementsListBody');
    const previewBody = document.getElementById('importPreviewTableBody');
    const countBadge = document.getElementById('importStatementCountBadge');

    const statements = Array.isArray(state.importedStatements) ? state.importedStatements : [];
    const accounts = Array.isArray(state.importedAccounts) ? state.importedAccounts : [];

    if (!previewContainer) return;
    previewContainer.classList.toggle('hidden', statements.length === 0 && accounts.length === 0);

    let totalTaxable = 0;
    let totalPreTax = 0;
    let totalRoth = 0;
    let totalDeferredComp = 0;

    accounts.forEach((pos) => {
      const val = Number(pos.value) || 0;
      if (pos.bucket === 'Pre-Tax') totalPreTax += val;
      else if (pos.bucket === 'Roth') totalRoth += val;
      else if (pos.bucket === 'Deferred Comp') totalDeferredComp += val;
      else totalTaxable += val;
    });

    const setEl = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = fmtCurrencyExact(val);
    };
    setEl('importSumTaxable', totalTaxable);
    setEl('importSumPreTax', totalPreTax);
    setEl('importSumRoth', totalRoth);
    setEl('importSumDeferredComp', totalDeferredComp);

    // Group holdings by account so we can show Total Account Value for each account
    // with the detailed holding rows underneath
    const accountGroups = [];
    const accountGroupMap = new Map();

    accounts.forEach((pos) => {
      const groupKey = `${pos.sourceFile || ''}::${pos.custodian || ''}::${pos.accountNumber || ''}::${pos.accountName || ''}`;
      let group = accountGroupMap.get(groupKey);
      if (!group) {
        group = {
          id: `acct-grp-${accountGroups.length}`,
          sourceFile: pos.sourceFile || pos.custodian || 'Statement',
          custodian: pos.custodian || 'Brokerage',
          accountName: pos.accountName || 'Account',
          accountNumber: pos.accountNumber || '—',
          bucket: pos.bucket || 'Taxable',
          totalValue: 0,
          holdings: []
        };
        accountGroupMap.set(groupKey, group);
        accountGroups.push(group);
      }
      const val = Number(pos.value) || 0;
      group.totalValue += val;
      group.holdings.push(pos);
    });

    if (countBadge) {
      countBadge.textContent = `${statements.length} Statement${statements.length === 1 ? '' : 's'} · ${accountGroups.length} Account${accountGroups.length === 1 ? '' : 's'} (${accounts.length} Holdings)`;
    }

    if (statementsBody) {
      statementsBody.innerHTML = statements
        .map((stmt) => {
          if (stmt.isSocialSecurity) {
            const ss = stmt.socialSecurity || {};
            const pMonthly = ss.pia || ss.benefitsByAge?.[67] || 0;
            return `
          <tr class="border-b border-slate-800/70 hover:bg-slate-800/40 bg-emerald-950/15">
            <th scope="row" class="py-2 px-3 text-left text-xs font-semibold text-white">${stmt.fileName}</th>
            <td class="py-2 px-3 text-left text-xs text-emerald-300">
              <span class="px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300 border border-emerald-500/40 text-[10px] font-semibold mr-1">SSA-7005</span>
              ${ss.name || 'Social Security'} (FRA ${ss.fra || 67})
            </td>
            <td class="py-2 px-3 text-right text-xs text-slate-300 tabular-nums">PIA: $${pMonthly.toLocaleString()}/mo</td>
            <td colspan="4" class="py-2 px-3 text-center text-xs text-emerald-400 font-medium tabular-nums">
              Benefit Ladder (Ages 62–70): $${(ss.benefitsByAge?.[62] || 0).toLocaleString()} to $${(ss.benefitsByAge?.[70] || 0).toLocaleString()} / mo
            </td>
            <td class="py-2 px-3 text-center">
              <button
                type="button"
                data-remove-statement-id="${stmt.id}"
                class="px-2 py-1 text-[11px] font-semibold rounded bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 transition"
              >
                Remove
              </button>
            </td>
          </tr>`;
          }

          return `
        <tr class="border-b border-slate-800/70 hover:bg-slate-800/40">
          <th scope="row" class="py-2 px-3 text-left text-xs font-semibold text-white">${stmt.fileName}</th>
          <td class="py-2 px-3 text-left text-xs text-emerald-300">${stmt.format}</td>
          <td class="py-2 px-3 text-right text-xs text-slate-300 tabular-nums">${stmt.positionsCount}</td>
          <td class="py-2 px-3 text-right text-xs text-emerald-400 font-medium tabular-nums">${fmtCurrencyExact(
            stmt.totals ? stmt.totals.Taxable : 0
          )}</td>
          <td class="py-2 px-3 text-right text-xs text-blue-400 font-medium tabular-nums">${fmtCurrencyExact(
            stmt.totals ? stmt.totals['Pre-Tax'] : 0
          )}</td>
          <td class="py-2 px-3 text-right text-xs text-purple-400 font-medium tabular-nums">${fmtCurrencyExact(
            stmt.totals ? stmt.totals.Roth : 0
          )}</td>
          <td class="py-2 px-3 text-right text-xs text-amber-400 font-medium tabular-nums">${fmtCurrencyExact(
            stmt.totals ? stmt.totals['Deferred Comp'] : 0
          )}</td>
          <td class="py-2 px-3 text-center">
            <button
              type="button"
              data-remove-statement-id="${stmt.id}"
              class="px-2 py-1 text-[11px] font-semibold rounded bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 transition"
            >
              Remove
            </button>
          </td>
        </tr>`;
        })
        .join('');

      statementsBody.querySelectorAll('[data-remove-statement-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const stmtId = btn.getAttribute('data-remove-statement-id');
          global.AppState.removeImportedStatement(stmtId);
        });
      });
    }

    if (previewBody) {
      previewBody.innerHTML = accountGroups
        .map((group) => {
          const badgeColor =
            group.bucket === 'Pre-Tax'
              ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
              : group.bucket === 'Roth'
              ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
              : group.bucket === 'Deferred Comp'
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
              : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';

          const holdingsCountLabel = `${group.holdings.length} Holding${group.holdings.length === 1 ? '' : 's'}`;

          const accountHeaderRow = `
          <tr
            data-account-group-toggle="${group.id}"
            tabindex="0"
            role="button"
            aria-expanded="true"
            class="bg-slate-800/85 hover:bg-slate-800 border-t-2 border-b border-slate-700 cursor-pointer transition select-none"
          >
            <th scope="row" class="py-2.5 px-3 text-left text-xs font-bold text-white">
              <div class="flex items-center gap-2">
                <span data-chevron-for="${group.id}" class="text-emerald-400 text-xs transition-transform inline-block">▼</span>
                <div>
                  <span class="block text-white font-bold">${group.accountName}</span>
                  <span class="block text-[11px] font-normal text-slate-400">${group.custodian} · ${group.sourceFile}</span>
                </div>
              </div>
            </th>
            <td class="py-2.5 px-3 text-left text-xs font-mono font-semibold text-emerald-300">${group.accountNumber}</td>
            <td class="py-2.5 px-3 text-left text-xs">
              <span class="px-2 py-0.5 text-[11px] font-semibold rounded bg-slate-700/90 text-slate-200 border border-slate-600">
                ${holdingsCountLabel}
              </span>
            </td>
            <td class="py-2.5 px-3 text-left text-xs font-semibold text-slate-200">
              Total Account Value
            </td>
            <td class="py-2.5 px-3 text-right text-xs font-semibold text-slate-300 tabular-nums">100.0%</td>
            <td class="py-2.5 px-3 text-right text-sm font-bold text-white tabular-nums">${fmtCurrencyExact(
              group.totalValue
            )}</td>
            <td class="py-2.5 px-3 text-center">
              <span class="px-2.5 py-0.5 text-[11px] font-semibold rounded-full border ${badgeColor}">
                ${group.bucket}
              </span>
            </td>
          </tr>`;

          const holdingDetailRows = group.holdings
            .map((pos) => {
              const val = Number(pos.value) || 0;
              const pctOfAcct = group.totalValue > 0 ? (val / group.totalValue) * 100 : 0;
              return `
              <tr data-account-group-child="${group.id}" class="bg-slate-950/50 hover:bg-slate-900/70 border-b border-slate-800/50">
                <td class="py-2 pl-8 pr-3 text-left text-xs text-slate-400">
                  <span class="text-slate-500 mr-1.5">↳</span>${pos.holdingName || pos.description}
                </td>
                <td class="py-2 px-3 text-left text-[11px] text-slate-500 font-mono">${pos.accountNumber}</td>
                <td class="py-2 px-3 text-left text-xs font-semibold text-emerald-400 font-mono">${pos.symbol}</td>
                <td class="py-2 px-3 text-left text-xs text-slate-300">${pos.description}</td>
                <td class="py-2 px-3 text-right text-xs text-slate-400 tabular-nums">${fmtPct(pctOfAcct, 1)}</td>
                <td class="py-2 px-3 text-right text-xs font-medium text-slate-200 tabular-nums">${fmtCurrencyExact(
                  val
                )}</td>
                <td class="py-2 px-3 text-center text-[11px] text-slate-400">${pos.bucket}</td>
              </tr>`;
            })
            .join('');

          return accountHeaderRow + holdingDetailRows;
        })
        .join('');

      previewBody.querySelectorAll('[data-account-group-toggle]').forEach((headerRow) => {
        const toggleGroup = () => {
          const grpId = headerRow.getAttribute('data-account-group-toggle');
          const isExpanded = headerRow.getAttribute('aria-expanded') === 'true';
          const nextState = !isExpanded;
          headerRow.setAttribute('aria-expanded', nextState ? 'true' : 'false');

          const chevron = headerRow.querySelector(`[data-chevron-for="${grpId}"]`);
          if (chevron) {
            chevron.textContent = nextState ? '▼' : '▶';
          }

          previewBody.querySelectorAll(`[data-account-group-child="${grpId}"]`).forEach((childRow) => {
            childRow.classList.toggle('hidden', !nextState);
          });
        };

        headerRow.addEventListener('click', toggleGroup);
        headerRow.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleGroup();
          }
        });
      });
    }
  }

  /**
   * Sets up the Multi-File Brokerage Statement Import drag-and-drop zone and aggregation workflow.
   */
  function setupStatementImporter() {
    const dropzone = document.getElementById('statementDropzone');
    const fileInput = document.getElementById('statementFileInput');
    const statusBox = document.getElementById('importStatusMessage');
    const btnClearAll = document.getElementById('btnClearAllStatements');

    function showStatus(msg, isError = false) {
      if (!statusBox) return;
      statusBox.classList.remove('hidden');
      statusBox.textContent = msg;
      statusBox.className = isError
        ? 'mt-3 p-3 rounded-lg text-xs font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30'
        : 'mt-3 p-3 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30';
    }

    async function handleFilesUploaded(fileList) {
      if (!fileList || fileList.length === 0) return;
      showStatus(`Parsing ${fileList.length} statement file(s)...`);

      try {
        const { results, errors } = await global.StatementParser.parseStatementFiles(fileList);

        const scenarioFiles = results.filter((r) => r.format === 'ScenarioState' && r.scenario);
        const brokerageFiles = results.filter((r) => r.format !== 'ScenarioState');

        if (scenarioFiles.length > 0) {
          global.AppState.update(scenarioFiles[scenarioFiles.length - 1].scenario);
        }

        if (brokerageFiles.length > 0) {
          global.AppState.addImportedStatements(brokerageFiles);
        }

        const currentState = global.AppState.get();
        const totalStmts = (currentState.importedStatements || []).length;

        if (errors.length > 0 && results.length === 0) {
          showStatus(errors.join(' | '), true);
        } else if (errors.length > 0) {
          showStatus(
            `Imported ${results.length} file(s) (${totalStmts} total active in plan), with ${errors.length} error(s): ${errors.join('; ')}`,
            true
          );
        } else {
          showStatus(
            `Added ${results.length} statement(s). Total active in plan: ${totalStmts} statement(s) — Combined Taxable: ${fmtCurrency(
              currentState.taxableBalance
            )}, Pre-Tax: ${fmtCurrency(currentState.preTaxBalance)}, Roth: ${fmtCurrency(currentState.rothBalance)}.`
          );
        }
      } catch (err) {
        showStatus(err.message || String(err), true);
      } finally {
        if (fileInput) fileInput.value = '';
      }
    }

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());
      dropzone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileInput.click();
        }
      });

      ['dragenter', 'dragover'].forEach((evtName) => {
        dropzone.addEventListener(evtName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.add('dropzone-active');
        });
      });

      ['dragleave', 'drop'].forEach((evtName) => {
        dropzone.addEventListener(evtName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.remove('dropzone-active');
        });
      });

      dropzone.addEventListener('drop', (e) => {
        const files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length > 0) {
          handleFilesUploaded(files);
        }
      });

      fileInput.addEventListener('change', (e) => {
        const files = e.target.files;
        if (files && files.length > 0) {
          handleFilesUploaded(files);
        }
      });
    }

    if (btnClearAll) {
      btnClearAll.addEventListener('click', () => {
        global.AppState.clearImportedStatements();
        showStatus('Cleared all imported statements and reset account balances to $0.');
      });
    }

    const ssFileInput = document.getElementById('ssStatementFileInput');
    if (ssFileInput) {
      ssFileInput.addEventListener('change', (e) => {
        const files = e.target.files;
        if (files && files.length > 0) {
          handleFilesUploaded(files);
        }
      });
    }
  }

  /**
   * Social Security SSA-7005 Interactive Module & Strategy Optimizer
   */
  function renderSocialSecurityModule(state) {
    const statusBadge = document.getElementById('ssStatusBadge');
    const primaryCard = document.getElementById('ssPrimaryCard');
    const spouseCard = document.getElementById('ssSpouseCard');
    const optimizerCard = document.getElementById('ssOptimizerCard');
    const earningsDrawer = document.getElementById('ssEarningsRecordDrawer');

    if (!primaryCard) return;

    if (!state.ssPrimaryEnabled) {
      primaryCard.classList.add('hidden');
      if (spouseCard) spouseCard.classList.add('hidden');
      if (optimizerCard) optimizerCard.classList.add('hidden');
      if (earningsDrawer) earningsDrawer.classList.add('hidden');
      if (statusBadge) {
        statusBadge.textContent = 'Manual Mode';
        statusBadge.className =
          'px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-800 text-slate-400 border border-slate-700';
      }
      return;
    }

    primaryCard.classList.remove('hidden');
    if (optimizerCard) optimizerCard.classList.remove('hidden');

    if (statusBadge) {
      statusBadge.textContent = `SSA-7005 Active (${state.ssPrimaryName || 'Primary'})`;
      statusBadge.className =
        'px-2 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
    }

    const setEl = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };

    setEl('ssPrimaryNameBadge', state.ssPrimaryName || 'Primary Beneficiary');
    setEl('ssPrimaryMetaBadge', `DOB: ${state.ssPrimaryDob || '—'} | FRA: Age ${state.ssPrimaryFra || 67}`);
    setEl('ssPrimaryMonthlyDisplay', `$${(state.ssPrimaryMonthlyBenefit || 0).toLocaleString()} / mo`);
    setEl('ssPrimaryAnnualDisplay', `$${(state.ssPrimaryAnnualBenefit || 0).toLocaleString()} / yr`);

    const pia =
      Number(state.ssPrimaryPia) ||
      (state.ssPrimaryBenefitsByAge ? state.ssPrimaryBenefitsByAge[67] : 0) ||
      1;
    const currentMonthly = Number(state.ssPrimaryMonthlyBenefit) || 0;
    const pctOfFra = ((currentMonthly / pia) * 100).toFixed(1);
    setEl('ssPrimaryPctFraBadge', `${pctOfFra}% of FRA ($${pia.toLocaleString()}/mo PIA)`);

    setEl('ssPrimaryDisabilityBadge', `Disability: $${(state.ssPrimaryDisability || 0).toLocaleString()}/mo`);
    setEl('ssPrimarySurvivorBadge', `Survivor FRA: $${(state.ssPrimarySurvivorFra || 0).toLocaleString()}/mo`);

    // Render 62-70 Button Ladder for Primary
    const primaryAgeContainer = document.getElementById('ssPrimaryAgeButtons');
    if (primaryAgeContainer && state.ssPrimaryBenefitsByAge) {
      primaryAgeContainer.innerHTML = '';
      for (let age = 62; age <= 70; age++) {
        const amt = state.ssPrimaryBenefitsByAge[age] || 0;
        const isSelected = age === Number(state.ssPrimaryClaimAge);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = isSelected
          ? 'py-1.5 px-0.5 rounded border border-emerald-400 bg-emerald-600 text-white font-bold text-center transition flex flex-col items-center justify-center shadow-md shadow-emerald-950'
          : 'py-1.5 px-0.5 rounded border border-slate-700 bg-slate-900 text-slate-300 hover:border-emerald-500/50 hover:bg-slate-800 text-center transition flex flex-col items-center justify-center';

        btn.innerHTML = `
          <span class="text-[11px] block leading-tight font-bold">${age}</span>
          <span class="text-[9px] block leading-tight opacity-80 tabular-nums">$${amt.toLocaleString()}</span>
        `;
        btn.addEventListener('click', () => {
          global.AppState.update({ ssPrimaryClaimAge: age });
        });
        primaryAgeContainer.appendChild(btn);
      }
    }

    // 2. Spouse Profile Card (if enabled)
    if (spouseCard) {
      if (state.ssSpouseEnabled) {
        spouseCard.classList.remove('hidden');
        setEl('ssSpouseNameBadge', state.ssSpouseName || 'Spouse');
        setEl('ssSpouseMetaBadge', `DOB: ${state.ssSpouseDob || '—'} | FRA: Age ${state.ssSpouseFra || 67}`);
        setEl('ssSpouseMonthlyDisplay', `$${(state.ssSpouseMonthlyBenefit || 0).toLocaleString()} / mo`);
        setEl('ssSpouseAnnualDisplay', `$${(state.ssSpouseAnnualBenefit || 0).toLocaleString()} / yr`);

        const spPia =
          Number(state.ssSpousePia) ||
          (state.ssSpouseBenefitsByAge ? state.ssSpouseBenefitsByAge[67] : 0) ||
          1;
        const spMonthly = Number(state.ssSpouseMonthlyBenefit) || 0;
        const spPct = ((spMonthly / spPia) * 100).toFixed(1);
        setEl('ssSpousePctFraBadge', `${spPct}% of FRA ($${spPia.toLocaleString()}/mo PIA)`);

        const spouseAgeContainer = document.getElementById('ssSpouseAgeButtons');
        if (spouseAgeContainer && state.ssSpouseBenefitsByAge) {
          spouseAgeContainer.innerHTML = '';
          for (let age = 62; age <= 70; age++) {
            const amt = state.ssSpouseBenefitsByAge[age] || 0;
            const isSelected = age === Number(state.ssSpouseClaimAge);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = isSelected
              ? 'py-1.5 px-0.5 rounded border border-sky-400 bg-sky-600 text-white font-bold text-center transition flex flex-col items-center justify-center shadow-md shadow-sky-950'
              : 'py-1.5 px-0.5 rounded border border-slate-700 bg-slate-900 text-slate-300 hover:border-sky-500/50 hover:bg-slate-800 text-center transition flex flex-col items-center justify-center';

            btn.innerHTML = `
              <span class="text-[11px] block leading-tight font-bold">${age}</span>
              <span class="text-[9px] block leading-tight opacity-80 tabular-nums">$${amt.toLocaleString()}</span>
            `;
            btn.addEventListener('click', () => {
              global.AppState.update({ ssSpouseClaimAge: age });
            });
            spouseAgeContainer.appendChild(btn);
          }
        }
      } else {
        spouseCard.classList.add('hidden');
      }
    }

    // 3. Strategy Optimizer & Break-Even Math
    const b = state.ssPrimaryBenefitsByAge;
    if (b) {
      const m62 = Number(b[62]) || 0;
      const m67 = Number(b[67]) || 0;
      const m70 = Number(b[70]) || 0;

      setEl('ssOptVal62', `$${m62.toLocaleString()}/mo`);
      setEl('ssOptVal67', `$${m67.toLocaleString()}/mo`);
      setEl('ssOptVal70', `$${m70.toLocaleString()}/mo`);

      const diff62 = m67 > 0 ? (((m62 - m67) / m67) * 100).toFixed(1) : 0;
      const diff70 = m67 > 0 ? (((m70 - m67) / m67) * 100).toFixed(1) : 0;
      const diff62vs70 = m62 > 0 ? (((m70 - m62) / m62) * 100).toFixed(0) : 0;
      setEl('ssOptDiff62', `${diff62}% vs FRA`);
      setEl('ssOptDiff70', `+${diff70}% (+${diff62vs70}% vs 62)`);

      const annual62 = m62 * 12;
      const annual70 = m70 * 12;
      const headStart = 8 * annual62;
      const annualAdvantage = annual70 - annual62;
      let breakEvenAge = 80.4;
      if (annualAdvantage > 0) {
        breakEvenAge = (70 + headStart / annualAdvantage).toFixed(1);
      }

      const breakEvenTextEl = document.getElementById('ssBreakEvenText');
      if (breakEvenTextEl) {
        breakEvenTextEl.innerHTML = `<strong>Break-Even Horizon:</strong> Delaying from Age 62 to 70 breaks even at age <strong>${breakEvenAge}</strong>. Living past age ${breakEvenAge} generates cumulative wealth gains of <strong>+$${annualAdvantage.toLocaleString()}/year</strong> for life, while providing maximum survivor benefit protection of <strong>$${m70.toLocaleString()}/month</strong> ($${annual70.toLocaleString()}/yr indexed to inflation) for your surviving spouse.`;
      }
    }

    // 4. Populate Earnings Record Table & Taxes
    if (state.ssPrimaryEarningsRecord && Array.isArray(state.ssPrimaryEarningsRecord)) {
      const tableBody = document.getElementById('ssEarningsTableBody');
      if (tableBody) {
        tableBody.innerHTML = state.ssPrimaryEarningsRecord
          .map(
            (r) => `
          <tr class="hover:bg-slate-800/40">
            <td class="py-1 px-2 text-slate-300 font-semibold">${r.year}</td>
            <td class="py-1 px-2 text-right text-emerald-400 tabular-nums">${
              r.ssEarnings > 0 ? '$' + r.ssEarnings.toLocaleString() : '$0'
            }</td>
            <td class="py-1 px-2 text-right text-sky-400 tabular-nums">${
              r.medEarnings > 0 ? '$' + r.medEarnings.toLocaleString() : '$0'
            }</td>
          </tr>`
          )
          .join('');
      }

      const tp = state.ssPrimaryTaxesPaid;
      if (tp) {
        setEl(
          'ssTaxesSummarySS',
          `You: $${(tp.ssWorker || 0).toLocaleString()} | Employer: $${(tp.ssEmployer || 0).toLocaleString()}`
        );
        setEl(
          'ssTaxesSummaryMed',
          `You: $${(tp.medWorker || 0).toLocaleString()} | Employer: $${(tp.medEmployer || 0).toLocaleString()}`
        );
      }
    }
  }

  function setupSocialSecurityDrawer() {
    const btnToggle = document.getElementById('btnToggleEarningsRecord');
    const btnClose = document.getElementById('btnCloseEarningsDrawer');
    const drawer = document.getElementById('ssEarningsRecordDrawer');

    if (btnToggle && drawer) {
      btnToggle.addEventListener('click', () => {
        drawer.classList.toggle('hidden');
      });
    }
    if (btnClose && drawer) {
      btnClose.addEventListener('click', () => {
        drawer.classList.add('hidden');
      });
    }
  }

  /**
   * Ledger CSV Exporter on Analytics Tab
   */
  function setupLedgerExporter() {
    const btnExportCsv = document.getElementById('btnExportLedgerCsv');
    if (!btnExportCsv) return;
    btnExportCsv.addEventListener('click', () => {
      if (!lastSimulationResult) return;
      const headers = [
        'Year',
        'Age',
        'Taxable Balance',
        'Pre-Tax Balance',
        'Roth Balance',
        'Deferred Comp Balance',
        'Deferred Comp Distribution',
        'CRUT/CRAT NAV',
        'Trust Gross Payout',
        'Trust Tier 1 (Ord)',
        'Trust Tier 2 (LTCG)',
        'Trust Tier 3 (Tax-Exempt)',
        'Trust Tier 4 (Corpus)',
        'Early Pre-Tax Draw',
        'Roth Conversion',
        'RMD Amount',
        'Fed Ordinary Tax',
        'Fed LTCG Tax',
        'Fed NIIT (3.8%)',
        'WA Indexed Threshold',
        'WA Cap Gains Tax',
        'Mortgage Payment',
        'Total Wealth Pool'
      ];
      const rows = lastSimulationResult.years.map((y) =>
        [
          y.calendarYear,
          y.age,
          Math.round(y.taxableBalance),
          Math.round(y.preTaxBalance),
          Math.round(y.rothBalance),
          Math.round(y.deferredCompBalance),
          Math.round(y.deferredCompDistribution),
          Math.round(y.trustNav),
          Math.round(y.trustGrossPayout),
          Math.round(y.trustTier1Ordinary),
          Math.round(y.trustTier2CapGains),
          Math.round(y.trustTier3TaxExempt),
          Math.round(y.trustTier4Corpus),
          Math.round(y.earlyPreTaxDraw),
          Math.round(y.rothConversion),
          Math.round(y.rmdAmount),
          Math.round(y.fedOrdinaryTax),
          Math.round(y.fedLTCGTax),
          Math.round(y.niitTax),
          Math.round(y.waCapGainsThreshold),
          Math.round(y.waCapGainsTax),
          Math.round(y.mortgageTotalPayment),
          Math.round(y.totalWealthPool)
        ].join(',')
      );

      const csv = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hnw-retirement-projection-ledger.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  /**
   * Sync aria-invalid with CSS :user-invalid state (modern-web-guidance: validate-input-after-interaction)
   */
  function setupValidationAriaSync() {
    const syncAria = (el) => {
      if (!el || typeof el.matches !== 'function') return;
      try {
        el.setAttribute('aria-invalid', el.matches(':user-invalid') ? 'true' : 'false');
      } catch (e) {
        // Ignore if selector unsupported
      }
    };
    document.addEventListener('blur', (e) => syncAria(e.target), true);
    document.addEventListener('input', (e) => {
      if (e.target && e.target.hasAttribute && e.target.hasAttribute('aria-invalid')) {
        syncAria(e.target);
      }
    });
  }

  function recomputeAndRender(state) {
    syncInputsFromState(state);
    renderMultiStatementView(state);
    renderSocialSecurityModule(state);
    lastSimulationResult = global.SimulatorEngine.runFullSimulation(state);
    lastMonteCarloResult = global.MonteCarloEngine.runMonteCarlo(state);

    updateSummaryCards(state, lastSimulationResult, lastMonteCarloResult);
    updateTrustDiagnostics(state, lastSimulationResult);
    updateSecondaryMetrics(state, lastSimulationResult, lastMonteCarloResult);
    renderChartsForActiveTab(getActiveTabName(), lastSimulationResult, lastMonteCarloResult);
  }

  function initApp() {
    ensureAllFieldTooltips();
    setupTabs();
    bindStateInputs();
    setupStatementImporter();
    setupSocialSecurityDrawer();
    setupLedgerExporter();
    setupValidationAriaSync();
    initIrs7520RateLookup();

    global.AppState.subscribe((newState) => {
      recomputeAndRender(newState);
    });

    recomputeAndRender(global.AppState.get());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})(window);
