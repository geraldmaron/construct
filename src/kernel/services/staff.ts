/**
 * kernel/services/staff.ts — durable staff ownership façade.
 */

import type { StateStore } from '../state/open.ts';
import {
  createStaffMember,
  getStaffMember,
  listStaffMembers,
  type StaffMember,
} from '../state/staff.ts';

export interface StaffService {
  create(input: Parameters<typeof createStaffMember>[1]): StaffMember;
  get(id: string): StaffMember | null;
  list(): StaffMember[];
}

export function createStaffService(store: StateStore): StaffService {
  return {
    create: (input) => createStaffMember(store, input),
    get: (id) => getStaffMember(store, id),
    list: () => listStaffMembers(store),
  };
}
