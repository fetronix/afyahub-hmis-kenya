import * as domain from '../db/schema/website-booking.ts';
import { schemaModuleContract } from './support/schema-module-contract.ts';

schemaModuleContract('website-booking', domain, [
  'websiteBookingClients',
  'websiteBookingSlots',
  'externalBookings',
  'websiteBookingEvents',
  'websiteBookingMutations',
]);
