import { useRef, useState } from "react";
import { Alert } from "react-native";
import { File, Paths } from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { decode, DemoError } from "../../../packages/shared/src/demo";
import { useNative } from "./context";
import { nativeStore } from "./storage";
import { Button, Card, Field, Txt } from "./ui";

export function NativeTransfer() {
  const n = useNative(); const { t, data, busy, importData, setError } = n;
  const [raw, setRaw] = useState(""); const [selectedName, setName] = useState(""); const fullFile = useRef(""); const [transferring, setTransferring] = useState(false);
  const locked = useRef(false);
  async function exportFile() {
    if (locked.current) return; locked.current = true; setTransferring(true);
    try {
      const file = new File(Paths.cache, "wasl-demo-v3.json"); file.create({ overwrite: true }); await file.write(nativeStore.exportSnapshot());
      if (!await Sharing.isAvailableAsync()) throw new DemoError("error");
      await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle: t("export"), UTI: "public.json" });
    } catch { setError({ code: "error" }); }
    finally { locked.current = false; setTransferring(false); }
  }
  async function chooseFile() {
    if (locked.current) return; locked.current = true; setTransferring(true);
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ["application/json", "text/plain", "application/octet-stream"], copyToCacheDirectory: true, multiple: false });
      if (!picked.canceled) {
        const asset = picked.assets[0]; if (asset.size && asset.size > 20_000_000) throw new DemoError("invalidSnapshot");
        const value = await new File(asset.uri).text(); decode(value); fullFile.current = value; setName(asset.name); setRaw("");
      }
    } catch (e) { setError({ code: e instanceof DemoError ? e.code : "invalidSnapshot" }); }
    finally { locked.current = false; setTransferring(false); }
  }
  return <Card><Txt title>{t("transfer")}</Txt><Txt muted>{t("snapshotHelp")}</Txt><Txt muted>{t("snapshotOperator")}</Txt><Button secondary disabled={!data || busy || transferring} onPress={() => void exportFile()}>{t("export")}</Button><Button secondary disabled={busy || transferring} onPress={() => void chooseFile()}>{t("import")} · JSON</Button>{selectedName && <Txt ltr>{selectedName}</Txt>}<Field label={t("snapshot")} value={raw} multiline maxLength={20_000_000} style={{ textAlign: "left", writingDirection: "ltr" }} onChangeText={v => { setRaw(v); fullFile.current = ""; setName(""); }} /><Button disabled={(!raw.trim() && !fullFile.current) || busy || transferring} onPress={() => {
    const value = fullFile.current || raw;
    try { decode(value); Alert.alert(t("replace"), t("snapshotHelp"), [{ text: t("cancel"), style: "cancel" }, { text: t("confirm"), style: "destructive", onPress: () => { void importData(value); } }]); }
    catch (e) { setError({ code: e instanceof DemoError ? e.code : "invalidSnapshot" }); }
  }}>{t(busy ? "working" : "import")}</Button></Card>;
}
