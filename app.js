'use strict';

const euroFormatter = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

// Coeficientes máximos estatales de referencia vigentes según la redacción
// consolidada consultada en 2026. El municipio puede aplicar coeficientes inferiores.
const PLUSVALIA_COEFFICIENTS = [
  0.15, 0.15, 0.14, 0.14, 0.16, 0.18, 0.19, 0.20, 0.19, 0.15,
  0.12, 0.10, 0.09, 0.09, 0.09, 0.09, 0.10, 0.13, 0.17, 0.23, 0.40,
];

const FIELD_RULES = {
  oldQuota: { min: 0, max: 3000, step: 10 },
  origPrice: { min: 100000, max: 500000, step: 1000 },
  pendMortgage: { min: 0, max: 400000, step: 1000 },
  cancelCost: { min: 0, max: 5000, step: 100 },
  agencyFee: { min: 0, max: 10, step: 0.1 },
  cancelComm: { min: 0, max: 3, step: 0.1 },
  yearsOwned: { min: 0, max: 30, step: 1 },
  cadastralTotal: { min: 20000, max: 300000, step: 0.01 },
  landPct: { min: 10, max: 90, step: 0.01 },
  plusvaliaRate: { min: 0, max: 30, step: 0.1 },
  buyPrice: { min: 200000, max: 1000000, step: 5000 },
  appraisalPrice: { min: 200000, max: 1000000, step: 5000 },
  buyItp: { min: 0, max: 12, step: 0.1 },
  buyNotary: { min: 0, max: 4, step: 0.1 },
  buyReform: { min: 0, max: 150000, step: 1000 },
  buyExtra: { min: 0, max: 20000, step: 500 },
  income: { min: 2000, max: 10000, step: 100 },
  effort: { min: 10, max: 50, step: 1 },
  years: { min: 10, max: 40, step: 1 },
  rate: { min: 0.5, max: 6, step: 0.05 },
  maxLTV: { min: 50, max: 100, step: 1 },
  savings: { min: 0, max: 150000, step: 1000 },
};

const elements = {
  form: document.getElementById('calculatorForm'),
  irpfToggle: document.getElementById('irpfToggle'),
  statusBox: document.getElementById('statusBox'),
  salePrice: document.getElementById('res_salePrice'),
  totalNeeded: document.getElementById('res_totalNeeded'),
  oldQuota: document.getElementById('res_oldQuota'),
  realNewQuota: document.getElementById('res_realNewQuota'),
  quotaDelta: document.getElementById('res_quotaDelta'),
  maxMortgage: document.getElementById('res_maxMortgage'),
  maxQuota: document.getElementById('res_maxQuota'),
  maxLTV: document.getElementById('res_maxLTV'),
  pctFinanced: document.getElementById('res_pctFinanced'),
  reqLiquidity: document.getElementById('res_reqLiquidity'),
  pendMortgage: document.getElementById('res_pendMortgage'),
  fees: document.getElementById('res_fees'),
  plusvalia: document.getElementById('res_plusvalia'),
  plusvaliaMethod: document.getElementById('res_plusvaliaMethod'),
  irpf: document.getElementById('res_irpf'),
  rowIrpf: document.getElementById('row_irpf'),
  effortLabel: document.getElementById('lbl_effort'),
  donut: document.getElementById('fundingDonut'),
  donutTotal: document.getElementById('donutTotal'),
  legendLoan: document.getElementById('legendLoan'),
  legendSale: document.getElementById('legendSale'),
  legendSavings: document.getElementById('legendSavings'),
};

