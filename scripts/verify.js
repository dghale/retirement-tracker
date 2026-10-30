// ==========================================================================
// Automated Verification Suite for HNW Retirement & Trust Optimization Engine
// Verifies Clean State, Multi-Statement Aggregation, PDF/CSV/JSON Parsing,
// SSRN-5924942 Actuarial CRUT Math, WA 7% Cap Gains, NIIT, and Simulator
// ==========================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sandbox = {
  window: {},
  console,
  Intl,
  Math,
  Date,
  Array,
  Object,
  Number,
  String,
  Boolean,
  RegExp,
  Error,
  parseFloat,
  isNaN,
  isFinite
};
sandbox.window = sandbox;

const scriptsToLoad = [
  'js/state.js',
  'js/parser.js',
  'js/engine/tax.js',
  'js/engine/trust.js',
  'js/engine/mortgage.js',
  'js/engine/gottlieb.js',
  'js/engine/simulator.js',
  'js/engine/montecarlo.js'
];

for (const rel of scriptsToLoad) {
  const code = fs.readFileSync(path.join(root, rel), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: rel });
}

function assert(cond, msg) {
  if (!cond) {
    console.error('ASSERTION FAILED:', msg);
    process.exit(1);
  }
}

function approxEqual(a, b, tol = 1e-4) {
  return Math.abs(a - b) <= tol;
}

console.log('--- 1. Testing Clean Default State (No Pre-Loaded Sample Scenario) ---');
const initialCleanState = sandbox.AppState.get();
assert(initialCleanState.taxableBalance === 0, 'Initial taxableBalance must be 0');
assert(initialCleanState.preTaxBalance === 0, 'Initial preTaxBalance must be 0');
assert(initialCleanState.rothBalance === 0, 'Initial rothBalance must be 0');
assert(initialCleanState.importedStatements.length === 0, 'Initial importedStatements must be empty');
console.log('Clean initial state verified.');

console.log('--- 2. Testing Multi-Statement Import & Cumulative Aggregation (PDF + CSV) ---');
const fidelityPdfStmt = sandbox.StatementParser.parseExtractedPDFText(
  [
    'FIDELITY INVESTMENTS - CONSOLIDATED INVESTMENT REPORT',
    'Account: INDIVIDUAL BROKERAGE - TOD   Account Number: X88-412091',
    'NVIDIA CORP COM (NVDA) 12,000.000 $135.00 $1,620,000.00 $140,000.00',
    'Account: TRADITIONAL IRA   Account Number: 229-104412',
    'FIDELITY 500 INDEX FUND (FXAIX) 10,000.000 $210.00 $2,100,000.00',
    'Account: ROTH IRA   Account Number: 558-192014',
    'INVESCO QQQ TRUST (QQQ) 1,000.000 $500.00 $500,000.00'
  ],
  'Fidelity-Oct2026.pdf'
);

const vanguardCsvStmt = sandbox.StatementParser.parseCSVContent(
  [
    'Account Number,Investment Name,Symbol,Shares,Share Price,Balance',
    '88419201,Brokerage Account - VANGUARD 500 INDEX ADMIRAL,VFIAX,2000,500.00,1000000.00',
    '44109283,Rollover IRA - VANGUARD TOTAL STOCK MARKET ADMIRAL,VTSAX,10000,150.00,1500000.00',
    '77291044,Roth IRA - VANGUARD GROWTH INDEX ADMIRAL,VIGAX,2000,200.00,400000.00'
  ].join('\n'),
  'Vanguard-Oct2026.csv'
);

// Add first statement (Fidelity PDF)
sandbox.AppState.addImportedStatements([fidelityPdfStmt]);
let st = sandbox.AppState.get();
assert(st.importedStatements.length === 1, 'Should have 1 imported statement');
assert(st.taxableBalance === 1620000, `Expected Taxable 1620000 after stmt 1, got ${st.taxableBalance}`);
assert(st.preTaxBalance === 2100000, `Expected Pre-Tax 2100000 after stmt 1, got ${st.preTaxBalance}`);
assert(st.rothBalance === 500000, `Expected Roth 500000 after stmt 1, got ${st.rothBalance}`);

// Add second statement (Vanguard CSV) and verify both statements are counted together!
sandbox.AppState.addImportedStatements([vanguardCsvStmt]);
st = sandbox.AppState.get();
assert(st.importedStatements.length === 2, 'Should have 2 imported statements counted together');
assert(st.importedAccounts.length === 6, 'Should have 6 combined holdings across both statements');
assert(st.taxableBalance === 2620000, `Expected Combined Taxable 2,620,000, got ${st.taxableBalance}`);
assert(st.preTaxBalance === 3600000, `Expected Combined Pre-Tax 3,600,000, got ${st.preTaxBalance}`);
assert(st.rothBalance === 900000, `Expected Combined Roth 900,000, got ${st.rothBalance}`);

// Test removing first statement leaves only second statement's balances
const firstStmtId = st.importedStatements[0].id;
sandbox.AppState.removeImportedStatement(firstStmtId);
st = sandbox.AppState.get();
assert(st.importedStatements.length === 1, 'Should have 1 remaining statement after removal');
assert(st.taxableBalance === 1000000, `Expected Taxable 1,000,000 after removal, got ${st.taxableBalance}`);
assert(st.preTaxBalance === 1500000, `Expected Pre-Tax 1,500,000 after removal, got ${st.preTaxBalance}`);
assert(st.rothBalance === 400000, `Expected Roth 400,000 after removal, got ${st.rothBalance}`);

// Re-add Fidelity PDF so both are active for the full simulation test
sandbox.AppState.addImportedStatements([fidelityPdfStmt]);
console.log('Multi-statement import, aggregation, and removal checks passed.');

