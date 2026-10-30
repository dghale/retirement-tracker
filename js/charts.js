// ==========================================================================
// HNW Retirement & Trust Optimization Web Application — Chart.js Manager
// Responsive charts with hover tooltips and gridlines enabled
// ==========================================================================

(function (global) {
  'use strict';

  const chartInstances = {};

  function formatCompactCurrency(val) {
    const abs = Math.abs(val);
    const sign = val < 0 ? '-' : '';
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}k`;
    return `${sign}$${abs.toFixed(0)}`;
  }

  function formatFullCurrency(val) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(val || 0);
  }

  const COMMON_GRID_STYLE = {
    color: 'rgba(148, 163, 184, 0.14)',
    drawBorder: false
  };

  const COMMON_TICK_STYLE = {
    color: '#94a3b8',
    font: {
      family: 'Inter, system-ui, sans-serif',
      size: 11
    }
  };

  function destroyIfExists(key) {
    if (chartInstances[key]) {
      chartInstances[key].destroy();
      delete chartInstances[key];
    }
  }

  /**
   * Chart 1: Wealth Trajectory & Composition (Stacked Area Chart)
   * Shows Taxable, Pre-Tax, Roth, CRUT/CRAT asset pool, and final ILIT payout.
   */
  function renderWealthTrajectoryChart(canvasId, simResult) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof global.Chart === 'undefined') return;
    destroyIfExists(canvasId);

    const labels = simResult.years.map((y) => `Age ${y.age} (${y.calendarYear})`);
    const taxableData = simResult.years.map((y) => Math.round(y.taxableBalance));
    const preTaxData = simResult.years.map((y) => Math.round(y.preTaxBalance));
    const rothData = simResult.years.map((y) => Math.round(y.rothBalance));
    const defCompData = simResult.years.map((y) => Math.round(y.deferredCompBalance || 0));
    const trustData = simResult.years.map((y) => Math.round(y.trustNav));
    const ilitData = simResult.years.map((y) => Math.round(y.ilitDeathBenefit));

    chartInstances[canvasId] = new global.Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Taxable Brokerage',
            data: taxableData,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.28)',
            borderWidth: 2,
            fill: true,
            tension: 0.25,
            pointRadius: 2,
            stack: 'wealth'
          },
          {
            label: 'Pre-Tax (IRA / 401k)',
            data: preTaxData,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.26)',
            borderWidth: 2,
            fill: true,
            tension: 0.25,
            pointRadius: 2,
            stack: 'wealth'
          },
          {
            label: 'Roth Tax-Free',
            data: rothData,
            borderColor: '#8b5cf6',
            backgroundColor: 'rgba(139, 92, 246, 0.28)',
            borderWidth: 2,
            fill: true,
            tension: 0.25,
            pointRadius: 2,
            stack: 'wealth'
          },
          {
            label: 'Deferred Comp (NQDC)',
            data: defCompData,
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.28)',
            borderWidth: 2,
            fill: true,
            tension: 0.25,
            pointRadius: 2,
            stack: 'wealth'
          },
          {
            label: 'CRUT / CRAT Trust Pool',
            data: trustData,
            borderColor: '#06b6d4',
            backgroundColor: 'rgba(6, 182, 212, 0.28)',
            borderWidth: 2,
            fill: true,
            tension: 0.25,
            pointRadius: 2,
            stack: 'wealth'
          },
          {
            label: 'ILIT Tax-Free Death Benefit',
            data: ilitData,
            borderColor: '#ec4899',
            backgroundColor: 'rgba(236, 72, 153, 0.35)',
            borderWidth: 2,
            fill: true,
            tension: 0.1,
            pointRadius: 3,
            stack: 'wealth'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: '#cbd5e1',
              usePointStyle: true,
              padding: 14,
              font: { size: 11 }
            }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleColor: '#f8fafc',
            bodyColor: '#e2e8f0',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: function (ctx) {
                return ` ${ctx.dataset.label}: ${formatFullCurrency(ctx.parsed.y)}`;
              },
              footer: function (items) {
                const sum = items.reduce((s, item) => s + (item.parsed.y || 0), 0);
                return `Total Ecosystem Wealth: ${formatFullCurrency(sum)}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: COMMON_GRID_STYLE,
            ticks: Object.assign({}, COMMON_TICK_STYLE, { maxTicksLimit: 10 })
          },
          y: {
            stacked: true,
            grid: COMMON_GRID_STYLE,
            ticks: Object.assign({}, COMMON_TICK_STYLE, {
              callback: function (val) {
                return formatCompactCurrency(val);
              }
            })
          }
        }
      }
    });
  }

  /**
   * Chart 2: RMD Mitigation Comparison (Grouped Bar Chart)
   * Compares projected annual RMD sizes WITH vs. WITHOUT the early draw / Roth conversion meltdown strategy.
   */
  function renderRmdComparisonChart(canvasId, simResult) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof global.Chart === 'undefined') return;
    destroyIfExists(canvasId);

    // Filter to ages >= 70 (or show full timeline if user prefers, focusing on RMD window ages 73-92+)
    const rmdRows = simResult.rmdComparison.filter((r) => r.age >= 72);
    const displayRows = rmdRows.length > 0 ? rmdRows : simResult.rmdComparison;

    const labels = displayRows.map((r) => `Age ${r.age}`);
    const withoutStrategy = displayRows.map((r) => Math.round(r.rmdWithoutStrategy));
    const withStrategy = displayRows.map((r) => Math.round(r.rmdWithStrategy));

    chartInstances[canvasId] = new global.Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Baseline RMD (Without Meltdown Strategy)',
            data: withoutStrategy,
            backgroundColor: 'rgba(239, 68, 68, 0.72)',
            borderColor: '#ef4444',
            borderWidth: 1,
            borderRadius: 4
          },
          {
            label: 'Mitigated RMD (With Early Draws & Roth Conversions)',
            data: withStrategy,
            backgroundColor: 'rgba(16, 185, 129, 0.82)',
            borderColor: '#10b981',
            borderWidth: 1,
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: '#cbd5e1',
              usePointStyle: true,
              padding: 14,
              font: { size: 11 }
            }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleColor: '#f8fafc',
            bodyColor: '#e2e8f0',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: function (ctx) {
                return ` ${ctx.dataset.label}: ${formatFullCurrency(ctx.parsed.y)}`;
              },
              footer: function (items) {
                if (items.length >= 2) {
                  const diff = (items[0].parsed.y || 0) - (items[1].parsed.y || 0);
                  return `Annual RMD Reduction: ${formatFullCurrency(diff)}`;
                }
                return '';
              }
            }
          }
        },
        scales: {
          x: {
            grid: COMMON_GRID_STYLE,
            ticks: COMMON_TICK_STYLE
          },
          y: {
            grid: COMMON_GRID_STYLE,
            ticks: Object.assign({}, COMMON_TICK_STYLE, {
              callback: function (val) {
                return formatCompactCurrency(val);
              }
            })
          }
        }
      }
    });
  }

  /**
   * Chart 3: Annual Cash Flow & Debt Drag (Stacked Bar Chart)
   * Shows inflows vs. outflows (including indexed WA State Capital Gains Tax, Federal NIIT drag,
   * Federal Ordinary/LTCG tax, ILIT premiums, and Accelerated Mortgage Payoff payments).
   */
  function renderCashFlowChart(canvasId, simResult) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof global.Chart === 'undefined') return;
    destroyIfExists(canvasId);

    const labels = simResult.years.map((y) => `Age ${y.age}`);
    const inflowsData = simResult.years.map((y) => Math.round(y.totalInflows));
    const livingExpData = simResult.years.map((y) => -Math.round(y.livingExpenses));
    const mortgageBaseData = simResult.years.map(
      (y) => -Math.round(y.mortgageInterestPaid + y.mortgageScheduledPrincipal)
    );
    const mortgageAccelData = simResult.years.map((y) => -Math.round(y.mortgageAcceleratedPrincipal));
    const ilitPremiumData = simResult.years.map((y) => -Math.round(y.ilitPremium));
    const fedTaxData = simResult.years.map((y) => -Math.round(y.fedOrdinaryTax + y.fedLTCGTax));
    const niitTaxData = simResult.years.map((y) => -Math.round(y.niitTax));
    const waCapGainsTaxData = simResult.years.map((y) => -Math.round(y.waCapGainsTax));

    chartInstances[canvasId] = new global.Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Total Gross Inflows (Income, Trust, Draws)',
            data: inflowsData,
            backgroundColor: 'rgba(16, 185, 129, 0.78)',
            borderColor: '#10b981',
            borderWidth: 1,
            stack: 'inflows'
          },
          {
            label: 'Living Expenses (Inflation-Indexed)',
            data: livingExpData,
            backgroundColor: 'rgba(100, 116, 139, 0.78)',
            borderColor: '#64748b',
            borderWidth: 1,
            stack: 'outflows'
          },
          {
            label: 'Scheduled Mortgage P&I',
            data: mortgageBaseData,
            backgroundColor: 'rgba(59, 130, 246, 0.78)',
            borderColor: '#3b82f6',
            borderWidth: 1,
            stack: 'outflows'
          },
          {
            label: 'Accelerated Mortgage Principal Drag',
            data: mortgageAccelData,
            backgroundColor: 'rgba(14, 165, 233, 0.85)',
            borderColor: '#0ea5e9',
            borderWidth: 1,
            stack: 'outflows'
          },
          {
            label: 'ILIT Insurance Premiums',
            data: ilitPremiumData,
            backgroundColor: 'rgba(168, 85, 247, 0.80)',
            borderColor: '#a855f7',
            borderWidth: 1,
            stack: 'outflows'
          },
          {
            label: 'Federal Ordinary & LTCG Tax',
            data: fedTaxData,
            backgroundColor: 'rgba(245, 158, 11, 0.82)',
            borderColor: '#f59e0b',
            borderWidth: 1,
            stack: 'outflows'
          },
          {
            label: 'Federal 3.8% NIIT Surtax Drag',
            data: niitTaxData,
            backgroundColor: 'rgba(249, 115, 22, 0.88)',
            borderColor: '#f97316',
            borderWidth: 1,
            stack: 'outflows'
          },
          {
            label: 'Indexed WA 7.0% Capital Gains Excise Tax',
            data: waCapGainsTaxData,
            backgroundColor: 'rgba(239, 68, 68, 0.90)',
            borderColor: '#ef4444',
            borderWidth: 1,
            stack: 'outflows'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: '#cbd5e1',
              usePointStyle: true,
              padding: 12,
              font: { size: 11 }
            }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleColor: '#f8fafc',
            bodyColor: '#e2e8f0',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: function (ctx) {
                const v = ctx.parsed.y || 0;
                return ` ${ctx.dataset.label}: ${formatFullCurrency(Math.abs(v))}`;
              }
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            grid: COMMON_GRID_STYLE,
            ticks: Object.assign({}, COMMON_TICK_STYLE, { maxTicksLimit: 12 })
          },
          y: {
            stacked: true,
            grid: COMMON_GRID_STYLE,
            ticks: Object.assign({}, COMMON_TICK_STYLE, {
              callback: function (val) {
                return formatCompactCurrency(val);
              }
            })
          }
        }
      }
    });
  }

  /**
   * Chart 4 (Analytics Tab): Monte Carlo Net Worth Percentile Fan Chart
   */
  function renderMonteCarloChart(canvasId, mcResult) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof global.Chart === 'undefined') return;
    destroyIfExists(canvasId);

    const labels = mcResult.percentilesByYear.map((p) => `Age ${p.age} (${p.calendarYear})`);
    const p90 = mcResult.percentilesByYear.map((p) => Math.round(p.p90));
    const p75 = mcResult.percentilesByYear.map((p) => Math.round(p.p75));
    const p50 = mcResult.percentilesByYear.map((p) => Math.round(p.p50));
    const p25 = mcResult.percentilesByYear.map((p) => Math.round(p.p25));
    const p10 = mcResult.percentilesByYear.map((p) => Math.round(p.p10));

    chartInstances[canvasId] = new global.Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '90th Percentile (Upside)',
            data: p90,
            borderColor: 'rgba(52, 211, 153, 0.65)',
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
            borderWidth: 1.5,
            borderDash: [4, 4],
            fill: '+1',
            pointRadius: 0,
            tension: 0.25
          },
          {
            label: '75th Percentile',
            data: p75,
            borderColor: 'rgba(16, 185, 129, 0.8)',
            backgroundColor: 'rgba(16, 185, 129, 0.16)',
            borderWidth: 1.5,
            fill: '+1',
            pointRadius: 0,
            tension: 0.25
          },
          {
            label: '50th Percentile (Median Trajectory)',
            data: p50,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.22)',
            borderWidth: 3,
            fill: false,
            pointRadius: 2,
            tension: 0.25
          },
          {
            label: '25th Percentile',
            data: p25,
            borderColor: 'rgba(245, 158, 11, 0.8)',
            backgroundColor: 'rgba(16, 185, 129, 0.16)',
            borderWidth: 1.5,
            fill: '-1',
            pointRadius: 0,
            tension: 0.25
          },
          {
            label: '10th Percentile (Stress Tail)',
            data: p10,
            borderColor: 'rgba(239, 68, 68, 0.85)',
            backgroundColor: 'rgba(239, 68, 68, 0.08)',
            borderWidth: 2,
            borderDash: [4, 4],
            fill: '-1',
            pointRadius: 0,
            tension: 0.25
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: '#cbd5e1',
              usePointStyle: true,
              padding: 14,
              font: { size: 11 }
            }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleColor: '#f8fafc',
            bodyColor: '#e2e8f0',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: function (ctx) {
                return ` ${ctx.dataset.label}: ${formatFullCurrency(ctx.parsed.y)}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: COMMON_GRID_STYLE,
            ticks: Object.assign({}, COMMON_TICK_STYLE, { maxTicksLimit: 10 })
          },
          y: {
            grid: COMMON_GRID_STYLE,
            ticks: Object.assign({}, COMMON_TICK_STYLE, {
              callback: function (val) {
                return formatCompactCurrency(val);
              }
            })
          }
        }
      }
    });
  }

  /**
   * Chart 5 (Trust Tab): IRC § 664(b) 4-Tier WIFO Annual Distribution Waterfall
   */
  function renderTrustWifoChart(canvasId, simResult) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof global.Chart === 'undefined') return;
    destroyIfExists(canvasId);

    const scheduleRows = Array.isArray(simResult.trustSchedule) ? simResult.trustSchedule : [];
    const activeYears = simResult.years.filter((y) => y.trustGrossPayout > 0 || y.trustNav > 0);
    const rows =
      scheduleRows.length > 0
        ? scheduleRows
        : activeYears.length > 0
        ? activeYears
        : simResult.years.slice(0, 20);

    const labels = rows.map((y) => y.label || `Yr ${y.yearIndex + 1} (Age ${y.age})`);
    const t1 = rows.map((y) => Math.round(y.trustTier1Ordinary));
    const t2 = rows.map((y) => Math.round(y.trustTier2CapGains));
    const t3 = rows.map((y) => Math.round(y.trustTier3TaxExempt));
    const t4 = rows.map((y) => Math.round(y.trustTier4Corpus));

    chartInstances[canvasId] = new global.Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Tier 1: Ordinary Income (Exhausted 1st)',
            data: t1,
            backgroundColor: 'rgba(239, 68, 68, 0.82)',
            borderColor: '#ef4444',
            borderWidth: 1,
            stack: 'wifo'
          },
          {
            label: 'Tier 2: Capital Gains (Exhausted 2nd — Fed LTCG + WA 7% + NIIT)',
            data: t2,
            backgroundColor: 'rgba(245, 158, 11, 0.85)',
            borderColor: '#f59e0b',
            borderWidth: 1,
            stack: 'wifo'
          },
          {
            label: 'Tier 3: Tax-Exempt Income (Exhausted 3rd)',
            data: t3,
            backgroundColor: 'rgba(59, 130, 246, 0.82)',
            borderColor: '#3b82f6',
            borderWidth: 1,
            stack: 'wifo'
          },
          {
            label: 'Tier 4: Tax-Free Corpus / Principal (Exhausted Last)',
            data: t4,
            backgroundColor: 'rgba(16, 185, 129, 0.85)',
            borderColor: '#10b981',
            borderWidth: 1,
            stack: 'wifo'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: '#cbd5e1',
              usePointStyle: true,
              padding: 12,
              font: { size: 11 }
            }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleColor: '#f8fafc',
            bodyColor: '#e2e8f0',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: function (ctx) {
                return ` ${ctx.dataset.label}: ${formatFullCurrency(ctx.parsed.y)}`;
              },
              footer: function (items) {
                const sum = items.reduce((s, i) => s + (i.parsed.y || 0), 0);
                return `Total Annual Trust Payout: ${formatFullCurrency(sum)}`;
              }
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            grid: COMMON_GRID_STYLE,
            ticks: Object.assign({}, COMMON_TICK_STYLE, { maxTicksLimit: 12 })
          },
          y: {
            stacked: true,
            grid: COMMON_GRID_STYLE,
            ticks: Object.assign({}, COMMON_TICK_STYLE, {
              callback: function (val) {
                return formatCompactCurrency(val);
              }
            })
          }
        }
      }
    });
  }

  /**
   * Chart 6 (Gottlieb Tab): Probability of CRUT Outperformance Over Time
   * Compares Track A against Hold-and-Draw (Track B) and Immediate Sale (Track C)
   * with Shaded Mortality Window (Settlor Life Expectancy ± 5 years).
   */
  function renderGottliebOutperformanceChart(canvasId, gottliebResult) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof global.Chart === 'undefined') return;
    destroyIfExists(canvasId);

    const horizon = (gottliebResult && gottliebResult.horizonYears) || 40;
    const labels = Array.from({ length: horizon }, (_, i) => `Yr ${i + 1}`);
    const probHold = (gottliebResult && gottliebResult.probOutperformHoldByYear) || [];
    const probReinvest = (gottliebResult && gottliebResult.probOutperformReinvestByYear) || [];
    const mort = gottliebResult && gottliebResult.mortality;

    const winStart = mort ? mort.windowStartYear : 20;
    const winEnd = mort ? mort.windowEndYear : 30;

    // Background bar series to create shaded vertical mortality window
    const mortalityBandData = Array.from({ length: horizon }, (_, i) => {
      const yr = i + 1;
      return yr >= winStart && yr <= winEnd ? 100 : 0;
    });

    chartInstances[canvasId] = new global.Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'vs. Track B: Hold-and-Draw (Deferred Tax Liquidation)',
            data: probHold,
            borderColor: '#f59e0b',
            backgroundColor: 'transparent',
            borderWidth: 2.5,
            tension: 0.25,
            pointRadius: 2,
            pointHoverRadius: 4,
            yAxisID: 'y'
          },
          {
            label: 'vs. Track C: Immediate Sale & Reinvest (Taxed Day 1)',
            data: probReinvest,
            borderColor: '#10b981',
            backgroundColor: 'transparent',
            borderWidth: 2.5,
            tension: 0.25,
            pointRadius: 2,
            pointHoverRadius: 4,
            yAxisID: 'y'
          },
          {
            type: 'bar',
            label: `Settlor Life Expectancy Window (${mort ? mort.expectedDeathAge : 84} ± 5 Yrs)`,
            data: mortalityBandData,
            backgroundColor: 'rgba(59, 130, 246, 0.12)',
            borderColor: 'rgba(59, 130, 246, 0.30)',
            borderWidth: { top: 1, left: 1, right: 1, bottom: 0 },
            barPercentage: 1.0,
            categoryPercentage: 1.0,
            yAxisID: 'y'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: '#cbd5e1',
              usePointStyle: true,
              padding: 12,
              font: { size: 11 }
            }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleColor: '#f8fafc',
            bodyColor: '#e2e8f0',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: function (ctx) {
                if (ctx.dataset.type === 'bar') {
                  const yr = ctx.dataIndex + 1;
                  return yr >= winStart && yr <= winEnd
                    ? ` Actuarial Mortality Window (Yr ${winStart}–${winEnd})`
                    : null;
                }
                return ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}% Win Rate`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: COMMON_GRID_STYLE,
            ticks: Object.assign({}, COMMON_TICK_STYLE, { maxTicksLimit: 12 })
          },
          y: {
            min: 0,
            max: 100,
            grid: COMMON_GRID_STYLE,
            ticks: Object.assign({}, COMMON_TICK_STYLE, {
              callback: function (val) {
                return `${val}%`;
              }
            })
          }
        }
      }
    });
  }

  /**
   * Chart 7 (Gottlieb Tab): Median Wealth Trajectory Comparison (A vs B vs C)
   */
  function renderGottliebTrajectoriesChart(canvasId, gottliebResult) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof global.Chart === 'undefined') return;
    destroyIfExists(canvasId);

    const horizon = (gottliebResult && gottliebResult.horizonYears) || 40;
    const labels = Array.from({ length: horizon }, (_, i) => `Yr ${i + 1}`);
    const medA = (gottliebResult && gottliebResult.medianWealthAByYear) || [];
    const medB = (gottliebResult && gottliebResult.medianWealthBByYear) || [];
    const medC = (gottliebResult && gottliebResult.medianWealthCByYear) || [];

    chartInstances[canvasId] = new global.Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Track A: CRUT (Accumulated Net Cash + Tax Savings)',
            data: medA.map(Math.round),
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            borderWidth: 2.5,
            fill: false,
            tension: 0.25,
            pointRadius: 1.5
          },
          {
            label: 'Track B: Hold-and-Draw (Taxable Buy-and-Hold)',
            data: medB.map(Math.round),
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.15)',
            borderWidth: 2.5,
            fill: false,
            tension: 0.25,
            pointRadius: 1.5
          },
          {
            label: 'Track C: Immediate Sale & Reinvest (Taxed Day 1)',
            data: medC.map(Math.round),
            borderColor: '#64748b',
            backgroundColor: 'rgba(100, 116, 139, 0.15)',
            borderWidth: 2,
            borderDash: [4, 4],
            fill: false,
            tension: 0.25,
            pointRadius: 1.5
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: '#cbd5e1',
              usePointStyle: true,
              padding: 12,
              font: { size: 11 }
            }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleColor: '#f8fafc',
            bodyColor: '#e2e8f0',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: function (ctx) {
                return ` ${ctx.dataset.label}: ${formatFullCurrency(ctx.parsed.y)}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: COMMON_GRID_STYLE,
            ticks: Object.assign({}, COMMON_TICK_STYLE, { maxTicksLimit: 12 })
          },
          y: {
            grid: COMMON_GRID_STYLE,
            ticks: Object.assign({}, COMMON_TICK_STYLE, {
              callback: function (val) {
                return formatCompactCurrency(val);
              }
            })
          }
        }
      }
    });
  }

  global.ChartsManager = {
    renderWealthTrajectoryChart,
    renderRmdComparisonChart,
    renderCashFlowChart,
    renderMonteCarloChart,
    renderTrustWifoChart,
    renderGottliebOutperformanceChart,
    renderGottliebTrajectoriesChart
  };
})(window);
