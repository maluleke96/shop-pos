const PrinterUI = {
  connLabel(c) {
    return c === 'usb' ? 'USB' : c === 'bluetooth' ? 'Bluetooth' : 'Network / Wi-Fi';
  },

  connOpts(sel) {
    return ['usb', 'bluetooth', 'network'].map(c =>
      `<option value="${c}" ${sel === c ? 'selected' : ''}>${PrinterUI.connLabel(c)}</option>`
    ).join('');
  },

  selectHtml(printers, selected, emptyLabel = 'No printers detected — connect below first') {
    const list = (printers || []).filter(p => p.name);
    if (!list.length) return `<option value="">${emptyLabel}</option>`;
    return list.map(p =>
      `<option value="${p.name}" ${selected === p.name ? 'selected' : ''}>${p.displayName || p.name} (${PrinterUI.connLabel(p.connectionType || 'usb')})</option>`
    ).join('');
  },

  connectionPanelHtml(connection, statusElId = 'pr-conn-status', kind = 'thermal') {
    const isA4 = kind === 'a4';
    const label = isA4 ? 'A4 office printer' : 'thermal printer';
    const titleUsb = isA4 ? 'USB A4 Printer' : 'USB Thermal Printer';
    const titleBt = isA4 ? 'Bluetooth A4 Printer' : 'Bluetooth Thermal Printer';
    const titleNet = isA4 ? 'Network / Wi-Fi A4 Printer' : 'Network / Wi-Fi Thermal Printer';
    const savedIp = localStorage.getItem('shoppos_network_printer_ip') || '';
    if (connection === 'usb') {
      return `<div class="printer-connect-panel card printer-connect-${kind}" style="margin-top:12px;padding:14px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px">
        <strong>${titleUsb}</strong>
        <p class="muted" style="margin:8px 0 0">Plug in your ${label} via USB, turn it on, then click <strong>Connect USB Printer</strong>. Available printers on this computer will appear in the list above — pick yours and Save.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button type="button" class="btn btn-primary btn-sm" id="pr-usb-connect">Connect USB Printer</button>
          <button type="button" class="btn btn-ghost btn-sm" id="pr-usb-refresh">Refresh list</button>
        </div>
        <div id="${statusElId}" style="margin-top:8px"></div>
      </div>`;
    }
    if (connection === 'bluetooth') {
      return `<div class="printer-connect-panel card printer-connect-${kind}" style="margin-top:12px;padding:14px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px">
        <strong>${titleBt}</strong>
        <p class="muted" style="margin:8px 0 0">Click connect to open Bluetooth settings on this device. Pair your ${label} if needed, then return here — paired printers are detected automatically.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button type="button" class="btn btn-primary btn-sm" id="pr-bt-connect">Connect Bluetooth Printer</button>
          <button type="button" class="btn btn-ghost btn-sm" id="pr-bt-refresh">Refresh list</button>
        </div>
        <div id="${statusElId}" style="margin-top:8px"></div>
      </div>`;
    }
    return `<div class="printer-connect-panel card printer-connect-${kind}" style="margin-top:12px;padding:14px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px">
      <strong>${titleNet}</strong>
      <p class="muted" style="margin:8px 0 0">Enter the printer IP on your Wi-Fi network. Shop POS configures the port on this computer, then selects the printer.</p>
      <div class="form-grid" style="margin-top:8px">
        <div class="field"><label>Printer IP Address</label><input id="pr-net-ip" placeholder="192.168.1.100" value="${savedIp}"></div>
        <div class="field" style="display:flex;align-items:flex-end;gap:8px">
          <button type="button" class="btn btn-primary btn-sm" id="pr-net-connect" style="width:100%">Connect Network Printer</button>
        </div>
      </div>
      <div id="${statusElId}" style="margin-top:8px"></div>
    </div>`;
  },

  setConnStatus(elId, connected, message, count = 0) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = connected
      ? `<span class="tag tag-ok">● Connected</span> <span class="muted">${message}${count ? ` (${count} printer${count !== 1 ? 's' : ''})` : ''}</span>`
      : `<span class="tag tag-out">● Not connected</span> <span class="muted">${message}</span>`;
  },

  async refreshPrinters(connection, printerSelectId, currentPrinter, statusElId) {
    const res = await API.getPrintersByConnection(connection);
    const list = res.data || res || [];
    const printerEl = document.getElementById(printerSelectId);
    if (printerEl) {
      const prev = printerEl.value || currentPrinter;
      printerEl.innerHTML = PrinterUI.selectHtml(list, prev);
      if (!printerEl.value && list.length) printerEl.value = list[0].name;
    }
    PrinterUI.setConnStatus(statusElId, list.length > 0,
      list.length ? 'Printer ready on this computer' : 'No printer found — use Connect button above',
      list.length);
    return list;
  },

  async connectAndSelect(connection, printerSelectId, currentPrinter, statusElId, onSelected) {
    const printerEl = document.getElementById(printerSelectId);
    const ip = document.getElementById('pr-net-ip')?.value?.trim();
    if (connection === 'network' && ip) localStorage.setItem('shoppos_network_printer_ip', ip);
    Utils.toast(`Connecting ${PrinterUI.connLabel(connection)} printer…`, 'info');
    const res = await API.connectPrinter(connection, { ip, printerName: printerEl?.value || currentPrinter });
    if (!res.success) {
      PrinterUI.setConnStatus(statusElId, false, res.error || 'Connection failed');
      Utils.toast(res.error || 'Connection failed', 'error');
      return null;
    }
    const data = res.data || {};
    let list = data.printers || [];
    if (!list.length) {
      const refresh = await API.getPrintersByConnection(connection);
      list = refresh.data || refresh || [];
    }
    if (printerEl) {
      const pick = data.selected || currentPrinter;
      printerEl.innerHTML = PrinterUI.selectHtml(list, pick);
      if (data.selected) printerEl.value = data.selected;
      else if (!printerEl.value && list.length) printerEl.value = list[0].name;
    }
    const selected = printerEl?.value || data.selected;
    PrinterUI.setConnStatus(statusElId, !!selected,
      data.message || (selected ? `Using ${selected}` : 'Connect your printer and try again'),
      list.length);
    if (selected) {
      Utils.toast(data.message || `Connected: ${selected}`, 'success');
      if (typeof onSelected === 'function') onSelected(selected, connection);
    }
    return selected;
  },

  bindConnectionPanel(connection, printerSelectId, currentPrinter, statusElId = 'pr-conn-status', panelContainerId = 'pr-conn-panel', onSelected, kind = 'thermal') {
    const panelEl = document.getElementById(panelContainerId);
    if (panelEl) panelEl.innerHTML = PrinterUI.connectionPanelHtml(connection, statusElId, kind);

    document.getElementById('pr-usb-connect')?.addEventListener('click', async () => {
      await PrinterUI.connectAndSelect('usb', printerSelectId, currentPrinter, statusElId, onSelected);
    });
    document.getElementById('pr-bt-connect')?.addEventListener('click', async () => {
      await PrinterUI.connectAndSelect('bluetooth', printerSelectId, currentPrinter, statusElId, onSelected);
    });
    document.getElementById('pr-net-connect')?.addEventListener('click', async () => {
      await PrinterUI.connectAndSelect('network', printerSelectId, currentPrinter, statusElId, onSelected);
    });
    document.getElementById('pr-usb-refresh')?.addEventListener('click', async () => {
      await PrinterUI.refreshPrinters('usb', printerSelectId, currentPrinter, statusElId);
      Utils.toast('USB printer list refreshed', 'info');
    });
    document.getElementById('pr-bt-refresh')?.addEventListener('click', async () => {
      await PrinterUI.refreshPrinters('bluetooth', printerSelectId, currentPrinter, statusElId);
      Utils.toast('Bluetooth printer list refreshed', 'info');
    });
  },

  async bindConnectionFilter(connSelectId, printerSelectId, currentPrinter, opts = {}) {
    const connEl = document.getElementById(connSelectId);
    if (!connEl) return;
    const statusElId = opts.statusElId || 'pr-conn-status';
    const panelContainerId = opts.panelContainerId || 'pr-conn-panel';
    const onSelected = opts.onSelected;
    const kind = opts.kind || 'thermal';

    const load = async () => {
      const conn = connEl.value || 'usb';
      PrinterUI.bindConnectionPanel(conn, printerSelectId, currentPrinter, statusElId, panelContainerId, onSelected, kind);
      await PrinterUI.refreshPrinters(conn, printerSelectId, currentPrinter, statusElId);
    };
    connEl.onchange = load;
    await load();
  }
};

window.PrinterUI = PrinterUI;
