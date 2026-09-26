// Builds the Milky Way density maps and detail tile off the main thread.
import { buildDetailMap, buildGalaxyMaps } from '../scene/galaxy/model.ts';

self.onmessage = () => {
  const maps = buildGalaxyMaps();
  const detail = buildDetailMap();
  (self as unknown as Worker).postMessage({ maps, detail }, [maps.buffer, detail.buffer]);
};
