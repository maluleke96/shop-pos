module.exports = {
  app: {
    getPath(name) {
      if (name === 'userData') return '/data';
      if (name === 'temp') return '/tmp';
      return '/data';
    },
    getPathForFile() { return '/data'; }
  },
  BrowserWindow: class {},
  ipcMain: { handle() {} },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { showItemInFolder() {}, openExternal() {} },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 800, height: 600 } }) }
};