let rafId = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseFiniteNumber(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim().replace(',', '.');
  if (normalized === '') return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function roundToStep(value, step, min = 0) {
  const decimals = (String(step).split('.')[1] || '').length;
  const rounded = Math.round((value - min) / step) * step + min;
  return Number(rounded.toFixed(decimals));
}

function formatCurrency(value) {
  return euroFormatter.format(Math.round(value));
}

function showFieldError(key, message = '') {
  const input = document.getElementById(`${key}Number`);
  const error = document.getElementById(`${key}Error`);
  if (!input || !error) return;
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  error.textContent = message;
}

function setSyncedValue(key, value) {
  const rule = FIELD_RULES[key];
  const safeValue = clamp(value, rule.min, rule.max);
  const stepped = roundToStep(safeValue, rule.step, rule.min);
  const range = document.getElementById(`${key}Range`);
  const number = document.getElementById(`${key}Number`);
  if (!range || !number) return;

  const serialized = String(stepped);
  range.value = serialized;
  number.value = serialized;
  showFieldError(key);

}

function getState() {
  const state = {};
  const errors = [];

  for (const [key, rule] of Object.entries(FIELD_RULES)) {
    const input = document.getElementById(`${key}Number`);
    const raw = input?.value ?? '';
    const value = parseFiniteNumber(raw);

    if (value === null) {
      const message = 'Introduce un número válido.';
      showFieldError(key, message);
      errors.push(key);
      continue;
    }

    if (value < rule.min || value > rule.max) {
      const message = `Debe estar entre ${rule.min} y ${rule.max}.`;
      showFieldError(key, message);
      errors.push(key);
      continue;
    }

    state[key] = roundToStep(value, rule.step, rule.min);
    showFieldError(key);
  }

  return { state, valid: errors.length === 0, errors };
}

function calculateMonthlyPayment(principal, annualRatePercent, months) {
  if (principal <= 0 || months <= 0) return 0;
  const monthlyRate = (annualRatePercent / 100) / 12;
  if (monthlyRate === 0) return principal / months;
  return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
}

function calculatePrincipalFromPayment(payment, annualRatePercent, months) {
  if (payment <= 0 || months <= 0) return 0;
  const monthlyRate = (annualRatePercent / 100) / 12;
  if (monthlyRate === 0) return payment * months;
  return payment * (1 - Math.pow(1 + monthlyRate, -months)) / monthlyRate;
}

function calculateIRPF(gain) {
  if (gain <= 0) return 0;
  const brackets = [
    { limit: 6000, rate: 0.19 },
    { limit: 50000, rate: 0.21 },
    { limit: 200000, rate: 0.23 },
    { limit: 300000, rate: 0.27 },
    { limit: Number.POSITIVE_INFINITY, rate: 0.30 },
  ];

  let tax = 0;
  let lower = 0;
  for (const bracket of brackets) {
    const taxable = Math.min(gain, bracket.limit) - lower;
    if (taxable > 0) tax += taxable * bracket.rate;
    if (gain <= bracket.limit) break;
    lower = bracket.limit;
  }
  return tax;
}

function getObjectiveCoefficient(yearsOwned) {
  const years = clamp(Math.trunc(yearsOwned), 0, 20);
  return PLUSVALIA_COEFFICIENTS[years] ?? PLUSVALIA_COEFFICIENTS[20];
}

function calculateSaleTaxes(salePrice, state) {
  const agencyFee = salePrice * (state.agencyFee / 100);
  const realGain = salePrice - state.origPrice - agencyFee;
  const landRatio = state.landPct / 100;
  const landValue = state.cadastralTotal * landRatio;
  const objectiveCoefficient = getObjectiveCoefficient(state.yearsOwned);
  const objectiveBase = Math.max(0, landValue * objectiveCoefficient);
  const realBase = Math.max(0, realGain * landRatio);

  let plusvalia = 0;
  let plusvaliaMethod = 'No aplicable';
  if (realGain > 0) {
    const selectedBase = Math.min(realBase, objectiveBase);
    plusvalia = selectedBase * (state.plusvaliaRate / 100);
    plusvaliaMethod = realBase <= objectiveBase ? 'Real' : 'Objetivo';
  }

  // Modelo simplificado de IRPF: parte del importe neto de venta después de agencia
  // y plusvalía municipal. No incorpora todos los gastos/mejoras deducibles ni una
  // eventual exención parcial por reinversión.
  const taxableGain = Math.max(0, realGain - plusvalia);
  const irpf = elements.irpfToggle.checked ? 0 : calculateIRPF(taxableGain);

  const netLiquidity = salePrice
    - state.pendMortgage
    - state.cancelCost
    - (state.pendMortgage * state.cancelComm / 100)
    - agencyFee
    - plusvalia
    - irpf;

  return {
    agencyFee,
    realGain,
    objectiveBase,
    realBase,
    plusvalia,
    plusvaliaMethod,
    irpf,
    netLiquidity,
  };
}

function findMinimumSalePrice(requiredLiquidity, state) {
  if (requiredLiquidity <= 0) return { found: true, price: 0, taxes: null };

  let low = 0;
  let high = Math.max(100000, state.pendMortgage + state.cancelCost + 1000, requiredLiquidity + state.pendMortgage + state.cancelCost + 1000);
  const hardCap = 100_000_000;

  while (high < hardCap && calculateSaleTaxes(high, state).netLiquidity < requiredLiquidity) {
    high *= 2;
  }

  if (calculateSaleTaxes(high, state).netLiquidity < requiredLiquidity) {
    return { found: false, price: null, taxes: null };
  }

  // Búsqueda binaria a céntimos: sustituye el bucle incremental de 100 € y evita
  // miles de recálculos por interacción del usuario.
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    if (calculateSaleTaxes(mid, state).netLiquidity >= requiredLiquidity) {
      high = mid;
    } else {
      low = mid;
    }
  }

  const price = Math.ceil(high * 100) / 100;
  return { found: true, price, taxes: calculateSaleTaxes(price, state) };
}

