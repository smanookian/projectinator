(function () {
  'use strict';

  // 1. State
  var state = {
    bill: null,
    tipPercent: null,
    tipAmount: 0,
    total: 0,
    error: '',
    calculated: false
  };

  // 2. DOM refs
  var form = document.getElementById('tip-form');
  var billInput = document.getElementById('bill-amount');
  var tipInput = document.getElementById('tip-percent');
  var formError = document.getElementById('form-error');
  var results = document.getElementById('results');
  var tipAmountEl = document.getElementById('tip-amount');
  var totalAmountEl = document.getElementById('total-amount');
  var status = document.getElementById('status');

  function formatCurrency(n) {
    return '$' + n.toFixed(2);
  }

  // 3. Render
  function render() {
    // Error message
    if (state.error) {
      formError.textContent = state.error;
      formError.classList.remove('is-hidden');
    } else {
      formError.textContent = '';
      formError.classList.add('is-hidden');
    }

    // Input error state
    billInput.classList.toggle('is-error', !!state.error);
    tipInput.classList.toggle('is-error', !!state.error);

    // Results
    if (state.calculated && !state.error) {
      tipAmountEl.textContent = formatCurrency(state.tipAmount);
      totalAmountEl.textContent = formatCurrency(state.total);
      results.classList.remove('is-hidden');
      status.textContent =
        'Tip ' + formatCurrency(state.tipAmount) +
        ' on ' + formatCurrency(state.bill) +
        ' at ' + state.tipPercent + '%.';
    } else {
      results.classList.add('is-hidden');
      if (!state.error) {
        status.textContent = 'Enter a bill amount and tip percentage.';
      } else {
        status.textContent = state.error;
      }
    }
  }

  // Calculation logic
  function calculate() {
    var bill = parseFloat(billInput.value);
    var tip = parseFloat(tipInput.value);

    if (billInput.value.trim() === '' || isNaN(bill) || bill < 0) {
      state.error = 'Please enter a valid bill amount.';
      state.calculated = false;
      render();
      return;
    }
    if (tipInput.value.trim() === '' || isNaN(tip) || tip < 0) {
      state.error = 'Please enter a valid tip percentage.';
      state.calculated = false;
      render();
      return;
    }

    state.error = '';
    state.bill = bill;
    state.tipPercent = tip;
    state.tipAmount = bill * (tip / 100);
    state.total = bill + state.tipAmount;
    state.calculated = true;
    render();
  }

  // 4. Event handlers
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    calculate();
  });

  function clearError() {
    if (state.error) {
      state.error = '';
      render();
    }
  }
  billInput.addEventListener('input', clearError);
  tipInput.addEventListener('input', clearError);

  // 5. Init
  render();
})();
