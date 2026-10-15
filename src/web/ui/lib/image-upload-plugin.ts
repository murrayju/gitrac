import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { uploadAsset } from '../api.ts';
import { uploadErrorMessage } from './upload-error.ts';

export interface ImageUploadOptions {
  /**
   * Called with a user-facing message when an upload fails (unsupported
   * type, too large, network/server error). Nothing is inserted then.
   */
  onError?: (message: string) => void;
  /** Called when an upload starts, e.g. to clear a previous error. */
  onStart?: () => void;
}

/**
 * Tiptap extension that handles image paste and drag/drop.
 * Uploads images to the backend and inserts them as image nodes.
 */
export const ImageUpload = Extension.create<ImageUploadOptions>({
  name: 'imageUpload',

  addOptions() {
    return { onError: undefined, onStart: undefined };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        props: {
          handlePaste(view: EditorView, event: ClipboardEvent) {
            const items = event.clipboardData?.items;
            if (!items) return false;

            for (const item of items) {
              if (item.type.startsWith('image/')) {
                event.preventDefault();
                const file = item.getAsFile();
                if (file) {
                  void uploadImage(view, file, { ...options });
                }
                return true;
              }
            }
            return false;
          },

          handleDrop(view: EditorView, event: DragEvent) {
            const files = event.dataTransfer?.files;
            if (!files || files.length === 0) return false;

            const imageFiles = Array.from(files).filter((f) =>
              f.type.startsWith('image/'),
            );
            if (imageFiles.length === 0) return false;

            event.preventDefault();

            // Get drop position
            const pos = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });

            for (const file of imageFiles) {
              void uploadImage(view, file, { ...options, insertPos: pos?.pos });
            }
            return true;
          },
        },
      }),
    ];
  },
});

/**
 * Upload `file` and, once it succeeds, insert it as an image node at
 * `insertPos` (default: the selection). Nothing is inserted until the upload
 * succeeds, so a failure leaves the document untouched and is reported via
 * `onError` (or the console, without one). Resolves to whether it inserted.
 */
export async function uploadImage(
  view: EditorView,
  file: File,
  {
    insertPos,
    onError,
    onStart,
  }: ImageUploadOptions & { insertPos?: number } = {},
): Promise<boolean> {
  onStart?.();
  let url: string;
  try {
    url = (await uploadAsset(file)).url;
  } catch (err) {
    const message = uploadErrorMessage(err, file.name);
    if (onError) onError(message);
    else console.error(message, err);
    return false;
  }
  if (view.isDestroyed) return false;

  const imageNode = view.state.schema.nodes.image;
  if (!imageNode) return false;
  const node = imageNode.create({ src: url, alt: file.name });

  // The document may have changed during the upload: keep the position in range.
  const size = view.state.doc.content.size;
  const pos = Math.min(insertPos ?? view.state.selection.anchor, size);
  view.dispatch(view.state.tr.insert(pos, node));
  return true;
}
