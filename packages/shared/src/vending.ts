/**
 * The vending machine: free snacks and sodas. Picking one puts it in your hands; everyone nearby sees you eat or sip it.
 * Nothing is bought and nothing is kept: no money, no stock, no inventory.
 */
import type { VendedId } from './activity';
import { VENDED, isVended } from './activity';

export interface VendItem {
  id: VendedId;
  name: string;
  kind: 'snack' | 'soda';
  /** the colour of the packet or can; used for the menu, the drop and the thing in your hand */
  color: string;
  accent: string;
}

export const VEND_ITEMS: Record<VendedId, VendItem> = {
  chips: { id: 'chips', name: 'Chips', kind: 'snack', color: '#e8b04a', accent: '#b8442e' },
  choc: { id: 'choc', name: 'Chocolate bar', kind: 'snack', color: '#6a3e2a', accent: '#d9a441' },
  cookie: { id: 'cookie', name: 'Cookies', kind: 'snack', color: '#c98a4b', accent: '#5a3a24' },
  cola: { id: 'cola', name: 'Cola', kind: 'soda', color: '#b3262e', accent: '#f4efe4' },
  lemon: { id: 'lemon', name: 'Lemon soda', kind: 'soda', color: '#e8dc5a', accent: '#5fae5a' },
  orange: { id: 'orange', name: 'Orange soda', kind: 'soda', color: '#e8883a', accent: '#f4efe4' },
  icetea: { id: 'icetea', name: 'Iced tea', kind: 'soda', color: '#a8692c', accent: '#e8d8a0' },
};

export const VEND_LIST: VendItem[] = VENDED.map((id) => VEND_ITEMS[id]);

/** Minimum time between two picks from the machine (ms); the server enforces it, the menu says it kindly. */
export const VEND_GAP_MS = 1800;
/** How long the drop animation plays on screen (ms). */
export const VEND_DROP_MS = 900;

export function vendItem(id: string): VendItem | null {
  return isVended(id) ? VEND_ITEMS[id] : null;
}

/** Why a pick cannot happen right now, or null. Seated people keep to tea. */
export function vendBlocked(id: string, seated: boolean, lastAt: number, now: number): string | null {
  if (!vendItem(id)) return 'The machine does not have that.';
  if (seated) return 'Stand up first, then pick something.';
  if (now - lastAt < VEND_GAP_MS) return 'The machine is still clunking. One moment.';
  return null;
}