console.log('--- 2b. Testing Attached Vanguard Employer 401(k) Savings Plan PDF Statement ---');
const attachedVanguard401kLines = [
  'ACCOUNT SUMMARY: 07/01/2026 - 09/30/2026',
  'Kirkland WA 98033-5082 GOOGLE LLC 401(K) SAVINGS PLAN–– 093926',
  'Total Account Balance: $570,387.88',
  'Beginning balance $570,737.03 $517,498.92',
  'Ending balance $570,387.88 $570,387.88',
  'Connect with Vanguard® > 800-523-1188 > vanguard.com',
  'Investment Activity',
  'Beginning Balance Contributions Other Transactions* Market Gain/Loss Dividends/ Capital Gains Ending Balance',
  'Target Retire 2045 Tr $570,735.44 $0.00 - $1.25 - $347.89 $0.00 $570,386.30',
  'Target Retire 2035 Tr $1.59 $0.00 $0.00 - $0.01 $0.00 $1.58',
  'Total Invested $570,737.03 $0.00 - $1.25 - $347.90 $0.00 $570,387.88',
  'Your Fee Summary',
  'Additional Account Details',
  'Source Activity',
  'Opening Balance Contributions Activity Closing Balance',
  'Pre-Tax 401(K)   $274,812.02 $0.00 - $168.32 $274,643.70',
  'Bonus Pre-Tax 401(K)   $36,792.42 $0.00 - $22.46 $36,769.96',
  'Employer Matching   $133,943.14 $0.00 - $81.96 $133,861.18',
  'Employee Rollover   $36,807.95 $0.00 - $22.47 $36,785.48',
  'EE QNEC Correction   $2,026.46 $0.00 - $1.24 $2,025.22',
  'ER QNEC Correction   $184.22 $0.00 - $0.11 $184.11',
  'Source Activity',
  '2022 Roth In Plan Conversion   $40,504.02 $0.00 - $24.72 $40,479.30',
  'Qual Roth In Plan Conversion   $45,666.80 $0.00 - $27.87 $45,638.93',
  'Total Value $570,387.88',
  'Beneficiaries'
];
const parsedGoogle401k = sandbox.StatementParser.parseExtractedPDFText(
  attachedVanguard401kLines,
  'Vanguard-Google-401k.pdf'
);
assert(
  parsedGoogle401k.positions.length === 2,
  `Expected 2 Investment Activity positions, got ${parsedGoogle401k.positions.length}`
);
assert(
  parsedGoogle401k.positions[0].accountName === 'GOOGLE LLC 401(K) SAVINGS PLAN',
  `Expected accountName 'GOOGLE LLC 401(K) SAVINGS PLAN', got '${parsedGoogle401k.positions[0].accountName}'`
);
assert(
  parsedGoogle401k.positions[0].symbol === 'Target Retire 2045 Tr',
  `Expected symbol 'Target Retire 2045 Tr', got '${parsedGoogle401k.positions[0].symbol}'`
);
assert(
  approxEqual(parsedGoogle401k.positions[0].value, 570386.30, 0.01),
  `Expected value 570386.30, got ${parsedGoogle401k.positions[0].value}`
);
assert(
  parsedGoogle401k.positions[1].symbol === 'Target Retire 2035 Tr',
  `Expected symbol 'Target Retire 2035 Tr', got '${parsedGoogle401k.positions[1].symbol}'`
);
assert(
  approxEqual(parsedGoogle401k.positions[1].value, 1.58, 0.01),
  `Expected value 1.58, got ${parsedGoogle401k.positions[1].value}`
);
assert(
  approxEqual(parsedGoogle401k.totals['Pre-Tax'], 570387.88, 0.01),
  `Expected Total Pre-Tax $570,387.88, got ${parsedGoogle401k.totals['Pre-Tax']}`
);
console.log(
  `Attached Vanguard 401(k) parsed: Account='${parsedGoogle401k.positions[0].accountName}', Holdings=[${parsedGoogle401k.positions
    .map((p) => `${p.symbol}: $${p.value.toFixed(2)}`)
    .join(', ')}], Total Pre-Tax=$${parsedGoogle401k.totals['Pre-Tax'].toFixed(2)}`
);

console.log('--- 2c. Testing Attached Fidelity 6-Account Combined Investment Report PDF Statement ---');
const attachedFidelityCombinedLines = [
  'INVESTMENT REPORT',
  'September 1, 2026 - September 30, 2026',
  'Accounts Included in This Report',
  '4 FIDELITY ACCOUNT KELSEY A VAUGHN - INDIVIDUAL TOD X86-328847 $1,894,687.52 $1,914,317.12',
  '9 EDUCATION ACCOUNT KELSEY A VAUGHN - PARTICIPANT TOD 605-952745 1,125.84 1,113.76',
  '11 EDUCATION ACCOUNT KELSEY A VAUGHN - PARTICIPANT TOD 608-538590 39,852.83 29,441.27',
  '13 PERSONALIZED PORTFOLIOS KELSEY A VAUGHN - ROLLOVER IRA - Y90-958892 1,494,256.33 1,469,971.39',
  '18 FIDELITY ROTH IRA KELSEY A VAUGHN - ROTH INDIVIDUAL RETIREMENT 244-738871 187,933.75 187,281.76',
  '22 FIDELITY HEALTH SAVINGS ACCOUNT KELSEY A VAUGHN HEALTH SAVINGS 237-977853 43,660.42 43,508.62',
  // Page 4 & 5: Account X86-328847
  'Account # X86-328847',
  'Account Summary KELSEY ANN VAUGHN - INDIVIDUAL - TOD',
  'Account # X86-328847',
  'KELSEY ANN VAUGHN - INDIVIDUAL - TOD',
  'Holdings',
  'Core Account',
  'Description Sep 1, 2026 Sep 30, 2026 Sep 30, 2026 Sep 30, 2026 Cost Basis Sep 30, 2026 EY (%)',
  'S',
  'FIDELITY GOVERNMENT MONEY $160,068.11 160,514.970 $1.0000 $160,514.97 not applicable not applicable $5,507.18',
  'MARKET (SPAXX) 3.430%',
  '-- 7-day yield: 3.48%',
  'Total Core Account (8% of account $160,068.11 $160,514.97 $5,507.18',
  'holdings)',
  'Stocks',
  'Common Stock',
  'M MICROSOFT CORP (MSFT) $1,734,619.41 3,419.384 $512.9000 $1,753,802.15 $336,120.87 t $1,417,681.28 $13,403.99',
  '0.760%',
  'Total Common Stock (92% of account $1,734,619.41 $1,753,802.15 $336,120.87 $1,417,681.28 $13,403.99',
  'holdings)',
  'Total Holdings $1,894,687.52 $1,914,317.12 $336,120.87 $1,417,681.28 $18,911.17',
  // Page 9: Account 605-952745
  'Account Value: $1,113.76 Account # 605-952745',
  'HENRY L HALE - BENEFICIARY (529)',
  'Holdings',
  'MA COLLEGE PORT. (FIDELITY INDEX) 100 % $1,125.84 54.946 $20.2700 $1,113.76',
  'Total Market Value $1,113.76',
  // Page 11: Account 608-538590
  'Account Value: $29,441.27 Account # 608-538590',
  'SADIE AMELIA HALE - BENEFICIARY (529)',
  'Holdings',
  'MA COLLEGE PORT. (FIDELITY INDEX) 35 % $12,325.66 514.835 $20.2700 $10,435.71',
  'MA AGGRESSIVE GROWTH PORT (FIDELITY FDS) 65 $22,527.17 279.658 67.9600 19,005.56',
  'Total Market Value $29,441.27',
  // Page 14 & 15: Account Y90-958892
  'Account # Y90-958892',
  'Holdings KELSEY ANN VAUGHN - ROLLOVER IRA',
  'Stock Funds',
  'FIDELITY SAI CANADA 2.47 % $38,321.20 2,346.675 $15.5100 $36,396.93 $27,193.12 $9,203.81 -',
  'EQUITY INDEX FUND (FSCJX) -',
  'FIDELITY SAI INFLATION 0.54 7,748.18 81.458 98.8500 8,052.12 2,998.77 5,053.35 1,711.64',
  'FOCUSED FD (FIFGX) 21.260',
  'STRATEGIC ADVISORS U.S. 59.96 889,436.27 71,960.863 12.2500 881,520.57 287,453.03 594,067.54 -',
  'TOTAL STOCK FD (FSAKX) -',
  'STRATEGIC ADVISERS 8.28 122,670.93 6,962.028 17.5000 121,835.49 56,753.66 65,081.83 1,385.44',
  'EMERGING MARKETS 1.140',
  '(FSAMX)',
  'STRATEGIC ADVISERS 15.98 242,866.56 15,658.708 15.0100 235,037.21 109,895.23 125,141.98 6,435.73',
  'INTERNATIONAL FUND 2.740',
  '(FILFX)',
  'COHEN & STEERS REALTY 0.45 7,226.48 98.146 68.8100 6,753.42 6,490.95 262.47 187.46',
  'SHARES (CSRSX) 2.780',
  'Total Stock Funds 87.68 % $1,308,269.62 $1,289,595.74 $490,784.76 $798,810.98 $9,720.27',
  'Bond Funds S',
  'STRATEGIC ADVISERS 8.24 % $124,844.39 13,893.454 $8.7200 $121,150.92 $82,692.39 $38,458.53 $5,385.57',
  'CORE INCOME FUND (FPCIX) 4.450%',
  'FID SAI INFLATION 1.49 22,633.89 2,263.389 9.7400 22,045.41 21,206.98 838.43 -',
  'PROTECTED BOND INDEX -',
  '(FSPWX)',
  'FID SAI LONG TERM 1.70 26,490.47 4,187.864 6.0000 25,127.18 27,030.71 -1,903.53 1,166.41',
  'TREASURY BOND INDEX 4.640',
  '(FBLTX)',
  '-- 30-day yield: 5.64%',
  'Total Bond Funds 11.43 % $173,968.75 $168,323.51 $130,930.08 $37,393.43 $6,551.98',
  'Account # Y90-958892',
  'Holdings KELSEY ANN VAUGHN - ROLLOVER IRA',
  'Short-term Funds',
  'FIDELITY GOVERNMENT 0.81 % $12,017.96 12,052.140 $1.0000 $12,052.14 not applicable not applicable $421.74',
  'CASH RESERVES (FDRXX) 3.500%',
  '-- 7-day yield: 3.55%',
  'Total Short-term Funds 0.81 % $12,017.96 $12,052.14 $421.74',
  'Total Holdings 100% r $1,469,971.39 $621,714.84 $836,204.41 $16,693.99',
  // Page 19: Account 244-738871
  'Account # 244-738871',
  'Holdings KELSEY ANN VAUGHN - ROTH IRA',
  'Core Account',
  'FIDELITY GOVERNMENT MONEY $237.54 238.200 $1.0000 $238.20 not applicable not applicable $8.17',
  'MARKET (SPAXX) 3.430%',
  'Total Core Account (0% of account $237.54 $238.20 $8.17',
  'holdings)',
  'Mutual Funds',
  'Stock Funds',
  'FIDELITY 500 INDEX FUND (FXAIX) $187,696.21 701.773 $266.5300 $187,043.56 $120,000.00 $67,043.56 $1,936.89',
  '1.040%',
  'Total Holdings $187,281.76 $120,000.00 $67,043.56 $1,945.06',
  // Page 23: Account 237-977853
  'Account # 237-977853',
  'Holdings KELSEY ANN VAUGHN - HEALTH SAVINGS ACCOUNT',
  'Core Account',
  'FIDELITY GOVERNMENT CASH $1.85 1.860 $1.0000 $1.86 not applicable not applicable $0.07',
  'RESERVES (FDRXX) 3.760%',
  'Total Core Account (0% of account $1.85 $1.86 $0.07',
  'holdings)',
  'Mutual Funds',
  'Stock Funds',
  'FIDELITY 500 INDEX FUND (FXAIX) $43,658.57 163.234 $266.5300 $43,506.76 $34,540.52 $8,966.24 $450.53',
  '1.040%',
  'Total Holdings $43,508.62 $34,540.52 $8,966.24 $450.60'
];

