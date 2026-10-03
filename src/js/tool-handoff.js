const DB_NAME = "redaktix";
const STORE = "pending-tool";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function finish(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function stashPendingToolFile(slug, file) {
  const db = await openDb();
  const record = {
    slug,
    name: file.name || "screenshot.png",
    type: file.type || "image/png",
    buffer: await file.arrayBuffer(),
  };
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(record, "current");
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function takePendingToolFile(slug) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const record = await finish(store.get("current"));
  if (!record || record.slug !== slug) {
    db.close();
    return null;
  }
  store.delete("current");
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return new File([record.buffer], record.name, { type: record.type });
}
