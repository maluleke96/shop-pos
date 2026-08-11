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

  connectionPanelHtml(connection, statusElId = 'pr-conn-status') {
    const savedIp = localStorage.getItem('shoppos_network_printer_ip') || '';
    if (connection === 'usb') {
      return `<div class="printer-connect-panel card" style="margin-top:12px;padding:12px;background:var(--bg-secondary)">
        <strong>USB Thermal Printer</strong>
        <p class="muted" style="margin:8px 0 0">Plug in your printer via USB, turn it on, then click <strong>Connect USB Printer</strong>. Windows will detect it on this PC or tablet.</p>
        <button type="button" class="btn btn-primary btn-sm" id="pr-usb-connect" style="margin-top:10px">Connect USB Printer</button>
        <div id="${statusElId}" style="margin-top:8px"></div>
      </div>`;
    }
    if (connection === 'bluetooth') {
      return `<div class="printer-connect-panel card" style="margin-top:12px;padding:12px;background:var(--bg-secondary)">
        <strong>Bluetooth Thermal Printer</strong>
        <p class="muted" style="margin:8px 0 0">Click connect to open Windows Bluetooth on this device. Pair your printer if needed — saved paired devices are detected automatically.</p>
        <button type="button" class="btn btn-primary btn-sm" id="pr-bt-connect" style="margin-top:10px">Connect Bluetooth Printer</button>
        <div id="${statusElId}" style="margin-top:8px"></div>
      </div>`;
    }
    return `<div class="printer-connect-panel card" style="margin-top:12px;padding:12px;background:var(--bg-secondary)">
      <strong>Network / Wi-Fi Thermal Printer</strong>
      <p class="muted" style="margin:8px 0 0">Enter the printer IP on your Wi-Fi network. Shop POS configures the port on this computer, then selects the printer for receipts.</p>
      <div class="form-grid" style="margin-top:8px">
        <div class="field"><label>Printer IP Address</label><input id="pr-net-ip" placeholder="192.168.1.100" value="${savedIp}"></div>
        <div class="field" style="display:flex;align-items:flex-end">
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

  bindConnectionPanel(connection, printerSelectId, currentPrinter, statusElId = 'pr-conn-status', panelContainerId = 'pr-conn-panel', onSelected) {
    const panelEl = document.getElementById(panelContainerId);
    if (panelEl) panelEl.innerHTML = PrinterUI.connectionPanelHtml(connection, statusElId);

    document.getElementById('pr-usb-connect')?.addEventListener('click', async () => {
      await PrinterUI.connectAndSelect('usb', printerSelectId, currentPrinter, statusElId, onSelected);
    });
    document.getElementById('pr-bt-connect')?.addEventListener('click', async () => {
      await PrinterUI.connectAndSelect('bluetooth', printerSelectId, currentPrinter, statusElId, onSelected);
    });
    document.getElementById('pr-net-connect')?.addEventListener('click', async () => {
      await PrinterUI.connectAndSelect('network', printerSelectId, currentPrinter, statusElId, onSelected);
    });
  },

  async bindConnectionFilter(connSelectId, printerSelectId, currentPrinter, opts = {}) {
    const connEl = document.getElementById(connSelectId);
    if (!connEl) return;
    const statusElId = opts.statusElId || 'pr-conn-status';
    const panelContainerId = opts.panelContainerId || 'pr-conn-panel';
    const onSelected = opts.onSelected;

    const load = async () => {
      const conn = connEl.value || 'usb';
      PrinterUI.bindConnectionPanel(conn, printerSelectId, currentPrinter, statusElId, panelContainerId, onSelected);
      await PrinterUI.refreshPrinters(conn, printerSelectId, currentPrinter, statusElId);
    };
    connEl.onchange = load;
    await load();
  }
};

window.PrinterUI = PrinterUI;