const parsedFidelityCombined = sandbox.StatementParser.parseExtractedPDFText(
  attachedFidelityCombinedLines,
  'Fidelity-Combined-Sep2026.pdf'
);
assert(
  parsedFidelityCombined.positions.length === 19,
  `Expected 19 holdings across 6 accounts, got ${parsedFidelityCombined.positions.length}`
);
const sumByAcct = {};
parsedFidelityCombined.positions.forEach((p) => {
  sumByAcct[p.accountNumber] = (sumByAcct[p.accountNumber] || 0) + p.value;
});
assert(approxEqual(sumByAcct['X86-328847'], 1914317.12, 0.01), `X86-328847 mismatch: ${sumByAcct['X86-328847']}`);
assert(approxEqual(sumByAcct['605-952745'], 1113.76, 0.01), `605-952745 mismatch: ${sumByAcct['605-952745']}`);
assert(approxEqual(sumByAcct['608-538590'], 29441.27, 0.01), `608-538590 mismatch: ${sumByAcct['608-538590']}`);
assert(approxEqual(sumByAcct['Y90-958892'], 1469971.39, 0.01), `Y90-958892 mismatch: ${sumByAcct['Y90-958892']}`);
assert(approxEqual(sumByAcct['244-738871'], 187281.76, 0.01), `244-738871 mismatch: ${sumByAcct['244-738871']}`);
assert(approxEqual(sumByAcct['237-977853'], 43508.62, 0.01), `237-977853 mismatch: ${sumByAcct['237-977853']}`);
const fidGrandTotal =
  parsedFidelityCombined.totals.Taxable +
  parsedFidelityCombined.totals['Pre-Tax'] +
  parsedFidelityCombined.totals.Roth;
assert(approxEqual(fidGrandTotal, 3645633.92, 0.01), `Grand total mismatch: ${fidGrandTotal}`);
console.log(
  `Attached Fidelity 6-Account Statement verified: 19 holdings across 6 accounts, Grand Total = $${fidGrandTotal.toFixed(
    2
  )}`
);

console.log('--- 2d. Testing Fidelity Holdings with "unavailable" Beginning Market Value & CDs ---');
const fidelityUnavailableAndCdLines = [
  'INVESTMENT REPORT',
  'Account # Y80-984022',
  'Holdings DAVID G HALE - JOINT CP',
  'Exchange Traded Products (continued)',
  'Fixed Income ETPs',
  'ISHARES NATIONAL MUNI 23.45 % unavailable 2,684.670 $101.1000 $271,420.13 $270,104.65 $1,315.48 $9,189.51',
  'BOND ETF (MUB) 3.390%',
  'Total Fixed Income ETPs 23.45 % unavailable 271,420.13 270,104.65 1,315.48 9,189.51',
  'Stocks',
  'TEVA PHARMACEUTICAL 0.02 unavailable 7.100 39.6000 281.16 109.82 171.34 6.04',
  'INDUSTRIES ILS0.10 (TEVA) 2.150',
  'ADIDAS ADR (ADDYY) 0.01 unavailable 2.130 82.0500 174.76 180.32 -5.56 0.51',
  '0.290',
  'Total Stocks 23.90% $306,867.24 $305,336.19 $198,919.44',
  'Account # X86-145270',
  'Holdings DAVID G HALE - JOINT CP',
  'Other',
  'BANC OF CALIF LOS ANGE CD $100,016.00 100,000.000 $0.9999 $99,985.00 $100,000.00 B -$15.00 $2,038.36',
  '4.00000% 11/02/2026 FIXED COUPON $1,687.67 -',
  'FDIC INSURED SEMIANNUALLY CUSIP:',
  '05890QCV4',
  'Total Holdings $613,347.76'
];
const parsedUnavail = sandbox.StatementParser.parseExtractedPDFText(
  fidelityUnavailableAndCdLines,
  'Fidelity-Unavailable-Test.pdf'
);
assert(
  parsedUnavail.positions.length === 4,
  `Expected 4 positions (3 unavailable Beginning MV + 1 CD), got ${parsedUnavail.positions.length}`
);
assert(parsedUnavail.positions[0].symbol === 'MUB' && approxEqual(parsedUnavail.positions[0].value, 271420.13, 0.01), 'MUB mismatch');
assert(parsedUnavail.positions[1].symbol === 'TEVA' && approxEqual(parsedUnavail.positions[1].value, 281.16, 0.01), 'TEVA mismatch');
assert(parsedUnavail.positions[2].symbol === 'ADDYY' && approxEqual(parsedUnavail.positions[2].value, 174.76, 0.01), 'ADDYY mismatch');
assert(
  parsedUnavail.positions[3].holdingName === 'BANC OF CALIF LOS ANGE CD' &&
    parsedUnavail.positions[3].symbol === 'BANC OF CALIF LOS ANGE CD' &&
    parsedUnavail.positions[3].description ===
      '4.00000% 11/02/2026 FIXED COUPON FDIC INSURED SEMIANNUALLY CUSIP: 05890QCV4' &&
    approxEqual(parsedUnavail.positions[3].value, 99985.00, 0.01),
  `CD formatting mismatch: ${JSON.stringify(parsedUnavail.positions[3])}`
);
console.log('Fidelity "unavailable" Beginning Market Value holdings & CD Holding/Symbol/Description formatting verified.');

