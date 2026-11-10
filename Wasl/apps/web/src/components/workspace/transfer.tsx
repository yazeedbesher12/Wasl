"use client";
import { useState } from "react";
import { decode, DemoError } from "@wasl/shared/demo";
import { connectedDemo } from "@/lib/admin/repository";
import { useWorkspace } from "./provider";
import { Modal } from "./ui";

export function SnapshotTransfer() {
  const { t, data, busy, setError, importData, navigate } = useWorkspace();
  const [raw, setRaw] = useState(""); const [confirm, setConfirm] = useState(false);
  return <section className="panel transfer-panel"><h2>{t("transfer")}</h2><p className="muted">{t("snapshotHelp")}</p><p className="muted">{t("snapshotOperator")}</p><div className="actions"><button className="button secondary" disabled={!data || busy} onClick={() => {
    try {
      const snapshot = connectedDemo.exportSnapshot(); setRaw(snapshot);
      const url = URL.createObjectURL(new Blob([snapshot], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "wasl-demo-v3.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError({ code: "error" }); }
  }}>{t("export")}</button></div><label>{t("snapshot")}<textarea rows={7} dir="ltr" value={raw} onChange={e => setRaw(e.target.value)} /></label><label>{t("import")}<input type="file" accept=".json,application/json" disabled={busy} onChange={async e => { const file = e.target.files?.[0]; if (file) { if (file.size > 20_000_000) { setError({ code: "invalidSnapshot" }); return; } try { setRaw(await file.text()); } catch { setError({ code: "error" }); } } }} /></label><button className="button" disabled={!raw.trim() || busy} onClick={() => { try { decode(raw); setError(undefined); setConfirm(true); } catch (e) { setError({ code: e instanceof DemoError ? e.code : "invalidSnapshot" }); } }}>{t("import")}</button>
    {confirm && <Modal title={t("replace")} busy={busy} close={() => setConfirm(false)}><p>{t("snapshotHelp")}</p><div className="dialog-actions"><button className="button secondary" disabled={busy} onClick={() => setConfirm(false)}>{t("cancel")}</button><button className="button danger" disabled={busy} onClick={async () => { if (await importData(raw)) { setConfirm(false); setRaw(""); navigate("/demo", true); } }}>{t(busy ? "working" : "confirm")}</button></div></Modal>}
  </section>;
}
