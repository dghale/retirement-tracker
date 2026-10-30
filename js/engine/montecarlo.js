// ==========================================================================
// HNW Retirement & Trust Optimization Web Application — Monte Carlo Engine
// Runs N stochastic return trajectories to compute Probability of Success
// and Net Worth percentile bands (P10, P25, P50, P75, P90)
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

  function getPercentile(sortedArray, p) {
    if (!sortedArray || sortedArray.length === 0) return 0;
    const idx = (sortedArray.length - 1) * p;
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return sortedArray[lower];
    const weight = idx - lower;
    return sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
  }

  function runMonteCarlo(state) {
    const runs = Math.max(100, Math.min(1000, Number(state.monteCarloRuns) || 500));
    const startAge = Math.max(25, Math.min(90, Number(state.currentAge) || 56));
    const endAge = Math.max(startAge + 2, Math.min(110, Number(state.lifeExpectancy) || 92));
    const totalYears = endAge - startAge + 1;

    const meanReturn = (Number(state.expectedReturn) || 7.2) / 100;
    const stdDev = Math.max(0.01, (Number(state.returnVolatility) || 12.5) / 100);

    const rand = createSeededRandom(20261026);
    const allYearValues = Array.from({ length: totalYears }, () => []);
    let successCount = 0;

    for (let r = 0; r < runs; r++) {
      const customReturns = new Array(totalYears);
      for (let y = 0; y < totalYears; y++) {
        const z = sampleNormal(rand);
        // Clamp extreme single-year tails to [-48%, +58%]
        const sampled = Math.max(-0.48, Math.min(0.58, meanReturn + z * stdDev));
        customReturns[y] = sampled;
      }

      const traj = global.SimulatorEngine.runTrajectory(state, { customReturns });
      const survived = !traj.summary.depleted && traj.summary.terminalWealth > 0;
      if (survived) {
        successCount++;
      }

      for (let y = 0; y < totalYears; y++) {
        const yrObj = traj.years[y];
        allYearValues[y].push(yrObj ? yrObj.totalWealthPool : 0);
      }
    }

    const percentilesByYear = [];
    for (let y = 0; y < totalYears; y++) {
      const sorted = allYearValues[y].slice().sort((a, b) => a - b);
      percentilesByYear.push({
        age: startAge + y,
        calendarYear: (Number(state.baseYear) || 2026) + y,
        p10: getPercentile(sorted, 0.10),
        p25: getPercentile(sorted, 0.25),
        p50: getPercentile(sorted, 0.50),
        p75: getPercentile(sorted, 0.75),
        p90: getPercentile(sorted, 0.90)
      });
    }

    const lastYearBand = percentilesByYear[percentilesByYear.length - 1] || {
      p10: 0,
      p25: 0,
      p50: 0,
      p75: 0,
      p90: 0
    };

    return {
      runs,
      successCount,
      probabilityOfSuccess: (successCount / runs) * 100,
      percentilesByYear,
      medianTerminalWealth: lastYearBand.p50,
      p10TerminalWealth: lastYearBand.p10,
      p90TerminalWealth: lastYearBand.p90
    };
  }

  global.MonteCarloEngine = {
    runMonteCarlo
  };
})(window);
