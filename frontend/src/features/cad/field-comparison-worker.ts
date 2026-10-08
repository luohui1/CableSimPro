import { differenceField } from './thermal-difference';
self.onmessage = event => {
  try { self.postMessage({ value: differenceField(event.data.fem, event.data.iec) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