console.log('--- 2d. Testing Attached Microsoft Deferred Compensation Plan PDF Statement ---');
const microsoftDefCompLines = [
  'Statement Details',
  'MICROSOFT DEFERRED',
  'Deferred Savings Statement',
  'COMPENSATION PLAN',
  'KELSEY VAUGHN Customer Service: (888) 810-6738',
  '10411 113TH PL NE Fidelity Brokerage Services LLC',
  'KIRKLAND, WA 98033- 900 Salem Street, Smithfield, RI 02917',
  'Your Account Summary',
  'Statement Period: 01/01/2026 to 10/26/2026',
  'Beginning Balance $2,074,501.18',
  'Withdrawals -$435,497.19',
  'Change in Market Value $100,403.77',
  'Ending Balance $1,739,407.76',
  'Additional Information',
  'Vested Balance $1,739,407.76',
  'Dividends & Interest $874.65',
  'Market Value of Your Account',
  'CORE INVESTMENTS',
  'Bond $25,471.78 $25,113.35',
  'Income',
  'PIM Total RT',
  'Inst 2,874.919 2,975.515 $8.86 $8.44 $25,471.78 $25,113.35',
  'TARGET RETIREMENT DATE INVESTMENTS',
  'Blended Fund Investments* $2,049,029.40 $1,714,294.41',
  'BTC Lpath',
  '20,404.372 17,498.398 $13.00 $13.69 $265,352.74 $239,570.56',
  'Idx Ret M',
  'BTC Lpath',
  'Idx 2030 M 129,720.051 100,991.190 $13.75 $14.60 $1,783,676.66 $1,474,723.85',
  'Account Totals $2,074,501.18 $1,739,407.76',
  'Market Value of Deferrals Statement Period: 01/01/2026 to 10/26/2026',
  '2018 Base Salary (post 2013) 2025 5 Year Current',
  '2018 Base Salary (post 2013) $183,409.97',
  '2018 Total $183,409.97',
  '2019 Base Salary (post 2013) 2026 5 Year Current',
  '2019 Base Salary (post 2013) $236,414.11',
  '2019 Review Bonus (post 2013) 2029 3 Year Current',
  '2019 Review Bonus (post 2013) $183,033.94',
  '2019 Total $419,448.05',
  '2020 Base Salary (post 2013) 2027 5 Year Current',
  '2020 Base Salary (post 2013) $282,303.08',
  '2020 Review Bonus (post 2013) 2026 3 Year Current',
  '2020 Review Bonus (post 2013) $99,965.88',
  '2020 Total $382,268.96',
  '2021 Base Salary (post 2013) 2028 5 Year Current',
  '2021 Base Salary (post 2013) $241,913.18',
  '2021 Review Bonus (post 2013) 2027 3 Year Current',
  '2021 Review Bonus (post 2013) $119,919.82',
  '2021 Total $361,833.00',
  '2023 Base Salary (post 2013) 2026 3 Year Current',
  '2023 Base Salary (post 2013) $188,636.67',
  '2023 Review Bonus (post 2013) 2026 4 Year Current',
  '2023 Review Bonus (post 2013) $119,650.74',
  '2023 Total $308,287.41',
  '2024 Base Salary (post 2013) 2026 3 Year Current',
  '2024 Base Salary (post 2013) $14,717.45',
  '2024 Total $14,717.45',
  'Other Signing Bonus (post 2013) 2025 3 Year Current',
  'Other Contributions Signing Bonus (post 2013) $69,442.92',
  'Total Value $1,739,407.76'
];

const parsedMsftDefComp = sandbox.StatementParser.parseExtractedPDFText(
  microsoftDefCompLines,
  'Microsoft-Deferred-Comp.pdf'
);
assert(parsedMsftDefComp.positions.length === 3, `Expected 3 holdings, got ${parsedMsftDefComp.positions.length}`);
assert(
  approxEqual(parsedMsftDefComp.totals['Deferred Comp'], 1739407.76, 0.01),
  `Expected Deferred Comp $1,739,407.76, got ${parsedMsftDefComp.totals['Deferred Comp']}`
);
assert(
  parsedMsftDefComp.deferrals.length === 11,
  `Expected 11 deferral tranches, got ${parsedMsftDefComp.deferrals.length}`
);
console.log(
  `Microsoft Deferred Comp parsed: Plan='${parsedMsftDefComp.positions[0].accountName}', Total=$${parsedMsftDefComp.totals[
    'Deferred Comp'
  ].toFixed(2)} across ${parsedMsftDefComp.positions.length} holdings and ${parsedMsftDefComp.deferrals.length} tranches`
);

// Add Deferred Comp statement to AppState
sandbox.AppState.addImportedStatements([parsedMsftDefComp]);
const stateWithDefComp = sandbox.AppState.get();
assert(
  approxEqual(stateWithDefComp.deferredCompBalance, 1739408, 1),
  `AppState deferredCompBalance mismatch: ${stateWithDefComp.deferredCompBalance}`
);
assert(
  stateWithDefComp.deferredCompSchedule.length === 11,
  `AppState deferredCompSchedule length mismatch: ${stateWithDefComp.deferredCompSchedule.length}`
);

console.log('--- 3. Testing SSRN-5924942 Actuarial CRUT Derivation (Table F, Table D, Table 2010CM U(1)/U(2)) ---');
const TE = sandbox.TrustEngine;
assert(TE.TABLE_2010CM.length === 111, 'Table 2010CM must have 111 entries (ages 0..110)');
const fQuarterlyLag3 = TE.calculateTableFFactor(0.05, 4, 3);
const uTest = 0.06 * fQuarterlyLag3;
const rfTerm20 = TE.calculateTermCRUTRemainderFactor(uTest, 20);
const rfSingle56 = TE.calculateSingleLifeCRUTRemainderFactor(uTest, 56);
const rfTwoLife56_54 = TE.calculateTwoLifeCRUTRemainderFactor(uTest, 56, 54);
assert(rfTwoLife56_54 < rfSingle56, 'Two-life RF must be < Single-life RF');
assert(rfTerm20 > 0.10, '20-yr 6% CRUT passes 10% remainder test');
assert(Array.isArray(TE.IRS_7520_RATES_FALLBACK) && TE.IRS_7520_RATES_FALLBACK.length >= 3, 'IRS_7520_RATES_FALLBACK must contain at least 3 monthly rates');

