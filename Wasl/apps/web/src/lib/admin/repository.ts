import { DemoStore } from "@wasl/shared/demo";

// Browser APIs are only touched when an adapter method is called after mount.
export const connectedDemo = new DemoStore({
  async get(key) { return localStorage.getItem(key); },
  async set(key, value) { localStorage.setItem(key, value); },
});
export const demoRepository = {
  async load() { const state = await connectedDemo.load(); return { state, persistent: connectedDemo.persistent, recovered: false }; },
  saveSchool: connectedDemo.saveSchool.bind(connectedDemo),
  setActive: connectedDemo.setActive.bind(connectedDemo),
  saveAdministrator: connectedDemo.saveAdministrator.bind(connectedDemo),
  reset: connectedDemo.reset.bind(connectedDemo),
};
