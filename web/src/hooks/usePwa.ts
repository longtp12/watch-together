import { useSyncExternalStore } from 'react';
import { pwa } from '../lib/pwa';

export const usePwa = () => useSyncExternalStore(pwa.subscribe, pwa.getState);