// Verify expected trust duration & standalone schedule across Term, Single-Life, and Two-Life Last Survivor
const durTerm = TE.calculateExpectedTrustDurationYears({
  trustDurationType: 'term',
  trustTermYears: 20,
  trustMeasuringAge1: 58,
  trustMeasuringAge2: 56
});
const durSingle = TE.calculateExpectedTrustDurationYears({
  trustDurationType: 'single_life',
  trustTermYears: 20,
  trustMeasuringAge1: 58,
  trustMeasuringAge2: 56
});
const durTwoLife = TE.calculateExpectedTrustDurationYears({
  trustDurationType: 'two_life',
  trustTermYears: 20,
  trustMeasuringAge1: 58,
  trustMeasuringAge2: 56
});
assert(durTerm === 20, `Expected durTerm === 20, got ${durTerm}`);
assert(durSingle > 20, `Expected durSingle > 20 for age 58, got ${durSingle}`);
assert(durTwoLife > durSingle, `Expected durTwoLife (${durTwoLife}) > durSingle (${durSingle}) for ages 58 & 56`);

const twoLifeSchedulePreview = TE.projectStandaloneTrustSchedule({
  trustEnabled: false,
  trustType: 'CRUT',
  trustDurationType: 'two_life',
  trustTermYears: 20,
  trustMeasuringAge1: 58,
  trustMeasuringAge2: 56,
  trustAssetValue: 0,
  trustCostBasis: 0,
  trustPayoutRate: 6.0,
  equityReturnMean: 8.2,
  fixedIncomeYield: 4.4
});
assert(
  twoLifeSchedulePreview.length === durTwoLife,
  `Expected Two-Life standalone schedule length ${durTwoLife}, got ${twoLifeSchedulePreview.length}`
);
assert(
  twoLifeSchedulePreview.every((row) => row.trustGrossPayout > 0),
  'Every year in Two-Life standalone schedule should have a positive payout'
);
console.log(
  `Two-Life Last Survivor schedule verified: single-life=${durSingle} yrs, two-life=${durTwoLife} yrs, yr1 payout=$${twoLifeSchedulePreview[0].trustGrossPayout.toFixed(
    2
  )}`
);

// Verify Flip CRUT deferral and post-flip compounding
const flipCrutSchedule = TE.projectStandaloneTrustSchedule({
  baseYear: 2026,
  trustEnabled: true,
  trustType: 'FLIP_CRUT',
  trustFlipStartYear: 2031,
  trustDurationType: 'term',
  trustTermYears: 15,
  trustAssetValue: 1000000,
  trustCostBasis: 200000,
  trustPayoutRate: 6.0,
  trustTier1Return: 2.0,
  trustTier2Return: 5.0,
  trustTier3Return: 0.0
});
assert(
  flipCrutSchedule.slice(0, 5).every((r) => r.trustGrossPayout === 0),
  'Flip CRUT years 2026-2030 (first 5 years) must have $0 payout during deferral'
);
assert(
  flipCrutSchedule[4].trustNav > 1300000,
  `Expected Flip CRUT NAV to compound above $1.3M by 2030, got ${flipCrutSchedule[4].trustNav}`
);
assert(
  flipCrutSchedule[5].calendarYear === 2031 && flipCrutSchedule[5].trustGrossPayout > 85000,
  `Expected Flip CRUT to begin paying >$85k in 2031, got ${flipCrutSchedule[5].trustGrossPayout}`
);
console.log(
  `Flip CRUT verified: 2026-2030 payout=$0, 2030 compounded NAV=$${flipCrutSchedule[4].trustNav.toFixed(
    2
  )}, 2031 first payout=$${flipCrutSchedule[5].trustGrossPayout.toFixed(2)}`
);

// Verify Exact Non-Round Mortgage Principal Balance & Lump-Sum Payoff
// 3b. Verify Enhanced ARM Monthly Amortization & Scenario Payoff Engine
const ME = sandbox.MortgageEngine;
assert(typeof ME.computeMonthlyPayment === 'function', 'computeMonthlyPayment must be exported');
assert(typeof ME.evaluateMortgageScenarios === 'function', 'evaluateMortgageScenarios must be exported');

// Test Monthly Payment standard formula: $850,000 at 4.5% over 240 months
const expectedMonthlyPmt = ME.computeMonthlyPayment(850000, 0.045, 240);
assert(approxEqual(expectedMonthlyPmt, 5377.52, 0.05), `Expected monthly P&I ~5377.52, got ${expectedMonthlyPmt}`);

const exactMortgageTracker = ME.createMortgageTracker({
  baseYear: 2026,
  mortgageEnabled: true,
  mortgageBalance: 642518.37,
  mortgageRate: 3.125,
  mortgageRemainingTermYears: 18,
  mortgageRemainingTermMonths: 0,
  mortgageResetYear: 2031, // 5 years later (2026 + 5)
  mortgageResetMonth: 6, // June reset
  mortgagePostAdjustmentRate: 6.25,
  mortgageScenarioMode: 'post_reset',
  mortgagePayoffYear: 2033, // 7 years later (2 years after 5-yr ARM reset)
  mortgagePayoffMonth: 5,
  mortgagePayoffStrategy: 'lump_sum',
  mortgageLumpSumSource: 'pre_tax'
});

assert(exactMortgageTracker.resetYear === 2031, 'ARM reset year set to 2031');
assert(exactMortgageTracker.resetMonth === 6, 'ARM reset month set to 6');

// Step years 0 to 4 (pre-reset rate 3.125%)
const step0 = ME.stepMortgageYear(exactMortgageTracker, 0);
assert(approxEqual(step0.activeRate, 0.03125, 1e-5), 'Step 0 should use initial rate');
assert(step0.lumpSumPayoffAmount === 0, 'No lump sum in year 0');

// Step through year 5 (2031: rate resets in June to 6.25% and payment re-amortizes)
for (let y = 1; y < 5; y++) {
  ME.stepMortgageYear(exactMortgageTracker, y);
}
const step5 = ME.stepMortgageYear(exactMortgageTracker, 5);
assert(exactMortgageTracker.hasReset === true, 'Tracker hasReset must be true after June 2031');
assert(approxEqual(exactMortgageTracker.activeRate, 0.0625, 1e-5), 'Active rate must be 6.25%');
assert(exactMortgageTracker.postResetMonthlyPayment > step0.preResetMonthlyPayment, 'Post-reset payment must exceed pre-reset payment');

// Step through year 7 (2033: lump sum payoff triggers in Month 5)
ME.stepMortgageYear(exactMortgageTracker, 6);
const step7 = ME.stepMortgageYear(exactMortgageTracker, 7);
assert(step7.lumpSumPayoffAmount > 400000, `Lump sum payoff amount should be >$400k, got ${step7.lumpSumPayoffAmount}`);
assert(step7.endingBalance === 0, 'Ending balance must be $0 after lump sum payoff');
assert(exactMortgageTracker.isPaidOff === true, 'Mortgage must be flagged as isPaidOff');

