/**
 * kernel/services/staff.ts — StaffMember façade (identity ≠ executor).
 */

import type { StateStore } from '../state/open.ts';
import {
  createStaffMember,
  getStaffMember,
  listStaffMembers,
  setStaffStatus,
  type StaffMember,
  type StaffStatus,
} from '../state/staff.ts';

export interface StaffService {
  create(input: Parameters<typeof createStaffMember>[1]): StaffMember;
  get(id: string): StaffMember | null;
  list(): StaffMember[];
  setStatus(input: { readonly id: string; readonly status: StaffStatus; readonly at: string }): StaffMember;
  pause(id: string, at: string): StaffMember;
  retire(id: string, at: string): StaffMember;
}

export function createStaffService(store: StateStore): StaffService {
  return {
    create: (input) => createStaffMember(store, input),
    get: (id) => getStaffMember(store, id),
    list: () => listStaffMembers(store),
    setStatus: (input) => setStaffStatus(store, input),
    pause: (id, at) => setStaffStatus(store, { id, status: 'paused', at }),
    retire: (id, at) => setStaffStatus(store, { id, status: 'retired', at }),
  };
}
