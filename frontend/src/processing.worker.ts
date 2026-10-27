import { operations, type Operations } from "./operations.ts";
import { storageError } from "./storage.ts";

// Serialize requests; the long merge itself yields between IndexedDB chunks.
let queue = Promise.resolve();
self.addEventListener("message", (event) => {
  const { id, operation, payload } = event.data as {
    id: number;
    operation: keyof Operations;
    payload: never;
  };
  queue = queue.then(async () => {
    try {
      const value = await operations[operation](payload);
      self.postMessage({ id, value });
    } catch (error) {
      const problem = storageError(error);
      self.postMessage({
        id,
        error: { code: problem.code, params: problem.params },
      });
    }
  });
});
