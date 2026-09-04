const PaymentUI = {
  enabledTypes(settings) {
    const pm = settings?.payment_settings || {};
    const as = settings?.account_settings || {};
    let types = Utils.paymentTypes;
    if (pm.enabled_methods?.length) types = types.filter(t => pm.enabled_methods.includes(t));
    if (pm.giftcard_enabled === false) types = types.filter(t => t !== 'giftcard');
    if (pm.account_enabled === false || as.enabled === false) types = types.filter(t => t !== 'account');
    if (pm.eft_enabled === false) types = types.filter(t => t !== 'eft');
    const custom = (pm.custom_methods || []).filter(m => m.enabled !== false && m.id && m.label);
    types = [...types, ...custom.map(m => m.id)];
    return types.length ? types : ['cash'];
  },

  labels(settings) {
    const pm = settings?.payment_settings || {};
    const customLabels = {};
    for (const m of pm.custom_methods || []) {
      if (m.id && m.label) customLabels[m.id] = m.label;
    }
    return { ...Utils.paymentLabels, ...(pm.custom_labels || {}), ...customLabels };
  },

  open(options = {}) {
    const {
      total,
      currency = 'R',
      settings = {},
      customer = null,
      allowMixed = true,
      allowPartial = false,
      title = 'Complete Payment',
      confirmLabel = 'Complete Sale',
      onConfirm,
      gcBalancesRef = {},
      onAddCustomer,
      onDismiss
    } = options;

    const types = PaymentUI.enabledTypes(settings);
    const labels = PaymentUI.labels(settings);
    const payments = [];
    let selectedType = types.includes('cash') ? 'cash' : types[0];
    const ls = settings?.loyalty_settings || {};
    const loyaltyEnabled = ls.enabled !== false && !!customer;
    const customerPoints = Math.floor(customer?.loyalty_points || 0);
    const pointValue = Utils.loyaltyPointValue(settings);
    const maxRedeemPoints = loyaltyEnabled
      ? Utils.loyaltyMaxRedeemPoints(total, customerPoints, settings)
      : 0;
    let loyaltyRedeemPoints = 0;

    const getLoyaltyDiscount = () => Utils.loyaltyRedeemDiscount(loyaltyRedeemPoints, settings);
    const getAmountDue = () => Math.max(0, total - getLoyaltyDiscount());
    const getPaid = () => payments.reduce((s, p) => s + p.amount, 0);
    const getRemainingDue = () => Math.max(0, getAmountDue() - getPaid());

    const getGiftCardUsed = (code) => {
      if (!code) return 0;
      return payments
        .filter(p => p.type === 'giftcard' && p.gift_card_code === code)
        .reduce((s, p) => s + p.amount, 0);
    };

    const getAvailableGiftCardBalance = (code) => {
      const bal = gcBalancesRef[code];
      if (bal == null) return null;
      return Math.max(0, bal - getGiftCardUsed(code));
    };

    const nextNonGiftCardType = () => {
      const alt = types.find(t => t !== 'giftcard');
      return alt || 'cash';
    };

    const selectPaymentType = (type) => {
      selectedType = type;
      document.querySelectorAll('.pay-btn').forEach(b => {
        b.classList.toggle('selected', b.dataset.type === type);
      });
      updateExtra();
    };

    const setGiftCardAmount = (code) => {
      const amtEl = document.getElementById('pay-amount');
      if (!amtEl || !code) return;
      const available = getAvailableGiftCardBalance(code);
      if (available == null) return;
      const suggested = Math.min(getRemainingDue(), available);
      amtEl.value = suggested.toFixed(2);
      updateGiftCardHelper(code);
    };

    const updateGiftCardHelper = (code) => {
      const helper = document.getElementById('pay-gc-helper');
      if (!helper) return;
      const gcCode = code || document.getElementById('pay-gc-code')?.value.trim();
      if (!gcCode || gcBalancesRef[gcCode] == null) {
        helper.textContent = '';
        return;
      }
      const balance = gcBalancesRef[gcCode];
      const available = getAvailableGiftCardBalance(gcCode);
      const remaining = getRemainingDue();
      let text = `Card balance: ${Utils.formatMoney(balance, currency)} · Remaining due: ${Utils.formatMoney(remaining, currency)}`;
      if (available < remaining - 0.01) {
        text += ` · Add another payment method for the remaining ${Utils.formatMoney(remaining - available, currency)}`;
      }
      helper.textContent = text;
    };

    const renderPayRows = () => {
      const paid = payments.reduce((s, p) => s + p.amount, 0);
      const due = getAmountDue();
      const remaining = Math.max(0, due - paid);
      const rowsEl = document.getElementById('pay-rows');
      const summaryEl = document.getElementById('pay-summary');
      const confirmBtn = document.getElementById('confirm-pay');
      if (!rowsEl) return;
      rowsEl.innerHTML = payments.length
        ? payments.map((p, i) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
            <span>${labels[p.type] || p.type}${p.gift_card_code ? ` (${p.gift_card_code})` : ''}</span>
            <span>${Utils.formatMoney(p.amount, currency)} <button type="button" class="btn btn-sm btn-ghost rm-pay" data-i="${i}">×</button></span></div>`).join('')
        : '<p class="muted">No payments added — full amount will use selected method below</p>';
      const loyaltyLine = loyaltyRedeemPoints > 0
        ? `<div style="color:var(--primary)">Points redeemed: −${Utils.formatMoney(getLoyaltyDiscount(), currency)}</div>`
        : '';
      summaryEl.innerHTML = `
        <div>Subtotal: <strong>${Utils.formatMoney(total, currency)}</strong></div>
        ${loyaltyLine}
        <div>Amount due: <strong>${Utils.formatMoney(due, currency)}</strong></div>
        <div>Paid: ${Utils.formatMoney(paid, currency)} · Remaining: ${Utils.formatMoney(remaining, currency)}</div>
        ${allowPartial ? '<div class="muted" style="font-size:12px;margin-top:4px">Partial payments allowed — enter any amount up to the balance.</div>' : ''}`;
      if (confirmBtn) confirmBtn.disabled = false;
      if (selectedType === 'giftcard') {
        updateGiftCardHelper(document.getElementById('pay-gc-code')?.value.trim());
      }
    };

    const updateLoyaltyUi = () => {
      const input = document.getElementById('pay-loyalty');
      const info = document.getElementById('pay-loyalty-info');
      const discountEl = document.getElementById('pay-loyalty-discount');
      if (!input) return;
      loyaltyRedeemPoints = Math.min(
        Math.max(0, parseInt(input.value) || 0),
        maxRedeemPoints
      );
      input.value = loyaltyRedeemPoints;
      const discount = getLoyaltyDiscount();
      if (info) {
        info.textContent = loyaltyRedeemPoints > 0
          ? `Saves ${Utils.formatMoney(discount, currency)} on this sale`
          : `Each point = ${Utils.formatMoney(pointValue, currency)}`;
      }
      if (discountEl) {
        discountEl.textContent = loyaltyRedeemPoints > 0
          ? `−${Utils.formatMoney(discount, currency)}`
          : Utils.formatMoney(0, currency);
      }
      const dueDisplay = document.getElementById('pay-due-display');
      if (dueDisplay) dueDisplay.textContent = `Amount due: ${Utils.formatMoney(getAmountDue(), currency)}`;
      renderPayRows();
      updateExtra();
    };

    const updateExtra = async () => {
      const extra = document.getElementById('pay-extra-fields');
      if (!extra) return;
      if (selectedType === 'giftcard') {
        extra.innerHTML = `<div class="field"><label>Gift Card Code</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="pay-gc-code" placeholder="GC-..." style="flex:1;min-width:140px">
            <button type="button" class="btn btn-ghost" id="pay-gc-check">Check Balance</button>
            <button type="button" class="btn btn-ghost btn-sm" id="pay-gc-full">Use full card balance</button>
          </div>
          <div id="pay-gc-balance" class="muted" style="margin-top:6px;font-size:13px"></div>
          <div id="pay-gc-helper" class="muted" style="margin-top:4px;font-size:12px"></div></div>`;
        const gcCodeInput = document.getElementById('pay-gc-code');
        const runGiftCardCheck = async () => {
          const code = gcCodeInput?.value.trim();
          if (!code) return Utils.toast('Enter gift card code', 'error');
          const r = await API.checkGiftCard(code);
          const balEl = document.getElementById('pay-gc-balance');
          if (!r.success) {
            balEl.innerHTML = `<span style="color:var(--danger)">${r.error}</span>`;
            updateGiftCardHelper('');
            return;
          }
          const status = r.data.display_status || r.data.status;
          if (status === 'expired') {
            balEl.innerHTML = `<span style="color:var(--danger)">This gift card has expired</span>`;
            updateGiftCardHelper('');
            return;
          }
          gcBalancesRef[code] = r.data.balance;
          balEl.innerHTML = `✓ Code <strong>${Utils.escHtml(code)}</strong> · Balance: <strong>${Utils.formatMoney(r.data.balance, currency)}</strong> · ${status}`;
          setGiftCardAmount(code);
        };
        document.getElementById('pay-gc-check')?.addEventListener('click', runGiftCardCheck);
        document.getElementById('pay-gc-full')?.addEventListener('click', () => {
          const code = gcCodeInput?.value.trim();
          if (!code) return Utils.toast('Enter gift card code', 'error');
          if (gcBalancesRef[code] == null) return Utils.toast('Check gift card balance first', 'error');
          const available = getAvailableGiftCardBalance(code);
          const amtEl = document.getElementById('pay-amount');
          if (amtEl && available != null) amtEl.value = available.toFixed(2);
          updateGiftCardHelper(code);
        });
        gcCodeInput?.addEventListener('input', () => updateGiftCardHelper(gcCodeInput.value.trim()));
        updateGiftCardHelper(gcCodeInput?.value.trim());
      } else if (selectedType === 'account') {
        const check = customer ? await API.validateOnAccount(customer.id, getAmountDue()) : null;
        if (!customer) {
          extra.innerHTML = '<p style="color:var(--danger)">Select a customer first for On Account payment</p>';
        } else if (check?.data && !check.data.ok) {
          extra.innerHTML = `<p style="color:var(--danger)">${check.data.error}</p>`;
        } else if (check && !check.success) {
          extra.innerHTML = `<p style="color:var(--danger)">${check.error || 'Cannot use On Account'}</p>`;
        } else {
          const bal = customer.balance || 0;
          const limit = check?.data?.limit;
          extra.innerHTML = `<p class="muted">Charging to: <strong>${customer.name}</strong><br>
            Balance: ${Utils.formatMoney(bal, currency)}${limit > 0 ? ` · Credit limit: ${Utils.formatMoney(limit, currency)}` : ''}</p>`;
        }
      } else extra.innerHTML = '';
      const amtEl = document.getElementById('pay-amount');
      if (amtEl) {
        const remaining = getRemainingDue();
        if (selectedType === 'giftcard') {
          const code = document.getElementById('pay-gc-code')?.value.trim();
          const available = code ? getAvailableGiftCardBalance(code) : null;
          amtEl.value = (available != null ? Math.min(remaining, available) : remaining).toFixed(2);
        } else {
          amtEl.value = remaining.toFixed(2);
        }
      }
    };

    const pointsValue = Utils.loyaltyPointsValue(customerPoints, settings, currency);

    Utils.showModal(title, `
      <div style="text-align:center;font-size:28px;font-weight:700;margin-bottom:4px" id="pay-total-display">${Utils.formatMoney(total, currency)}</div>
      <div id="pay-due-display" class="muted" style="text-align:center;margin-bottom:12px;font-size:14px"></div>
      ${allowMixed !== false ? '<p class="muted" style="text-align:center;margin-bottom:8px">Add multiple payments — e.g. R20 Card + R40 Cash</p>' : ''}
      <div class="payment-methods" id="pay-methods">
        ${types.map(t => `<button type="button" class="pay-btn${t === selectedType ? ' selected' : ''}" data-type="${t}">${labels[t]}</button>`).join('')}
      </div>
      <div id="pay-extra-fields"></div>
      <div class="form-grid" style="margin-top:12px">
        <div class="field"><label>Amount</label><input type="number" id="pay-amount" step="0.01" value="${total.toFixed(2)}"></div>
        <div class="field" style="display:flex;align-items:flex-end"><button type="button" class="btn btn-primary" id="add-pay" style="width:100%">+ Add Payment</button></div>
      </div>
      <div id="pay-rows" style="margin-top:12px"></div>
      <div id="pay-summary" style="margin-top:8px;font-weight:600"></div>
      ${customer ? `<div class="loyalty-pay-box" style="margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:10px;background:var(--bg-secondary)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div><strong>${customer.name}</strong>${customer.phone ? `<br><small class="muted">${customer.phone}</small>` : ''}</div>
          <div style="text-align:right"><span style="font-size:18px;font-weight:700;color:var(--primary)">⭐ ${customerPoints}</span>
            <br><small class="muted">= ${pointsValue.formatted}</small></div>
        </div>
        ${loyaltyEnabled && maxRedeemPoints > 0 ? `
          <div class="field" style="margin-top:10px;margin-bottom:0">
            <label>Use points (max ${maxRedeemPoints})</label>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <input type="number" id="pay-loyalty" min="0" max="${maxRedeemPoints}" value="0" style="flex:1;min-width:100px">
              <button type="button" class="btn btn-ghost btn-sm" id="pay-loyalty-max">Use all</button>
              <strong id="pay-loyalty-discount" style="color:var(--primary)">${Utils.formatMoney(0, currency)}</strong>
            </div>
            <small id="pay-loyalty-info" class="muted">Each point = ${Utils.formatMoney(pointValue, currency)}</small>
          </div>` : loyaltyEnabled
          ? `<p class="muted" style="margin:10px 0 0;font-size:13px">No points available to redeem on this sale.</p>`
          : `<p class="muted" style="margin:10px 0 0;font-size:13px">Loyalty points are disabled in Admin settings.</p>`}
      </div>` : `
        <button type="button" class="btn btn-ghost btn-sm" id="pay-add-customer" style="margin-top:8px">+ Add Customer (to earn/redeem points)</button>`}`,
      `<button type="button" class="btn btn-success btn-lg" id="confirm-pay" style="min-width:200px">${confirmLabel}</button>`);

    const dismissedOnce = { done: false };
    const dismissOnce = () => {
      if (dismissedOnce.done) return;
      dismissedOnce.done = true;
      try { onDismiss?.(); } catch (_) { /* ignore */ }
    };
    document.getElementById('modal-close')?.addEventListener('click', dismissOnce, { once: true });
    document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) dismissOnce();
    }, { once: true });

    const dueDisplay = document.getElementById('pay-due-display');
    if (dueDisplay) dueDisplay.textContent = `Amount due: ${Utils.formatMoney(total, currency)}`;

    document.getElementById('pay-add-customer')?.addEventListener('click', () => {
      if (onAddCustomer) onAddCustomer();
    });

    document.getElementById('pay-loyalty')?.addEventListener('input', updateLoyaltyUi);
    document.getElementById('pay-loyalty-max')?.addEventListener('click', () => {
      const input = document.getElementById('pay-loyalty');
      if (input) input.value = maxRedeemPoints;
      updateLoyaltyUi();
    });

    document.getElementById('pay-methods').addEventListener('click', (e) => {
      const btn = e.target.closest('.pay-btn');
      if (!btn) return;
      selectPaymentType(btn.dataset.type);
    });

    const validateGiftCardPayment = (payment) => {
      if (payment.type !== 'giftcard') return null;
      const code = payment.gift_card_code;
      if (!code) return 'Enter gift card code';
      if (gcBalancesRef[code] == null) return 'Check gift card balance first';
      const available = getAvailableGiftCardBalance(code);
      if (payment.amount > available + 0.01) {
        return `Insufficient gift card balance (${Utils.formatMoney(Math.max(0, available), currency)} available)`;
      }
      return null;
    };

    document.getElementById('add-pay')?.addEventListener('click', () => {
      if (selectedType === 'account' && !customer) return Utils.toast('Select a customer for On Account', 'error');
      const amount = parseFloat(document.getElementById('pay-amount').value) || 0;
      if (amount <= 0) return Utils.toast('Enter amount', 'error');
      const payment = { type: selectedType, amount };
      if (selectedType === 'giftcard') {
        payment.gift_card_code = document.getElementById('pay-gc-code')?.value.trim();
        if (!payment.gift_card_code) return Utils.toast('Enter gift card code', 'error');
        const err = validateGiftCardPayment({ ...payment, amount });
        if (err) return Utils.toast(err, 'error');
      }
      payments.push(payment);
      renderPayRows();
      const remainingAfter = getRemainingDue();
      if (selectedType === 'giftcard' && remainingAfter > 0.01) {
        selectPaymentType(nextNonGiftCardType());
        const amtEl = document.getElementById('pay-amount');
        if (amtEl) amtEl.value = remainingAfter.toFixed(2);
        Utils.toast(`Gift card applied — add ${Utils.formatMoney(remainingAfter, currency)} via another method`, 'info');
      } else {
        updateExtra();
      }
    });

    document.getElementById('pay-rows')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.rm-pay');
      if (!btn) return;
      payments.splice(parseInt(btn.dataset.i), 1);
      renderPayRows();
      updateExtra();
    });

    const confirmBtn = document.getElementById('confirm-pay');
    if (!confirmBtn) {
      Utils.toast('Payment dialog failed to load — please close and try Pay again', 'error');
      return;
    }
    confirmBtn.addEventListener('click', async () => {
      if (typeof onConfirm !== 'function') {
        Utils.toast('Payment handler missing — restart the app', 'error');
        return;
      }
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Processing…';
      try {
        updateLoyaltyUi();
        const amountDue = getAmountDue();
        if (selectedType === 'account' && !customer) throw new Error('Select a customer for On Account');
        if (selectedType === 'account' && customer) {
          const chk = await API.validateOnAccount(customer.id, amountDue);
          if (!chk.success || !chk.data?.ok) throw new Error(chk.data?.error || chk.error || 'Customer not approved for On Account');
        }
        let finalPayments = [...payments];
        if (!finalPayments.length) {
          const amount = parseFloat(document.getElementById('pay-amount')?.value) || amountDue;
          if (selectedType === 'account' && !customer) throw new Error('Select a customer for On Account');
          if (selectedType === 'giftcard') {
            const code = document.getElementById('pay-gc-code')?.value.trim();
            if (!code) throw new Error('Enter gift card code');
            if (gcBalancesRef[code] == null) throw new Error('Check gift card balance first');
            if (amount > getAvailableGiftCardBalance(code) + 0.01) {
              throw new Error(`Insufficient gift card balance (${Utils.formatMoney(getAvailableGiftCardBalance(code), currency)} available)`);
            }
            finalPayments.push({ type: 'giftcard', amount, gift_card_code: code });
          } else {
            finalPayments.push({ type: selectedType, amount });
          }
        }
        const gcRunning = {};
        for (const p of finalPayments) {
          if (p.type !== 'giftcard') continue;
          const code = p.gift_card_code;
          if (!code) throw new Error('Gift card payment missing code');
          if (gcBalancesRef[code] == null) throw new Error('Check gift card balance first');
          gcRunning[code] = gcRunning[code] || 0;
          const available = gcBalancesRef[code] - gcRunning[code];
          if (p.amount > available + 0.01) {
            throw new Error(`Insufficient gift card balance (${Utils.formatMoney(Math.max(0, available), currency)} available on ${code})`);
          }
          gcRunning[code] += p.amount;
        }
        const paid = finalPayments.reduce((s, p) => s + p.amount, 0);
        if (!allowPartial && paid < amountDue - 0.01) {
          throw new Error(`Payment incomplete — ${Utils.formatMoney(amountDue - paid, currency)} still due`);
        }
        if (allowPartial && paid <= 0) {
          throw new Error('Enter a payment amount greater than zero');
        }
        if (allowPartial && paid > amountDue + 0.01) {
          throw new Error(`Payment exceeds amount owing (${Utils.formatMoney(amountDue, currency)})`);
        }
        const nonCash = finalPayments.filter(p => p.type !== 'cash').reduce((s, p) => s + p.amount, 0);
        const cashTotal = finalPayments.filter(p => p.type === 'cash').reduce((s, p) => s + p.amount, 0);
        const change = Math.max(0, cashTotal - Math.max(0, amountDue - nonCash));
        const loyaltyDiscount = getLoyaltyDiscount();
        await onConfirm({
          payments: finalPayments,
          paid,
          change,
          loyaltyRedeem: loyaltyRedeemPoints,
          loyaltyDiscount,
          amountDue
        });
        dismissOnce();
      } catch (err) {
        Utils.toast(err.message || 'Payment failed', 'error');
      } finally {
        if (document.getElementById('confirm-pay') === confirmBtn && !document.getElementById('modal-overlay')?.classList.contains('hidden')) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = confirmLabel;
        }
      }
    });

    updateExtra();
    renderPayRows();
  }
};

window.PaymentUI = PaymentUI;