function updateFundingDonut(values, totalNeeded) {
  const safeValues = values.map((value) => Math.max(0, Number.isFinite(value) ? value : 0));
  const total = safeValues.reduce((sum, value) => sum + value, 0);
  const divisor = Math.max(totalNeeded, total, 1);
  const p1 = Math.min(100, safeValues[0] / divisor * 100);
  const p2 = Math.min(100 - p1, safeValues[1] / divisor * 100);
  const p3 = Math.min(100 - p1 - p2, safeValues[2] / divisor * 100);

  elements.donut.style.setProperty('--p1', `${p1}%`);
  elements.donut.style.setProperty('--p2', `${p2}%`);
  elements.donut.style.setProperty('--p3', `${p3}%`);
  elements.donutTotal.textContent = formatCurrency(totalNeeded);
  elements.legendLoan.textContent = formatCurrency(safeValues[0]);
  elements.legendSale.textContent = formatCurrency(safeValues[1]);
  elements.legendSavings.textContent = formatCurrency(safeValues[2]);
}

function setStatus(kind, text) {
  elements.statusBox.className = `status ${kind}`;
  elements.statusBox.textContent = text;
}

function render(state) {
  const totalNeeded = state.buyPrice
    + state.buyPrice * (state.buyItp / 100)
    + state.buyPrice * (state.buyNotary / 100)
    + state.buyReform
    + state.buyExtra;

  const maxQuota = state.income * (state.effort / 100);
  const months = state.years * 12;
  const maxLoanIncome = calculatePrincipalFromPayment(maxQuota, state.rate, months);
  const collateralValue = Math.min(state.buyPrice, state.appraisalPrice);
  const maxLoanLTV = collateralValue * (state.maxLTV / 100);
  const maxMortgage = Math.min(maxLoanIncome, maxLoanLTV);
  const realNewQuota = calculateMonthlyPayment(maxMortgage, state.rate, months);

  const rawRequiredLiquidity = totalNeeded - maxMortgage - state.savings;
  const requiredLiquidity = Math.max(0, rawRequiredLiquidity);
  const sale = findMinimumSalePrice(requiredLiquidity, state);

  const delta = realNewQuota - state.oldQuota;
  elements.effortLabel.textContent = String(state.effort);

  elements.totalNeeded.textContent = formatCurrency(totalNeeded);
  elements.maxQuota.textContent = formatCurrency(maxLoanIncome);
  elements.maxLTV.textContent = formatCurrency(maxLoanLTV);
  elements.maxMortgage.textContent = formatCurrency(maxMortgage);
  elements.pctFinanced.textContent = `${totalNeeded > 0 ? (maxMortgage / totalNeeded * 100).toFixed(1) : '0.0'}%`;
  elements.reqLiquidity.textContent = formatCurrency(requiredLiquidity);
  elements.pendMortgage.textContent = `-${formatCurrency(state.pendMortgage)}`;
  elements.oldQuota.textContent = `${formatCurrency(state.oldQuota)}/mes`;
  elements.realNewQuota.textContent = `${formatCurrency(realNewQuota)}/mes`;
  elements.quotaDelta.textContent = `${delta > 0 ? '+' : ''}${formatCurrency(delta)}/mes`;
  elements.quotaDelta.className = ` ${delta > 0 ? 'negative' : 'positive'}`.trim();

  if (!sale.found) {
    setStatus('danger', '❌ INVIABLE EN EL LÍMITE DE CÁLCULO');
    elements.salePrice.textContent = 'Inviable';
    elements.salePrice.classList.add('danger');
    elements.fees.textContent = '—';
    elements.plusvalia.textContent = '—';
    elements.plusvaliaMethod.textContent = '—';
    elements.irpf.textContent = '—';
    elements.rowIrpf.style.opacity = elements.irpfToggle.checked ? '.35' : '1';
    updateFundingDonut([maxMortgage, 0, Math.min(state.savings, totalNeeded)], totalNeeded);
    return;
  }

  elements.salePrice.classList.remove('danger');

  if (requiredLiquidity <= 0) {
    setStatus('success', '✅ LIQUIDEZ CUBIERTA SIN NECESIDAD DE VENTA');
    elements.salePrice.textContent = 'No requerida';
    elements.fees.textContent = '—';
    elements.plusvalia.textContent = '—';
    elements.plusvaliaMethod.textContent = '—';
    elements.irpf.textContent = '—';
    updateFundingDonut([maxMortgage, 0, Math.min(state.savings, totalNeeded)], totalNeeded);
  } else {
    setStatus('info', '✅ OPERACIÓN FINANCIERAMENTE VIABLE SEGÚN EL MODELO');
    elements.salePrice.textContent = formatCurrency(sale.price);
    const taxes = sale.taxes;
    elements.fees.textContent = `-${formatCurrency(state.cancelCost + state.pendMortgage * state.cancelComm / 100 + taxes.agencyFee)}`;
    elements.plusvalia.textContent = `-${formatCurrency(taxes.plusvalia)}`;
    elements.plusvaliaMethod.textContent = taxes.plusvaliaMethod;
    elements.irpf.textContent = `-${formatCurrency(taxes.irpf)}`;
    elements.rowIrpf.style.opacity = elements.irpfToggle.checked ? '.35' : '1';

    const saleContribution = Math.max(0, taxes.netLiquidity);
    updateFundingDonut([maxMortgage, saleContribution, Math.min(state.savings, totalNeeded)], totalNeeded);
  }
}

