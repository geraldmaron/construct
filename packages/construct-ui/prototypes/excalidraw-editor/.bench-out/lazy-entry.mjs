
    export async function loadEditor() {
      const mod = await import('@excalidraw/excalidraw');
      return mod.Excalidraw;
    }
  