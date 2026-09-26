// Builds the Milky Way density maps off the main thread.
import { buildGalaxyMaps } from '../scene/galaxy/model.ts';

self.onmessage = () => {
  const maps = buildGalaxyMaps();
  (self as unknown as Worker).postMessage(maps, [maps.buffer]);
};
