const Receipt = {
  _settings(settings) {
    const s = settings || {};
    const parse = (v) => {
      if (!v) return {};
      try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return {}; }
    };
    return {
      ...s,
      printer_settings: parse(s.printer_settings),
      receipt_design: parse(s.receipt_design),
      device_settings: { ...(parse(s.device_settings)), ...(Utils.getLocalDeviceSettings?.() || {}) }
    };
  },

  itemLabel(item) {
    let name = item.product_name || '';
    const mods = item.modifiers_text || item.modifiers;
    if (mods) name += ` (${typeof mods === 'string' ? mods : mods.map(m => m.name).join(', ')})`;
    if (item.allergens) name += ` [Allergens: ${item.allergens}]`;
    return name;
  },

  build(sale, settings, docType = 'RECEIPT') {
    const s = Receipt._settings(settings);
    const ps = s.printer_settings || {};
    const rd = s.receipt_design || {};
    const currency = s.currency || 'R';
    const fmt = (n) => `${currency}${Number(n || 0).toFixed(2)}`;
    const title = docType === 'QUOTATION' ? 'QUOTATION' : docType === 'INVOICE' ? 'TAX INVOICE' : 'RECEIPT';
    const taxEnabled = !!s.tax_enabled;
    const taxRatePct = taxEnabled ? (Number(s.tax_rate) || 0) : 0;
    const showItemTax = taxEnabled && taxRatePct > 0 && rd.show_item_tax !== false;

    const items = (sale.items || []).map(i => {
      if (!showItemTax) {
        return `<tr><td>${Receipt.itemLabel(i)}</td><td align="right">${i.quantity}</td><td align="right">${fmt(i.unit_price)}</td><td align="right">${fmt(i.total)}</td></tr>`;
      }
      const br = Utils.itemTaxBreakdown(i.unit_price, i.quantity, taxRatePct, true);
      const detail = `<br><small>excl ${fmt(br.excl / (Number(i.quantity) || 1))} + tax ${fmt(br.tax / (Number(i.quantity) || 1))}</small>`;
      return `<tr><td>${Receipt.itemLabel(i)}${detail}</td><td align="right">${i.quantity}</td><td align="right">${fmt(i.unit_price)}</td><td align="right">${fmt(i.total)}</td></tr>`;
    }).join('');

    const payments = (sale.payments || []).map(p =>
      `<div>${Utils.paymentLabels?.[p.payment_type] || p.payment_type || p.type}: ${fmt(p.amount)}</div>`
    ).join('');

    const logoPath = String(s.logo_path || '').trim();
    const logoOk =
      logoPath &&
      (/^https?:\/\//i.test(logoPath) ||
        /^data:image\//i.test(logoPath) ||
        (logoPath.startsWith('/') && !logoPath.startsWith('//')) ||
        /^\.?\.?\/?assets\//i.test(logoPath));
    const logoSrc = logoOk
      ? (/^https?:\/\//i.test(logoPath) || /^data:/i.test(logoPath) ? logoPath : logoPath.replace(/^file:\/\//i, ''))
      : '';
    const logoHtml =
      ps.print_logo !== false && logoSrc
        ? `<div class="center"><img src="${logoSrc}" style="max-height:48px;margin-bottom:6px" onerror="this.style.display='none'"></div>`
        : '';

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: 'Courier New', monospace; font-size: 12px; max-width: ${s.receipt_width || 80}mm; margin: 0 auto; padding: 8px; }
      .center { text-align: center; }
      .bold { font-weight: bold; }
      table { width: 100%; border-collapse: collapse; margin: 8px 0; }
      td { padding: 2px 0; vertical-align: top; }
      .divider { border-top: 1px dashed #000; margin: 8px 0; }
      .total { font-size: 16px; font-weight: bold; }
      .meta { font-size: 11px; }
    </style></head><body>
      ${logoHtml}
      <div class="center bold" style="font-size:16px">${s.shop_name || 'Shop POS'}</div>
      ${s.address ? `<div class="center meta">${s.address}</div>` : ''}
      ${s.phone ? `<div class="center meta">Tel: ${s.phone}</div>` : ''}
      ${s.email ? `<div class="center meta">${s.email}</div>` : ''}
      ${(ps.print_vat || rd.show_vat) && s.vat_number ? `<div class="center meta">VAT: ${s.vat_number}</div>` : ''}
      <div class="divider"></div>
      <div class="center bold">${title}</div>
      ${sale.order_number ? `<div class="center bold" style="font-size:18px;margin:6px 0">ORDER ${sale.order_number}</div>` : ''}
      <div><strong>Receipt:</strong> ${sale.receipt_number}</div>
      <div><strong>Date:</strong> ${Utils.formatDateTime(sale.created_at || new Date().toISOString())}</div>
      ${(ps.print_cashier !== false) ? `<div><strong>Cashier:</strong> ${sale.cashier_name || '—'}</div>` : ''}
      ${sale.order_type ? `<div><strong>Order:</strong> ${{ delivery: 'Delivery', takeaway: 'Takeaway', sit_in: 'Sit-in', online: 'Online Order' }[sale.order_type] || sale.order_type}</div>` : ''}
      ${sale.table_name ? `<div><strong>Table:</strong> ${sale.table_name}</div>` : ''}
      ${sale.delivery_address ? `<div><strong>Deliver to:</strong> ${sale.delivery_address}</div>` : ''}
      ${sale.customer_name ? `<div><strong>Customer:</strong> ${sale.customer_name}${sale.customer_phone ? ` · ${sale.customer_phone}` : ''}</div>` : ''}
      <div class="divider"></div>
      <table><thead><tr><td><strong>Item</strong></td><td align="right"><strong>Qty</strong></td><td align="right"><strong>Price</strong></td><td align="right"><strong>Total</strong></td></tr></thead><tbody>${items}</tbody></table>
      <div class="divider"></div>
      ${taxEnabled && sale.tax_amount ? `<div>Subtotal (excl. tax): ${fmt(sale.subtotal)}</div>` : `<div>Subtotal: ${fmt(sale.subtotal)}</div>`}
      ${sale.discount ? `<div>Discount: -${fmt(sale.discount)}</div>` : ''}
      ${sale.tax_amount ? `<div>Tax${taxRatePct ? ` (${taxRatePct}%)` : ''}: ${fmt(sale.tax_amount)}</div>` : ''}
      <div class="total">TOTAL: ${fmt(sale.total)}</div>
      ${payments}
      ${sale.amount_paid != null ? `<div>Amount Paid: ${fmt(sale.amount_paid)}</div>` : ''}
      ${sale.change_amount ? `<div>Change: ${fmt(sale.change_amount)}</div>` : ''}
      ${sale.notes ? `<div class="meta">Note: ${sale.notes}</div>` : ''}
      <div class="divider"></div>
      ${s.return_policy && rd.show_return_policy !== false ? `<div class="meta">${s.return_policy}</div><div class="divider"></div>` : ''}
      <div class="center">${s.thank_you_message || s.receipt_footer || 'Thank you for your business!'}</div>
    </body></html>`;
  },

  buildQuote(quote, settings) {
    return Receipt.build({
      ...quote,
      order_number: quote.quote_number,
      receipt_number: quote.quote_number,
      payments: [],
      amount_paid: 0,
      change_amount: 0,
      cashier_name: quote.user_name || '—',
      created_at: quote.created_at || new Date().toISOString()
    }, settings, 'QUOTATION');
  },

  buildQuoteA4(quote, settings) {
    const s = Receipt._settings(settings);
    const currency = s.currency || 'R';
    const fmt = (n) => `${currency}${Number(n || 0).toFixed(2)}`;
    const items = (quote.items || []).map(i =>
      `<tr><td>${Receipt.itemLabel(i)}</td><td align="center">${i.quantity}</td><td align="right">${fmt(i.unit_price)}</td><td align="right">${fmt(i.total)}</td></tr>`
    ).join('');
    const logoHtml = s.logo_path
      ? `<img src="${Utils.fileUrl ? Utils.fileUrl(s.logo_path) : `file://${s.logo_path}`}" style="max-height:64px;margin-bottom:8px">` : '';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @page { size: A4; margin: 18mm; }
      body { font-family: Arial, sans-serif; font-size: 13px; color: #111; max-width: 210mm; margin: 0 auto; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
      .shop h1 { margin: 0 0 6px; font-size: 22px; }
      .meta { color: #444; font-size: 12px; line-height: 1.5; }
      .title { font-size: 20px; font-weight: bold; text-align: right; color: #1e3a5f; }
      table { width: 100%; border-collapse: collapse; margin: 16px 0; }
      th, td { border: 1px solid #ccc; padding: 8px; }
      th { background: #f3f4f6; text-align: left; }
      .totals { width: 280px; margin-left: auto; }
      .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
      .totals .grand { font-size: 18px; font-weight: bold; border-top: 2px solid #111; margin-top: 8px; padding-top: 8px; }
      .footer { margin-top: 32px; font-size: 12px; color: #555; }
    </style></head><body>
      <div class="header">
        <div class="shop">${logoHtml}<h1>${s.shop_name || 'Shop POS'}</h1>
          <div class="meta">${s.address || ''}${s.phone ? `<br>Tel: ${s.phone}` : ''}${s.email ? `<br>${s.email}` : ''}
          ${s.vat_number ? `<br>VAT: ${s.vat_number}` : ''}</div></div>
        <div><div class="title">QUOTATION</div>
          <div class="meta" style="text-align:right;margin-top:8px">
            <strong>Quote No:</strong> ${quote.quote_number}<br>
            <strong>Date:</strong> ${Utils.formatDateTime(quote.created_at || new Date().toISOString())}<br>
            ${quote.valid_until ? `<strong>Valid Until:</strong> ${Utils.formatDate(quote.valid_until)}<br>` : ''}
            <strong>Prepared By:</strong> ${quote.user_name || '—'}
          </div></div>
      </div>
      ${quote.customer_name ? `<p><strong>Customer:</strong> ${quote.customer_name}${quote.customer_phone ? ` · ${quote.customer_phone}` : ''}</p>` : ''}
      <table><thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead><tbody>${items}</tbody></table>
      <div class="totals">
        <div><span>Subtotal</span><span>${fmt(quote.subtotal)}</span></div>
        ${quote.discount ? `<div><span>Discount</span><span>-${fmt(quote.discount)}</span></div>` : ''}
        ${quote.tax_amount ? `<div><span>Tax/VAT</span><span>${fmt(quote.tax_amount)}</span></div>` : ''}
        <div class="grand"><span>TOTAL</span><span>${fmt(quote.total)}</span></div>
      </div>
      ${quote.notes ? `<p><strong>Notes:</strong> ${quote.notes}</p>` : ''}
      <div class="footer">${s.return_policy || ''}<br>${s.receipt_footer || 'This quotation is not a tax invoice until converted to a sale.'}</div>
    </body></html>`;
  },

  async printQuote(quote, settings, format = 'thermal') {
    if (format === 'a4') {
      const html = Receipt.buildQuoteA4(quote, settings);
      return Utils.printToA4(html);
    }
    const html = Receipt.buildQuote(quote, settings);
    const ps = Receipt._settings(settings).printer_settings || {};
    const pr = await API.printReceipt(html, { silent: ps.silent_print, ...Receipt._devicePrintOpts(settings) });
    if (!pr?.success) Utils.toast(pr?.error || 'Print failed — check printer setup', 'error');
    return pr;
  },

  buildQuoteWhatsAppLines(quote, settings) {
    const currency = settings?.currency || 'R';
    const fmt = (n) => `${currency}${Number(n || 0).toFixed(2)}`;
    const lines = (quote.items || []).map(i =>
      `• ${i.quantity}x ${Receipt.itemLabel(i)} — ${fmt(i.total)}`
    );
    if (Number(quote.discount) > 0) lines.push(`Discount: −${fmt(quote.discount)}`);
    if (Number(quote.tax_amount) > 0) lines.push(`Tax: ${fmt(quote.tax_amount)}`);
    lines.push(`TOTAL: ${fmt(quote.total)}`);
    return lines.join('\n');
  },

  async downloadQuotePdf(quote, settings) {
    const id = quote?.id;
    if (id && API.getQuotePdf) {
      const buf = await API.getQuotePdf(id);
      if (buf?.success && buf.data) {
        await Utils.savePdfBuffer(`${quote.quote_number || 'quote'}.pdf`, buf);
        return buf;
      }
    }
    const currency = settings?.currency || 'R';
    const fmt = (n) => `${currency}${Number(n || 0).toFixed(2)}`;
    const headers = ['Item', 'Qty', 'Unit Price', 'Total'];
    const rows = (quote.items || []).map(i => [Receipt.itemLabel(i), String(i.quantity), fmt(i.unit_price), fmt(i.total)]);
    rows.push(['', '', 'Subtotal', fmt(quote.subtotal)]);
    if (Number(quote.discount) > 0) rows.push(['', '', 'Discount', fmt(quote.discount)]);
    if (Number(quote.tax_amount) > 0) rows.push(['', '', 'Tax', fmt(quote.tax_amount)]);
    rows.push(['', '', 'TOTAL', fmt(quote.total)]);
    if (quote.customer_name) rows.push(['', '', 'Customer', `${quote.customer_name}${quote.customer_phone ? ` (${quote.customer_phone})` : ''}`]);
    if (quote.valid_until) rows.push(['', '', 'Valid Until', quote.valid_until]);
    if (quote.user_name) rows.push(['', '', 'Prepared By', quote.user_name]);
    if (quote.notes) rows.push(['', '', 'Notes', quote.notes]);
    const company = {
      ...Utils.companyInfo(settings),
      dateRange: quote.created_at ? `Quote date: ${Utils.formatDateTime(quote.created_at)}` : undefined
    };
    await Export.toPDF(`${quote.quote_number || 'quote'}.pdf`, `Quotation ${quote.quote_number || ''}`, headers, rows, company);
  },

  buildInvoice(sale, settings) {
    return Receipt.build(sale, settings, 'INVOICE');
  },

  buildKitchenTicket(sale, items, settings) {
    const s = Receipt._settings(settings);
    const width = s.device_settings?.paper_size || s.printer_settings?.paper_size || '80mm';
    const w = width === '58mm' ? '58mm' : '80mm';
    const lines = (items || []).map(i => {
      const label = (() => {
        let name = i.product_name || '';
        const mods = i.modifiers_text || i.modifiers;
        if (mods) name += ` (${typeof mods === 'string' ? mods : mods.map(m => m.name).join(', ')})`;
        return name;
      })();
      return `<div style="padding:8px 0;border-bottom:2px dashed #000;font-size:16px"><strong>${i.quantity}x ${label}</strong>${i.allergens ? `<div style="font-size:12px">Allergens: ${i.allergens}</div>` : ''}</div>`;
    }).join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:'Courier New',monospace;font-size:14px;max-width:${w};margin:0 auto;padding:8px}
      .center{text-align:center}.bold{font-weight:bold;font-size:18px}
    </style></head><body>
      <div class="center bold">🍳 KITCHEN ORDER</div>
      <div class="center">${s.shop_name || ''}</div>
      <div class="center bold" style="font-size:20px;margin:8px 0">${sale.order_number || sale.receipt_number}</div>
      <div><strong>Receipt:</strong> ${sale.receipt_number}</div>
      <div><strong>Time:</strong> ${Utils.formatDateTime(sale.created_at || new Date().toISOString())}</div>
      <div><strong>Cashier:</strong> ${sale.cashier_name || '—'}</div>
      ${sale.customer_name ? `<div><strong>Customer:</strong> ${sale.customer_name}</div>` : ''}
      ${sale.order_type === 'delivery' && sale.delivery_address ? `<div><strong>Deliver to:</strong> ${sale.delivery_address}</div>` : ''}
      <hr>${lines || '<p>No food items</p>'}
      <div class="center" style="margin-top:12px">--- PREPARE ---</div>
    </body></html>`;
  },

  isKitchenItem(item) {
    const t = (item.item_type || '').toLowerCase();
    return ['food', 'drink', 'combo', 'side'].includes(t);
  },

  _devicePrintOpts(settings) {
    const s = Receipt._settings(settings);
    const ps = s.printer_settings || {};
    const ds = s.device_settings || {};
    return {
      receiptPrinter: ps.receipt_printer || ds.receipt_printer || undefined,
      kitchenPrinter: ps.kitchen_printer || ds.kitchen_printer || undefined,
      paperSize: ps.paper_size || ds.paper_size || undefined
    };
  },

  async printKitchen(sale, items, settings) {
    const html = Receipt.buildKitchenTicket(sale, items, settings);
    return API.printKitchen(html, Receipt._devicePrintOpts(settings));
  },

  async print(sale, settings, docType) {
    const html = Receipt.build(sale, settings, docType);
    const ps = Receipt._settings(settings).printer_settings || {};
    if (docType === 'INVOICE') {
      await Utils.printToA4(html);
    } else {
      await API.printReceipt(html, { silent: ps.silent_print, ...Receipt._devicePrintOpts(settings) });
    }
  },

  buildWhatsAppLines(sale, settings) {
    const currency = settings?.currency || 'R';
    const fmt = (n) => `${currency}${Number(n || 0).toFixed(2)}`;
    const head = [];
    if (sale.order_number) head.push(`Order: ${sale.order_number}`);
    if (sale.receipt_number) head.push(`Receipt: ${sale.receipt_number}`);
    if (sale.order_type) {
      head.push(`Type: ${{ delivery: 'Delivery', takeaway: 'Takeaway', sit_in: 'Sit-in' }[sale.order_type] || sale.order_type}`);
    }
    if (sale.delivery_address) head.push(`📍 Deliver to: ${sale.delivery_address}`);
    if (sale.table_name) head.push(`Table: ${sale.table_name}`);
    const lines = (sale.items || []).map(i =>
      `• ${i.quantity}x ${Receipt.itemLabel(i)} — ${fmt(i.total)}`
    );
    if (sale.discount > 0) lines.push(`Discount: −${fmt(sale.discount)}`);
    if (sale.tax_amount > 0) lines.push(`Tax: ${fmt(sale.tax_amount)}`);
    lines.push(`TOTAL: ${fmt(sale.total)}`);
    if (sale.change_amount > 0) lines.push(`Change: ${fmt(sale.change_amount)}`);
    return [...head, ...lines].join('\n');
  },

  buildLayby(layby, settings) {
    const s = Receipt._settings(settings);
    const currency = s.currency || 'R';
    const fmt = (n) => `${currency}${Number(n || 0).toFixed(2)}`;
    const items = (layby.items || []).map(i =>
      `<tr><td>${i.product_name}</td><td align="right">${i.quantity}</td><td align="right">${fmt(i.unit_price)}</td><td align="right">${fmt(i.total)}</td></tr>`
    ).join('');
    const pays = (layby.payments || []).map(p =>
      `<div>${p.payment_type || 'cash'}: ${fmt(p.amount)} · ${Utils.formatDateTime(p.created_at)}</div>`
    ).join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:'Courier New',monospace;font-size:12px;max-width:${s.receipt_width||80}mm;margin:0 auto;padding:8px}
      .center{text-align:center}.bold{font-weight:bold}.divider{border-top:1px dashed #000;margin:8px 0}
      table{width:100%;border-collapse:collapse}td{padding:2px 0}
    </style></head><body>
      <div class="center bold" style="font-size:16px">${s.shop_name || 'Shop POS'}</div>
      <div class="center bold">LAY-BYE RECEIPT</div>
      <div class="divider"></div>
      <div><strong>Lay-Bye #:</strong> ${layby.layby_number}</div>
      <div><strong>Customer:</strong> ${layby.customer_name || '—'}${layby.customer_phone ? ` · ${layby.customer_phone}` : ''}</div>
      <div><strong>Date:</strong> ${Utils.formatDateTime(layby.created_at || new Date().toISOString())}</div>
      ${layby.expires_at ? `<div><strong>Pay by:</strong> ${String(layby.expires_at).slice(0, 10)}</div>` : ''}
      <div class="divider"></div>
      <table><tbody>${items}</tbody></table>
      <div class="divider"></div>
      <div>Total: ${fmt(layby.total)}</div>
      <div>Paid: ${fmt(layby.amount_paid)}</div>
      <div class="bold">Balance due: ${fmt(layby.balance)}</div>
      <div class="divider"></div>
      <div class="bold">Payments</div>
      ${pays || '<div class="muted">None yet</div>'}
      <div class="divider"></div>
      <div class="center">${s.thank_you_message || s.receipt_footer || 'Thank you!'}</div>
    </body></html>`;
  },

  buildLaybyWhatsApp(layby, settings) {
    const currency = settings?.currency || 'R';
    const fmt = (n) => `${currency}${Number(n || 0).toFixed(2)}`;
    const items = (layby.items || []).map(i => `• ${i.quantity}x ${i.product_name} — ${fmt(i.total)}`).join('\n');
    return [
      `Lay-Bye ${layby.layby_number}`,
      layby.customer_name ? `Customer: ${layby.customer_name}` : null,
      layby.expires_at ? `Pay by: ${String(layby.expires_at).slice(0, 10)}` : null,
      items,
      `Total: ${fmt(layby.total)}`,
      `Paid: ${fmt(layby.amount_paid)}`,
      `Balance: ${fmt(layby.balance)}`,
      `Status: ${layby.status}`
    ].filter(Boolean).join('\n');
  },

  async downloadPdf(sale, settings, docType = 'RECEIPT') {
    const currency = settings?.currency || 'R';
    const fmt = (n) => `${currency}${Number(n || 0).toFixed(2)}`;
    const title = docType === 'INVOICE' ? `Invoice ${sale.receipt_number}` : `Receipt ${sale.receipt_number}`;
    const headers = ['Item', 'Qty', 'Price', 'Total'];
    const rows = (sale.items || []).map(i => [Receipt.itemLabel(i), String(i.quantity), fmt(i.unit_price), fmt(i.total)]);
    rows.push(['', '', 'Subtotal', fmt(sale.subtotal)]);
    if (sale.discount) rows.push(['', '', 'Discount', fmt(sale.discount)]);
    if (sale.tax_amount) rows.push(['', '', 'Tax', fmt(sale.tax_amount)]);
    rows.push(['', '', 'TOTAL', fmt(sale.total)]);
    if (sale.cashier_name) rows.push(['', '', 'Cashier', sale.cashier_name]);
    if (sale.customer_name) rows.push(['', '', 'Customer', sale.customer_name]);
    if (sale.order_type) rows.push(['', '', 'Order type', ({ delivery: 'Delivery', takeaway: 'Takeaway', sit_in: 'Sit-in' })[sale.order_type] || sale.order_type]);
    if (sale.delivery_address) rows.push(['', '', 'Deliver to', sale.delivery_address]);
    if (sale.amount_paid != null) rows.push(['', '', 'Paid', fmt(sale.amount_paid)]);
    if (sale.change_amount) rows.push(['', '', 'Change', fmt(sale.change_amount)]);
    await Export.toPDF(`${sale.receipt_number}.pdf`, title, headers, rows, Utils.companyInfo(settings));
    Utils.toast('PDF saved', 'success');
  }
};
window.Receipt = Receipt;
