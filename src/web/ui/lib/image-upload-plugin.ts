import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { uploadAsset } from '../api.ts';

/**
 * Tiptap extension that handles image paste and drag/drop.
 * Uploads images to the backend and inserts them as image nodes.
 */
export const ImageUpload = Extension.create({
  name: 'imageUpload',

  addProseMirrorPlugins() {
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
                  handleImageUpload(view, file);
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
              handleImageUpload(view, file, pos?.pos);
            }
            return true;
          },
        },
      }),
    ];
  },
});

async function handleImageUpload(
  view: EditorView,
  file: File,
  insertPos?: number,
): Promise<void> {
  try {
    const result = await uploadAsset(file);
    const { schema } = view.state;
    const imageNode = schema.nodes.image;
    if (!imageNode) return;

    const node = imageNode.create({
      src: result.url,
      alt: file.name,
    });

    const pos = insertPos ?? view.state.selection.anchor;
    const tr = view.state.tr.insert(pos, node);
    view.dispatch(tr);
  } catch (err) {
    console.error('Image upload failed:', err);
  }
}
