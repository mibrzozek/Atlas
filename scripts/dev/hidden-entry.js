// The entry of the hidden copy (started by scripts/dev/hidden.js): every window Atlas makes, its own and
// those its page opens, is hidden and drawn off the screen, then the development build starts as usual.
const Module = require('module');
const path = require('path');

const hidden = (options = {}) => ({
  ...options,
  show: false,
  webPreferences: { ...options.webPreferences, offscreen: true },
});

const load = Module._load;
Module._load = function (request, ...rest) {
  const loaded = load.call(this, request, ...rest);
  if (request !== 'electron' || loaded.BrowserWindow.isHidden) {
    return loaded;
  }
  class HiddenWindow extends loaded.BrowserWindow {
    static isHidden = true;
    constructor(options) {
      super(hidden(options));
      const { webContents } = this;
      const setHandler = webContents.setWindowOpenHandler.bind(webContents);
      webContents.setWindowOpenHandler = (handler) =>
        setHandler((details) => {
          const answer = handler(details);
          return answer.action === 'allow'
            ? { ...answer, overrideBrowserWindowOptions: hidden(answer.overrideBrowserWindowOptions) }
            : answer;
        });
      webContents.on('did-create-window', (win) => {
        win.show = win.showInactive = win.center = () => {};
      });
      this.show = this.showInactive = this.focus = () => {};
    }
  }
  return new Proxy(loaded, {
    get: (target, key) => (key === 'BrowserWindow' ? HiddenWindow : target[key]),
  });
};

require(path.join(__dirname, '..', '..', 'build', 'main.bundle.js'));
