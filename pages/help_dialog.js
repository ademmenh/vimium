import "../lib/utils.js";
import "../lib/settings.js";
import "../lib/dom_utils.js";
// TODO(philc): Why does importing this break the help dialog?
// import "./ui_component_server.js";
import "../background_scripts/all_commands.js";

// The ordering we show key bindings is alphanumerical, except that special keys sort to the end.
function compareKeys(a, b) {
  a = a.replace("<", "~");
  b = b.replace("<", "~");
  if (a < b) {
    return -1;
  } else if (b < a) {
    return 1;
  } else {
    return 0;
  }
}

// This overrides the HelpDialog implementation in vimium_frontend.js. We provide aliases for the
// two HelpDialog methods required by normalMode (isShowing() and toggle()).
const HelpDialog = {
  dialogElement: null,
  isShowing() {
    return true;
  },

  // This setting is pulled out of local storage. It's false by default.
  getShowAdvancedCommands() {
    return Settings.get("helpDialog_showAdvancedCommands");
  },

  init() {
    if (this.dialogElement != null) {
      return;
    }
    this.dialogElement = document.querySelector("#dialog");

    const closeButton = this.dialogElement.querySelector("#close");
    closeButton.addEventListener("click", (event) => {
      event.preventDefault();
      this.hide();
    }, false);

    // "auxclick" handles a click with the middle mouse button.
    const optionsLink = document.querySelector("#options-page");
    for (const eventName of ["click", "auxclick"]) {
      optionsLink.addEventListener(eventName, (event) => {
        event.preventDefault();
        chrome.runtime.sendMessage({ handler: "openOptionsPageInNewTab" });
      }, false);
    }

    document.querySelector("#toggle-advanced a").addEventListener(
      "click",
      HelpDialog.toggleAdvancedCommands.bind(HelpDialog),
      false,
    );

    document.documentElement.addEventListener("click", (event) => {
      if (!this.dialogElement.contains(event.target)) {
        this.hide();
      }
    }, false);
  },

  // Returns the rows to show in the help dialog, grouped by command group.
  // Returns: { group: [[commandName, args, keys], ...], ... }
  getRowsForDialog(commandToOptionsToKeys) {
    const result = {};
    const byGroup = Object.groupBy(allCommands, (o) => o.group);
    for (const [group, commands] of Object.entries(byGroup)) {
      const list = [];
      for (const command of commands) {
        const variations = commandToOptionsToKeys[command.name] || {};
        // Ensure every command, without options, has an entry in the help dialog.
        // NOTE(philc): It doesn't necessarily need to be the case that we want to show
        // an entry for every command without options, but it's the case today.
        const noOptions = "";
        if (!variations[noOptions]) {
          list.push([command.name, "", []]);
        }
        for (const [options, keys] of Object.entries(variations)) {
          list.push([command.name, options, keys]);
        }
      }
      result[group] = list;
    }
    return result;
  },

  // TODO(philc): Clean up the rest of this showAllCommandDetails usage.
  async show({ showAllCommandDetails }) {
    const title = showAllCommandDetails ? "Command Listing" : "Help";
    document.getElementById("help-dialog-title").textContent = title;
    document.getElementById("vimium-version").textContent = Utils.getCurrentVersion();

    const entryTemplate = document.querySelector("#entry").content;
    const entryBindingsTemplate = document.querySelector("#entry-bindings-only").content;
    const keysTemplate = document.querySelector("#keys-template").content;
    const commandNameTemplate = document.querySelector("#command-name-template").content;

    const commandToOptionsToKeys = (await chrome.storage.session.get("helpPageData")).helpPageData;
    const rowsByGroup = this.getRowsForDialog(commandToOptionsToKeys);
    const commandsByName = Utils.keyBy(allCommands, "name");

    for (const [group, rows] of Object.entries(rowsByGroup)) {
      const container = this.dialogElement.querySelector(`[data-group="${group}"]`);
      container.innerHTML = "";
      for (const [name, options, keys] of rows) {
        const entryEl = entryTemplate.cloneNode(true);
        const command = commandsByName[name];
        entryEl.querySelector(".help-description").textContent = command.desc;
        if (command.advanced) {
          entryEl.querySelector(".row").classList.add("advanced");
        }
        const keysEl = entryEl.querySelector(".key-bindings");
        for (const key of keys.sort(compareKeys)) {
          const node = keysTemplate.cloneNode(true);
          node.querySelector(".key").textContent = key;
          keysEl.appendChild(node);
        }
        container.appendChild(entryEl);
      }
    }

    this.showAdvancedCommands(this.getShowAdvancedCommands());

    // "Click" the dialog element (so that it becomes scrollable).
    DomUtils.simulateClick(this.dialogElement);
  },

  hide() {
    UIComponentServer.hide();
  },

  toggle() {
    this.hide();
  },

  //
  // Advanced commands are hidden by default so they don't overwhelm new and casual users.
  //
  toggleAdvancedCommands(event) {
    const container = document.querySelector("#container");
    const scrollHeightBefore = container.scrollHeight;
    event.preventDefault();
    const showAdvanced = HelpDialog.getShowAdvancedCommands();
    HelpDialog.showAdvancedCommands(!showAdvanced);
    Settings.set("helpDialog_showAdvancedCommands", !showAdvanced);
    // Try to keep the "show advanced commands" button in the same scroll position.
    const scrollHeightDelta = container.scrollHeight - scrollHeightBefore;
    if (scrollHeightDelta > 0) {
      container.scrollTop += scrollHeightDelta;
    }
  },

  showAdvancedCommands(visible) {
    const caption = visible ? "Hide advanced commands" : "Show advanced commands";
    document.querySelector("#toggle-advanced a").textContent = caption;
    if (visible) {
      HelpDialog.dialogElement.classList.add("showAdvanced");
    } else {
      HelpDialog.dialogElement.classList.remove("showAdvanced");
    }
  },
};

function init() {
  UIComponentServer.registerHandler(async function (event) {
    await Settings.onLoaded();
    await Utils.populateBrowserInfo();
    switch (event.data.name != null ? event.data.name : event.data) {
      case "hide":
        HelpDialog.hide();
        break;
      case "activate":
        HelpDialog.init();
        await HelpDialog.show(event.data);
        // If we abandoned (see below) in a mode with a HUD indicator, then we have to reinstate it.
        Mode.setIndicator();
        break;
      case "hidden":
        // Abandon any HUD which might be showing within the help dialog.
        HUD.abandon();
        break;
    }
  });
}

const testEnv = globalThis.window == null;
if (!testEnv) {
  document.addEventListener("DOMContentLoaded", async () => {
    await Settings.onLoaded();
    DomUtils.injectUserCss(); // Manually inject custom user styles.
    init();
  });
}

globalThis.HelpDialog = HelpDialog;
globalThis.isVimiumHelpDialog = true;

export { HelpDialog };