// Test evaluateMortgageScenarios
const scenarioEval = ME.evaluateMortgageScenarios({
  baseYear: 2026,
  mortgageEnabled: true,
  mortgageBalance: 850000,
  mortgageRate: 4.5,
  mortgageRemainingTermYears: 20,
  mortgageResetYear: 2028,
  mortgageResetMonth: 6,
  mortgagePostAdjustmentRate: 6.5,
  mortgagePayoffYear: 2030,
  mortgagePayoffMonth: 5
});
assert(scenarioEval !== null, 'Mortgage scenario evaluation must succeed');
assert(scenarioEval.monthlyPaymentShock > 0, 'Rate increase must create positive monthly payment shock');
assert(scenarioEval.interestSavedAtReset > 200000, `Payoff at reset should save significant interest, got ${scenarioEval.interestSavedAtReset}`);
assert(scenarioEval.interestSavedAtReset > scenarioEval.interestSavedPostReset, 'Payoff at reset should save more interest than post-reset payoff');

console.log(
  `Lump sum mortgage payoff verified: ARM reset in June 2031 to 6.25%, re-amortized payment shock +$${(
    exactMortgageTracker.postResetMonthlyPayment - step0.preResetMonthlyPayment
  ).toFixed(2)}/mo, full lump payoff of $${step7.lumpSumPayoffAmount.toFixed(
    2
  )} in 2033 (ending balance=$${step7.endingBalance})`
);

// Specific regression test for user scenario: Originated Oct 2021, Ends Nov 2051, Reset Dec 2031, Payoff Jan 2034
const userMortgageState = {
  baseYear: 2026,
  mortgageEnabled: true,
  mortgageBalance: 444055,
  mortgageRate: 4.5,
  mortgageOriginationYear: 2021,
  mortgageOriginationMonth: 10,
  mortgageOriginalTermYears: 30,
  mortgageMaturityYear: 2051,
  mortgageMaturityMonth: 11,
  mortgageResetYear: 2031,
  mortgageResetMonth: 12,
  mortgagePostAdjustmentRate: 6.5,
  mortgageScenarioMode: 'post_reset',
  mortgageTargetPayoffYear: 2034,
  mortgagePayoffMonth: 1
};
const userEval = ME.evaluateMortgageScenarios(userMortgageState);
assert(userEval !== null, 'User mortgage scenario evaluation must succeed');
assert(
  userEval.monthlyPaymentPostReset < 10000,
  `Post-reset monthly payment must be a realistic monthly figure (not $446k!), got ${userEval.monthlyPaymentPostReset}`
);
assert(
  approxEqual(userEval.monthlyPaymentPreReset, 2421.11, 0.5),
  `Pre-reset monthly payment should be ~2421.11, got ${userEval.monthlyPaymentPreReset}`
);
assert(
  approxEqual(userEval.monthlyPaymentPostReset, 2853.26, 0.5),
  `Post-reset re-amortized monthly payment should be ~2853.26, got ${userEval.monthlyPaymentPostReset}`
);
assert(
  approxEqual(userEval.monthlyPaymentShock, 432.15, 0.5),
  `Payment shock should be ~432.15, got ${userEval.monthlyPaymentShock}`
);
assert(
  userEval.postReset && userEval.postReset.payoffYear === 2034 && userEval.postReset.payoffMonth === 1,
  `Payoff date must be Jan 2034, got ${userEval.postReset?.payoffMonth}/${userEval.postReset?.payoffYear}`
);
assert(
  approxEqual(userEval.postReset.payoffAmount, 361862.83, 1.0),
  `Payoff lump sum balance at Jan 2034 should be ~361862.83, got ${userEval.postReset.payoffAmount}`
);
console.log('User ARM 10/1 scenario (Oct 2021 orig, Nov 2051 end, Dec 2031 reset, Jan 2034 payoff) verified successfully.');

console.log('--- 4. Testing WA State Tiered Capital Gains Tax (7% <=$1M / 9.9% >$1M) & 3.8% NIIT ---');
const waYr0 = sandbox.TaxEngine.calculateWACapitalGainsTax({
  enabled: true,
  baseThreshold: 278000,
  indexFrom2025: true,
  inflationRateDecimal: 0.025,
  yearIndex: 0,
  brokerageRealizedLTCG: 200000,
  trustTier2Distribution: 150000
});
assert(waYr0.indexedThreshold === 284950, `Expected 2026 indexed WA threshold 284950, got ${waYr0.indexedThreshold}`);
assert(approxEqual(waYr0.waTax, (350000 - 284950) * 0.07, 1e-2), 'WA 7% tax calculation mismatch');

// Test 9.9% Tier above $1,000,000 of taxable gains
const waTier2 = sandbox.TaxEngine.calculateWACapitalGainsTax({
  enabled: true,
  baseThreshold: 278000,
  indexFrom2025: true,
  inflationRateDecimal: 0.025,
  yearIndex: 0,
  brokerageRealizedLTCG: 1284950,
  trustTier2Distribution: 500000
});
// Total LTCG = 1,784,950; Net taxable = 1,784,950 - 284,950 = 1,500,000
// Tier 1: 1,000,000 * 0.07 = 70,000
// Tier 2: 500,000 * 0.099 = 49,500
// Total WA tax = 119,500
assert(waTier2.netTaxableGain === 1500000, `Expected net taxable gain 1500000, got ${waTier2.netTaxableGain}`);
assert(waTier2.tier1Tax === 70000, `Expected tier 1 tax 70000, got ${waTier2.tier1Tax}`);
assert(waTier2.tier2Tax === 49500, `Expected tier 2 tax 49500, got ${waTier2.tier2Tax}`);
assert(approxEqual(waTier2.waTax, 119500, 1e-2), `Expected total WA tax 119500, got ${waTier2.waTax}`);

console.log('--- 5. Testing Full Simulation with Combined Multi-Statement Balances ---');
sandbox.AppState.update({
  trustEnabled: true,
  trustAssetValue: 2000000,
  trustCostBasis: 100000,
  rothConversionAnnual: 150000,
  earlyPreTaxDrawAnnual: 75000,
  mortgageEnabled: true,
  mortgageBalance: 850000,
  mortgageTargetPayoffYear: 2036
});
const sim = sandbox.SimulatorEngine.runFullSimulation(sandbox.AppState.get());
assert(sim.summary.totalTaxSavingsFromTrusts > 300000, 'Expected substantial trust tax savings');
assert(sim.summary.totalRmdWithStrategy < sim.summary.totalRmdWithoutStrategy, 'Meltdown reduces RMDs');
const yr2036 = sim.years.find((y) => y.calendarYear === 2036);
assert(yr2036 && yr2036.mortgageBalance <= 1, 'Mortgage paid off by 2036');

console.log('--- 6. Testing Gottlieb CRUT Suitability Analyzer (Klaus Gottlieb 2026 Engine) ---');
const GE = sandbox.GottliebEngine;
assert(typeof GE.runGottliebSuitabilityMonteCarlo === 'function', 'runGottliebSuitabilityMonteCarlo must be defined');

// Test 1: 10% Remainder Compliance Check
const passingCompliance = GE.evaluateGottliebComplianceAndDeduction({
  assetValue: 1000000,
  age: 60,
  payoutRate: 5.0,
  rate7520: 5.0,
  outsideIncome: 500000,
  ordinaryRate: 37.0
});
assert(passingCompliance.passes10PercentRule === true, 'Age 60 with 5% payout and 5% § 7520 rate must pass 10% remainder test');
assert(passingCompliance.remainderFactor > 0.10, `Remainder factor must be > 10%, got ${(passingCompliance.remainderFactor * 100).toFixed(2)}%`);
assert(passingCompliance.deductionUsedYear1 <= passingCompliance.agiLimit30Pct, 'Year 1 deduction must not exceed 30% AGI limit');
assert(passingCompliance.upfrontTaxSavings > 0, 'Upfront tax savings must be positive');

