const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  platform: process.platform,
  version: '0.1.0'
});
