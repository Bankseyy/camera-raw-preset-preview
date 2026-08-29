import { photoshop } from "../globals";

/**
 * Runs callback inside a named Photoshop history state so every change is
 * grouped into a single Ctrl+Z undo step. Uses executionContext.hostControl
 * suspendHistory/resumeHistory rather than relying on executeAsModal's implicit
 * history batching, which leaves intermediate layer operations as separate steps.
 */
export async function withHistory(
  doc: any,
  name: string,
  callback: () => Promise<void>
): Promise<void> {
  await (photoshop.core as any).executeAsModal(
    async (executionContext: any) => {
      const hist = await executionContext.hostControl.suspendHistory({
        documentID: doc.id,
        name,
      });
      try {
        await callback();
        await executionContext.hostControl.resumeHistory(hist, true);
      } catch (e) {
        await executionContext.hostControl.resumeHistory(hist, false);
        throw e;
      }
    },
    { commandName: name }
  );
}