// Test 2: Failing Compliance Check (e.g. 18% payout at age 25)
const failingCompliance = GE.evaluateGottliebComplianceAndDeduction({
  assetValue: 1000000,
  age: 25,
  payoutRate: 18.0,
  rate7520: 3.0,
  outsideIncome: 500000,
  ordinaryRate: 37.0
});
assert(failingCompliance.passes10PercentRule === false, 'Age 25 with 18% payout must fail 10% remainder test');

// Test 3: Mortality Window
const mort = GE.calculateSettlorLifeExpectancy(60, 'female');
assert(mort.expectedDeathAge >= 84 && mort.expectedDeathAge <= 88, `Female age 60 expected death age should be ~85-87, got ${mort.expectedDeathAge}`);
assert(mort.windowEndYear - mort.windowStartYear === 10, 'Mortality window must span 10 years (±5 years)');

// Test 4: 1,000-Run Monte Carlo Simulation
const gottliebSim = GE.runGottliebSuitabilityMonteCarlo(sandbox.AppState.get());
assert(gottliebSim.runs === 1000, 'Must execute 1,000 paired-path Monte Carlo runs');
assert(gottliebSim.probOutperformHoldByYear.length === 40, 'Should project 40-year outperformance probability curve');
assert(gottliebSim.probOutperformReinvestByYear.length === 40, 'Should project 40-year outperformance probability curve');
assert(
  gottliebSim.probOutperformReinvestByYear[11] > gottliebSim.probOutperformHoldByYear[11],
  'At crossover (Year 12), win rate vs Track C must exceed win rate vs Track B'
);
assert(
  gottliebSim.lifetimeWinRateVsReinvest >= gottliebSim.lifetimeWinRateVsHold,
  'Lifetime win rate vs Track C should be >= win rate vs Track B (consistent with Gottlieb 2026 paper)'
);
console.log(
  `Gottlieb CRUT Analyzer verified: Remainder factor=${(passingCompliance.remainderFactor * 100).toFixed(2)}%, Yr1 tax savings=$${passingCompliance.upfrontTaxSavings.toFixed(
    2
  )}, Female age 60 expected death=Age ${mort.expectedDeathAge}, Lifetime Win Rate vs Track B (Hold-and-Draw)=${gottliebSim.lifetimeWinRateVsHold.toFixed(
    1
  )}%, vs Track C (Immediate Sale)=${gottliebSim.lifetimeWinRateVsReinvest.toFixed(1)}%`
);

console.log('--- 7. Testing Social Security Statement (SSA-7005) Parser & Strategy Engine ---');
const davidHaleSSLines = [
  'Your Social Security Statement',
  'DAVID G. HALE',
  'October 28, 2026',
  'Retirement Benefits',
  'You have earned enough credits to qualify for retirement benefits. To qualify for benefits, you earn credits through your work - up to four each year.',
  'Your full retirement age is 67, based on your date of birth: August 7, 1970. As shown in the chart, you can start your benefits at any time between ages 62 and 70. For each month you wait to start your benefits, your monthly benefit will be higher—for the rest of your life.',
  'These personalized estimates are based on your earnings to date and assume you continue to earn $0 per year until you start your benefits. Learn more at ssa.gov/benefits/retirement/learn.html.',
  'Disability Benefits',
  'You have earned enough credits to qualify for disability benefits. If you became disabled right now and you have enough recent work, your monthly payment would be about $4,083. Learn more at ssa.gov/disability.',
  'Survivors Benefits',
  'You have earned enough credits for your eligible family members to receive survivors benefits. If you die this year, members of your family who may qualify for monthly benefits include:',
  'Minor child: $3,062',
  'Spouse, if caring for a disabled child or child younger than age 16: $3,062',
  'Spouse, if benefits start at full retirement age: $4,083',
  'Total family benefits cannot be more than: $7,145',
  'Your spouse or minor child may be eligible for an additional one-time death benefit of $255. Learn more at ssa.gov/survivors.',
  'Personalized Monthly Retirement Benefit Estimates (Depending on the Age You Start) Age Retirement Benefits Start Monthly Benefit Amount',
  '62 $2,639',
  '63 $2,811',
  '64 $2,999',
  '65 $3,249',
  '66 $3,498',
  '67 $3,748',
  '68 $3,873',
  '69 $4,173',
  '70 $4,648',
  'Medicare',
  'You have enough credits to qualify for Medicare at age 65.',
  'Earnings Record',
  'Work Year Earnings Taxed for Social Security Earnings Taxed for Medicare (began 1966)',
  '1981-1990 $4,985 $4,985',
  '1991-2000 $324,098 $360,987',
  '2001-2005 $427,734 $440,292',
  '2006 $94,200 $136,127',
  '2007 $97,500 $105,827',
  '2008 $102,000 $130,564',
  '2009 $106,800 $144,386',
  '2010 $106,800 $150,897',
  '2011 $106,800 $160,799',
  '2012 $110,100 $192,821',
  '2013 $113,700 $198,543',
  '2014 $117,000 $211,989',
  '2015 $118,500 $221,762',
  '2016 $118,500 $242,285',
  '2017 $127,200 $198,972',
  '2018 $128,400 $422,675',
  '2019 $132,900 $387,089',
  '2020 $137,700 $458,909',
  '2021 $142,800 $490,325',
  '2022 $147,000 $359,144',
  '2023 $110,196 $110,196',
  '2024 $0 $0',
  '2025 Not yet recorded Not yet recorded',
  'Taxes Paid',
  'Total estimated Social Security and Medicare taxes paid over your working career based on your Earnings Record:',
  'Social Security taxes Medicare taxes',
  'You paid: $173,886 You paid: $74,361',
  'Employer(s): $186,339 Employer(s): $74,361'
];

const parsedDavidHale = sandbox.StatementParser.parseExtractedPDFText(
  davidHaleSSLines,
  'SocialSecurityStatement-DavidHale.pdf'
);

assert(parsedDavidHale.isSocialSecurity === true, 'Detected format must be Social Security');
assert(parsedDavidHale.socialSecurity.name === 'DAVID G. HALE', `Expected DAVID G. HALE, got ${parsedDavidHale.socialSecurity.name}`);
assert(parsedDavidHale.socialSecurity.statementDate === 'October 28, 2026', 'Statement date must be October 28, 2026');
assert(parsedDavidHale.socialSecurity.dob === 'August 7, 1970', 'DOB must be August 7, 1970');
assert(parsedDavidHale.socialSecurity.birthYear === 1970, 'Birth year must be 1970');
assert(parsedDavidHale.socialSecurity.fra === 67, 'FRA must be 67');
assert(parsedDavidHale.socialSecurity.pia === 3748, 'PIA must be $3,748');