function clearResults() {
  const outputIds = [
    'totalNeeded', 'oldQuota', 'realNewQuota', 'maxMortgage', 'maxQuota', 'maxLTV',
    'pctFinanced', 'reqLiquidity', 'pendMortgage', 'fees', 'plusvalia', 'plusvaliaMethod', 'irpf',
  ];
  for (const key of outputIds) elements[key].textContent = '—';
  elements.salePrice.textContent = '—';
  elements.quotaDelta.textContent = '—';
  elements.quotaDelta.className = '';
  updateFundingDonut([0, 0, 0], 0);
}

function calculate() {
  const { state, valid } = getState();
  if (!valid) {
    setStatus('warning', '⚠️ REVISAR DATOS DE ENTRADA');
    elements.salePrice.classList.remove('danger');
    clearResults();
    return;
  }
  render(state);
}

function scheduleCalculate() {
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(calculate);
}

elements.form.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.dataset.key) return;

  const key = target.dataset.key;
  const rule = FIELD_RULES[key];
  if (target.type === 'range') {
    const value = parseFiniteNumber(target.value);
    if (value === null) return;
    setSyncedValue(key, value);
    scheduleCalculate();
    return;
  }

  const value = parseFiniteNumber(target.value);
  if (value === null) {
    showFieldError(key, 'Introduce un número válido.');
    setStatus('warning', '⚠️ REVISAR DATOS DE ENTRADA');
    return;
  }

  if (value < rule.min || value > rule.max) {
    showFieldError(key, `Debe estar entre ${rule.min} y ${rule.max}.`);
    setStatus('warning', '⚠️ REVISAR DATOS DE ENTRADA');
    return;
  }

  const stepped = roundToStep(value, rule.step, rule.min);
  document.getElementById(`${key}Range`).value = String(stepped);
  showFieldError(key);
  scheduleCalculate();
});

elements.form.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.dataset.key) return;
  const key = target.dataset.key;
  const value = parseFiniteNumber(target.value);
  if (value === null) return;
  setSyncedValue(key, value);
  calculate();
});

elements.irpfToggle.addEventListener('change', calculate);

calculate();
