import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import type { FileDto } from '@wasl/shared';
import type { NativeApi } from './transport';

export async function upload(
  api: NativeApi,
  purpose: 'LESSON_RESOURCE' | 'ASSESSMENT_ANSWER',
  ownerId: string,
): Promise<FileDto | undefined> {
  const picked = await DocumentPicker.getDocumentAsync({
    multiple: false,
    copyToCacheDirectory: true,
    type: [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'text/plain',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
  });
  if (picked.canceled) return;
  const asset = picked.assets[0];
  if (asset.size && asset.size > 10 * 1024 * 1024)
    throw Object.assign(new Error('File too large'), { status: 413 });
  const data = new FormData();
  data.append('purpose', purpose);
  data.append(purpose === 'LESSON_RESOURCE' ? 'lessonId' : 'assessmentId', ownerId);
  if (Platform.OS === 'web') data.append('file', await (await fetch(asset.uri)).blob(), asset.name);
  else
    data.append('file', {
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType ?? 'application/octet-stream',
    } as unknown as Blob);
  return (await api.response('files', { method: 'POST', body: data })).json() as Promise<FileDto>;
}
export async function download(api: NativeApi, storageKey: string) {
  const metadata = await api.call<FileDto>(
    'files/resolve?storageKey=' + encodeURIComponent(storageKey),
  );
  const response = await api.response('files/' + metadata.id + '/content');
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = metadata.originalName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return;
  }
  const safeName =
    metadata.id + '-' + metadata.originalName.replace(/[^\p{L}\p{N}._-]/gu, '_').slice(-100);
  const file = new File(Paths.cache, safeName);
  file.create({ overwrite: true });
  await file.write(new Uint8Array(await response.arrayBuffer()));
  if (!(await Sharing.isAvailableAsync())) {
    file.delete();
    throw new Error('Sharing unavailable');
  }
  try {
    await Sharing.shareAsync(file.uri, {
      mimeType: metadata.contentType,
      dialogTitle: metadata.originalName,
    });
  } finally {
    file.delete();
  }
}