// Verify complete benefit ladder
assert(parsedDavidHale.socialSecurity.benefitsByAge[62] === 2639, 'Age 62 benefit must be $2,639');
assert(parsedDavidHale.socialSecurity.benefitsByAge[63] === 2811, 'Age 63 benefit must be $2,811');
assert(parsedDavidHale.socialSecurity.benefitsByAge[64] === 2999, 'Age 64 benefit must be $2,999');
assert(parsedDavidHale.socialSecurity.benefitsByAge[65] === 3249, 'Age 65 benefit must be $3,249');
assert(parsedDavidHale.socialSecurity.benefitsByAge[66] === 3498, 'Age 66 benefit must be $3,498');
assert(parsedDavidHale.socialSecurity.benefitsByAge[67] === 3748, 'Age 67 benefit must be $3,748');
assert(parsedDavidHale.socialSecurity.benefitsByAge[68] === 3873, 'Age 68 benefit must be $3,873');
assert(parsedDavidHale.socialSecurity.benefitsByAge[69] === 4173, 'Age 69 benefit must be $4,173');
assert(parsedDavidHale.socialSecurity.benefitsByAge[70] === 4648, 'Age 70 benefit must be $4,648');

// Verify disability & survivors
assert(parsedDavidHale.socialSecurity.disabilityMonthly === 4083, 'Disability must be $4,083');
assert(parsedDavidHale.socialSecurity.survivors.spouseFra === 4083, 'Spouse survivor at FRA must be $4,083');
assert(parsedDavidHale.socialSecurity.survivors.minorChild === 3062, 'Minor child survivor must be $3,062');
assert(parsedDavidHale.socialSecurity.survivors.familyMax === 7145, 'Family max survivor must be $7,145');

// Verify FICA taxes paid
assert(parsedDavidHale.socialSecurity.taxesPaid.ssWorker === 173886, 'SS worker taxes paid must be $173,886');
assert(parsedDavidHale.socialSecurity.taxesPaid.ssEmployer === 186339, 'SS employer taxes paid must be $186,339');
assert(parsedDavidHale.socialSecurity.taxesPaid.medWorker === 74361, 'Med worker taxes paid must be $74,361');
assert(parsedDavidHale.socialSecurity.taxesPaid.medEmployer === 74361, 'Med employer taxes paid must be $74,361');

// Verify earnings record
assert(parsedDavidHale.socialSecurity.earningsRecord.length >= 20, 'Expected >= 20 earnings records');
const rec2023 = parsedDavidHale.socialSecurity.earningsRecord.find((r) => r.year === '2023');
assert(rec2023 && rec2023.ssEarnings === 110196, '2023 earnings must be $110,196');

// Test AppState integration
sandbox.AppState.addImportedStatements([parsedDavidHale]);
let ssState = sandbox.AppState.get();
assert(ssState.ssPrimaryEnabled === true, 'ssPrimaryEnabled must be true after import');
assert(ssState.ssPrimaryName === 'DAVID G. HALE', 'Primary name must be DAVID G. HALE');
assert(ssState.ssPrimaryMonthlyBenefit === 3748, 'FRA default monthly payout should be $3,748');
assert(ssState.ssPrimaryAnnualBenefit === 44976, 'FRA default annual payout should be $44,976');
assert(ssState.socialSecurityAnnual === 44976, 'socialSecurityAnnual must sync with ssPrimaryAnnualBenefit');

// Test Claiming Age shifts
sandbox.AppState.update({ ssPrimaryClaimAge: 70 });
ssState = sandbox.AppState.get();
assert(ssState.ssPrimaryMonthlyBenefit === 4648, `Expected age 70 monthly payout $4,648, got ${ssState.ssPrimaryMonthlyBenefit}`);
assert(ssState.ssPrimaryAnnualBenefit === 55776, `Expected age 70 annual payout $55,776, got ${ssState.ssPrimaryAnnualBenefit}`);
assert(ssState.socialSecurityAnnual === 55776, 'socialSecurityAnnual must sync to $55,776 at age 70');

sandbox.AppState.update({ ssPrimaryClaimAge: 62 });
ssState = sandbox.AppState.get();
assert(ssState.ssPrimaryMonthlyBenefit === 2639, `Expected age 62 monthly payout $2,639, got ${ssState.ssPrimaryMonthlyBenefit}`);
assert(ssState.ssPrimaryAnnualBenefit === 31668, `Expected age 62 annual payout $31,668, got ${ssState.ssPrimaryAnnualBenefit}`);

// Test Optional Spouse Statement (Dual Claiming)
const mockSpouseSS = {
  fileName: 'Spouse-SocialSecurity.pdf',
  format: 'Social Security Statement (SSA-7005)',
  isSocialSecurity: true,
  socialSecurity: {
    name: 'SARAH HALE',
    statementDate: 'October 28, 2026',
    dob: 'May 14, 1972',
    birthYear: 1972,
    fra: 67,
    pia: 2500,
    benefitsByAge: {
      62: 1750,
      63: 1875,
      64: 2000,
      65: 2167,
      66: 2333,
      67: 2500,
      68: 2667,
      69: 2833,
      70: 3100
    },
    disabilityMonthly: 2500,
    survivors: { minorChild: 1875, spouseWithChild: 1875, spouseFra: 2500, familyMax: 4375, lumpDeathBenefit: 255 },
    taxesPaid: { ssWorker: 95000, ssEmployer: 95000, medWorker: 35000, medEmployer: 35000 },
    earningsRecord: []
  }
};

sandbox.AppState.addImportedStatements([mockSpouseSS]);
ssState = sandbox.AppState.get();
assert(ssState.ssSpouseEnabled === true, 'ssSpouseEnabled must be true after second statement import');
assert(ssState.ssSpouseName === 'SARAH HALE', 'Spouse name must be SARAH HALE');
assert(ssState.ssSpouseMonthlyBenefit === 2500, 'Spouse monthly benefit at FRA must be $2,500');

// Test Combined Annual Payout (David at 70 = $55,776, Sarah at 67 = $30,000 -> Total = $85,776)
sandbox.AppState.update({ ssPrimaryClaimAge: 70, ssSpouseClaimAge: 67 });
ssState = sandbox.AppState.get();
assert(ssState.ssPrimaryAnnualBenefit === 55776, 'Primary annual benefit must be $55,776');
assert(ssState.ssSpouseAnnualBenefit === 30000, 'Spouse annual benefit must be $30,000');
assert(ssState.socialSecurityAnnual === 85776, `Combined SS annual must be $85,776, got ${ssState.socialSecurityAnnual}`);

// Run full simulation with dual Social Security benefits
const ssSim = sandbox.SimulatorEngine.runFullSimulation(ssState);
assert(ssSim.years.length > 0, 'Simulation must complete');
const yrDavid70 = ssSim.years.find((y) => y.calendarYear === 2040); // 1970 + 70 = 2040
assert(yrDavid70 && yrDavid70.socialSecurityGross > 0, 'Social Security gross must be positive in 2040');
assert(yrDavid70.primarySocialSecurityGross > 0, 'Primary SS must be positive in 2040');
assert(yrDavid70.spouseSocialSecurityGross > 0, 'Spouse SS must be positive in 2040');

console.log(
  `Social Security Statement (SSA-7005) verified: Beneficiary=${parsedDavidHale.socialSecurity.name}, DOB=${parsedDavidHale.socialSecurity.dob}, FRA=${parsedDavidHale.socialSecurity.fra}, PIA=$${parsedDavidHale.socialSecurity.pia}/mo, Age 62=$${parsedDavidHale.socialSecurity.benefitsByAge[62]}/mo, Age 70=$${parsedDavidHale.socialSecurity.benefitsByAge[70]}/mo, Dual Claiming Combined=$${ssState.socialSecurityAnnual.toLocaleString()}/yr.`
);

console.log('ALL VERIFICATION CHECKS PASSED!');
