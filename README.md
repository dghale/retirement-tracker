# EmeraldWealth HNW Retirement Tracker & Optimization Platform

[![GitHub Pages](https://img.shields.io/badge/Live%20App-GitHub%20Pages-emerald?style=for-the-badge&logo=github)](https://dghale.github.io/retirement-tracker/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

An institutional-grade, client-side retirement planning and wealth preservation platform tailored for High-Net-Worth (HNW) investors. Designed to evaluate charitable trust suitability, dynamic debt payoff schedules, and multi-beneficiary claiming strategies under modern state and federal tax frameworks.

🌐 **Live Web Application**: [https://dghale.github.io/retirement-tracker/](https://dghale.github.io/retirement-tracker/)

---

## Key Capabilities & Analytical Engines

### 1. Gottlieb CRUT Suitability Analyzer (Klaus Gottlieb 2026 Framework)
Based on Klaus Gottlieb's 2026 paper, *"When Does a Charitable Remainder Unitrust Outperform? A Monte Carlo, Multi-Benchmark Suitability Framework."*
- **Paired-Path Simulation**: Evaluates 1,000 randomized Monte Carlo market return trajectories comparing **Track A (CRUT Path)** against **Track B (Hold-and-Draw)** and **Track C (Immediate Sale & Reinvest)**.
- **IRC § 7520 & 10% Remainder Compliance**: Real-time validation of the 10% remainder rule and 30% AGI charitable deduction utility.
- **Actuarial Mortality Window**: Plots outperformance probability curves over a 40-year horizon alongside median life expectancy boundaries ($\pm 5$ years).

### 2. Adjustable Rate Mortgage (ARM) & Lump-Sum Payoff Engine
- **Month-by-Month Compounding**: Amortizes residential mortgage debt with IRC § 163(h) $750,000 qualified principal interest deduction caps.
- **Dynamic ARM Reset**: Re-amortizes remaining principal balance over true remaining term to maturity (e.g. 30-year schedule) at adjusted interest rates.
- **Lump-Sum Payoff Scenarios**: Models pre-reset, post-reset, or baseline amortization with optional pre-tax distribution gross-up and IRC § 72(t) early withdrawal penalty modeling.

### 3. Social Security Statement (SSA-7005) Ingestion & Claiming Optimizer
- **100% Client-Side PDF Parsing**: Directly extracts official Form SSA-7005 statements via `PDF.js` coordinate extraction.
- **Ages 62–70 Benefit Matrix**: Maps complete monthly payout ladders, disability benefits, survivor protections, and lifetime FICA taxes paid.
- **Dual-Beneficiary Strategy**: Models independent or coordinated claiming ages for both spouses in Married Filing Jointly (MFJ) plans with spousal top-up rules.
- **Longevity & Survivor Hedge**: Calculates the break-even claiming horizon (e.g., Age 62 vs. 70 break-even at Age 80.4) and survivor benefit maximization.

### 4. Advanced State & Federal Tax Planning
- **Washington State Tiered Capital Gains Tax**: Models WA State capital gains tax (7.0% $\le \$1\text{M}$ and 9.9% $> \$1\text{M}$ above CPI-indexed thresholds).
- **Net Investment Income Tax (NIIT)**: Automatically applies the 3.8% ACA surtax above statutory MAGI thresholds ($200k Single / $250k MFJ).
- **Four-Tier Trust Accounting**: Implements IRC § 664(b) ordering (Tier 1 Ordinary $\to$ Tier 2 Capital Gains $\to$ Tier 3 Tax-Exempt $\to$ Tier 4 Corpus).

### 5. Multi-Statement Aggregation & Parsing
- Parses Fidelity Consolidated Investment Reports (PDF/CSV), Vanguard Savings Plans (PDF), and Microsoft Deferred Compensation Plans (NQDC).
- Automatically categorizes holdings into **Taxable**, **Pre-Tax (IRA/401k)**, **Roth**, and **Deferred Comp** buckets.

---

## Local Development & Verification

### Run Locally
```powershell
# Start local development server on port 8080
node scripts/serve.js
```
Open [http://localhost:8080](http://localhost:8080) in any web browser.

### Run Automated Test Suite
```powershell
node scripts/verify.js
```

### Compile Single-File Bundle
```powershell
pwsh -ExecutionPolicy Bypass -File scripts/bundle.ps1
```
The compiled single-file distribution will be placed in `dist/retirement-planner.html`.
